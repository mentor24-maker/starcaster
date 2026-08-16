# Handoff — show what changes on each page, not just which pages

Paste everything below the line into a fresh Claude Code session started in
`/Users/mentor/WebApps/starcaster`.

---

Read `CLAUDE.md`, then `docs/SAVED_SECTIONS.md` before anything else. Work in
your own worktree: `npm run thread section-diff`. Never edit `main`.

## The job

When you overwrite a saved section from inside a page, the dialog lists the
**pages** the overwrite will rewrite. It does not say **what changes** on any of
them. Build that: a per-page diff, shown before the click.

This is the last open piece of the operator's 2026-07-21 request, the one that
followed the Marinoff menu loss — 46 published pages rewritten by a routine
styling edit, with no way to see it coming. Preview-by-page, the outcome tally
and Undo all shipped since (PRs #277/#279). Naming a page is enough to make
someone hesitate; it is not enough to make them decide.

## Where it stands

- `components/builder/builder-section-save-modal.tsx` — the dialog. It already
  renders a scrollable list of page names from `impact.pageLabels`, capped at 12
  with an "…and N more".
- `lib/builder-client/shared-block-usage.ts` — `describeCanonicalOverwrite`
  builds that impact object; `buildSavedSectionUsageIndex` finds every following
  instance in one pass over the pages. Colocated tests in
  `shared-block-usage.test.ts` are the pattern to follow.
- `components/admin-builder-editor.tsx` — `saveSection` decides whether there is
  a question to ask; `overwriteCanonicalFromSection` does the write.
- `lib/builderPagesStore.js` — `propagateCanonicalSection` is the fan-out, and
  it is the authority on what a following instance keeps: `{ ...updatedSection,
  id: <the instance's own id>, savedSectionId, canonical: true }`. Your diff has
  to describe **that** transformation, not a naive object comparison.

## What makes this tractable

The editor already holds every page's full content in memory. `GET
/api/admin/pages` is a `select=*` (`listPages`, `lib/builderPagesStore.js:348`),
so the `pages` state carries `layoutSections` for each one — that is how the
usage index counts followers without a single extra request. **Verify that
before you design around it**, then build the diff as a pure function over data
you already have. No new endpoint should be needed.

Note the 1000-row default limit on that list. If a project ever exceeds it the
diff silently under-reports, which is exactly the class of failure this feature
exists to prevent — so if you rely on the in-memory list, say what happens past
the limit rather than letting it truncate quietly (`docs/DOCTRINE.md` §3.2:
"cannot check" is a third outcome, never a pass).

## What a useful diff says

Aim at what the operator recognises, not at a data structure:

- modules added, removed, or reordered — by module type and a scrap of their
  content, not by id
- settings that changed on a module that stays
- text that changed, as a short before/after rather than a character diff
- "no visible change" as a first-class result: an instance that already matches
  the incoming content should say so, because a list of 40 pages where 38 are
  identical is mostly noise, and hiding that is what makes the other 2 invisible

Decide with the operator whether the dialog shows all of it inline or a summary
per page that expands. Do not guess — ask him with a picture. He reads layout
faster than prose.

## Constraints

- `lib/builder-client/` is the shared TypeScript source. New logic there ships
  with a test (`npm run test:builder-ui`).
- Never hand-edit a generated artifact; the table in `CLAUDE.md` says which are
  which. New CSS goes in `src/css/_builder-react-overrides.css`, never
  `_builder-react.css`.
- Definition of done is in `CLAUDE.md` and it means passing commands, not "it
  should work": `npm run typecheck`, `npm run test:builder-ui`, the full
  `npm run build`, `node scripts/check_conventions.cjs`.
- `main` auto-deploys to production. Ship with `npm run ship` once it is green,
  and only on his say-so.

## Done looks like

Overwriting a saved section that four pages follow shows, before the click, what
each of those four pages actually loses or gains — and says plainly when one of
them changes nothing at all.

## Coaching

Dane is a hands-on builder, not a career programmer. Explain any term the first
time it matters, and when a decision is his to make, show him the two options
rather than describing them. Housekeeping — stale branches, worktrees, asset
pins — is yours to do silently.
