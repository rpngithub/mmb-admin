/**
 * Shared notification vocabulary — used by the four Notifications screens and
 * their editors so the rules are stated once.
 *
 * TWO PERMISSION DOMAINS, deliberately split:
 *   • `notifications.*`          — templates, categories, delivery log
 *                                  (content_admin + super_admin)
 *   • `notification_campaigns.*` — campaigns (super_admin only)
 * Rewording a notification and blasting an unsolicited message to every user on
 * the platform are different authorities. A content_admin gets a 403 on every
 * campaign endpoint, so that menu item and route are hidden from them rather
 * than leading to a dead screen.
 */

// The API returns flags as 1/0, "1"/"0" or true/false depending on the endpoint.
export const isTrue = (v) => v === true || v === 1 || v === '1';

// ---- What may be written ----------------------------------------------------

/**
 * The twenty keys a notification template accepts on POST/PATCH. Bodies are
 * built from this list rather than from whatever a fetched row happened to
 * carry, because several returned fields are rejected on the way back.
 */
export const TEMPLATE_WRITE_FIELDS = [
  'code',
  'category_id',
  'title',
  'body',
  'cta_label',
  'cta_action',
  'cta_params',
  'image_s3_key',
  'variable_defaults',
  'trigger_type',
  'trigger_config',
  'audience_account_type',
  'audience_plan',
  'display_priority',
  'is_promotional',
  'cooldown_hours',
  'max_occurrences',
  'is_dismissible',
  'expires_after_days',
  'is_active',
];

/**
 * Returned by the API but NEVER accepted back — sending one is a 400 "is not
 * allowed".
 *
 * `variables` is server-owned (see below) and `priority` is an internal
 * send-order tiebreak that is not an admin's concern. Both are read here and
 * neither is ever written.
 */
export const TEMPLATE_READ_ONLY_FIELDS = [
  'variables',
  'priority',
  'is_system',
  'created_by',
  'id',
  'uid',
  'created_at',
  'updated_at',
  'NotificationCategory',
];

/** Drop every key the API refuses, for when a body is derived from a row. */
export function stripReadOnly(obj) {
  const out = { ...(obj || {}) };
  for (const key of TEMPLATE_READ_ONLY_FIELDS) delete out[key];
  return out;
}

/**
 * The three keys a BUILT-IN template returns 403 for. They are never sent and
 * never rendered as inputs on a system row — an input that exists but always
 * rejects you reads as a bug.
 */
export const SYSTEM_LOCKED_FIELDS = ['code', 'trigger_type', 'trigger_config'];

export const SYSTEM_LOCKED_EXPLAINER =
  'These are wired to the app and to notifications already sent, so they can’t be changed — but everything above is yours to edit.';

// ---- Placeholders -----------------------------------------------------------

/**
 * `{{placeholders}}` in a template's title/body, filled in when it sends.
 *
 * THE ADMIN NEVER MAINTAINS THE LIST. The server owns `variables`: on a built-in
 * template it is the fixed set of what that notification can fill, and on a
 * custom one it is derived from whatever the text mentions. So `variables` is
 * read (to draw the insert chips) and never written.
 *
 * Removing a placeholder is always fine — shortening the copy is a normal edit,
 * and nothing here warns about a variable the text no longer uses.
 */
export const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Every distinct placeholder used across the given strings, in first-seen order. */
export function extractPlaceholders(...texts) {
  const seen = [];
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    // A fresh regex per pass: PLACEHOLDER_RE is global and carries lastIndex.
    const re = new RegExp(PLACEHOLDER_RE.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!seen.includes(m[1])) seen.push(m[1]);
    }
  }
  return seen;
}

/** Does this copy contain any placeholder at all? (Campaign copy may not.) */
export function hasPlaceholders(...texts) {
  return extractPlaceholders(...texts).length > 0;
}

/**
 * The placeholders a template is ALLOWED to use. For a built-in row this is the
 * server's fixed list; for a custom one it comes back empty, and any placeholder
 * is accepted. Only used to draw the insert chips — never to pre-validate a save
 * on a custom template.
 */
export function allowedPlaceholders(record) {
  return Array.isArray(record?.variables) ? record.variables.map(String) : [];
}

/**
 * Placeholders used in the copy that the server will reject. Only meaningful for
 * a BUILT-IN template, where the allowed set is fixed; a custom template derives
 * its own, so nothing is ever unknown there.
 */
export function unknownPlaceholders(record, ...texts) {
  if (!isTrue(record?.is_system)) return [];
  const allowed = allowedPlaceholders(record);
  return extractPlaceholders(...texts).filter((p) => !allowed.includes(p));
}

export const PLACEHOLDER_HELP =
  'Click a chip to drop it into the message. They are filled in when the notification sends.';

// ---- "Sends when" -----------------------------------------------------------

/**
 * A raw `trigger_type` and a `trigger_config` blob mean nothing to the person
 * rewording a notification, so neither is ever shown. This turns the pair into a
 * sentence.
 *
 * New predicates can be added server-side without an admin-panel release, so
 * every branch falls back to a plain sentence rather than showing the JSON.
 */
const BEHAVIORAL_PHRASES = {
  never_returned: 'When a new user never comes back',
  onboarding_incomplete: 'When setup is unfinished',
  no_projects: 'When a user has made no designs',
  no_business_profile: 'When there is no business profile',
  no_logo: 'When a business has no logo',
  no_active_frame: 'When no brand frame is set',
  no_products: 'When no products are added',
  no_business_tags: 'When no keywords are chosen',
  business_incomplete: 'When the business profile is incomplete',
  still_personal: 'Every so often, for personal accounts',
};

const ANCHOR_PHRASES = {
  trial_end: { relative: 'a trial ends', onDay: 'On the day a trial ends' },
  subscription_end: {
    relative: 'a subscription expires',
    onDay: 'On the day a subscription expires',
  },
  special_event: { relative: 'a festival', onDay: 'On the day of a festival' },
};

const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

/** Last-resort readable form of an unknown server-side key. */
const humanizeKey = (key) =>
  String(key || '')
    .replace(/[_.]/g, ' ')
    .trim();

export function describeTrigger(template) {
  const type = template?.trigger_type;
  const cfg = (template?.trigger_config && typeof template.trigger_config === 'object'
    ? template.trigger_config
    : {}) || {};

  if (type === 'event') return 'Automatically, when it happens';
  if (type === 'manual') return 'Only when sent as a campaign';

  if (type === 'scheduled') {
    const anchor = cfg.anchor;
    const offset = Number(cfg.offset ?? 0);
    const phrases = ANCHOR_PHRASES[anchor];
    if (offset === 0) {
      if (phrases) return phrases.onDay;
      return anchor ? `On the day of ${humanizeKey(anchor)}` : 'On a fixed date';
    }
    const relative = phrases?.relative || humanizeKey(anchor) || 'a scheduled date';
    const n = Math.abs(offset);
    return offset < 0
      ? `${plural(n, 'day')} before ${relative}`
      : `${plural(n, 'day')} after ${relative}`;
  }

  if (type === 'behavioral') {
    const predicate = cfg.predicate;
    if (predicate === 'inactive') {
      const days = Number(cfg.days ?? 0);
      return days > 0
        ? `When a user has been away ${plural(days, 'day')}`
        : 'When a user has been away';
    }
    if (BEHAVIORAL_PHRASES[predicate]) return BEHAVIORAL_PHRASES[predicate];
    return predicate ? `When ${humanizeKey(predicate)}` : 'Based on what a user has done';
  }

  if (type === 'recurring') {
    if (cfg.recurrence === 'weekly') return 'Every week';
    if (cfg.recurrence === 'every_n_days') {
      const days = Number(cfg.days ?? 0);
      return days > 0 ? `Every ${plural(days, 'day')}` : 'On a repeating schedule';
    }
    return cfg.recurrence ? `Every ${humanizeKey(cfg.recurrence)}` : 'On a repeating schedule';
  }

  return type ? `Sent automatically (${humanizeKey(type)})` : 'Sent automatically';
}

// ---- Templates that ship switched off ---------------------------------------

/**
 * Seeded inactive because the product features they describe do not exist yet.
 * Switching one on does not make it fire.
 */
export const PENDING_FEATURE_CODES = new Set([
  'weekly_marketing_reminder',
  'monthly_calendar_ready',
  'business_listing_not_published',
  'business_profile_approved',
  'download_app_update',
]);

export const PENDING_FEATURE_NOTE =
  'Waiting on a product feature. Can still be sent manually as a campaign.';

export const isPendingFeature = (record) => PENDING_FEATURE_CODES.has(record?.code);

// ---- Deactivation -----------------------------------------------------------

/**
 * DELETE returns 200 but sets is_active = 0. A hard delete would orphan every
 * notification already sitting in a user's inbox, so the row stays in the list.
 */
export const DEACTIVATE_CONFIRM =
  'This notification will stop being sent. Ones already delivered stay in users’ inboxes.';

// ---- Fatigue and consent ----------------------------------------------------

export const PROMOTIONAL_EXPLAINER =
  'Promotional: respects the user’s marketing opt-out, the daily and weekly limits, and quiet hours (9pm–9am). Turn OFF for things like receipts and payment failures, which must always get through.';

export const PROMOTIONAL_SYSTEM_WARNING =
  'This is a built-in notification and its promotional setting was chosen deliberately. Turning it off makes it ignore the marketing opt-out, the daily and weekly limits and quiet hours; turning it on can stop a receipt or a payment failure reaching someone.';

export const BYPASS_FATIGUE_EXPLAINER =
  'Ignores the limits on how many notifications someone can receive. Use only for announcements every user genuinely needs.';

export const BYPASS_FATIGUE_SCOPE =
  'It never bypasses the marketing opt-out or a category mute — those still apply. Ticking it is written to the activity log.';

export const SHOW_AS_IMPORTANT_HELP =
  'How prominently the app renders it. Nothing to do with the order things are sent in.';

// ---- Option lists -----------------------------------------------------------

export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'business', label: 'Business accounts' },
  { value: 'personal', label: 'Personal accounts' },
];

export const PLAN_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'free', label: 'Free users' },
  { value: 'paid', label: 'Paid users' },
  { value: 'trial', label: 'On a trial' },
];

export const ONBOARDING_OPTIONS = [
  { value: 'complete', label: 'Complete' },
  { value: 'incomplete', label: 'Incomplete' },
];

/**
 * Nobody thinks in hours, so the cooldown is a select rather than a number box.
 * `null` means no cooldown at all.
 */
export const COOLDOWN_OPTIONS = [
  { value: null, label: 'Every time' },
  { value: 24, label: 'Once a day' },
  { value: 168, label: 'Once a week' },
  { value: 336, label: 'Once a fortnight' },
  { value: 720, label: 'Once a month' },
];

/**
 * `cta_action` is an app route key, so it is a dropdown of friendly labels — a
 * typo in a free-text box is a dead button in the app. The escape hatch under
 * Advanced covers routes the app adds without an admin-panel release.
 */
export const CTA_ACTION_OPTIONS = [
  { value: 'home', label: 'App home' },
  { value: 'subscription.plans', label: 'Plans & pricing' },
  { value: 'subscription.mine', label: 'My subscription' },
  { value: 'billing.retry', label: 'Retry payment' },
  { value: 'billing.invoices', label: 'Invoices' },
  { value: 'ai.tools', label: 'AI tools' },
  { value: 'templates.browse', label: 'Browse templates' },
  { value: 'templates.trending', label: 'Trending templates' },
  { value: 'brandSeries.browse', label: 'Brand series' },
  { value: 'events.detail', label: 'Festival / event' },
  { value: 'calendar.home', label: 'Marketing calendar' },
  { value: 'projects.mine', label: 'My designs' },
  { value: 'business.create', label: 'Create business profile' },
  { value: 'business.edit', label: 'Edit business' },
  { value: 'business.brandKit', label: 'Brand kit' },
  { value: 'business.frames', label: 'Frames' },
  { value: 'business.keywords', label: 'Keywords' },
  { value: 'products.create', label: 'Add products' },
  { value: 'profile.edit', label: 'Edit profile' },
  { value: 'system.update', label: 'App update' },
];

const CTA_LABEL_BY_VALUE = Object.fromEntries(
  CTA_ACTION_OPTIONS.map((o) => [o.value, o.label]),
);

/** Friendly name for a route key, falling back to the key itself. */
export const ctaActionLabel = (value) =>
  value ? CTA_LABEL_BY_VALUE[value] || value : '';

export const isKnownCtaAction = (value) => Boolean(value && CTA_LABEL_BY_VALUE[value]);

// ---- Campaign lifecycle -----------------------------------------------------

/**
 * draft → scheduled → sending → sent, with cancelled / failed terminal.
 * `status` is NOT writable — it moves only through the four action endpoints.
 */
export const CAMPAIGN_STATUS_LABEL = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export const CAMPAIGN_STATUS_COLORS = {
  draft: 'default',
  scheduled: 'blue',
  sending: 'processing',
  sent: 'green',
  cancelled: 'default',
  failed: 'red',
};

export const CAMPAIGN_STATUS_OPTIONS = Object.keys(CAMPAIGN_STATUS_LABEL).map((v) => ({
  value: v,
  label: CAMPAIGN_STATUS_LABEL[v],
}));

export const campaignStatusLabel = (s) => CAMPAIGN_STATUS_LABEL[s] || s || '—';

/** Only a draft or a scheduled campaign accepts a PATCH — anything else 403s. */
export const isCampaignEditable = (c) => c?.status === 'draft' || c?.status === 'scheduled';

/** The campaign fields accepted on write. `status` is deliberately absent. */
export const CAMPAIGN_WRITE_FIELDS = [
  'name',
  'template_id',
  'category_id',
  'title',
  'body',
  'cta_label',
  'cta_action',
  'cta_params',
  'image_s3_key',
  'audience',
  'scheduled_at',
  'bypass_fatigue',
];

export const CAMPAIGN_COPY_LITERAL_NOTE =
  'Campaign text goes out identically to everyone who receives it, so it cannot contain {{placeholders}} — there is nothing to fill them in from.';

export const SEND_NOW_PACING_NOTE =
  '“Send now” is not instant. Large campaigns are written in batches by a job that runs every 5 minutes, so the counts climb over time.';

export const CANCEL_CONFIRM_NOTE =
  'Already-delivered notifications stay in users’ inboxes.';

// ---- The audience builder ---------------------------------------------------

/**
 * `audience` is a FLAT, AND-ed JSON object. There is no OR and no nesting.
 * Any key outside this list is a 400 — deliberately, because a silently-ignored
 * filter would make the audience BIGGER than intended.
 */
export const AUDIENCE_KEYS = [
  'account_type',
  'plan',
  'industry_ids',
  'has_business',
  'onboarding',
  'inactive_days_min',
  'inactive_days_max',
  'signed_up_after',
  'signed_up_before',
  'cities',
  'user_uids',
];

export const AUDIENCE_LIMITS = {
  industry_ids: 100,
  cities: 50,
  user_uids: 1000,
};

/**
 * Presets lead the audience step — a blank filter builder is what made this
 * section confusing. Each one just fills the `audience` object.
 */
export const AUDIENCE_PRESETS = [
  { key: 'everyone', label: 'Everyone', audience: {} },
  { key: 'free', label: 'Free users', audience: { plan: 'free' } },
  { key: 'paid', label: 'Paid users', audience: { plan: 'paid' } },
  { key: 'business', label: 'Business accounts', audience: { account_type: 'business' } },
  { key: 'personal', label: 'Personal accounts', audience: { account_type: 'personal' } },
  { key: 'away30', label: 'Away 30+ days', audience: { inactive_days_min: 30 } },
  { key: 'setup', label: 'Never finished setup', audience: { onboarding: 'incomplete' } },
];

/** Which preset an audience object corresponds to, or null for a custom one. */
export function matchPreset(audience) {
  const a = audience && typeof audience === 'object' ? audience : {};
  const print = JSON.stringify(sortedEntries(a));
  const found = AUDIENCE_PRESETS.find(
    (p) => JSON.stringify(sortedEntries(p.audience)) === print,
  );
  return found ? found.key : null;
}

function sortedEntries(obj) {
  return Object.keys(obj || {})
    .sort()
    .map((k) => [k, obj[k]]);
}

/**
 * Client-side check of the same rules the server enforces, so the editor says no
 * before the endpoint does. Returns [] when the object is acceptable.
 */
export function validateAudience(audience) {
  const errors = [];
  if (!audience || typeof audience !== 'object' || Array.isArray(audience)) {
    return ['Audience must be a flat object of filters.'];
  }
  for (const key of Object.keys(audience)) {
    if (!AUDIENCE_KEYS.includes(key)) {
      errors.push(`“${key}” is not an accepted audience filter — the server rejects unknown keys.`);
    }
  }
  for (const [key, max] of Object.entries(AUDIENCE_LIMITS)) {
    const v = audience[key];
    if (Array.isArray(v) && v.length > max) {
      errors.push(`${key} takes at most ${max} entries (you have ${v.length}).`);
    }
  }
  const { inactive_days_min: min, inactive_days_max: max } = audience;
  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    errors.push('“Away at least” cannot be greater than “and at most”.');
  }
  const after = audience.signed_up_after;
  const before = audience.signed_up_before;
  if (after && before && String(after) > String(before)) {
    errors.push('“Signed up after” cannot be later than “signed up before”.');
  }
  return errors;
}

/** Human summary of an audience object for a list column / confirm dialog. */
export function describeAudience(audience) {
  if (!audience || typeof audience !== 'object') return 'Everyone';
  const preset = matchPreset(audience);
  if (preset) return AUDIENCE_PRESETS.find((p) => p.key === preset).label;

  const parts = [];
  const add = (t) => t && parts.push(t);
  if (audience.account_type && audience.account_type !== 'all') add(audience.account_type);
  if (audience.plan && audience.plan !== 'all') add(`${audience.plan} plan`);
  if (Array.isArray(audience.industry_ids) && audience.industry_ids.length) {
    add(`${audience.industry_ids.length} industries`);
  }
  if (audience.has_business === true) add('has a business');
  if (audience.has_business === false) add('no business');
  if (audience.onboarding) add(`setup ${audience.onboarding}`);
  if (audience.inactive_days_min != null) add(`away ≥ ${audience.inactive_days_min}d`);
  if (audience.inactive_days_max != null) add(`away ≤ ${audience.inactive_days_max}d`);
  if (audience.signed_up_after) add(`joined after ${audience.signed_up_after}`);
  if (audience.signed_up_before) add(`joined before ${audience.signed_up_before}`);
  if (Array.isArray(audience.cities) && audience.cities.length) {
    add(`${audience.cities.length} cities`);
  }
  if (Array.isArray(audience.user_uids) && audience.user_uids.length) {
    add(`${audience.user_uids.length} named users`);
  }
  return parts.length ? parts.join(' · ') : 'Everyone';
}

// ---- Errors -----------------------------------------------------------------

/**
 * Push a backend validation error onto a form. The notification endpoints return
 * EXPLANATORY messages — a bad placeholder error names both the offending token
 * and every one that IS available — so anything unpinnable is surfaced verbatim
 * rather than replaced with a generic string.
 */
export function applyNotificationServerError(form, err, formFields) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const mapped = details.filter((d) => formFields.includes(d.field));
  if (mapped.length) {
    form.setFields(mapped.map((d) => ({ name: d.field, errors: [d.message] })));
    const rest = details.filter((d) => !formFields.includes(d.field));
    return rest.length ? rest.map((d) => d.message).join(' ') : null;
  }
  return errorText(err, 'Could not save.');
}

/** Flatten an error into one line — for toasts raised outside a form. */
export function errorText(err, fallback) {
  const details = Array.isArray(err?.details) ? err.details : [];
  return (
    [err?.message, details.map((d) => d.message).join(' ')].filter(Boolean).join(' — ') || fallback
  );
}

// ---- JSON form fields -------------------------------------------------------

/** Pretty-print an object field for a textarea; '' for empty. */
export function jsonToText(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

/** Parse a textarea back to an object; throws so the caller can flag the field. */
export function textToJson(text) {
  const s = (text ?? '').toString().trim();
  if (s === '') return null;
  const parsed = JSON.parse(s);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Must be a JSON object, e.g. { "key": "value" }.');
  }
  return parsed;
}

/**
 * An optional text field the admin cleared has to go up as null — that is the
 * only way to unset it. An untouched one is left out of the PATCH entirely.
 */
export const nullableText = (v) => {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
};

export const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Shallow value equality good enough for diffing a PATCH body. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** The subset of `next` that differs from `before` — a partial PATCH body. */
export function diffBody(next, before) {
  const patch = {};
  for (const key of Object.keys(next)) {
    if (!sameValue(next[key], before[key])) patch[key] = next[key];
  }
  return patch;
}
