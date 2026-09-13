# Event Calendar

**Shipped:** 2026-09-01 — all three modules.

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
| Public module `event-detail` | renderer in the same file, settings panel in [`components/builder/builder-event-detail-module-settings.tsx`](../components/builder/builder-event-detail-module-settings.tsx) |
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

- **Recurrence** was here until 2026-09-12 — see "Repeating events" below.
- **Categories** arrived 2026-09-12 as venues — see "Instructors and venues" below.
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

## Repeating events (task 86bbzt259, 2026-09-12)

Built for Delray Beach Tennis, whose printed *Weekly Program Guide* is ~35
weekly programs — "Drills & Games I · Wayne L · Mon–Sat 8:30–10:00am".

**A repeating event is ONE row carrying a rule, not a row per date.** Two new
columns (`docs/SQL/events_programs_setup.sql`):

| Column | Shape |
|---|---|
| `recurrence` | `null` for a one-off, or `{ freq: "weekly", interval: 1–12, weekdays: [0–6], until: "YYYY-MM-DD" \| null }` |
| `recurrence_overrides` | `[{ date, cancelled?, startTime?, endTime?, note? }]` — single dates that differ |

A row per date would be ~1,800 rows a year for one club, each to be edited when
a coach changes; the rule is edited once. The dates are worked out when shown,
by `expandOccurrences` in `lib/builder-client/event-recurrence.ts`, which every
surface uses — so the admin list and the public calendar cannot disagree about
whether a program is on the 14th.

**The time is the EVENT's wall clock, not a fixed number of hours.** A weekly
8:30am program is 8:30am on both sides of the November clock change. Adding
seven days of milliseconds to the first start would put it at 7:30am from
November 1 — a calendar confidently wrong for half the year. Each date's time
is computed in the event's `timezone` (`zonedTimeToUtc`), and a repeating event
therefore **requires** a real IANA zone; the API refuses one without. The unit
test for this is run with the machine's own clock set to Tokyo, and it was
broken on purpose (a fixed 7-day step) to watch it fail.

**The form now reads times in the event's zone too.** It used to read the
admin's browser zone, which was right only while the admin happened to be in
the club's zone. For an admin in the same zone as the event nothing changes.

**Refused, never dropped.** `lib/eventRecurrence.js` validates a request body
and answers a 400 with a sentence ("Pick at least one day of the week…"). A rule
quietly discarded would save a one-off event and say *Saved*. Rows READ back go
through the lenient twin, which drops only the unreadable part, so a hand-edited
row cannot take a calendar down.

**Single-date changes.** The *Upcoming dates* list (next 12 weeks) offers
*Cancel date*, *Change* (start, end, a note) and *Restore* / *Undo change*. An
entry that ends up changing nothing is removed rather than stored. Turning
Repeat off drops the changes with it. A date whose weekday is later unticked
simply stops being produced; its stored change is inert.

**Which dates a rule produces:** each ticked weekday on or after the start
date, in weeks counted from the start date's week, up to and including `until`.
The start date itself counts only if its weekday is ticked.

**Not built:** daily and monthly rules (Dane chose weekly-only, 2026-09-12;
nothing on the program guide needs them). Public display is "The public calendar with repeats"
below; instructors and venues are the section after this one.

## Instructors and venues (task 86bbzt25g, 2026-09-12)

Delray's program guide colours every program by where it runs — Delray Beach
Tennis Center navy, Delray Swim & Tennis Club green, Pickleball orange — and
names the coach. So an event now carries:

- **`instructor`** — free text. A single date may name a substitute
  (`recurrence_overrides[].instructor`), because the guide changes the coach
  week to week far more often than the time.
- **`category_id`** — one row of `event_categories` (name, `#rrggbb` colour,
  sort order), managed from the **Venues** button on the Event Manager.

**Not a foreign key, on purpose.** Deleting a venue leaves its events standing;
every reader treats an id it cannot find as "no category", and the delete
confirmation says how many events will lose theirs.

**A colour is `#rrggbb` or nothing.** The value lands in a style attribute on a
client's public page; the route answers a 400 for anything else and the store
blanks it if one gets past.

**Public read, narrowly** — a second exemption in
`lib/projectAdminApiAuth.js`: `GET /api/event-categories` only (the legend is
painted on the page anyway), stripped by `categoriesForCaller` to id, name,
colour and order for a caller with no session. Every write and the by-id path
still need one. Both directions are asserted and were broken on purpose.

## The public calendar with repeats (task 86bbzt25j, 2026-09-12)

**One schedule, every view.** `lib/builder-client/event-schedule.ts` turns
events into dated items (`scheduleBetween`) and groups them by the dates they
touch (`groupByDate`). The month grid, the list, the cards, the new weekly
schedule and the event page all read it, so a repeating program is on the same
dates everywhere. Unit-tested, including in a Tokyo-clock run.

**The calendar is drawn in the club's zone, not the visitor's**
(`calendarTimeZone`: the first event naming a real zone). A 7pm Tuesday program
stays on Tuesday for a visitor in another zone.

**Weekly schedule** (`layout: "week"`) is the printed *Weekly Program Guide* as
a page: every day of the week down the side (empty days say *Nothing
scheduled*), each program with instructor and time, a venue-coloured edge,
previous/next week and *This week*. Week Starts applies to it as well as the
month. An empty week names the week — and the venue, when filtered.

**Venue key = filter.** Shown when more than one venue is in use (Venue Key
setting); clicking one narrows every layout to it.

**Cancelled dates are shown, struck through and labelled — never hidden.** A
member who saw "Elite, Tuesday" last week needs to see that THIS Tuesday is off.
A single date's note ("Courts resurfacing") and substitute instructor show too.

**Only a venue colours an edge** (`--evt-venue`, set only when an event has a
category). Inheriting the module accent made a venue-less dinner read as a
Tennis Center program.

**Links carry the date.** A repeating program links to
`?event=<slug>&date=YYYY-MM-DD` (`eventPageHref`); the event page then shows
that session's time and instructor, a cancelled banner naming the date, a line
when the rule does not run that day, the rule in words, and the next six dates.

**New settings:** Weekly Schedule layout, Instructor (default on), Venue Key
(default on). `check:render` contract
`event-calendar-weekly-schedule-draws-a-whole-week` — broken on purpose twice
(days in a row; Week Starts ignored) and watched to fail.

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

## The event page (3/3)

`event-detail` renders **whichever event the address names** — it reads
`?event=<slug>`, which is exactly the link the calendar and the manager build.
One page therefore serves every event; there is no page per event to create or
keep in step.

Point the calendar's and the manager's *Event Page URL* at whatever page
carries this module (`/event`, say) and the links join up.

**Which link the calendar builds, and the bug that took three slices to see.**
The site's own event page wins; an event's external `url` is the *fallback*.
It shipped the other way round in 2/3 and looked perfectly reasonable —
"a ticketing page is where the visitor wants to go" — until the event page
existed and could be tested end to end. Nearly every real event has a ticket
link, so preferring it sent every visitor straight off-site and made the event
page unreachable from the calendar it belongs to. With no event page
configured the external link is still better than a dead title, so it stays as
the fallback. The Get Tickets button on the event page is where the external
link now belongs.

**Four states, all designed** (R4), because three of them are what somebody
meets when something is wrong:

| State | What it says |
|---|---|
| no `?event=` in the address | what the page is for, and how to address it |
| loading | "Loading event…" |
| not found, or not published | the operator's own *If Not Found* message |
| found | the event |

A draft never reaches the fourth state: `routes/events.js` 404s anything not
published to a slug read with no session, so an unpublished event is
indistinguishable from a wrong link — which is the correct disclosure.

**The cancelled banner is the point of the `cancelled` status.** A cancelled
event keeps its page and says, at the top, that it is off; it also loses its
booking button, because a page that says "cancelled" above a live "Get
Tickets" button is worse than either alone. Deleting the event instead would
make everyone who diarised it turn up.

**The event's SEO fields are applied to the page showing it** — its SEO Title
becomes the browser title, its SEO Description the meta description, both
restored when the visitor navigates away. Without this those two fields would
be controls an operator fills in that render nowhere at all (Standard 13).

**The description is sanitized** through `formatRichTextContent`, which runs
`sanitizeRichTextHtml` — never raw (Standard 9).

## Not built, and worth a ticket

- **"Add to calendar"** (an `.ics` download, and Google/Outlook links). The
  single most-expected control on an event page, and deliberately left out of
  this slice to keep it shippable. Everything it needs is already on the row.
- **A month grid that lists a day's events on tap** at phone width. Today the
  grid degrades to dots per day below 700px, which says *that* something is on
  but not *what*.

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
