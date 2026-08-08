# Handoff: review the recent module work

**For:** the next agent (Fable), reviewing everything that landed on the module
system between 2026-08-06 and 2026-08-08.

**Branch/worktree to use:** make your own —
`git worktree add .claude/worktrees/<topic> -b <topic> origin/main && cd .claude/worktrees/<topic> && npm ci`.
**Run `npm ci`.** Skipping it is not cosmetic: a worktree without
`node_modules` still *builds*, but produces artifacts no clean install can
reproduce, and the pre-commit hook then stamps `?v=` pins CI refuses. That
happened during this very thread and cost two red CI runs (see §6).

**Baseline:** `c953cee` on `main`.

---

## 1. What you are reviewing

Six merged PRs, in order. The first three are the module work proper; the last
three are the scaffolding built around it.

| PR | What landed |
|---|---|
| **#103** | Image module converted to the field-strip settings editor; the settings-layout standard written |
| **#105** | **Feature Cards** module (new type) + **mega-menu** panel mode on Navigation |
| **#107** | **UI doctrine** (`docs/MODULE_UI_DOCTRINE.md`) + `scripts/check_ui_doctrine.cjs` + a blocking CI step |
| **#109** | **Card-grid detection** in Site Import — the importer now emits Feature Cards |
| **#106 / #108** | AI Theme Wizard (adjacent; touches the same CSS override layer) |
| **#110** | Doctrine §6.4 — housekeeping is silent (operator process, not code) |

The operator's framing, verbatim, which set the whole scope:

> *"the functionality seems basically right. The problem, as is the case with
> all the modules currently, is that the UI is abysmal. We are going to address
> the UI of these modules and establish a complete coding standards for UI
> doctrine in the process."*

---

## 2. Read these first, in this order

| Doc | Why |
|---|---|
| `CLAUDE.md` (root) | invariants, generated-file table, landmines |
| `docs/DOCTRINE.md` | house style — every rule carries its incident. **§6.4** is the operator-collaboration contract |
| **`docs/MODULE_UI_DOCTRINE.md`** | the new single home for UI rules, both halves |
| `docs/MODULE_STANDARDS.md` | the 13-rule bar; rule 10 is now a pointer at the doctrine |
| `docs/site-import/03-card-grids.md` | the card-import process |
| `docs/MODULE_UI_HANDOFF.md` | the thread this work came from |
| `components/CLAUDE.md`, `src/css/CLAUDE.md` | field-strip + CSS layer conventions |

---

## 3. The single most useful number

```
npm run check:ui:report
```

```
[E1] field-strip adoption ....... 5/37 editors
[E4] unpaired H/V margin ........ 2 editors  (heading, current-poll)
[R1] breakpoint-only layout ..... 0 selectors (excl. 8 allowlisted)
```

**5 of 37.** That is the state of the module UI, quantified, and it is the
honest headline for this whole body of work: the doctrine and its checker are
in place, but 32 settings editors have not been brought to it. The rules now
hold the *line*; they have not yet cleaned the *backlog*.

Those numbers should only ever go down. If your review produces one thing,
make it a plan for that number.

---

## 4. Where to look hard

### 4.1 Feature Cards (#105) — the worked example

| Surface | File |
|---|---|
| Renderer (published) | `lib/builder-client/builder-template.ts` |
| Canvas preview | `components/builder-template-preview.tsx` |
| Settings editor | `components/builder/builder-feature-cards-module-settings.tsx` (329 lines) |
| Shared card model | `lib/builder-client/builder-card-items.ts` |
| Styles | `src/css/_builder-react-overrides.css` |
| Email | deliberately skip-listed (CSS grid; Outlook has neither grid nor flex) |

The operator has confirmed cards **stack correctly** on mobile. The
1440/768/390 eyeball is otherwise still owed on the *imported* path.

### 4.2 Mega menu (#105) — the riskiest thing here

`navDropdownStyle: 'mega'` is a mode on the **Navigation** module, not its own
type. Its settings editor is **not extracted** — it lives inline in
`components/builder/builder-module-card.tsx` (~4,700 lines).

**Live tenant sites run the Navigation module.** `list` is the default and its
code path was untouched by #105; keep it that way. Any restyle that moves an
existing client menu is a production incident, not a bug.

Rule E1 (field strips) cannot be applied to Navigation until that editor is
extracted into its own file. That extraction is the prerequisite for
standardising the most-used module in the palette.

### 4.3 The UI doctrine's checker (#107)

`scripts/check_ui_doctrine.cjs`. Six mechanical checks, wired into
`check_conventions.cjs` (pre-commit) and a **separate blocking CI step**.

Two design decisions worth challenging:

1. **The blocking step is separate on purpose.** The older conventions step is
   `continue-on-error: true` because of 7 pre-existing `button`-in-`<th>`
   violations. Folding the UI rules in would have made them advisory too —
   which is how every previous UI rule here decayed into a suggestion. Those 7
   stragglers are still unfixed; cleaning them up would let the whole
   conventions gate become blocking.
2. **Added-line checks (R2, R3) skip during a merge.** A merge presents the
   incoming branch's lines as "added", so merging main would fail on work
   already reviewed. Whole-file checks still run. Verify the skip cannot be
   abused to sneak a violation in behind a merge commit.

Also check `R1_ALLOW` in that file — 8 selectors are allowlisted as genuinely
breakpoint-only, each with a stated reason. Confirm each reason still holds.

### 4.4 Card-grid detection (#109)

`lib/site-import/map.ts`. The rule: a run of sibling blocks repeating the same
element-class sequence, every block carrying **both a heading and an image**,
at least 3 times.

**The strictness is the design, and it is empirical.** A looser first draft
matched the correct 6-card grid on the real blazefish.com capture *and also the
mega-menu* (`link+link+link+heading+link` per column). Requiring heading+image
kills the false positive and yields 1 grid on blazefish, 0 across all three
pre-existing fixtures.

The guard was mutation-tested: removing the image requirement makes
`card grid: a nav/mega-menu run is NOT mistaken for cards` fail. **Keep that
test passing.** If you widen the rule, widen it with a fixture that proves the
mega-menu still does not match.

Deliberately declined: two-card rows, blocks with no image, blocks with ragged
internals.

---

## 5. What was deliberately NOT done

These are recorded rather than hidden. Each is a candidate for your plan.

1. **No spacing scale, no type scale.** `src/css/_variables.css` has 24 tokens,
   all colour and radius. A "use the spacing scale" rule would be
   unenforceable fiction, so the doctrine does not contain one. **Creating
   these is the highest-value groundwork remaining.**
2. **Navigation's editor is not extracted** (§4.2).
3. **32 editors have not been converted** to field strips. The approach is
   boy-scout, not big-bang: a module touched for any reason comes up to
   standard in that same PR.
4. **Two E4 violations left standing** (`heading`, `current-poll` offer
   vertical margin without horizontal). Not "fixed" because adding a
   `horizontalMargin` control without first confirming the renderer honours it
   would violate E7 (no dead controls). That is per-module renderer work.
5. **The 1440/768/390 eyeball on imported cards** — an operator step, still
   pending.
6. **The declarative settings schema** proposed in
   `docs/MODULE_SYSTEM_HANDOFF.md` would *generate* editors instead of 37
   hand-written ones. Doctrine first was deliberate: a generator built before
   the standard mass-produces the current mistakes. Rules E1–E4 and E6 all
   become free under a generator; that list is the schema's requirements doc.

---

## 6. Landmines this thread actually hit

Not theoretical — each cost real time here.

1. **`npm ci` in every new worktree.** Skipping it produced unreproducible
   build artifacts and two red CI runs on a *docs-only* PR. The symptom is a
   `?v=` pin mismatch that looks like it is about HTML.
2. **`_builder-react.css` is regenerated wholesale.** All hand-written rules go
   in `_builder-react-overrides.css`. Commit `2bd3018` once silently deleted
   the CRM modal styles this way and broke Contacts delete for a month.
   **Nothing tests CSS** — a deletion is completely silent.
3. **Hand-merging CSS conflicts is dangerous.** A merge of the Theme Wizard
   changes dropped a closing `}`, which in CSS silently swallows every
   following rule into the previous block. It was caught only because R1 then
   saw a selector with no base rule. Prefer: take one side wholesale,
   re-append the other, verify brace balance.
4. **Squash merges make branches look unmerged.** `git merge-base
   --is-ancestor` and three-dot diffs both lie here. Ask the PR state
   (`gh pr list --head <branch> --state all`) — that is authoritative.
5. **Whole-file staging.** `git add <file>` takes every uncommitted edit in
   that file. Inspect `git diff --cached`.
6. **Dual registration.** After editing `lib/builder-client/builder-template.ts`
   run `npm run build:builder-template`, or the server coerces the type to
   `"text"` on every page load — silent data loss.

---

## 7. Definition of done

```
npm run typecheck
npx vitest run                     # 292 tests / 40 files at baseline
npm run test:builder               # 151 at baseline
npm run test:site-import           # 63 at baseline
npm run check:ui                   # the doctrine gate
npm run check:syntax
node scripts/check_conventions.cjs
```

Plus the rebuild for any generated artifact touched (`build:css`,
`build:builder`, `build:builder-template`), and — for UI work — the
**1440 / 768 / 390** eyeball, which is an operator step.

State the results. "It should work" is not done.

---

## 8. Working with the operator

- He directs this project but is not a career programmer. **Plain language,
  always**; explain a term the first time it matters.
- **Terminal output is invisible to him.** Put content in the reply, and drop
  a copy of any document on his Desktop.
- **He does not run git.** The agent runs branches, commits, pushes, merges and
  operational scripts. Secrets are the exception — he types those.
- **Housekeeping is silent** (`docs/DOCTRINE.md` §6.4, added 2026-08-08 at his
  request). Merged worktrees, stale branches, asset-stamp conflicts, missing
  artifacts, scratch files: just deal with them, report in a clause. The one
  thing that earns an interruption is **him** actively causing a problem —
  then immediately and in full.
- **Do not ask him to adjudicate your own uncertainty.** Taste-only choices get
  picked, not escalated. Questions are for money, clients, what ships, and what
  the product should do.
- `main` auto-deploys to production on merge.
