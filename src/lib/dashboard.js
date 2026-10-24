import dayjs from 'dayjs';

/**
 * Every dashboard widget the backend knows, in its display order, with a
 * fallback title. Used ONLY by the role editor's "Dashboard widgets" picker so
 * it can offer all 15 even when the editing admin's own manifest is trimmed by
 * their permissions — the live manifest's titles win, and any widget the server
 * adds later is appended from it. The dashboard page itself never reads this:
 * it is built solely from the manifest.
 */
export const DASHBOARD_WIDGETS = [
  { key: 'revenue_summary', title: 'Revenue summary' },
  { key: 'revenue_trend', title: 'Revenue trend' },
  { key: 'payment_health', title: 'Payment health' },
  { key: 'subscribers_by_plan', title: 'Subscribers by plan' },
  { key: 'renewals_due', title: 'Renewals due' },
  { key: 'user_summary', title: 'User summary' },
  { key: 'signups_by_platform', title: 'Signups by platform' },
  { key: 'signup_funnel', title: 'Signup funnel' },
  { key: 'export_summary', title: 'Export summary' },
  { key: 'catalog_coverage', title: 'Catalog coverage' },
  { key: 'events_without_templates', title: 'Events without templates' },
  { key: 'pending_industries', title: 'Pending industries' },
  { key: 'recent_feedback', title: 'Recent feedback' },
  { key: 'draft_templates', title: 'Draft templates' },
  { key: 'migration_status', title: 'Migration status' },
];

export const dashboardPermission = (key) => `dashboard.${key}`;

/** Layout only: widgets that need the full row width; the rest take half. */
export const WIDE_WIDGETS = new Set([
  'revenue_summary',
  'revenue_trend',
  'payment_health',
  'renewals_due',
  'user_summary',
  'export_summary',
  'catalog_coverage',
  'draft_templates',
]);

/** Merge the static catalog with whatever the live manifest says. */
export function mergeWidgetCatalog(manifestWidgets = []) {
  const byKey = new Map(DASHBOARD_WIDGETS.map((w) => [w.key, { ...w }]));
  for (const w of manifestWidgets) {
    if (!w?.key) continue;
    byKey.set(w.key, { key: w.key, title: w.title || byKey.get(w.key)?.title || w.key });
  }
  return [...byKey.values()].map((w) => ({
    ...w,
    permission: dashboardPermission(w.key),
  }));
}

// ---- Date range ---------------------------------------------------------

export const DATE_FORMAT = 'YYYY-MM-DD';
export const MAX_RANGE_DAYS = 366;

/** RangePicker presets. Functions so "today" is evaluated when picked. */
export const RANGE_PRESETS = [
  { label: 'Last 7 days', value: () => [dayjs().subtract(6, 'day'), dayjs()] },
  { label: 'Last 30 days', value: () => [dayjs().subtract(29, 'day'), dayjs()] },
  { label: 'This month', value: () => [dayjs().startOf('month'), dayjs()] },
  { label: 'Last 90 days', value: () => [dayjs().subtract(89, 'day'), dayjs()] },
];

/** Parse `?from=&to=` into a dayjs pair, or null when absent/invalid. */
export function parseRange(from, to) {
  if (!from || !to) return null;
  const a = dayjs(from, DATE_FORMAT, true);
  const b = dayjs(to, DATE_FORMAT, true);
  if (!a.isValid() || !b.isValid() || b.isBefore(a)) return null;
  return [a, b];
}

export function formatRange(range) {
  if (!range) return null;
  const [a, b] = range;
  const sameYear = a.year() === b.year() && a.year() === dayjs().year();
  const f = sameYear ? 'D MMM' : 'D MMM YYYY';
  return a.isSame(b, 'day') ? a.format(f) : `${a.format(f)} – ${b.format(f)}`;
}

// ---- Formatting ---------------------------------------------------------

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const NUM = new Intl.NumberFormat('en-IN');

/** Number or null — null/undefined/''/NaN all mean "no value". */
export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtWith = (formatter) => (v) => {
  const n = toNum(v);
  return n === null ? '—' : formatter.format(n);
};

export const fmtINR = fmtWith(INR);
export const fmtINRCompact = fmtWith(INR_COMPACT);
export const fmtNum = fmtWith(NUM);
/** Percentages arrive pre-computed; null means "denominator was 0". */
export const fmtPct = (v) => {
  const n = toNum(v);
  return n === null ? '—' : `${n.toFixed(1).replace(/\.0$/, '')}%`;
};

export const fmtDate = (v) => (v && dayjs(v).isValid() ? dayjs(v).format('D MMM YYYY') : '—');
export const fmtDateTime = (v) =>
  v && dayjs(v).isValid() ? dayjs(v).format('D MMM YYYY, HH:mm') : '—';

/** "last_7d" → "Last 7d", "mtd" → "Month to date", etc. */
const WINDOW_LABELS = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_24h: 'Last 24 hours',
  last_7d: 'Last 7 days',
  last_30d: 'Last 30 days',
  mtd: 'Month to date',
};
export const humanize = (key) =>
  WINDOW_LABELS[key] ||
  String(key ?? '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

/** A window / bucket row's identifying key, tolerant of naming. */
export const windowKey = (w) => w?.key ?? w?.window ?? w?.period ?? w?.label;

/** A value that may arrive bare or as `{ count }` / `{ gross }`. */
export const pick = (v, field = 'count') =>
  v !== null && typeof v === 'object' ? v[field] ?? v.count ?? v.total ?? null : v;

// ---- Chart palette ------------------------------------------------------
// Light-mode categorical slots from the validated reference palette, in fixed
// order (the admin is light-only — theme.js uses the default algorithm). Series
// past the last slot fold into "Other" rather than generating a hue.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
export const OTHER_COLOR = '#b4b2a9';

/** Fixed entity → slot mapping so a series keeps its colour across views. */
export const PURCHASE_TYPE_COLORS = {
  subscription: SERIES_COLORS[0],
  frame: SERIES_COLORS[1],
  quota_pack: SERIES_COLORS[2],
};
export const PLATFORM_COLORS = {
  android: SERIES_COLORS[0],
  ios: SERIES_COLORS[1],
  web: SERIES_COLORS[2],
  playground: SERIES_COLORS[3],
  unknown: OTHER_COLOR,
};
