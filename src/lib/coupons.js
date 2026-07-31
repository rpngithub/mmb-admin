import dayjs from 'dayjs';

// Shared coupon vocabulary + display helpers, used by both the list page and
// the editor drawer so the two never drift apart.

export const DISCOUNT_TYPE_OPTIONS = [
  { label: 'Percentage', value: 'percentage' },
  { label: 'Fixed amount', value: 'fixed' },
];

export const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Expired', value: 'expired' },
];

export const AUDIENCE_OPTIONS = [
  { label: 'Everyone', value: 'all' },
  { label: 'New users', value: 'new_users' },
  { label: 'Existing users', value: 'existing_users' },
];

// Derived + read-only: owned by PUT /admin/coupons/:uid/plans, never editable.
export const APPLICABLE_OPTIONS = [
  { label: 'All plans', value: 'all_plans' },
  { label: 'Specific plans', value: 'specific_plans' },
];

const STATUS_COLOR = { active: 'green', inactive: 'default', expired: 'red' };

export const statusColor = (status) => STATUS_COLOR[status] || 'default';

export const applicableLabel = (v) =>
  APPLICABLE_OPTIONS.find((o) => o.value === v)?.label || 'All plans';

export const audienceLabel = (v) => AUDIENCE_OPTIONS.find((o) => o.value === v)?.label || '—';

/** "20%" for a percentage coupon, "₹150" for a fixed one. */
export function formatDiscount(type, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (type === 'percentage') return `${n}%`;
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * The signals that make a coupon effectively dead while `status` still says
 * active: its end date has passed, or every allowed use has been redeemed.
 * `used_count` and `max_uses` come back as strings from the API on some rows,
 * so both are coerced.
 */
export function couponSignals(coupon, now = dayjs()) {
  const used = Number(coupon?.used_count ?? 0) || 0;
  const max = coupon?.max_uses == null ? null : Number(coupon.max_uses);
  const validTo = coupon?.valid_to ? dayjs(coupon.valid_to) : null;
  return {
    used,
    max: Number.isFinite(max) ? max : null,
    unlimited: coupon?.max_uses == null,
    expired: Boolean(validTo?.isValid() && validTo.isBefore(now)),
    exhausted: Number.isFinite(max) && max != null && used >= max,
  };
}

/** "Used 12 / 100" or "Used 12 (unlimited)". */
export function formatUsage(coupon) {
  const { used, max, unlimited } = couponSignals(coupon);
  return unlimited || max == null ? `Used ${used} (unlimited)` : `Used ${used} / ${max}`;
}

const DATE_FMT = 'DD MMM YYYY, HH:mm';

export const formatDateTime = (v) => (v && dayjs(v).isValid() ? dayjs(v).format(DATE_FMT) : '—');

/** "01 Jan 2026, 00:00 → No end date". */
export function formatValidity(coupon) {
  const from = formatDateTime(coupon?.valid_from);
  const to = coupon?.valid_to ? formatDateTime(coupon.valid_to) : 'No end date';
  return `${from} → ${to}`;
}
