/**
 * Direct-to-S3 asset upload orchestration (Design B). Two flows, picked by size:
 *
 *   - single PUT      (small files) — presign → PUT → confirm
 *   - multipart       (large files) — initiate → presign-parts → PUT parts
 *                                     (capturing each ETag) → complete → confirm
 *
 * The RTK Query mutation triggers (presign/confirm/initiate/…) are injected by
 * the caller so this stays UI-framework-free and testable. Bytes go browser→S3
 * directly via XHR (XHR, not fetch, so we get upload progress + abort).
 */

export const MULTIPART_THRESHOLD = 10 * 1024 * 1024; // 10 MB → switch to multipart
export const PART_SIZE = 8 * 1024 * 1024; // 8 MB per part (S3 min is 5 MB, except last)
const MAX_PART_RETRIES = 3;

export function isAbortError(err) {
  return err?.name === 'AbortError';
}

/**
 * PUT a body to a presigned URL with progress + abort. `registerXhr(xhr)` lets
 * the caller keep a handle to abort the in-flight request. Resolves with the
 * response ETag (needed for multipart complete).
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
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    registerXhr?.(xhr);
    xhr.send(body);
  });
}

/**
 * Small file: single presigned PUT. `target` is the presign target object
 * (e.g. { type:'asset', asset_type } or { type:'template_file', template_uid }).
 * `confirm` is optional — pass it for the asset flow (uploads/confirm flips
 * pending→active); omit it for the template bundle, which finalizes all objects
 * together via bundle/confirm. Returns the object key.
 */
export async function uploadSingle({ file, target, presign, confirm, onProgress, registerXhr }) {
  const { key, upload_url, required_headers } = await presign({
    target,
    filename: file.name,
    content_type: file.type,
  }).unwrap();

  await putWithProgress(
    upload_url,
    file,
    { 'Content-Type': file.type, ...(required_headers || {}) },
    { onProgress: (loaded, total) => onProgress?.(total ? loaded / total : 0), registerXhr },
  );

  if (confirm) await confirm([key]).unwrap();
  return key;
}

/**
 * Large file: resumable multipart. `session` is a mutable object the caller
 * keeps across retries ({ key, upload_id, etags }), so a retry only re-uploads
 * the parts that are still missing. Returns the confirmed key.
 */
export async function uploadMultipart({
  file,
  target,
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
  // 1. initiate once (reused on retry)
  if (!session.key || !session.upload_id) {
    const res = await initiate({
      target,
      filename: file.name,
      content_type: file.type,
    }).unwrap();
    session.key = res.key;
    session.upload_id = res.upload_id;
    session.etags = {};
  }
  if (!session.etags) session.etags = {};

  const totalParts = Math.ceil(file.size / PART_SIZE);
  const partBytes = (n) => (n < totalParts ? PART_SIZE : file.size - PART_SIZE * (totalParts - 1));

  // bytes already done (parts whose ETag we have from a previous attempt)
  let baseLoaded = 0;
  for (let i = 1; i <= totalParts; i += 1) if (session.etags[i]) baseLoaded += partBytes(i);

  const pending = [];
  for (let i = 1; i <= totalParts; i += 1) if (!session.etags[i]) pending.push(i);

  if (pending.length) {
    const { parts } = await presignParts({
      key: session.key,
      upload_id: session.upload_id,
      part_numbers: pending,
    }).unwrap();
    const urlByPart = new Map(parts.map((p) => [p.part_number, p.url]));

    for (const partNumber of pending) {
      if (shouldAbort?.()) throw new DOMException('Upload aborted', 'AbortError');
      onPart?.({ current: partNumber, total: totalParts });

      const start = (partNumber - 1) * PART_SIZE;
      const blob = file.slice(start, Math.min(start + PART_SIZE, file.size));
      const url = urlByPart.get(partNumber);

      let attempt = 0;
      // retry a failed part a few times before giving up
      for (;;) {
        try {
          const { etag } = await putWithProgress(
            url,
            blob,
            { 'Content-Type': file.type },
            {
              onProgress: (loaded) => onProgress?.(Math.min(1, (baseLoaded + loaded) / file.size)),
              registerXhr,
            },
          );
          if (!etag) {
            throw new Error('Missing ETag — bucket CORS must expose the ETag header.');
          }
          session.etags[partNumber] = etag;
          baseLoaded += partBytes(partNumber);
          onProgress?.(Math.min(1, baseLoaded / file.size));
          break;
        } catch (err) {
          if (isAbortError(err)) throw err;
          attempt += 1;
          if (attempt >= MAX_PART_RETRIES) throw err;
        }
      }
    }
  }

  // 4. complete with every part's ETag, then confirm pending→active
  const completed = [];
  for (let i = 1; i <= totalParts; i += 1) {
    completed.push({ part_number: i, etag: session.etags[i] });
  }
  await complete({ key: session.key, upload_id: session.upload_id, parts: completed }).unwrap();
  if (confirm) await confirm([session.key]).unwrap();
  return session.key;
}
