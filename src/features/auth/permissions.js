import { jwtDecode } from 'jwt-decode';

/**
 * Decode a JWT access token. Returns null if the token is missing/invalid.
 * @param {string|null|undefined} token
 * @returns {object|null}
 */
export function decodeToken(token) {
  if (!token) return null;
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
}

/**
 * Read the `permissions` claim from a decoded JWT payload. Per the API contract
 * this is an array of strings, but we tolerate the common alternative encodings
 * a backend might emit:
 *   - a JSON-encoded string:        "[\"*\"]"
 *   - a space/comma-delimited string: "roles.read templates.*"  (e.g. OAuth `scope`)
 *   - nested under role/admin/user:  { role: { permissions: [...] } }
 * @param {object|null} payload
 * @returns {string[]}
 */
export function getPermissions(payload) {
  if (!payload) return [];

  // Look in the documented location first, then common fallbacks.
  const candidate =
    payload.permissions ??
    payload.perms ??
    payload.scopes ??
    payload.scope ??
    payload.role?.permissions ??
    payload.admin?.permissions ??
    payload.user?.permissions ??
    null;

  return normalizePermissions(candidate);
}

export function normalizePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return [];
    // JSON-encoded array?
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        /* fall through to delimiter split */
      }
    }
    // space- or comma-delimited string (e.g. OAuth scope claim)
    return trimmed.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

/**
 * Permission semantics:
 *   "*"                = superuser (everything)
 *   "<domain>.*"       = every action within a domain
 *   "<domain>.<action> = exact (actions: read|create|update|delete)
 *
 * @param {string[]} permissions  list from the JWT
 * @param {string} domain         e.g. "roles", "templates"
 * @param {string} action         one of read|create|update|delete
 * @returns {boolean}
 */
export function hasPermission(permissions, domain, action) {
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  if (permissions.includes('*')) return true;
  if (permissions.includes(`${domain}.*`)) return true;
  return permissions.includes(`${domain}.${action}`);
}

/**
 * Convenience: can the admin read (i.e. see) a given domain at all?
 */
export function canRead(permissions, domain) {
  return hasPermission(permissions, domain, 'read');
}

/**
 * Extract a friendly display name + email from the decoded token, tolerating
 * the different claim shapes a backend might use.
 * @param {object|null} payload
 */
export function getAdminIdentity(payload) {
  if (!payload) return { name: 'Admin', email: '' };
  const name = payload.name || payload.full_name || payload.username || payload.email || 'Admin';
  const email = payload.email || '';
  return { name, email };
}
