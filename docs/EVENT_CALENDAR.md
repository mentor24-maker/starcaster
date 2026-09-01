# Event Calendar

**Shipped:** 2026-09-01 — `event-manager` (1/3) and `event-calendar` (2/3).

The Event Calendar follows the Blog's shape: a table of records the tenant
owns, an admin module that manages them, and public modules that display them.
This document covers what exists now and what deliberately does not.

## What shipped

| Piece | Where |
|---|---|
| `events` table | [`docs/SQL/events_setup.sql`](SQL/events_setup.sql) |
| Store | [`lib/eventsStore.js`](../lib/eventsStore.js) |
| API | [`routes/events.js`](../routes/events.js) — `/api/events` |
| Admin module `event-manager` | renderer in [`components/builder-template-preview.tsx`](../components/builder-template-preview.tsx), settings panel in [`components/builder/builder-event-manager-module-settings.tsx`](../components/builder/builder-event-manager-module-settings.tsx) |
| Public module `event-calendar` | renderer in the same file, settings panel in [`components/builder/builder-event-calendar-module-settings.tsx`](../components/builder/builder-event-calendar-module-settings.tsx) |
| Dates and calendar geometry | [`lib/builder-client/event-format.ts`](../lib/builder-client/event-format.ts) — unit-tested |
| Tenant admin page | `admin-event-manager`, in [`lib/projectAdminScaffold.js`](../lib/projectAdminScaffold.js) |

The module is one surface, not two: the table and the add/edit form live in
the same module. The Blog splits them (`blog-post-create` + `blog-post-manager`
on separate halves of a page) because a blog post is a long piece of writing
that deserves its own screen. An event is a dozen short fields, and splitting
them would mean a second page, a second module and a URL to keep in step, for
a form that fits under its own table.

## The fields, and why these

Ten of them came from the operator's own list — name, description, image, URL,
start, end. The rest exist because a calendar without them misreports:

- **All day** — without it a picnic "on Saturday" renders as `12:00 AM`, which
  looks like a bug to every visitor who sees it.
- **Time zone** — a stored timestamp has no zone. A visitor two zones over
  should read "7 PM Mountain", not their own clock's guess at it.
- **Status: draft / published / cancelled.** Cancelled is the one that matters
  and the one a blog does not need: an event people already put in their diary
  must keep its page and *say* it is off. Deleting it makes them turn up.
- **Slug** — so each event can have its own page, the way a post does.
- **Location** (name, address, map link) — the question every visitor asks
  second, right after "when".
- **Excerpt** — a short line for calendar cards, so the grid is not trying to
  render rich HTML in a 200px box.
- **Organizer name and contact, SEO title and description, featured** — the
  same set the blog carries, for the same reasons.

## What is deliberately not here

- **Recurrence** ("every Tuesday"). The single most-asked-for calendar feature
  and the hardest part of one — it changes what a row *is*, from one event to
  a rule that generates them. The table has no recurrence column, and adding
  one later does not require rewriting what is here.
- **Categories.** The blog has them, with colours, for filtering. Events will
  want the same thing, but the public calendar is what makes that visible, so
  it belongs with the module that filters by it.
- **Ticketing, RSVP, capacity, attachments.** All real; all their own feature.

## The public calendar (2/3)

`event-calendar` is one module with three layouts, because "a calendar" means
different things on different pages:

- **Month grid** — the default. Seven columns of whole weeks, events as chips
  on their days, previous/next paging. Days from the neighbouring months are
  drawn but muted: hiding them leaves ragged holes, and drawing them unmarked
  lies about which month you are looking at.
- **Upcoming list** — a date block and a title per row, the thing a visitor
  scans down.
- **Cards** — a one-to-four column grid with images, for a landing page.

**An event is "upcoming" until it has FINISHED, not until it has started.**
A festival on its second day, or a party half way through its evening, is
exactly what a visitor is looking for; judging by start time drops an event
from the list at the moment it is most relevant.

**A failed request does not wear the empty state's words.** "No events
scheduled" printed over a broken fetch tells a visitor something false about
the tenant, so the two states say different things.

**The geometry is arithmetic, and it is unit-tested** in
`lib/builder-client/event-format.ts` — the month grid covers every day of a
month exactly once, adds no empty trailing week, and honours a Sunday or
Monday start. An off-by-one in the lead puts every date under the wrong
weekday: a calendar that is confidently, silently wrong, which is worse than
one that fails to draw. `check:render` covers the half a unit test cannot see
— that the grid reaches the page as seven columns.

## The public read exemption — a security decision, made here

`event-calendar` is read by visitors with no login, so
[`lib/projectAdminApiAuth.js`](../lib/projectAdminApiAuth.js) now opens
exactly two doors, both mirroring the blog's:

| Opened | Not opened |
|---|---|
| `GET /api/events?status=published` | the unfiltered list — the admin manager's call |
| `GET /api/events/<slug>?by=slug` | `GET /api/events/<id>` |
| | every write: POST, PUT, DELETE |

The list is public **only when it explicitly asks for published events**, so an
unauthenticated caller cannot reach drafts by leaving the filter off. The
single-event read is public **only by slug**, and `routes/events.js`
additionally 404s anything not published when there is no session. Both
directions are asserted in `scripts/project-admin-api-auth.test.js`, and both
were broken on purpose to watch the assertions fail.

## Still to build

1. **`event-detail`** — the single event's page, which is what the calendar's
   and the manager's *Event Page URL* settings point at. Until it exists,
   leave that setting empty: the calendar then links an event only to its own
   `url` (a ticketing page), and the manager's View button stays disabled
   rather than pointing at a page that is not there.

## Things worth knowing

**Dates are stored as UTC timestamps and edited in local time.** The form's
`datetime-local` input has no concept of a zone: it reads whatever it is given
as local wall-clock time. Slicing an ISO string into that box shows a UTC time
labelled as local, which is silently wrong by the viewer's offset — so the
conversion is done explicitly, both ways (`isoToLocalInput` /
`localInputToIso`). Toggling **All day** converts what is already typed rather
than discarding it.

**An unreadable date becomes `null`, not a string.** Text in a `timestamptz`
column is a 400 from PostgREST that reads like a server fault; an event with
no start date is a state the list already handles — it sorts last, under
"Not scheduled".

**An unknown status becomes `draft`.** `status: 'pubished'` must not create a
fourth state the calendar has never heard of. Draft is the state that shows
nobody anything by accident.

**The module is admin-only, in four registries.** A module that manages content
must never paint on a public page or turn up in site search. It is listed in
`PRIVATE_ONLY_MODULE_TYPES` (public-site-sections), `NEVER_INDEXED_MODULE_TYPES`
(site-search), `PRIVATE_SITE_SLUGS_EXACT` (page slugs) and the site-import
reserved-slug pattern. Each has a test that names the full set, so adding the
next admin module means updating a list rather than remembering a rule.

**The events table carries both tenant columns.** `project_id` *and*
`owner_user_id` — CLAUDE.md landmine 12: a table with only the first fails
`lib/projectScope.js`'s probe, and rows land with no tenant while every insert
reports success.
