/**
 * What a template must have before it may be published (status → active).
 *
 * The create API is metadata-only and the bundle/relations routes need the uid
 * it returns, so none of this can be enforced at create time — the row has to
 * exist first. Publish is therefore the gate (also enforced server-side), and
 * this module is the client's single source of truth: the Publish tab, and the
 * per-row column on the list.
 *
 * `tab`   — the editor tab that fixes the item, so the checklist can link to it.
 * `field` — the `details[].field` the publish 400 uses, so a server rejection
 *           maps straight back onto the matching row.
 */

const has = (list) => Array.isArray(list) && list.length > 0;

// GET /relations returns `Industries` now; `BusinessCategories` is a deprecated
// duplicate the backend still sends. Read the new name, fall back to the old.
const industriesOf = (relations) => relations?.Industries || relations?.BusinessCategories;

const REQUIREMENTS = [
  {
    key: 'name',
    field: 'name',
    label: 'Template name',
    tab: 'details',
    hint: 'Set a name on the Details tab.',
    test: (full) => Boolean(full?.name && String(full.name).trim()),
  },
  {
    key: 'classification',
    field: 'category_id',
    label: 'Category or Industry',
    tab: 'details',
    hint: 'Pick a Category on Details, or at least one Industry on Relations.',
    // Category is a column on the template; Industry is a relation. Either satisfies it.
    test: (full, relations) =>
      full?.category_id !== null && full?.category_id !== undefined
        ? true
        : has(industriesOf(relations)),
  },
  {
    key: 'bundle',
    field: 'content',
    label: 'Bundle uploaded',
    tab: 'bundle',
    hint: 'Upload the designer ZIP on the Bundle tab.',
    test: (full) => Boolean(full?.content),
  },
  {
    key: 'thumbnail',
    field: 'thumbnail_s3_key',
    label: 'Thumbnail',
    tab: 'bundle',
    hint: 'Include an image in the ZIP and pick it as the thumbnail.',
    test: (full) => Boolean(full?.thumbnail_s3_key),
  },
  {
    key: 'sizes',
    field: 'size_ids',
    label: 'At least one size',
    tab: 'relations',
    hint: 'Select one or more sizes on the Relations tab.',
    test: (_full, relations) => has(relations?.TemplateSizes),
  },
  {
    key: 'tags',
    field: 'tag_ids',
    label: 'At least one tag',
    tab: 'relations',
    hint: 'Select one or more tags on the Relations tab.',
    test: (_full, relations) => has(relations?.Tags),
  },
];

// server `details[].field` → requirement key, so a publish 400 lands on its row.
export const FIELD_TO_KEY = Object.fromEntries(REQUIREMENTS.map((r) => [r.field, r.key]));

/**
 * Evaluate every publish requirement against the full template record
 * (GET /admin/templates/:uid) and its relations (GET .../relations).
 *
 * Returns `complete: false` while either payload is still loading, so a publish
 * button bound to it never flashes enabled before the data lands.
 */
export function checkTemplateCompleteness(full, relations) {
  const loading = !full || !relations;
  const items = REQUIREMENTS.map((r) => ({
    key: r.key,
    field: r.field,
    label: r.label,
    tab: r.tab,
    hint: r.hint,
    ok: loading ? false : Boolean(r.test(full, relations)),
  }));
  const missing = items.filter((i) => !i.ok);
  return { items, missing, complete: !loading && missing.length === 0, loading };
}

const isTruthy = (v) => v === true || v === 1 || v === '1';

/**
 * Cheap completeness read for a Template List row, using the count/flag columns
 * the list now returns (tag_count, size_count, industry_count, has_content,
 * has_thumbnail) — no need to fetch each template's full record + relations.
 */
export function checkRowCompleteness(row) {
  const checks = {
    name: Boolean(row?.name && String(row.name).trim()),
    classification:
      (row?.category_id !== null && row?.category_id !== undefined) || (row?.industry_count || 0) > 0,
    bundle: isTruthy(row?.has_content),
    thumbnail: isTruthy(row?.has_thumbnail),
    sizes: (row?.size_count || 0) > 0,
    tags: (row?.tag_count || 0) > 0,
  };
  const missing = REQUIREMENTS.filter((r) => !checks[r.key]).map((r) => r.label);
  return { missing, complete: missing.length === 0 };
}
