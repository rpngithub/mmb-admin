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
  'TemplateFamily',
  'Frames',
  'BillingOptions',
  'PlanFeatures',
  'CouponPlans',
  'Feedback',
  'QuotaPack',
  'QuotaGrant',
  'NotificationTemplates',
  'NotificationCampaigns',
  'UserNotifications',
  'PageSections',
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
  'asset-categories': [{ type: 'assetCategories', id: 'LIST' }],
  // The assets sheet's `tags` column creates tags it doesn't know yet, so the
  // tag list can move under an assets import too. Asset categories can't: an
  // unknown `category` skips the row rather than creating anything.
  assets: [
    { type: 'assets', id: 'LIST' },
    { type: 'tags', id: 'LIST' },
  ],
};

/**
 * What a version change must refetch: the family (its status may have been
 * moved back to draft by the API, and its readiness changes), its version grid
 * and the design list (counts, languages/sizes, thumbnail, readiness).
 */
function versionChangeTags(familyUid) {
  const tags = [
    { type: 'TemplateFamily', id: 'LIST' },
    { type: 'Templates', id: 'LIST' },
  ];
  if (familyUid) {
    tags.push(
      { type: 'TemplateFamily', id: familyUid },
      { type: 'TemplateFamily', id: `${familyUid}:versions` },
    );
  }
  return tags;
}

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

    // ---- Feature types: meters + silent writes ------------------------------
    // The metered keys an integer feature may use: [{ key, label, unit,
    // reset_periods }]. Only changes with a deploy, so it carries no tag.
    featureTypeMeters: builder.query({
      query: () => ({ url: '/admin/feature-types/meters' }),
    }),
    // Silent twins of the generated featureTypesCreate/Update: the editor shows
    // the 400 (unmetered key / disallowed reset period — `details` is an object
    // there, so it is ignored) and the 409 (duplicate key) as a form-level error.
    featureTypeCreate: builder.mutation({
      query: (body) => ({ url: '/admin/feature-types', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'featureTypes', id: 'LIST' }],
    }),
    featureTypeUpdate: builder.mutation({
      query: ({ id, body }) => ({ url: `/admin/feature-types/${id}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'featureTypes', id },
        { type: 'featureTypes', id: 'LIST' },
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

    // ---- Template families (a DESIGN) ---------------------------------------
    // The family owns everything shared by its versions: name (unique → 409),
    // category, industries, tags, variants, events, type, premium, popular,
    // status and counters. List filters: status, search, category_id,
    // industry_id, variant_id, tags (csv), template_type, is_premium,
    // is_popular, single_version, missing_default_size, limit, offset. Flags
    // are 1 | 0 | omitted — "All" must leave the key out (cleanParams drops
    // undefined), since an empty value would be read as 0.
    //
    // Rows add version_count / active_version_count / tag_count /
    // industry_count (MySQL numbers OR strings — coerce), languages[], sizes[],
    // text_free, thumbnail_s3_key and readiness[{field,message}].
    templateFamiliesList: builder.query({
      query: (params = {}) => ({ url: '/admin/template-families', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: Number(meta?.total ?? (data?.length || 0)),
      }),
      providesTags: (result) => [
        ...(result?.items || []).map((f) => ({ type: 'TemplateFamily', id: f.uid })),
        { type: 'TemplateFamily', id: 'LIST' },
      ],
    }),
    templateFamilyGet: builder.query({
      query: (uid) => ({ url: `/admin/template-families/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'TemplateFamily', id: uid }],
    }),
    // Silent create/update: the design screen maps 409 (duplicate name) and
    // 400 details[] (incl. the publish gate: name / category_id / tag_ids /
    // versions) onto the form and the readiness checklist itself.
    templateFamilyCreate: builder.mutation({
      query: (body) => ({ url: '/admin/template-families', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'TemplateFamily', id: 'LIST' }],
    }),
    templateFamilyUpdate: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/template-families/${uid}`,
        method: 'PATCH',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'TemplateFamily', id: uid },
        { type: 'TemplateFamily', id: 'LIST' },
      ],
    }),
    // The list's Premium / Popular quick-toggles: the same PATCH, but it does
    // NOT invalidate the list — the page patches the one row optimistically, so
    // flagging ten designs in a row never reloads the table ten times. Only the
    // detail cache is invalidated so an open design screen picks it up.
    templateFamilySetFlag: builder.mutation({
      query: ({ uid, field, value }) => ({
        url: `/admin/template-families/${uid}`,
        method: 'PATCH',
        body: { [field]: value ? 1 : 0 },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [{ type: 'TemplateFamily', id: uid }],
    }),
    // Deletes the family AND every version in it.
    templateFamilyRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/template-families/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'TemplateFamily', id: uid },
        { type: 'TemplateFamily', id: 'LIST' },
        { type: 'Templates', id: 'LIST' },
      ],
    }),

    // Family relations. GET → { Tags, Variants, Industries, BusinessCategories
    // (deprecated duplicate) }. PUT is a per-key full replace over { tag_ids,
    // industry_ids, variant_ids }; size_ids is a 400 now (sizes are per
    // version). Tags + industries feed the publish gate, so the family itself
    // (readiness) and the list refetch too.
    templateFamilyRelations: builder.query({
      query: (uid) => ({ url: `/admin/template-families/${uid}/relations` }),
      providesTags: (_r, _e, uid) => [{ type: 'TemplateFamily', id: `${uid}:rel` }],
    }),
    templateFamilySetRelations: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/template-families/${uid}/relations`,
        method: 'PUT',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'TemplateFamily', id: `${uid}:rel` },
        { type: 'TemplateFamily', id: uid },
        { type: 'TemplateFamily', id: 'LIST' },
      ],
    }),

    // Merge a whole design into another. All-or-nothing: any conflict blocks
    // it. `dryRun` returns the plan { version?, source{uid,name,outcome,
    // versions}, target, changes[], conflicts[], applied:false } and writes
    // nothing, so it invalidates nothing. A real merge moves every version and
    // archives the source.
    templateFamilyMerge: builder.mutation({
      query: ({ uid, into_family_uid, dryRun }) => ({
        url: `/admin/template-families/${uid}/merge`,
        method: 'POST',
        params: dryRun ? { dry_run: 1 } : undefined,
        body: { into_family_uid },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, error, { uid, into_family_uid, dryRun }) =>
        error || dryRun
          ? []
          : [
              { type: 'TemplateFamily', id: uid },
              { type: 'TemplateFamily', id: `${uid}:versions` },
              { type: 'TemplateFamily', id: into_family_uid },
              { type: 'TemplateFamily', id: `${into_family_uid}:versions` },
              { type: 'TemplateFamily', id: 'LIST' },
              { type: 'Templates', id: 'LIST' },
            ],
    }),

    // ---- Template versions (one language-or-text-free × one size) ----------
    // A version owns its bundle (content + thumbnail), its status and an
    // optional name label. Rows: id, uid, name, status, language_id, size_id,
    // Language, TemplateSize, family, has_content, has_thumbnail — content is
    // excluded, so nothing here may be PATCHed back wholesale.
    //
    // ANY version change can move the family's status (a live family that
    // loses its last active English/text-free version, in any size, drops back to
    // draft on its own), so every version mutation takes `familyUid` and
    // invalidates that family + the design list as well.
    templateVersionsByFamily: builder.query({
      query: (familyUid) => ({
        url: '/admin/templates',
        params: { family_uid: familyUid, limit: 100 },
      }),
      transformResponse: (data) => data || [],
      providesTags: (result, _e, familyUid) => [
        ...(result || []).map((v) => ({ type: 'Templates', id: v.uid })),
        { type: 'TemplateFamily', id: `${familyUid}:versions` },
        { type: 'Templates', id: 'LIST' },
      ],
    }),
    // Body: { family_id (numeric), language_id (id | null = text-free), size_id }.
    // Always born a draft. 409 = slot taken; 400 = mixing text-free/languages.
    templateVersionCreate: builder.mutation({
      query: ({ body }) => ({ url: '/admin/templates', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { familyUid }) => versionChangeTags(familyUid),
    }),
    // { status } to publish/unpublish (400 details: content / thumbnail_s3_key
    // / size_id), or { language_id, size_id } to re-slot it (409 if taken).
    templateVersionUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/templates/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid, familyUid }) => [
        { type: 'Templates', id: uid },
        ...versionChangeTags(familyUid),
      ],
    }),
    templateVersionRemove: builder.mutation({
      query: ({ uid }) => ({ url: `/admin/templates/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid, familyUid }) => [
        { type: 'Templates', id: uid },
        ...versionChangeTags(familyUid),
      ],
    }),
    // Move one version into another design (the target's details win). Same
    // dry-run plan shape as the merge. A 409 carries the conflicts in details.
    // The version's uid never changes, so users' projects keep working.
    templateVersionMove: builder.mutation({
      query: ({ uid, family_uid, dryRun }) => ({
        url: `/admin/templates/${uid}/move`,
        method: 'POST',
        params: dryRun ? { dry_run: 1 } : undefined,
        body: { family_uid },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, error, { uid, family_uid, familyUid, dryRun }) =>
        error || dryRun
          ? []
          : [
              { type: 'Templates', id: uid },
              ...versionChangeTags(familyUid),
              ...versionChangeTags(family_uid),
            ],
    }),

    // ---- Template bundle ingest (per VERSION) -------------------------------
    // Files are PUT to S3 first (presign target { type:'template_file',
    // template_uid: <version uid> }); confirm then flips templates/<uid>/*
    // pending→active and saves content + thumbnail_s3_key. Reset wipes
    // templates/<uid>/ for a clean re-upload — and 409s while other versions
    // (cloned by the migration from multi-size templates) still use its files.
    // `familyUid` is only used for invalidation: the design list shows the
    // default version's thumbnail.
    templateBundleConfirm: builder.mutation({
      query: ({ uid, content, thumbnail_filename }) => ({
        url: `/admin/templates/${uid}/bundle/confirm`,
        method: 'POST',
        body: cleanParams({ content, thumbnail_filename }),
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid, familyUid }) => [
        { type: 'Templates', id: uid },
        ...versionChangeTags(familyUid),
      ],
    }),
    templateBundleReset: builder.mutation({
      query: ({ uid }) => ({ url: `/admin/templates/${uid}/bundle/reset`, method: 'POST' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid, familyUid }) => [
        { type: 'Templates', id: uid },
        ...versionChangeTags(familyUid),
      ],
    }),

    // ---- Frames (paged list + full CRUD) ----------------------------------
    // The branded border a user puts over a design, sold PER FRAME: `is_premium`
    // + `price` are the whole access model — there is no frames↔plans link in the
    // API and a subscription never unlocks one.
    //
    // The list omits `content` (and adds has_content / has_thumbnail 1|0,
    // is_publishable boolean, missing_for_publish[{field,message}]), so the editor
    // ALWAYS reads frameGet — binding a form to a list row would PATCH an empty
    // design payload over a real one.
    framesList: builder.query({
      query: (params = {}) => ({ url: '/admin/frames', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'Frames', id: 'LIST' }],
    }),
    frameGet: builder.query({
      query: (uid) => ({ url: `/admin/frames/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'Frames', id: uid }],
    }),
    // Silent create/update so the editor can map 400 VALIDATION_ERROR
    // (details[].field) and 409 CONFLICT (`name` is globally unique,
    // case-insensitive) onto the offending form item instead of the generic
    // global notification. The PATCH is also the publish/unpublish call —
    // { status:'active' } runs the server-side gate and returns one details[]
    // entry per unmet requirement.
    frameCreate: builder.mutation({
      query: (body) => ({ url: '/admin/frames', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'Frames', id: 'LIST' }],
    }),
    frameUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/frames/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'Frames', id: uid },
        { type: 'Frames', id: 'LIST' },
      ],
    }),
    // Hard delete, and silent on purpose: the database REFUSES to delete a frame
    // any user owns (409 CONFLICT) so nobody loses something they paid for. The
    // page turns that into the "retire it instead" route rather than a red toast.
    frameRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/frames/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'Frames', id: uid },
        { type: 'Frames', id: 'LIST' },
      ],
    }),
    // Bulk reorder — array position becomes display_order FOR THE SUBMITTED UIDS
    // ONLY, in one all-or-nothing transaction. Sending a partial list (one page,
    // a filtered view) hands those rows positions 0..n that collide with rows it
    // didn't include, so the page only enables dragging on the complete,
    // unfiltered, unpaginated list. Takes uids, not numeric ids; one unknown id
    // 404s the whole batch and changes nothing. Silent: the page patches the
    // cache optimistically and rolls back + toasts error.message on failure.
    framesReorder: builder.mutation({
      query: (ids) => ({ url: '/admin/frames/reorder', method: 'PATCH', body: { ids } }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'Frames', id: 'LIST' }],
    }),

    // ---- Frame categories --------------------------------------------------
    // The filter chips users tap in the store: flat (no parent_id), short enough
    // to come back unpaginated, and ordered by drag. Same `frames.*` permission
    // domain as the frames themselves. List/get/delete run on the generated
    // frameCategories* endpoints; create/update are dedicated + silent so the
    // editor maps details[].field and a duplicate-name 409 onto the form.
    frameCategoryCreate: builder.mutation({
      query: (body) => ({ url: '/admin/frame-categories', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'frameCategories', id: 'LIST' }],
    }),
    frameCategoryUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/frame-categories/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'frameCategories', id: uid },
        { type: 'frameCategories', id: 'LIST' },
        // A renamed/retired category shows up in the frames list's Category column.
        { type: 'Frames', id: 'LIST' },
      ],
    }),
    frameCategoriesReorder: builder.mutation({
      query: (ids) => ({
        url: '/admin/frame-categories/reorder',
        method: 'PATCH',
        body: { ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'frameCategories', id: 'LIST' }],
    }),

    // ---- Top-up packs (paged list + full CRUD) -----------------------------
    // A pack is extra headroom on a feature, bought outright on top of whatever
    // the user's plan allows. Packs are NOT tied to plans — there is no
    // packs↔plans relationship in the API — and a purchase NEVER expires: it
    // survives the monthly reset and a lapsed subscription. That is why pulling
    // or deleting a pack is never a clawback.
    //
    // Permission domain is `quota_packs`, deliberately NOT a content domain:
    // pricing is commerce, so a content_admin legitimately gets 403 here.
    //
    // Every LIST row carries `is_publishable` + `missing_for_publish`
    // [{field,message}] computed by the same server function as the publish
    // gate, so the UI never re-derives the rules. GET /:uid does NOT carry them.
    quotaPacksList: builder.query({
      query: (params = {}) => ({ url: '/admin/quota-packs', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: (result) => [
        { type: 'QuotaPack', id: 'LIST' },
        ...(result?.items || []).map((p) => ({ type: 'QuotaPack', id: p.uid })),
      ],
    }),
    quotaPackGet: builder.query({
      query: (uid) => ({ url: `/admin/quota-packs/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'QuotaPack', id: uid }],
    }),
    // Silent create/update so the editor maps 400 VALIDATION_ERROR
    // (details[].field) and 409 CONFLICT (`name` is unique case-insensitively)
    // onto the offending form item instead of the global notification.
    //
    // POST returns the bare row WITHOUT the nested FeatureType, while PATCH and
    // GET /:uid include it — hence a plain LIST invalidation after a create
    // rather than merging the response into the cache.
    quotaPackCreate: builder.mutation({
      query: (body) => ({ url: '/admin/quota-packs', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'QuotaPack', id: 'LIST' }],
    }),
    // Also the publish/unpublish call: { status:'active' } runs the server-side
    // gate, which judges the state the row would have AFTER the write — so the
    // missing fields and the status can go up in one PATCH.
    quotaPackUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/quota-packs/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'QuotaPack', id: uid },
        { type: 'QuotaPack', id: 'LIST' },
      ],
    }),
    // Hard delete. A pack that has been sold CAN be deleted: the grants survive
    // (their quantity was snapshotted at purchase) and just lose the link back,
    // which loses the per-pack revenue reporting — so the page defaults the
    // retire action to status:'inactive' and keeps this as the confirmed
    // secondary action.
    quotaPackRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/quota-packs/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'QuotaPack', id: uid },
        { type: 'QuotaPack', id: 'LIST' },
      ],
    }),
    // Bulk reorder — array position becomes display_order, in one all-or-nothing
    // transaction. Takes uids, not numeric ids. A 404 means one uid no longer
    // exists and NOTHING was written, so the page refetches rather than retrying
    // the same array. Silent: the page patches the cache optimistically and
    // rolls back + toasts on failure.
    quotaPacksReorder: builder.mutation({
      query: (ids) => ({ url: '/admin/quota-packs/reorder', method: 'PATCH', body: { ids } }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'QuotaPack', id: 'LIST' }],
    }),

    // ---- Quota grants (support tab on the user detail screen) --------------
    // A grant is one block of quota a user holds — bought through the store, or
    // issued by support. The user's balance for a feature IS the sum over their
    // active grants, so this list is the balance rather than a report of it.
    // Reading and granting need `quota_packs.update`; revoking needs
    // `quota_packs.delete`.
    userQuotaGrants: builder.query({
      query: (userUid) => ({ url: `/admin/users/${userUid}/quota-grants` }),
      providesTags: (_r, _e, userUid) => [{ type: 'QuotaGrant', id: userUid }],
    }),
    // `feature` is the feature-type KEY (a string), not the numeric id — the one
    // endpoint in this pair keyed that way, because a human types it. The grant
    // is active immediately: there is no payment to wait for. Silent so the form
    // can pin a 400/404 onto the field that caused it.
    quotaGrantCreate: builder.mutation({
      query: ({ userUid, body }) => ({
        url: `/admin/users/${userUid}/quota-grants`,
        method: 'POST',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { userUid }) => [{ type: 'QuotaGrant', id: userUid }],
    }),
    // Revoke — sets the grant to `revoked` and KEEPS the row as the audit
    // record. `uid` here is the GRANT's uid; `userUid` is carried only to
    // invalidate the right user's list. Idempotent (a second revoke still 200s),
    // and 409 for a `pending` grant — which the panel prevents by disabling the
    // action on non-active rows.
    quotaGrantRevoke: builder.mutation({
      query: ({ uid }) => ({ url: `/admin/quota-grants/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { userUid }) => [{ type: 'QuotaGrant', id: userUid }],
    }),

    // ---- Public config feed (cdn_base_url etc.) ---------------------------
    // GET /config is the public, unauthenticated app_settings feed. Used here
    // to resolve cdn_base_url for rendering uploaded category images. Public →
    // no reauth, and silent so a failure doesn't spam a notification.
    // Also the source of `default_template_size` (a size slug) for the design
    // screen's "Preferred on cards" column — so it shares the appSettings LIST tag and
    // refetches whenever a setting is edited here.
    publicConfig: builder.query({
      query: () => ({ url: '/config' }),
      extraOptions: { skipReauth: true, silent: true },
      providesTags: [{ type: 'appSettings', id: 'LIST' }],
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

    // ---- Industry ↔ related industries (curated SEO block) ----------------
    // The block of internal links at the bottom of an industry's public landing
    // page. Two properties drive the whole UI:
    //   • ONE-WAY — Restaurant → [Cafe] does NOT put Restaurant in Cafe's block.
    //     A mutual link is two separate edits, on purpose.
    //   • ORDERED — array position IS the order the block renders in, and the GET
    //     returns RelatedIndustries already sorted, so never re-sort it.
    // The PUT is a full replace over numeric `id`s (NOT uids); [] clears the
    // block, ids must be unique, and `related_industry_ids` must be the ONLY key
    // (unknown keys → 400; the `related_category_ids` alias is deprecated). Its
    // response echoes the GET shape, so we patch that cache entry from it instead
    // of refetching. No scalar column changes → the industry list/detail queries
    // are deliberately NOT invalidated. Silent: the editor renders error.message
    // and details[] on the field, and maps 404 to a stale-options recovery.
    businessCategoryRelated: builder.query({
      query: (uid) => ({ url: `/admin/business-categories/${uid}/related` }),
      providesTags: (_r, _e, uid) => [{ type: 'businessCategories', id: `${uid}:related` }],
    }),
    businessCategorySetRelated: builder.mutation({
      query: ({ uid, related_industry_ids }) => ({
        url: `/admin/business-categories/${uid}/related`,
        method: 'PUT',
        body: { related_industry_ids },
      }),
      extraOptions: { silent: true },
      async onQueryStarted({ uid }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(adminApi.util.updateQueryData('businessCategoryRelated', uid, () => data));
        } catch {
          // Rejected → nothing was written (a 404 rejects the WHOLE batch), so the
          // cached block still matches the server. Never patch optimistically.
        }
      },
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

    // ---- Assets: "missing files" audit -----------------------------------
    // The API HEADs every asset's s3_key / thumbnail_s3_key against the bucket
    // and reports the rows whose file is confirmed gone. The FE never decides
    // what is missing — it renders `data.missing` as returned. Both calls take
    // the same optional filters (category_id — 0 = uncategorised — and
    // asset_type). Silent: the drawer shows the readable 400s inline.
    //
    // The scan is a mutation on purpose even though it is a GET: it is an
    // explicit action that must run fresh each time (a cached report would
    // put a stale count in the delete confirm), and it must not be refetched
    // by tag invalidation. It writes nothing, so it invalidates nothing.
    assetsMissingFilesScan: builder.mutation({
      query: (params = {}) => ({ url: '/admin/assets/missing-files', params: cleanParams(params) }),
      extraOptions: { silent: true },
    }),
    // Re-scans with the same filters and deletes exactly the confirmed rows.
    // Same shape back, plus summary.deleted; `missing` is then the deleted list.
    assetsMissingFilesDelete: builder.mutation({
      query: (params = {}) => ({
        url: '/admin/assets/missing-files',
        method: 'DELETE',
        params: cleanParams(params),
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, error) => (error ? [] : [{ type: 'assets', id: 'LIST' }]),
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

    // Variant ↔ DESIGNS assignment (full replace of family_ids — numeric
    // design ids). GET → variant incl. TemplateFamilies:[{id,uid,name,status,
    // template_type,is_premium}]. The legacy { template_ids } body still works
    // server-side (each resolves to its design) but is no longer sent.
    variantTemplates: builder.query({
      query: (uid) => ({ url: `/admin/variants/${uid}/templates` }),
      providesTags: (_r, _e, uid) => [{ type: 'variants', id: `${uid}:tpl` }],
    }),
    variantSetTemplates: builder.mutation({
      query: ({ uid, family_ids }) => ({
        url: `/admin/variants/${uid}/templates`,
        method: 'PUT',
        body: { family_ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'variants', id: `${uid}:tpl` },
        { type: 'TemplateFamily', id: 'LIST' },
      ],
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

    // Event ↔ DESIGNS linking (full replace of family_ids — NUMERIC design ids).
    // GET → event incl. TemplateFamilies:[{id,uid,name,status,template_type,
    // is_premium}]. Sending [] unlinks all. Powers the calendar's "tap an event
    // → its designs". The legacy { template_ids } body is no longer sent.
    specialEventTemplates: builder.query({
      query: (uid) => ({ url: `/admin/special-events/${uid}/templates` }),
      providesTags: (_r, _e, uid) => [{ type: 'specialEvents', id: `${uid}:tpl` }],
    }),
    specialEventSetTemplates: builder.mutation({
      query: ({ uid, family_ids }) => ({
        url: `/admin/special-events/${uid}/templates`,
        method: 'PUT',
        body: { family_ids },
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

    // ---- Languages (CONTENT languages) --------------------------------------
    // The list a user picks "Preferred Languages" from; their template browse is
    // then filtered to those. NOT the app's UI language.
    //
    // The generic languagesList is unfiltered on purpose — the management screen
    // must see the inactive ones to reactivate them. This variant passes
    // ?is_active=1 for the *pickers* (template language, font script coverage),
    // which must only offer live languages. Shares the `languages` tag so every
    // language mutation refetches both.
    languagesFiltered: builder.query({
      query: (params = {}) => ({ url: '/admin/languages', params: cleanParams(params) }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((l) => ({ type: 'languages', id: l.uid })),
              { type: 'languages', id: 'LIST' },
            ]
          : [{ type: 'languages', id: 'LIST' }],
    }),

    // Dedicated silent create/update so the editor can map 409 CONFLICT (`code`
    // and `name` are both unique) and 400 VALIDATION_ERROR (details[].field) onto
    // the offending form field instead of the generic global notification.
    // `code` is a stable key clients hold, so update never sends it.
    languageCreate: builder.mutation({
      query: (body) => ({ url: '/admin/languages', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'languages', id: 'LIST' }],
    }),
    languageUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/languages/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'languages', id: uid },
        { type: 'languages', id: 'LIST' },
      ],
    }),

    // Bulk reorder — send the FULL ordered list of uids; array position becomes
    // display_order. That order IS what the app's language picker renders, so this
    // is a real feature, not a nicety. Silent: the page patches the cache
    // optimistically and rolls back + toasts error.message on failure.
    languagesReorder: builder.mutation({
      query: (ids) => ({ url: '/admin/languages/reorder', method: 'PATCH', body: { ids } }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'languages', id: 'LIST' }],
    }),

    // ---- Fonts (curated library) --------------------------------------------
    // LIBRARY fonts only. Users can upload their own; those live in the same table
    // but are private to them and are never returned here. A row arrives with its
    // FontFiles[] ({weight,style,format,s3_key}) and Languages[] already joined —
    // which is what lets the list column flag the dual-format problem per family.
    // The list itself is the generic (unfiltered) fontsList: the screen manages
    // inactive families too, and its drag-reorder must send EVERY uid.
    //
    // Silent create/update so the editor can map 409 (duplicate `family` — unique
    // among library fonts only) onto the family field.
    fontCreate: builder.mutation({
      query: (body) => ({ url: '/admin/fonts', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'fonts', id: 'LIST' }],
    }),
    fontUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/fonts/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'fonts', id: uid },
        { type: 'fonts', id: 'LIST' },
      ],
    }),
    fontsReorder: builder.mutation({
      query: (ids) => ({ url: '/admin/fonts/reorder', method: 'PATCH', body: { ids } }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'fonts', id: 'LIST' }],
    }),

    // Both sub-resources are FULL REPLACES — send every file / language the family
    // should end up with, not just the new ones. Files are (weight, style, format,
    // s3_key) rows; s3_key comes from the presign→PUT→confirm flow with target
    // { type:'image_slot', slot:'font_file' } and must land under `fonts/`.
    // Silent — the editor owns its messaging and error mapping.
    fontSetFiles: builder.mutation({
      query: ({ uid, files }) => ({
        url: `/admin/fonts/${uid}/files`,
        method: 'PUT',
        body: { files },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'fonts', id: uid },
        { type: 'fonts', id: 'LIST' },
      ],
    }),
    // "This font can DRAW these scripts". EMPTY means unspecified → the font is
    // offered for EVERY language, so empty is permissive, not restrictive.
    fontSetLanguages: builder.mutation({
      query: ({ uid, language_ids }) => ({
        url: `/admin/fonts/${uid}/languages`,
        method: 'PUT',
        body: { language_ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'fonts', id: uid },
        { type: 'fonts', id: 'LIST' },
      ],
    }),

    // ---- Industry suggestions (moderation queue) ----------------------------
    // Server-filtered industries list — the queue passes ?status=pending. The
    // generic businessCategoriesList is unfiltered (and is what the Industries
    // tree renders); this shares the `businessCategories` tag so an approve/reject
    // refetches both the queue and the tree.
    businessCategoriesFiltered: builder.query({
      query: (params = {}) => ({
        url: '/admin/business-categories',
        params: cleanParams(params),
      }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((c) => ({ type: 'businessCategories', id: c.uid })),
              { type: 'businessCategories', id: 'LIST' },
            ]
          : [{ type: 'businessCategories', id: 'LIST' }],
    }),

    // The moderation verdict, and the ONLY way to approve. `status` and
    // `is_active` are deliberately separate: sending { status:'approved' } flips
    // is_active to 1 for you, while sending is_active by hand does NOT approve —
    // that's what lets an admin retire an approved industry later without it
    // dropping back into the queue. Silent so the queue can report per-row
    // failures across a bulk action instead of N global notifications.
    businessCategorySetStatus: builder.mutation({
      query: ({ uid, status }) => ({
        url: `/admin/business-categories/${uid}`,
        method: 'PATCH',
        body: { status },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'businessCategories', id: uid },
        { type: 'businessCategories', id: 'LIST' },
      ],
    }),

    // ---- Feedback (read + delete only) --------------------------------------
    // In-app 1–5 emoji rating plus an optional note, signed-in users only. There
    // is NO create and NO edit: POST /admin/feedback returns 404 by design,
    // because an editable record of what a user said is not a record. Rows carry
    // the submitter's name/phone/email, hence the super_admin-only permission.
    feedbackList: builder.query({
      query: (params = {}) => ({ url: '/admin/feedback', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'Feedback', id: 'LIST' }],
    }),
    // Spam removal only — the page confirms first.
    feedbackDelete: builder.mutation({
      query: (uid) => ({ url: `/admin/feedback/${uid}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Feedback', id: 'LIST' }],
    }),

    // ---- Notification categories -------------------------------------------
    // The bucket a notification belongs to, and the thing a USER MUTES — which
    // is why renaming one is the common edit and creating one is rare. Ten are
    // seeded. List/get/delete run on the generated notificationCategories*
    // endpoints; create/update are dedicated + silent so the editor maps a
    // duplicate-name 409 (case-insensitive) and details[].field onto the form.
    //
    // `slug` is auto-derived from `name` ON CREATE ONLY and is NEVER re-derived
    // on a rename — an existing slug is a key clients and dedupe keys hold. To
    // change it you pass one explicitly, which is a separate, deliberate act.
    notificationCategoryCreate: builder.mutation({
      query: (body) => ({ url: '/admin/notification-categories', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'notificationCategories', id: 'LIST' }],
    }),
    notificationCategoryUpdate: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/notification-categories/${uid}`,
        method: 'PATCH',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'notificationCategories', id: uid },
        { type: 'notificationCategories', id: 'LIST' },
        // A renamed/retired category shows in the templates list's Category column.
        { type: 'NotificationTemplates', id: 'LIST' },
      ],
    }),
    // Bulk reorder — send the FULL ordered list of uids; array position becomes
    // display_order, in one all-or-nothing transaction. Silent: the page patches
    // the cache optimistically and rolls back + toasts error.message on failure.
    notificationCategoriesReorder: builder.mutation({
      query: (ids) => ({
        url: '/admin/notification-categories/reorder',
        method: 'PATCH',
        body: { ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'notificationCategories', id: 'LIST' }],
    }),

    // ---- Notification templates ---------------------------------------------
    // 43 rows ship built in (`is_system: true`). For those, `code`,
    // `trigger_type` and `trigger_config` are immutable — a PATCH changing any of
    // them returns 403 — but everything else (title, body, CTA, image, audience,
    // throttle, is_active) is editable, which is the entire point of the screen.
    //
    // NOT PAGINATED: every row comes back in one call, with no meta.total, no
    // limit and no offset. 43 templates, so the screen filters and sorts them
    // client-side. Each row carries its category nested as NotificationCategory.
    //
    // TWO RETURNED FIELDS ARE NEVER SENT BACK. `variables` is server-owned (on a
    // built-in row it is the fixed set of placeholders that notification can
    // fill; on a custom one it is derived from the text) and `priority` is an
    // internal send-order tiebreak. Either one in a body is a 400 "is not
    // allowed", so bodies are built from an explicit whitelist rather than from a
    // fetched row. Silent create/update: the placeholder 400 names both the bad
    // token and every valid one, and is shown verbatim.
    notificationTemplatesList: builder.query({
      query: (params = {}) => ({
        url: '/admin/notification-templates',
        params: cleanParams(params),
      }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((t) => ({ type: 'NotificationTemplates', id: t.uid })),
              { type: 'NotificationTemplates', id: 'LIST' },
            ]
          : [{ type: 'NotificationTemplates', id: 'LIST' }],
    }),
    notificationTemplateGet: builder.query({
      query: (uid) => ({ url: `/admin/notification-templates/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'NotificationTemplates', id: uid }],
    }),
    notificationTemplateCreate: builder.mutation({
      query: (body) => ({ url: '/admin/notification-templates', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'NotificationTemplates', id: 'LIST' }],
    }),
    notificationTemplateUpdate: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/notification-templates/${uid}`,
        method: 'PATCH',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'NotificationTemplates', id: uid },
        { type: 'NotificationTemplates', id: 'LIST' },
      ],
    }),
    // SOFT delete: returns 200 but sets is_active = 0 rather than removing the
    // row, so the template comes back in the list with an "Inactive" tag. The UI
    // calls it Deactivate, because that is what it does.
    notificationTemplateRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/notification-templates/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'NotificationTemplates', id: uid },
        { type: 'NotificationTemplates', id: 'LIST' },
      ],
    }),

    // ---- Notification campaigns (super_admin only) --------------------------
    // Permission domain `notification_campaigns`, NOT `notifications`: a
    // content_admin gets 403 on every endpoint below, so the nav item and route
    // are hidden from them rather than leading to a dead screen.
    //
    // `status` is NOT editable via PATCH. It moves only through schedule /
    // send-now / cancel, along draft → scheduled → sending → sent, with
    // cancelled / failed as terminal outcomes. A campaign past draft/scheduled
    // cannot be edited at all — PATCH returns 403 — so the editor goes read-only
    // and offers "Duplicate into a new draft" instead.
    //
    // NOT PAGINATED — filters are `status` and `template_id`, everything else is
    // client-side.
    notificationCampaignsList: builder.query({
      query: (params = {}) => ({
        url: '/admin/notification-campaigns',
        params: cleanParams(params),
      }),
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map((c) => ({ type: 'NotificationCampaigns', id: c.uid })),
              { type: 'NotificationCampaigns', id: 'LIST' },
            ]
          : [{ type: 'NotificationCampaigns', id: 'LIST' }],
    }),
    notificationCampaignGet: builder.query({
      query: (uid) => ({ url: `/admin/notification-campaigns/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'NotificationCampaigns', id: uid }],
    }),
    // Silent: campaign 400s are explanatory (the rejected audience key, the
    // {{placeholder}} that can't be in campaign copy) and are shown verbatim.
    notificationCampaignCreate: builder.mutation({
      query: (body) => ({ url: '/admin/notification-campaigns', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'NotificationCampaigns', id: 'LIST' }],
    }),
    notificationCampaignUpdate: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/notification-campaigns/${uid}`,
        method: 'PATCH',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'NotificationCampaigns', id: uid },
        { type: 'NotificationCampaigns', id: 'LIST' },
      ],
    }),
    notificationCampaignRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/notification-campaigns/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'NotificationCampaigns', id: uid },
        { type: 'NotificationCampaigns', id: 'LIST' },
      ],
    }),

    // The preview is a REQUIRED step, not a nicety: it returns audience_count,
    // a sample of recipients, the resolved copy, and a `note` explaining why the
    // delivered count will be lower than the count shown. Send/Schedule stay
    // disabled until it has been run, so nobody files "sent 8,412 of 10,000" as a
    // bug when it is the fatigue and consent gates working as designed.
    //
    // A mutation rather than a query despite being a GET: it must be run on
    // demand (and re-run after an edit), never served from cache as if it were
    // still current.
    notificationCampaignPreview: builder.mutation({
      query: (uid) => ({ url: `/admin/notification-campaigns/${uid}/preview` }),
      extraOptions: { silent: true },
    }),
    // `scheduled_at` must be in the future. Scheduling SNAPSHOTS the previewed
    // count into audience_count.
    notificationCampaignSchedule: builder.mutation({
      query: ({ uid, scheduled_at }) => ({
        url: `/admin/notification-campaigns/${uid}/schedule`,
        method: 'POST',
        body: { scheduled_at },
      }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'NotificationCampaigns', id: uid },
        { type: 'NotificationCampaigns', id: 'LIST' },
      ],
    }),
    // "Send now" QUEUES the campaign — a job writes it out in batches every 5
    // minutes, so this does not mean "sent within a second". The list polls the
    // climbing counters while a campaign is `sending`.
    notificationCampaignSendNow: builder.mutation({
      query: (uid) => ({ url: `/admin/notification-campaigns/${uid}/send-now`, method: 'POST' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'NotificationCampaigns', id: uid },
        { type: 'NotificationCampaigns', id: 'LIST' },
      ],
    }),
    notificationCampaignCancel: builder.mutation({
      query: (uid) => ({ url: `/admin/notification-campaigns/${uid}/cancel`, method: 'POST' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'NotificationCampaigns', id: uid },
        { type: 'NotificationCampaigns', id: 'LIST' },
      ],
    }),

    // ---- Delivery log (read-only) -------------------------------------------
    // An inbox row records something that HAPPENED, so there is no create, edit
    // or delete here by design — editing one would make the audit trail
    // worthless. This is the screen that answers "the customer says they never
    // got it". The ONE paginated list in this section (limit default 50, max
    // 100), newest first; rows carry the template code and the recipient's
    // name/phone. Reached from a user, a campaign or a template with the
    // corresponding filter pre-applied.
    userNotificationsList: builder.query({
      query: (params = {}) => ({ url: '/admin/user-notifications', params: cleanParams(params) }),
      transformResponse: (data, meta) => ({
        items: data || [],
        total: meta?.total ?? (data?.length || 0),
      }),
      providesTags: [{ type: 'UserNotifications', id: 'LIST' }],
    }),

    // ---- Page content (the copy under the template grid on industry pages) ---
    // A section (block) lives at one of two levels: a DEFAULT
    // (business_category_id null) shown on every industry page, or an OVERRIDE
    // (business_category_id set) that replaces that ONE block on that ONE page.
    // Resolution is per block, so Travel can own "content_ideas" and still
    // inherit "why_choose". Copy may carry {{industry}} / {{industry_lower}},
    // which the server fills in per page.
    //
    // NOT paginated. Every section row carries its ordered `items` and its
    // `BusinessCategory` (null on a default), so one call renders a whole block.
    // `page_key` is always "industry" today and is sent on every call; a home or
    // pricing page can be added later without an admin-panel release.
    //
    // One tag for the lot: any write to a section or an item can change the
    // resolved page, the per-industry override counts AND the preview, so they
    // all refetch together rather than tracking which of three lists moved.
    //
    // All silent: the 400s are explanatory (a section_key that is not
    // lowercase snake_case, an item with no content, an empty PATCH) and are
    // shown verbatim; a 409 means the view is stale and the page refetches.
    pageSectionsList: builder.query({
      // Pass business_category_id as the literal string "null" for the defaults
      // — cleanParams drops a real null, so the caller spells it out.
      query: (params = {}) => ({ url: '/admin/page-sections', params: cleanParams(params) }),
      providesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionGet: builder.query({
      query: (uid) => ({ url: `/admin/page-sections/${uid}` }),
      providesTags: (_r, _e, uid) => [{ type: 'PageSections', id: uid }],
    }),
    // The RESOLVED page for one industry, exactly as the website receives it:
    // defaults and overrides already merged, tokens substituted, hidden blocks
    // dropped, each section flagged `inherited: true | false`.
    pageSectionsPreview: builder.query({
      query: (params = {}) => ({
        url: '/admin/page-sections/preview',
        params: cleanParams(params),
      }),
      providesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionCreate: builder.mutation({
      query: (body) => ({ url: '/admin/page-sections', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionUpdate: builder.mutation({
      query: ({ uid, body }) => ({ url: `/admin/page-sections/${uid}`, method: 'PATCH', body }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, { uid }) => [
        { type: 'PageSections', id: uid },
        { type: 'PageSections', id: 'LIST' },
      ],
    }),
    // HARD delete — its items go with it. On an override this is "revert to
    // default"; on a hide-only override it is "show again".
    pageSectionRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/page-sections/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: (_r, _e, uid) => [
        { type: 'PageSections', id: uid },
        { type: 'PageSections', id: 'LIST' },
      ],
    }),
    // Array position becomes display_order. Send every DEFAULT's uid from the
    // defaults view, or ONLY the custom sections' uids from an industry view —
    // inherited blocks keep the default's order.
    pageSectionsReorder: builder.mutation({
      query: (ids) => ({ url: '/admin/page-sections/reorder', method: 'PATCH', body: { ids } }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    // Copies the default section(s) AND every item under them into new
    // overrides for one industry. Omit section_keys to copy every default.
    pageSectionsClone: builder.mutation({
      query: (body) => ({ url: '/admin/page-sections/clone', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),

    // Items — the cards / chips / steps inside a section. `section_id` is the
    // INTEGER id, not the uid. At least one of title / body / icon_s3_key is
    // required; a wholly empty item is a 400.
    pageSectionItemsList: builder.query({
      query: (params = {}) => ({
        url: '/admin/page-section-items',
        params: cleanParams(params),
      }),
      providesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionItemCreate: builder.mutation({
      query: (body) => ({ url: '/admin/page-section-items', method: 'POST', body }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionItemUpdate: builder.mutation({
      query: ({ uid, body }) => ({
        url: `/admin/page-section-items/${uid}`,
        method: 'PATCH',
        body,
      }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionItemRemove: builder.mutation({
      query: (uid) => ({ url: `/admin/page-section-items/${uid}`, method: 'DELETE' }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
    }),
    pageSectionItemsReorder: builder.mutation({
      query: (ids) => ({
        url: '/admin/page-section-items/reorder',
        method: 'PATCH',
        body: { ids },
      }),
      extraOptions: { silent: true },
      invalidatesTags: [{ type: 'PageSections', id: 'LIST' }],
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
  useFeatureTypeMetersQuery,
  useFeatureTypeCreateMutation,
  useFeatureTypeUpdateMutation,
  useActivityLogsListQuery,
  // Template families (designs) + their versions
  useTemplateFamiliesListQuery,
  useTemplateFamilyGetQuery,
  useTemplateFamilyCreateMutation,
  useTemplateFamilyUpdateMutation,
  useTemplateFamilySetFlagMutation,
  useTemplateFamilyRemoveMutation,
  useTemplateFamilyRelationsQuery,
  useTemplateFamilySetRelationsMutation,
  useTemplateFamilyMergeMutation,
  useTemplateVersionsByFamilyQuery,
  useTemplateVersionCreateMutation,
  useTemplateVersionUpdateMutation,
  useTemplateVersionRemoveMutation,
  useTemplateVersionMoveMutation,
  // Frames (per-frame purchase — never plan-unlocked) + their categories
  useFramesListQuery,
  useFrameGetQuery,
  useFrameCreateMutation,
  useFrameUpdateMutation,
  useFrameRemoveMutation,
  useFramesReorderMutation,
  useFrameCategoryCreateMutation,
  useFrameCategoryUpdateMutation,
  useFrameCategoriesReorderMutation,
  // Top-up packs (bought outright, never expire) + the per-user quota grants
  useQuotaPacksListQuery,
  useQuotaPackGetQuery,
  useQuotaPackCreateMutation,
  useQuotaPackUpdateMutation,
  useQuotaPackRemoveMutation,
  useQuotaPacksReorderMutation,
  useUserQuotaGrantsQuery,
  useQuotaGrantCreateMutation,
  useQuotaGrantRevokeMutation,
  usePublicConfigQuery,
  useUploadPresignMutation,
  useUploadConfirmMutation,
  useBusinessCategorySetTagsMutation,
  useBusinessCategoryRelatedQuery,
  useBusinessCategorySetRelatedMutation,
  useTemplateCategoriesReorderMutation,
  useAssetsFilteredQuery,
  useAssetTagsQuery,
  useAssetSetTagsMutation,
  useAssetsMissingFilesScanMutation,
  useAssetsMissingFilesDeleteMutation,
  useMultipartInitiateMutation,
  useMultipartPresignPartsMutation,
  useMultipartCompleteMutation,
  useMultipartAbortMutation,
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
  // Languages (content languages)
  useLanguagesFilteredQuery,
  useLanguageCreateMutation,
  useLanguageUpdateMutation,
  useLanguagesReorderMutation,
  // Fonts (curated library)
  useFontCreateMutation,
  useFontUpdateMutation,
  useFontsReorderMutation,
  useFontSetFilesMutation,
  useFontSetLanguagesMutation,
  // Industry suggestions (moderation queue)
  useBusinessCategoriesFilteredQuery,
  useBusinessCategorySetStatusMutation,
  // Feedback
  useFeedbackListQuery,
  useFeedbackDeleteMutation,
  // Notification categories (the bucket a user mutes)
  useNotificationCategoryCreateMutation,
  useNotificationCategoryUpdateMutation,
  useNotificationCategoriesReorderMutation,
  // Notification templates (43 seeded as system rows; soft delete)
  useNotificationTemplatesListQuery,
  useNotificationTemplateGetQuery,
  useNotificationTemplateCreateMutation,
  useNotificationTemplateUpdateMutation,
  useNotificationTemplateRemoveMutation,
  // Campaigns — `notification_campaigns`, super_admin only
  useNotificationCampaignsListQuery,
  useNotificationCampaignGetQuery,
  useNotificationCampaignCreateMutation,
  useNotificationCampaignUpdateMutation,
  useNotificationCampaignRemoveMutation,
  useNotificationCampaignPreviewMutation,
  useNotificationCampaignScheduleMutation,
  useNotificationCampaignSendNowMutation,
  useNotificationCampaignCancelMutation,
  // Delivery log (read-only audit)
  useUserNotificationsListQuery,
  // Page content — defaults + per-industry overrides under the template grid
  usePageSectionsListQuery,
  usePageSectionGetQuery,
  usePageSectionsPreviewQuery,
  usePageSectionCreateMutation,
  usePageSectionUpdateMutation,
  usePageSectionRemoveMutation,
  usePageSectionsReorderMutation,
  usePageSectionsCloneMutation,
  usePageSectionItemsListQuery,
  usePageSectionItemCreateMutation,
  usePageSectionItemUpdateMutation,
  usePageSectionItemRemoveMutation,
  usePageSectionItemsReorderMutation,
} = adminApi;
