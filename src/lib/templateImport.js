/**
 * Template bulk import — everything that is not React: indexing the picked
 * folder, the manifest pre-check, building the /files payloads, retry with
 * backoff, and the upload runner (presign → PUT to S3 → complete, per row).
 *
 * The panel drives every step and the server keeps the state; every step is
 * safe to repeat, which is how resume works. Files live only on the admin's
 * machine, so the tab must stay open while they upload.
 */
import JSZip from 'jszip';
import { putWithProgress, uploadMultipart, isAbortError, uploadErrorText, fmtBytes } from './assetUpload';

export { fmtBytes };

// ---- defaults (the report's `limits` win when present) ------------------------

export const DEFAULT_LIMITS = {
  max_rows: 300,
  max_families: 100,
  max_files: 3000,
  max_total_bytes: 1024 * 1024 * 1024,
  files_chunk: 25,
  max_content_bytes: 2 * 1024 * 1024,
  multipart_over: 100 * 1024 * 1024,
};

export const limitsOf = (report) => ({ ...DEFAULT_LIMITS, ...(report?.limits || {}) });

export const REQUIRED_COLUMNS = ['family_name', 'size', 'folder'];
export const MANIFEST_COLUMNS = [
  'family_name',
  'category',
  'industries',
  'tags',
  'is_premium',
  'template_type',
  'search_keywords',
  'language',
  'size',
  'folder',
  'thumbnail',
];

// ---- labels / colours ---------------------------------------------------------

export const IMPORT_STATUS = {
  draft: { label: 'Draft', color: 'default' },
  validated: { label: 'Ready to import', color: 'blue' },
  running: { label: 'Running', color: 'processing' },
  completed: { label: 'Completed', color: 'green' },
  completed_with_issues: { label: 'Completed with issues', color: 'orange' },
  cancelled: { label: 'Cancelled', color: 'default' },
};

export const STAGE = {
  awaiting_files: { label: 'Awaiting files', color: 'default' },
  valid: { label: 'Valid', color: 'green' },
  invalid: { label: 'Invalid', color: 'red' },
  created: { label: 'Created', color: 'cyan' },
  uploading: { label: 'Uploading', color: 'processing' },
  completed: { label: 'Completed', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  cancelled: { label: 'Cancelled', color: 'default' },
};

export const OUTCOME = {
  published: { label: 'Published', color: 'green' },
  draft: { label: 'Stays a draft', color: 'gold' },
  already_live: { label: 'Already live', color: 'green' },
  deleted: { label: 'Removed', color: 'default' },
};

export const STAGE_ORDER = [
  'awaiting_files',
  'valid',
  'invalid',
  'created',
  'uploading',
  'completed',
  'failed',
  'cancelled',
];

/** Stage counts from the items themselves (row patches keep these current). */
export function countStages(items = []) {
  const counts = {};
  items.forEach((i) => {
    counts[i.stage] = (counts[i.stage] || 0) + 1;
  });
  return counts;
}

/** Rows the upload runner picks up: created / uploading / failed at upload or complete. */
export function isUploadable(item) {
  if (item.stage === 'created' || item.stage === 'uploading') return true;
  return item.stage === 'failed' && (item.failed_stage === 'upload' || item.failed_stage === 'complete');
}

/** Rows the /files step sends: everything the manifest did not already reject. */
export function needsFiles(item) {
  return item.stage === 'awaiting_files';
}

/**
 * Rows a re-check may send again (folder fixed on disk and re-picked): valid
 * rows and rows that failed ONLY on their files. A row the manifest rejected
 * has at least one error with scope "manifest" and cannot be fixed by files.
 */
export function canRecheck(item) {
  if (item.stage === 'awaiting_files' || item.stage === 'valid') return true;
  if (item.stage !== 'invalid') return false;
  // eslint-disable-next-line no-use-before-define
  return !isManifestRejected(item);
}

/**
 * Rows the manifest itself rejected (an error of scope "manifest"): only a new
 * manifest.csv (PUT …/manifest) can fix them.
 */
export const isManifestRejected = (item) =>
  item.stage === 'invalid' && (item.errors || []).some((e) => e.scope === 'manifest');

/** A warning's level; one about the files with no level is never just a note. */
export const warningLevel = (w) => (w.level === 'warning' || (!w.level && w.scope === 'files') ? 'warning' : 'info');

/**
 * A warning about the bundle's files (level "warning", not "info"): a file the
 * design names is missing, loads from a URL outside the bundle, or is unused.
 * The row still imports — shown boxed.
 */
export const isFileWarning = (w) => w.scope === 'files' && warningLevel(w) === 'warning';

/** Warnings of level "warning" (info lines not counted) — the row's amber Tag. */
export const warningCount = (item) => (item.warnings || []).filter((w) => warningLevel(w) === 'warning').length;

/** Why a design / a row stays a draft: warnings of scope "publish". */
export const publishWarnings = (list) => (list || []).filter((w) => w.scope === 'publish');

/**
 * The key for everything the panel keeps per row (upload progress, bundle
 * notes, multipart sessions…). Row numbers shift when manifest.csv is replaced,
 * so state follows the row's `folder` (case-insensitive), never its `row`.
 */
export function rowKey(item) {
  const f = normPath(item?.folder).toLowerCase();
  return f || `#row${item?.row}`;
}

/** Drop entries of a rowKey-keyed Map whose folder is no longer in `items`. */
export function pruneByRows(map, items, keyOfEntry = (k) => k) {
  const keep = new Set((items || []).map(rowKey));
  const out = new Map();
  map.forEach((v, k) => {
    if (keep.has(keyOfEntry(k))) out.set(k, v);
  });
  return out;
}

// ---- picking the folder -------------------------------------------------------

// OS litter a designer's folder picks up; never sent, never "unused file".
const JUNK = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*)$/i;

const normPath = (p) =>
  String(p || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);
const isZipPath = (p) => /\.zip$/i.test(p);
const isJson = (name) => /\.json$/i.test(name);

/** Entries from `<input webkitdirectory>`: [{ file, path }]. */
export function entriesFromInput(fileList) {
  return Array.from(fileList || []).map((file) => ({
    file,
    path: normPath(file.webkitRelativePath || file.name),
  }));
}

/**
 * Entries from a drag-and-drop of a folder (or of its contents). Walks the
 * FileSystemEntry tree; readEntries() returns at most ~100 at a time, so it is
 * called until it answers empty.
 */
export async function entriesFromDrop(dataTransfer) {
  const roots = Array.from(dataTransfer?.items || [])
    .filter((it) => it.kind === 'file')
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  const out = [];
  const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
  const readAll = async (dir) => {
    const reader = dir.createReader();
    const all = [];
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) return all;
      all.push(...batch);
    }
  };
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push({ file: await fileOf(entry), path: normPath(entry.fullPath) });
    } else if (entry.isDirectory) {
      const children = await readAll(entry);
      for (const child of children) {
        // eslint-disable-next-line no-await-in-loop
        await walk(child);
      }
    }
  };
  for (const root of roots) {
    // eslint-disable-next-line no-await-in-loop
    await walk(root);
  }
  return out;
}

/**
 * Index the picked files by their path relative to manifest.csv's folder. The
 * shallowest manifest.csv wins, so picking the batch folder and dropping its
 * contents both work. Returns:
 *   { rootName, manifest: File, files: Map(relPath → File),
 *     dirs: Map(relDir → Map(name → File)), count, zipCount, bytes }
 * (count / bytes are the PICKED files — a ZIP counts once, at its ZIP size)
 * or throws an Error with a message for the admin.
 */
export function indexFolder(entries) {
  const list = (entries || []).filter((e) => e?.file && !JUNK.test(baseOf(e.path)));
  const manifests = list
    .filter((e) => baseOf(e.path).toLowerCase() === 'manifest.csv')
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  if (!manifests.length) {
    throw new Error('No manifest.csv in the picked folder — it must sit at the top of the batch folder.');
  }
  const base = dirOf(manifests[0].path);
  const prefix = base ? `${base}/` : '';
  const files = new Map();
  const dirs = new Map();
  let bytes = 0;
  let zipCount = 0;
  list.forEach(({ file, path }) => {
    if (prefix && !path.startsWith(prefix)) return;
    const rel = path.slice(prefix.length);
    if (!rel || rel.toLowerCase() === 'manifest.csv') return;
    files.set(rel, file);
    bytes += file.size;
    if (isZipPath(rel)) zipCount += 1;
    const d = dirOf(rel);
    if (!dirs.has(d)) dirs.set(d, new Map());
    dirs.get(d).set(baseOf(rel), file);
  });
  // Case-insensitive lookup for paths typed with another case (Windows).
  const filesLower = new Map();
  files.forEach((v, k) => {
    if (!filesLower.has(k.toLowerCase())) filesLower.set(k.toLowerCase(), v);
  });
  const dirsLower = new Map();
  dirs.forEach((v, k) => {
    if (!dirsLower.has(k.toLowerCase())) dirsLower.set(k.toLowerCase(), v);
  });
  return {
    rootName: base ? baseOf(base) : '',
    manifest: manifests[0].file,
    files,
    filesLower,
    dirs,
    dirsLower,
    count: files.size,
    zipCount,
    bytes,
    // Bundle metadata already read (readBundle). A re-pick builds a new index.
    bundles: new Map(),
  };
}

// ---- reading one bundle (a ZIP, or an unzipped folder) --------------------------
// A bundle is one version: { files, design, problems, failed }
//   files    [{ name, path, size, content_type }] — flat base names, duplicates
//            kept so the server can report them; sizes are UNCOMPRESSED
//   design   the entry of files holding the design JSON, or null
//   problems [string] what the admin should know (shown next to server errors)
//   failed   true when nothing could be read; the row is sent with no files
// ZIP bytes are never kept: only this metadata is cached, on the index.

const abortError = () => new DOMException('Aborted', 'AbortError');

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError();
};

const failedBundle = (problem) => ({ files: [], design: null, problems: [problem], failed: true });

const zipFileOf = (index, key) => index.files.get(key) || index.filesLower.get(key.toLowerCase()) || null;

const folderFilesOf = (index, key) =>
  index.dirs.get(key) || index.dirsLower.get(key.toLowerCase()) || new Map();

function bundleKey(index, folder) {
  const key = normPath(folder);
  if (!isZipPath(key)) return key.toLowerCase();
  const file = zipFileOf(index, key);
  return `${key.toLowerCase()}|${file ? `${file.size}|${file.lastModified}` : 'missing'}`;
}

/** Why a ZIP (or a file in it) could not be read, in words for the admin. */
function zipErrorText(name, err) {
  const msg = String(err?.message || '');
  if (err?.name === 'NotReadableError' || err?.name === 'NotFoundError') {
    return `${name} could not be read from disk (changed or moved since it was picked) — pick the folder again.`;
  }
  if (/encrypt/i.test(msg)) return `${name} is password-protected — export it without a password.`;
  if (/compression .* unknown/i.test(msg)) {
    return `${name} uses a compression method browsers cannot read — export it as a standard ZIP.`;
  }
  return `${name} could not be read — it is damaged or not a ZIP.`;
}

const loadZip = async (file) => JSZip.loadAsync(await file.arrayBuffer());

/** Drop one top-level folder that wraps everything (as TemplateBundlePanel does). */
function stripCommonRoot(list) {
  const firsts = new Set(list.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : null)));
  if (firsts.size !== 1 || firsts.has(null)) return list;
  const cutAt = [...firsts][0].length + 1;
  return list.map((e) => ({ ...e, path: e.path.slice(cutAt) }));
}

/** The ZIP's files as [{ key, path, name, entry }]; key is JSZip's own name. */
function zipEntriesOf(zip) {
  const list = Object.values(zip.files)
    .filter((entry) => !entry.dir && !/[\\/]$/.test(entry.name))
    .map((entry) => {
      const path = normPath(entry.name);
      return { key: entry.name, path, name: baseOf(path), entry };
    })
    .filter((e) => e.name && !JUNK.test(e.name) && !/(^|\/)__MACOSX\//i.test(e.path));
  return stripCommonRoot(list);
}

/** The design JSON rule, shared by ZIPs and folders. Returns { design, problem }. */
function findDesign(files, noun) {
  const jsons = files.filter((f) => isJson(f.name));
  const root = jsons.filter((f) => !f.path.includes('/'));
  const named = root.filter((f) => f.name.toLowerCase() === 'design.json');
  if (named.length) return { design: named[0], problem: null };
  if (root.length === 1) return { design: root[0], problem: null };
  const where = noun === 'ZIP' ? ' root' : '';
  if (root.length > 1) {
    return {
      design: null,
      problem: `${root.length} .json files in the ${noun}${where}: ${root.map((f) => f.path).join(', ')}`,
    };
  }
  if (jsons.length === 1) return { design: jsons[0], problem: null };
  if (jsons.length > 1) {
    return {
      design: null,
      problem: `No .json in the ${noun} root and ${jsons.length} deeper: ${jsons.map((f) => f.path).join(', ')}`,
    };
  }
  return { design: null, problem: `No .json file in the ${noun}` };
}

/** Names that are one file on Windows (or after flattening), with every path. */
function nameClashes(files) {
  const byName = new Map();
  files.forEach((f) => {
    const k = f.name.toLowerCase();
    byName.set(k, [...(byName.get(k) || []), f.path]);
  });
  return [...byName.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => `Same file name used more than once: ${paths.join(' and ')}`);
}

function makeBundle(files, noun) {
  if (!files.length) return failedBundle(`The ${noun} is empty`);
  const { design, problem } = findDesign(files, noun);
  return { files, design, problems: [...(problem ? [problem] : []), ...nameClashes(files)], failed: false };
}

async function readZip(file, signal) {
  let zip;
  try {
    zip = await loadZip(file);
    const files = [];
    for (const { key, path, name, entry } of zipEntriesOf(zip)) {
      throwIfAborted(signal);
      let size = entry._data?.uncompressedSize; // internal, but needs no inflating
      if (typeof size !== 'number') {
        // eslint-disable-next-line no-await-in-loop
        size = (await entry.async('uint8array')).byteLength;
      }
      files.push({ key, name, path, size, content_type: typeFromName(name) });
    }
    return makeBundle(files, 'ZIP');
  } catch (err) {
    if (isAbortError(err)) throw err;
    return failedBundle(zipErrorText(file.name, err));
  }
}

/**
 * Read one manifest `folder`: a path ending in .zip is a ZIP, anything else an
 * unzipped folder. Never rejects for a bad bundle (see `failed`), only for an
 * abort. Cached on the index.
 */
export async function readBundle(index, folder, { signal } = {}) {
  throwIfAborted(signal);
  const cacheKey = bundleKey(index, folder);
  const cached = index.bundles.get(cacheKey);
  if (cached) return cached;
  const key = normPath(folder);
  let bundle;
  if (isZipPath(key)) {
    const file = zipFileOf(index, key);
    bundle = file ? await readZip(file, signal) : failedBundle(`${key} not found in the picked folder`);
  } else {
    const map = folderFilesOf(index, key);
    bundle = map.size
      ? makeBundle(
          [...map].map(([name, f]) => ({ name, path: name, size: f.size, content_type: contentTypeOf(f) })),
          'folder',
        )
      : failedBundle(`Folder ${key || '(blank)'} not found in the picked folder`);
  }
  index.bundles.set(cacheKey, bundle);
  return bundle;
}

/**
 * Read every row's bundle, one ZIP at a time. onProgress(done, total) counts
 * ZIPs. Reading a file is a real task, so the page paints and a Stop click
 * lands between ZIPs; no timer here — hidden tabs throttle those to 1 s.
 */
export async function readBundles(index, items, { signal, onProgress } = {}) {
  const todo = new Map();
  items.forEach((i) => {
    const key = bundleKey(index, i.folder);
    if (!index.bundles.has(key)) todo.set(key, i.folder);
  });
  const total = [...todo.values()].filter((f) => isZipPath(normPath(f))).length;
  let done = 0;
  if (total) onProgress?.(done, total);
  for (const folder of todo.values()) {
    // eslint-disable-next-line no-await-in-loop
    await readBundle(index, folder, { signal });
    if (isZipPath(normPath(folder))) {
      done += 1;
      onProgress?.(done, total);
    }
  }
}

/**
 * Open a bundle to get its bytes: returns async (meta) → File. The ZIP stays in
 * memory only as long as the caller keeps this function; each file is inflated
 * on request.
 */
async function openBundle(index, folder) {
  const key = normPath(folder);
  if (!isZipPath(key)) {
    const map = folderFilesOf(index, key);
    return async (meta) => map.get(meta.name);
  }
  const zipFile = zipFileOf(index, key);
  let zip;
  try {
    zip = await loadZip(zipFile);
  } catch (err) {
    throw new RowError(zipErrorText(key, err));
  }
  return async (meta) => {
    try {
      const blob = await zip.files[meta.key].async('blob');
      if (blob.size !== meta.size) throw new Error('size mismatch');
      return new File([blob], meta.name, { type: meta.content_type });
    } catch {
      throw new RowError(`${meta.path} could not be unpacked from ${key} — the ZIP is damaged, export it again.`);
    }
  };
}

/** Bundle problems already known for rows still being checked: Map(rowKey → [string]). */
export function bundleNotes(index, items) {
  const out = new Map();
  if (!index) return out;
  items.forEach((i) => {
    if (!['awaiting_files', 'valid', 'invalid'].includes(i.stage)) return;
    const problems = index.bundles.get(bundleKey(index, i.folder))?.problems;
    if (problems?.length) out.set(rowKey(i), problems);
  });
  return out;
}

// ---- the folder survives navigation (not reloads) ------------------------------
// File objects are not serializable, so they never go into Redux. A reload
// loses them; resume then asks for the same folder again.

const pickedFolders = new Map();
export const rememberFolder = (uid, index) => pickedFolders.set(uid, index);
export const recallFolder = (uid) => pickedFolders.get(uid) || null;

// ---- the manifest text last sent, per import ------------------------------------
// A re-check compares manifest.csv on disk with this: unchanged → /files only;
// changed → PUT …/manifest first. Kept in memory and (best effort) in
// localStorage so a reload can still tell; unknown counts as changed.

const sentManifests = new Map();
const MANIFEST_KEY = (uid) => `mmb_tpl_import_manifest:${uid}`;

export function rememberManifest(uid, text) {
  sentManifests.set(uid, text);
  try {
    localStorage.setItem(MANIFEST_KEY(uid), text);
  } catch {
    /* storage full or unavailable — memory still has it */
  }
}

export function recallManifest(uid, report) {
  if (sentManifests.has(uid)) return sentManifests.get(uid);
  try {
    const stored = localStorage.getItem(MANIFEST_KEY(uid));
    if (stored != null) return stored;
  } catch {
    /* storage unavailable */
  }
  // If the report ever carries the manifest text, that is the truth.
  return typeof report?.manifest === 'string' ? report.manifest : null;
}

export function forgetManifest(uid) {
  sentManifests.delete(uid);
  try {
    localStorage.removeItem(MANIFEST_KEY(uid));
  } catch {
    /* storage unavailable */
  }
}

/** Two manifest texts that differ only in BOM / line endings are the same. */
const canonManifest = (t) => String(t ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

/**
 * Read manifest.csv from the picked folder and compare it with the text last
 * sent. A picked File is a snapshot: after an edit on disk, Chrome throws
 * NotReadableError (→ "unreadable": pick the folder again); other browsers may
 * still return the old text, so the page also offers a re-pick.
 * Returns { state: 'unchanged' | 'changed' | 'unknown' | 'unreadable', text }.
 */
export async function checkManifest(index, last) {
  let text;
  try {
    text = await index.manifest.text();
  } catch (err) {
    return { state: 'unreadable', text: null, error: err };
  }
  if (last == null) return { state: 'unknown', text };
  return { state: canonManifest(text) === canonManifest(last) ? 'unchanged' : 'changed', text };
}

/** Data rows in a manifest text (comments and blank lines skipped) — a progress estimate. */
export const manifestRowCount = (text) => precheckManifest(text).rows;

// ---- manifest pre-check -------------------------------------------------------

/** Minimal RFC 4180 parse (quotes, "" escapes, CRLF). Returns rows of cells. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Check the manifest before creating the import: required columns and the
 * per-import row / design limits. Lines starting with # are comments (the
 * example template's rows). Returns { rows, families, problems: [string] }.
 */
export function precheckManifest(text, limits = DEFAULT_LIMITS) {
  const problems = [];
  const all = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  const lines = all.filter((r) => !String(r[0] || '').trim().startsWith('#'));
  if (!lines.length) return { rows: 0, families: 0, problems: ['manifest.csv is empty.'] };
  const header = lines[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) problems.push(`manifest.csv is missing the column(s): ${missing.join(', ')}.`);
  const data = lines.slice(1);
  const fi = header.indexOf('family_name');
  const families = new Set(
    fi < 0 ? [] : data.map((r) => String(r[fi] || '').trim().toLowerCase()).filter(Boolean),
  );
  if (!data.length) problems.push('manifest.csv has no rows.');
  if (data.length > limits.max_rows) {
    problems.push(
      `${data.length} rows — one import takes at most ${limits.max_rows}. Split the batch into several imports.`,
    );
  }
  if (families.size > limits.max_families) {
    problems.push(
      `${families.size} designs — one import takes at most ${limits.max_families}. Split the batch into several imports.`,
    );
  }
  return { rows: data.length, families: families.size, problems };
}

// ---- the /files payload -------------------------------------------------------

const EXT_TYPES = {
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

function typeFromName(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXT_TYPES[ext] || 'application/octet-stream';
}

export function contentTypeOf(file) {
  return file.type || typeFromName(file.name);
}

/**
 * Client-side limits over the rows about to be checked: total files / bytes
 * per import (bundle contents, uncompressed), and design JSON size per row.
 * Returns problems: [string].
 */
export async function precheckFiles(index, items, limits, opts) {
  await readBundles(index, items, opts);
  const problems = [];
  let count = 0;
  let bytes = 0;
  const bigJson = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const { files, design } = await readBundle(index, item.folder, opts);
    if (design && design.size > limits.max_content_bytes) bigJson.push(item.line ?? item.row);
    files.forEach((f) => {
      if (f === design) return;
      count += 1;
      bytes += f.size;
    });
  }
  if (count > limits.max_files) {
    problems.push(`${count} files — one import takes at most ${limits.max_files}. Split the batch.`);
  }
  if (bytes > limits.max_total_bytes) {
    problems.push(
      `${fmtBytes(bytes)} of files (unzipped) — one import takes at most ${fmtBytes(limits.max_total_bytes)}. Split the batch.`,
    );
  }
  if (bigJson.length) {
    problems.push(
      `Design JSON over ${fmtBytes(limits.max_content_bytes)} on manifest line(s) ${bigJson.join(', ')} — slim it down or move those rows to another import.`,
    );
  }
  return problems;
}

/**
 * One row of the /files body: its bundle's file list + the design JSON's text.
 * An unreadable bundle goes up with no files, so the server marks just that
 * row invalid instead of leaving it awaiting_files.
 */
export async function buildFilesRow(index, item, opts) {
  const bundle = await readBundle(index, item.folder, opts);
  let content = '';
  if (bundle.design) {
    try {
      const getFile = await openBundle(index, item.folder);
      // Blob.text() drops a UTF-8 BOM, which a JSON parser would refuse.
      content = await (await getFile(bundle.design)).text();
    } catch (err) {
      const problem = err instanceof RowError ? err.message : zipErrorText(bundle.design.path, err);
      index.bundles.set(bundleKey(index, item.folder), failedBundle(problem));
      return { row: item.row, files: [], content: '' };
    }
  }
  return {
    row: item.row,
    content,
    files: bundle.files.map(({ name, size, content_type }) => ({ name, size, content_type })),
  };
}

/**
 * Split rows into /files calls: at most `chunk` rows each, and a soft cap on
 * the design JSON text per call so one request never gets huge.
 */
export function chunkRows(items, chunk, maxBytes = 8 * 1024 * 1024, sizeOf = () => 0) {
  const out = [];
  let cur = [];
  let curBytes = 0;
  items.forEach((item) => {
    const b = sizeOf(item);
    if (cur.length && (cur.length >= chunk || curBytes + b > maxBytes)) {
      out.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(item);
    curBytes += b;
  });
  if (cur.length) out.push(cur);
  return out;
}

export async function designJsonSize(index, item, opts) {
  return (await readBundle(index, item.folder, opts)).design?.size || 0;
}

/**
 * After a re-pick: rows (not yet completed) whose files no longer match what
 * the server was told — by name and uncompressed size. Returns
 * [{ row, key (rowKey), line, problem }].
 */
export async function mismatchedRows(index, items, opts) {
  const out = [];
  const pending = items.filter(isUploadable);
  await readBundles(index, pending, opts);
  for (const item of pending) {
    // eslint-disable-next-line no-await-in-loop
    const bundle = await readBundle(index, item.folder, opts);
    const local = new Map(bundle.files.map((f) => [f.name, f]));
    const bad = (item.files || []).filter((f) => {
      const l = local.get(f.name);
      return !l || (f.size != null && l.size !== Number(f.size));
    });
    if (bundle.failed || bad.length) {
      out.push({
        row: item.row,
        key: rowKey(item),
        line: item.line,
        problem: bundle.failed
          ? bundle.problems[0]
          : `${bad.length} file(s) missing or changed: ${bad
              .slice(0, 3)
              .map((f) => f.name)
              .join(', ')}${bad.length > 3 ? '…' : ''}`,
      });
    }
  }
  return out;
}

// ---- retry ------------------------------------------------------------------------

export const RETRY_DELAYS = [1000, 2000, 4000, 8000];

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** API errors worth another try: the network, a timeout, or a busy server. */
export function isRetryableApiError(err) {
  const s = err?.status;
  return s === 'FETCH_ERROR' || s === 'TIMEOUT_ERROR' || s === 429 || s === 502 || s === 503 || s === 504;
}

/** S3 PUT errors worth another try: network (no status) or a 5xx. Never 403. */
const isRetryablePut = (err) => !err?.s3Status || err.s3Status >= 500;

/** Run `fn`, retrying retryable failures after ≈1 s, 2 s, 4 s, 8 s. */
export async function withRetry(fn, { isRetryable = isRetryableApiError, signal, delays = RETRY_DELAYS } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw abortError();
      if (!isRetryable(err) || attempt >= delays.length) throw err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(delays[attempt], signal);
    }
  }
}

/** A readable line for any failure (API envelope, S3, or plain Error). */
export function errorText(err, fallback = 'Something went wrong') {
  if (err?.status === 'FETCH_ERROR') return 'Network error — could not reach the server.';
  return uploadErrorText(err, fallback);
}

// ---- the upload runner ------------------------------------------------------------

class RowError extends Error {}

const MAX_ROUNDS = 4; // presign rounds per row (403 expiry / failed_stage upload)

/**
 * Upload rows: for each, presign → PUT every file not yet in storage →
 * complete. `rowConcurrency` rows at a time, `fileConcurrency` PUTs at a time
 * overall (a multipart file counts as one; it runs its own parts).
 *
 * calls:
 *   presign(row)  → Promise<{ files, already_uploaded, template_uid }>
 *   complete(row) → Promise<{ stage, result, failed_stage, errors, warnings }>
 *   initiate / presignParts / multipartComplete — RTK triggers (`.unwrap()`)
 *     for the existing /admin/uploads/multipart flow.
 * sessions: Map kept by the caller across runs, so a resumed multipart only
 *   re-sends the parts it is missing (keyed `${rowKey}/${file name}`).
 * on: (`key` is rowKey(item) — the folder, never the row number)
 *   rowState(key, state, message?)  state: running | done | error | idle
 *   rowProgress(key, { sent, total, filesDone, filesTotal })
 *   authEnded() — a 401 survived the token refresh: the session is over.
 *
 * Returns { done: Promise, stop() }. stop() aborts in-flight PUTs; rows that
 * were mid-way report `idle` and continue from their server stage next run.
 */
export function createUploadRunner({
  index,
  items,
  calls,
  sessions = new Map(),
  rowConcurrency = 3,
  fileConcurrency = 5,
  on = {},
}) {
  const controller = new AbortController();
  const { signal } = controller;
  const xhrs = new Set();
  const registerXhr = (xhr) => {
    xhrs.add(xhr);
    xhr.addEventListener('loadend', () => xhrs.delete(xhr));
  };

  // A shared slot pool for file PUTs across all rows.
  let slots = fileConcurrency;
  const waiters = [];
  const acquire = () => {
    if (signal.aborted) return Promise.reject(abortError());
    if (slots > 0) {
      slots -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
  const release = () => {
    const w = waiters.shift();
    if (w) w.resolve();
    else slots += 1;
  };
  signal.addEventListener('abort', () => {
    waiters.splice(0).forEach((w) => w.reject(abortError()));
    xhrs.forEach((x) => x.abort());
  });

  const apiRetry = { signal };

  async function uploadOne(entry, getFile, rowCtx) {
    await acquire();
    try {
      if (signal.aborted) throw abortError();
      // Inflated only now, inside the slot, and dropped when this returns.
      const file = await getFile(entry.name);
      if (signal.aborted) throw abortError();
      const report = (loaded) => {
        rowCtx.loaded.set(entry.name, loaded);
        rowCtx.emit();
      };
      if (entry.upload_method === 'multipart') {
        const key = `${rowCtx.key}/${entry.name}`;
        if (!sessions.has(key)) sessions.set(key, {});
        const contentType =
          entry.content_type ||
          entry.required_headers?.['Content-Type'] ||
          entry.required_headers?.['content-type'] ||
          contentTypeOf(file);
        await withRetry(
          () =>
            uploadMultipart({
              file,
              target: entry.target,
              contentType,
              session: sessions.get(key),
              initiate: calls.initiate,
              presignParts: calls.presignParts,
              complete: calls.multipartComplete,
              // No /admin/uploads/confirm: the row's complete activates them.
              onProgress: (frac) => report(frac * file.size),
              registerXhr,
              shouldAbort: () => signal.aborted,
            }),
          { signal, isRetryable: (e) => isRetryableApiError(e) || (!e?.status && isRetryablePut(e) && !e?.fatal && !e?.rejected) },
        );
        sessions.delete(key);
      } else {
        await withRetry(
          () => {
            report(0);
            // EXACTLY the signed headers — the URL is bound to them.
            return putWithProgress(entry.upload_url, file, entry.required_headers || {}, {
              onProgress: (loaded) => report(loaded),
              registerXhr,
            });
          },
          { signal, isRetryable: isRetryablePut },
        );
      }
      report(file.size);
      rowCtx.filesDone += 1;
      rowCtx.emit();
    } finally {
      release();
    }
  }

  async function processRow(item) {
    const { row } = item;
    const { files: localFiles, failed, problems } = await readBundle(index, item.folder, { signal });
    if (failed) throw new RowError(problems[0]);
    const local = new Map(localFiles.map((f) => [f.name, f]));
    // Opened once, on the first file of this row that needs uploading.
    let opened = null;
    const getFile = async (name) => {
      opened = opened || openBundle(index, item.folder);
      return (await opened)(local.get(name));
    };
    const key = rowKey(item);
    const rowCtx = {
      row,
      key,
      loaded: new Map(),
      total: 0,
      filesDone: 0,
      filesTotal: 0,
      emit() {
        let sent = 0;
        this.loaded.forEach((b) => {
          sent += b;
        });
        on.rowProgress?.(key, {
          sent: Math.min(sent, this.total),
          total: this.total,
          filesDone: this.filesDone,
          filesTotal: this.filesTotal,
        });
      },
    };

    for (let round = 1; ; round += 1) {
      // Ask right before uploading THIS row — URLs expire in 15 minutes.
      // eslint-disable-next-line no-await-in-loop
      const p = await withRetry(() => calls.presign(row), apiRetry);
      const already = new Set(p?.already_uploaded || []);
      const todo = (p?.files || []).filter((f) => !already.has(f.name));

      const missing = todo.filter((f) => !local.get(f.name));
      const changed = todo.filter(
        (f) => local.get(f.name) && f.size != null && local.get(f.name).size !== Number(f.size),
      );
      if (missing.length || changed.length) {
        const names = [...missing, ...changed].map((f) => f.name);
        throw new RowError(
          `${names.length} file(s) not found or changed on disk (${names.slice(0, 3).join(', ')}${
            names.length > 3 ? '…' : ''
          }) — pick the same folder again.`,
        );
      }

      rowCtx.loaded = new Map();
      rowCtx.total = todo.reduce((s, f) => s + local.get(f.name).size, 0);
      rowCtx.filesDone = 0;
      rowCtx.filesTotal = todo.length;
      rowCtx.emit();

      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.allSettled(todo.map((f) => uploadOne(f, getFile, rowCtx)));
      if (signal.aborted) throw abortError();
      const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
      const expired = failures.some((e) => e?.s3Status === 403);
      const other = failures.find((e) => e?.s3Status !== 403);
      if (other) throw other;
      if (expired) {
        // URL expired (or the body differs): presign again; only files not
        // yet in storage are signed.
        if (round < MAX_ROUNDS) continue;
        throw new RowError('S3 kept refusing the upload (URL expired or the file changed).');
      }

      // eslint-disable-next-line no-await-in-loop
      const c = await withRetry(() => calls.complete(row), apiRetry);
      if (c?.stage === 'failed' && c?.failed_stage === 'upload' && round < MAX_ROUNDS) continue;
      return c;
    }
  }

  const queue = [...items];
  let authOver = false;

  async function worker() {
    while (queue.length && !signal.aborted) {
      const item = queue.shift();
      const key = rowKey(item);
      on.rowState?.(key, 'running');
      try {
        // eslint-disable-next-line no-await-in-loop
        const c = await processRow(item);
        // A server-side failure carries its reasons in the row's errors[].
        on.rowState?.(key, c?.stage === 'failed' ? 'error' : 'done');
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          on.rowState?.(key, 'idle');
          return;
        }
        if (err?.status === 401) {
          // The refresh in baseQuery already failed — the session is over.
          if (!authOver) {
            authOver = true;
            on.authEnded?.();
          }
          controller.abort();
          on.rowState?.(key, 'idle');
          return;
        }
        on.rowState?.(key, 'error', errorText(err, 'Upload failed'));
      }
    }
  }

  const done = Promise.all(
    Array.from({ length: Math.max(1, Math.min(rowConcurrency, queue.length)) }, worker),
  ).then(() => undefined);

  return {
    done,
    stop() {
      controller.abort();
    },
  };
}
