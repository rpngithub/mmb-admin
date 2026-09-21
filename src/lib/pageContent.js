/**
 * Shared vocabulary for the Page Content screen — the marketing copy shown
 * BELOW the template grid on each industry's website page ("Why Choose Make My
 * Brand?" cards, the "Content Ideas" chips, the "Business Growth" steps).
 *
 * A block (a "section") exists at one of two levels:
 *
 *   DEFAULT    business_category_id = null   Shown on EVERY industry page that
 *                                            has not made its own copy.
 *   OVERRIDE   business_category_id = <id>   That industry's own copy of ONE
 *                                            block. Wins over the default for
 *                                            that block on that page only.
 *
 * Resolution is per block, not all-or-nothing. Copy may carry {{industry}} /
 * {{industry_lower}}, which the server fills in per page — that is what makes
 * ONE default row correct on ~100 industry pages.
 */

// The API returns flags as 1/0, "1"/"0" or true/false depending on the endpoint.
export const isTrue = (v) => v === true || v === 1 || v === '1';

/** Always "industry" today; sent on every call so a second page can be added later. */
export const PAGE_KEY = 'industry';

/** The two tokens the server substitutes per page. */
export const TOKENS = [
  { name: 'industry', example: 'Travel & Tourism' },
  { name: 'industry_lower', example: 'travel & tourism' },
];

export const TOKEN_HELP =
  "Use {{industry}} for the industry name. The website fills it in per page — e.g. 'Travel & Tourism'.";

export const ITEM_SHAPE_HINT = 'Chips use only the title. Cards use title, description and icon.';

/**
 * The website's rendering keys it is being built against. Offered as
 * suggestions on create; free text is allowed so the website can add a block
 * without an API release.
 */
export const SECTION_KEY_SUGGESTIONS = [
  { value: 'hero_section', hint: 'the hero section' },
  { value: 'why_choose', hint: 'the six feature cards' },
  { value: 'content_ideas', hint: 'the chip list' },
  { value: 'business_growth', hint: 'the four numbered steps' },
  { value: 'brand_series', hint: 'the brand series section' },
  { value: 'start_creating', hint: 'the start creating section' },
];

/** Lowercase letters, digits, underscores; max 50. The API does NOT lowercase it. */
export const SECTION_KEY_PATTERN = /^[a-z0-9_]+$/;
export const SECTION_KEY_MAX = 50;

/** Image slots for the presign flow. */
export const SECTION_IMAGE_SLOT = 'page_section_image';
export const ITEM_ICON_SLOT = 'page_section_item_icon';

/** Section fields an admin writes; a 400's details[] pins to these. */
export const SECTION_FORM_FIELDS = ['section_key', 'eyebrow', 'heading', 'subheading', 'image_s3_key'];

/** Item fields an admin writes. */
export const ITEM_FORM_FIELDS = ['title', 'body', 'icon_s3_key', 'link_url'];

export const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) || (a.id ?? 0) - (b.id ?? 0);

/** Items of a section, in display order. */
export function sectionItems(section) {
  return [...(section?.items || [])].sort(orderCmp);
}

/**
 * A hide-only override: created by "Hide on this page" with just the key and
 * is_active 0 — no heading, no items. Un-hiding one means DELETING it so
 * inheritance resumes; PATCHing is_active 1 would publish an EMPTY block in
 * place of the default. A hidden row that DOES carry content is a real custom
 * copy someone switched off, and comes back with a PATCH.
 */
export function isBlankOverride(row) {
  if (!row) return false;
  const hasHeading = String(row.heading ?? '').trim() !== '';
  const hasItems = Array.isArray(row.items) && row.items.length > 0;
  return !hasHeading && !hasItems;
}

/** The preview endpoint's sections, whichever way it wraps them. */
export function previewSections(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.sections)) return data.sections;
  return [];
}

/** Move an array item from `from` to `to`, returning a new array. */
export function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** '' → null: the only way to clear an optional text field on PATCH. */
export const nullableText = (v) => {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
};

/** Flatten an error into one line — for toasts raised outside a form. */
export function errorText(err, fallback) {
  const details = Array.isArray(err?.details) ? err.details : [];
  return (
    [err?.message, details.map((d) => d.message).join(' ')].filter(Boolean).join(' — ') || fallback
  );
}

/**
 * Push a backend error onto a form: details[] rows naming a known field pin to
 * it; whatever is left is returned as the form-level message.
 */
export function applyServerError(form, err, formFields, fallback = 'Could not save.') {
  const details = Array.isArray(err?.details) ? err.details : [];
  const mapped = details.filter((d) => formFields.includes(d.field));
  if (mapped.length) {
    form.setFields(mapped.map((d) => ({ name: d.field, errors: [d.message] })));
    const rest = details.filter((d) => !formFields.includes(d.field));
    return rest.length ? rest.map((d) => d.message).join(' ') : null;
  }
  return errorText(err, fallback);
}

/**
 * The fields of `next` whose value differs from `before` — a PATCH is partial,
 * and an empty one is a 400.
 */
export function diffBody(next, before) {
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    const prev = before[k];
    const a = v === undefined ? null : v;
    const b = prev === undefined ? null : prev;
    if (a !== b) out[k] = v;
  }
  return out;
}
