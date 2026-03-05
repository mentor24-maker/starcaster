# Alphire Promo Platform (APP) - AI Agent Handoff

Last updated: 2026-02-24

## 1. Project Purpose
APP started as a basic Mailchimp-style tool and is being expanded into a modular promotion operations platform ("HubSpot meets Monday.com" direction). Current emphasis is inside-out growth: build one point solution at a time, but on a reusable architecture.

## 2. Source Material Consolidated
This handoff condenses:
- Current codebase at `/Users/mentor/Desktop/ISITAS/Development/alphire-promo`
- Prior Codex and Claude transcripts in `/Users/mentor/Desktop/ISITAS/Development/alphire-promo-archives`
- Historical archives under `/Users/mentor/Desktop/ISITAS/Development/alphire-promo/docs/archives`

Major transcript dates:
- 2026-02-20: architecture audit and 10-project stabilization plan created
- 2026-02-21: #1-#5 implementation checkpoints completed
- 2026-02-23: #6-#10 implementation checkpoints completed and validated

## 3. Current System Snapshot
Backend:
- Node.js API with shared route dispatcher
- Local dev entry: `server.js`
- Vercel entry: `api/[...slug].js`
- Shared routing: `routes/index.js`

Frontend:
- Static SPA in `public/`
- `window.App` namespace modules in `public/js/`
- Manifest-driven module registration in `public/app.js`

Storage:
- Primary persistence: Supabase (contacts, segments, campaigns, events, youtube runs, activity log)
- Local JSON persistence still used for some operational data:
  - `data/api_settings.json`
  - `data/acquire_jobs.json`
  - `data/direct_acquire_runs.json`

## 4. Architecture Milestones (Completed Plan #1-#10)
From transcripts and code verification:
1. Dual-server drift removed by centralizing API logic in `routes/`
2. Core data moved off `store.json` and into Supabase-backed libs
3. Shared Supabase client consolidated in `lib/supabase.js`
4. Frontend split into focused modules under `public/js/`
5. Manifest pattern implemented (route manifests + frontend module manifests)
6. Activity log layer added (`lib/activityLog.js`, `routes/activityLog.js`, UI page)
7. Formal env configuration added (`lib/config.js`, `routes/config.js`, Env Config UI)
8. Request validation added (`lib/validate.js`) and applied to major routes
9. API response envelope standardized (`sendOk`/`sendErr`) with backward-compatible legacy keys
10. Reusable frontend components added (`public/js/components.js`) and applied on reference pages

## 5. Repository Map (Important Files)
- API entrypoints:
  - `server.js`
  - `api/[...slug].js`
- Router:
  - `routes/index.js`
  - `routes/http.js`
  - `routes/settings.js`
  - `routes/acquire.js`
  - `routes/promoLeads.js`
  - `routes/contacts.js`
  - `routes/activityLog.js`
  - `routes/config.js`
- Backend libs:
  - `lib/supabase.js`
  - `lib/ContactsStore.js`
  - `lib/store.js`
  - `lib/activityLog.js`
  - `lib/config.js`
  - `lib/validate.js`
  - `lib/rateLimiter.js`
  - `lib/openclawGateway.js`
  - `lib/youtubeHarvest.js`
  - `lib/youtubeHarvestRuns.js`
  - `lib/directAcquire.js`
  - `lib/acquireMirror.js`
  - `lib/apiSettings.js`
- Frontend:
  - `public/index.html`
  - `public/app.js`
  - `public/js/core.js`
  - `public/js/components.js`
  - `public/js/contacts.js`
  - `public/js/promoLeads.js`
  - `public/js/segments.js`
  - `public/js/campaigns.js`
  - `public/js/settings.js`
  - `public/js/acquire.js`
  - `public/js/youtube.js`
  - `public/js/develop.js`
  - `public/js/activityLog.js`
  - `public/js/envConfig.js`

## 6. Runtime and Deployment
Local:
- `npm start` (runs `node server.js`)
- `dotenv` is loaded in `server.js` for local `.env`

Vercel:
- `api/[...slug].js` delegates to shared router
- `vercel.json` keeps `/api/*` routed through serverless entry

## 7. Data Model
### Supabase tables in active use
- `contacts` (unified contact records with `contact_type` and social/custom fields)
- `contact_field_configs`
- `contact_types`
- `segments`
- `campaigns`
- `campaign_events`
- `youtube_acquire_runs`
- `activity_log`

### SQL/setup artifacts present in repo
- `docs/app_tables_setup.sql` (legacy core tables baseline)
- `data/promo_leads_setup.sql` (legacy promo leads tables)
- `supabase_youtube_acquire_runs.sql`

Note: current route code expects unified contacts + contact field/type tables (from `lib/ContactsStore.js`) and activity log table (`lib/activityLog.js`). Ensure DB schema reflects current code, not only older SQL files.

## 8. API Surface (Current)
### Health and settings
- `GET /api/health`
- `GET /api/settings/apis/schema`
- `GET /api/settings/apis`
- `POST /api/settings/apis`
- `GET /api/settings/apis/:provider`
- `DELETE /api/settings/apis/:provider`
- `GET /api/settings/database/tables`
- `POST /api/settings/database/fields`
- `POST /api/openclaw/:action`

### Config
- `GET /api/config/schema`
- `GET /api/config`
- `POST /api/config`

### Contacts, segments, campaigns
- `GET /api/contacts`
- `GET /api/contacts/types`
- `POST /api/contacts`
- `GET /api/contacts/:id`
- `PUT /api/contacts/:id`
- `DELETE /api/contacts/:id`
- `POST /api/contacts/import`
- `GET /api/segments`
- `POST /api/segments`
- `PUT /api/segments/:id`
- `DELETE /api/segments/:id`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `POST /api/campaigns/:id/send`

### Promo-leads compatibility layer (mapped to unified contacts)
- `GET /api/promo-leads/fields`
- `POST /api/promo-leads/fields`
- `PUT /api/promo-leads/fields/:id`
- `DELETE /api/promo-leads/fields/:id`
- `POST /api/promo-leads/import`
- `POST /api/promo-leads/columns/check`
- `GET /api/promo-leads/database/tables`
- `POST /api/promo-leads/database/fields`
- `GET /api/promo-leads`
- `POST /api/promo-leads`
- `PUT /api/promo-leads/:id`
- `DELETE /api/promo-leads/:id`

### Acquire
- `GET /api/acquire/jobs`
- `DELETE /api/acquire/jobs/:id`
- `GET /api/acquire/direct-runs`
- `GET /api/acquire/direct-runs/:id`
- `POST /api/acquire/direct-run`
- `POST /api/acquire/youtube`
- `GET /api/acquire/youtube-runs`
- `POST /api/acquire/youtube-runs/:id/rerun`
- `GET /api/acquire/youtube-runs/:id`
- `DELETE /api/acquire/youtube-runs/:id`

### Activity log
- `GET /api/activity-log`
- `POST /api/activity-log`

## 9. Response and Validation Conventions
Response envelope (routes/http.js):
- Success: `{ ok: true, data, ...legacyKeys, meta? }`
- Error: `{ ok: false, error: { message, code?, details? } }`

Request validation:
- `lib/validate.js` enforces schema-driven validation
- Strict unknown-field rejection is active where validation is applied

Frontend client:
- `public/js/core.js` `App.api()` understands envelope and throws on structured errors

## 10. Frontend Module Pattern
Each module returns manifest + behavior, typically:
- `manifest: { id, label, pageId }`
- `init()`
- optional `refresh()`
- optional `onPageActivated()`

App orchestrator:
- `public/app.js` maintains `App.manifests` and drives init/refresh

Reusable UI components:
- `DataGrid`, `Card`, `Modal`, `Toast` in `public/js/components.js`

## 11. Integration Points
Configured providers from settings:
- Supabase
- OpenAI
- Anthropic
- Brave
- Exa
- OpenClaw
- TranscriptAPI
- YouTube Data API

Important behavior:
- OpenClaw relay requires `manual_confirmed=true`
- Acquire and relay endpoints are rate-limited (global + endpoint limits)
- YouTube acquisition supports transcript fallback and metadata extraction

## 12. Known Risks and Technical Debt
1. Hybrid persistence remains
- Supabase + local JSON coexist; local files can diverge in multi-instance/serverless contexts.

2. Legacy compatibility surface still large
- `promo-leads` routes are compatibility wrappers over unified contacts; keep until UI fully migrates.

3. SQL docs are partially behind code
- Some current required tables/columns are implied by code but not fully represented in committed SQL migrations.

4. `lib/store.js` and `lib/ContactsStore.js` overlap conceptually
- Contacts logic exists in both; routes mostly use `ContactsStore` for contacts and `store.js` for segments/campaigns.

5. Security hygiene required
- Historical artifacts include live-looking credentials in archived files and `.env`; rotate and avoid committing secrets.

## 13. Security and Ops Rules for Next Agent
- Never commit `.env` or raw credential files.
- Treat `data/api_settings.json` as sensitive.
- Prefer environment variables for infrastructure credentials.
- Keep route logic in `routes/` only; do not add API logic directly to `server.js` or `api/[...slug].js`.
- When adding endpoints, use validation schemas + envelope helpers.
- For expensive endpoints, add endpoint-level rate limit checks.

## 14. Onboarding Checklist for a New AI Agent
1. Read this file first.
2. Read `README.md`, then `routes/index.js`, `routes/http.js`, `public/app.js`, `public/js/core.js`.
3. Verify DB schema against `lib/ContactsStore.js`, `lib/store.js`, `lib/activityLog.js`, `lib/youtubeHarvestRuns.js`.
4. Smoke test:
   - `/api/health`
   - contacts CRUD
   - segments/campaigns create/send simulation
   - settings API schema/config list
   - activity log listing
5. Confirm script order in `public/index.html` keeps `core.js` and `components.js` loaded before dependent modules.

## 15. Recommended Next Work Items (Priority)
1. Create a canonical SQL migration set for current schema (including unified contacts, contact types/configs, and activity log).
2. Remove or minimize file-based persistence for settings/acquire mirrors in favor of database-backed or managed-store equivalents.
3. Complete frontend migration off legacy promo-leads compatibility flows onto unified contact model naming.
4. Consolidate contact persistence logic so `lib/store.js` and `lib/ContactsStore.js` responsibilities are unambiguous.
5. Add a lightweight API test suite (smoke + contract tests for envelope and validation behavior).

## 16. Product Direction Context (from prior discussions)
- APP is intended to be highly modular and expandable across promotion workflows.
- Current implementation intentionally prioritizes architecture hardening before broad feature expansion.
- OpenClaw is treated as a major execution substrate; APP acts as orchestration, approval, and observability layer.

---
If you are a new coding agent: preserve the manifest pattern, envelope contract, and validation/rate-limit guardrails. Those are the current architectural backbone.
