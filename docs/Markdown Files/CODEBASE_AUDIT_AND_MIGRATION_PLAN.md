# Codebase Audit & Normie → StarCaster Migration Plan

**Date:** 2026-06-11
**Scope:** Full review of StarCaster (`~/WebApps/starcaster`) and Normie (`~/WebApps/normie`), plus a plan to (a) migrate Normie's improved features back into StarCaster while preserving each site's look-and-feel, and (b) raise both codebases to senior-developer quality.

---

## Part 1 — The Two Codebases at a Glance

| | StarCaster | Normie |
|---|---|---|
| **Stack** | Express 5 + vanilla-JS SPA (`window.App` modules), React islands via esbuild, custom HTML build pipeline | Next.js 15 (App Router) + TypeScript strict + React 19 |
| **Purpose** | Multi-tenant creator platform: Acquire → Develop → Messaging → Engage → Promote | Public poll/game site + admin control room + player portal |
| **Database** | Supabase, project-scoped (`project_id`), service-role key for everything, no RLS | Supabase with partial RLS, admin RBAC |
| **Tests** | 26 tests total (builder document model only) | 319 vitest tests across 81 files (2 currently failing) |
| **Lint / types** | None | ESLint + `tsc --noEmit` + `npm audit` in a `verify` script |
| **Maturity** | Functional MVP, production-adjacent | Functional MVP → early production |

**Key architectural fact:** this is a **cross-stack migration**. Normie's Builder is React + TypeScript; StarCaster's app shell is vanilla JS with an optional React island (`builder-react-entry.jsx` → `public/builder-bundle.js`, toggled via `localStorage builder_v2`). The good news: because the Builder UI in StarCaster is already a React island, Normie's React components can be ported nearly directly — the island pattern is the bridge.

---

## Part 2 — StarCaster Quality Assessment

**Verdict: Functional MVP.** The architecture is more coherent than typical vibe-coded output — central dispatcher (`routes/index.js`), consistent `{ ok, data, error }` response envelope, project-scoped multitenancy, validated config (`lib/config.js`). But it has near-zero tests, no linting, serious duplication, and several real security holes.

### Top problems (with evidence)

1. **CRITICAL — Unauthenticated debug endpoint leaks session tokens.** `routes/auth.js` (~line 212) `/api/auth/debugSession` returns raw cookies, the Authorization header, and the plaintext session token to anyone. Remove it or gate it behind an admin check.
2. **CORS echoes any origin with credentials enabled.** `routes/http.js:19-24` reflects `req.headers.origin` into `Access-Control-Allow-Origin` while also sending `Access-Control-Allow-Credentials: true`. Whitelist origins instead.
3. **No CSRF protection** on state-changing routes (auth is cookie-based, so cross-site POSTs ride the session).
4. **No RLS; service-role key everywhere.** All Supabase access goes through `lib/supabase.js` with the service key. One injection or scoping bug exposes every tenant's data. Multitenancy is enforced only in application code (`lib/projectScope.js`).
5. **God files.** `public/js/develop.js` is ~14,400 lines; `public/js/messaging.js` ~9,800; `routes/engage.js` ~2,800. These are unmaintainable and the docs themselves flag them as "fragile, surgical edits only."
6. **Massive duplication.** `safeText()` is independently defined ~30 times across `routes/` and `lib/`; `maskSecret()`/debug helpers duplicated in 3+ places. No shared utility module.
7. **Silent error swallowing.** Bare `catch {}` blocks throughout (`routes/engage.js:90`, `:510`, etc.) make production failures invisible.
8. **Essentially no tests** (26 builder tests), no ESLint/Prettier, no CI gate — broken code deploys freely.
9. **Schema management by hand.** 138 SQL files in `docs/SQL/` applied manually via the Supabase SQL editor, tracked in `MIGRATIONS_APPLIED.md`. Works, but drift-prone; should converge on `supabase/migrations/`.
10. **Hardcoded builder config.** `lib/builder/template.js` is ~1,970 lines of inline module definitions.

### Strengths worth preserving
- Central route dispatcher with session auth, project resolution, and rate limiting in one place.
- `lib/config.js` env validation at startup — genuinely good practice.
- Consistent API envelope; consistent store pattern (`lib/*Store.js`) with Supabase-primary + local-file fallback.
- Strong written conventions (`AI_AGENT_HANDOFF.md`, `UI_STANDARDS.md`, `STYLE_GUIDE.md`).

---

## Part 3 — Normie Quality Assessment

**Verdict: Functional MVP → early production, and meaningfully better engineering discipline.** Strict TypeScript, real test suite, structured JSON logging with secret redaction, request-ID correlation, security headers middleware, DOMPurify sanitization, admin RBAC. The "verify" script (`typecheck && lint && test && audit`) is exactly the right habit — but it's currently red.

### Top problems

1. **2 failing tests break `npm run verify`**: `lib/gallery-media-query.test.ts` (a `hasPoll` field was added without updating the test) and `lib/rich-text-image.test.ts` (a CommonJS `require("@/lib/sanitize-html")` at `lib/rich-text-image.ts:137` that can't resolve the `@/` alias — switch to dynamic `import()`).
2. **God files again**: `components/admin-game-workspace.tsx` is 4,429 lines with ~25 `useState` hooks; `builder-module-card.tsx` and `builder-module-repository-list.tsx` are ~2,470 each.
3. **RLS gaps**: only `builder_*` and rate-limit tables have RLS enabled; `polls`, `player_profiles`, `blog_posts`, etc. rely on the service-role/anon split alone.
4. **CSP allows `unsafe-eval` + `unsafe-inline`** in `lib/security-headers.ts:46` — undermines the XSS protection the sanitization layer works hard for.
5. **Service-role client used inside public player endpoints** (e.g. `app/api/player/register/route.ts`).
6. **No runtime schema validation** — inline `safeText()`/`safeInteger()` helpers instead of zod on API inputs.
7. **71 lint warnings**, mostly unused variables/dead exports — noise that hides real issues.
8. **Duplicated `readAdminJson<T>()`** in three admin workspace components.
9. **Large components with no memoization/code-splitting** — admin workspaces re-render wholesale.
10. **Error-handling inconsistency** — some routes silently swallow (`app/api/player/session/route.ts:75-79`), others wrap with context.

---

## Part 4 — Builder Comparison & Port Status

The uncommitted work on branch `cursor/estimated-progress-and-peer-filters` is a partial port of Normie's Builder, roughly **45–50% complete**:

| Layer | Status |
|---|---|
| Data model / JSON document schema | **~95–100% — identical** (`BuilderTemplateSection`, `BuilderTemplateModule`, `Record<string,string>` settings, same layout keys, same background model). Only real difference: Normie uses bigint IDs, StarCaster text IDs + `project_id` scoping. |
| Module-type parity | **Complete** — all 22–26 types (heading, text, image, video, button, table, slider, social, polls, speech-bubble, reminder, confetti, merch, contact-form, player-portal, navigation, etc.) exist in both schemas. |
| Backend API (`routes/develop.js`, `lib/builder/*`, `lib/develop*Store.js`) | **~100% ported**, with tests for the document model and a legacy-grid-code migration (`3-3`, `1-4-1` ↔ Normie layout keys). |
| Workspace shell (`components/builder/BuilderWorkspace.jsx`) | ~70% — lists, modes, save/load, device toggle. |
| **Visual editor canvas** (React island) | **~0%** — no module palette modal, no drag-drop, no style panels, no rich-text editor, no gallery modal, none of Normie's 7 module-specific settings editors. |
| Vanilla editor (`public/js/develop.js`) | Exists as the current default (workspace, row editor, module picker) but has known bugs: 1-4-1 layout sizing, save UX, cross-cell drag, table borders. |
| Builder tests in StarCaster | Document model only; none for UI/API routes. |

**What Normie has that StarCaster's port still lacks (the gap list):** module palette modal + `builder-drag-utils.ts`, `builder-rich-text-editor.tsx` (Tiptap), `builder-section-card.tsx`, cell-style settings panels, background controls with gradient/image/presets, the 7 module-specific editors (confetti, reminder, speech-bubble, floating-image, current-poll, social, heading), gallery modal, floating save rail, template preview renderer, and the runtime components (confetti/speech-bubble/reminder runtimes).

---

## Part 5 — Migration Plan (Normie → StarCaster)

### Guiding decisions

1. **Drop the dual-editor strategy.** Maintaining both a vanilla editor (in the 14K-line `develop.js`) and a React island guarantees neither gets finished. The schema parity means the React island can become the only Builder editor. Port Normie's React components into the island, make `builder_v2` the default, then delete the vanilla builder code from `develop.js` (a huge quality win by itself).
2. **Share logic, not look.** Normie's `lib/builder-template.ts`, `builder-utils.ts`, `builder-email-template.ts`, hex-color/trigger/confetti/reminder libs have **zero UI dependencies** and are schema-identical. Extract them into a shared package (e.g. `packages/builder-core`, consumed by both repos via npm workspace or git dependency). UI components stay per-repo and consume **CSS custom properties** (`--accent`, `--ink`, etc. in StarCaster; Normie's palette in `globals.css`) so each site keeps its distinct skin.
3. **One quality bar for ported code.** Everything ported lands with types (TS or rigorous JSDoc), tests, and lint clean — the port is the vehicle for the quality upgrade, not a source of new debt.

### Phase 0 — Stabilize (1–2 days)
- Commit/branch-merge the current StarCaster working tree (50 uncommitted files is too much risk to carry).
- Fix Normie's 2 failing tests so `verify` is green again — Normie is the source of truth for the port and must be trustworthy.
- Fix StarCaster's critical security holes now (debugSession endpoint, CORS) — they're independent of the migration and dangerous.

### Phase 1 — Builder parity in StarCaster (2–4 weeks)
Port, in priority order, restyling against StarCaster's CSS variables as you go:
1. Editor canvas: `builder-section-card`, `builder-module-card`, module palette modal, `builder-drag-utils` (drag-drop reorder).
2. Styling panels: background controls, cell style settings, button color/border/shadow pickers.
3. `builder-rich-text-editor` (Tiptap — versions already pinned identically in both repos).
4. The 7 module-specific settings editors + gallery modal (wire to StarCaster Assets instead of Normie's gallery).
5. Preview renderer + runtime components (confetti, speech-bubble, reminder) — this also brings the **game layer** (`game-reminder`, `game-audience` eval logic) into StarCaster, where `lib/gameLevelEventsStore.js` and `docs/SQL/game_layer_setup.sql` are already waiting.
6. Floating save rail, list filters/sort, debug panel.
7. Port Normie's builder test files alongside (builder-utils, template, email-render, reminder-module).
8. Flip `builder_v2` to default; delete the vanilla builder from `develop.js`.

### Phase 2 — Extract the shared core (≈1 week, after parity proves the seam)
- Create `builder-core` package: types, normalization, render/style helpers, email merge tokens, color utils, trigger/criteria evaluation.
- Both repos depend on it; divergence (e.g. StarCaster's `project_id` scoping, Normie's bigint IDs) stays behind a small adapter per repo (Normie pattern: API client injected; StarCaster: `components/builder/builder-api.js` already does this).

### Phase 3 — Port the rest of Normie's improvements (1–2 weeks)
- Structured logging with secret redaction (`lib/observability/logger.ts` pattern) → StarCaster.
- Request-ID correlation and security-headers middleware → StarCaster's dispatcher.
- Sanitization patterns (`sanitize-html`) — StarCaster already has isomorphic-dompurify installed but underuses it.
- The `verify` script discipline (see Part 6).
- Email template rendering with merge tokens (already partially in `lib/builder/email-template.js`).

### Look-and-feel preservation rules
- **StarCaster:** `Module: Subpage` h2 headings, `.standard-form-grid` (140px right-aligned labels), canonical black-header CRUD tables, `.pod` layouts, `.btn` utility classes, Title Case, no-wrap buttons.
- **Normie:** `BuilderSettingRow` horizontal label rows, green-gradient add/save buttons, poll-pod styling, `#42C8F9` poll header blue, hex-only colors.
- Ported components must take colors/spacing from each site's CSS variables — never hardcode Normie hues into StarCaster components or vice versa.

---

## Part 6 — Quality Upgrade Plan (to senior-developer standard)

### Immediate (this week) — security
| # | Action | Where |
|---|---|---|
| 1 | Delete or admin-gate `/api/auth/debugSession` | `routes/auth.js` |
| 2 | Whitelist CORS origins; stop echoing + credentials | `routes/http.js` |
| 3 | Add CSRF protection to state-changing routes | StarCaster dispatcher |
| 4 | Remove `unsafe-eval` from CSP; work toward nonce-based inline | `normie/lib/security-headers.ts` |
| 5 | Fix Normie's 2 failing tests; make `verify` a hard CI gate | normie |

### Short term (2–4 weeks) — tooling & hygiene
- **StarCaster:** add ESLint + Prettier (flat config), `node --test` based smoke tests for the route registry / project scoping / API envelope (the handoff doc's own #6 priority), and a `verify` script mirroring Normie's. Wire it into the Vercel build so failures block deploys.
- **Both:** extract shared utilities (`safeText`, `maskSecret`, `readAdminJson`) into single modules; ban bare `catch {}` via lint rule (`no-empty` + a logging convention `console.error('[module] context:', err)`).
- **Both:** adopt zod for API input validation at route boundaries.
- Clean Normie's 71 lint warnings; turn warnings into errors once at zero.

### Medium term (1–2 months) — structure
- **Decompose god files.** StarCaster: split `develop.js` (deleting the vanilla builder gets most of it), then `messaging.js` and `routes/engage.js` by feature. Normie: split `admin-game-workspace.tsx` into per-subsystem components/hooks.
- **RLS everywhere.** Enable RLS + policies on all user-facing tables in both Supabase projects; restrict service-role usage to genuinely admin paths.
- **Migrations.** StarCaster: consolidate `docs/SQL/*` into `supabase/migrations/` with the Supabase CLI; stop manual SQL-editor application.
- **Gradual TypeScript in StarCaster:** start with `lib/` (the stores and builder core are the highest-value, lowest-risk), using `checkJs` + JSDoc as a stepping stone if a full conversion is too disruptive.
- Error monitoring (Sentry or similar) on both deployments.

### Long term (3–6 months)
- Test coverage targets: builder-core ~90%, route handlers ~60%+.
- Code-split StarCaster's frontend bundles (currently 23K+ line monoliths).
- Move `lib/builder/template.js`'s 1,970 lines of hardcoded module definitions into data (the `develop_modules` table already exists).
- Performance pass on Normie admin workspaces (memoization, lazy loading).

### Definition of "senior quality" for this project
Every change ships with: types or typed JSDoc · a test for the behavior · lint clean · no silent catches · inputs validated at the boundary · secrets never logged · SQL via tracked migrations · files under ~500 lines unless there's a documented reason.

---

## Part 7 — Suggested sequence (summary)

1. **Now:** security fixes (both repos) + commit StarCaster's working tree + green `verify` in Normie.
2. **Weeks 1–4:** Builder parity port into StarCaster's React island, with tests, StarCaster-skinned; flip default; delete vanilla builder.
3. **Week 5:** extract `builder-core` shared package.
4. **Weeks 5–7:** port observability/sanitization/game-layer; StarCaster lint+verify+CI.
5. **Months 2–3:** RLS, migrations consolidation, god-file decomposition, gradual TS in StarCaster `lib/`.

Estimated effort to full Builder parity: **3–4 weeks** of focused work. Estimated effort to "senior-grade" baseline (security + tests + lint + structure): an additional **4–6 weeks**, much of it parallelizable with the port since the port itself enforces the new standard.
