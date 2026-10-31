/**
 * Shared frame vocabulary + the publish gate, used by both the Frames list and
 * the editor drawer so the two never drift apart.
 *
 * A frame is the branded border a user puts over a design — logo at the top,
 * contact bar along the bottom. Structurally it is a sibling of a Template
 * (category + `content` + draft→active→inactive lifecycle), with ONE thing that
 * makes it unlike every other premium item here: a frame is bought PER FRAME,
 * for its own price. A subscription plan never unlocks one, and there is no
 * frames↔plans relationship in the API — by design. Free or individually paid,
 * nothing in between.
 *
 * Like a template design, a frame is a FAMILY of versions — one per language
 * (or text-free) × template size. The frame keeps the shared fields; each
 * version carries its own `content`, `thumbnail_s3_key` and `status`.
 */

import { isTextFree } from './templateFamilies';

// The API returns flags as 1/0, "1"/"0" or true/false depending on the endpoint.
export const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * `price` and `strike_price` arrive as STRINGS (SQL DECIMAL), so every read has
 * to coerce before comparing or formatting. Returns null for anything unusable.
 */
export function toAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "₹149", or "Free" for zero. */
export function formatPrice(v) {
  const n = toAmount(v);
  if (n === null) return '—';
  if (n === 0) return 'Free';
  return `₹${n.toLocaleString('en-IN')}`;
}

// `active` is spelled "Published" everywhere an operator can see it: only an
// active frame is in the public store, and that is the distinction that matters.
export const STATUS_LABEL = { active: 'Published', draft: 'Draft', inactive: 'Inactive' };
export const STATUS_COLORS = { active: 'green', inactive: 'default', draft: 'gold' };

export const statusLabel = (s) => STATUS_LABEL[s] || s || '—';

export const STATUS_OPTIONS = ['active', 'draft', 'inactive'].map((v) => ({
  label: STATUS_LABEL[v],
  value: v,
}));

// The two tabs users see in the Frames Store.
export const FRAME_TYPES = ['static', 'animated'];
export const FRAME_TYPE_OPTIONS = FRAME_TYPES.map((v) => ({ label: v, value: v }));

export const PREMIUM_OPTIONS = [
  { label: 'Premium', value: 1 },
  { label: 'Free', value: 0 },
];

// ---- Publish gate -----------------------------------------------------------

/**
 * What a frame must have before `status: "active"` is accepted. The server runs
 * the same checklist and rejects the PATCH with 400 VALIDATION_ERROR otherwise,
 * one `error.details[]` entry per unmet requirement — so this is the client's
 * mirror for instant feedback, never the authority.
 *
 * Unpublishing (→ draft/inactive) is NEVER gated: a frame that would no longer
 * pass can still be pulled from the store, and pulling it takes nothing away
 * from users who already added or bought it.
 *
 * `field` — the `details[].field` the publish 400 uses, so a server rejection
 *           maps straight back onto the matching checklist row / form item.
 */
const REQUIREMENTS = [
  {
    key: 'name',
    field: 'name',
    label: 'Name',
    hint: 'Give the frame a name.',
    test: (f) => Boolean(f?.name && String(f.name).trim()),
  },
  {
    key: 'category',
    field: 'category_id',
    label: 'Category',
    // Not bureaucracy: the store is browsed by category chip only, so an
    // uncategorised frame is unreachable even once it is live.
    hint: 'Pick a category — the store is browsed by category, so an uncategorised frame is unreachable.',
    test: (f) => f?.category_id !== null && f?.category_id !== undefined && f?.category_id !== '',
  },
  {
    key: 'pricing',
    field: 'price',
    label: 'Price matches the premium switch',
    hint: 'Premium frames need a price above zero; free frames must be priced at 0.',
    test: (f) => {
      const price = toAmount(f?.price) ?? 0;
      return isTrue(f?.is_premium) ? price > 0 : price === 0;
    },
  },
  {
    key: 'versions',
    field: 'versions',
    label: 'Active English (or text-free) version, in any size',
    hint: 'Publish an English or text-free version on the Versions tab — it needs content and a thumbnail.',
    test: (f) => (f?.versions || []).some(isGateVersion),
  },
];

/** English is the language whose code is `en` (case-insensitive). */
export const isEnglish = (language) => String(language?.code || '').toLowerCase() === 'en';

/**
 * Whether a version counts towards the frame publish gate: active, and
 * English or text-free. Any size counts.
 */
export const isGateVersion = (v) =>
  v?.status === 'active' && (isTextFree(v) || isEnglish(v.Language));

// server `details[].field` → requirement key. `is_premium` maps to the same row
// as `price`: the two are one rule, and the server may blame either side of it.
export const FIELD_TO_KEY = {
  ...Object.fromEntries(REQUIREMENTS.map((r) => [r.field, r.key])),
  is_premium: 'pricing',
};

/**
 * Evaluate every publish requirement against a full frame record
 * (GET /admin/frames/:uid, which carries `versions[]` with their Language).
 *
 * Returns `complete: false` while the record is still loading, so a publish
 * button bound to it never flashes enabled before the data lands.
 */
export function checkFrameCompleteness(full) {
  const loading = !full;
  const items = REQUIREMENTS.map((r) => ({
    key: r.key,
    field: r.field,
    label: r.label,
    hint: r.hint,
    ok: loading ? false : Boolean(r.test(full)),
  }));
  const missing = items.filter((i) => !i.ok);
  return { items, missing, complete: !loading && missing.length === 0, loading };
}

/**
 * Readiness for a LIST row. Rows carry `is_publishable` (a real boolean) and
 * `missing_for_publish` ([{ field, message }]) computed by the same server code
 * path as the gate, so nothing is re-derived here. A row without the flag falls
 * back to the local rules, using `has_required_version` for the versions row —
 * never claiming "Ready" on a guess.
 */
export function rowReadiness(row) {
  if (typeof row?.is_publishable === 'boolean') {
    const missing = Array.isArray(row.missing_for_publish) ? row.missing_for_publish : [];
    return { ready: row.is_publishable, missing: missing.map((m) => m.message).filter(Boolean) };
  }
  const { missing } = checkFrameCompleteness({
    ...row,
    versions: isTrue(row?.has_required_version) ? [{ status: 'active', language_id: null }] : [],
  });
  return { ready: missing.length === 0, missing: missing.map((m) => m.hint) };
}

/**
 * A list row's `languages[]` / `sizes[]` entries — objects (Language /
 * TemplateSize shaped) or plain strings, whichever the API sends.
 */
export const chipText = (x, labelFn) =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : labelFn(x) || x?.code || x?.slug || '';

/** What the move/merge dry-run says happens to the source frame. */
export const OUTCOME_TEXT = {
  unchanged: { color: 'default', text: 'stays as it is' },
  draft: {
    color: 'gold',
    text: 'goes back to draft — it loses the version it needed to stay live',
  },
  archived: { color: 'red', text: 'has no versions left, so it is archived' },
};

/**
 * Push a backend validation/conflict error onto a frame form. Returns the text
 * to show at form level when it couldn't be pinned to a single field.
 *
 * `name` is globally unique (case-insensitive), and its 409 carries no
 * details[] — so it is mapped onto the name field rather than left as a toast.
 */
export function applyFrameServerError(form, err, formFields) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const mapped = details.filter((d) => formFields.includes(d.field));
  if (mapped.length) {
    form.setFields(mapped.map((d) => ({ name: d.field, errors: [d.message] })));
    const rest = details.filter((d) => !formFields.includes(d.field));
    return rest.length ? rest.map((d) => d.message).join(' ') : null;
  }
  if (err?.status === 409) {
    form.setFields([
      { name: 'name', errors: [err.message || 'A frame with this name already exists.'] },
    ]);
    return null;
  }
  return err?.message || 'Could not save the frame.';
}
