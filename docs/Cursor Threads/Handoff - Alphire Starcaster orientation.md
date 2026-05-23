# Handoff — Alphire Starcaster orientation

**Repo:** `~/WebApps/starcaster`  
**Company:** Alphire · **Product:** StarCaster  
**Thread date:** 2026-05-18  
**Human:** Mentor (switching workspace from Normie → StarCaster)  
**Canonical technical doc:** [`docs/AI_AGENT_HANDOFF.md`](../AI_AGENT_HANDOFF.md) (read §12 first)

---

## 1. What this thread was about

The human asked Cursor to **take over as primary developer** for StarCaster after prior work with Google Antigravity, Codex, and Claude Code. This thread was **orientation and foundation**, not feature delivery.

| Phase | Topic | Outcome |
|-------|--------|---------|
| **A** | Codebase review + initial Top Ten risks | Written analysis; agreed foundation is solid, many gaps remain |
| **B** | **Top Ten #1** — documentation drift | **Complete** — see §3 below |
| **C** | **Top Ten #2** — multitenancy | **Code landed**; operator steps documented; human ran SQL / env (per later handoff updates) |
| **D** | Clarify **StarCaster vs Normie** | Human almost put `STRICT_PROJECT_SCOPE` in Normie `.env.local` — must live in StarCaster only |
| **E** | Top Ten added to `AI_AGENT_HANDOFF.md` for next agent | §12 in canonical handoff; item 1 marked complete |

**Normie relationship (important):** Normie (`~/WebApps/normie`) is a **separate Next.js product**. StarCaster is the **Alphire operations platform**. A “project” in StarCaster is a row in `app_projects` (workspace switcher)—not the Normie repo. Dogfooding means using one StarCaster workspace while building features you’ll later use for a brand like Normie—not merging env files or databases unless explicitly intended.

---

## 2. Where to start (next agent)

1. Open workspace: **`~/WebApps/starcaster`** (not Normie).
2. Read **`docs/AI_AGENT_HANDOFF.md`** — especially **§12 Prioritized Top Ten**.
3. Read **`.cursorrules`** before UI or route work.
4. Check **`docs/MIGRATIONS_APPLIED.md`** before assuming SQL has been applied in this environment.
5. For Vercel/file-store behavior: **`docs/FILE_PERSISTENCE_INVENTORY.md`**.

**Do not use** `ai-daemon/sandbox/isit-app/docs/` as schema source — duplicate/stale.

---

## 3. Completed in this thread (Top Ten #1)

| Artifact | Purpose |
|----------|---------|
| `docs/AI_AGENT_HANDOFF.md` | Single source of truth; paths, architecture, §12 workstream |
| `.cursorrules` | Agent rules + compiled UI standards (StarCaster-specific, not Normie) |
| `README.md` | Quick start + doc index |
| `.env.example` | StarCaster env template (includes `STRICT_PROJECT_SCOPE`) |
| `project_manifest.json` | Accurate stack (vanilla + React campaigns island) |
| Superseded banners | On legacy docs (`roger_context.md`, `Hive_Mind.md`, etc.) |
| `docs/012_multitenancy_backfill_primary_project.sql` | Renamed from `*_normie.sql` to avoid confusion |

---

## 4. Multitenancy work started (Top Ten #2)

**Problem:** Legacy `NULL project_id` rows and unscoped file stores caused data to appear across StarCaster workspaces.

**Code added (this thread):**

- `lib/projectScope.js` — `STRICT_PROJECT_SCOPE` env (strict = no NULL bleed)
- `lib/projectScopeFile.js` — scoping for JSON file stores
- `lib/promoteSocialStore.js` — Supabase `engage_social_posts` + scoped file fallback
- `lib/directAcquireRunsStore.js` + updates to `lib/directAcquire.js`
- Scoped X/Reddit harvest file stores; routes pass `requestProjectScope(req)`
- `docs/011_multitenancy_acquire_engage.sql` — table definitions

**Operator steps (StarCaster only):**

1. Apply `docs/011_multitenancy_acquire_engage.sql` in **StarCaster’s** Supabase.
2. If legacy NULL rows exist, run backfill using `docs/012_multitenancy_backfill_primary_project.sql` (replace `YOUR_PROJECT_ID` / `YOUR_USER_ID` from `app_projects` and `app_auth_users`).
3. Set `STRICT_PROJECT_SCOPE=true` in **`~/WebApps/starcaster/.env`** and StarCaster **Vercel** env — **not** `~/WebApps/normie/.env.local`.

**Still open (see §12 in handoff):** X/Reddit Supabase-primary wiring, full store audit, remaining file→Supabase migrations (later threads may have advanced items 3–4).

---

## 5. Prioritized Top Ten — status snapshot

Copy maintained in **`docs/AI_AGENT_HANDOFF.md` §12**. Summary for thread continuity:

| # | Item | Status at thread end |
|---|------|---------------------|
| 1 | Documentation / canon | ✅ Complete |
| 2 | Multitenancy | 🟡 Code + SQL docs; operator steps; follow-ups in handoff |
| 3 | File persistence on Vercel | 🟡 May be in progress in repo (see handoff §12) |
| 4 | Migration runner / tracker | 🟡 `MIGRATIONS_APPLIED.md` may exist — verify in repo |
| 5 | Monolithic frontend | ⬜ Open |
| 6 | Automated tests | ⬜ Open |
| 7 | Env / secrets | 🟡 `.env.example` done |
| 8 | Naming drift (`develop` vs Builder) | ⬜ Open |
| 9 | React vs vanilla policy | ⬜ Open (campaigns island only today) |
| 10 | ai-daemon / multi-agent guardrails | ⬜ Open (partially in `.cursorrules`) |

*If §12 in `AI_AGENT_HANDOFF.md` disagrees with this table, trust the handoff file (it is updated in-repo).*

---

## 6. StarCaster at a glance (orientation)

**What it is:** Platform for influencers/creators to establish web presence, promote, and engage (comments, social, harvest workflows) across the social web.

**Stack:**

- Vanilla JS SPA (`public/js/*`, `window.App`) + HTML from `src/pages/` → `npm run build:html`
- React **only** for Active Campaigns (`react-entry.js` → `public/bundle.js`)
- Node API: `routes/index.js` (local `server.js` + Vercel `api/[...slug].js`)
- Supabase PostgreSQL; SQL in `docs/*.sql` (manual apply + log)

**Protected / sensitive:**

- `public/app.js` — SPA bootloader
- `vercel.json` — must keep `/api/*` rewrite
- `public/index.html` — generated; edit `src/` instead

**Local dev:**

```bash
cd ~/WebApps/starcaster
cp .env.example .env   # fill Supabase + CHANNELS_ENCRYPTION_KEY, etc.
npm install
npm run dev
```

---

## 7. Common pitfalls (from this thread)

1. **Wrong repo for env vars** — `STRICT_PROJECT_SCOPE`, `SUPABASE_*` for StarCaster belong in **starcaster** `.env`, not Normie `.env.local`.
2. **Wrong Supabase** — Migrations run against the database StarCaster’s `SUPABASE_URL` points to.
3. **“Normie” in filenames** — Means “primary test workspace,” not the Normie codebase. Prefer `012_multitenancy_backfill_primary_project.sql`.
4. **Editing `public/index.html` directly** — Use `src/pages/` + `build:html`.
5. **Breaking `vercel.json`** — Past production 404 on all `/api/*` routes.

---

## 8. Suggested next threads (one task each)

| Thread | Focus |
|--------|--------|
| **Multitenancy verify** | Confirm 011/012/013 applied; project switch smoke test Engage + Acquire |
| **Feature flesh-out** | Pick one domain (e.g. Promote social queue UX) with one StarCaster project selected |
| **Normie as dogfood** | Plan content/campaigns **inside StarCaster** for a brand; build **site** changes in Normie repo separately |

---

## 9. Related thread docs in this folder

- [`Cursor Recommendations 1-3.md`](Cursor%20Recommendations%201-3.md) — earlier thread: Cursor UI, auth landing, thread hygiene rules

---

*End of thread handoff. For implementation detail, architecture, and live Top Ten status, always prefer `docs/AI_AGENT_HANDOFF.md`.*
