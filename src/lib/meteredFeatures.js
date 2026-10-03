/**
 * Metered features + the free plan.
 *
 * Every INTEGER feature type is an enforced limit (the app 402s past it), and
 * the API can only enforce keys it knows how to count — the "meters" from
 * GET /admin/feature-types/meters. Boolean features stay free-form on/off.
 *
 * reset_period is behaviour, not a label:
 *   monthly / annual → N adds per cycle; removing something does not give the
 *                      slot back, the count zeroes at the reset date.
 *   never            → at most N held at once; removing frees the slot.
 *
 * A plan with no row for a metered feature is UNLIMITED on it.
 */

export const RESET_PERIODS = ['monthly', 'annual', 'never'];

/** One-line hint under reset_period on the feature-type form (integer only). */
export const RESET_HINT = {
  monthly: 'N per cycle — removing does not give the slot back',
  annual: 'N per cycle — removing does not give the slot back',
  never: 'At most N at a time — removing frees the slot',
};

/** What a plan-feature value means, shown next to the value input. */
export const RESET_MEANING = {
  monthly: 'per month · removing does not refund',
  annual: 'per year · removing does not refund',
  never: 'at most, at a time',
};

export const NOT_ENFORCED_TOOLTIP =
  'Nothing counts this feature. Change it to a metered key or make it boolean.';

/** key → meter, from the /meters payload (undefined while it is loading). */
export function meterMap(meters) {
  const map = new Map();
  (meters || []).forEach((m) => map.set(m.key, m));
  return map;
}

/**
 * True for an integer feature whose key nothing counts (legacy data). Returns
 * false while the meters are unknown so a failed /meters call never paints
 * every row red.
 */
export function isUnenforced(featureType, meters) {
  if (!meters || featureType?.data_type !== 'integer') return false;
  return !meters.some((m) => m.key === featureType.key);
}

/** Integer features with a meter — the ones a plan is unlimited on when it has no row. */
export function meteredFeatureTypes(featureTypes, meters) {
  if (!meters) return [];
  const byKey = meterMap(meters);
  return (featureTypes || []).filter((f) => f.data_type === 'integer' && byKey.has(f.key));
}

/** Unit + reset meaning for an integer feature, e.g. "MB · at most, at a time". */
export function featureValueHint(featureType, meter) {
  if (!featureType || featureType.data_type !== 'integer') return null;
  const meaning = RESET_MEANING[featureType.reset_period];
  const unit = meter?.unit && meter.unit !== 'count' ? meter.unit : null;
  return [unit, meaning].filter(Boolean).join(' · ') || null;
}

// ---- free plan --------------------------------------------------------------

export const isFreePlan = (plan) => plan?.plan_type === 'free';

export const FREE_PLAN_ENFORCED =
  'Enforced: users without a subscription are held to these limits.';
export const FREE_PLAN_NOT_ENFORCED =
  'Not enforced: users without a subscription are currently unlimited.';

export const freePlanStatusSentence = (status) =>
  status === 'active' ? FREE_PLAN_ENFORCED : FREE_PLAN_NOT_ENFORCED;

/** The active free plan other than `exceptUid`, if any (only one may be active). */
export function otherActiveFreePlan(plans, exceptUid) {
  return (plans || []).find(
    (p) => isFreePlan(p) && p.status === 'active' && p.uid !== exceptUid,
  );
}
