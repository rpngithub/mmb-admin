import { createApi } from '@reduxjs/toolkit/query/react';
import { baseQueryWithReauth } from './baseQuery';
import { RESOURCES } from '../../resources';

function cleanParams(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

// Tags: one per generic resource key + the special sections.
const GENERIC_TAGS = RESOURCES.map((r) => r.key);
const SPECIAL_TAGS = [
  'Users',
  'Admins',
  'ActivityLogs',
  'Templates',
  'BillingOptions',
  'PlanFeatures',
  'CouponPlans',
];

/**
 * Which list tags a successful (committed) bulk import must invalidate, keyed by
 * the import entity's URL segment. Industries can create new tags; variants can
 * auto-create brand series (the `series` column) — so those refetch too.
 */
const IMPORT_INVALIDATE_TAGS = {
  industries: [
    { type: 'businessCategories', id: 'LIST' },
    { type: 'tags', id: 'LIST' },
  ],
  'template-categories': [{ type: 'templateCategories', id: 'LIST' }],
  variants: [
    { type: 'variants', id: 'LIST' },
    { type: 'brandSeries', id: 'LIST' },
  ],
};

/**
 * Generate the five CRUD endpoints for every generic resource from its config,
 * instead of hand-writing ~19 near-identical endpoint sets.
 */
function buildGenericEndpoints(builder) {
  const endpoints = {};
  for (const r of RESOURCES) {
    const tag = r.key;
    const { list, get, create, update, remove } = r.endpoints;

    endpoints[list] = builder.query({
      query: () => ({ url: r.path }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((row) => ({ type: tag, id: row[r.idField] })),
              { type: tag, id: 'LIST' },
            ]
          : [{ type: tag, id: 'LIST' }],
    });

    endpoints[get] = builder.query({
      query: (id) => ({ url: `${r.path}/${id}` }),
      providesTags: (_result, _error, id) => [{ type: tag, id }],
    });

    endpoints[create] = builder.mutation({
      query: (body) => ({ url: r.path, method: 'POST', body }),
      invalidatesTags: [{ type: tag, id: 'LIST' }],
    });

    endpoints[update] = builder.mutation({
      query: ({ id, body }) => ({ url: `${r.path}/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: tag, id },
        { type: tag, id: 'LIST' },
      ],
    });

    endpoints[remove] = builder.mutation({
      query: (id) => ({ url: `${r.path}/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [
        { type: tag, id },
        { type: tag, id: 'LIST' },
      ],
    });
  }
  return endpoints;
}

export const adminApi = createApi({
  reducerPath: 'adminApi',
  baseQuery: baseQueryWithReauth,
  tagTypes: [...GENERIC_TAGS, ...SPECIAL_TAGS],
  endpoints: (builder) => ({
    // ---- Auth -------------------------------------------------------------
    login: builder.mutation({
      query: (body) => ({ url: '/auth/admin/login', method: 'POST', body }),
      extraOptions: { skipReauth: true, silent: true },
    }),
    logout: builder.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      extraOptions: { skipReauth: true, silent: true },
    }),

    // ---- Users (paginated, no create/delete) ------------------------------
    usersList: builder.query({
      query: (params = {}) => ({ url: '/admin/users', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'Users', id: 'LIST' }],
    }),
    userGet: builder.query({
      query: (uid) => ({ url: `/admin/users/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'Users', id: uid }],
    }),
    userUpdateStatus: builder.mutation({
      query: ({ uid, is_active }) => ({
        url: `/admin/users/${uid}/status`,
        method: 'PATCH',
        body: { is_active },
      }),
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'Users', id: uid },
        { type: 'Users', id: 'LIST' },
      ],
    }),

    // ---- Admins (paginated, create + update) ------------------------------
    adminsList: builder.query({
      query: (params = {}) => ({ url: '/admin/admins', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'Admins', id: 'LIST' }],
    }),
    adminGet: builder.query({
      query: (uid) => ({ url: `/admin/admins/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'Admins', id: uid }],
    }),
    adminCreate: builder.mutation({
      query: (body) => ({ url: '/admin/admins', method: 'POST', body }),
      invalidatesTags: [{ type: 'Admins', id: 'LIST' }],
    }),
    adminUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/admins/${uid}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'Admins', id: uid },
        { type: 'Admins', id: 'LIST' },
      ],
    }),
    // Dedicated, audit-logged activate/deactivate toggle.
    adminUpdateStatus: builder.mutation({
      query: ({ uid, is_active }) => ({
        url: `/admin/admins/${uid}/status`,
        method: 'PATCH',
        body: { is_active },
      }),
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'Admins', id: uid },
        { type: 'Admins', id: 'LIST' },
      ],
    }),

    // ---- Roles: dedicated silent delete -----------------------------------
    // Silent so the Roles page can map the backend's 500 (FK RESTRICT when the
    // role is assigned to an admin) to a clean "role in use" message itself,
    // instead of the generic error notification.
    roleDelete: builder.mutation({
      query: (uid) => ({ url: `/admin/roles/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'roles', id: uid },
        { type: 'roles', id: 'LIST' },
      ],
    }),

    // ---- Plans module: billing options (sub-resource of a plan) -----------
    // Lists are filtered by the plan's NUMERIC id (?plan_id=). The generic
    // factory can't pass that param, so these are dedicated.
    planBillingOptionsByPlan: builder.query({
      query: (planId) => ({
        url: '/admin/plan-billing-options',
        params: cleanParams({ plan_id: planId }),
      }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((r) => ({ type: 'BillingOptions', id: r.id })),
              { type: 'BillingOptions', id: 'LIST' },
            ]
          : [{ type: 'BillingOptions', id: 'LIST' }],
    }),
    billingOptionCreate: builder.mutation({
      query: (body) => ({ url: '/admin/plan-billing-options', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'BillingOptions', id: 'LIST' }],
    }),
    billingOptionUpdate: builder.mutation({
      query: ({ id, body }) => ({
        url: `/admin/plan-billing-options/${id}`,
        method: 'PATCH',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'BillingOptions', id },
        { type: 'BillingOptions', id: 'LIST' },
      ],
    }),
    billingOptionDelete: builder.mutation({
      query: (id) => ({ url: `/admin/plan-billing-options/${id}`, method: 'DELETE' }),
      // silent: the caller maps a 409 (referenced by a subscription) to a clear message.
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, id) => [
        { type: 'BillingOptions', id },
        { type: 'BillingOptions', id: 'LIST' },
      ],
    }),

    // ---- Plans module: plan features (per-plan feature values) -------------
    planFeaturesByPlan: builder.query({
      query: (planId) => ({
        url: '/admin/plan-features',
        params: cleanParams({ plan_id: planId }),
      }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((r) => ({ type: 'PlanFeatures', id: r.id })),
              { type: 'PlanFeatures', id: 'LIST' },
            ]
          : [{ type: 'PlanFeatures', id: 'LIST' }],
    }),
    planFeatureCreate: builder.mutation({
      query: (body) => ({ url: '/admin/plan-features', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PlanFeatures', id: 'LIST' }],
    }),
    planFeatureUpdate: builder.mutation({
      query: ({ id, body }) => ({ url: `/admin/plan-features/${id}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'PlanFeatures', id },
        { type: 'PlanFeatures', id: 'LIST' },
      ],
    }),
    planFeatureDelete: builder.mutation({
      query: (id) => ({ url: `/admin/plan-features/${id}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, id) => [
        { type: 'PlanFeatures', id },
        { type: 'PlanFeatures', id: 'LIST' },
      ],
    }),

    // ---- Plans: dedicated silent mutations (orchestrated by PlanEditor) ----
    planCreate: builder.mutation({
      query: (body) => ({ url: '/admin/plans', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'plans', id: 'LIST' }],
    }),
    planUpdate: builder.mutation({
      query: ({ id, body }) => ({ url: `/admin/plans/${id}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'plans', id },
        { type: 'plans', id: 'LIST' },
      ],
    }),
    planDelete: builder.mutation({
      query: (uid) => ({ url: `/admin/plans/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'plans', id: uid },
        { type: 'plans', id: 'LIST' },
      ],
    }),

    // ---- Activity logs (read-only audit) ----------------------------------
    activityLogsList: builder.query({
      query: (params = {}) => ({ url: '/admin/activity-logs', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'ActivityLogs', id: 'LIST' }],
    }),

    // ---- Templates (paginated list + full CRUD via generic routes) --------
    templatesList: builder.query({
      query: (params = {}) => ({ url: '/admin/templates', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'Templates', id: 'LIST' }],
    }),
    templateGet: builder.query({
      query: (uid) => ({ url: `/admin/templates/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'Templates', id: uid }],
    }),
    templateCreate: builder.mutation({
      query: (body) => ({ url: '/admin/templates', method: 'POST', body }),
      invalidatesTags: [{ type: 'Templates', id: 'LIST' }],
    }),
    templateUpdate: builder.mutation({
      query: ({ id, body }) => ({ url: `/admin/templates/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Templates', id },
        { type: 'Templates', id: 'LIST' },
      ],
    }),
    templateRemove: builder.mutation({
      query: (id) => ({ url: `/admin/templates/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'Templates', id },
        { type: 'Templates', id: 'LIST' },
      ],
    }),

    // ---- Template relations (tags / sizes / variants / industries) ---------
    // GET returns the preselect shape; PUT is a per-key full replace (≥1 key).
    templateRelations: builder.query({
      query: (uid) => ({ url: `/admin/templates/${uid}/relations` }),
      providesTags: (_r, _e, uid) => [{ type: 'Templates', id: `${uid}:rel` }],
    }),
    templateSetRelations: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/templates/${uid}/relations`,
        method: 'PUT',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [{ type: 'Templates', id: `${uid}:rel` }],
    }),

    // ---- Template bundle ingest -------------------------------------------
    // Files are PUT to S3 first (presign target { type:'template_file',
    // template_uid }); confirm then flips templates/<uid>/* pending→active and
    // saves content + thumbnail_s3_key. Reset wipes templates/<uid>/ for a
    // clean re-upload.
    templateBundleConfirm: builder.mutation({
      query: ({ uid, content, thumbnail_filename }) => ({
        url: `/admin/templates/${uid}/bundle/confirm`,
        method: 'POST',
        body: cleanParams({ content, thumbnail_filename }),
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'Templates', id: uid },
        { type: 'Templates', id: 'LIST' },
      ],
    }),
    templateBundleReset: builder.mutation({
      query: (uid) => ({ url: `/admin/templates/${uid}/bundle/reset`, method: 'POST' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [{ type: 'Templates', id: uid }],
    }),

    // ---- Public config feed (cdn_base_url etc.) ---------------------------
    // GET /config is the public, unauthenticated app_settings feed. Used here
    // to resolve cdn_base_url for rendering uploaded category images. Public →
    // no reauth, and silent so a failure doesn't spam a notification.
    publicConfig: builder.query({
      query: () => ({ url: '/config' }),
      extraOptions: { skipReauth: true, silent: true },
    }),

    // ---- Direct-to-S3 uploads (presign → PUT bytes → confirm) -------------
    // Any authenticated admin may call these (no per-resource permission). The
    // PUT of the bytes happens browser→S3 directly (native fetch, not RTKQ).
    // Silent so the upload widget can surface its own messages.
    uploadPresign: builder.mutation({
      query: (body) => ({ url: '/admin/uploads/presign', method: 'POST', body }),
      extraOptions: { silent: true },
    }),
    uploadConfirm: builder.mutation({
      query: (keys) => ({ url: '/admin/uploads/confirm', method: 'POST', body: { keys } }),
      extraOptions: { silent: true },
    }),

    // ---- Business-category tags (full replace) ----------------------------
    // tag_ids are NOT accepted by create/update — they're set via this dedicated
    // route, which returns the category with its refreshed Tags[].
    businessCategorySetTags: builder.mutation({
      query: ({ uid, tag_ids }) => ({
        url: `/admin/business-categories/${uid}/tags`,
        method: 'PUT',
        body: { tag_ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'businessCategories', id: uid },
        { type: 'businessCategories', id: 'LIST' },
      ],
    }),

    // ---- Template categories: homepage drag-reorder -----------------------
    // Bulk, sibling-scoped reorder. Send the FULL ordered list of ONE sibling
    // group's uids (all sharing the same parent_id); the server assigns
    // display_order = 0..n by array position, atomically (all-or-nothing).
    // Mixing parents → 400. Silent: the homepage-categories page does the
    // optimistic cache patch and rolls back + toasts error.message on failure.
    // On success the LIST invalidation reconciles the authoritative order.
    templateCategoriesReorder: builder.mutation({
      query: (ids) => ({
        url: '/admin/template-categories/reorder',
        method: 'PATCH',
        body: { ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'templateCategories', id: 'LIST' }],
    }),

    // ---- Assets: server-filtered list + M2M tags --------------------------
    // The generic assetsList is unfiltered; this variant passes the server
    // filters (category_id / asset_type / status). Shares the `assets` tag so
    // generic asset create/update/delete invalidate it.
    assetsFiltered: builder.query({
      query: (params = {}) => ({ url: '/admin/assets', params: cleanParams(params) }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((r) => ({ type: 'assets', id: r.uid })),
              { type: 'assets', id: 'LIST' },
            ]
          : [{ type: 'assets', id: 'LIST' }],
    }),
    // GET /admin/assets/:uid/tags → asset incl. Tags[] (the list does NOT
    // include tags, so the editor fetches them here).
    assetTags: builder.query({
      query: (uid) => ({ url: `/admin/assets/${uid}/tags` }),
      providesTags: (_r, _e, uid) => [{ type: 'assets', id: uid }],
    }),
    assetSetTags: builder.mutation({
      query: ({ uid, tag_ids }) => ({
        url: `/admin/assets/${uid}/tags`,
        method: 'PUT',
        body: { tag_ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'assets', id: uid },
        { type: 'assets', id: 'LIST' },
      ],
    }),

    // ---- Multipart uploads (large asset files) ----------------------------
    // The single-PUT presign/confirm are shared with categories (uploadPresign
    // / uploadConfirm above). These add the resumable multipart flow. All
    // silent — the upload widget surfaces its own progress/errors.
    multipartInitiate: builder.mutation({
      query: (body) => ({ url: '/admin/uploads/multipart/initiate', method: 'POST', body }),
      extraOptions: { silent: true },
    }),
    multipartPresignParts: builder.mutation({
      query: (body) => ({ url: '/admin/uploads/multipart/presign-parts', method: 'POST', body }),
      extraOptions: { silent: true },
    }),
    multipartComplete: builder.mutation({
      query: (body) => ({ url: '/admin/uploads/multipart/complete', method: 'POST', body }),
      extraOptions: { silent: true },
    }),
    multipartAbort: builder.mutation({
      query: (body) => ({ url: '/admin/uploads/multipart/abort', method: 'POST', body }),
      extraOptions: { silent: true },
    }),

    // ---- FAQ + FAQ categories (merged screen) -----------------------------
    // Dedicated silent mutations so the FAQ screen can map 400 VALIDATION_ERROR
    // (details[].field) and 409 CONFLICT (duplicate category name) to inline
    // form/field errors instead of the generic global notification, and so the
    // reorder arrows can patch the cache optimistically. Records are addressed
    // by uid; bodies carry only contract keys.
    faqCategoryCreate: builder.mutation({
      query: (body) => ({ url: '/admin/faq-categories', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'faqCategories', id: 'LIST' }],
    }),
    faqCategoryUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/faq-categories/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'faqCategories', id: uid },
        { type: 'faqCategories', id: 'LIST' },
        // a category's status/order change re-groups the FAQ list
        { type: 'faqs', id: 'LIST' },
      ],
    }),
    faqCategoryDelete: builder.mutation({
      query: (uid) => ({ url: `/admin/faq-categories/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      // server SET NULLs the FAQs' category_id, so refresh the FAQ list too.
      invalidatesTags: (_r, _e, uid) => [
        { type: 'faqCategories', id: uid },
        { type: 'faqCategories', id: 'LIST' },
        { type: 'faqs', id: 'LIST' },
      ],
    }),

    faqCreate: builder.mutation({
      query: (body) => ({ url: '/admin/faqs', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'faqs', id: 'LIST' }],
    }),
    faqUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/faqs/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'faqs', id: uid },
        { type: 'faqs', id: 'LIST' },
      ],
    }),
    // Single-row display_order (and optional category_id) PATCH for the reorder
    // arrows / cross-group move. Silent: the page does the optimistic cache
    // patch and rolls back + toasts on failure.
    faqReorder: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/faqs/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'faqs', id: 'LIST' }],
    }),
    faqDelete: builder.mutation({
      query: (uid) => ({ url: `/admin/faqs/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'faqs', id: uid },
        { type: 'faqs', id: 'LIST' },
      ],
    }),

    // ---- Testimonials (card grid) -----------------------------------------
    testimonialCreate: builder.mutation({
      query: (body) => ({ url: '/admin/testimonials', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'testimonials', id: 'LIST' }],
    }),
    testimonialUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/testimonials/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'testimonials', id: uid },
        { type: 'testimonials', id: 'LIST' },
      ],
    }),
    testimonialReorder: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/testimonials/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'testimonials', id: 'LIST' }],
    }),
    testimonialDelete: builder.mutation({
      query: (uid) => ({ url: `/admin/testimonials/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'testimonials', id: uid },
        { type: 'testimonials', id: 'LIST' },
      ],
    }),

    // ---- Variants: premium (plan-scoped) surface ---------------------------
    // Dedicated variant update used by the editor (all fields optional). Uses
    // PATCH to match the variant contract; description, badge_id and likes_count
    // are the editable extras beyond the generic create.
    variantUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/variants/${uid}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'variants', id: uid },
        { type: 'variants', id: 'LIST' },
      ],
    }),

    // Variant relations — plan ENTITLEMENT + industry tags.
    // GET → { id, uid, name, Plans:[…], Industries:[…], BusinessCategories:[…]
    //         (deprecated duplicate), VariantBadge:{…} }.
    // PUT is a per-key full replace: each provided key replaces that whole set,
    // an omitted key is left untouched (send plan_ids:[] to clear). Selecting
    // plans is the core premium access control — an EMPTY array locks the variant
    // to everyone; industries are just display/filter tags. Both invalidate the
    // variant's :rel tag so the panels refetch. Silent — the panels surface their
    // own success messages.
    variantRelations: builder.query({
      query: (uid) => ({ url: `/admin/variants/${uid}/relations` }),
      providesTags: (_r, _e, uid) => [{ type: 'variants', id: `${uid}:rel` }],
    }),
    variantSetRelations: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/variants/${uid}/relations`,
        method: 'PUT',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [{ type: 'variants', id: `${uid}:rel` }],
    }),

    // Variant ↔ templates assignment (full replace of template_ids).
    // GET → variant incl. Templates:[{id,uid,name,thumbnail_s3_key,status,template_type}].
    variantTemplates: builder.query({
      query: (uid) => ({ url: `/admin/variants/${uid}/templates` }),
      providesTags: (_r, _e, uid) => [{ type: 'variants', id: `${uid}:tpl` }],
    }),
    variantSetTemplates: builder.mutation({
      query: ({ uid, template_ids }) => ({
        url: `/admin/variants/${uid}/templates`,
        method: 'PUT',
        body: { template_ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [{ type: 'variants', id: `${uid}:tpl` }],
    }),

    // ---- Brand series relations (style personalities / tags / colours) -----
    // GET → { StylePersonalities:[…], Tags:[…], Colors:[…] }.
    // PUT is a per-key full replace over { style_personality_ids, tag_ids,
    // color_ids } — any subset. style_personality_ids and color_ids are ORDERED:
    // array position IS the stored display_order and comes back in that order
    // everywhere including the public API, so drag-to-reorder just re-sends the
    // array. tag_ids is unordered and draws on the SHARED tag pool (the same rows
    // templates and assets use). Silent — the editor owns its messaging.
    brandSeriesRelations: builder.query({
      query: (uid) => ({ url: `/admin/brand-series/${uid}/relations` }),
      providesTags: (_r, _e, uid) => [{ type: 'brandSeries', id: `${uid}:rel` }],
    }),
    brandSeriesSetRelations: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/brand-series/${uid}/relations`,
        method: 'PUT',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [{ type: 'brandSeries', id: `${uid}:rel` }],
    }),

    // ---- Special events (calendar) ----------------------------------------
    // Dedicated silent create/update so the editor can map 409 (duplicate name,
    // case-insensitive) and 400 VALIDATION_ERROR (details[].field) to inline
    // form errors instead of the generic global notification. Addressed by uid;
    // the body carries only contract keys (name, description, type, event_date,
    // full_date, is_recurring, is_active, thumbnail_s3_key, banner_s3_key). The
    // generic specialEventsList/Get/Remove cover list/read/delete.
    specialEventCreate: builder.mutation({
      query: (body) => ({ url: '/admin/special-events', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'specialEvents', id: 'LIST' }],
    }),
    specialEventUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/special-events/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'specialEvents', id: uid },
        { type: 'specialEvents', id: 'LIST' },
      ],
    }),

    // Event ↔ templates linking (full replace of template_ids — NUMERIC ids).
    // GET → event incl. Templates:[{id,uid,name,thumbnail_s3_key,status,template_type}].
    // Sending [] unlinks all. Powers the calendar's "tap an event → its designs".
    specialEventTemplates: builder.query({
      query: (uid) => ({ url: `/admin/special-events/${uid}/templates` }),
      providesTags: (_r, _e, uid) => [{ type: 'specialEvents', id: `${uid}:tpl` }],
    }),
    specialEventSetTemplates: builder.mutation({
      query: ({ uid, template_ids }) => ({
        url: `/admin/special-events/${uid}/templates`,
        method: 'PUT',
        body: { template_ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [{ type: 'specialEvents', id: `${uid}:tpl` }],
    }),

    // ---- Coupons ------------------------------------------------------------
    // The list is NOT paginated (every row comes back), so search + paging are
    // client-side; only the exact-match filters (status / applicable_to /
    // target_audience) are query params. Shares the `coupons` tag with the
    // generic couponsGet/couponsRemove so every coupon mutation refetches it.
    couponsFiltered: builder.query({
      query: (params = {}) => ({ url: '/admin/coupons', params: cleanParams(params) }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((c) => ({ type: 'coupons', id: c.uid })),
              { type: 'coupons', id: 'LIST' },
            ]
          : [{ type: 'coupons', id: 'LIST' }],
    }),

    // Dedicated silent create/update so the editor can map 400 VALIDATION_ERROR
    // (details[].field) and 409 (duplicate code, case-insensitive) onto form
    // items instead of the generic global notification. NOTE: PATCH is validated
    // against the MERGED row — e.g. switching discount_type to `percentage` 400s
    // on discount_value when the STORED value is 150 — so the editor submits the
    // whole form and maps every details[] entry, dirty or not.
    couponCreate: builder.mutation({
      query: (body) => ({ url: '/admin/coupons', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'coupons', id: 'LIST' }],
    }),
    couponUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/coupons/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'coupons', id: uid },
        { type: 'coupons', id: 'LIST' },
      ],
    }),

    // Coupon ↔ plan scoping — the ONLY way to scope a coupon to plans.
    // GET → { id, uid, code, title, applicable_to, plans:[{id,uid,name}] }.
    // PUT is a FULL REPLACE of plan_ids (NUMERIC ids) and owns applicable_to in
    // the same transaction: non-empty → specific_plans, [] → all_plans. We never
    // send applicable_to ourselves on either endpoint — it 400s on the coupon
    // PATCH. Because applicable_to changes as a side effect, the PUT invalidates
    // the coupon row/list too, not just the scoping.
    couponPlans: builder.query({
      query: (uid) => ({ url: `/admin/coupons/${uid}/plans` }),
      providesTags: (_r, _e, uid) => [{ type: 'CouponPlans', id: uid }],
    }),
    couponSetPlans: builder.mutation({
      query: ({ uid, plan_ids }) => ({
        url: `/admin/coupons/${uid}/plans`,
        method: 'PUT',
        body: { plan_ids },
      }),
      // silent: the editor maps the 400 (access-pass plans, details[].field
      // 'plan_ids') onto the picker and the 404 (stale plan list) to a re-pick
      // prompt. Nothing is written on either, so the previous scoping stands.
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'CouponPlans', id: uid },
        { type: 'coupons', id: uid },
        { type: 'coupons', id: 'LIST' },
      ],
    }),

    // ---- Bulk import (CSV) ------------------------------------------------
    // multipart/form-data upload: { file, dry_run? }. We DON'T set Content-Type
    // — passing a FormData body lets the browser add the multipart boundary.
    // Silent so the Import page renders the backend's error.message inline (esp.
    // the 400 "reference template" / missing-column cases and 403). On a real
    // (non-dry-run) commit we invalidate the affected list tags per entity so
    // the corresponding tables refetch; a dry-run writes nothing → no invalidate.
    importUpload: builder.mutation({
      query: ({ entity, file, dryRun }) => {
        const formData = new FormData();
        formData.append('file', file);
        if (dryRun) formData.append('dry_run', '1');
        return { url: `/admin/imports/${entity}`, method: 'POST', body: formData };
      },
      extraOptions: { silent: true },
      invalidatesTags: (_result, error, arg) => {
        if (error || arg.dryRun) return [];
        return IMPORT_INVALIDATE_TAGS[arg.entity] || [];
      },
    }),

    // ---- Generic CRUD resources (generated from config) -------------------
    ...buildGenericEndpoints(builder),
  }),
});

export const {
  useLoginMutation,
  useLogoutMutation,
  useUsersListQuery,
  useUserGetQuery,
  useUserUpdateStatusMutation,
  useAdminsListQuery,
  useAdminGetQuery,
  useAdminCreateMutation,
  useAdminUpdateMutation,
  useAdminUpdateStatusMutation,
  useRoleDeleteMutation,
  usePlanBillingOptionsByPlanQuery,
  useBillingOptionCreateMutation,
  useBillingOptionUpdateMutation,
  useBillingOptionDeleteMutation,
  usePlanFeaturesByPlanQuery,
  usePlanFeatureCreateMutation,
  usePlanFeatureUpdateMutation,
  usePlanFeatureDeleteMutation,
  usePlanCreateMutation,
  usePlanUpdateMutation,
  usePlanDeleteMutation,
  useActivityLogsListQuery,
  useTemplatesListQuery,
  useTemplateGetQuery,
  useTemplateCreateMutation,
  useTemplateUpdateMutation,
  useTemplateRemoveMutation,
  usePublicConfigQuery,
  useUploadPresignMutation,
  useUploadConfirmMutation,
  useBusinessCategorySetTagsMutation,
  useTemplateCategoriesReorderMutation,
  useAssetsFilteredQuery,
  useAssetTagsQuery,
  useAssetSetTagsMutation,
  useMultipartInitiateMutation,
  useMultipartPresignPartsMutation,
  useMultipartCompleteMutation,
  useMultipartAbortMutation,
  useTemplateRelationsQuery,
  useTemplateSetRelationsMutation,
  // Variants (premium, plan-scoped) + brand series relations
  useVariantUpdateMutation,
  useVariantRelationsQuery,
  useVariantSetRelationsMutation,
  useVariantTemplatesQuery,
  useVariantSetTemplatesMutation,
  useBrandSeriesRelationsQuery,
  useBrandSeriesSetRelationsMutation,
  useTemplateBundleConfirmMutation,
  useTemplateBundleResetMutation,
  // FAQ + FAQ categories (merged screen)
  useFaqCategoryCreateMutation,
  useFaqCategoryUpdateMutation,
  useFaqCategoryDeleteMutation,
  useFaqCreateMutation,
  useFaqUpdateMutation,
  useFaqReorderMutation,
  useFaqDeleteMutation,
  // Testimonials
  useTestimonialCreateMutation,
  useTestimonialUpdateMutation,
  useTestimonialReorderMutation,
  useTestimonialDeleteMutation,
  // Special events (calendar)
  useSpecialEventCreateMutation,
  useSpecialEventUpdateMutation,
  useSpecialEventTemplatesQuery,
  useSpecialEventSetTemplatesMutation,
  // Bulk import (CSV)
  useImportUploadMutation,
  // Coupons
  useCouponsFilteredQuery,
  useCouponCreateMutation,
  useCouponUpdateMutation,
  useCouponPlansQuery,
  useCouponSetPlansMutation,
} = adminApi;
