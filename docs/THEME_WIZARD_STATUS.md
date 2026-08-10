# Theme Wizard — where it stands
**As of Aug 7, 2026**

## What it is, in one paragraph

Right now, Builder → Themes is a form. You pick a font, a color, a border
radius, one field at a time, and you have to already know what you want.

The Theme Wizard replaces that blank form with a conversation. It looks at a
site, proposes **three complete looks**, and lets you rank them and say what you
liked and disliked. It then generates three new options built from the winner.
Repeat until you're happy. Nothing on the live site changes until you
explicitly hit Apply — and there's a one-click undo.

The reason this is buildable: a theme is already a self-contained bundle of
values in this codebase. The AI doesn't write CSS. It fills in a JSON shape the
Builder already knows how to render.

---

## What actually exists today

All of it is committed on the `theme-wizard` branch (`72af486`, then `79b55fd`).
Nothing is live. Nothing touches any client site.

| Piece | State |
|---|---|
| The design spec (`docs/THEME_WIZARD_SPEC.md`) | **Done** — 302 lines, all decisions locked |
| The database code (`lib/themeWizardStore.js`) | **Done and connected** |
| The SQL that creates the tables | **Written** — `docs/SQL/theme_wizard_setup.sql` |
| The actual database tables | **Created — live database and your local one** |
| The API endpoints | **Done** — `routes/themeWizard.js` |
| Safety: snapshot before Apply, one-click undo | **Done and tested** |
| The screens you'd click on | **Not started** (Phase 3) |
| The AI that generates themes | **Not started** (Phase 2) |

The two defects in the earlier work are fixed: a name mismatch that made the
agency-library lookups silently return nothing, and four job functions that
were written but never exported, so nothing could call them.

---

## Decisions already made (you don't need to revisit these)

- AI changes **colors and typography only** — not spacing, logos, or images
- It can start from: your current pages, an external URL, an uploaded logo, or
  a typed description
- Preview renders on one real page of the site, under each candidate
- **Agency-only for v1** — clients don't see it yet
- Round 2 generates variations on your #1 pick, guided by what you wrote
- No manual editing mid-wizard — you rank and describe, that's it
- **Snapshot before Apply, one-click revert. Non-negotiable.**

---

## The build plan — 6 phases

| Phase | What it delivers |
|---|---|
| **1 — Foundation** | Database tables, API skeleton, job runner, snapshot + undo. **No AI yet** — fake candidates by hand, just to prove the preview works. |
| **2 — Generator** | The actual AI. Three-direction prompting, output checking. |
| **3 — Wizard UI** | The six screens: previews, ranking, feedback, Apply. |
| **4 — Iteration** | Round 2+, lock-a-value, round counting. |
| **5 — More starting points** | External URL, brand-kit upload, typed brief. |
| **6 — Library** | The agency shelf — save a look, reuse it on another client. |

**Phase 1 is built.** The remaining step is running the SQL once so the tables
actually exist in the database.

---

## The safety work, in plain language

Applying a theme rewrites **every page in the project at once**. That is the
same shape as two failures this codebase already had: the saved-section save
that wiped the Marinoff menu, and the update loop that died halfway and left 30
of 50 pages stale.

So Apply now works like this:

1. **It photographs every page first.** If that photograph fails for any
   reason, the whole thing stops and *not one page is touched* — and the
   message says so in those words.
2. **It waits for every page to finish writing.** The old bug was code that
   fired off the writes and stopped watching. This one watches.
3. **If some pages fail, it names them.** Not "3 pages failed" — which page.
4. **Undo restores from the photograph.** And if the undo itself only partly
   works, the site is *not* marked as reverted — because that would invite you
   to apply another theme on top of a half-restored site.

Six automated tests hold those rules in place. They'll fail loudly if someone
later changes the code in a way that breaks any of them.

---

## The bug the database found

The tables were created, and then the code was run against a real one for the
first time — and it failed immediately. Every attempt to create a theme option
was rejected.

The cause: each option can record "which earlier option was this built from."
In the first round there is no earlier option, and the code was writing an
empty value there instead of *nothing*. To a database those are different
things — an empty value is still a value, so it went looking for an option
named "" and refused when it couldn't find one.

**This would have broken every single generation**, and no amount of the
automated testing would have caught it, because those tests use a pretend
database that accepts anything. It only surfaced against a real one. Fixed, and
there's now a test that fails if it ever comes back.

That is the argument for always running new database code against an actual
database before believing it.

---

## What happens next

Phase 1 is finished and verified. **Phase 2 is the actual AI** — the part that
looks at a site and proposes three real looks instead of the three fixed
placeholders that are in there now.

Nothing so far touches a live client site or spends any AI money.

---

## Preserved into the repo 2026-08-10

A snapshot from 2026-08-07, moved off the operator's Desktop. **It is
history, not current state** — the Theme Wizard shipped several rounds
after this was written (PRs #117, #119, #120, #121, #126, #127: painted
candidate backgrounds, a past-runs list, a multi-role palette, the
compare screen, and the hero-banner options). Read
`docs/THEME_WIZARD_SPEC.md` for the design, and the git log on the
`theme-wizard` branch for what actually landed.
