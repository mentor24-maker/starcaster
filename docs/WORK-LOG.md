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

## 2026-08-23 — Shared blocks on older pages had quietly forgotten they were shared (#402)

A block you save once and reuse across the site keeps a note of where it came
from. That note is what lets the Builder tell you a block is a copy, name the
original, and warn you that saving it will reach every page following it.

Pages are stored in the database in two slightly different arrangements — a
newer one, and an older one still used by pages built some time ago. Both open
and display identically, which is exactly why nobody spotted this.

Opening a page temporarily sets a few of those notes aside and then puts them
back. The code doing the putting-back recognised the newer arrangement and not
the older one. So on an older page it quietly put nothing back at all.

The page still opened. Every block was there, and looked right. They had simply
lost all memory of being copies — so a shared block appeared as a standalone
one, and its header cheerfully promised that saving it would affect nothing
else, at the exact moment that saving it would have reached every page
following it. A confident, wrong answer, which is worse than no answer.

Nothing was lost on disk; the notes were always in the database. They just were
not being read on the way in. Older pages now read the same as newer ones.

The alternative was to make the system reject the older arrangement outright and
say so loudly. That was considered and rejected: those pages exist right now,
and refusing them would have turned a quiet problem into customer sites failing
to open. Better to read both properly.

Found while reviewing the block-state chips shipped earlier today, which is a
pleasing sort of catch — the feature that tells you how far a save reaches
turned up a case where the underlying data had stopped saying.
## 2026-08-23 — Groundwork for downloading a YouTube video, not just reading it (#392)

The Acquire screen can already pull a YouTube video's title, description and
transcript. What it has never been able to do is keep the video itself — the
.mp4 and the .mp3. That work was written back in July and then sat on a shelf
as one large piece: a screen, a download service, a database change and a
deployment, all tangled together. It has now been split into four smaller
pieces that can each be finished and checked on their own. This is the first
of them.

This piece is the plumbing behind the screen, and it deliberately does nothing
visible yet. It adds the two web addresses the screen will call — one to start
a download, one to ask how it is going — plus a new entry under Settings >
APIs where the download service's address and password will eventually go, and
the database change that will remember where each finished file ended up.

The important part is what happens while the rest is still missing. Asking for
a download today gets a plain "the media worker is not configured — add its
URL and shared secret under Settings > APIs" rather than an error page or a
spinner that never stops. Adding the video's files to an ordinary acquire is
opt-in, and if that half fails it is reported alongside the title and
transcript rather than throwing them away — you keep what you already paid
for. And because the database change has not been run yet, the code treats a
not-yet-existing column as "cannot save this, carry on" instead of letting it
break every other thing the video list does.

Still to come: the screen itself, the download service, and then running the
database change and deploying — that last one needs Dane's hands, because it
involves a password only he should ever see.
## 2026-08-23 — The job that listens for your answers moved to the machine that stays awake (#410)

When you reply on a ticket, a job called the relay is what carries your answer
forward — it reads your comment, posts it to the party line, and hands the
ticket back to the machines so work resumes. It is the only automatic path from
"Dane replied" to "the loop carries on".

That job was running on the laptop. The laptop closes. So on the morning of the
23rd you answered two tickets at 06:19, and at 15:30 both were still sitting in
"Needs your input" — one of them with every blocker already cleared. Nothing had
broken and nothing had errored. Your answers had simply landed somewhere nothing
was listening.

The relay now lives on the Mac Mini, which does not close, alongside the two
loops that were moved there for the same reason last week. It still runs in
exactly one place — two copies would post your messages to the party line twice
— and the register that decides which machine that is now records why, so the
next person to wonder does not have to work it out from scratch.

Two smaller things came with it. The schedule used to exist only as something
somebody had typed by hand on one Mac, written down nowhere, so "is it still
running on the old machine?" could only be answered by going and looking; there
is now a single command that installs it, removes it, or reports what it finds.
And because nobody sits at the Mini, nothing there was ever pulling down new
code — the relay now brings its own copy up to date before each run, carefully,
never touching work in progress.

---

## 2026-08-22 — You now see what a change looks like, without checking anything out (#379)

Until today, if a piece of work changed how a page *looks*, the only way to
judge it was to check out the branch, start a server and open a browser. That
is a real ask, so in practice it did not happen — and nothing else could catch
it, because none of the automatic checks here can tell a page that looks right
from one that does not. They test wiring, not appearance.

There is now a command that takes the pictures for you. It builds the site
twice — once with the code as it stands on the live branch, once with the
change — photographs six representative pages through both, and compares them
pixel by pixel. Any page that came out different gets attached to the ticket as
a before-and-after pair, so the question waiting for you is simply "does this
look right", answerable from your phone.

If a change alters nothing you could see, nothing is attached and nothing
interrupts you. That is the half worth stating plainly: it stays silent by
default, and only speaks when there is genuinely something to look at.

Two details that decide whether the thing is trustworthy. The comparison has no
"close enough" — one differing pixel counts — because a tolerance would hide
exactly the changes worth a human eye: a border that lost a hair, a colour two
shades off. And before it compares anything, it photographs the same page twice
against identical code and demands the two shots be perfectly identical. If
they are not, it reports nothing at all rather than showing you differences
that were never real.

---

## 2026-08-22 — Rows can split into four, five, or six equal columns (#TBD)

The Builder could split a row into up to three columns; now it also offers
four, five, and six equal columns, chosen from the same row-layout control.
Existing pages are untouched — the new layouts are additions, not changes to
any current one. The automated render check was taught to measure a whole
row's column layout (it could only look at single modules before), and it now
verifies a four-column row actually lays out four equal columns; breaking the
layout on purpose makes it fail, so a future change cannot silently collapse
the grid.

---

## 2026-08-22 — See what the loop queue is actually doing, at a glance (#370)

The task list showed which stage each item was in, but not whether the
pipeline was alive, when it last moved, or what it would pick up next. Now the
loops write a plain-language "Loop note" on each ticket as it moves — "building
— claimed 10:12am", "PR open — waiting for a review pass", "verified — waiting
on Dane to say merge", "returned to the line with notes", "live 8/20" — and a
pinned "Loop heartbeat" ticket carries one line per pass ("pass finished
10:48am — 33 in line, next up: …"). An untouched ticket stays blank, which
reads correctly as "waiting in line". It is one write per real move, never a
rewrite of the whole queue. One 30-second ClickUp setup step is needed first
(create a "Loop note" text field); until then the loops say so plainly and
keep working. Wording lives in one tested place so two loops can't phrase the
same move two ways.

---

## 2026-08-22 — Three jobs that must never run twice now refuse to (#383)

There are two machines now, and that is only an improvement if both of them
know which work is theirs. Three jobs break badly if two machines do them at
once, each for a different reason. The bus relay would read "this message has
not been passed along yet" on both machines in the same minute and pass it
along twice. `db:refresh` spends Supabase's disk-space budget, and there is one
budget for the whole company — spending it twice in a day is what took every
client site down for two and a half hours on 17 August. And the build loop
claims a ticket by reading its status, checking it, then writing a new one;
that is safe with one machine doing it and a coin-flip with two.

Until now the only thing preventing all three was a person remembering a rule
before typing a command. This adds a small table, kept in the code where it can
be reviewed like anything else, saying which machine owns which job — and every
one of those jobs now asks that table before it does anything. Ask it yourself
with `npm run node:whoami`. Handing a job to the other machine is a one-line
change to that table, which means it happens as a reviewable commit rather than
as a setting quietly flipped on one machine.

The important detail is what happens on a machine the system does not
recognise. It does **not** quietly skip the work — it stops and says so. "Some
other machine is handling this" and "nobody is handling this" look identical
from the inside, and only one of them is safe; the difference between them is
the whole point.
## 2026-08-22 — `npm run doctor` now catches canon nobody can see (#378)

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

## 2026-08-22 — `npm run map` stops calling a brand-new folder rubbish (#375)

Set up a new workspace with `npm run thread`, then read the map from the main
folder, and the map said the folder you had just built was *"already shipped,
safe to delete."* Nothing had shipped — the branch was seconds old with zero
changes in it, and the folder held a fresh install and a full build, several
minutes of work.

The map has three things it can say about a branch, and it picked the right one
here: "this branch has no changes of its own." It just described that state in
English as "shipped", and only got the wording right in the one case where you
happened to be standing inside the folder it was talking about — which is
almost never, because you make the folder from the main folder and then read
the map from the main folder.

Now it says what is actually true: *"a prepared workspace — nothing committed
yet, nothing to ship."* No wording anywhere calls a zero-change branch shipped
or safe to delete. Branches whose work really is live still read "already live,
safe to delete", which is correct and unchanged.

Worth saying plainly: `npm run tidy` was never in danger of deleting one of
these folders — it has always refused to touch a branch with no changes, on
purpose. This was the report lying, not the cleanup misbehaving. But the map is
the thing you are told to read before starting a piece of work, so it is the
thing that was giving bad advice. A test now builds a throwaway repository with
one empty branch, one already-shipped branch and one branch with live work in
it, and fails if the map ever again calls the empty one shipped.
## 2026-08-22 — Three picture animations that were built but hidden are now on the menu (#369)

The Image module has a dropdown of movements a picture can make — Bounce,
Spin, Cruise, Tumbleweed. Behind the scenes there were five more that had been
fully written years ago and simply never added to that list, so the only way to
use one was to hand-edit a page's saved settings. Dane went through them and
picked three to bring out: **Slide** (crosses the page), **Axis Rotate**
(turns on the spot like a card revolving on a string, so you see its edge and
its back) and **Flips** (turns and hops in place at the same time). He
deliberately left **Cartwheels** out — it is Tumbleweed under a different name
— and **Parkour** is a bigger job of its own, still to come.

Bringing Slide out then showed that **Cruise was the same animation under a
second name** — the two were identical down to the last line of styling. Dane's
call: "wherever you see Cruise, consolidate it into Slide." So the menu now
offers Slide and no longer offers Cruise. Any page already using Cruise keeps
working exactly as before and needs no attention — the old name quietly points
at Slide wherever it turns up. Nothing on a live site changes; there is simply
one fewer thing on the menu that did the same job twice.

Two things needed real work rather than just flipping a switch. Axis Rotate is
the first thing on the site that turns on a *different axis*, which needs the
browser to be told to draw depth — without that it reads as the picture being
squashed side to side rather than turning. And Flips had to turn and hop at the
same moment; Tumbleweed does that using a hidden extra layer, and it turned out
Flips does not need one, because the layer only exists to make room for the
travelling motion Flips does not have. Each of the three now takes the existing
Speed, Rotation Rate, Bounce Height and Direction controls, so there is nothing
new to learn.

Round-3 review fixes: the Frequency dropdown now shows bare counts (it read
"per crossing", which is wrong for Flips, which counts hops per turn), and the
Slide effect on a floating image no longer loses its position and size — old
leftover layout rules were forcing it to the far left and full width.

After review, the automated visual check was strengthened. The general check
only asked "is anything moving?", which could not catch a real hazard: the old
retired animations still sit in the regenerated stylesheet under the same
names, so if a new effect's real rule ever broke, the picture would keep
moving on the OLD rule — ignoring every setting — and the check would stay
green. Each of the three effects now has a check that names the exact
animation it must run; breaking the rule on purpose makes that check fail
(proven), so a future stylesheet regeneration cannot silently gut them.

A second review round then caught something worse, and it is worth
understanding because it is the kind of fault that hides in plain sight. All
three new effects were animating perfectly — and every one of their settings
was being thrown away. The operator could open Slide, choose a Speed, save it,
watch the toast say it saved, and the picture would carry on at its built-in
speed forever. Same for Axis Rotate's Rotation Rate and all three of Flips'
controls. Seven dead controls, no error anywhere, and a picture moving on
screen the whole time, which is precisely why every check stayed green.

The cause was two halves of the program disagreeing. One half decides which
controls to SHOW for a given effect; a second half decides which ones to KEEP
on the way to the page — and the second half worked off a hand-written list of
effect names that the three new ones were never added to. They now read the
same rule, so showing a control and honouring it can no longer come apart, and
the next effect added cannot repeat it.

Two new safety nets went in behind that, both broken on purpose first to prove
they can actually fail: a test that checks every effect on the menu keeps
exactly the controls its own panel offers, and four browser checks that move a
real slider on a real page and fail if the picture does not change. That second
kind matters most — the previous round's checks all asked whether the picture
was moving, and the answer was yes the entire time it was ignoring everything
it was told.

One thing worth knowing: **Slide and Cruise are the same movement.** Nothing is
wrong with either, and both work — but a picture set to Slide and a picture set
to Cruise will look identical and offer identical settings, which is exactly the
reason Cartwheels was left out. Whether Slide stays on the menu is Dane's call;
removing it later is a one-line change.
## 2026-08-22 — Three ways an approved ticket quietly never shipped, closed (#388)

Saying "merge" on a ticket now actually merges it, which works — but clearing
the backlog on 2026-08-22 turned up three ways your approval could sit there
doing nothing while everything looked fine. All three were bookkeeping: the
work was built, reviewed and approved, and still did not ship.

**One: a refusal used to be permanent.** When the merge step couldn't act — say
the ticket didn't name its pull request — it explained why once and then never
looked at that ticket again, even after the reason was fixed minutes later. Two
tickets went quiet that way and only a hand audit found them. A refusal is now
re-checked on every pass: the moment the reason goes away the ticket goes
through, with no second word from you. While the reason still stands it says
nothing, so nothing gets noisier. The refusal message now says this out loud
instead of reading like a report you have to act on.

**Two: the trail from ticket to pull request was written down but not
enforced.** Four approved tickets had no record of which pull request they were
about, so the merge step rightly refused to guess; two of those pull requests
also carried no link back to their ticket, leaving the two matchable only by
reading titles. Recording the pull request is now a command that checks the
link runs both ways and re-reads its own writing through the merge step's eyes
— if it can't be read back, the build run fails then and there rather than
handing over a ticket that will stall later.

**Three: two tickets reached "Ready to launch" without ever passing review.**
That status is your safe-to-merge signal, so you approved both in good faith.
Recording the review verdict is now a command too, and the two places a loop
can set that status both refuse it unless a passing verdict is on the ticket.
(The ClickUp website and the ClickUp connector can still set it directly —
nothing in this codebase can reach those, and that is written down where the
next person will look.)

---

## 2026-08-22 — Editing on main is now blocked whichever way you do it (#372)

The rule "don't work directly on the main branch (it deploys straight to the
live site)" was only enforced for the Edit tool — files written through the
terminal (heredocs, small scripts) slipped straight past it, which is exactly
how a whole feature landed in the main folder by accident on 2026-08-20. Now
three things cover every path: committing on main is refused outright with
plain instructions for moving the work to a worktree (the real backstop —
everything ends in a commit); `npm run doctor` reports when the main folder
has stray uncommitted changes; and the terminal is watched for commands that
write source files while on main, blocking them early (best-effort, and it
stays out of the way when you're properly in a worktree). All three respect
the same ALLOW_MAIN_EDITS=1 override for a deliberate one-off. (After review: the terminal check now judges the folder the command actually runs in, so it never trips on legitimate work inside a worktree.)

---

## 2026-08-22 — Tickets stop burying the ask in the narrow column (#385)

ClickUp shows a ticket's description on the left, wide, and its comments on the
right, narrow. The loops had that backwards. The left column held a spec written
for a machine, and everything meant for Dane — the reasoning, the risk, the
question — went into a comment, arriving as a wall of text in the skinniest part
of the screen.

Two tickets stalled on it the same day. On one, a long comment offered three
ways to slice the work; Dane picked the smallest and safest, but the ticket went
back into the build queue still carrying its original full scope, so the next
unattended pass would have built the risky half he had just deferred — the part
that rewrites roughly thirty-five live customer pages in one motion. The other
sat in his inbox for a day under a red "needs your input" badge with no question
anywhere on it. It was never waiting on him; it was waiting on the first ticket.

Now the detail goes on the left, and the right column carries one short card
with three fixed parts: his own words that caused the ticket to exist, the
problem and the fix in fifty to a hundred words of plain English, and the
specific ask under a banner he can find without reading. The word range is
checked rather than suggested — too short stops being useful, too long is the
wall of text this replaces. Handing a ticket to Dane is now a single command
that posts the card and moves the status together, so a ticket can no longer
land in his inbox with nothing on it to answer.

---

## 2026-08-22 — Saying "merge" on a ticket now actually merges it (#371)

When a piece of work has been built and independently reviewed, it waits in
`Ready to launch` for Dane to say go. He says go by replying **merge** on the
ticket — and until now nothing was listening. On 2026-08-20 three tickets he
had already approved sat unmerged for hours, purely because no session
happened to be open to notice. The approval was never the bottleneck; the
waiting after it was.

The hourly job that already carries his comments to the team chat now also
acts on that one word. If the whole comment is `merge` (or `merge it`,
`ship it`, `approve`), it checks — every time, freshly — that the ticket is
still `Ready to launch`, that the comment really is his (matched on his
account id, so an agent typing "merge" is ignored), that the last review
verdict was a pass and his go-ahead came after it, and that the pull request
is open, has all its checks green and does not clash with newer work. Only
then does it merge, close the ticket as `Live`, and say so on the chat. A
sentence like "merge after the other one lands" is just a comment; it takes
the bare word to act.

Two refusals matter most. If the branch has fallen behind the main copy of
the code, it catches it up and waits for the tests to re-run rather than
merging on a result that no longer describes the branch. If it genuinely
clashes with newer work, it stops dead, explains on the ticket that a session
needs to sort out the overlap, and leaves everything exactly where it was — a
script must never untangle that blind. Every other refusal is written on the
ticket in plain English with the reason, once, never twice.

Nothing about who decides has changed: the merge is still his, and no loop
can approve its own work. What changed is that his decision no longer has to
wait for someone to be watching.

## 2026-08-22 — The code stops assuming it lives on one particular laptop (#368)

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

## 2026-08-18 — Closing a task now cleans up its thread too (#344)

Starting a new piece of work (`npm run thread`) creates its own folder and
branch; finishing it normally cleans both up automatically once the work
ships. But if a piece of work gets abandoned or redirected instead of
shipped — the ClickUp task closed without ever merging — nothing ever
noticed, and the folder sat there forever. `npm run thread` now requires the
ClickUp task it's for, and stamps that onto the branch; closing that task
(even with unfinished work on it) now lets the next cleanup remove the folder
and branch the same way finished work already gets removed, with the same
restore-log safety net. Starting a thread without an open task to point at no
longer works.
## 2026-08-18 — A tool that notices when ClickUp and GitHub disagree (#345)

A task can end up saying "in review" or "building" days after the work
actually shipped and merged — nobody moved it, so it just sits there looking
unfinished. A new command, `npm run reconcile`, checks every in-progress
Loop Queue task against the GitHub pull request it's linked to: if that pull
request already merged, the task gets moved to Live automatically. It
defaults to a dry run that only prints what it would do; nothing changes
unless you ask it to. It also checks for the reverse problem — a work folder
still sitting on the machine after its task closed without shipping — though
that check can only cover folders started after this same session's earlier
piece (Task-closes-thread, PR #344) began tagging them. It's not on a
schedule yet; that's its own upcoming piece of work (the Mac Mini setup).

After review, several ways it could quietly give the wrong answer were closed:
it now trusts the NEWEST pull request a task links (a reworked task carries an
old, dead link too), treats a pull request that was closed WITHOUT merging as
drift to flag rather than "fine", reads a task's whole comment history rather
than only the newest page, and never moves a task out of one of your own
statuses ("Needs your input" / "Ready to launch") on its own — it flags those
for you instead. Status moves now go through the same verified path everything
else uses, and a flagged problem is posted to the bus once, not on every run.
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

## 2026-08-18 — Bug Report 4/5: the button visitors actually click (#365)

Fourth of five pieces of the in-app Bug Report tool, and the first one
anyone can see: a "Bug Report" module in the Builder. Drop it on a page and
a small bug icon floats in a corner of every visitor's screen; clicking it
opens a popup where they describe the problem, attach screenshots (when that
piece is live), and send — then a short thank-you and the popup closes. The
module's settings choose who can see the icon (everyone, signed-in clients,
or staff only), which icon and how big, which corner, its colours, an
optional label, and the popup's words. Behind the scenes the icon floats
from the very top of the page rather than from inside its column, because
a column's styling can quietly pin a "fixed" element to the wrong spot — a
trap this site has already fallen into once. Hiding the icon is a
convenience, not security: the server re-checks who is signed in before it
trusts any claim.

Review caught one real problem before this shipped, and it took four rounds
to kill properly. The module worked out whether it was on a real published
page by looking around at the page it had landed in — but at the instant it
asks, the page around it does not exist yet, because the browser builds the
whole page in memory and only puts it on screen afterwards. So the answer was
always "no", and for a single frame every visitor — including one who should
never see it — got a flash of a staff-only "Report a problem" button sitting
in the middle of the text, which then vanished and jumped to the corner. The
fix stops it guessing: the page now simply tells the module where it is. The
tests were part of why this survived three rounds — they had been building a
fake page shape the real site never has, so they cheerfully passed on the
broken code. They now build the real shape and check the very first frame a
visitor would see. One small extra: the "who is looking at this?" request now
has the same rate limit as its two neighbours, so nobody can hammer it.
## 2026-08-19 — The loop queue can now carry work for more than one repo (#366)

The build/review loops assumed every task was starcaster work and always built
in the starcaster folder. Now a task can say which project it belongs to — by
carrying a `repo:` tag (`repo:normie`, `repo:pulse`, `repo:vault`) — and the
loop builds it in that project's folder and runs that project's checks instead.
A task with no tag is treated as starcaster exactly as before, so nothing
already in the queue changes. A tag naming a project the system doesn't know,
or two different project tags on one task, is never guessed at: the task is
handed to Dane to sort out rather than built in the wrong place. The task list
(`npm run clickup -- queue`) now shows a project column so it's visible at a
glance. This is the plumbing only — no actual non-starcaster work is built here.

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
