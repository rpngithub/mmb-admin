/**
 * Direct-to-S3 upload orchestration, shared by every admin upload. Two flows,
 * picked by size:
 *
 *   - single PUT      (small files) — presign → PUT → confirm
 *   - multipart       (large files) — initiate → presign-parts → PUT parts
 *                                     (capturing each ETag) → complete → confirm
 *
 * The server is size-bound: presign takes `size` (bytes) next to `content_type`
 * and signs the URL for exactly that body, so S3 refuses any other with
 * `403 SignatureDoesNotMatch`. Always presign the FINAL bytes (after any
 * client-side processing). Confirm and multipart complete re-check every file
 * (exists, within its cap, first bytes match its extension) and DELETE the
 * ones that fail — so only keys confirm lists in `keys` may ever be saved.
 *
 * Each call presigns ONE file, so the per-call batch caps (50 non-video files,
 * 10 videos, 2 GB combined → 400 on `files`) are never reached from here.
 *
 * The RTK Query mutation triggers (presign/confirm/initiate/…) are injected by
 * the caller so this stays UI-framework-free and testable. Bytes go browser→S3
 * directly via XHR (XHR, not fetch, so we get upload progress + abort).
 */

export const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // above ~100 MB → multipart
// Only used when initiate returns no part plan (an API from before the
// size-bound presign); the current API picks part_size / part_count itself.
const FALLBACK_PART_SIZE = 8 * 1024 * 1024;
const PART_CONCURRENCY = 4;
const MAX_PART_RETRIES = 3;

// ---- what each target accepts ----------------------------------------------
// The type ↔ extension pairing is the server's rule and is not editable; the
// per-file caps and the allowed type lists are (App Settings → uploads) and
// come back as `limits` on every presign — see checkFile().

const EXT_TYPE = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const KIND_EXTS = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'],
  video: ['mp4', 'm4v', 'webm', 'mov'],
};

const KIND_LABEL = {
  image: { noun: 'Images', types: 'JPG, PNG, WebP, GIF or SVG' },
  video: { noun: 'Videos', types: 'MP4, WebM or MOV' },
};

/** `accept=` for a picker of the given kind (extensions + MIME types). */
export const acceptFor = (kind) =>
  KIND_EXTS[kind]
    ? [...KIND_EXTS[kind].map((e) => `.${e}`), ...new Set(KIND_EXTS[kind].map((e) => EXT_TYPE[e]))].join(',')
    : undefined;

export const IMAGE_ACCEPT = acceptFor('image');
export const VIDEO_ACCEPT = acceptFor('video');

const IMAGE_ASSET_TYPES = new Set(['icon', 'emoji', 'shape', 'bg']);

/**
 * Which server check a presign target gets: 'image', 'video', or null for the
 * unchecked ones (audio / animated assets, font_file, template bundle files).
 */
export function kindForTarget(target) {
  if (!target) return null;
  if (target.type === 'asset') {
    if (target.asset_type === 'video') return 'video';
    return IMAGE_ASSET_TYPES.has(target.asset_type) ? 'image' : null;
  }
  if (target.type === 'image_slot') return target.slot === 'font_file' ? null : 'image';
  return null;
}

const extOf = (name) => (name?.includes('.') ? name.split('.').pop().toLowerCase() : '');

// What some browsers report for types the server knows under another name.
const TYPE_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'video/x-m4v': 'video/mp4',
};

/**
 * The content_type to presign with: for a checked target, the canonical type
 * of the file's extension (so a .m4v the browser calls video/x-m4v goes up as
 * video/mp4); otherwise whatever the browser reported.
 */
export function contentTypeFor(file, target) {
  const kind = kindForTarget(target);
  const canonical = EXT_TYPE[extOf(file.name)];
  if (kind && canonical && KIND_EXTS[kind].includes(extOf(file.name))) return canonical;
  return file.type;
}

export const fmtBytes = (bytes) => {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

// `limits.<kind>.types` is matched as MIME types or bare extensions — whichever
// the entries look like.
function typeListed(types, mime, ext) {
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.some((t) => {
    const v = String(t).toLowerCase().replace(/^\./, '');
    return v.includes('/') ? v === mime : v === ext || EXT_TYPE[v] === mime;
  });
}

/**
 * Validate a picked file against its target before uploading anything.
 * Returns a message to show the admin, or null when it may go ahead. `limits`
 * is the block from the last presign response (null until one has run — the
 * server's presign check is then the first line). The server stays the
 * authority; this only saves a wasted upload.
 */
export function checkFile(file, kind, limits) {
  if (!kind || !file) return null;
  const label = KIND_LABEL[kind];
  const ext = extOf(file.name);
  if (!KIND_EXTS[kind].includes(ext)) {
    return `${label.noun} must be ${label.types} — "${file.name}" is not.`;
  }
  // The extension must name the same type the browser reports; a renamed file
  // is a 400 at presign, or deleted at confirm.
  const reported = TYPE_ALIASES[file.type] || file.type;
  if (reported && reported !== EXT_TYPE[ext]) {
    return `"${file.name}" is a ${file.type} file with a .${ext} name — rename or re-export it.`;
  }
  const rule = limits?.[kind];
  if (rule && !typeListed(rule.types, EXT_TYPE[ext], ext)) {
    return `${label.noun} of this type are turned off in App Settings → uploads.`;
  }
  if (rule?.max_bytes && file.size > rule.max_bytes) {
    return `${label.noun} can be at most ${fmtBytes(rule.max_bytes)} — this one is ${fmtBytes(file.size)}.`;
  }
  return null;
}

// ---- errors -----------------------------------------------------------------

export function isAbortError(err) {
  return err?.name === 'AbortError';
}

/**
 * A readable line for a failed step. The upload endpoints' `details[].message`
 * is written to be shown as-is ("file exceeds the 25 MB limit"), and on a 400
 * it is the real cause where the top-level message is generic.
 */
export function uploadErrorText(err, fallback = 'Upload failed') {
  const details = Array.isArray(err?.details) ? err.details.filter((d) => d?.message) : [];
  if (details.length) return [...new Set(details.map((d) => d.message))].join('; ');
  return err?.message || fallback;
}

class UploadError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'UploadError';
    Object.assign(this, extra);
  }
}

// ---- confirm ----------------------------------------------------------------

/**
 * Confirm keys and return the ones that are safe to save. A 200 answers PER
 * KEY: `data.keys` lists the confirmed ones and `results[]` carries
 * `{ key, status:'rejected', reason }` for the rest — already DELETED by the
 * server, so their keys must never be stored. A 400 means every key was
 * rejected; `details[0].message` has the first cause.
 *
 * Resolves `{ keys, rejected: [{ key, reason }] }`.
 */
export async function confirmKeys(confirm, keys) {
  let res;
  try {
    res = await confirm(keys).unwrap();
  } catch (err) {
    if (err?.status === 400) {
      const reason = uploadErrorText(err, 'The upload was rejected — upload it again.');
      return { keys: [], rejected: keys.map((key) => ({ key, reason })) };
    }
    throw err;
  }
  const results = Array.isArray(res?.results) ? res.results : [];
  const byKey = new Map(results.map((r) => [r.key, r]));
  // `keys` is the authority. An API from before this change sends only results.
  const ok = Array.isArray(res?.keys)
    ? new Set(res.keys)
    : new Set(keys.filter((k) => (byKey.get(k)?.status ?? 'confirmed') === 'confirmed'));
  return {
    keys: keys.filter((k) => ok.has(k)),
    rejected: keys
      .filter((k) => !ok.has(k))
      .map((key) => ({
        key,
        reason: byKey.get(key)?.reason || 'The upload was rejected — upload it again.',
      })),
  };
}

async function confirmOne(confirm, key) {
  const { keys, rejected } = await confirmKeys(confirm, [key]);
  if (!keys.includes(key)) {
    throw new UploadError(rejected[0]?.reason || 'The upload was rejected — upload it again.', {
      rejected: true,
    });
  }
}

// ---- transport ----------------------------------------------------------------

/**
 * PUT a body to a presigned URL with progress + abort. `registerXhr(xhr)` lets
 * the caller keep handles to abort in-flight requests (several at once for
 * multipart). Resolves with the response ETag (needed for multipart complete).
 * A 403 is flagged — from a size-bound URL it is SignatureDoesNotMatch.
 */
function putWithProgress(url, body, headers, { onProgress, registerXhr } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag'), status: xhr.status });
      } else {
        reject(
          new UploadError(
            xhr.status === 403
              ? 'S3 refused the file (signature mismatch) — it changed after it was presigned.'
              : `Upload failed (HTTP ${xhr.status})`,
            { s3Status: xhr.status },
          ),
        );
      }
    };
    xhr.onerror = () => reject(new UploadError('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    registerXhr?.(xhr);
    xhr.send(body);
  });
}

// ---- single PUT ---------------------------------------------------------------

/**
 * Small file: single presigned PUT. `target` is the presign target object
 * (e.g. { type:'asset', asset_type } or { type:'image_slot', slot }).
 * `confirm` is optional — pass it for everything that flips pending→active via
 * uploads/confirm; omit it for the template bundle, which finalizes all
 * objects together via bundle/confirm. `contentType` overrides an empty
 * `file.type` (font files); it defaults to the canonical type of the file's
 * extension on checked targets. Returns the confirmed key.
 */
export async function uploadSingle({
  file,
  target,
  contentType = contentTypeFor(file, target),
  presign,
  confirm,
  onProgress,
  registerXhr,
}) {
  const presignOnce = () =>
    presign({ target, filename: file.name, content_type: contentType, size: file.size }).unwrap();
  const put = ({ upload_url, required_headers }) =>
    putWithProgress(
      upload_url,
      file,
      { 'Content-Type': contentType, ...(required_headers || {}) },
      { onProgress: (loaded, total) => onProgress?.(total ? loaded / total : 0), registerXhr },
    );

  let p = await presignOnce();
  try {
    await put(p);
  } catch (err) {
    // SignatureDoesNotMatch: the body differs from what was presigned. Presign
    // the file as it is now and try exactly once more.
    if (err?.s3Status !== 403) throw err;
    p = await presignOnce();
    await put(p);
  }

  if (confirm) await confirmOne(confirm, p.key);
  return p.key;
}

// ---- multipart ----------------------------------------------------------------

function resetSession(session) {
  session.key = null;
  session.upload_id = null;
  session.part_size = null;
  session.part_count = null;
  session.etags = {};
}

/**
 * Large file: resumable multipart. `session` is a mutable object the caller
 * keeps across retries ({ key, upload_id, part_size, part_count, etags }), so a
 * retry only re-uploads the parts that are still missing. The server picks the
 * part plan from `size`; parts go up PART_CONCURRENCY at a time. Returns the
 * (confirmed, when `confirm` is given) key.
 *
 * Once complete has run the upload id is spent — whatever happens next, a retry
 * starts over, so the session is reset at that point.
 */
export async function uploadMultipart({
  file,
  target,
  contentType = contentTypeFor(file, target),
  session,
  initiate,
  presignParts,
  complete,
  confirm,
  onProgress,
  onPart,
  registerXhr,
  shouldAbort,
}) {
  // 1. initiate once (reused on retry); the server chooses the part plan
  if (!session.key || !session.upload_id) {
    const res = await initiate({
      target,
      filename: file.name,
      content_type: contentType,
      size: file.size,
    }).unwrap();
    session.key = res.key;
    session.upload_id = res.upload_id;
    session.part_size = res.part_size || FALLBACK_PART_SIZE;
    session.part_count = res.part_count || Math.ceil(file.size / session.part_size);
    session.etags = {};
  }
  if (!session.etags) session.etags = {};

  const { part_size: partSize, part_count: totalParts } = session;
  const partBytes = (n) => (n < totalParts ? partSize : file.size - partSize * (totalParts - 1));

  // bytes already done (parts whose ETag we have from a previous attempt)
  let doneBytes = 0;
  for (let i = 1; i <= totalParts; i += 1) if (session.etags[i]) doneBytes += partBytes(i);
  const inFlight = new Map(); // part → bytes sent so far
  const report = () => {
    let sent = doneBytes;
    inFlight.forEach((b) => {
      sent += b;
    });
    onProgress?.(Math.min(1, sent / file.size));
  };

  const pending = [];
  for (let i = 1; i <= totalParts; i += 1) if (!session.etags[i]) pending.push(i);

  // Part URLs are signed for each part's exact length — send the same size.
  const signParts = async (numbers) => {
    const { parts } = await presignParts({
      key: session.key,
      upload_id: session.upload_id,
      part_numbers: numbers,
      size: file.size,
    }).unwrap();
    return new Map(parts.map((p) => [p.part_number, p]));
  };

  if (pending.length) {
    const signed = await signParts(pending);
    let completedParts = totalParts - pending.length;
    const queue = [...pending];

    const uploadPart = async (partNumber) => {
      const start = (partNumber - 1) * partSize;
      const length = signed.get(partNumber)?.size ?? partBytes(partNumber);
      const blob = file.slice(start, start + length);

      for (let attempt = 1; ; attempt += 1) {
        if (shouldAbort?.()) throw new DOMException('Upload aborted', 'AbortError');
        try {
          // A failed part gets a freshly signed URL for just that part number.
          if (attempt > 1) {
            const again = await signParts([partNumber]);
            signed.set(partNumber, again.get(partNumber));
          }
          inFlight.set(partNumber, 0);
          const { etag } = await putWithProgress(
            signed.get(partNumber).url,
            blob,
            {},
            {
              onProgress: (loaded) => {
                inFlight.set(partNumber, loaded);
                report();
              },
              registerXhr,
            },
          );
          if (!etag) {
            throw new UploadError('Missing ETag — bucket CORS must expose the ETag header.', {
              fatal: true,
            });
          }
          session.etags[partNumber] = etag;
          inFlight.delete(partNumber);
          doneBytes += length;
          completedParts += 1;
          onPart?.({ current: completedParts, total: totalParts });
          report();
          return;
        } catch (err) {
          inFlight.delete(partNumber);
          if (isAbortError(err) || err?.fatal || attempt >= MAX_PART_RETRIES) throw err;
        }
      }
    };

    // A few parts at a time; the first failure stops the others picking up more.
    let failure = null;
    const worker = async () => {
      while (queue.length && !failure) {
        const n = queue.shift();
        try {
          await uploadPart(n);
        } catch (err) {
          failure = failure || err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, worker));
    if (failure) throw failure;
  }

  // 4. complete with every part's ETag — the assembled file is size- and
  // type-checked here and DELETED on a 400, so that is "upload it again".
  const parts = [];
  for (let i = 1; i <= totalParts; i += 1) parts.push({ part_number: i, etag: session.etags[i] });
  const { key } = session;
  try {
    await complete({ key, upload_id: session.upload_id, parts }).unwrap();
  } catch (err) {
    if (err?.status === 400) {
      resetSession(session);
      throw new UploadError(`${uploadErrorText(err)} — upload the file again.`, { rejected: true });
    }
    throw err;
  }
  resetSession(session);

  if (confirm) await confirmOne(confirm, key);
  return key;
}

/**
 * Upload one file by the right flow for its size. `session` is only used (and
 * required) for multipart.
 */
export function uploadFile({ file, ...rest }) {
  return file.size > MULTIPART_THRESHOLD
    ? uploadMultipart({ file, ...rest })
    : uploadSingle({ file, ...rest });
}

// ---- local file probing -------------------------------------------------------

/**
 * Read width/height (and, for a video, duration plus a still frame) from a
 * picked file in the browser. The server cannot decode media, so these are
 * the only source of the asset's width/height/duration_ms. Never throws:
 * `decodable:false` on a video means this browser cannot play it (typically
 * HEVC on Windows Chrome) — the upload still succeeds, but it shows black.
 */
export async function probeMedia(file, kind) {
  const base = { bytes: file.size, content_type: file.type || null };
  if (kind === 'image') {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      return { ...base, width: img.naturalWidth || null, height: img.naturalHeight || null };
    } catch {
      return base;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (kind !== 'video') return base;

  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  const waitFor = (event, ms = 15000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      v.addEventListener(event, () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
      v.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('decode'));
      }, { once: true });
    });
  try {
    v.src = url;
    await waitFor('loadeddata');
    const meta = {
      ...base,
      width: v.videoWidth || null,
      height: v.videoHeight || null,
      duration_ms: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null,
    };
    // Audio-only or an undecodable video track: no picture to show.
    if (!v.videoWidth) return { ...meta, decodable: false };

    // A very short (or unknown-length) clip is drawn from where it already is
    // — seeking to the current position need not fire `seeked`.
    const at = Math.min(1, (v.duration || 0) / 2);
    if (at > 0) {
      v.currentTime = at;
      await waitFor('seeked');
    }
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const frame = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return { ...meta, decodable: true, frame };
  } catch {
    return { ...base, decodable: false };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
