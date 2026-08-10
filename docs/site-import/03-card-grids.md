# Card grids — migrating a site's feature cards

How a row of "feature tiles" on someone else's website becomes a real
**Feature Cards** module in the Builder, automatically, on import.

Written 2026-08-08, prompted by blazefish.com: six tiles (Court Fees, Tennis
Clinics, Pickleball, Ladies Teams & Leagues, Junior Tennis Programs,
Directions & Hours), each an icon, a photo, a heading, a sentence, and a
"Learn More" link.

Companion docs: `01-capture-and-ir.md` (how a site becomes an IR),
`02-mapping.md` (how an IR becomes Builder pages).

---

## 1. Why this exists

The Feature Cards module shipped before the importer knew what a card was.
The mapper could emit heading, text, image, button, table, slideshow, embed,
video, code and form — but not a card grid. So an imported card row arrived
as loose image + heading + text + button modules, and somebody rebuilt six
cards by hand.

That is exactly the failure `docs/MODULE_STANDARDS.md` rule 12 warns about:
*a module the importer can't emit means every imported site needs it built by
hand.*

---

## 2. What counts as a card grid

A run of sibling blocks that repeat **the same sequence of element classes**,
where every block carries **both a heading and an image**, repeated **at least
three times**.

On blazefish.com the matched shape is `text+image+heading+text+link`, six
times over.

### Why the rule is that strict

The first draft was looser — "a repeating sequence with a heading or text,
plus an image or link". Run against the real blazefish.com capture it found
the correct six-card grid, and also:

- the **mega-menu** (`link+link+link+heading+link`, once per menu column), and
- a text-only list with no headings at all.

Turning a site's navigation into feature cards is a far worse outcome than
declining to detect a card grid. Requiring a heading **and** an image in every
block removes both false positives, and — measured, not assumed — finds
exactly one grid on blazefish and **zero** across all three pre-existing
fixtures, including the real (older) delraytennis.com WordPress capture.

Anything the detector does not claim maps exactly as it did before. A missed
grid degrades to the old behaviour, never to nothing — the IR's governing
principle is completeness over fidelity.

### What it deliberately does not catch yet

- **Two-card rows.** A pair is ambiguous; three is a pattern.
- **Blocks with no image** (blazefish's "Junior Pathway" tiles).
- **Blocks with ragged internals** — a bullet list in one card and not the
  next changes the class sequence, so the run stops matching.

These are declined on purpose, not overlooked. Widen the rule only with a
fixture that proves the widening does not resurrect the mega-menu.

---

## 3. The process

### Step 1 — Import the site

Card detection runs inside the normal mapper. There is no separate card step
and nothing extra to remember.

```
doppler run --config prd -- node scripts/site_import_map.mjs --job <id>
```

That is a **dry run**: it writes nothing.

### Step 2 — Read the plan before anything is written

The dry run prints its guess, the evidence for it, and the veto:

```
Will consolidate repeated blocks into Feature Cards (an intent guess — veto below):
  /  →  6 cards, absorbs 30 element(s)
     matched shape: text+image+heading+text+link
     titles: Court Fees | Tennis Clinics | Pickleball | Ladies Teams & Leagues | ...
     keep them separate with: --no-cards /
```

**Read the titles.** They are the fastest possible check: if they are the six
things you expected to see on cards, the guess is right. If they are menu
labels, it is wrong — veto it and file the shape.

Also confirm `Reconciliation:` accounts for every element. `--apply` refuses
to run if it does not.

### Step 3 — Veto anything wrong

```
... --no-cards            # whole run: repeated blocks stay separate modules
... --no-cards /          # just the home page
... --no-cards /programs/ # just that page
```

A veto never loses content — the blocks fall back to ordinary image, heading
and text modules, exactly as before this feature existed.

### Step 4 — Apply

```
doppler run --config prd -- node scripts/site_import_map.mjs --job <id> --apply
```

Pages land as **drafts** (`isPublished: false`); the mapper cannot publish.
A snapshot and a JSON backup are taken first.

### Step 5 — Check it in the Builder

Open the page and confirm, per `docs/MODULE_UI_DOCTRINE.md` R5, at **1440 /
768 / 390**. Cards are a grid, and a grid is where responsive problems live.

---

## 4. What lands in the module

| Card field | Comes from |
|---|---|
| `title` | the block's heading text |
| `body` | the block's first non-icon text |
| `icon` | a text node of 3 characters or fewer (`▦`, `★`) |
| `imageUrl` | the block's image, **rehosted** into the project |
| `imageAlt` | the image's `alt`, entity-decoded |
| `linkUrl` / `linkLabel` | the block's first link |

Plus `cardColumns`, chosen so the last row is full: 6 cards become 3+3, never
4+2. And `importSourceIds`, which records every source element the module
replaced, so a card can always be traced back to the markup it came from.

**Images are rehosted automatically.** The mapper promotes each card image
through the same path as every other imported asset, so card images need no
filename matching and no manual re-picking. (Assets pulled separately via
Acquire have no `source_url` recorded, so there is no reliable automatic join
back to the original URL — which is exactly why running the full Site Import
beats acquiring assets and hand-building the page.)

---

## 5. When detection misses

Cards that arrive as separate modules are not a dead end — they are the same
loose modules you would have had before. Two options:

1. **Assemble by hand** in the Builder. Fine for one row.
2. **Teach the detector**, which is the better answer whenever a shape will
   recur. Capture the page as a fixture and prove the new rule both catches
   the grid and leaves the mega-menu alone:

```
node scripts/site-import/capture_fixture.mjs <url> <name> --pages 1
UPDATE_SNAPSHOTS=1 npm run test:site-import     # then REVIEW the diff
```

Add the fixture to `FIXTURES` in `scripts/site-import/normalize.test.js` and a
case to `scripts/site-import/map.test.js`. The mega-menu test in that file
exists to be kept passing — if a widened rule breaks it, the rule is wrong.

---

## 6. Tests that guard this

In `scripts/site-import/map.test.js`:

| Test | What it pins |
|---|---|
| repeating run → one module | titles, bodies, icons, links, decoded alt, reconciliation |
| dry-run plan | the guess and its evidence are reported before any write |
| **nav/mega-menu is not cards** | the false positive that shaped the rule |
| two reps / no heading | the deliberate declines |
| column count | 6 → 3+3, not 4+2 |
| real blazefish.com capture | end-to-end on a real site |
| `--no-cards` veto | the veto is honoured and loses nothing |

The nav test was verified to have teeth: removing the image requirement from
the detector makes it fail, along with the real-capture test.
