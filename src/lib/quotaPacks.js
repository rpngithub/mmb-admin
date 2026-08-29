/**
 * Shared top-up vocabulary, used by the Top-up Packs screen, its editor and the
 * Quota Grants tab so the three never drift apart.
 *
 * A plan gives a user an allowance per feature. A TOP-UP PACK is bought outright
 * and adds headroom on top of it. Packs are not tied to plans — there is no
 * packs↔plans relationship in the API, and nothing here builds one.
 *
 * A purchased top-up NEVER expires: it survives the monthly reset and a lapsed
 * subscription. That is the reason unpublishing or deleting a pack is never a
 * clawback — everyone who already bought it keeps their balance.
 *
 * Quantities are in the FEATURE'S OWN UNIT: credits for AI Credits, megabytes
 * for Storage. Never assume "count" — read it off the feature (see `unitFor`).
 */

// The API returns flags as 1/0, "1"/"0" or true/false depending on the endpoint.
export const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * `price` / `strike_price` arrive as STRINGS (SQL DECIMAL), so every read has to
 * coerce before comparing or formatting. Returns null for anything unusable.
 */
export function toAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- Money ------------------------------------------------------------------

/**
 * `price` on a pack is PRE-TAX. The store adds GST at checkout, so a ₹99 pack
 * charges ₹116.82 — an admin who reads the field as the final price prices
 * everything 18% low. Every price input on these screens is labelled
 * "excl. GST" and shows the gross figure beside it.
 */
export const GST_RATE = 0.18;

/** The tax-inclusive figure the buy screen shows. */
export function withGst(v) {
  const n = toAmount(v);
  if (n === null) return null;
  return Math.round(n * (1 + GST_RATE) * 100) / 100;
}

/** "₹99", "₹116.82". Two decimals only when there are paise to show. */
export function formatMoney(v) {
  const n = toAmount(v);
  if (n === null) return '—';
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---- Status -----------------------------------------------------------------

// `active` is spelled "Published" everywhere an operator can see it: only an
// active pack is on the buy screen, and that is the distinction that matters.
export const STATUS_LABEL = { active: 'Published', draft: 'Draft', inactive: 'Inactive' };
export const STATUS_COLORS = { active: 'green', inactive: 'default', draft: 'gold' };

export const statusLabel = (s) => STATUS_LABEL[s] || s || '—';

export const STATUS_OPTIONS = ['active', 'draft', 'inactive'].map((v) => ({
  label: STATUS_LABEL[v],
  value: v,
}));

// ---- Units ------------------------------------------------------------------

/**
 * The unit a quantity is counted in, derived from the feature's `key`. Storage
 * is measured in MEGABYTES; everything else is a plain count of the thing
 * itself. (The public store endpoint returns this as `feature.unit`; the admin
 * API doesn't, so it is derived here.)
 *
 * `suffix` is what goes after the number — null when the number stands alone.
 */
export function unitFor(featureKey) {
  if (featureKey === 'storage') return { suffix: 'MB', word: 'MB' };
  return { suffix: null, word: '' };
}

/** "1,024 MB", "500" — a quantity in its feature's own unit. */
export function formatQuantity(qty, featureKey) {
  const n = toAmount(qty);
  if (n === null) return '—';
  const { suffix } = unitFor(featureKey);
  const num = n.toLocaleString('en-IN');
  return suffix ? `${num} ${suffix}` : num;
}

/** "100 AI Credits", "1,024 MB of Storage" — for confirm dialogs. */
export function describeGrant(qty, feature) {
  const n = toAmount(qty);
  const num = n === null ? '—' : n.toLocaleString('en-IN');
  const label = feature?.label || feature?.key || 'quota';
  const { suffix } = unitFor(feature?.key);
  return suffix ? `${num} ${suffix} of ${label}` : `${num} ${label}`;
}

// ---- Feature types ----------------------------------------------------------

/**
 * ONLY features flagged `is_topupable` may be sold as a pack — the server
 * rejects any other with `{ field: 'feature_type_id', message: 'This feature is
 * not enabled for top-ups' }`, so an unflagged pack can never be published.
 * The flag is editable on the Feature Types screen: turning it on there is what
 * makes a feature appear in these dropdowns, with no deploy.
 */
export const isTopupable = (f) => isTrue(f?.is_topupable);

/**
 * Options for a feature dropdown, filtered to the top-uppable features.
 *
 * `keepValue` re-admits the one feature a record already points at even if it
 * has since been un-flagged — muted with a "(top-ups disabled)" suffix, so
 * editing an old pack can't silently repoint it at a different feature. The
 * publish checklist still fails against it, which is the honest outcome.
 *
 * `valueField` is 'id' for a pack (`feature_type_id`, numeric) and 'key' for a
 * grant (`feature`, a string) — the two endpoints are keyed differently.
 */
export function buildFeatureOptions(features, { valueField = 'id', keepValue = null } = {}) {
  return (features || [])
    .filter((f) => isTopupable(f) || (keepValue != null && f[valueField] === keepValue))
    .map((f) => {
      const disabled = !isTopupable(f);
      return {
        value: f[valueField],
        label: disabled ? `${f.label || f.key} (top-ups disabled)` : f.label || f.key,
        // Selectable, but visibly not a normal choice.
        style: disabled ? { opacity: 0.55 } : undefined,
        feature: f,
      };
    });
}

// ---- Publish checklist ------------------------------------------------------

/**
 * Readiness for a LIST row. Rows carry `is_publishable` (a real boolean) and
 * `missing_for_publish` ([{ field, message }]) produced by the SAME server
 * function as the gate, so the two cannot disagree — nothing is re-derived here.
 *
 * `known: false` means the row predates those fields. In that case the publish
 * action stays enabled and the server's 400 (identical `{field,message}` shape)
 * does the talking: a hand-rolled copy of the rules would silently disagree the
 * moment one changed server-side.
 */
export function packReadiness(row) {
  if (typeof row?.is_publishable === 'boolean') {
    const missing = Array.isArray(row.missing_for_publish) ? row.missing_for_publish : [];
    return { known: true, ready: row.is_publishable, missing };
  }
  return { known: false, ready: true, missing: [] };
}

/**
 * Push a backend validation/conflict error onto a pack form. Returns the text to
 * show at form level when it couldn't be pinned to a single field.
 *
 * One renderer covers both sources: a plain 400 and a publish-gate 400 share the
 * `error.details[] = [{ field, message }]` shape. `name` is unique
 * case-insensitively and its 409 carries no details[], so it is mapped onto the
 * name field rather than left as a toast.
 */
export function applyPackServerError(form, err, formFields) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const mapped = details.filter((d) => formFields.includes(d.field));
  if (mapped.length) {
    form.setFields(mapped.map((d) => ({ name: d.field, errors: [d.message] })));
    const rest = details.filter((d) => !formFields.includes(d.field));
    return rest.length ? rest.map((d) => d.message).join(' ') : null;
  }
  if (err?.status === 409) {
    form.setFields([
      { name: 'name', errors: [err.message || 'A pack with this name already exists.'] },
    ]);
    return null;
  }
  return err?.message || 'Could not save the pack.';
}

/** Flatten an error into one line — for toasts raised outside a form. */
export function errorText(err, fallback) {
  const details = Array.isArray(err?.details) ? err.details : [];
  return (
    [err?.message, details.map((d) => d.message).join(' ')].filter(Boolean).join(' — ') || fallback
  );
}

// ---- Quota grants -----------------------------------------------------------

export const GRANT_STATUS_COLORS = { active: 'green', pending: 'gold', revoked: 'default' };

/**
 * `pending` is an UNCONFIRMED PURCHASE. It contributes nothing to the balance,
 * so it is never counted in a total shown here. `revoked` rows stay visible as
 * the audit record.
 */
export const isCountable = (grant) => grant?.status === 'active';

/** What is left on a grant: the whole quantity minus what has been spent. */
export function remainingOf(grant) {
  const qty = toAmount(grant?.quantity) ?? 0;
  const used = toAmount(grant?.consumed) ?? 0;
  return qty - used;
}

/**
 * Why `consumed` looks broken for storage, and doesn't for AI credits. Shown as
 * a tooltip on the column, because the number is genuinely confusing otherwise.
 */
export const CONSUMED_EXPLAINER =
  'Storage top-ups raise the account’s limit permanently, so nothing is deducted here — deleting files frees the purchased space again. AI credits are spent from the monthly plan allowance first; only the overflow is deducted from a top-up.';

/** Active balance per feature — pending purchases deliberately excluded. */
export function balancesByFeature(grants) {
  const out = new Map();
  for (const g of grants || []) {
    if (!isCountable(g)) continue;
    const key = g.FeatureType?.key || String(g.feature_type_id ?? '');
    const prev = out.get(key) || { key, label: g.FeatureType?.label || key, remaining: 0 };
    prev.remaining += remainingOf(g);
    out.set(key, prev);
  }
  return [...out.values()];
}
