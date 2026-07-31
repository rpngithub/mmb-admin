import { buildPermissionOptions } from './permissionOptions';

/**
 * Per-resource endpoint names generated for the RTK Query factory. Kept in one
 * place so both the API factory and the UI resolve the same names.
 */
export function endpointNames(key) {
  return {
    list: `${key}List`,
    get: `${key}Get`,
    create: `${key}Create`,
    update: `${key}Update`,
    remove: `${key}Remove`,
  };
}

// ---- Reusable column/field helpers -----------------------------------------

const activeColumn = {
  dataIndex: 'is_active',
  title: 'Active',
  type: 'boolean',
  width: 90,
};

const sortField = {
  name: 'sort_order',
  label: 'Sort order',
  type: 'number',
};

const activeField = {
  name: 'is_active',
  label: 'Active',
  type: 'switch',
  initialValue: true,
};

/**
 * A generic CRUD resource. Anything omitted (columns/fields) is inferred from
 * live data at render time by ResourceManager.
 */
function resource(cfg) {
  return {
    idField: 'uid',
    listMode: 'client',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    ...cfg,
    endpoints: endpointNames(cfg.key),
  };
}

// ---- Resource definitions ---------------------------------------------------

export const RESOURCES = [
  resource({
    key: 'roles',
    name: 'Roles',
    title: 'Role',
    path: '/admin/roles',
    permission: 'roles',
    group: 'Access',
    columns: [
      { dataIndex: 'name', title: 'Name' },
      { dataIndex: 'description', title: 'Description', ellipsis: true },
      {
        dataIndex: 'permissions',
        title: 'Permissions',
        type: 'tags',
        render: undefined,
      },
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      {
        name: 'permissions',
        label: 'Permissions',
        type: 'tags',
        options: buildPermissionOptions(),
        help: 'Use "*" for superuser, "<domain>.*" for a whole domain, or "<domain>.<action>".',
      },
    ],
  }),

  // Template & Business categories have dedicated, tree-aware pages
  // (src/pages/{Template,Business}CategoriesPage.jsx → CategoriesManager,
  // wired in router.jsx) with image upload, parent picker and (business) tag
  // multi-select. These configs only supply nav/permission/endpoints; their
  // `fields`/`columns` are unused.
  resource({
    key: 'templateCategories',
    name: 'Template Categories',
    title: 'Template Category',
    path: '/admin/template-categories',
    permission: 'categories',
    group: 'Catalog',
  }),

  // Displayed as "Industry"/"Industries" (product terminology); the API path
  // stays /admin/business-categories and the resource key stays
  // `businessCategories`. Only the visible labels changed.
  resource({
    key: 'businessCategories',
    name: 'Industries',
    title: 'Industry',
    path: '/admin/business-categories',
    permission: 'categories',
    group: 'Catalog',
  }),

  // Themes & Theme Groups have dedicated pages (src/pages/Themes*.jsx →
  // ThemeEditorDrawer, wired in router.jsx): a two-level group→themes view and a
  // flat themes table, with thumbnail upload. These configs only supply
  // nav/permission/endpoints; their `fields`/`columns` are unused.
  resource({
    key: 'themes',
    name: 'Themes',
    title: 'Theme',
    path: '/admin/themes',
    permission: 'themes',
    group: 'Catalog',
  }),

  resource({
    key: 'themeGroups',
    name: 'Theme Groups',
    title: 'Theme Group',
    path: '/admin/theme-groups',
    permission: 'themes',
    group: 'Catalog',
  }),

  // Template Sizes have a dedicated page (src/pages/TemplateSizesPage.jsx, wired
  // in router.jsx) that sends the exact strict types. This config only supplies
  // nav/permission/endpoints.
  resource({
    key: 'templateSizes',
    name: 'Template Sizes',
    title: 'Template Size',
    path: '/admin/template-sizes',
    permission: 'sizes',
    group: 'Catalog',
  }),

  // Tags are a flat { id, name, created_at } resource (name unique; dup → 409).
  // The generic ResourceManager handles them — name is the only writable field.
  resource({
    key: 'tags',
    name: 'Tags',
    title: 'Tag',
    path: '/admin/tags',
    permission: 'tags',
    idField: 'id',
    group: 'Catalog',
    columns: [
      { dataIndex: 'name', title: 'Name' },
      // Read-only, server-generated public URL key. Not a create/edit field.
      { dataIndex: 'slug', title: 'Slug', type: 'code', width: 200 },
      { dataIndex: 'created_at', title: 'Created', type: 'date', width: 160 },
    ],
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
  }),

  // Assets & Asset Categories have dedicated pages (src/pages/Assets*.jsx →
  // AssetFileUpload + CategoriesManager, wired in router.jsx): a filtered assets
  // table with size-aware (single/multipart) upload and M2M tags, and an
  // imageless category tree. These configs only supply nav/permission/endpoints.
  resource({
    key: 'assets',
    name: 'Assets',
    title: 'Asset',
    path: '/admin/assets',
    permission: 'assets',
    group: 'Catalog',
  }),

  resource({
    key: 'assetCategories',
    name: 'Asset Categories',
    title: 'Asset Category',
    path: '/admin/asset-categories',
    permission: 'assets',
    group: 'Catalog',
  }),

  // Special Events have a dedicated page (src/pages/SpecialEventsPage.jsx →
  // SpecialEventEditorDrawer, wired in router.jsx): a calendar-style list plus a
  // tabbed editor with type, recurring (event_date "MM-DD") vs one-off
  // (full_date) dates, thumbnail + banner upload and design-template linking.
  // There are NO start/end dates — those are not in the API. This config only
  // supplies nav/permission and the generated specialEvents* CRUD endpoints;
  // its `fields`/`columns` are unused.
  resource({
    key: 'specialEvents',
    name: 'Special Events',
    title: 'Special Event',
    path: '/admin/special-events',
    permission: 'events',
    group: 'Content',
  }),

  // Hidden for now — no Banners use case yet. `hidden: true` drops the nav entry
  // and route while keeping the generated banners* endpoints + cache tag, so the
  // menu item can be restored later by removing this flag.
  resource({
    key: 'banners',
    name: 'Banners',
    title: 'Banner',
    path: '/admin/banners',
    permission: 'banners',
    group: 'Content',
    hidden: true,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'image_url', label: 'Image URL', type: 'text' },
      { name: 'link_url', label: 'Link URL', type: 'text' },
      sortField,
      activeField,
    ],
  }),

  // FAQs have a dedicated, merged screen (src/pages/FaqsPage.jsx, wired in
  // router.jsx): FAQs grouped under their category with inline category
  // management, reorder arrows and an add-new-category picker. This config only
  // supplies nav/permission and the generated faqs* CRUD endpoints; its
  // `fields`/`columns` are unused.
  resource({
    key: 'faqs',
    name: 'FAQs',
    title: 'FAQ',
    path: '/admin/faqs',
    permission: 'faqs',
    group: 'Content',
  }),

  // FAQ Categories are managed inline from the merged FAQ screen above — they
  // no longer have a standalone page. `hidden: true` drops the nav entry and
  // route while keeping the generated faqCategories* endpoints + cache tag,
  // which the FAQ screen uses to list/create/rename/delete categories.
  resource({
    key: 'faqCategories',
    name: 'FAQ Categories',
    title: 'FAQ Category',
    path: '/admin/faq-categories',
    permission: 'faqs',
    group: 'Content',
    hidden: true,
  }),

  // Testimonials have a dedicated card-grid screen (src/pages/TestimonialsPage.jsx,
  // wired in router.jsx) with photo upload, star rating and reorder. This config
  // only supplies nav/permission and the generated testimonials* endpoints.
  resource({
    key: 'testimonials',
    name: 'Testimonials',
    title: 'Testimonial',
    path: '/admin/testimonials',
    permission: 'testimonials',
    group: 'Content',
  }),

  resource({
    key: 'plans',
    name: 'Plans',
    title: 'Plan',
    path: '/admin/plans',
    permission: 'plans',
    group: 'Billing',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'price', label: 'Price', type: 'number' },
      sortField,
      activeField,
    ],
  }),

  // Plan Billing Options + Plan Features have no standalone screen — they are
  // managed inline from the Plans page (see PlansPage / PlanEditorDrawer).

  resource({
    key: 'featureTypes',
    name: 'Feature Types',
    title: 'Feature Type',
    path: '/admin/feature-types',
    permission: 'features',
    idField: 'id',
    group: 'Billing',
    columns: [
      { dataIndex: 'key', title: 'Key' },
      { dataIndex: 'label', title: 'Label' },
      { dataIndex: 'data_type', title: 'Data type' },
      { dataIndex: 'reset_period', title: 'Reset period' },
    ],
    fields: [
      { name: 'key', label: 'Key', type: 'text', required: true, help: 'Unique, e.g. exports_per_month' },
      { name: 'label', label: 'Label', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      {
        name: 'reset_period',
        label: 'Reset period',
        type: 'select',
        initialValue: 'never',
        options: ['monthly', 'annual', 'never'].map((v) => ({ label: v, value: v })),
      },
      {
        name: 'data_type',
        label: 'Data type',
        type: 'select',
        initialValue: 'integer',
        options: ['integer', 'boolean'].map((v) => ({ label: v, value: v })),
      },
    ],
  }),

  // Coupons have a dedicated screen (src/pages/CouponsPage.jsx →
  // CouponEditorDrawer, wired in router.jsx): a client-searched/paged table over
  // the unpaginated list with the server-side status/applicable_to/
  // target_audience filters, and an editor that writes the coupon first and its
  // plan scoping (PUT …/plans) second. This config only supplies nav/permission
  // and the generated coupons* CRUD endpoints; its `fields`/`columns` are unused.
  resource({
    key: 'coupons',
    name: 'Coupons',
    title: 'Coupon',
    path: '/admin/coupons',
    permission: 'coupons',
    group: 'Billing',
  }),

  // App Settings has a dedicated, type-aware page (src/pages/AppSettingsPage.jsx,
  // wired in router.jsx) — it does NOT use the generic ResourceManager. This
  // config is kept only so the nav entry, permission gating and the generated
  // appSettings* RTK Query endpoints exist; `columns`/`fields` are unused.
  resource({
    key: 'appSettings',
    name: 'App Settings',
    title: 'App Setting',
    path: '/admin/app-settings',
    permission: 'settings',
    idField: 'id',
    group: 'System',
  }),
];

// Resources backed by the templates table also expose full CRUD, but their list
// view is the dedicated paginated endpoint — handled by the Templates page.

export const RESOURCE_BY_KEY = Object.fromEntries(RESOURCES.map((r) => [r.key, r]));

export { activeColumn };
