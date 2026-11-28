import dayjs from 'dayjs';

// ---- formatting ---------------------------------------------------------------

export const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ₹ with Indian grouping. Small per-unit costs keep up to 4 decimals. */
export function formatInr(v, { digits } = {}) {
  const n = toNum(v);
  if (n === null) return '—';
  const max = digits ?? (Math.abs(n) < 10 ? 4 : 2);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: max })}`;
}

export function formatNumber(v, digits = 2) {
  const n = toNum(v);
  if (n === null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function formatPct(v) {
  const n = toNum(v);
  if (n === null) return '—';
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
}

export function formatDateTime(v) {
  if (!v) return '—';
  const d = dayjs(v);
  return d.isValid() ? d.format('DD MMM YYYY, HH:mm') : String(v);
}

export function formatDate(v) {
  if (!v) return '—';
  const d = dayjs(v);
  return d.isValid() ? d.format('DD MMM YYYY') : String(v);
}

/** "3 h 12 min" style for an age in seconds. */
export function formatAge(seconds) {
  const s = toNum(seconds);
  if (s === null) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// ---- errors -------------------------------------------------------------------

/** Flatten an API error into one line — for toasts raised outside a form. */
export function errorText(err, fallback) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const parts = [err?.message, details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(' ')];
  return parts.filter(Boolean).join(' — ') || fallback;
}

/** details[] as `{ field, message }` rows. Tolerates an object map or plain strings. */
export function detailItems(err) {
  const d = err?.details;
  if (Array.isArray(d)) {
    return d.map((x) =>
      x && typeof x === 'object'
        ? { field: x.field ?? null, message: String(x.message ?? x.detail ?? JSON.stringify(x)) }
        : { field: null, message: String(x) },
    );
  }
  if (d && typeof d === 'object') {
    return Object.entries(d).map(([field, message]) => ({ field, message: String(message) }));
  }
  return [];
}

/**
 * A save failure for <AiServerErrors>: the server's message plus EVERY
 * details[] entry (schema ↔ route checks return one per problem).
 */
export function serverErrors(err, fallback = 'Could not save.') {
  return { message: err?.message || fallback, items: detailItems(err) };
}

/**
 * Also pin details[] entries onto the form fields they name — but the alert
 * still lists every one, so nothing is hidden behind a collapsed section.
 */
export function applyServerErrors(form, err, formFields, fallback = 'Could not save.') {
  const result = serverErrors(err, fallback);
  const byField = new Map();
  for (const d of result.items) {
    if (!d.field || !formFields.includes(d.field)) continue;
    byField.set(d.field, [...(byField.get(d.field) || []), d.message]);
  }
  if (byField.size) form.setFields([...byField].map(([name, errors]) => ({ name, errors })));
  return result;
}

/** JSON.stringify with sorted keys — for "did this object change?" checks. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

// ---- shared ids -----------------------------------------------------------------
// Filters and foreign keys are documented as `provider_id` / `operation_id`.
// Rows carry both a numeric `id` and a `uid`; send `id` when the row has one.
export const refOf = (row) => (row ? (row.id ?? row.uid) : undefined);

/** Does this row match a stored foreign key (by id or uid)? */
export const matchesRef = (row, ref) =>
  row != null && ref != null && (String(row.id) === String(ref) || String(row.uid) === String(ref));

// ---- providers ------------------------------------------------------------------

export const PROVIDER_STATUS_COLORS = { active: 'green', disabled: 'default' };

/** unavailable_reason → explanation. null means the provider is OK. */
export const UNAVAILABLE_REASONS = {
  disabled: 'Provider is disabled.',
  no_adapter: 'This server has no adapter for the provider key.',
  no_master_key: 'AI_SECRETS_MASTER_KEY is not set, so stored keys cannot be decrypted.',
  no_credential: 'No active API key — add, verify and activate one.',
  auth_failed:
    'The provider rejected our API key — rotate it. Clears by itself about 5 minutes after the fix.',
  out_of_credits:
    'Our prepaid balance at the provider is empty — top up (and record the purchase). Clears by itself about 5 minutes after the fix.',
};

export const CIRCUIT = {
  closed: { color: 'green', label: 'closed', hint: 'Healthy.' },
  half_open: { color: 'orange', label: 'half open', hint: 'Recovering — trying a few calls.' },
  open: {
    color: 'red',
    label: 'open',
    hint: 'Provider failing — traffic is going to fallbacks where allowed.',
  },
};

export const CREDENTIAL_KINDS = [
  { value: 'api_key', label: 'API key' },
  { value: 'webhook_secret', label: 'Webhook secret' },
];
export const CREDENTIAL_STATUS_COLORS = { pending: 'gold', active: 'green', retired: 'default' };

/** Magnific-style settings keys the provider form edits with dedicated controls. */
export const MANAGED_SETTING_KEYS = [
  'webhook_secret_encoding',
  'capture_responses',
  'low_balance_units',
];
/** Billing keys (every provider): settings.billing + settings.inr_per_unit (postpaid only). */
export const BILLING_SETTING_KEYS = ['billing', 'inr_per_unit'];
/** Written by the server — shown read-only, sent back untouched. */
export const SERVER_SETTING_KEYS = ['last_balance_alert_at'];

/** settings.billing defaults to prepaid when absent. */
export const isPostpaid = (provider) => provider?.settings?.billing === 'postpaid';

/** cost_unit → how to say "one unit" in help text. */
export const costUnitLabel = (unit) => (unit === 'usd_cent' ? 'US cent' : unit || 'unit');

// ---- operations -----------------------------------------------------------------

export const LEDGER_SOURCES = [
  { value: 'image_generation', label: 'image_generation' },
  { value: 'background_removal', label: 'background_removal' },
  { value: 'logo_generation', label: 'logo_generation' },
  { value: 'text_to_audio', label: 'text_to_audio' },
  { value: 'image_edit', label: 'image_edit' },
  { value: 'upscale', label: 'upscale' },
  { value: 'expand', label: 'expand' },
  { value: 'relight', label: 'relight' },
  { value: 'style_transfer', label: 'style_transfer' },
  { value: 'icon_generation', label: 'icon_generation' },
  { value: 'prompt_assist', label: 'prompt_assist' },
  { value: 'text_generation', label: 'Caption Writing' },
];

export const OPERATION_UNITS = ['call', 'image', 'text'];

/**
 * `project` = the uid of one of the user's own projects (at most one per
 * operation; required by context "project").
 */
export const FIELD_TYPES = ['string', 'enum', 'integer', 'boolean', 'media', 'media_list', 'project'];

/** input_schema.context — what the server adds to the request itself. */
export const SCHEMA_CONTEXT_OPTIONS = [
  { value: 'business', label: 'Add business details' },
  { value: 'project', label: 'Add project/design details' },
];

/** Input-schema field names: snake_case, at most 40 characters. */
export const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Operation keys: dot-separated snake_case segments, e.g. `image.standard`,
 * `text.post.instagram`, `remove_background`. Max 60 characters. Checked on
 * create only — the key is read-only afterwards.
 */
export const OPERATION_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
export const OPERATION_KEY_MAX = 60;

const ROW_KEYS = ['type', 'required', 'min', 'max', 'values', 'default', 'max_words', 'options', 'match'];

/** input_schema.context_rules defaults (server side). */
export const CONTEXT_RULE_DEFAULTS = { need_subject: true, need_industry: false };

/** Parse JSON text, or return `fallback` when blank / invalid. */
export function parseJsonSafe(text, fallback = undefined) {
  if (text === undefined || text === null || String(text).trim() === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** An enum row's option objects (options mode), or [] when blank / invalid. */
export function enumOptionsOf(row) {
  if (row?.enum_mode !== 'options') return [];
  const parsed = parseJsonSafe(row.options_json, []);
  return Array.isArray(parsed) ? parsed.filter((o) => o && typeof o === 'object') : [];
}

/** The plain values an enum row accepts, whichever way they're given. */
export function enumValuesOf(row) {
  if (!row || row.type !== 'enum') return [];
  if (row.enum_mode === 'options') {
    return enumOptionsOf(row)
      .map((o) => o.value)
      .filter((v) => v !== undefined && v !== null)
      .map(String);
  }
  return (row.values || []).map(String);
}

/** Form rule for an enum's `options` JSON: array of objects, unique string `value`s. */
export const enumOptionsRule = {
  validator: (_r, text) => {
    if (text === undefined || text === null || String(text).trim() === '') {
      return Promise.reject(new Error('An enum needs at least one option'));
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Promise.reject(new Error('Not valid JSON'));
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return Promise.reject(new Error('Must be a non-empty JSON array of { "value": …, … } objects'));
    }
    const seen = new Set();
    for (const [i, o] of parsed.entries()) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        return Promise.reject(new Error(`Item ${i + 1} is not an object`));
      }
      if (typeof o.value !== 'string' || !o.value) {
        return Promise.reject(new Error(`Item ${i + 1}: "value" must be a non-empty string`));
      }
      if (seen.has(o.value)) return Promise.reject(new Error(`Duplicate value "${o.value}"`));
      seen.add(o.value);
    }
    return Promise.resolve();
  },
};

/**
 * Problems with an enum's `match` ({ option attribute: other field }), checked
 * against the row's options and the other field names. [] = fine.
 */
export function matchProblems(row, fieldNames) {
  const text = row?.match_json;
  if (text === undefined || text === null || String(text).trim() === '') return [];
  const match = parseJsonSafe(text);
  if (!match || typeof match !== 'object' || Array.isArray(match)) {
    return ['Must be a JSON object, e.g. { "gender": "voice_gender" }'];
  }
  const out = [];
  const options = enumOptionsOf(row);
  for (const [attr, field] of Object.entries(match)) {
    if (typeof field !== 'string' || !field) out.push(`"${attr}" must name another field`);
    else if (field === row.name) out.push(`"${attr}" points at this field itself`);
    else if (!fieldNames.includes(field)) out.push(`"${attr}" → no field named "${field}"`);
    const missing = options.filter((o) => o[attr] === undefined).map((o) => o.value);
    if (missing.length) out.push(`options without "${attr}": ${missing.join(', ')}`);
  }
  return out;
}

/** API input_schema → editable rows. Unknown per-field keys ride along in `extra`. */
export function schemaToRows(schema) {
  const fields = schema?.fields && typeof schema.fields === 'object' ? schema.fields : {};
  return Object.entries(fields).map(([name, def]) => {
    const hasOptions = Array.isArray(def?.options);
    return {
      name,
      type: def?.type || 'string',
      required: Boolean(def?.required),
      min: def?.min ?? null,
      max: def?.max ?? null,
      max_words: def?.max_words ?? null,
      values: Array.isArray(def?.values) ? def.values.map(String) : [],
      enum_mode: hasOptions ? 'options' : 'values',
      options_json: hasOptions ? JSON.stringify(def.options, null, 2) : '',
      match_json:
        def?.match && typeof def.match === 'object' ? JSON.stringify(def.match, null, 2) : '',
      default: def?.default === undefined || def?.default === null ? undefined : def.default,
      extra: Object.fromEntries(Object.entries(def || {}).filter(([k]) => !ROW_KEYS.includes(k))),
    };
  });
}

/** input_schema.context as a clean list. */
export const schemaContext = (schema) =>
  Array.isArray(schema?.context) ? schema.context.filter((c) => typeof c === 'string') : [];

/** input_schema.one_of as a clean list of groups (each a list of field names). */
export const schemaOneOf = (schema) =>
  Array.isArray(schema?.one_of)
    ? schema.one_of.filter(Array.isArray).map((g) => g.filter((f) => typeof f === 'string'))
    : [];

/** input_schema.context_rules with the server defaults filled in. */
export const schemaContextRules = (schema) => ({
  ...CONTEXT_RULE_DEFAULTS,
  ...(schema?.context_rules && typeof schema.context_rules === 'object' ? schema.context_rules : {}),
});

/**
 * Editable rows (+ context, one_of, context_rules) → API input_schema. Drops
 * props that don't apply to the type; keeps unknown keys from the stored
 * schema (`base`) untouched.
 *
 * context_rules is sent only when the operation has context AND it either
 * differs from the defaults or was already stored.
 */
export function rowsToSchema(rows, context, base, { oneOf, contextRules } = {}) {
  const fields = {};
  const names = new Set((rows || []).map((r) => r?.name).filter(Boolean));
  for (const row of rows || []) {
    if (!row?.name) continue;
    const def = { ...(row.extra || {}), type: row.type };
    if (row.required) def.required = true;
    if (['integer', 'string', 'media_list'].includes(row.type)) {
      if (toNum(row.min) !== null) def.min = toNum(row.min);
      if (toNum(row.max) !== null) def.max = toNum(row.max);
    }
    if (row.type === 'string' && toNum(row.max_words) !== null) def.max_words = toNum(row.max_words);
    if (row.type === 'enum') {
      if (row.enum_mode === 'options') {
        def.options = parseJsonSafe(row.options_json, []);
        const match = parseJsonSafe(row.match_json);
        if (match && typeof match === 'object' && Object.keys(match).length) def.match = match;
      } else {
        def.values = (row.values || []).map(String);
      }
    }
    if (row.default !== undefined && row.default !== null && row.default !== '') {
      if (row.type === 'integer') def.default = toNum(row.default);
      else if (row.type === 'boolean') def.default = row.default === true || row.default === 'true';
      else if (row.type === 'enum' || row.type === 'string') def.default = String(row.default);
    }
    fields[row.name] = def;
  }
  const out = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (!['fields', 'context', 'one_of', 'context_rules'].includes(k)) out[k] = v;
  }
  out.fields = fields;
  if (context?.length) out.context = [...context];

  const groups = (oneOf || [])
    .map((g) => (Array.isArray(g) ? g.filter((f) => names.has(f)) : []))
    .filter((g) => g.length);
  if (groups.length) out.one_of = groups;

  if (context?.length && contextRules) {
    const rules = {
      need_subject: contextRules.need_subject !== false,
      need_industry: Boolean(contextRules.need_industry),
    };
    const isDefault =
      rules.need_subject === CONTEXT_RULE_DEFAULTS.need_subject &&
      rules.need_industry === CONTEXT_RULE_DEFAULTS.need_industry;
    if (!isDefault || base?.context_rules) out.context_rules = rules;
  }
  return out;
}

/** The values a multiplier can be keyed on for a schema row. */
export function multiplierValuesFor(row) {
  if (!row) return [];
  if (row.type === 'enum') return enumValuesOf(row);
  if (row.type === 'boolean') return ['true', 'false'];
  return [];
}

/**
 * credits × units × Π multipliers for a sample input. Returns the breakdown so
 * the preview can show its working, plus any value with no multiplier priced.
 */
export function previewPrice({ credits, unit, rows, priceRules, sample }) {
  const byName = new Map((rows || []).map((r) => [r.name, r]));
  const valueOf = (field) => {
    const v = sample?.[field];
    if (v !== undefined && v !== null && v !== '') return v;
    return byName.get(field)?.default;
  };

  const base = toNum(credits) ?? 0;
  let units = 1;
  const unitsFrom = priceRules?.units_from;
  if (unitsFrom) {
    const u = toNum(valueOf(unitsFrom));
    units = u === null ? 1 : u;
  }

  const factors = [];
  const missing = [];
  let product = 1;
  for (const [field, map] of Object.entries(priceRules?.multipliers || {})) {
    const raw = valueOf(field);
    if (raw === undefined || raw === null || raw === '') {
      missing.push(`${field} has no value`);
      continue;
    }
    const key = String(raw);
    const m = toNum(map?.[key]);
    if (m === null) {
      missing.push(`no multiplier for ${field} = ${key}`);
      continue;
    }
    product *= m;
    factors.push({ field, value: key, multiplier: m });
  }

  return {
    base,
    unit: unit || 'call',
    unitsFrom,
    units,
    factors,
    missing,
    total: base * units * product,
  };
}

/** Clean the price_rules form value into the API shape. */
export function cleanPriceRules(rules, rows) {
  const out = {};
  if (rules?.units_from) out.units_from = rules.units_from;
  const names = new Set((rows || []).map((r) => r.name));
  const multipliers = {};
  for (const [field, map] of Object.entries(rules?.multipliers || {})) {
    if (!names.has(field) || !map) continue;
    const clean = {};
    for (const [value, m] of Object.entries(map)) {
      const n = toNum(m);
      if (n !== null) clean[value] = n;
    }
    if (Object.keys(clean).length) multipliers[field] = clean;
  }
  if (Object.keys(multipliers).length) out.multipliers = multipliers;
  return out;
}

// ---- jobs -----------------------------------------------------------------------

export const JOB_STATUSES = ['queued', 'sending', 'processing', 'unknown', 'done', 'failed'];
export const JOB_STATUS_COLORS = {
  queued: 'default',
  sending: 'default',
  processing: 'default',
  unknown: 'orange',
  done: 'green',
  failed: 'red',
};
/** Statuses "Resolve & refund" applies to. */
export const RESOLVABLE = new Set(['unknown', 'queued', 'processing', 'sending']);

// ---- JSON text helpers -----------------------------------------------------------

export const prettyJson = (v) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
};

/** Form rule: blank, or a JSON object (not an array / scalar). */
export const jsonObjectRule = {
  validator: (_r, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return Promise.resolve();
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Promise.resolve();
      return Promise.reject(new Error('Must be a JSON object, e.g. { "key": "value" }'));
    } catch {
      return Promise.reject(new Error('Not valid JSON'));
    }
  },
};

export const parseJsonObject = (text) =>
  text === undefined || text === null || String(text).trim() === '' ? {} : JSON.parse(text);
