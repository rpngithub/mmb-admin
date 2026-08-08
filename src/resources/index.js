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

// The taxonomies below order by `display_order` (not the legacy `sort_order`).
const displayOrderField = {
  name: 'display_order',
  label: 'Display order',
  type: 'number',
};

const displayOrderColumn = {
  dataIndex: 'display_order',
  title: 'Order',
  width: 80,
};

// Server-generated public URL key — read-only, never a create/edit field.
const slugColumn = { dataIndex: 'slug', title: 'Slug', type: 'code', width: 180 };

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

  // Variants & Brand Series (formerly Themes & Theme Groups) have dedicated pages
  // (src/pages/{Variants,BrandSeries}Page.jsx → {Variant,BrandSeries}EditorDrawer,
  // wired in router.jsx): a two-level series→variants view and a flat variants
  // table, with icon/thumbnail upload and the ordered series relations. These
  // configs only supply nav/permission/endpoints; `fields`/`columns` are unused.
  //
  // Gating lives on the VARIANT: plan entitlement and business adoption attach to
  // a variant, never to its parent series.
  resource({
    key: 'brandSeries',
    name: 'Brand Series',
    title: 'Brand Series',
    path: '/admin/brand-series',
    permission: 'brand_series',
    group: 'Catalog',
  }),

  resource({
    key: 'variants',
    name: 'Variants',
    title: 'Variant',
    path: '/admin/variants',
    permission: 'variants',
    group: 'Catalog',
  }),

  // ---- Brand-series / variant taxonomies -----------------------------------
  // All three are the standard generic-CRUD shape with a case-insensitive unique
  // name (duplicate → 409) and a server-generated slug, so they run on the shared
  // ResourceManager. Note the split permission domains: style personalities and
  // colours are governed by `brand_series`, variant badges by `variants`.

  // The strapline under a series name: "Bold • Premium • Confident".
  resource({
    key: 'stylePersonalities',
    name: 'Style Personalities',
    title: 'Style Personality',
    path: '/admin/style-personalities',
    permission: 'brand_series',
    group: 'Catalog',
    columns: [
      { dataIndex: 'name', title: 'Name' },
      slugColumn,
      displayOrderColumn,
      activeColumn,
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      displayOrderField,
      activeField,
    ],
  }),

  // Shared palette — "Gold" resolves to one hex everywhere. hex_code MUST be
  // #RRGGBB; the server returns 400 for anything else, so the field validates it.
  resource({
    key: 'colors',
    name: 'Colours',
    title: 'Colour',
    path: '/admin/colors',
    permission: 'brand_series',
    group: 'Catalog',
    columns: [
      { dataIndex: 'hex_code', title: 'Colour', type: 'color', width: 140 },
      { dataIndex: 'name', title: 'Name' },
      slugColumn,
      displayOrderColumn,
      activeColumn,
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      {
        name: 'hex_code',
        label: 'Hex code',
        type: 'color',
        required: true,
        rules: [{ pattern: /^#[0-9A-Fa-f]{6}$/, message: 'Must be a #RRGGBB hex colour' }],
        help: 'Six-digit hex, e.g. #D4AF37.',
      },
      displayOrderField,
      activeField,
    ],
  }),

  // The chip on a variant card: "Popular", "Fresh", "Dynamic".
  resource({
    key: 'variantBadges',
    name: 'Variant Badges',
    title: 'Variant Badge',
    path: '/admin/variant-badges',
    permission: 'variants',
    group: 'Catalog',
    columns: [
      { dataIndex: 'icon_s3_key', title: 'Icon', type: 'image', width: 80 },
      { dataIndex: 'name', title: 'Name' },
      slugColumn,
      displayOrderColumn,
      activeColumn,
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'icon_s3_key', label: 'Icon', type: 'image', slot: 'variant_badge_icon' },
      displayOrderField,
      activeField,
    ],
  }),

  // CONTENT languages — the list a user picks "Preferred Languages" from, which
  // then filters their template browse. NOT the app's UI language. Dedicated page
  // (src/pages/LanguagesPage.jsx, wired in router.jsx): display_order is set by
  // drag-reorder (PATCH …/reorder), not by a form field, and `code` is a stable
  // key clients hold so it is read-only once created. This config only supplies
  // nav/permission/endpoints; its `fields`/`columns` are unused.
  resource({
    key: 'languages',
    name: 'Languages',
    title: 'Language',
    path: '/admin/languages',
    permission: 'languages',
    group: 'Catalog',
  }),

  // The curated font library users pick from in Brand Kit → Fonts. Dedicated page
  // (src/pages/FontsPage.jsx → FontEditorDrawer, wired in router.jsx): a family is
  // built in three steps (create → upload files → tag script coverage), both
  // sub-resources are full-replace PUTs, and the Flutter-vs-web dual-format rule
  // needs its own gate. This config only supplies nav/permission/endpoints.
  resource({
    key: 'fonts',
    name: 'Fonts',
    title: 'Font',
    path: '/admin/fonts',
    permission: 'fonts',
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
