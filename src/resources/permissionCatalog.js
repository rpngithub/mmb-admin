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
  { domain: 'themes', label: 'Themes', hint: 'themes & groups', actions: ALL },
  { domain: 'sizes', label: 'Template Sizes', actions: ALL },
  { domain: 'tags', label: 'Tags', actions: ALL },
  { domain: 'assets', label: 'Assets', hint: 'assets & categories', actions: ALL },
  { domain: 'events', label: 'Special Events', actions: ALL },
  { domain: 'banners', label: 'Banners', actions: ALL },
  { domain: 'faqs', label: 'FAQs', hint: 'faqs & categories', actions: ALL },
  { domain: 'testimonials', label: 'Testimonials', actions: ALL },
  { domain: 'plans', label: 'Plans', hint: 'plans & billing', actions: ALL },
  { domain: 'features', label: 'Feature Types', actions: ALL },
  { domain: 'coupons', label: 'Coupons', actions: ALL },
  { domain: 'settings', label: 'App Settings', actions: ALL },
];
