# Work Log

Plain-English record of work shipped through the development loop
(spec → build → review → merge). Newest first. One entry per merged pull
request, written for a non-programmer: what changed and why it mattered.

This file is maintained automatically — each task's PR adds its own entry as
part of the change, so the log lands on `main` at the same moment the work does.
See `docs/LOOP_ENGINEERING.md` for how the loop works.

**Scope:** loop-shipped work only. Work done by hand in a normal session is not
here — so a quiet stretch in this log means the loop was idle, not that nothing
was built. The log starts when the loop did.

---

## 2026-08-22 — `npm run doctor` now catches canon nobody can see (#TBD)

The vault holds the project's canon, but two ways it can silently go wrong had
no detector: canon written and committed locally but never pushed (so HQ can't
see it), and signed doctrine citing a doctrine file that doesn't exist (the
quota-doctrine gap that went two days unnoticed). A new read-only check —
part of `npm run doctor` and a standalone `npm run check:vault-drift` — reports
both in plain language, each with its one-line fix. It never writes to the
vault, and a machine without the vault (a worktree, CI) is told "can't check"
rather than a false all-clear. Run against the real vault on day one it already
found one uncommitted change waiting to be committed.

---

## 2026-08-22 — The code stops assuming it lives on one particular laptop (#PR)

Thirteen files had a folder path typed into them that only exists on Dane's
MacBook. That is fine right up until the same code runs somewhere else — on
the Mac Mini that folder is simply not there, and the failure it produces is
the worst kind: nothing errors, nothing is logged, the job just quietly does
nothing and reports success. The file that mattered most was the instruction
sheet the build loop follows, which is precisely the thing the Mini was bought
to run.

Every one of those paths is now worked out at the moment the code runs instead
of being written down in advance. A new check refuses any future commit that
types one in, and it runs as its own step so it can actually fail a build
rather than just printing a warning nobody reads. Six old one-off scripts from
finished jobs were filed away into an archive folder while we were in there.

Nothing about the app changes for anyone using it. What changes is that the
system can now be run from more than one machine, which is what lets work
continue overnight while the laptop is closed.

## 2026-08-18 — Undoing a shared-section push, from any later visit (#342)

When editing a section that's shared across many pages, saving it rewrites
every page that uses it — sometimes dozens at once. The server-side pieces
to undo that as one action already existed, but the only button for it lived
in a banner that appeared right after you saved and vanished the moment you
dismissed it or reloaded the page. If you came back later — a different
session, a different day — there was no way to trigger that undo at all,
only to restore each affected page one at a time. Page History (the panel
that shows a page's past versions) now carries its own "Undo this update"
button on any row that came from a shared-section push, so that undo is
reachable any time, not just in the moment right after saving. Nothing about
the existing per-page Restore button changed.

## 2026-08-18 — A shared section can no longer silently swallow a local edit (#343)

Shared sections (the same header, footer or banner reused on many pages) work
by staying linked to a master copy — save the master, every linked page
follows. Until now, a page that had been hand-edited directly while still
linked looked completely identical to an ordinary linked page, so a routine
master edit would silently flatten it along with everything else. Now the
Builder can tell the difference: a page whose copy has drifted from the
master shows a "Changed" badge, a master save skips those pages by default
and says so before you click ("34 pages will update, 2 have local changes and
will be skipped"), and after saving there's a one-click way to overwrite them
anyway if that's really what you wanted. Nothing about an ordinary push
changed for the 34 pages that hadn't drifted. After review, the "overwrite
anyway" button was tightened: it now rewrites only the pages that were
skipped (it had been re-pushing every linked page to overwrite two), it
reports the true count and offers the undo it had been forgetting to offer,
and an overwritten page is described as overwritten rather than "skipped".

## 2026-08-21 — Bug Report 2/5: screenshots for bug reports (#362)

Second of five pieces of the in-app Bug Report tool. A visitor filing a bug
can now attach pictures: each screenshot is sent on its own (the hosting
platform caps a single request at a few megabytes, so five big images can
never travel together), checked by its actual contents rather than its file
name — so a program renamed to look like a picture is refused — capped at
3 MB each (the largest that reliably survives the hosting platform's upload
limit) and five per report, and stored through the same image pipeline the
rest of the site uses. The report then lists its pictures by id and links to
each one. Still no button anyone can click — that is piece four.

After a security review, the way a picture gets attached to a report was
rebuilt: each upload now hands back a secret token, and a report can only
attach a picture whose token it holds — so a visitor can't guess at picture
numbers and collect screenshots someone else uploaded. Attaching is
one-time, all rejections read the same (so nothing leaks whether a picture
exists), the pictures are kept out of the site's normal image library, an
upload that fails to record deletes its own leftover file, and a truly
abandoned upload is left for a scheduled clean-up filed as its own task.

## 2026-08-18 — Bug Report 3/5: every report lands on Dane's desk in ClickUp (#364)

After review, the fail-safe was hardened: when a forwarded task lands in the
wrong status the code deletes it — and now it CHECKS that the delete actually
worked. If the delete fails, it says so loudly and names the task still
sitting in the queue, instead of falsely reporting it was removed. Every
ClickUp call now times out rather than hanging the person filing the report,
an empty-bodied task is caught, and a task that was created but couldn't be
verified is named in the log so it can be found.

Third of five pieces of the in-app Bug Report tool. Until now a submitted
bug sat in the database where nobody looks. Now each one is also filed as a
ClickUp task in the Loop Queue — in "Needs your input", assigned to Dane's
own account, tagged with the site it came from — with the description, the
page, who reported it and links to any screenshots. Two things are built in
as guarantees rather than settings: the task can only ever land in that
held status (if ClickUp puts it anywhere else, the code moves it once and
otherwise deletes it, so public text can never reach the automated build
loop), and ClickUp being down or misconfigured never costs the reporter —
the report is saved first, the row is marked as "could not forward", the
failure is logged loudly, and the visitor still gets their thank-you. Needs
one server setting (CLICKUP_API_TOKEN) and a redeploy before it works live.

---

## 2026-08-18 — A place for visitors to report a broken page (#341)

First of five pieces building the in-app Bug Report tool. This one is
plumbing only — no button anyone can click yet (that's a later piece) — but
it lays a safe place to send reports to. Any tenant site can now POST a bug
report (what's wrong, what page, who reported it) to a new endpoint, which
checks the report isn't spam, isn't absurdly long, and isn't falsely claiming
to come from a signed-in staff member before saving it. Each report is kept
strictly to the site that reported it, matching the rule every other table
in this database follows. Nothing changes yet for anyone using the app.
After review, one hole was closed before launch: a request arriving through
the platform's own address (rather than a tenant's domain) could name any
project it liked — even a made-up one — and have its report filed under that
name. The endpoint now checks the named project really exists before saving,
and refuses otherwise.

---

## 2026-08-18 — Urgent is now yours alone to hand out (#347)

The task queue is sorted so the most urgent, oldest work is always done
first — which only works as a way for you to jump the line if nothing else
can also mark something Urgent. Loop tasks now file at High or below by
default, and an agent trying to set something to Urgent gets refused with a
plain explanation, unless it can point to you having actually asked for it.
Nothing about how the queue itself sorts or how tasks get claimed changed —
this only closes off who is allowed to reach for the top priority.

---

## 2026-08-18 — Test coverage for the "no more polls" message picker (#348)

The small piece of code that decides what message a player sees when
they've run out of polls to answer (wrong category, ran out of preferred
categories, none published at all, etc.) had no test coverage. Added tests
locking in that every one of those seven situations shows its own message
rather than a blank or a generic one, and that an unrecognized situation
still shows something sensible instead of nothing. No behavior changed —
this only makes sure the existing behavior can't quietly break later.

---

## 2026-08-18 — Shipping cleanly no longer LOOKS like it broke (#346)

Merging a finished piece of work with `npm run ship` was printing a scary
red error at the very end, even when everything genuinely worked — the
error came from a GitHub tool trying to also switch this computer's local
copy off the branch it just deleted, which never works from the kind of
folder every piece of work here happens in, and never mattered anyway,
since a separate step already handles that cleanup properly. That tool call
is now told to skip the part that always failed and never did anything
useful. A successful ship now looks like what it is — clean — and, just as
important, still reports a real failure honestly when one actually happens.

---

## 2026-08-18 — Test coverage for the gallery badge helpers (#351)

The Media Gallery module marks certain images as "badges" — reward symbols —
either through an explicit flag on the item or through a media type label
(current or an older, legacy spelling). This adds tests locking in that
detection: the canonical and legacy labels are both recognized (whitespace
and all), an empty or blank type resolves to "no opinion" rather than false,
and an item counts as a badge if *either* its flag or its media type says so.
No production code changed — this is test coverage only, written against the
existing helper functions in `lib/builder-client/gallery-media-badge-type.ts`.

---

## 2026-08-18 — The loops get their own door into ClickUp

The build and review loops used to reach ClickUp through the claude.ai
connector, which has a shared usage allowance that every agent session drains
together — when it ran out, the loops went blind and work stopped, twice in two
days. Now the loops talk to ClickUp directly (`npm run clickup`) using the
project's own key, kept in the Doppler vault and never seen by any agent. The
new commands cover the whole loop: list the queue sorted so the first line is
always the right task to take, claim a task safely so two loops can never grab
the same one, read a task and its comments, move statuses with the handoff to
Dane handled automatically, and comment — every write verified by reading the
result back, so a save that silently didn't stick is impossible to mistake for
a success. Also fixed a trap where the skills wrote down the Starcaster *space*
id where the Loop Queue *list* id belonged, which ClickUp punishes with an
unrelated-sounding "Team not authorized" error — the ids now live in one
place, `docs/LOOP_ENGINEERING.md`.

## 2026-07-28 — Safety check for "local dev mode" detection (#52)

Added automated tests around the small piece of code that decides whether the
app is running on your local machine versus the live site. The logic itself
didn't change — the tests just lock in its behavior so a future edit can't
break it silently. First real task run through the development loop as a test
flight. No visible change to any website.

## 2026-07-28 — Set up the development loop (#51)

Built the "loop" system that lets AI agents pick up small tasks, build each one
in isolation, check it, and open it for your approval — the spec → build →
review workflow. Adds three reusable skills plus an operator guide
(`docs/LOOP_ENGINEERING.md`). Nothing about the live product changed; this is
the machinery we now use to ship the work below.
