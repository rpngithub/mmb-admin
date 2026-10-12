import { imageUrl } from './cdn';

/**
 * Font name previews — a WOFF2 of a few KB holding ONLY the letters of the
 * font's own `family`, stored at fonts.preview_s3_key. Anything other than that
 * exact name renders in the fallback font.
 *
 * Keys never change in place (a rename or new files produce a new key), so a
 * loaded face is cached by key for the life of the tab. The registered family
 * name is derived from the key, not the uid, so an old and a new preview of the
 * same font never collide under one name.
 *
 * Needs a CORS rule on the bucket allowing GET from this origin; until then
 * load() rejects and callers fall back to the UI font.
 */
const cache = new Map(); // key → Promise<string | null>

const faceName = (key) => `mmb-pv-${String(key).replace(/[^a-zA-Z0-9]/g, '-')}`;

export function loadFontPreview(cdnBase, key) {
  if (!key || !cdnBase || typeof FontFace === 'undefined') return Promise.resolve(null);
  if (cache.has(key)) return cache.get(key);

  const name = faceName(key);
  const promise = new FontFace(name, `url("${imageUrl(cdnBase, key)}")`)
    .load()
    .then((face) => {
      document.fonts.add(face);
      return name;
    })
    .catch(() => null);
  cache.set(key, promise);
  return promise;
}

/**
 * Plain-words version of each `reason` the rebuild call returns. The reason is
 * NOT stored on the font row — it only exists in the rebuild response.
 * fix: 'yes' (admin can fix by changing files) | 'retry' | 'no' (expected).
 */
export const PREVIEW_REASONS = {
  no_readable_file: {
    label: 'Only WOFF2 files',
    detail: 'Previews are cut from the TTF, OTF or WOFF file. Add the TTF (the app needs it anyway).',
    fix: 'yes',
  },
  cff_unsupported: {
    label: 'OTF with CFF outlines',
    detail: 'The server cannot cut CFF outlines. Add a TTF version of the regular weight.',
    fix: 'yes',
  },
  no_truetype_outlines: {
    label: 'No TrueType outlines',
    detail: 'Same cause as CFF outlines. Add a TTF.',
    fix: 'yes',
  },
  collection: {
    label: 'Font collection (.ttc)',
    detail: 'Upload the single TTF instead of the collection.',
    fix: 'yes',
  },
  woff2_input: {
    label: 'Mislabelled WOFF2',
    detail: 'A file labelled TTF/OTF/WOFF is really WOFF2. Re-upload it with the correct format.',
    fix: 'yes',
  },
  not_a_font: {
    label: 'Not a font / damaged',
    detail: 'The file is not a font or is damaged. Re-upload it.',
    fix: 'yes',
  },
  source_unavailable: {
    label: 'File unreadable',
    detail: 'The file could not be read from storage. Any existing preview was kept. Run the rebuild again.',
    fix: 'retry',
  },
  error: {
    label: 'Unexpected error',
    detail: 'Run the rebuild again. If it repeats, report this font to the API team.',
    fix: 'retry',
  },
  name_not_covered: {
    label: "Can't draw its own name",
    detail: 'e.g. a Tamil-only font with a Latin name. Expected — the name shows in the UI font.',
    fix: 'no',
  },
  needs_shaping: {
    label: 'Script needs shaping',
    detail:
      'The name is in a script that needs shaping (Devanagari, Tamil, Arabic, Thai…), which a cut file cannot do. Expected.',
    fix: 'no',
  },
  no_unicode_cmap: {
    label: 'No character map',
    detail: 'Usually a symbol or icon font. Nothing to fix.',
    fix: 'no',
  },
};

export function describePreviewReason(reason) {
  return (
    PREVIEW_REASONS[reason] || {
      label: reason || 'Unknown',
      detail: 'No description for this reason yet.',
      fix: 'retry',
    }
  );
}
