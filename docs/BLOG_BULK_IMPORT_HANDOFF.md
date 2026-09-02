# Blog Manager — bulk import of discarded pages into blog posts

**Ticket:** 86bbtuh3y · **Written:** 2026-09-02 · **For:** the agent session that builds this

Delray's original site had about 44 blog posts. Site Import brought them in as
Builder pages; Dane later discarded those pages. He wants the posts back — as
real `blog_posts` rows this time, not pages.

This document is the survey work, done. Every number below was measured against
the actual data, not inferred. Where a claim would have been a guess, it says so.

---

## 0. READ THIS FIRST — the content has exactly one copy

The discarded pages are **deleted**. Their content survives only as orphaned
rows in `builder_published_pages`: snapshots whose `page_id` no longer matches
any row in `builder_landing_page`.

There are **51** such rows in Delray's project, of which **44** look like blog
posts. There is a backup:

```
~/Desktop/delray-orphan-snapshots-backup-2026-09-02.json     (1.5 MB, 51 rows, payloads included)
```

That file is on one Mac and is **not in git**. It is not a backup in any sense
that survives a spilled coffee.

**Two live hazards:**

1. **Ticket 86bbtthnk** ("An unpublished or private page keeps a full copy of
   its content in the published table") proposes deleting orphaned snapshots.
   If it runs first, this feature has nothing to import.
2. Dane has an open offer from an earlier session to delete Delray's 51 orphans
   as cleanup. He has not said yes. **He must not, until this has shipped and he
   has confirmed the posts read correctly.**

Before you start: copy the backup somewhere durable, tell the bus you have, and
say on 86bbtthnk that it is blocked on this ticket. Do not treat the snapshot
rows as scratch data.

---

## 1. Where the feature goes

The **Blog Manager** is a Builder module, `blog-post-manager`. One React
component renders it in both the builder preview and the live tenant admin page:

| What | Where |
|---|---|
| The component | `components/builder-template-preview.tsx` → `BlogPostManagerPreview`, line ~3083 |
| Its settings panel | `components/builder/builder-blog-post-manager-module-settings.tsx` |
| Module type registration | `lib/builder-client/builder-template.ts` (line ~126, ~2136, ~3712) **and** `lib/builder/template.js` — landmine 1, dual registration; run `npm run build:builder-template` |
| Its CSS | `src/css/_builder-react.css` (~line 11958) — **regenerated wholesale** by `npm run extract:builder-css`; hand-written rules go in `_builder-react-overrides.css` |
| Its slug | `blog-post-manager`, a private slug (`lib/builder-client/public-site-page-slugs.js`) so it needs a project-admin session |

`BlogPostManagerPreview` already does everything you need to copy: it fetches
`/api/blog/posts?limit=50` with `credentials: "include"` and
`getCrmProjectHeaders()`, and its **`clonePost`** function is a working
precedent for reading a source and `POST`ing a new post. Read `clonePost` before
you write anything.

---

## 2. The data model you are writing into

`blog_posts` — `docs/SQL/blog_setup.sql`, store `lib/blogPostsStore.js`,
route `routes/blog.js`.

`POST /api/blog/posts` (`routes/blog.js:95`) accepts exactly:

```
title *required   slug      status (draft|published|archived, default draft)
author            authorUserId          featuredImageUrl      featuredImageAssetId
excerpt           body (rich HTML)      seoTitle              seoDescription
tags []           readingTimeMinutes    publishedAt           categoryIds []
```

Two things to know:

- **`slug` is unique per project**, enforced by a partial unique index
  (`idx_blog_posts_slug_project ... where slug <> ''`). Empty slugs are exempt,
  which is how a backfill is allowed to leave them blank. A collision is a real
  database error, not a silent overwrite — plan for it (see §6).
- **`status` defaults to `draft`.** Import as drafts. Dane publishes when he has
  read them. Importing 44 posts straight to `published` puts unreviewed
  2018-era content on a client's live site.

Delray currently has **8** blog posts, all `published`, all recent. The import
adds to those, it does not replace them.

---

## 3. Telling template from content — do this structurally

Dane's phrasing was "all modules that are not part of the template". There is an
exact, already-shipped test for that, and you should use it rather than invent
one:

```js
// lib/builder/template-frame.js  (generated from lib/builder-client/builder-template-frame.ts)
const isFrameSection = (section) => section.canonical === true && Boolean(section.savedSectionId);
```

A section is template chrome if it is canonical **and** linked to a saved
section. Content sections have neither flag. Measured across all 51 orphans,
this splits cleanly:

| Template sections (excluded) | Content sections (imported) |
|---|---|
| `1 - Contact Strip`, `Header`, `2 - Menu Banner`, `3 - Footer Menu`, `4 - Copyright` | `Imported: <post title>`, `Imported: section` |

**Do not filter on section titles.** It looks tempting — the content sections
really are all named `Imported: …` — and it is exactly the trap `docs/DOCTRINE.md`
keeps warning about: a rule that reads the label instead of the structure works
until somebody renames something. The flags are the contract; the titles are a
coincidence of how Site Import happened to name things.

Module types found inside the non-template sections, across all 51 orphans:

```
79 text     71 image     5 code     3 tractor-nav     2 heading
 1 carousel  1 blog-search  1 blog-tag-cloud  1 blog-related-posts
```

The last four are module leakage from a page that was mid-redesign — see §6.

---

## 4. The trap that decides whether this feature is any good

**The `text` module does not contain the article. It contains the whole scraped
page.**

Site Import poured each original page's HTML into a single rich-text module,
site chrome and all. Here is the top of a real one
(`summer-tennis-camp-fun-for-junior-players…`, 5,035 characters):

```html
<p class="site-title"><a href="/imported-home">Delray Beach Tennis Center</a></p>
<p class="site-description">Delray Beach, FL</p>
<a href="https://www.facebook.com/DelrayTennis"><img src=".../facebook_11.png" width="24" height="24"></a>|<a href="…
```

Navigation. Social icons. A site title. Concatenate the non-template modules
straight into `body` and you get 44 posts that each begin with a broken copy of
the 2018 site header.

**And the `image` module is worse.** In the `Imported: section` block, it is
routinely a WordPress analytics beacon:

```
https://pixel.wp.com/g.gif?v=ext&blog=158783199&post=62515&…
```

Take "the first image module" as the featured image and you will set a
1×1 tracking pixel as the header image on dozens of posts.

### What the HTML actually gives you

The scraped markup is WordPress, and it is consistent enough to parse. Measured
over the 47 orphans with more than 300 characters of text:

| Field | Source | Recoverable |
|---|---|---|
| Title | `<h1>` | **46 / 47** |
| Publish date | `<time datetime="…">`, else `<time>` text (`"June 6, 2018"`) | **41 / 47** |
| Author | `<span class="entry-author-name">` (`"Jeff Bingo"`, `"jcdgroup"`) | **41 / 47** |
| A content image | `<img src>` under `.../Site_Import/...` | **44 / 47** |

So the shape of the extraction is:

1. Find the `<h1>`. **Everything before it is site chrome — discard it.** That
   one cut removes the nav, the social strip and the site title in a single
   move, and it is why the title is worth finding even though the section title
   also carries it.
2. Take the `<h1>` text as `title`.
3. Take `<time>` as `publishedAt`; the values are human-format
   (`"June 6, 2018"`), so parse deliberately and record a failure rather than
   letting `new Date()` produce `Invalid Date`.
4. Take `entry-author-name` as `author`.
5. The remaining markup after the byline block is `body`.
6. `featuredImageUrl`: the first `Site_Import` image **after the `<h1>`**, and
   skip anything under about 100px in its `width`/`height` attributes — that is
   what excludes the icon strip and the beacon. Verify by eye on a sample, not
   by trusting this paragraph.
7. `excerpt`: first paragraph of the body, stripped of tags, truncated. Cheap
   and much better than empty.

**Every one of those seven steps needs a break test.** Point each at a fixture
that lacks the thing it looks for and confirm the row reports "no date found"
rather than silently writing an empty string. Six posts have no date and six
have no author; those are the cases that decide whether Dane can trust the run.

---

## 5. Which rows are even candidates

The 51 orphans are **not** 51 blog posts. Splitting on "has an
`Imported: <title>` section **and** more than 300 characters of body text":

- **44 look like posts.** Bodies from 1.5k to 40k characters, median 3.8k.
- **7 are not:** `test` (0 chars), `blog-old` (0), `pickleball-videos` (38),
  `rules-resources` (46), `course-blog-copy`, `pro-celebrity-classic-copy`,
  `davis-cup-at-delray-beach-tennis-center-2025`.

And the 44 are not all *posts* either. `Managers & Instructional Staff` (40k),
`Adult Clinics`, and `Directions & Hours` are ordinary site pages that happen to
match the pattern.

**This is why the feature is a picker, not a button.** Dane must see the
candidate list — title, word count, date, author, and enough of the body to
recognise it — and tick what he wants. A heuristic good enough to sort 51 rows
into two piles is not good enough to write 44 rows to a client's database
unattended. Show your confidence; let him overrule it.

Two known near-duplicates against posts that already exist:

- `US Open snapshot: how the Americans are faring…` — already a live post
- `Davis Cup at Delray Beach Tennis Center` — already a live post, and there is
  an orphan `davis-cup-at-delray-beach-tennis-center-2025`

Flag these in the picker rather than silently skipping or silently duplicating.

---

## 6. Design notes

**Where the candidates come from.** The orphans live in
`builder_published_pages`, found by the same query the fix in PR #532 used:
snapshot rows whose `page_id` is absent from `builder_landing_page` for that
project. Read `lib/builderPublishStore.js` and `lib/publishedPageRead.js` for
how that table is addressed — note that it is keyed on `page_id`, and that
reading it by `slug` is the bug PR #532 just fixed. Do not reintroduce it.

**Recommendation, for Dane to confirm:** make the picker list candidates from
**both** orphaned snapshots *and* live Builder pages. The orphans are the
immediate need, but "turn this page into a blog post" is a tool with a life
beyond this one recovery, and the extraction work is identical. Build orphans
first; the live-page source is a second slice, not a redesign.

**Idempotency.** Re-running must not duplicate. The natural key is the source
page id. Options, in the order I would try them: record `source_page_id` on the
post (a schema change, so a migration and RLS — see below); or match on slug and
refuse; or have the picker mark already-imported candidates by comparing slugs.
The last needs no migration and is probably right for a one-off recovery. Do not
rely on title matching — two of these titles differ from their live twins by one
word, which is precisely the failure mode 86bbqwupk was filed about.

**Dry run first, always.** Show exactly what would be created — every field, per
post — and write nothing until Dane confirms. He should never learn what this
tool does by watching it do it.

**Batch, do not loop.** If any of this runs server-side, publishing's own header
explains why (`lib/builderPublishStore.js`): a long loop over many rows inside a
serverless function gets cut off when the response goes out, and
`propagateCanonicalSection` lost 20 of 50 pages that way on 2026-07-22. 44 posts
is enough to matter. Batch it, report what remains, let the caller loop.

**If you add a column,** the table is tenant-scoped: it needs **both**
`project_id` and `owner_user_id` or `scopedInsertRow` silently stops stamping
either (landmine 12), and it needs RLS enabled (all tables have been RLS-on
since 2026-08-18). Read the rows back after writing — do not trust the insert's
success.

---

## 7. Definition of done, specific to this task

The standard gates in `CLAUDE.md` §Definition of done, plus:

- **`npm run check:panels`** — you are changing a settings panel surface. CI has
  no browser, so this only ever runs if you run it. Seed real content for the
  blog-post-manager module in `scripts/ui/seed_fixture.mjs` first; a green run
  against a fixture that does not exercise your panel is not evidence.
- **`npm run check:shots -- --task 86bbtuh3y`** — the Blog Manager renders, so
  this is a visual change.
- **Break-test the frame filter.** Flip `canonical` to `false` on a fixture
  template section and confirm the header appears in the imported body — that is
  the assertion doing its job. Flip it back.
- **Break-test each extractor** (§4).
- **Import into local first** (`npm run env:local`, `npm run db:refresh` if the
  copy is stale), then open the Blog Manager in a browser and **read three
  imported posts end to end.** Nothing in this repo tests HTML quality. A post
  can pass every gate and open with a mangled 2018 nav bar.

### How Dane checks it

Give him this, filled in with a real address and real clicks — not "open it in a
browser":

1. Go to `https://delraytennis.starcaster.pro/blog-post-manager` (sign in as
   project admin if asked).
2. Click **Import from discarded pages**.
3. You should see a list of about 44 candidates, each with a title, a date, an
   author and the first line or two of the article.
4. Tick three you recognise, click **Preview import**, and read what it says it
   will create. Nothing has been written yet at this point.
5. Click **Import**. The three appear in the post list as **drafts**.
6. Open one and read it top to bottom. The article should start with its own
   headline — no navigation, no social icons, no Delray Beach Tennis Center site
   title above it.

---

## 8. Open questions for Dane — ask before building, not after

1. **Both sources, or just the discarded pages?** (§6 recommends both, orphans
   first.)
2. **What should the author be** on the six posts with no author in the source —
   blank, or a default like "Delray Beach Tennis Center"?
3. **And the date** on the six with no date — blank, or the page's `createdAt`
   from the snapshot? Blank means they sort to the bottom of the feed.
4. **The seven non-posts** (§5) — leave them out entirely, or list them at the
   bottom marked "probably not a post" so he can decide?

---

## Source material

- `~/Desktop/delray-orphan-snapshots-backup-2026-09-02.json` — the 51 rows
- Ticket 86bbtqvnf / PR #532 — how the orphans came to exist, and the fix
- Ticket 86bbtthnk — proposes deleting them; **must not run first**
- `docs/DOCTRINE.md` §5.14 — what the visual gates do and do not cover
