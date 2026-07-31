/**
 * CSV template download for the bulk-import feature.
 *
 * The template endpoint returns raw `text/csv` (NOT the JSON success envelope),
 * sent as a file download and requiring the `Authorization: Bearer` header. That
 * combination doesn't fit a normal RTK Query JSON query, so this uses a plain
 * `fetch` with the auth header, reads `res.blob()`, and triggers a browser file
 * download. On error the body IS the JSON error envelope, which we parse to
 * surface `error.message`.
 */

// Mirror baseQuery's API_ROOT so auth + base URL stay in sync.
const API_ROOT = `${import.meta.env.VITE_API_BASE || 'http://localhost:3000'}/api/v1`;

/**
 * Parse the download filename out of a Content-Disposition header, tolerating
 * both `filename="..."` and RFC 5987 `filename*=UTF-8''...` encodings.
 */
function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/["']/g, '').trim());
    } catch {
      /* fall through */
    }
  }
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1].trim() : null;
}

/** Fallback filename derived the same way the backend names the files. */
function fallbackFilename(entity, example) {
  return example
    ? `${entity}_EXAMPLE_do-not-import.csv`
    : `${entity}_import_template.csv`;
}

/** Save a Blob as a file via a temporary object URL + `<a download>`. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Download a CSV template (or its reference/example variant) for an entity.
 *
 * @param {object} opts
 * @param {string} opts.entity   URL segment: 'industries' | 'template-categories' | 'variants'
 * @param {boolean} [opts.example]  true → the REFERENCE-ONLY example file
 * @param {string} opts.token    admin JWT access token (Bearer)
 * @returns {Promise<void>}  resolves once the download is triggered
 * @throws {Error}  with the backend `error.message` (or a generic message) on failure
 */
export async function downloadTemplate({ entity, example = false, token }) {
  const qs = example ? '?example=1' : '';
  const res = await fetch(`${API_ROOT}/admin/imports/${entity}/template${qs}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    // Error responses are the JSON error envelope — surface error.message.
    let message = `Download failed (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* non-JSON body — keep the generic message */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename =
    filenameFromDisposition(res.headers.get('Content-Disposition')) ||
    fallbackFilename(entity, example);
  saveBlob(blob, filename);
}
