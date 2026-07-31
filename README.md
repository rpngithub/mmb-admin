# MakeMyBrand Admin

Admin panel SPA for the MakeMyBrand backend (`mmb-api`). Built with **React 18 + JavaScript (Vite)**, **Ant Design v5**, **Redux Toolkit + RTK Query**, and **React Router v6**.

## Quick start

```bash
npm install
cp .env.example .env   # then edit VITE_API_BASE if needed
npm run dev            # http://localhost:5173
```

Other scripts:

```bash
npm run build     # production build (outputs to dist/)
npm run preview   # serve the production build locally
npm run lint      # ESLint
npm run format    # Prettier
```

## Environment variables

| Variable        | Default                  | Description                                                            |
| --------------- | ------------------------ | --------------------------------------------------------------------- |
| `VITE_API_BASE` | `http://localhost:3000`  | Backend origin. The app appends `/api/v1`, so requests hit `{VITE_API_BASE}/api/v1/...`. |

See [`.env.example`](.env.example).

## How it works

### Auth & token refresh

- Login (`POST /auth/admin/login`) returns `{ access_token, refresh_token }`. Both are stored in
  Redux (`features/auth/authSlice.js`) and persisted to `localStorage`, then rehydrated on load.
- Every `/admin/*` request sends `Authorization: Bearer <access_token>` (set in
  `prepareHeaders`, `features/api/baseQuery.js`).
- **`baseQueryWithReauth`** wraps `fetchBaseQuery`:
  - On a **401**, it calls `POST /auth/refresh` **once** (guarded by a single-flight promise so
    concurrent 401s don't stampede), replaces **both** rotated tokens, and retries the original
    request. If refresh fails, it dispatches `logout()` and the route guard bounces you to `/login`.
  - On **success** it unwraps the `{ success, data, meta }` envelope so endpoints receive `data`
    directly, and hoists `meta.total` onto the query meta for server-paginated lists.
  - On **error** it normalizes the `{ error: { code, message, details } }` envelope and raises a
    global AntD `notification` (via an App-context bridge, `lib/notify.js` + `NotificationBridge`).

### Permission gating

- Permissions live in the access-token JWT `permissions` claim. The token is decoded client-side
  with `jwt-decode` (`features/auth/permissions.js`).
- Semantics: `"*"` = superuser · `"<domain>.*"` = whole domain · `"<domain>.<action>"` = exact
  (`read|create|update|delete`).
- Gating is applied in three places:
  1. **Sidebar** — only sections you can `read` appear (`navigation.jsx` → `buildMenu`).
  2. **Routes** — `RequirePermission` guards each route and shows a 403 for direct URLs.
  3. **Buttons** — Create/Edit/Delete are hidden when the matching permission is absent
     (`usePermissions` inside `ResourceManager` and the special pages).
- The JWT is the source of truth, but server **403** responses are still handled gracefully
  (surfaced as a notification).

### Server state

- **All** server data flows through RTK Query with tag-based invalidation, so mutations auto-refresh
  the relevant lists. Redux slices hold only auth + UI state — server data is never duplicated into
  slices.

### Config-driven CRUD

- The ~19 generic CRUD resources are described by a per-resource config array
  (`src/resources/index.js`): `path`, `permission` domain, `idField`, and optional `columns` /
  `fields`. Anything omitted is **inferred from live `GET /` data** at render time.
- Their five endpoints (`list/get/create/update/remove`) are generated in a loop by an RTK Query
  endpoint factory (`features/api/adminApi.js` → `buildGenericEndpoints`) rather than hand-written
  19 times.
- A single reusable **`ResourceManager`** (`components/ResourceManager.jsx`) renders the table,
  create/edit modal form, details drawer, and delete confirm for every generic resource.

### Special sections (bespoke pages)

A handful of resources need more than the generic ResourceManager and have dedicated pages in
`src/pages/*` (special-cased in `router.jsx`). `Users`, `Admins`, `Activity Logs`, and `Templates`
use their paginated endpoints with server-side pagination/search/filters (driven by `meta.total`);
`Roles`, `Plans`, and `App Settings` reuse the generic client-side endpoints but render a custom UI.

| Section       | Notes                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Users         | List + detail drawer + activate/deactivate toggle (no create/delete).  |
| Admins        | List + create + edit (role select, optional password on edit).         |
| Activity Logs | Read-only audit viewer, filterable by entity/action/actor type.        |
| Templates     | Paginated/filtered list; full CRUD via the generic template routes (edit fetches the full record incl. `content`). |
| App Settings  | Grouped by `group`; type-aware value editor (string/integer/boolean/json) that always sends `value` as a string; inline Public/Internal (`is_public` 0\|1) toggle; immutable `key` on edit; delete guards for app-critical keys. |

## Project structure

```
src/
  app/            store.js, hooks.js
  features/
    auth/         authSlice.js, Login.jsx, ProtectedRoute.jsx, RequirePermission.jsx,
                  permissions.js, usePermissions.js
    api/          baseQuery.js (reauth + envelope unwrap), adminApi.js (endpoints + tags)
    ui/           uiSlice.js
  components/     ResourceManager.jsx, AppLayout.jsx, FormFields.jsx, columns.jsx,
                  NotificationBridge.jsx, formUtils.js
  pages/          Dashboard, UsersPage, AdminsPage, TemplatesPage, ActivityLogsPage,
                  RolesPage, PlansPage, AppSettingsPage, GenericResourcePage, NotFound
  resources/      index.js (per-resource config), permissionOptions.js
  lib/            notify.js (App-context notification bridge)
  navigation.jsx  sidebar + route metadata (permission-gated)
  router.jsx, main.jsx, theme.js
```

## Notes / known unknowns

The exact column/field set for each generic resource is not fully documented by the backend. Configs
in `src/resources/index.js` use sensible defaults; fields not listed there are inferred from the data
returned by `GET /`. Adjust a resource's `fields`/`columns` config to fine-tune its form/table — no
component changes needed. The API ignores `id`/`created_at`/`updated_at` on write.
