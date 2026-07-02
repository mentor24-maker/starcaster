# routes/ — API route modules

Every module exports `{ handle(req, res, pathname, method), manifest }`
with `manifest: { id, label, prefixes: string[] }`, and is registered in
`ROUTE_MODULES` in `routes/index.js`. Do not add routes to `server.js` or
`api/[...slug].js` directly — the dispatcher is the single entry point for
both local dev and Vercel.

## Rules

- **Response envelope:** `sendOk(res, status, data)` /
  `sendErr(res, status, message, { code })` from `routes/http.js` —
  `{ ok: true, data }` / `{ ok: false, error: { message, code } }`.
- **Auth is decided centrally** in `routes/index.js`. Public/unauthenticated
  access requires an explicit exemption there — adding one is a security
  decision; call it out prominently in your summary/PR, never slip it in.
- **Project scoping:** `req.projectContext.project.id` is the tenant
  boundary. Every tenant-scoped query filters by `project_id` (helpers in
  `lib/projectScope.js`). Email/slug uniqueness is per-project.
- **Stores live in `lib/`**, one per entity, using `sbQuery()` from
  `lib/supabase.js`. Always `encodeURIComponent` values interpolated into
  PostgREST query strings.
- **Schema changes:** add SQL to `docs/SQL/` and apply on Supabase
  manually; check `docs/SQL/` before assuming a column exists.
- **Expensive endpoints** (external APIs, scraping, imports) add
  `checkEndpointLimit(req, res, '<key>')` with a key in
  `lib/rateLimiter.js` LIMITS.
- **No `data/*.json` writes** in anything that runs in production.
- **Overhaul direction** (`docs/FABLE_OVERHAUL_PLAN.md` Phases 2–3): route
  files are heading to ≤400 lines with declarative access manifests. Don't
  grow the monoliths (`engage.js`, `acquire.js`, `builder.js`) — put new
  surface area in new, small modules.
