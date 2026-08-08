/**
 * Font-file rules for the library screen.
 *
 * THE RULE THAT DRIVES ALL OF THIS: the mobile app is Flutter, and Flutter can
 * only render TTF and OTF — it cannot read woff2. The website wants woff2 because
 * it is far smaller. So every weight needs BOTH:
 *
 *     Regular 400 → regular.woff2 (web) + regular.ttf (app)
 *     Bold    700 → bold.woff2    (web) + bold.ttf    (app)
 *
 * Nothing enforces this server-side, and the failure is silent: a family with
 * only woff2 simply does not exist in the app — no error, the text just renders
 * in the default typeface. So the UI has to be the enforcement.
 */

export const FONT_FORMATS = ['woff2', 'woff', 'ttf', 'otf'];
export const FONT_STYLES = ['normal', 'italic'];
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

// woff2 is what the website loads; ttf/otf are the only things Flutter can read.
const WEB_FORMATS = ['woff2'];
const APP_FORMATS = ['ttf', 'otf'];

export const DEFAULT_WEIGHT = 400;
export const DEFAULT_STYLE = 'normal';

const WEIGHT_LABELS = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

// Longest names first so "extrabold" isn't matched as "bold", "semibold" as
// "bold", or "extralight" as "light".
const WEIGHT_HINTS = [
  ['extrablack', 900],
  ['ultrablack', 900],
  ['extrabold', 800],
  ['ultrabold', 800],
  ['semibold', 600],
  ['demibold', 600],
  ['extralight', 200],
  ['ultralight', 200],
  ['black', 900],
  ['heavy', 900],
  ['bold', 700],
  ['medium', 500],
  ['regular', 400],
  ['normal', 400],
  ['book', 400],
  ['light', 300],
  ['thin', 100],
];

export function weightLabel(weight) {
  return WEIGHT_LABELS[weight] ? `${WEIGHT_LABELS[weight]} ${weight}` : String(weight);
}

export function variantLabel(weight, style) {
  return `${weightLabel(weight)}${style === 'italic' ? ' Italic' : ''}`;
}

/** File extension, lowercased, if it is a format the API accepts. */
export function formatFromFilename(filename = '') {
  const ext = String(filename).split('.').pop()?.toLowerCase();
  return FONT_FORMATS.includes(ext) ? ext : null;
}

/** MIME type for the presign/PUT — browsers often report '' for font files. */
export function contentTypeFor(filename = '') {
  const format = formatFromFilename(filename);
  return format ? `font/${format}` : 'application/octet-stream';
}

/**
 * Best guess at (weight, style) from a filename like "Inter-SemiBoldItalic.woff2".
 * Only a starting point — every row stays editable, because naming is a
 * convention, not a contract.
 */
export function guessVariant(filename = '') {
  const stem = String(filename).replace(/\.[^.]+$/, '').toLowerCase();
  const numeric = stem.match(/(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/);
  const named = WEIGHT_HINTS.find(([hint]) => stem.includes(hint));
  return {
    weight: numeric ? Number(numeric[1]) : named ? named[1] : DEFAULT_WEIGHT,
    style: /italic|oblique/.test(stem) ? 'italic' : DEFAULT_STYLE,
  };
}

const variantKey = (f) => `${f.weight}-${f.style}`;

/**
 * Validate a family's full file set (the PUT is a full replace, so this always
 * sees everything the family will end up with).
 *
 * Returns { errors, warnings, variants }:
 *   errors   block the save — the regular weight is the one the app falls back
 *            to, so a family that fails there is broken in the app outright.
 *   warnings don't block — a bold that's web-only degrades one weight, not the
 *            whole family, and it is a legitimate half-finished state to save.
 *
 * An EMPTY file list is valid: that's how you clear a family's files.
 */
export function checkFontFiles(files = []) {
  const errors = [];
  const warnings = [];

  const groups = new Map();
  files.forEach((f) => {
    const key = variantKey(f);
    if (!groups.has(key)) groups.set(key, { weight: f.weight, style: f.style, files: [] });
    groups.get(key).files.push(f);
  });

  const variants = [...groups.values()]
    .map((g) => ({
      ...g,
      hasWeb: g.files.some((f) => WEB_FORMATS.includes(f.format)),
      hasApp: g.files.some((f) => APP_FORMATS.includes(f.format)),
    }))
    .sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));

  if (files.length === 0) return { errors, warnings, variants };

  const missingKey = files.filter((f) => !f.s3_key);
  if (missingKey.length) {
    errors.push(
      `${missingKey.length} ${missingKey.length === 1 ? 'row has' : 'rows have'} no uploaded file yet.`,
    );
  }

  const seen = new Set();
  files.forEach((f) => {
    const key = `${f.weight}-${f.style}-${f.format}`;
    if (seen.has(key)) {
      errors.push(`Two files claim to be ${variantLabel(f.weight, f.style)} .${f.format}.`);
    }
    seen.add(key);
  });

  const regular = variants.find((v) => v.weight === DEFAULT_WEIGHT && v.style === DEFAULT_STYLE);
  if (!regular) {
    errors.push(
      'No Regular 400 upright file. That is the weight everything falls back to — a family without it is unusable.',
    );
  } else if (!regular.hasWeb || !regular.hasApp) {
    errors.push(
      regular.hasApp
        ? 'Regular 400 has no .woff2 — the website would download the much larger app file.'
        : 'Regular 400 has no .ttf or .otf — the Flutter app cannot read woff2, so this family would silently not exist in the app.',
    );
  }

  variants.forEach((v) => {
    if (v.weight === DEFAULT_WEIGHT && v.style === DEFAULT_STYLE) return;
    if (!v.hasApp) {
      warnings.push(`${variantLabel(v.weight, v.style)} has no .ttf/.otf — missing in the app.`);
    } else if (!v.hasWeb) {
      warnings.push(`${variantLabel(v.weight, v.style)} has no .woff2 — heavier download on the web.`);
    }
  });

  return { errors, warnings, variants };
}

/**
 * Compact verdict for the list column: 'ok' | 'warn' | 'error' | 'empty', plus
 * the reasons, so a family that is silently broken in the app is visible without
 * opening it.
 */
export function summarizeFontFiles(files = []) {
  if (!files.length) return { level: 'empty', reasons: ['No files uploaded yet.'] };
  const { errors, warnings } = checkFontFiles(files);
  if (errors.length) return { level: 'error', reasons: errors };
  if (warnings.length) return { level: 'warn', reasons: warnings };
  return { level: 'ok', reasons: [] };
}
