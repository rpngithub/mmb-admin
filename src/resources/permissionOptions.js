// Permission domains used across the admin API (mirrors the backend resource map).
export const PERMISSION_DOMAINS = [
  'roles',
  'templates',
  'frames',
  'categories',
  'variants',
  'brand_series',
  'sizes',
  'tags',
  'assets',
  'languages',
  'fonts',
  'feedback',
  'events',
  'banners',
  'faqs',
  'testimonials',
  'plans',
  'features',
  'coupons',
  // Top-up packs + the quota grants support issues against them.
  'quota_packs',
  // Industry page copy: shared defaults + per-industry overrides.
  'page_content',
  'settings',
  'users',
  'admins',
  'activity',
];

export const PERMISSION_ACTIONS = ['read', 'create', 'update', 'delete'];

// Flat list suitable for an AntD Select (mode="tags") — includes wildcards.
export function buildPermissionOptions() {
  const opts = [{ label: '* (superuser — all permissions)', value: '*' }];
  for (const domain of PERMISSION_DOMAINS) {
    opts.push({ label: `${domain}.* (all ${domain})`, value: `${domain}.*` });
    for (const action of PERMISSION_ACTIONS) {
      opts.push({ label: `${domain}.${action}`, value: `${domain}.${action}` });
    }
  }
  return opts;
}
