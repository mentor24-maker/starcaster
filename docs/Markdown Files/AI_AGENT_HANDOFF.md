# StarCaster — AI Agent Handoff (Canonical)

**Last updated:** 2026-05-18 (Top Ten workstream added for agent handoff)  
**Repository:** `/Users/mentor/WebApps/starcaster`  
**Company:** [Alphire](https://alphi.re)  
**Product:** **StarCaster**

This file is the **single source of truth** for agents and developers joining the project. Older paths (`alphire-promo`, `ISITAS/Development`, `isit-app`) and prior product names are historical only.

---

## 1. What StarCaster Is

StarCaster is Alphire’s platform for **influencers, content creators, communities, and grassroots audience builders** who want organic reach by engaging where conversations already happen: comment threads, posts, articles, tweets, videos, and shares across the social web.

The product vision is end-to-end:

1. **Establish** web presence (sites, landing pages, assets, messaging)
2. **Promote** (campaigns, channels, outreach)
3. **Engage** (social replies, comments, likes, shares, harvest-and-respond workflows)
4. **Observe** (usage, performance, operational visibility)

The codebase has a **solid foundation** (routing, Supabase-backed domains, project switching, Builder, Messaging, Acquire) with **many areas still thin or file-backed**. Active development is resuming now.

**StarCaster vs Normie (do not confuse):**

- **StarCaster** = this repo (`~/WebApps/starcaster`). “Projects” are workspaces inside the StarCaster app (`app_projects`, project switcher).
- **Normie** = separate product repo (`~/WebApps/normie`). Use a **StarCaster project** (one row in `app_projects`) as your day-to-day workspace when dogfooding features—not Normie’s `.env` or codebase—for multitenancy, env vars, or SQL migrations.

---

## 2. Runtime Entry Points

### Local development

```bash
cd ~/WebApps/starcaster
npm install
cp .env.example .env   # when present; fill required vars
npm run dev            # build + watch + server on PORT (default 3000)
# or
npm start              # one-shot build + server
```

- **Server:** `server.js` — loads `.env` via `dotenv`, validates `lib/config.js`, serves `public/`, routes `/api/*` through `routes/index.js`
- **Do not** add API routes in `server.js` directly

### Production (Vercel)

- **API:** `api/[...slug].js` → same `routes/index.js` dispatcher
- **Static:** `vercel.json` rewrites to `public/`; **never remove** the `/api/(.*)` → `api/[...slug]` rewrite (past incidents caused site-wide API 404s)
- **Deploy SOP:** `docs/DEPLOYMENT.md` — `git push` (preview) then `vercel --prod` (production promotion)
- **Cutover checklist:** `docs/VERCEL_CUTOVER.md` (Blob assets, env vars)

### Build pipeline

| Script | Purpose |
|--------|---------|
| `npm run build:html` | Compiles `src/layout.html` + `src/pages/*.html` → `public/index.html` |
| `npm run build` | `build:html` + esbuild `react-entry.js` → `public/bundle.js` + CSS bundle → `public/styles.css` |
| `npm run dev` | Watch mode for JS/CSS + server |

**HTML rule:** Edit page structure under `src/pages/` (and `src/layout.html`), then run `npm run build:html`. Avoid hand-editing the generated bulk of `public/index.html` except for urgent hotfixes.

---

## 3. Architecture Overview

```
Browser SPA (public/)
  ├── index.html          ← built from src/
  ├── js/*.js             ← window.App modules (primary UI)
  ├── bundle.js           ← React island (Campaigns list only)
  └── styles.css          ← built from src/css/main.css

server.js (local)  ─┐
api/[...slug].js   ─┼→ routes/index.js → routes/*.js → lib/*Store.js
                    │
                    ├→ Supabase (primary business data)
                    └→ data/*.json (legacy / ops / local fallback)
```

### Shared dispatcher (`routes/index.js`)

Every API request:

1. CORS + OPTIONS
2. Global rate limit (`lib/rateLimiter.js`)
3. Session auth (`app_session` cookie) except allowlisted routes
4. **Project resolution** via `x-project-id` → `req.projectContext`
5. First matching route module in `ROUTE_MODULES`

### Response envelope (`routes/http.js`)

- Success: `{ ok: true, data, ...legacyKeys, meta? }`
- Error: `{ ok: false, error: { message, code?, details? } }`

Frontend: `App.api()` in `public/js/core.js` understands this shape and throws on `ok: false`.

---

## 4. Frontend Architecture

### Shell and state

| File | Role |
|------|------|
| `public/js/core.js` | `App.state`, `App.api()`, `App.notify()`, navigation, project switcher |
| `public/app.js` | Module registry (`App.manifests`), `init()`, `refresh()`, page activation |
| `src/layout.html` | Auth shell + app chrome template |
| `src/pages/*.html` | Per-section page markup (included into layout) |

### Module pattern

Each feature = `public/js/myModule.js`:

```js
App.myModule = {
  manifest: { id: 'myModule', label: 'My Module', pageId: 'myPageId', pagePrefixes?: [...] },
  init() { ... },
  refresh() { ... },           // optional
  onPageActivated(pageId) { } // optional
};
```

Register in **`public/app.js`** `App.manifests` and add `<script src="/js/myModule.js">` in `src/layout.html` (before `app.js`).

### React (limited)

- **Only** `react-entry.js` → `#campaignsReactRoot` → `components/campaigns/ActiveCampaignsList.jsx`
- **Default for new UI:** vanilla JS + HTML + project CSS (`src/css/`)
- Do not add new React surfaces without an explicit product decision

### Shared state keys (`App.state`)

Includes: `currentProjectId`, `projects`, `contacts`, `segments`, `campaigns`, `assets`, acquire run state, etc. Project switch re-activates the current page so scoped lists refresh.

---

## 5. Backend Architecture

### Route modules (`routes/`)

Registered in `ROUTE_MODULES` (order matters — first match wins):

| Module | Domain |
|--------|--------|
| `auth.js` | Login, register, session |
| `projects.js` | Projects, memberships, `resolveCurrentProject` |
| `settings.js` | API keys, env display |
| `acquire.js` | Web harvest, YouTube, X, Reddit, peers |
| `promoLeads.js` | Promo leads |
| `assets.js` | Assets + categories (Vercel Blob migration) |
| `channels.js` | Channel accounts (encrypted passwords) |
| `contacts.js` | Contacts, segments, personas |
| `engage.js` | Social engage, YouTube comments |
| `develop.js` | Builder: themes, pages, forms, templates, extensions |
| `messaging.js` | Topics, tags, formats, all content types, AI suggestions |
| `activityLog.js` | Activity log |
| `observe.js` | Page views, usage logs |
| `config.js` | Public config endpoints |
| `devAgent.js` | Ask Roger / dev agent (`/api/develop/roger/*`, tasks) |
| `personas.js` | Contact personas |
| `tasks.js` | Dev tasks |
| `polls.js` | Polls API |

**Add a route:** create `routes/foo.js` with `{ handle, manifest }`, import in `routes/index.js` only.

### Stores (`lib/`)

- **Supabase access:** `lib/supabase.js` — `sbQuery()`, table name resolution
- **Project scope:** `lib/projectScope.js`, `lib/requestProjectScope.js`
- **Settings file:** `data/api_settings.json` (gitignored) — UI-managed API keys; **production must use env vars** for core secrets (`lib/config.js`)

### Validation

- `lib/validate.js` — shared validators
- Expensive routes: global limit + per-endpoint limit in the handler

---

## 6. Persistence Model

### Supabase-first (project-scoped where applicable)

Messaging, assets, contacts, channels, segments, campaigns, most Builder tables, website peers, **promote social posts**, **direct acquire runs** (when `docs/011_multitenancy_acquire_engage.sql` applied), observe logs, auth (when configured), projects (when configured).

### File-backed (⚠️ production risk on Vercel)

Vercel serverless filesystem is **read-only**. Any `writeFileSync` to `data/` **fails in production** (`EROFS`).

Stores below use **Supabase when tables exist**, with scoped JSON file fallback for local dev:

- `lib/promoteSocialStore.js` → `engage_social_posts`
- `lib/directAcquireRunsStore.js` → `direct_acquire_runs`
- `lib/acquire/XAcquireStore.js`, `lib/acquire/RedditAcquireStore.js` → file runs filtered by `project_id` (Supabase tables in 011 optional later)

Other file-only / fallback stores:

- `lib/acquireMirror.js` (OpenClaw job mirror; not project-scoped yet)
- `lib/projectsStore.js`, `lib/authStore.js` (fallback when Supabase unset)
- `lib/apiSettings.js`, `lib/trainingStore.js`, several `develop*` file fallbacks

**Rule:** New business entities → Supabase table + store + `docs/<table>_setup.sql`. File storage only for ephemeral local dev or explicitly local-only tools.

### Migrations

- SQL lives in **`docs/*.sql`** (no formal migration runner)
- Apply manually in Supabase SQL editor; **track in `docs/MIGRATIONS_APPLIED.md`**
- Optional future CLI folder: `supabase/migrations/` (see README there)
- **Do not** use `ai-daemon/sandbox/isit-app/docs/` as source of truth — duplicate/stale

---

## 7. Multitenancy (Projects)

- Header `x-project-id` + `resolveCurrentProject()` → `req.projectContext`
- Route handlers pass `requestProjectScope(req)` into stores as `{ projectId, userId }`
- Supabase stores use `scopedListQuery`, `scopedInsertRow`, etc. (`lib/projectScope.js`)
- File stores use `lib/projectScopeFile.js` (`matchesScopedRecord`, `attachScopeFields`)
- **Legacy compat (default):** `projectCompatOr()` includes rows with `NULL project_id` for the current user until backfill completes
- **Strict mode:** set `STRICT_PROJECT_SCOPE=true` in env after backfill to scope **only** the active `project_id` (no NULL bleed)
- Apply `docs/011_multitenancy_acquire_engage.sql` then optional `docs/012_multitenancy_backfill_primary_project.sql`
- Uniqueness is **per-project** (e.g. contact email), not global

**When data appears in the wrong project:** check DB `project_id` backfill, `STRICT_PROJECT_SCOPE`, store scoping, unique indexes, and client cache after project switch.

---

## 8. Domain Map (Code vs UI Names)

| UI name | Code / route prefix | Notes |
|---------|---------------------|-------|
| **Builder** | `develop`, `develop_*` tables | Planned rename `develop` → `build` not done |
| **Messaging: Topics** | `topics` | Canonical; old `category` terminology is deprecated |
| **Acquire** | `acquire` | Web, YouTube, X, Reddit |
| **Engage** | `engage` | Social posts → `engage_social_posts` (Supabase + scoped file fallback) |
| **Ask Roger** | `devAgent`, `App.devAgent` / `App.roger` | Dev/agent tooling |
| **Assets** | `assets` | Prefer Vercel Blob (`ASSET_STORAGE_PROVIDER=vercel_blob`) |

---

## 9. Configuration

### Required env (production)

See `lib/config.js` SCHEMA and `docs/VERCEL_CUTOVER.md`:

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `CHANNELS_ENCRYPTION_KEY`
- `BLOB_READ_WRITE_TOKEN` (when using Blob assets)

### Local

- Copy `.env.example` → `.env` (create example if missing)
- Never commit `.env` or `data/api_settings.json`

---

## 10. Agent & Multi-Tool Workflow

- **Tri-agent protocol:** `docs/tri_agent_protocol_v1.md` (Human, Roger, Antigravity)
- **Ask Roger / dev agent:** `routes/devAgent.js`, `public/js/devAgent.js` — large, sensitive files
- **`ai-daemon/`:** separate Node service (GenAI, git, Supabase) — not the main app server
- **Past failures:** `docs/roger_diagnostic_report.md` — do not break `public/app.js`, `vercel.json`, or monolithic boot order without verification

### Protected files (require extra care)

- `public/app.js` — SPA bootloader / module registry
- `vercel.json` — API routing
- `public/index.html` — prefer `src/` + `build:html`
- `public/js/devAgent.js`, `public/js/develop.js`, `public/js/messaging.js` — very large

---

## 11. UI & Style Canon

**Authoritative references:**

- **Agent quick rules:** `.cursorrules` (Style Guide section — compiled from all prior UI discussions)
- **Full blueprints:** `docs/UI_STANDARDS.md`, `docs/STYLE_GUIDE.md`

---

## 12. Prioritized Top Ten (Agent Workstream)

Ordered by “blocks safe, predictable work” first. **Item 1 is done.** Continue from item 2.

### ✅ 1. Documentation and source-of-truth drift — COMPLETE

**Was:** Stale paths (`alphire-promo`), missing README, wrong `project_manifest.json`, 2MB `roger_context.md` dump, no `.cursorrules`.

**Done (2026-05-18):**

- Rewrote this file (`docs/AI_AGENT_HANDOFF.md`) as canonical handoff
- Added `.cursorrules` with compiled UI standards (not copied from Normie)
- Added `README.md`, `.env.example`, updated `project_manifest.json`
- Superseded banners on legacy docs; deploy docs link here

**Next agent:** Start with this file + `.cursorrules`; do not use `ai-daemon/sandbox/isit-app/docs/` as schema source.

---

### 2. Multitenancy is not finished — OPERATOR COMPLETE (code follow-ups remain)

**Risk:** Data from one StarCaster project appearing in another; production writes to read-only filesystem.

**Done in code (needs operator steps):**

- `STRICT_PROJECT_SCOPE` in `lib/projectScope.js` (set in **StarCaster** `.env` / Vercel only—not Normie)
- `lib/projectScopeFile.js` for JSON/file stores
- Promote Social → `lib/promoteSocialStore.js` (Supabase `engage_social_posts` + scoped file fallback)
- Direct Acquire runs → `lib/directAcquireRunsStore.js`
- X/Reddit harvest JSON stores filter by `project_id` in `lib/acquire/XAcquireStore.js`, `lib/acquire/RedditAcquireStore.js`
- SQL: `docs/011_multitenancy_acquire_engage.sql`, backfill template `docs/012_multitenancy_backfill_primary_project.sql`

**Operator checklist (StarCaster Supabase + env):**

1. Run `docs/011_multitenancy_acquire_engage.sql` in the **StarCaster** Supabase project
2. Backfill `NULL project_id` rows to one `app_projects.id` (see §12 item 2 / `012` template)—only if legacy data exists
3. Set `STRICT_PROJECT_SCOPE=true` in `~/WebApps/starcaster/.env` and StarCaster Vercel env; restart dev server

**Still open:**

- ~~OpenClaw acquire job mirror~~ — **scoped** via `acquire_job_mirror` (`013_file_stores_supabase.sql`)
- Wire X/Reddit stores to Supabase tables (schema in 011; still file-primary)
- Backfill remaining domains (contacts, assets, messaging, etc.) if NULL rows remain
- Audit every store under `lib/` for missing `scopedListQuery` / `requestProjectScope` in routes

---

### 3. Hybrid file persistence on Vercel — IN PROGRESS

**Risk:** `EROFS` when code writes `data/*.json` in production.

**Done (2026-05-18):**

- `docs/FILE_PERSISTENCE_INVENTORY.md` — store-by-store status
- `lib/localDataFs.js` — skips `data/*.json` writes when `VERCEL` / `VERCEL_ENV` is set
- All `lib/*` JSON stores wired to `writeJsonAtomic` / `ensureJsonFile`
- **Connection Ops** → Supabase `connection_ops_state` (`docs/supabase_connection_ops_setup.sql`); routes pass `requestProjectScope`
- `apiSettings` — EROFS → 409 unchanged; uses shared helper

**Operator checklist (Connection Ops on Vercel):**

1. Run `docs/supabase_connection_ops_setup.sql` in StarCaster Supabase
2. Redeploy; gate/attempt saves require active project + Supabase env

**Still open:**

- Run `docs/013_file_stores_supabase.sql` per environment (see `MIGRATIONS_APPLIED.md`)
- X/Reddit harvest Supabase-primary (tables in 011; stores still file-fallback)
- `directAcquireRunsStore` uses `/tmp` on read-only deploys (OK for ephemeral runs)

**Done (2026-05-18, stores):**

- `acquireMirror.js`, `orchestratorRunsStore.js`, `developIconStore.js` → Supabase-primary + scoped file fallback (`013_file_stores_supabase.sql`)

---

### 4. No migration runner — schema drift — BASELINE DONE

**Risk:** SQL in `docs/*.sql` applied out of order or skipped on deploy.

**Done (2026-05-18):**

- **`docs/MIGRATIONS_APPLIED.md`** — applied log (per environment), recommended tier order, domain catalog, verify queries
- **`supabase/migrations/README.md`** — optional future CLI home; points to `docs/` as canonical

**Operator habit:** After running SQL in Supabase, add a row to the applied log in `MIGRATIONS_APPLIED.md` (local / preview / prod + date).

**Still open:**

- No automated runner or CI schema check
- New migrations: continue `docs/NNN_*.sql` numbering from `013_*` and document in the tracker

---

### 5. Monolithic frontend scale and fragility

**Risk:** White-screen / boot failures when editing `public/app.js`, `vercel.json`, or generated `public/index.html`.

**Action:** Edit `src/pages/*.html` + `npm run build:html`; surgical changes to `develop.js`, `messaging.js`, `devAgent.js`. See `docs/roger_diagnostic_report.md`.

---

### 6. Zero automated tests

**Risk:** Regressions on route registry, project scope, API envelope.

**Action:** Minimal smoke tests: `node --check` in CI; optional tests for `projectScope`, `requestProjectScope`, one scoped store fixture.

---

### 7. Environment and secrets setup — PARTIALLY DONE

**Was:** No `.env.example`; split brain between env and `data/api_settings.json`.

**Done:** `.env.example`, README quick start.

**Action:** Confirm Vercel has required vars per `docs/VERCEL_CUTOVER.md`; document which API keys are env-only vs Settings UI.

---

### 8. Naming and product identity inconsistency

**Risk:** Wrong tables/routes (`develop` vs Builder, `category` vs `topic`, old product names).

**Action:** Short glossary in this file or `docs/` — code name → UI label → DB table. Planned `develop` → `build` rename not executed.

---

### 9. React vs vanilla strategy undefined

**Current:** React only for Campaigns list (`react-entry.js` → `public/bundle.js`). Everything else vanilla.

**Action:** Product decision: expand React islands, remove React, or document “campaigns only” in `.cursorrules` (partially stated). Default new UI to vanilla unless directed.

---

### 10. Multi-agent / ai-daemon complexity

**Risk:** Editing wrong tree (`ai-daemon/sandbox/`), breaking `vercel.json` or `public/app.js`.

**Action:** Single docs root: `~/WebApps/starcaster/docs/`. Guardrails in `.cursorrules`. Tri-agent notes in `docs/tri_agent_protocol_v1.md`.

---

## 13. Recommended Read Order

1. This file (especially §12 Top Ten)
2. `docs/FILE_PERSISTENCE_INVENTORY.md` (Vercel / `data/*.json` stores)
3. `docs/MIGRATIONS_APPLIED.md` (SQL apply order + environment log)
4. `.cursorrules`
5. `routes/index.js`
6. `public/app.js` + `public/js/core.js`
7. `lib/supabase.js` + `lib/projectScope.js` + `lib/projectScopeFile.js` + `lib/localDataFs.js`
8. The domain you are modifying (`routes/<domain>.js` + `public/js/<domain>.js` + relevant `docs/*_setup.sql`)

---

## 15. Quick Commands

```bash
# Syntax-check a file
node --check /Users/mentor/WebApps/starcaster/routes/contacts.js

# Rebuild shell after HTML edits
npm run build:html

# Full asset migration check (when configured)
node scripts/vercel_cutover_check.js
```

---

## 16. Guidance for the Next Agent

Treat StarCaster as a **craftsman’s platform in consolidation**, not greenfield. Preserve:

- Route/store/module patterns
- API response envelope
- Project scoping on new tables
- HTML build pipeline
- UI standards in `.cursorrules`

When unsure: grep execution paths, check Supabase schema in `docs/`, verify whether the bug is code vs missing migration vs stale client state.

**Dogfooding:** Pick one **StarCaster** `app_projects` workspace (e.g. your main brand) and run Acquire → Messaging → Campaigns → Engage there. The **Normie** website (`~/WebApps/normie`) is a separate app you may promote *through* StarCaster—it is not where `STRICT_PROJECT_SCOPE` or multitenancy SQL belong.
