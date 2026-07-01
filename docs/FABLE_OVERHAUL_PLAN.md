# Starcaster Overhaul Plan

*Produced by Claude Fable 5 from a full repository review, 2026-07-01.*

Starcaster is being re-engineered bottom-up. There is no client or investor
schedule pressure, so ordering is by **dependency, not urgency**: each phase is
a beam the later phases bolt onto. This is a **strangler rebuild** — the app
stays deployable and benvin.org keeps serving after every phase. There is no
long-lived rewrite branch.

---

## Context: the Top Ten issues (2026-07-01 review)

1. **Committed credentials and user data** — `data/auth_users.json` (real
   scrypt password hashes) and `data/auth_sessions.json` are tracked in git;
   the whole `data/*.json` fallback store silently loses writes on Vercel.
2. **Dev server exposes unauthenticated filesystem read/write** —
   `/api/system/filesystem/content` in `server.js` reads and writes arbitrary
   files under the repo root (including `.env.local`); RCE-adjacent if the
   port is ever reachable.
3. **Auth hardening cluster** — `Math.random()` password-reset OTP, session
   token echoed in login/register response bodies, account enumeration in
   forgot-password, `SameSite=None` cookies with no CSRF protection,
   in-memory rate limiter that is per-lambda (fictional) in production, and a
   spoofable `x-vercel-cron` header trusted for cron auth.
4. **Unauthenticated `/api/debug-routes`** leaks route registry, deployment
   metadata, key hints, and the unmasked OpenClaw base URL.
5. **Dual frontend architectures** — ~94k lines of vanilla JS in `public/js`
   (builder.js 14k, messaging.js 10k) alongside the React/TS builder in
   `components/` + `lib/builder-client`.
6. **Build artifacts committed to git** — `builder-bundle.js`, `bundle.js`,
   `app-shell.html`, `styles.css`; 600+ historical copies bloat the repo to
   ~350MB and create source/artifact drift.
7. **No CI, no branch protection** — push to `main` auto-deploys production;
   typecheck/tests/build run only if someone remembers.
8. **Security-critical routing is a hand-maintained flag pile** —
   `routes/index.js` auth-bypass booleans plus monolith route files
   (engage.js 2.8k lines, acquire.js 2.8k, builder.js 1.9k); tenant scoping
   re-implemented per store instead of enforced by Postgres RLS.
9. **Public-site serving is slow by configuration** — every visitor request
   is a `no-store` lambda invocation with `maxDuration: 300`; heavy prod deps
   (playwright, jsdom, sharp) in the function bundle.
10. **Repo junk drawer** — `ai-daemon/`, `ag-bridge/`, `experiments/`, AI
    chat transcripts in `docs/`, unused deps, stray files.

Already solid (do not churn): scrypt + `timingSafeEqual` password hashing,
DOMPurify allowlist sanitization, origin-allowlist CORS, the route-module
manifest convention, atomic JSON writes, dry-run/apply migration scripts.

---

## Three decisions made up front

1. **Adopt Supabase Auth** rather than rebuilding the custom stack. It
   replaces `lib/authStore.js`, hand-rolled sessions, the OTP flow, and
   reset-email plumbing in one move, and it is the precondition for Postgres
   RLS tenant isolation (policies key off `auth.uid()`). Migration cost is
   near zero today and grows every month.
2. **Keep the custom Node kernel, modernized — no Next.js big-bang.** The
   bottleneck is the flag-pile dispatcher and dual frontend, not the
   framework. Revisit framework adoption after Phases 2 and 4 shrink the
   surface area.
3. **`public/js` is end-of-life from day one.** React/TypeScript
   (`components/` + `lib/builder-client`) is the survivor — it has the tests,
   types, and momentum. The vanilla side is frozen: bugfixes only, and every
   touched screen migrates.

---

## Phase 0 — Clear the site (repo, pipeline, guardrails)

*Goal: every later phase is protected by machines instead of memory.*

- Rotate every credential in `.env.local`; untrack `data/auth_users.json` and
  `data/auth_sessions.json`; rewrite history with `git filter-repo` to purge
  those files and the historical bundle/CSS artifacts (~350MB → tens of MB).
  Untrack all build artifacts going forward; de-duplicate `.gitignore`.
- Delete the junk drawer: `ai-daemon/`, `ag-bridge/` (or move to a tools
  repo), `experiments/`, stray files (`9`, `public/js/_temp.js`); archive
  docs transcripts outside the repo. Dependency audit: `express`,
  `playwright` → dev/tools; audit `imap-simple`/`mailparser`/`jsdom`.
- Remove the filesystem read/write and knowledge endpoints from `server.js`;
  agent tooling never lives on the app server.
- Stand up GitHub Actions: typecheck + vitest + full production build on
  every PR; branch protection on `main`; Vercel preview deployments as the
  review surface. Gate `/api/debug-routes` behind admin auth.

**Exit criteria:** repo under ~50MB; CI red/green on PRs; no secrets or
artifacts tracked; dev server has no self-modification endpoints.

## Phase 1 — Foundation beam: the data layer

*Goal: one database, one access pattern, schema as code.*

- Supabase becomes the only store. The `data/*.json` fallback dies; local dev
  runs against a local Supabase instance (`supabase start`).
- All schema moves into versioned migrations under `supabase/migrations/`
  (consolidating `docs/SQL/*.sql`). Generate TypeScript types from schema.
- Replace the 169 stores' string-concatenated PostgREST queries with
  `supabase-js` through a thin typed data-access module per entity —
  mechanical, agent-friendly, one store per PR.
- Enable RLS for tenant isolation: every tenant table gets a `project_id`
  policy. Per-store scoping becomes defense-in-depth, not the only defense.

**Exit criteria:** `rm -rf data/` breaks nothing; fresh clone +
`supabase db reset` reproduces the schema; a deliberate cross-tenant query in
a test is rejected by Postgres, not application code.

## Phase 2 — Second beam: the request kernel and auth

*Goal: routing and auth you can reason about by reading one manifest.*

- Migrate to Supabase Auth. Cookies go `SameSite=Lax` + HttpOnly; cron
  endpoints verify `CRON_SECRET` only.
- Rebuild `routes/index.js` as a declarative registry: each route declares
  `{ path, method, access: public | tenant-public | session | admin | cron,
  projectScoped }` and the kernel enforces it. The boolean flag pile and the
  parallel exemption list in `lib/requireProjectContext.js` are deleted.
- The kernel also owns: durable rate limiting (Postgres or Upstash),
  structured request logging, centralized error responses, CSRF strategy.

**Exit criteria:** a printed route table shows every endpoint's access level;
integration tests cover every access class (anonymous, tenant visitor,
session, admin, cron) and assert the right 401/403s.

## Phase 3 — Domain modules

*Goal: no file you're afraid to open.*

- Split `engage.js`, `acquire.js`, `builder.js` into resource-scoped modules
  on the new kernel, each owning validation and registering its manifest.
  Target: no route file over ~400 lines.
- Each migrated module picks up integration tests against local Supabase.
- Cull dead features honestly: anything the client site doesn't need and
  nobody loves is deleted or flagged off, not ported. Porting dead code to a
  clean architecture is how clean architectures die.

**Exit criteria:** every endpoint lives in a module ≤400 lines with tests;
the feature list is a deliberate choice, not an accretion.

## Phase 4 — Frontend consolidation

*Goal: one app, one language, one build.*

- Migrate admin screens from `public/js` to React/TS in order of churn:
  builder-adjacent first, then messaging, contacts/CRM, settings, long tail.
  `App.els`, the `app-shell.html` assembly, and the vanilla richtext stack
  retire with their last consumers.
- Extract the design system: Builder Themes tokens become the shared
  component library for the admin app too.
- One esbuild (or Vite) pipeline; no committed bundles; content hashing does
  cache busting (retire `pin_asset_versions` churn).

**Exit criteria:** `public/js` is deleted; one bundle pipeline; typecheck
covers the whole frontend. Longest phase — run as a background workstream in
parallel with Phase 5 (different layers).

## Phase 5 — The product beam: public site serving

*Goal: benvin.org is fast enough to brag about.*

- Render-on-publish: published Builder pages render to static HTML in
  Blob/KV; serving becomes CDN-cached (`s-maxage` +
  `stale-while-revalidate`) with invalidation on republish. No cold starts,
  no 300-second lambdas in the visitor path.
- Slim public runtime: small hydration bundle for interactive modules, not
  the 1.4MB builder bundle.
- SEO/polish pass: per-page meta/OG, sitemap.xml, robots.txt, canonicals,
  per-tenant favicons, 404/500 pages; Lighthouse/CWV budget enforced in CI.
- Finish in-flight theming work (per-element overrides, live-canvas theming,
  pageBackground route-drop bug) on the new serving path.

**Exit criteria:** benvin.org scores 95+ on Lighthouse performance/SEO;
republish appears globally in seconds; visitor requests are cache hits.

## Phase 6 — Operate like a product

*Goal: find out about problems before the client does.*

- Error tracking (Sentry or similar) on API and frontend; structured logs;
  uptime checks on benvin.org and the API.
- Playwright e2e smoke suite (login → edit → publish → verify live) in CI
  against preview deploys.
- Operating docs: architecture overview, "how to add a
  route/module/store," deploy/rollback runbook. With an agent-fleet
  workflow, convention docs are force multipliers.

---

## Coverage map

| Top-Ten issue | Resolved in |
|---|---|
| 1. Committed credentials / JSON stores | Phase 0 (purge) + Phase 1 (Supabase-only) |
| 2. Dev-server FS endpoints | Phase 0 |
| 3. Auth hardening cluster | Phase 2 |
| 4. Debug info disclosure | Phase 0 |
| 5. Dual frontend | Phase 4 (frozen from day one) |
| 6. Artifacts in git / repo bloat | Phase 0 |
| 7. No CI / push-to-main | Phase 0 |
| 8. Flag-pile dispatcher / monolith routes | Phases 2–3 |
| 9. Public-site performance | Phase 5 |
| 10. Junk drawer / dependencies | Phase 0, enforced thereafter by CI |

## Sequencing

Phases 0 → 1 → 2 are strictly sequential — they are the beams. Phases 3–5
can overlap once the kernel is stable. Rough pacing at current velocity:
Phase 0 in days, Phases 1–2 a couple of weeks each, Phase 3 continuous,
Phase 4 the long pole (parallel workstream), Phase 5 one to two focused
weeks.

The one discipline that makes this work with an agent fleet: **small PRs,
CI-gated, one module at a time.** The failure mode of "rebuild from the
ground up" is a six-week branch that never merges; the strangler version
ships every day.
