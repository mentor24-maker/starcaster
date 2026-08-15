# Starcaster — repo invariants

Read this file plus the `CLAUDE.md` nearest the files you are editing
(`components/`, `src/css/`, `routes/`, `public/js/`, `lib/builder-client/`).
Architecture, known issues, and roadmap: `docs/FABLE_OVERHAUL_PLAN.md`.
**Hard-won rules, each with the incident that produced it: `docs/DOCTRINE.md`.**
Read it before diagnosing a "it worked yesterday" failure, writing an error
message, or adding a check that could silently not run.

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
- **Do the housekeeping silently.** Merged worktrees, stale branches,
  asset-stamp conflicts, missing generated artifacts, scratch files: clean
  them up as you go, without asking and without a section explaining it.
  He has given blanket authorization (`docs/DOCTRINE.md` §6.4). The one
  thing that earns an interruption is **him** actively causing a problem —
  then say so immediately and completely. Everything else is a chore, and
  chores are silent.

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
| `lib/builder/template.js`, `lib/builder/email-template.js`, `lib/builder/template-frame.js` | `lib/builder-client/builder-template.ts`, `builder-email-template.ts`, `builder-template-frame.ts` | `npm run build:builder-template` |
| `lib/builder/email-render.js` | builder-client sources | `npm run build:builder-email-render` |
| `lib/site-import/dist/*.js` | `lib/site-import/*.ts` | `npm run build:site-import` |
| `lib/build-stamp.json` | `scripts/write_build_stamp.mjs` (records build time) | `npm run build:stamp` |

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
   The same hash also breaks if the FOLDER reaches its dependencies oddly:
   esbuild stamps each bundled module's path into the output as a comment, so
   a worktree whose `node_modules` is a symlink to another checkout emitted
   `../../../node_modules/...` and pinned a hash no clean build could
   reproduce (PR #149). Every build script now shares
   `scripts/esbuild-common.mjs` (`--preserve-symlinks`), and
   `npm run check:build-paths` fails the commit if any artifact still points
   outside the repo. If CI rejects pins on files you never touched, run that
   check — the answer is almost always your folder, not your change.
9. **`public/js/` is parsed by nothing but the browser.** It is excluded from
   `tsconfig.json`, has no linter, and loads as plain `<script src>` tags
   rather than being bundled — so unlike `components/` (bundled) and
   `routes/`+`lib/` (required by the node tests), a syntax error there reaches
   production. And a syntax error discards the WHOLE file, so every function
   it defines goes silently dead. `npm run check:syntax` now gates this in
   pre-commit and CI, but it catches syntax only: a typo like
   `App.assset.foo()` still parses and fails at runtime. Open the app and
   check the browser console after editing these files.
10. **Vercel bakes env vars in at build time.** Editing one in the dashboard
    does NOT reach the deployment already serving traffic — it takes a redeploy.
    So "the value is wrong" and "the value is right but not live" look
    identical. This cost an hour on 2026-07-29; before suspecting a credential,
    compare the build time (`lib/buildInfo.js`) with when the variable changed.
11. **`checkEndpointLimit` returns `true` when it has ALREADY sent a 429.**
    `if (checkEndpointLimit(...)) return true;` is correct. The inverted form
    bails out of every normal request and writes nothing at all — status 0,
    empty body, a completely dead endpoint that still looks fine in review.

## One worktree per thread

Two sessions in one folder share a single working tree and a single HEAD: a
branch switch in session A rewrites session B's files, and each one's
uncommitted edits ride along in the other's commits. The symptom is
"unrelated" modified files you never touched.

Give every thread its own worktree — a separate folder with its own branch,
sharing the same repo history. **Use the command, not the raw git:**

```
npm run thread <topic>     # tidy first, branch off CURRENT origin/main, npm ci, build
npm run ship               # catch up, verify, push, PR, wait for CI, merge, tidy
npm run map                # what exists, what is shipped, what is still live work
npm run tidy               # delete shipped branches, remove finished worktrees
```

`npm run ship` is the other end of `thread`: the nine hand-run steps between
"the work is done" and "it is live", in order, with the state checked between
each one. Run it again if `main` moves while it runs — it picks up where it
got to. `--dry-run` says what it would do; `--no-merge` stops before merging.

**It never force-pushes.** It catches up by merging `origin/main` in rather
than rebasing, so the branch only ever gains commits and an ordinary push
always works. That is deliberate: a force-push inside a script is invisible to
the operator's `Bash(git push --force*)` deny rule, and a convenience command
does not get to route around a standing decision (`docs/DOCTRINE.md` §6.6).
Squash-merge discards the merge commits anyway, so it costs nothing.
`scripts/builder/shipThread.test.js` fails if a future edit reintroduces one.

**The `?v=` asset pins no longer conflict.** Those four committed HTML files
carry hashes rebuilt from whatever the build produced, so any two branches
touching styling collide there even when neither edited a word of markup — it
was most of the conflict traffic on 2026-08-11, and the resolution was
mechanical every time. `.gitattributes` routes them through
`scripts/merge_asset_pins.cjs`, which merges the markup normally and restores
each pin by asset path. A genuine markup conflict still conflicts.

The driver lives in `.git/config` (git will not run a driver defined by a
cloned repo), so `scripts/install_git_hooks.cjs` registers it on every
`npm install`. Without that step `.gitattributes` names a driver that does not
exist and git falls back to the default merge **silently** — so if pins start
conflicting again, run `npm install` before anything else.

`npm run thread` exists because each hand-rolled step had already cost time:
branching off a stale local `main` (forces a rebase later, which is where the
asset-stamp conflicts come from), skipping `npm ci`, and never cleaning up —
41 local branches and 10 worktrees accumulated in six weeks. The equivalent
by hand, if you ever need it:

```
git worktree add .claude/worktrees/<topic> -b <topic> origin/main
cd .claude/worktrees/<topic> && npm ci && npm run build:assets
```

Order matters in that second line: creating the worktree fires `post-checkout`,
which cannot build before `npm ci` has run — so build the assets afterwards or
the folder keeps whatever the failed build left behind.

Cleanup is automatic now and should never need thinking about: GitHub deletes
each branch as its PR merges, `post-merge` deletes the local copy once its work
is live, and `npm run thread` tidies before it starts. `npm run tidy` never
touches uncommitted work, a locked worktree, the folder you are in, or a branch
with unshipped commits; deletions are logged with restore commands in
`.git/tidy-restore.log`.

**Squash-merging is why `git branch -d` is useless here.** It rewrites the
commit, so `-d` calls shipped work "not fully merged" and refuses. `git cherry`
(patch equivalence) is the only correct test — that is what `map` and `tidy`
both use, from one shared module so they can never disagree.

`git worktree list` shows every active thread; `git worktree remove
.claude/worktrees/<topic>` cleans one up. Caveat: `.git/hooks` is **shared**
across worktrees, so `npm install` in one reinstalls hooks for all of them.

Run the real `npm ci` — **never symlink `node_modules` to another checkout**
to save the ~270MB. Builds are supposed to be a function of the source, and a
symlink leaks the folder's layout into the bundle bytes (landmine 8).
`--preserve-symlinks` now absorbs it and `npm run check:build-paths` catches
what slips through, but a real install is still the setup everything else
assumes.

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
6. **`npm run check:panels` if you touched ANY settings panel or its CSS**,
   and it is not optional because CI cannot run it — CI has no browser, so
   this check only ever runs if a person runs it. A staggered panel reached
   the operator on 2026-08-12 and again on 2026-08-13; both times the code
   was reviewed, the rule was read, and nobody ran the check.

   **A green run is only evidence if the fixture exercises your panel.**
   `check_panels` measures what it can see: seed real content for your
   module in `scripts/ui/seed_fixture.mjs`, then **break the layout on
   purpose and watch it fail** before you believe the pass. An item manager
   that declares `data-lattice-pairs` and renders no fields now fails
   outright rather than passing silently, which is the specific hole that
   let both of those panels through.

"It should work" is not done. Passing commands are done.

## Session-close capture (binding)

Before the window closes, get the keepers onto the shared record, unprompted:
decisions to the party line (the ClickUp bus), artifacts and findings to the
docs of the repo that owns them, canon changes to the vault's
`doctrine/_proposals/`. A standing instruction Dane gives verbatim is always a
keeper. If the destination is somewhere CC-starcaster cannot write — vault
doctrine, another repo's docs — hand it to the agent that can, on the wire, in
this session. Noticing is not capturing. (Vault `doctrine/OPERATIONS.md`,
Session-close capture; ratified 2026-08-14.)

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
