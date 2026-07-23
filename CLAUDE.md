# Starcaster — repo invariants

Read this file plus the `CLAUDE.md` nearest the files you are editing
(`components/`, `src/css/`, `routes/`, `public/js/`, `lib/builder-client/`).
Architecture, known issues, and roadmap: `docs/FABLE_OVERHAUL_PLAN.md`.

## IMPORTANT: Coach the operator

The operator (Dane) directs this project but is not a career programmer —
his background is hands-on HTML/LAMP-era building, and modern dev jargon
does not land. Every agent working here must:

- **Use plain language.** Explain any technical term the first time it
  matters ("a branch is a separate copy of the code you can work on
  without touching the live site"). Never bury a decision in jargon.
- **Coach in the moment, kindly.** When he is about to do something risky
  (working directly on the live `main` branch, pushing without a passing
  build, running two tasks in the same folder), say so plainly, explain
  the risk in one sentence, and offer the safer step as a ready-to-run
  command with a one-line note on what it does.
- **Prompt, don't assume.** He has asked to be trained in best practices
  as work proceeds. Treat that coaching as part of every task's
  deliverable — not an interruption or an afterthought.

StarCaster (company: Alphire) is a multi-tenant platform: an admin SPA plus a
visual site Builder whose published pages serve as tenant public sites on
custom domains. Backend is Node with a shared dispatcher `routes/index.js`
(`server.js` locally, `api/[...slug].js` on Vercel). Database is Supabase
Postgres. Admin UI is split between a frozen vanilla-JS app (`public/js/`)
and the React/TypeScript builder (`components/` + `lib/builder-client/`).

## Generated files — never hand-edit, never commit

These are **gitignored build artifacts**. Edit the source, run the rebuild
command so your local app reflects the change — but do NOT commit them;
Vercel and CI regenerate everything from source via `npm run build`.
A PreToolUse hook blocks direct edits; the conventions checker blocks
commits of them. After a fresh clone, run `npm run build` once to create
them locally.

| Artifact | Source | Rebuild |
|---|---|---|
| `public/app-shell.html` | `src/layout.html` + `src/pages/**` | `npm run build:html` |
| `public/privacy-policy.html`, `terms-of-service.html`, `data-deletion.html` | `src/legal/*` | `npm run build:html` |
| `public/styles.css` | `src/css/main.css` + partials | `npm run build:css` |
| `public/builder-bundle.js` | `builder-react-entry.tsx`, `components/**`, `lib/builder-client/**` | `npm run build:builder` |
| `public/bundle.js` | `react-entry.js` + campaigns components | `npx esbuild react-entry.js --bundle --outfile=public/bundle.js --loader:.js=jsx` |
| `public/js/richtext-vendor.js` | `public/js/richtext-vendor-entry.js` | `npm run build:richtext` |
| `lib/builder/template.js`, `lib/builder/email-template.js` | `lib/builder-client/builder-template.ts`, `builder-email-template.ts` | `npm run build:builder-template` |
| `lib/builder/email-render.js` | builder-client sources | `npm run build:builder-email-render` |

`public/about.html` and `public/site.html` are hand-authored but get asset
hashes pinned by `npm run pin:assets` — editing them is fine.

## Landmines

1. **Builder module types need dual registration.** After editing
   `lib/builder-client/builder-template.ts`, run
   `npm run build:builder-template`. If the server bundle
   (`lib/builder/template.js`) doesn't know a module type, it silently
   coerces it to `"text"` on every page load.
2. **`App.els` is a static registry.** New DOM element ids used by vanilla
   JS must be registered in `App.els` in `public/js/core.js`, or `els.*`
   returns `undefined` at runtime with no error.
3. **`public/js/` is frozen.** Bugfixes only. New admin UI is React
   (`components/` + `lib/builder-client/`). Never add new files there.
4. **`main` auto-deploys to production.** Run the full `npm run build` and
   `npm run typecheck` before any push to main.
5. **Staging is whole-file.** `git add <file>` stages ALL uncommitted edits
   in that file, not just yours. Inspect `git diff --cached` before
   committing; the working tree often carries someone else's pending edits.
6. **Never write `data/*.json` from production code paths.** Vercel's
   filesystem is read-only; writes silently vanish. Use Supabase.
7. **Never expose `SUPABASE_SERVICE_KEY` (or any secret) to the browser.**
8. **`?v=` asset pins come from built files, not from source.**
   `pin_asset_versions.cjs` hashes whatever sits in `public/`, so a stale or
   other-branch bundle pins a hash nobody can reproduce — it either ships a
   dead cache-buster (new CSS deploys, browsers keep serving the cached old
   one) or surfaces as "unrelated" modified HTML in someone else's commit.
   Pre-commit now runs `npm run build:assets` first, and CI fails if a clean
   build changes any committed HTML. Never hand-edit a `?v=` value.
9. **`public/js/` is parsed by nothing but the browser.** It is excluded from
   `tsconfig.json`, has no linter, and loads as plain `<script src>` tags
   rather than being bundled — so unlike `components/` (bundled) and
   `routes/`+`lib/` (required by the node tests), a syntax error there reaches
   production. And a syntax error discards the WHOLE file, so every function
   it defines goes silently dead. `npm run check:syntax` now gates this in
   pre-commit and CI, but it catches syntax only: a typo like
   `App.assset.foo()` still parses and fails at runtime. Open the app and
   check the browser console after editing these files.

## One worktree per thread

Two sessions in one folder share a single working tree and a single HEAD: a
branch switch in session A rewrites session B's files, and each one's
uncommitted edits ride along in the other's commits. The symptom is
"unrelated" modified files you never touched.

Give every thread its own worktree — a separate folder with its own branch,
sharing the same repo history:

```
git worktree add .claude/worktrees/<topic> -b <topic> origin/main
cd .claude/worktrees/<topic> && npm ci
```

`git worktree list` shows every active thread; `git worktree remove
.claude/worktrees/<topic>` cleans one up. Caveat: `.git/hooks` is **shared**
across worktrees, so `npm install` in one reinstalls hooks for all of them.

## Definition of done

Before reporting a task complete, run and state the results of:

1. `npm run typecheck`
2. Affected tests — `npm run test:builder-ui` (React/builder-client) and/or
   `npm run test:builder` (server-side builder libs)
3. The rebuild command for every generated artifact your change affects
4. `node scripts/check_conventions.cjs` (also runs at pre-commit;
   `SKIP_CONVENTIONS=1` bypasses — if you bypass, say so and why)
5. `npm run check:syntax` if you touched `public/js/` or `public/shared/`
   (also runs at pre-commit and gates CI)

"It should work" is not done. Passing commands are done.

## Naming: UI term vs code/DB term

| UI | Code / DB |
|---|---|
| Builder | `develop`, `develop_*` tables, `/api/builder/*` + `/api/develop/*` |
| Messaging: Topics | `topics` |
| Ask Roger (dev agent) | `devAgent` |
| StarCaster | package `starcaster` |

## API conventions

- Response envelope: `{ ok: true, data }` / `{ ok: false, error: { message, code? } }`
- Session cookie `app_session`; active project via `x-project-id` header
- Tenant-scoped tables carry `project_id`; scope every query
  (`lib/projectScope.js`) — uniqueness is per-project, not global
