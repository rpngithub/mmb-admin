import { usePublicConfigQuery } from '../features/api/adminApi';

/**
 * Shared vocabulary for template FAMILIES (a design) and their VERSIONS (one
 * language — or none, "text-free" — × one size). The server enforces every rule
 * here; the client copies them only so the admin sees them before a 400/409.
 */

export const STATUS_COLORS = { active: 'green', inactive: 'default', draft: 'gold' };
export const STATUSES = ['active', 'inactive', 'draft'];
export const TEMPLATE_TYPES = ['image', 'video', 'animated'];

export const TEXT_FREE_LABEL = 'Text-free';

export const isTrue = (v) => v === true || v === 1 || v === '1';
// List counters come back as MySQL numbers OR strings.
export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const sizeLabel = (s) =>
  s ? (s.width && s.height ? `${s.name} (${s.width}×${s.height})` : s.name) : '';

export const languageLabel = (l) =>
  l ? (l.native_name && l.native_name !== l.name ? `${l.native_name} (${l.name})` : l.name) : '';

/** The version is text-free when it carries no language. */
export const isTextFree = (v) => v?.language_id === null || v?.language_id === undefined;

/**
 * The family publish gate, in the order the checklist shows it. `field` is the
 * `details[].field` / `readiness[].field` the API uses for that requirement.
 */
export const FAMILY_REQUIREMENTS = [
  { field: 'name', label: 'Name' },
  { field: 'category_id', label: 'Category or at least one industry' },
  { field: 'tag_ids', label: 'At least one tag' },
  { field: 'versions', label: 'Active English (or text-free) version, in any size' },
];

/** The API's `readiness[]` / `details[]` message for the `versions` requirement. */
export const VERSIONS_REQUIREMENT_MESSAGE =
  'An active English version (or a text-free one) is required';

/** `err.details` from a normalized baseQuery error, as "field: message" lines. */
export function detailLines(err) {
  const details = Array.isArray(err?.details) ? err.details : [];
  return details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).filter(Boolean);
}

/**
 * `default_template_size` is an app setting holding a size SLUG, read from the
 * public GET /config feed: the size catalogue cards PREFER when a design has
 * several. It is never a publish requirement. Returns { slug, size } — `size`
 * is the matching row from `sizes`, or null (also when the slug no longer
 * matches any size; cards then just fall back to the lowest size id).
 */
export function useDefaultTemplateSize(sizes) {
  const { data: config, isLoading } = usePublicConfigQuery();
  const slug = config?.default_template_size ? String(config.default_template_size) : '';
  const size = slug ? (sizes || []).find((s) => s.slug === slug) || null : null;
  return { slug, size, isLoading };
}

/** English is the language whose code is `en` (case-insensitive). */
export const findEnglish = (languages) =>
  (languages || []).find((l) => String(l.code || '').toLowerCase() === 'en') || null;

/**
 * Whether the family is text-free, language-based, or still undecided (no
 * versions yet). A family is never mixed — the API rejects that with a 400.
 */
export function familyMode(versions) {
  if (!versions?.length) return 'none';
  return versions.some((v) => !isTextFree(v)) ? 'languages' : 'text_free';
}

/**
 * The language ROW(S) the publish gate needs: English, or text-free for a
 * text-free family. Any size in that row counts — some designs only exist in
 * one format. With no versions yet, both rows apply. Ids; null = text-free.
 */
export function requiredLanguageIds({ versions, englishId }) {
  const mode = familyMode(versions);
  const ids = [];
  if (mode !== 'text_free' && englishId != null) ids.push(englishId);
  if (mode !== 'languages') ids.push(null);
  return ids;
}

export const isRequiredLanguage = (requiredIds, languageId) =>
  requiredIds.some((id) => (id ?? null) === (languageId ?? null));

/**
 * Client-side copy of the family publish gate, used only when the family GET
 * doesn't carry `readiness` (the list rows do; the detail response is not
 * confirmed to). Returns the same [{ field, message }] shape the server uses.
 */
export function computeReadiness({ family, relations, versions, englishId }) {
  if (!family || !relations || !versions) return null;
  const out = [];
  if (!String(family.name || '').trim()) out.push({ field: 'name', message: 'Name is required.' });
  const industries = relations.Industries || relations.BusinessCategories || [];
  if (family.category_id == null && industries.length === 0) {
    out.push({ field: 'category_id', message: 'Pick a category or at least one industry.' });
  }
  if (!(relations.Tags || []).length) {
    out.push({ field: 'tag_ids', message: 'Add at least one tag.' });
  }
  const required = requiredLanguageIds({ versions, englishId });
  const ok = versions.some(
    (v) => v.status === 'active' && isRequiredLanguage(required, v.language_id),
  );
  if (!ok) out.push({ field: 'versions', message: VERSIONS_REQUIREMENT_MESSAGE });
  return out;
}
