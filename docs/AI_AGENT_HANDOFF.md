# Alphire Promo Platform - Current Handoff

Last updated: 2026-03-29

## 1. What This Project Is
Alphire Promo Platform is a modular promotion and content-operations application. It started as a basic email-marketing MVP and has evolved into a multi-domain admin platform spanning:

- Acquire
- Contacts
- Channels
- Messaging
- Assets
- Builder
- Campaigns
- Promote
- Engage
- Observe
- Settings / Training

The current architecture is a hybrid:

- frontend: static SPA in `public/`
- backend: Node route dispatcher shared by local server and Vercel serverless
- primary persistence: Supabase
- remaining local/file persistence: a smaller set of operational stores and compatibility data

The product is now actively moving into true project-scoped multitenancy. This is one of the most important current architectural themes.

## 2. Runtime Entry Points

### Local development
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/server.js`
- loads `.env` with `dotenv`
- validates config via `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/config.js`
- serves static files from `public/`
- routes `/api/*` through `routes/index.js`

### Production / Vercel
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/api/[...slug].js`
- delegates to the same shared route dispatcher

### Shared route dispatcher
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/index.js`

Important behavior in the dispatcher:
- global rate limit check
- session authentication
- current-project resolution
- module-by-module route delegation
- standard response envelope

## 3. Frontend Architecture

### Main shell
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/index.html`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/styles.css`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/core.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/app.js`

### Frontend module pattern
Modules are attached to `window.App` and registered in:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/app.js`

Typical module shape:
- `manifest: { id, label, pageId }`
- `init()`
- optional `refresh()`
- optional `onPageActivated()`

Current registered modules include:
- contacts
- segments
- campaigns
- promoLeads
- assets
- assetCategories
- channels
- settings
- acquire
- youtube
- youtubeComments
- messaging
- promoteEmail
- engageSocial
- engageComments
- docsApiSetup
- develop
- activityLog
- envConfig

### Shared frontend state
Single source of truth:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/core.js`

Notable state keys:
- `currentProjectId`
- `projects`
- `contacts`
- `segments`
- `campaigns`
- `assets`
- `assetCategories`
- `directAcquireRuns`
- `directAcquireCurrentRun`
- `directAcquireWebsitePeers`

### Important frontend behavior
- project switching now re-activates the current page so project-scoped dropdowns and tables refresh correctly
- active-page refresh is selective; not every module refreshes on every page
- `App.api()` understands the standardized API envelope and throws structured errors

## 4. Backend Architecture

### Route modules
Located under:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes`

Important route modules:
- `auth.js`
- `projects.js`
- `settings.js`
- `acquire.js`
- `contacts.js`
- `assets.js`
- `channels.js`
- `messaging.js`
- `develop.js`
- `engage.js`
- `promoLeads.js`
- `activityLog.js`
- `config.js`

### Response conventions
Defined in:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/http.js`

Standard shape:
- success: `{ ok: true, data, ...legacyKeys, meta? }`
- error: `{ ok: false, error: { message, code?, details? } }`

This contract is important. New route work should preserve it.

### Validation and rate limiting
- validation helpers: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/validate.js`
- rate limits: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/rateLimiter.js`

Expensive endpoints usually do both:
- global limit in `routes/index.js`
- endpoint-specific limit inside the route module

## 5. Persistence Model

### Primary persistence: Supabase
Shared Supabase access lives in:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/supabase.js`

This file is the central source for:
- credential resolution
- table-name resolution
- REST queries via `sbQuery()`

### API settings
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/apiSettings.js`
- persistent settings file: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/data/api_settings.json`

In production, environment variables should override in-app settings. This is especially important on read-only deployments.

### Remaining file/local persistence
Still present in some areas:
- direct acquire runs
- acquire job mirrors
- some compatibility stores
- some older operational data

Examples:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/data/direct_acquire_runs.json`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/data/acquire_jobs.json`

These are known architectural leftovers.

## 6. Authentication and Projects

### Auth
- route: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/auth.js`
- store: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/authStore.js`

Current auth style:
- app-managed users and sessions
- session cookie `app_session`
- route guard applied in `routes/index.js`

### Projects
- route: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/projects.js`
- store: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/projectsStore.js`

Current project resolution:
- user authenticates
- request may include `x-project-id`
- `routes/index.js` calls `resolveCurrentProject(...)`
- resolved project is attached as `req.projectContext`

### Project-scoping helpers
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/requestProjectScope.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/projectScope.js`

These are core to current multitenancy rollout.

Important behavior:
- selected active project is now intended to be the actual scope boundary
- many stores now filter by active `project_id`
- temporary compatibility fallback still exists for some legacy `NULL project_id` rows

## 7. Domain Overview

### Acquire
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/acquire.js`

Routes:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/acquire.js`

Backend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/directAcquire.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/websitePeersStore.js`
- YouTube harvest files under `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/harvest`

Current capabilities:
- direct website harvest
- social/contact extraction
- keyword extraction and AI reranking
- validated hashtag discovery
- image harvesting
- peer-site discovery
- YouTube acquisition flows
- X / Reddit harvest flows

Important current state:
- direct website harvest runs are still stored in local JSON
- a new persistent `website_peers` dataset now captures:
  - source website
  - peer websites
  - matched keywords
  - website model
  - notes / snippet / metadata
- `Acquire: Web` now includes an expandable CRUD section for website peers

### Contacts
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/contacts.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/contactPersonas.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/segments.js`

Routes:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/contacts.js`

Backend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/ContactsStore.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/contactPersonasStore.js`

Current state:
- Contacts are DB-backed
- multitenant scoping is active
- uniqueness had to be changed from global email uniqueness to project-scoped email uniqueness

### Channels
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/channels.js`

Route:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/channels.js`

Backend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/channelsStore.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/channelsCipher.js`

Current state:
- DB-backed
- project-scoped
- passwords are encrypted at rest

### Messaging
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/messaging.js`

Route:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/messaging.js`

Backend stores:
- shared short-form base: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/messagingTextStore.js`
- shared long-form base: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/messagingLongformStore.js`
- topic/tag/format stores
- one store per main content type
- AI generation: `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/messagingContentSuggestions.js`

Current state:
- `topics` and `tags` are now the canonical taxonomy
- `formats` are DB-backed
- content creation is format-specific
- AI generation and revision flows exist
- per-item feedback fields have been added to messaging content
- multitenancy is one of the most complete here

Known terminology note:
- older code and data may still contain `category`
- current canonical meaning is `topic`

### Assets
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/assets.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/assetCategories.js`

Routes:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/assets.js`

Backend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/assetsStore.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/assetCategoriesStore.js`

Current state:
- DB-backed
- project-scoped
- asset category uniqueness is now project-scoped
- older `Screenshot` taxonomy was replaced with `File`

### Builder
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/develop.js`

Route:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/develop.js`

Backend:
- `developThemesStore.js`
- `developEmailTemplatesStore.js`
- `developLandingPagesStore.js`
- `developExtensionsStore.js`
- `developExtensionsManagerStore.js`
- `developFormsStore.js`

Current state:
- most Builder objects are DB-backed
- Forms were recently moved to Supabase-first because file writes failed on Vercel (`EROFS`)
- project scoping is active for themes, templates, pages, extensions, forms

Important naming note:
- code and DB still use `develop_*`
- product/UI increasingly uses `Builder`
- a planned architectural rename from `develop` to `build` has not been done yet

### Campaigns
Frontend:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/campaigns.js`

Backend:
- segments/campaigns stores via Supabase-backed routes and shared helpers

Current state:
- DB-backed
- project-scoped
- depends heavily on project-scoped Messaging, Assets, Contacts, Builder objects

### Engage / Promote / YouTube
These sections are partially mature and partially in progress. They include:
- social engagement helpers
- YouTube details/comments/reply suggestions
- promote email flows

Key files:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/engageSocial.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/engageComments.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/youtube.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/youtubeComments.js`
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/engage.js`

## 8. Database and Migration Docs
Database documentation and migrations live in:
- `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/docs`

Important setup files:
- `app_tables_setup.sql`
- `projects_multitenancy_setup.sql`
- `website_peers_setup.sql`
- `develop_forms_setup.sql`
- many table-specific setup files for messaging

Important migration/backfill files already used in this repo:
- project-scope setup and backfill files
- uniqueness migrations for project-scoped records
- content topic renames
- messaging feedback columns
- asset taxonomy changes

This repo relies on SQL files as the migration history. There is no formal migration runner.

## 9. Project Isolation Status
This is one of the most important current implementation themes.

### Mostly working / actively scoped
- Messaging
- Assets
- Contacts
- Channels
- Builder DB-backed objects
- Campaigns
- Segments
- Website peers

### Mechanism
- request resolves active project
- route passes scope to store
- store uses `project_id` and `owner_user_id`
- some legacy `NULL project_id` fallback still exists in helpers

### Why this matters
The platform used to have only superficial project switching. The current work is making the selected project a true tenancy boundary so objects do not bleed across projects.

### Remaining caution
If data appears in the wrong project, check:
1. whether the table rows were backfilled with `project_id`
2. whether the store uses the scoping helpers
3. whether a global unique index is still blocking project-local duplicates
4. whether a client-side cached list failed to refresh after project switch

## 10. Key Architectural Conventions

### Add a new route
1. create `routes/myModule.js`
2. export `{ handle, manifest }`
3. add it to `ROUTE_MODULES` in `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/index.js`

Do not add route logic directly to:
- `server.js`
- `api/[...slug].js`

### Add a new frontend module
1. create `public/js/myModule.js`
2. attach it to `window.App`
3. add a `<script>` tag in `public/index.html`
4. register it in `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/app.js`

### Add a new Supabase-backed domain
1. add table setup SQL in `docs/`
2. add table resolution in `lib/supabase.js`
3. add optional settings key in `lib/apiSettings.js`
4. create store under `lib/`
5. use project-scope helpers if the data is project-scoped
6. expose CRUD route
7. wire frontend

### Preserve these patterns
- standardized response envelope
- route-module registry
- `window.App` frontend module pattern
- project-scoping helpers
- Supabase-first persistence for real business objects

## 11. Known Technical Debt and Risks

1. Documentation lag
- README and some older docs are behind the real system.
- This file is intended to be the current starting point.

2. Hybrid persistence remains
- some operational stores are still JSON-backed
- direct website harvest runs are still local/file-backed

3. Naming drift
- `develop` vs `builder`
- some lingering `category` vs `topic`
- older legacy terms still appear in code and migrations

4. Large single-page frontend
- `public/index.html` and some frontend modules are very large
- there is no framework abstraction layer yet

5. SQL migrations are manual
- repo uses raw SQL files, not a migration engine
- schema drift can happen if a deployment misses a SQL step

6. Project isolation is in rollout, not final completion
- some tables still may need backfills or uniqueness fixes

## 12. Current Important Features Added Recently

These are recent enough that an incoming coder should know them immediately:

- project-scoped Messaging, Assets, Contacts, Builder objects
- project-scoped website peer persistence for `Acquire: Web`
- AI topic suggestions on `Messaging: Topics`
- AI-assisted content generation and revision flows
- per-item messaging feedback fields
- Builder Forms moved off read-only file writes and into Supabase-first storage

## 13. Recommended First Read Order For a New Coder
1. this file
2. `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/routes/index.js`
3. `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/app.js`
4. `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/public/js/core.js`
5. `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/supabase.js`
6. `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/projectScope.js`
7. `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/lib/requestProjectScope.js`
8. the domain you are about to modify

Suggested domain read order:
- Messaging
- Assets
- Acquire
- Builder
- Contacts / Campaigns

## 14. Recommended Next Work
If continuing current architectural priorities, the most likely next tasks are:

1. finish any remaining project-isolation leaks
2. continue converting residual file-backed operational data to DB-backed stores
3. execute the planned `develop -> build` rename across DB and code
4. reduce naming drift and schema drift
5. split oversized frontend pages/modules where practical

## 15. Practical Setup Notes

### Run locally
```bash
npm start
```

### Useful verification pattern
Use syntax checks heavily:
```bash
node --check /absolute/path/to/file.js
```

### Production note
Vercel production is effectively read-only for local filesystem writes. If a feature writes to `data/*.json` in production, it is a red flag and should likely move to Supabase-first storage.

## 16. Final Guidance For The Next Agent Or Human
Treat this codebase as an admin platform in active consolidation, not a clean greenfield app. The most important thing is preserving consistency while continuing the migration toward:

- real project isolation
- Supabase-backed persistence
- clear domain naming
- reusable route/store/frontend patterns

When in doubt:
- prefer existing route/store patterns over inventing new ones
- prefer project-scoped DB-backed persistence for new business objects
- check `docs/` for setup SQL before assuming a table exists
- verify whether a problem is code, data backfill, or DB uniqueness before patching UI behavior
