// RBAC permission catalog for the Roles editor. Each domain lists ONLY the
// actions that have a backing route on the backend, so the picker can't emit a
// permission that does nothing. The backend stores exactly what we send and does
// NOT validate against this catalog — so all input must flow through the picker.

export const ACTIONS = ['read', 'create', 'update', 'delete'];
const ALL = ACTIONS;

export const PERMISSION_CATALOG = [
  { domain: 'admins', label: 'Admins', actions: ['read', 'create', 'update'] },
  { domain: 'users', label: 'Users', actions: ['read', 'update'] },
  { domain: 'activity', label: 'Activity Logs', actions: ['read'] },
  { domain: 'roles', label: 'Roles', actions: ALL },
  { domain: 'templates', label: 'Templates', actions: ALL },
  { domain: 'categories', label: 'Categories', hint: 'template & industry', actions: ALL },
  // The old single `themes` key is gone: variants (and their badges) and brand
  // series (and their style personalities + colours) are now separate domains.
  { domain: 'variants', label: 'Variants', hint: 'variants & badges', actions: ALL },
  {
    domain: 'brand_series',
    label: 'Brand Series',
    hint: 'series, style personalities & colours',
    actions: ALL,
  },
  // Frames and frame categories share one domain — there is no separate
  // frame_categories key on the backend.
  { domain: 'frames', label: 'Frames', hint: 'frames & frame categories', actions: ALL },
  { domain: 'sizes', label: 'Template Sizes', actions: ALL },
  { domain: 'tags', label: 'Tags', actions: ALL },
  { domain: 'assets', label: 'Assets', hint: 'assets & categories', actions: ALL },
  { domain: 'languages', label: 'Languages', hint: 'content languages', actions: ALL },
  { domain: 'fonts', label: 'Fonts', hint: 'library fonts, files & scripts', actions: ALL },
  // Read + delete only: feedback cannot be created or edited from the admin side
  // (POST/PATCH are 404 by design). Granted to SUPER_ADMIN only on the backend
  // because every row carries the submitter's name, phone and email — listing it
  // here lets a role be *seen* to have it, not silently acquire it.
  { domain: 'feedback', label: 'Feedback', hint: 'super admin only — carries user contact details', actions: ['read', 'delete'] },
  { domain: 'events', label: 'Special Events', actions: ALL },
  { domain: 'banners', label: 'Banners', actions: ALL },
  { domain: 'faqs', label: 'FAQs', hint: 'faqs & categories', actions: ALL },
  { domain: 'testimonials', label: 'Testimonials', actions: ALL },
  { domain: 'plans', label: 'Plans', hint: 'plans & billing', actions: ALL },
  { domain: 'features', label: 'Feature Types', actions: ALL },
  { domain: 'coupons', label: 'Coupons', actions: ALL },
  // Top-up packs AND the per-user quota grants issued by support share one
  // domain. Deliberately NOT a content permission: pricing is commerce, so only
  // super_admin holds it out of the box and a content_admin gets a 403 — don't
  // add it to a content role without asking whoever owns pricing.
  // `.update` also governs reading and issuing a user's grants; `.delete`
  // governs revoking one.
  {
    domain: 'quota_packs',
    label: 'Top-up Packs',
    hint: 'packs & user quota grants — commerce, not content',
    actions: ALL,
  },
  { domain: 'settings', label: 'App Settings', actions: ALL },
];
