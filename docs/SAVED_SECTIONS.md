# Saved sections, and the two things "Save" can mean

A **saved section** is one section — a row of modules — stored once and reused
on many pages. Headers, footer menus and shared banners are all saved sections.
The stored copy is the **original**; what sits on a page is an **instance**.

This doc is the model, the two saves, and the ways the two have bitten.

---

## 1. An instance is linked by two fields, and they mean different things

Both live on the section inside a page's `layoutSections`
(`lib/builder-client/builder-template.ts`, `BuilderTemplateSection`):

| Field | Means | Survives |
|---|---|---|
| `savedSectionId` | Where this section came from | Everything — unlocking, and even deleting the original |
| `canonical` | It **follows** the original: takes every update, and cannot be edited in place | Only until someone unlocks it |

`locked` is a **different, unrelated** flag on the same object. It has nothing
to do with saved sections; do not read it as "locked to the canonical".

So an instance is in one of three states:

- **Following** — `canonical: true`. The card shows *(canonical)*, the editor is
  closed, and only the Unlock button is offered. There is deliberately no 💾
  here: nothing has changed to save.
- **Unlinked** — `savedSectionId` set, `canonical: false`. Editable, shows the
  *Unlinked* badge and a Relink button. This is what Unlock produces.
- **Independent** — no `savedSectionId` at all. An ordinary section.

Adding one from the saved-section dropdown produces the first or the third,
depending on the **Canonical** checkbox beside it: on, the instance keeps the
original's module ids so local drift can be detected later; off, every id is
regenerated as a plain copy.

---

## 2. The two saves

The 💾 button on an unlinked instance can mean two entirely different things,
so since 2026-08-16 it asks which (`BuilderSectionSaveModal`):

**Overwrite the original.** `PATCH /api/builder/saved-sections/:id` — the same
write the saved-section manager makes. The route rewrites the original and then
**fans out**: every instance elsewhere with `canonical: true` and this
`savedSectionId` is replaced. The dialog lists those pages before the click
**and what changes on each** (§3a); the message afterwards gives the tally and
an **Undo this update** button. The instance you saved from is relinked,
because the original now holds exactly its content.

**Save as a new section.** `POST /api/builder/saved-sections` — files a separate
original under a name you type. The old, and until 2026-08-16 the only,
behaviour.

A section with no original behind it skips the dialog: one meaning, no question.
So does one whose original has been deleted — the provenance outlives the
delete, and a PATCH against a deleted id is a 404.

**Neither save writes the page.** The original and the other pages are updated
immediately; the page you are looking at still needs its own Save.

---

## 3. What propagation actually touches

`propagateCanonicalSection` (`lib/builderPagesStore.js`):

- Targets pages holding a section where `canonical === true` **and**
  `savedSectionId` matches. An unlinked copy is skipped — that is the whole
  point of unlocking one.
- Rewrites each match as `{ ...updatedSection, id: <the instance's own id>,
  savedSectionId, canonical: true }`. The instance keeps nothing but its id.
- Runs in batches of 8, stamps one `runId` on every revision it writes, and
  returns `{ ok, total, updated, failed, runId }`.
- That `runId` is what `POST /api/builder/propagation-runs/:runId/undo` rolls
  back.

**Local edits on a following page are replaced, without a merge.** There is no
three-way anything here. The impact list exists so that is a decision rather
than a discovery.

---

## 3a. The per-page diff, before the click

`lib/builder-client/saved-section-diff.ts`, shown by
`BuilderSectionSaveModal`. Naming a page is enough to make someone hesitate; it
is not enough to make them decide, and that was the last open piece of the
2026-07-21 request.

It models **exactly** the rewrite in §3 — `before` is the instance as the page
holds it, `after` is `{ ...proposed, id: <instance id>, savedSectionId,
canonical: true }` — so it is not a naive object comparison. Three consequences
that fall out of that and are easy to get wrong:

- The **after state is identical on every page**. Diffs differ only because
  before-states differ, which is why pages are grouped by an exact fingerprint
  of their change list. Pages that still match the old original collapse into
  one block; a page that had drifted stands on its own beside it.
- **`canonicalLocked` does not save a module here.** That flag guards
  module-level pushes; a section fan-out replaces the whole row. The diff says
  the module changes, because it does.
- **"No visible change" is a result, not a blank.** Forty pages of which
  thirty-eight are identical is mostly noise, and that noise is what hides the
  other two, so the unchanged pages get their own muted, collapsed group.

It is pure and runs over the pages the editor already holds —
`GET /api/admin/pages` is a `select=*`, so no endpoint was added. **That list is
capped at 1000 rows** (`listPages` default) while the fan-out asks for 5000, so
past 1000 pages the diff would under-report — the exact failure it exists to
prevent. `PAGE_LIST_LIMIT` detects a list sitting at the cap and the dialog says
so out loud rather than quietly showing less.

Two things it deliberately approximates, both worth knowing before trusting a
line of it: `after` is the editor's draft content, not a read-back of what the
PATCH route stores after normalization; and the current page's own rows come
from the last server load, not the unsaved draft, which only matters if the page
you are editing holds a second following copy of the same section.

---

## 4. Landmines

1. **Nothing stops two originals sharing a name.** There is no unique
   constraint on `name` and no collision check on create. Before 2026-08-16 the
   only save available from a page was "create", so typing the original's name
   to update it produced a second original with the same name and left the real
   one untouched — silently, since both then appear in the dropdown.
2. **Propagation has been cut off mid-run.** Serverless functions freeze: on
   2026-07-22 a fan-out updated 30 of 50 pages and the rest stayed stale, which
   presented as "the Footer won't save". A half-applied shared edit is this.
   The tally in the success message exists to make it visible; a `failed` count
   means reload and save again.
3. **`savedSectionId` and `canonical` are stripped by normalization and
   re-attached by hand.** `normalizeLayoutSections` does not return them, so
   `lib/builder/document.js` rescues them from the pre-normalization input on
   every page save and load. Anything that rebuilds a section from normalized
   fields alone silently orphans it from its original.
4. **Deleting an original leaves every instance carrying its id.** They keep
   rendering and stay editable; they simply have nothing to relink to. Relink
   detects this and clears the field.

---

## 5. Where the code is

| Piece | File |
|---|---|
| Section fields, normalization | `lib/builder-client/builder-template.ts` |
| Provenance rescue on save/load | `lib/builder/document.js` |
| Which save, and the wiring | `components/admin-builder-editor.tsx` — `saveSection`, `saveSectionAsNew`, `overwriteCanonicalFromSection`, `saveSavedSection` |
| The dialog | `components/builder/builder-section-save-modal.tsx` |
| Impact + outcome wording | `lib/builder-client/shared-block-usage.ts` |
| Per-page diff before the click | `lib/builder-client/saved-section-diff.ts` |
| Card states, badges, buttons | `components/builder/builder-section-card.tsx` |
| Routes | `routes/builder.js` — `/api/builder/saved-sections*` |
| Store | `lib/builderSavedSectionsStore.js` |
| Fan-out and undo | `lib/builderPagesStore.js` — `propagateCanonicalSection` |
