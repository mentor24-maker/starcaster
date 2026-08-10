# Handoff: build Delray Tennis, and let it find the module problems

**Opened:** 2026-08-10, by the operator, immediately after the module UI
overhaul shipped (PRs #118 → #142).

**The operator's framing:** he had planned to review modules one by one on
a `module-tester` page. He changed the order deliberately:

> *"Instead, first I am going to use the modules as they are to work on the
> Delray Tennis site. Once I've got a presentable home page and inner page
> template, I'll turn my attention back to the next round on the modules.
> Only then, I want to set it up as a looping pipeline so I get the first
> couple loops going and then agents take it from there."*

Read that twice, because it sets the scope. **This thread has two
deliverables, and the second one is the reason for the first.**

1. A presentable **Delray Tennis home page** and a reusable **inner-page
   template**, built with the modules exactly as they are.
2. **A captured list of every module problem that surfaced while building
   them.**

A gap found while building a real client page outranks a gap found while
inspecting a settings panel. Inspecting tells you what is ugly; building
tells you what is *missing* — the module that does not exist, the setting
you went looking for and could not find, the thing that took six clicks.
That second list is the input to the next round, so **capturing it is not
overhead, it is the point.**

---

## 1. Read these first, in this order

| Doc | Why |
|---|---|
| `CLAUDE.md` (root) | repo invariants, generated-file table, landmines |
| `docs/UI_RULES.md` | **the Master UI Rules** — the ratified standard. New complaints become numbered rules here |
| `docs/UI_RULES_AUDIT.md` | what was found and fixed per module, with the progress log |
| `docs/DOCTRINE.md` | house style: every rule carries the incident that produced it |
| `docs/MODULE_UI_DOCTRINE.md` | the enforcement machinery behind the rules |
| `docs/site-import/*` | how the Delray content got here in the first place |

---

## 2. What just shipped (do not re-derive it)

Between 2026-08-08 and 08-10 the module editors were rebuilt. The parts
that matter while building pages:

- **Every settings panel is organised into logical axes** (rule D8) — up to
  four titled columns: Content · Structure · Text · Placement · Frame. A
  fifth throws, on purpose, so it reaches the operator.
- **Advanced is per axis** and holds **theme overrides** (rules A1–A5).
  Empty means "follow the theme"; the summary counts active overrides so a
  collapsed override cannot masquerade as a theme bug.
- **Columns are the generator's default**, not an opt-in — the previous
  sweep applied them to 8 editors out of 38 and nobody noticed until the
  operator looked.
- Booleans are checkboxes; page/post/form destinations are pickers, not
  hand-typed URLs; spacing controls have exactly four names (W7).

**The standing lesson of that work:** three separate real defects were
caught by driving the app and looking at pixels — a label crop, overlapping
offset rows, and a reset button that blanked the card preview. None would
have failed a test. **Screenshot the thing.**

---

## 3. How to capture what the build turns up

Every friction point sorts into exactly one of three bins. Do the sorting
as it happens; do not batch it up for later, because the detail evaporates.

| Bin | What it looks like | Where it goes |
|---|---|---|
| **Rule** | "labels shouldn't wrap", "that column is wasted" — a standard that should hold across all modules | a new numbered rule in `docs/UI_RULES.md`, in the right section, **with his words quoted verbatim and dated** |
| **Bug** | a control that does nothing, a setting that does not survive a save, a panel that renders wrong | fix it in its own worktree/branch; if it is not fixable now, ClickUp → Starcaster → Dev Backlog |
| **Missing capability** | "there is no module that does X", "I needed a setting for Y" | ClickUp → Dev Backlog, with what he was trying to build when he hit it |

**Quote him verbatim.** The raw wording is the requirement; a paraphrase is
already an interpretation. This is not pedantry — the entire
`docs/OPERATOR_UI_FEEDBACK.md` exists because months of his design input was
paraphrased into nothing and then lost.

---

## 4. Landmines specific to building pages in the Builder

These are the ones that bite during page construction, as opposed to code
work. Each has already cost real time.

1. **A saved section propagates silently to every page that links it.**
   Editing a canonical saved section rewrites all linked pages with no
   preview and no undo — this is what lost the Marinoff menu on 2026-07-21.
   Before editing a shared header/footer/menu section, know how many pages
   use it.
2. **Propagation can be cut off mid-run.** Serverless functions freeze:
   a 2026-07-22 propagation updated 30 of 50 pages and left the rest stale,
   which presented as "the Footer won't save". If a shared edit looks
   half-applied, this is why.
3. **An open Builder tab holds a stale copy of the page.** Saving from it
   overwrites newer content. Close other Builder tabs before editing, and
   hard-refresh (**Command+Shift+R**) after any deploy.
4. **Never switch templates on a page that has real content.** Template
   switching is not module-preserving yet — it wiped a body and reverted a
   header on 2026-07-22. Tracked as ClickUp `86bb21e37`.
5. **Verify a save by re-reading the value, not by the toast.** The toast
   proves a write happened, not that it wrote what you meant. A
   `.org`-for-`.com` typo cost an hour this way.
6. **`main` auto-deploys to production.** Delray is the top revenue
   priority; treat its live pages accordingly.

---

## 5. Delray specifics

- **Staging:** `delraytennis.starcaster.pro` (confirmed serving 2026-08-10).
- Its content arrived through the **Site Import** feature (capture → IR →
  Builder drafts); `docs/site-import/` explains the pipeline and its known
  gaps, and there are six import enhancements already in the Dev Backlog.
- Delray is the **top revenue priority** — Rich's vendor application is in
  process. Build accordingly: this is client-facing work, not a sandbox.
- The **slideshow module** shipped as part of the import work and has not
  had heavy real-world use yet. Expect it to be an early source of
  findings.

---

## 6. Working with the operator

- **Plain language, always.** He directs this project expertly but is not a
  career programmer; explain any term the first time it matters. This is a
  `CLAUDE.md` mandate, not a courtesy.
- **Terminal output is invisible to him.** Put content in the reply, and
  drop a copy of any document on his Desktop — files inside a worktree do
  not show up in his editor either.
- **He does not run git.** Branch, commit, push, merge on his word. He
  merges nothing through the GitHub UI.
- **One thread per folder.** Page-building in the Builder UI needs no
  worktree at all — it is app work. A module *bug fix* is code work and
  gets its own worktree.
- **Coach in the moment** when something is risky, in one sentence, with
  the safer command ready to run.
- **He finds what agents miss** by looking at real output. Ship him things
  he can look at, and take the "this looks terrible" verdicts literally —
  every one of them this week turned out to be correct and mechanically
  explainable.

---

## 7. What comes after this thread

The module review resumes as a **looping pipeline**: he seeds the first
couple of loops, then agents carry it. Do not invent new machinery for it —
the loop-engineering setup already exists (three skills, a guide, and the
ClickUp "Loop Queue"; loops never merge on their own). Wiring module review
into it is a configuration job.

**Two decisions are parked, waiting on him** (both recorded in
`docs/UI_RULES_AUDIT.md`):

1. **Card-vs-page colour defaults disagree** on four settings — e.g. the
   tag cloud's tag background is `#f0f4f8` in the editor card and
   `#f3f4f6` on the published page. Eighteen factory colour seeds cannot
   be cleared until that is settled, because either choice visibly changes
   pages.
2. **Is "Card Style" (Default / Bordered / Shadow) a theme override or a
   preset?** Two agents independently called it a preset and left it in
   the basic settings.

Also still open from the fix plan: the **conformance test** that would make
dead controls impossible to ship (F10), and **floating-image's two
overlapping offset systems** (F9).

---

## 8. Definition of done

For any code change made in this thread, per the root `CLAUDE.md`:

1. `npm run typecheck`
2. `npm run test:builder-ui` and/or `npm run test:builder`
3. The rebuild for every generated artifact touched
4. `node scripts/check_conventions.cjs` and `node scripts/check_ui_doctrine.cjs --all`
5. `npm run check:syntax` if `public/js/` or `public/shared/` was touched
6. **Look at it in a browser.** Not optional here — see §2.

For the thread as a whole: **the pages are done when he says they are
presentable, and the thread is done when the module findings are captured
somewhere durable** — a rule, a bug fix, or a backlog task. Findings that
live only in this conversation are findings that will be lost, and that has
already happened once.
