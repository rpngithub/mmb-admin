import dayjs from 'dayjs';

const HIDDEN_KEYS = new Set(['id', 'uid', 'created_at', 'updated_at', 'deleted_at']);

/**
 * Guess a field config from a sample value (used when a resource has no explicit
 * `fields` config — a first-pass editor inferred from GET / data).
 */
function inferFieldType(value) {
  if (typeof value === 'boolean') return 'switch';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'tags';
  if (value && typeof value === 'object') return 'json';
  if (typeof value === 'string' && value.length > 80) return 'textarea';
  return 'text';
}

export function inferFields(rows) {
  const sample = Array.isArray(rows) ? rows.find((r) => r && typeof r === 'object') : null;
  if (!sample) return [];
  return Object.entries(sample)
    .filter(([key]) => !HIDDEN_KEYS.has(key))
    .map(([key, value]) => ({
      name: key,
      label: humanize(key),
      type: inferFieldType(value),
    }));
}

export function inferColumns(rows) {
  const sample = Array.isArray(rows) ? rows.find((r) => r && typeof r === 'object') : null;
  if (!sample) return [];
  return Object.keys(sample)
    .filter((key) => key !== 'content') // skip heavy blobs
    .slice(0, 8)
    .map((key) => ({
      dataIndex: key,
      title: humanize(key),
      type: typeof sample[key] === 'boolean' ? 'boolean' : undefined,
    }));
}

export function humanize(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert an API record into form-ready values (dayjs for dates, JSON stringified
 * for object fields, arrays preserved for tag selects).
 */
export function toFormValues(record, fields) {
  const out = {};
  for (const f of fields) {
    const v = record?.[f.name];
    if (v === undefined || v === null) {
      out[f.name] = f.type === 'switch' ? Boolean(v) : undefined;
      continue;
    }
    if (f.type === 'date') out[f.name] = dayjs(v).isValid() ? dayjs(v) : undefined;
    else if (f.type === 'json') out[f.name] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    else if (f.type === 'switch') out[f.name] = Boolean(v);
    else out[f.name] = v;
  }
  return out;
}

/**
 * Convert form values back into an API payload (ISO dates, parsed JSON).
 * Throws on invalid JSON so the caller can surface a validation error.
 */
export function fromFormValues(values, fields) {
  const out = { ...values };
  for (const f of fields) {
    if (!(f.name in out)) continue;
    const v = out[f.name];
    if (f.type === 'date') {
      out[f.name] = v && dayjs.isDayjs(v) ? v.toISOString() : v || null;
    } else if (f.type === 'json') {
      if (typeof v === 'string' && v.trim() !== '') {
        out[f.name] = JSON.parse(v); // may throw — caught by caller
      } else if (v === '' || v === undefined) {
        out[f.name] = null;
      }
    }
  }
  return out;
}
