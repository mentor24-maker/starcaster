# Blog Links Manager (`admin-blog-links`)

A **tag manager** for the blog, plus hand-picking related articles. Tickets
86bbu4qh5 and 86bbue8ux, 2026-09-03.

Top: a table of every tag with its post count, a pencil to rename it across
every post that carries it, and a cross to remove it from all of them.
Below: pick a category or tag, and the articles filed under it appear with
checkboxes and a **Relate Checked** button that links the ticked ones to each
other.

## It does NOT manage categories, and that is deliberate

There is already a `blog-category-manager` module, and it does the job
properly — slug, description, colour, sort order. The first version of this
module shipped a second, worse category list beside it on the same tenant page
and the operator spotted it immediately (2026-09-03):

> we already have a Category manager. What we need is the Tag manager that
> follows the same basic format.

So categories appear here only as a way to CHOOSE which articles to relate.
Creating, renaming and deleting them belongs to the Category manager.

**Tags are the half that never had a manager**, because they are not a table —
see below.

## Nothing truncates

The first version put the taxonomy in a 320px sidebar with
`text-overflow: ellipsis`, and on the live Delray page that rendered
"Tennis Cha…", "Delray Te…", "advanced…", "clay court…". The tag IS the
content; clipping it makes the panel useless. The table now gives the name a
`1fr` column and wraps with `overflow-wrap: anywhere` rather than clipping,
and the article picker is a full-width `<select>` rather than a narrow list.

If you add a column here, do not buy its width from the name.

## What the blog actually has (read this before extending it)

The three nouns people use for blog taxonomy do not map onto three things:

| UI word | What it really is |
|---|---|
| **Categories** | A real table, `blog_categories`, joined to posts through `blog_post_categories`. Names, slugs, colours, sort order. |
| **Tags** | **Not a table.** A `text[]` column on `blog_posts`. The tag list is DERIVED from the posts, and "managing" a tag means rewriting the array on every post that carries the word. |
| **Topics** | **Does not exist in the blog at all.** The only Topics in Starcaster are Messaging Topics, an unrelated feature (see the naming table in `CLAUDE.md`). |

The module was asked for with "tags, topics, categories". Topics were left out
deliberately rather than invented — the operator's call, 2026-09-03.

## The table matches the Category manager on purpose

Same bordered container, same uppercase header row, same pencil and cross.
It has **three** columns rather than four — NAME, POSTS, ACTIONS — because a
tag genuinely has no slug, description, colour or sort order. Inventing columns
to match a shape would be decoration.

There is also **no "New Tag" form**, and that is not an omission: a tag cannot
exist without a post carrying it, so a create box would be a control that
cannot work. The panel says where tags come from instead. The form that does
exist is a rename form, and it states before you press it that renaming onto an
existing tag merges the two.

## Relations are mutual, and that shapes the storage

Relating A, B and C means each of the three sees the other two. There is no
"source" post and no direction. So a relation is an unordered **pair**, and
`blog_post_relations` holds one row per pair with the two ids **canonically
ordered** (`post_id_a < post_id_b`, enforced by a check constraint).

That ordering is the whole design. Without it, `(A,B)` and `(B,A)` are two
different rows, the unique index never fires, and "unrelate" can only remove
one of them. Ticking *n* articles writes *n*(*n*−1)/2 pairs, minus the ones
already stored — so pressing the button twice on the same selection is a
no-op, not a duplicate-key failure.

The pair arithmetic is **one implementation, shared**:
`lib/builder-client/blog-post-relations.ts`, used by the browser and mirrored
minimally in `lib/blogPostRelationsStore.js`. Two versions of "which pairs does
this set imply" would drift apart silently.

## The button has a reader — that was the point

A "Relate Checked" that saved into something nothing displays would be a
feature that reports success and changes nothing anyone can see. So the
`blog-related-posts` module gained a match mode:

> **Match By → Hand-picked (Blog Links Manager)**

It reads `blog_post_relations` for the post being viewed. It is different from
the existing **Manual selection**, which is a list of titles and URLs typed
into the module's own settings: manual is per-module and freehand, hand-picked
is per-post, real, and one linking serves every page the module sits on.

**A visitor has no login**, so `GET /api/blog/relations?postId=<id>` is on the
public tenant read list (`lib/projectAdminApiAuth.js`). Narrowly: only the
single-post form. The unfiltered list — every relation in the project — still
needs a session, so nobody can enumerate the graph by leaving the filter off.
`scripts/builder/blogLinksAuth.test.js` pins both halves.

## Tag edits rewrite posts

- **Rename** rewrites the word on every post carrying it, in any spelling.
- **Renaming onto a tag that already exists is a MERGE.** A post carrying both
  ends up with one, not a duplicate. This is the case that breaks a naive
  implementation and it is the one most worth testing.
- Tags match **case-insensitively** but store the casing the author typed, so
  "Immigration" and "immigration" are one tag with two spellings. Listing them
  separately would make a rename leave half the posts behind and report a count
  that is not true.
- Only the posts that actually change are written, and **each write is read
  back**; a post whose stored tags do not match is reported as failed rather
  than counted as renamed. A partial rename returns an error naming how many
  posts still carry the old tag — never a success.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/blog/tags` | Derived list with post counts |
| GET | `/api/blog/tags/posts?tag=` | Posts carrying a tag |
| POST | `/api/blog/tags/rename` | `{from, to}` — merges if `to` exists |
| DELETE | `/api/blog/tags` | `{tag}` — removes it from every post |
| GET | `/api/blog/relations` | Whole project. Session required. |
| GET | `/api/blog/relations?postId=` | One post. **Open to visitors.** |
| POST | `/api/blog/relations` | `{postIds:[…]}` — needs at least two |
| DELETE | `/api/blog/relations` | `{postIdA, postIdB}` — order-independent |

## Traps this feature already hit

Every one of these passed typecheck, both test suites, `check_conventions`,
`check:panels`, `check:render` and `check:shots`. They were found by opening
the thing in a browser.

0. **A 320px sidebar with an ellipsis.** See "Nothing truncates" above — the
   defect that produced the second ticket. Every gate was green on it.
1. **`getCrmProjectHeaders()` returns a fresh object per render.** Feeding it
   to a `useCallback` dependency list makes every callback new, which refires
   the load effect, which sets state, which renders again — an unbounded
   request loop that surfaced as `ERR_INSUFFICIENT_RESOURCES`, not as a React
   warning. Memoise it.
2. **This module renders inside ARBITRARY tenant themes.** Two separate hits:
   a semantic `<header>` picked up the tenant site's black header styling and
   rendered as a solid black block; and a theme's `input { width: 100% }` blew
   the row checkbox out to **1056px**, starving the title beside it to zero
   width — so rows rendered tall and empty with the text wrapped to nothing.
   `flex: 0 0 auto` does **not** protect you there: the basis is `auto`, so the
   item takes its `width` property. Size form controls explicitly and prefer
   plain `<div>`s to semantic tags inside a module.
3. **N+1 requests.** The first version fetched relations once per article.
   One request for the project, filtered with the shared helper, is correct.
4. **`blogPostsStore` probed a column the join table does not have.**
   Pre-existing, and the worst of the four — see below.

## The join-table probe bug (fixed here, pre-existing)

`blogPostsStore.supportsSupabase()` decided whether a table existed by
`select=id`. `blog_post_categories` is a pure join table: its primary key is
`(post_id, category_id)` and it has **no `id` column**. PostgREST answered
"column blog_post_categories.id does not exist", which `isMissingTable()` reads
as the *table* being absent — so every category read and write silently used
the local JSON file instead.

On Vercel that filesystem is read-only (landmine 6), so **assigning a category
to a blog post reported success and never persisted**, and listing posts by
category returned nothing. Both look exactly like "this tenant has no
categories yet", which is why it went unnoticed.

Each table now names a column it actually has (`PROBE_COLUMN`), pinned by
`scripts/builder/blogStoreTableProbe.test.js`.

## Deployment

`docs/SQL/blog_post_relations_setup.sql` must be run before the feature works
in production. Until it is, `relatePosts` returns `null` and the API answers
**500** rather than falling back to a local file — deliberately. A missing
table is a deployment error, and a write that cannot persist has to say so
instead of answering 200 with the caller's own input.
