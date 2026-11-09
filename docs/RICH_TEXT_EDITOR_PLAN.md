# The text editor and the theme — a plan to choose from

Ticket: https://app.clickup.com/t/86bczqh0f · written 2026-11-06 · **a plan, not code.
Nothing here is built until Dane picks.**

## The short answer

**Keep the editor we have (TipTap) and connect it properly to the theme.
Do not build our own editor.** Start with a one-day slice that makes the editor
use the very same style rules as the live page, plus a browser check that
fails the moment the two disagree again.

Why, in one paragraph: I put the real editor and the real live page side by
side in a real browser (Chromium), gave them the same theme and the same text,
and measured them. **They disagreed in 14 places** — heading weight, heading
line spacing, the space above and below headings, the colour of body text,
the colour of links, the gap between bullets. **Every one of those 14 is a
styling difference on our side, not something TipTap does.** Both of this
morning's bugs were the same: one was a `<label>` we put around the editor,
the other was one of our stylesheet rules leaking into the text. A home-built
editor would still need every one of those connections built, by us, the same
way — and first it would cost six to ten weeks just to get back to where we
are today, with a real risk to the text already saved on 147 client pages.

---

## 1. The two options, side by side

| | **A. Keep TipTap, connect it to the theme** (recommended) | **B. Build our own on ProseMirror** |
|---|---|---|
| What it is | Make the theme the only source of how text looks while you type: sizes, fonts, colours, spacing, link style, and (later) named styles like "Lead" and "Caption". | Throw out TipTap and write our own editor on ProseMirror, the engine TipTap sits on. |
| Rough size | **About 3–4 weeks in total, delivered in five slices.** The first slice is one day and is useful on its own. | **6–10 weeks to get back to today's features**, then the same theme work as option A on top. |
| Risk to saved text | Low. The stored HTML does not change shape. Each slice is a style or toolbar change. | **High.** ProseMirror throws away any markup its rules (its "schema") do not describe — silently, on the next save. Every attribute TipTap reads today has to be re-described exactly, or text on client pages loses its sizes, colours, shadows or links the next time somebody opens and saves it. |
| Fixes the 14 measured differences? | **Yes** — they are all on our side. | Only once the option-A work is also done. |
| Fixes the two bugs from this morning? | Already fixed (#994, #995). Slice 1's check stops that whole kind from coming back. | No — neither bug was in TipTap. |
| What we stop paying | Nothing. TipTap is free (MIT licence) and keeps getting updates. | TipTap's updates, its bug fixes, and its tables/lists/paste handling — we would own all of it. |

**What would make B the right answer:** if we hit something TipTap genuinely
cannot do — for example, real-time co-editing by two people, or a page-layout
editor that is no longer a text box. Nothing on the roadmap needs that today.
And option A does not close the door: if we ever do go to ProseMirror, the
theme connection built in A carries over unchanged, because it is our CSS and
our toolbar, not TipTap's.

---

## 2. What I measured, and how

**Method.** A throwaway script drove headless Chromium against this branch's
local server (`PORT=3067 node server.js`):

- **Live page:** `builder-preview.html?live=1` — the same React path a published
  page uses — showing one Paragraph module.
- **Editor:** the real `BuilderRichTextEditor` component, bundled the same way
  the Builder bundle is, mounted inside the same boxes the module card puts it
  in (`.builder-section-card › .builder-module-card › .builder-module-editor ›
  .field`), with the real `public/styles.css` and the theme variables the
  Builder hands it (`getThemeRootVars`).
- **Same text in both:** H1, H2 with one green word, H3, a paragraph with a link,
  a block quote, a two-item bullet list.
- **A test theme:** Oswald headings, Inter body, body text `#112233`, headings
  `#aa2200`, links `#0055cc` underlined, base 18px × 1.25 scale, line height 1.7,
  H1 weight 600, H1 40px above / 24px below, H2 line height 1.3.

Then it read the browser's final ("computed") value of eight properties on
each element in both, and listed every one that differs.

> One honest limit: the editor was mounted in a copy of the module card's
> boxes, not inside the signed-in Builder. The boxes and the stylesheet are the
> real ones; the rest of the Builder page around them is not. Slice 1 turns this
> into a permanent check, and should confirm the numbers once inside the real
> Builder.

### With a theme — 14 differences

| Element | Property | Live page | Editor |
|---|---|---|---|
| H1 | weight | 600 (the theme's) | 800 |
| H1 | line spacing | 93px | 59px |
| H1 | space above | 40px (the theme's) | 0 |
| H1 | space below | 24px (the theme's) | 14px |
| H2 | line spacing | 57px | 53px |
| H2 | space above | 36px | 0 |
| H2 green word | line spacing | 57px | 53px |
| H3 | line spacing | 60px | 42px |
| H3 | space above | 35px | 0 |
| Paragraph | colour | `#112233` (the theme's) | `#475569` (an app grey) |
| Link | colour | `#0055cc` (the theme's) | `#475569` (an app grey) |
| Quote | colour | `#112233` | `#475569` |
| Bullet | colour | `#112233` | `#475569` |
| Bullet | gap below | 0 | 14px — the editor double-spaces lists the live page does not |

What matched: fonts, heading sizes, heading colours, the green word's colour
and size (the #995 fix holds), and underline.

**In plain words:** with a theme on, you type in grey and the visitor reads it
in your theme's colour; your links look like body text in the editor; headings
sit tight together in the editor and get breathing room on the page; and lists
look double-spaced while you edit.

### With no theme — 17 differences

Without a theme the two fall back to two different sets of built-in defaults.
The worst: **an H2 is 28px in the editor and 46px on the page; an H3 is 22px
and 35px.** Heading colour differs too (`#18324a` against `#214c71`).

### Only one of nine editors gets the theme at all

The theme variables are handed to the editor in exactly **one** place: the
Paragraph module card. The other eight places the same editor appears — Blog
Post body, the blog post editor page, Event description, Speech Bubble,
Navigation feature text, Table cells, Reminder message, and the Heading
module's own editor — get no theme, so they always show the no-theme defaults
above, whatever the site's theme says.

### A theme setting that reaches nothing — on the live page either

The Themes screen's **"Base size (px)"** only feeds the heading scale. No style
rule anywhere reads it for body text (`--bx-size-base` appears in no
stylesheet), so changing it does not change the size of a paragraph on the
client's site. That is a live-site defect, separate from the editor; it belongs
in slice 2 below, and is flagged in the run report for filing.

### What is already saved on client pages

Counted on today's local copy of production (refreshed 2026-11-06), across all
245 Builder pages:

| What | Pages |
|---|---|
| Have headings (H1–H3) inside text | 191 |
| Have a hand-set pixel font size inside text | **147** — 3,378 sizes in total |
| Have a hand-set colour inside text | 151 |
| Have a drop shadow or outline on text | 51 |

This is the number that matters most for the choice. Those sizes and colours
are exactly what option B's new schema would have to read back perfectly, and
exactly what option A must leave alone. Option A's named styles (slice 4) sit
**beside** them — a raw 24px still works; it just stops being the easy thing to
reach for.

---

## 3. What the editor does today — the inventory

### Two editors (plus a frozen third)

1. **`components/builder-rich-text-editor.tsx`** (904 lines) — the full editor.
2. **`components/builder/builder-inline-rich-text-editor.tsx`** (420 lines) — the
   Heading module's editor: inline formatting only, Enter makes a line break,
   because nothing block-shaped can sit inside an `<h1>`.
3. **`public/js/richtext.js`** + `public/js/richtext-vendor.js` — the old
   vanilla-JS app's own small TipTap toolbar (B / I / U / lists / link), used by
   `public/js/builder.js`. That folder is frozen (bugfixes only), so this plan
   does not touch it; it retires when that screen moves to React.

All three run on TipTap 3.26 (`@tiptap/*`, MIT licence).

### Where the full editor appears (9 places)

| Where | File | Gets theme colours? | Gets theme styles? |
|---|---|---|---|
| Paragraph module | `builder/builder-module-card.tsx:4374` | yes | **yes — the only one** |
| Heading module (inline editor) | `builder/builder-heading-module-settings.tsx:120` | yes | no |
| Blog Post module body | `builder/builder-blog-post-module-settings.tsx:159` | no | no |
| Blog post editor page body | `builder-template-preview.tsx:5213` | no | no |
| Event description | `builder-template-preview.tsx:9315` | no | no |
| Speech Bubble | `builder/builder-speech-bubble-module-settings.tsx:69` | no | no |
| Navigation feature text | `builder/builder-navigation-module-settings.tsx:288` | no | no |
| Table cells | `builder/builder-table-module-settings.tsx:188` | no | no |
| Reminder message | `builder/builder-reminder-module-settings.tsx:128` | no | no |

### The toolbar (full editor)

P · H1 · H2 · H3 · Bold · Italic · Underline · Link (page or web address,
`rich-text-page-link.tsx`) · Image (upload or gallery) · Drop shadow · Outline ·
Align left / centre / right · HTML view · Font size (14–64px) · Line height
(1.2–2) · Text colour + theme swatches · Bullet list · Numbered list · Block
quote · Clear formatting · optional emoji picker.

Two toolbar facts worth knowing:

- **Only H1–H3 are offered**, though the theme defines H1–H6 and the live page
  styles all six.
- **The size box says "16px" for any text without a hand-set size**, even when
  the theme makes that text another size. It reports a number it does not know.

### Our own additions to TipTap

Five small extensions in the full editor, each storing a plain inline `style`
in the saved HTML: **font size** (on a span), **block style** (size, line height
and colour on a whole paragraph or heading), **text shadow**, **outline**
(`-webkit-text-stroke`), **line height** (on a span — kept only so old content
still reads). Plus **PageLink** (a link that can point at one of our pages),
**paste cleanup** (`lib/rich-text-paste.ts`, strips Google Docs' blank lines),
the **HTML view** with its careful hand-back rules, **image insert**
(`lib/rich-text-image.ts`), the **click guard** from #994, and the
**value-sync** logic in `lib/editor-content-sync.ts` that stops outside changes
being lost.

None of that is TipTap-specific in a way that would be cheap to rebuild. It is
the accumulated answer to roughly a dozen past bugs, and option B rewrites it.

### How styling reaches the editor today

- `themeColors` → the swatches beside the colour picker.
- `themeStyle` → the `--bx-*` theme variables (`getThemeRootVars` in
  `builder/builder-utils.ts`) set on the editor's outer box. Only the Paragraph
  module passes them.
- Five rules in `src/css/_builder-react-overrides.css` (`.builder-rich-text-content
  .ProseMirror …`) read those variables for body colour/font/line height and
  H1–H3 size/colour/font, plus the #995 span fix.
- Underneath, **a dozen older rules in `src/css/_builder-react.css`** set their own
  fixed values (800 weight, 1.08 line height, 0.9rem gaps, `#18324a`, links as
  plain text).

The live page reads the theme through a **different, longer set of rules** in
`src/css/_builder-theme.css`, written against `.builder-preview-text`. The
editor's set was written separately and has fallen behind it: weights, line
heights, heading margins, link colour and H4–H6 were added to the live set and
never to the editor's. **That is the root of all 14 differences: two copies of
"how text looks", maintained by hand, drifting.**

---

## 4. Option A in slices

Each slice ships on its own and leaves the site better than it found it.

### Slice 1 — one set of rules, and a check that holds it (1 day) ← start here

- Change the theme text rules in `_builder-theme.css` so each one names **both**
  the live page's text box and the editor's text box. One rule, two places —
  so they cannot drift again, because there is only one copy.
- Remove the editor's own competing values from `_builder-react-overrides.css`
  (and override the generated file's fixed ones there — never edit
  `_builder-react.css` itself).
- Turn the measurement above into a permanent **`npm run check:editor-parity`**:
  no database, no login, about 20 seconds, same shape as `check:render`. It
  fails on any difference, with a theme and without one, and is break-tested by
  reverting one rule.

Fixes: all 14 themed differences and most of the 17 unthemed ones, for the
Paragraph module. Risk: CSS only; stored text untouched.

### Slice 2 — every editor gets the theme (1–2 days)

Pass the theme variables to all nine places, not one. Fix "Base size (px)" so
it sets body text size on the live page and in the editor. Fixes: the eight
editors that ignore the theme today; a theme setting that does nothing.

### Slice 3 — the toolbar tells the truth (2–3 days)

The size box shows the theme's actual size for unstyled text ("Theme · 18px")
instead of a fixed "16px". Offer H4–H6 the theme already defines. Put the theme's
own colour roles first in the colour menu (Text, Heading, Link, Muted).

### Slice 4 — named text styles from the theme (1–2 weeks)

The theme already has a slot for this that nothing uses:
`theme.typography.elements` in `lib/builder-client/builder-template.ts` (size,
weight, line height, letter spacing, case, colour, margins, shadow per element)
is stored, normalised, and **never shown in the Themes screen nor applied to
any page**. Slice 4 gives it a panel on Themes, adds "Lead" and "Caption", and
puts a **Style** menu in the editor that applies a theme class
(`<p class="bx-lead">`) instead of a raw size. Change the theme and every Lead
on the site changes with it. The 3,378 existing raw sizes keep working.

### Slice 5 — test it in a real browser by habit (2–3 days, alongside)

See section 5.

**Total: about 3–4 weeks of work**, with slices 1–3 (about a week) delivering
most of the visible "what I type is what they see".

---

## 5. Testing the editor in a real browser from now on

The test runner's stand-in browser (jsdom) could not reproduce either of
today's bugs: it applies no stylesheet, so it cannot see a style leak, and it
does not forward a label's click to a button, so it could not see #994. Both
were only caught in Chromium. Three layers, cheapest first:

1. **`check:editor-parity`** (slice 1) — the measurement above, made permanent.
   Catches any styling drift between editor and page. No database, no login.
2. **Real-click contracts.** The same harness mounts the editor and uses
   Playwright to click, type and select the way a person does: click inside an
   H2 and confirm it is still an H2 (#994); colour one word and confirm its size
   did not move (#995); paste a Google Doc and count the paragraphs; open and
   close the HTML view and confirm nothing changed.
3. **Add each new editor bug as a contract when it is fixed**, as
   `check:render` does for modules — a bug that only a browser can see gets a
   check that runs in a browser.

These belong in pre-commit only when the editor's files change (the way
`check:shots` skips itself), because they need a running server.

---

## 6. What I recommend Dane decide

1. **Option A or B?** Recommendation: **A**.
2. **If A, go ahead with slice 1** (one day, CSS plus a check, no stored text
   touched)? It can be built by the loop as soon as it is ticketed.
3. **Slices 2–5:** ticket them now, or after seeing slice 1 on a real page?
