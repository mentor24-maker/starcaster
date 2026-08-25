## 2026-08-23 — The YouTube acquire box works again

On Acquire > YouTube there used to be a box where you pasted one video's link
and got the whole video back — details, transcript, the lot. A redesign a while
back deleted the box from the page but left the code that drives it, so the code
has been reaching for something that is not there. No error, no clue: the
feature simply was not on the screen any more.

It is back, rebuilt as a modern component rather than restoring the old markup —
the old admin code is frozen to bug fixes now, and new screens are built the new
way.

One thing behaves deliberately: the .mp4/.mp3 download needs a separate worker
service that is not switched on yet. When it is missing, you still get the
details and the transcript, and only the file-download part says so, naming
where to turn it on. A missing extra never costs you the part that worked. (#PR)
## 2026-08-24 — Our own tests stop filing bug reports at you (#418)

Three bug reports landed in your queue looking exactly like customer
complaints, and you closed all three by hand and asked what you were meant to
do with them. None of them came from a person. They came from our own test
equipment — a robot browser checking that the bug-report button still works,
and two automated probes checking the site was up.

The awkward part is that those reports arriving *is* the proof the feature
still works, so simply blocking them would have deleted the evidence. Instead
the report is still made and still recorded — it just gets filed closed and
unassigned, with a line saying which machine made it, rather than being put in
front of you.

Deciding "this wasn't a person" is done cautiously on purpose. Getting it wrong
in one direction costs you one interruption; getting it wrong in the other
throws a real customer's bug into a closed ticket nobody reads. So it only
files something as machine-made when it sees something no human browser can
produce, or two separate giveaways at once. One suspicious detail on its own is
never enough.
## 2026-08-23 — Bug reports can now email you, if you ask them to

The bug-report button on a tenant site already saved every report and filed it
in the Loop Queue. Now there is a tickbox on the module — **"Email each report"**
— and when it is on, each report also lands in that project's Support Email
inbox, using the same mail plumbing the Support form already uses.

The interesting part is what the server does NOT trust. That submit address is
open to the public: anyone visiting a client's site can post to it, with no
login. So if the "please email this" flag travelled along with the report, a
stranger could point a client's own website at their inbox and hold the button
down. Instead the server ignores the request entirely and goes and reads the
project's own pages to see whether the tickbox is on.

And if it cannot read those pages, it does not send. "I could not tell" is not
the same as "yes" — the report is already saved and already in the queue either
way, so the safe thing to do with an unanswerable question is nothing, loudly
logged. (#PR)
## 2026-08-24 — The catch-up stops turning green branches red (#420)

Yesterday a change was made so the merge robot stops giving up on branches that
only *looked* like they clashed. It worked — and it introduced a smaller problem
of its own, which showed up last night when it turned three approved, passing
branches red.

Some of our web pages carry a little stamp against each script and stylesheet, so
browsers know when to fetch a fresh copy instead of reusing an old one. When two
branches both change a page, those stamps collide, and we have a tool that sorts
them out automatically. That tool is right when only the page text moved — and
wrong when the script itself changed underneath, because it puts back the stamp
for the *old* version of the script. Nothing rebuilds, and the safety check that
compares the stamps against a fresh build fails.

The real mistake was what the robot treated as permission to push: it asked "did
this merge cleanly?" when the question it needed was "would a fresh build produce
these same stamps?" Those are not the same question.

It now checks whether the merge pulled in a change to anything behind one of
those stamps. If it did, it stops and says exactly what to run, instead of
pushing and letting the safety check discover it twenty minutes later. When
nothing behind a stamp moved — which is most of the time — nothing changes and
nothing gets slower.
## 2026-08-24 — The build robot stops forgetting to fill in a number (#423)

Every piece of work here gets a short plain-English note written for you, and
each note ends with a link to the change it describes. The trouble is the note
gets written *before* that change has a number — so it goes in with a
placeholder, and somebody has to come back and fill it in afterwards.

Three times yesterday, nobody did. Each time the safety check caught it and
turned the build red, which cost a full round of checks and a review that
reported nothing about the actual work.

The check was doing its job. The order of operations was wrong. Filling the
number in was a step that had to be *remembered*, at the exact moment the
interesting work is finished and everything feels done — and a step that has to
be remembered is a step that gets missed.

It now happens automatically, at the one moment the number first exists. It
only ever touches the newest note, so a note belonging to somebody else's
unfinished work is never stamped with the wrong number, and it commits that one
file rather than sweeping up whatever else happens to be sitting in the folder.
## 2026-08-24 — The Table editor is finally being checked (#427)

There is an automatic check that opens every settings panel in a real browser
and measures whether the labels and fields line up in proper columns. It has
been quietly skipping the Table module's row-and-column editor entirely.

Not because anything was wrong with it — because the checker only knew one way
of building a grid, and the Table editor is built the other way, as an actual
table. Trying to enrol it produced "this has no rows", so the only options were
to leave it unchecked or to rebuild a spreadsheet as something it isn't.

The checker has been taught the second shape, and the Table editor is now
enrolled. To be sure that means something, the alignment was deliberately
broken first: the check failed, at all three screen widths, naming the exact
columns that had come adrift. Then it was put back.

Worth saying plainly: the panel was fine all along. What changed is that we can
now tell — before, a green result on this panel was silence, not approval.
## 2026-08-24 — Approved work merges in minutes instead of hours (#424)

When you comment "merge" on a finished piece of work, a robot picks it up and
merges it. Merging one takes about three minutes of actual work: bring the
branch up to date with everything that landed since, run the checks (about
ninety seconds), merge.

It was managing roughly one an hour, and sitting idle for the other
fifty-seven minutes.

The reason was the shape of the thing, not the work. It took two visits to
merge one item: the first visit brought the branch up to date and left, the
checks finished a minute and a half later, and the second visit — an hour after
that — did the merge. A three-minute job took two hours.

That gets worse the more work is waiting, not better: every merge makes every
other waiting branch out of date, so with two dozen queued, each merge creates
twenty-three more to bring up to date. The robot could fall behind its own
previous visit.

It now waits the ninety seconds and finishes the job, rather than coming back
next hour. It waits for a bounded time, for at most a few items per visit, and
if the checks are still running when its patience runs out it simply leaves it
for next time — exactly what it did before. It will never merge something whose
checks it did not see finish.
## 2026-08-24 — The build robot stops piling up work nobody can merge (#425)

There is a safety rule on this project that a branch has to be completely up to
date with the live code before it can be merged. That rule is right — it means
the tests that passed ran against exactly what goes live, and going live here
means going straight onto client sites.

It has a hidden cost, though, and the cost grows fast. Every merge makes every
*other* waiting branch out of date. With two dozen pieces of work waiting, a
single merge leaves twenty-three of them needing to be brought up to date
again — and each one needs its checks re-run. Yesterday the merge robot spent
most of its time refreshing branches that had already gone stale again before
it could use them.

Which means the obvious fix — build faster, run more builders — makes things
*worse*, not better. Work built beyond the rate things can actually be merged
does not arrive sooner. It just sits there going stale, and going stale costs
real work.

So the builder now stops claiming new work once five pieces are already
waiting. It says so plainly and finishes the run normally — this is not an
error, it is the system telling the truth about where the queue actually is.
Five things genuinely in flight is honest. Two dozen half-finished is not.

## 2026-08-23 — "Your approval still stands" is now actually true (#417)

When you comment "merge" on a finished ticket, a robot merges it for you within
the hour. If the branch clashes with newer work, it stops — untangling a clash
by guesswork is exactly how good code gets wrecked — and left you a note saying
your approval still stood and it would go through on its own.

It would not. The reminder the robot wrote to itself, right beside that note,
said "done with this one, never look at it again". So your yes was thrown away
at the moment you were told it was safe. On one ticket you said "merge" twice,
four hours apart, and got the same dead end both times.

Two things changed. Your approval now survives a clash: a person still has to
untangle the branch, but once they do, the next pass merges it on the word you
already gave. And the note you read is now written by the same piece of code as
the reminder the robot keeps, so the two can never again promise different
things — there is a test that walks every message this job can send you and
fails if one says your approval carries over while the other says it does not.

The tickets already stuck this way free themselves; there is nothing to run.
A ticket that really is still clashing now goes quiet rather than repeating
itself hourly, and shows up in the run summary as "unchanged" so a silent pass
still reads as stuck rather than clean.

## 2026-08-23 — The relay stops crying wolf about merge conflicts

Twelve times in one day, the robot that merges your approved work gave up and
said "this branch conflicts with main, a human needs to sort it out". Every
single time, it merged here with nothing to sort out. Each false alarm parked a
merge you had already said yes to.

The cause is a quirk worth knowing. Four of our HTML files carry little version
stamps that change every time anything is rebuilt, so any two branches collide
there even when neither touched a word of the actual page. We wrote a small
tool that fixes those automatically — but git flatly refuses to run a tool like
that from a downloaded copy of a project, for good security reasons, so it only
exists on our own machines. **GitHub cannot run it.** GitHub sees two different
version stamps on one line, calls it a conflict, and the relay believed it.

So the relay now asks the machine it is standing on instead of taking GitHub's
word. It tries the merge for real, in a scratch folder that touches nothing. If
it comes out clean, the branch is caught up and the checks re-run. If anything
genuinely overlaps, it hands over exactly as before — and now says which file,
so nobody has to work that out again.

It still never resolves a conflict, and it still never force-pushes.

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

## 2026-08-23 — Half the modules on a page didn't know which client they belonged to (#401)

A published page is built from rows, and some rows float above the others as
overlays. Every module on that page needs to know which client's site it is
part of — a contact form has to file its enquiry somewhere, a search box has to
search the right site.

The floating rows were told. The ordinary rows were not. The very same module
knew the answer in one position on the page and drew a blank in the other.

It has never caused visible trouble, for a slightly lucky reason: on a real
customer domain the server works out the client from the web address, which
covers for the missing answer. It only shows up where the address does not
name a client — previews, and while working locally — and there the request
just fails. It was spotted while reviewing the Bug Report module, which was
asking the server about a client whose name it had been handed as an empty
space.

The fix is a single line. What took the time was checking it, because this is
plumbing sitting underneath half a dozen modules — the contact form, the client
records form, site search, and the client-facing admin pages — and the ticket
was explicit that the risk lived in the verification rather than the edit.

Reading the whole chain through turned up one thing worth knowing. The
page-serving code lets a web address *name* a client, and that naming wins over
the domain the page was actually reached on. So a hand-edited address can serve
client B's page while still sitting on client A's domain. Today a form on that
page files its enquiry quietly under **A** — B's page, A's records. After this
change the two disagree openly and the request is refused instead. That is the
better outcome, but it is a change in behaviour rather than a pure fix, so it is
flagged for a second pair of eyes rather than buried.

Two of the ticket's acceptance criteria are deliberately left for the review
step: proving it in a browser on a live client page, and exercising each of
those modules there. Both need a running app connected to a real database,
which an unattended build cannot reach for credential reasons — the fourth time
that gap has come up today, and now a ticket of its own.
## 2026-08-22 — the layout checker can finally see the panels it was passing (#389)

The tool that checks every settings panel for a tidy layout could only measure
what was on screen, and most of the test page was blank. A panel that edits a
repeating list — the Feature Cards, the Table of Contents, the breadcrumb trail
— draws nothing at all when the list is empty, so the checker opened it, found
nothing to measure, and reported a confident pass over an empty box. That is
how two visibly broken panels reached you in August with a green run behind
them.

The test page now carries real content in every panel: at least two rows in
every repeating list, every optional block switched on so its hidden controls
actually draw, and one deliberately long piece of text per panel so the "wide
enough for the longest label" half of the rule is tested rather than assumed.
The two CRM panels needed a real form in the test database before they would
draw anything at all, so the setup script now creates one. Net effect: the
checker measures 660 panel columns instead of 648, and 1,065 label-and-field
pairs instead of 1,009 — and, most of the point, the CRM Form panel turned out
to be visibly staggered the moment it had something in it, which nobody could
have seen before.

Also fixed a wrong signpost: when the checker finds no panels at all it told
you to go look at a list of module types that does not exist anywhere in the
codebase. It now names the real thing.
## 2026-08-23 — The relay no longer stops when the chat room does (#414)

Yesterday the whole task pipeline sat still for sixteen hours. Every one of
your answers had been written, read and understood — they were sitting right
there on the tickets — but nothing moved.

Here is why. When you answer a parked ticket, an hourly job reads your answer,
posts it to the party line (the shared chat channel everyone watches), and only
then releases the ticket back to the machines. That last "only then" is
deliberate: a ticket must never move on an answer nobody actually received.
The trouble was that "received" meant exactly one thing — a message landing in
that chat channel — and yesterday ClickUp's chat refused every single message
we sent it, for sixteen hours, then quietly started working again. Twenty-three
comments and five handbacks piled up behind one broken door.

The first explanation was that we had hit a limit on the free plan and needed
to pay. That turned out to be wrong, which is worth knowing: the plan was the
same before, during and after, and chat posts work fine on it. Two commands
proved it once the outage lifted. Paying would have fixed nothing.

So the rule stays and the door moves. The job now tries the party line first;
if chat is down, it writes a short note on the ticket itself instead — "your
answer was read, this ticket is going back to Queued, the party line is
unavailable so this note is the record" — and that counts as delivered. Ticket
comments were the one thing that kept working throughout. The trail says which
route was used, so anyone reading it later can see what happened.

What has not changed is the part that matters: if a message reaches neither the
chat room nor the ticket, it is still undelivered, the ticket still does not
move, and the run still reports a failure. The safety check was re-aimed at a
sturdier target, not switched off. A chat outage is now a line in the report
rather than a stopped pipeline.

A second pass tightened three places where the job was telling small untruths —
which matters more than it sounds, because these messages are what someone
reads at 2am while trying to work out what broke. It used to report "the chat
failed and so did the note on the ticket" even in the cases where it had never
tried writing a note at all, pointing the reader at a problem that did not
exist. It checked its own note had really been saved by looking for the words
it always uses — so an old note left over from a previous outage would happily
vouch for a new one that never saved. And if that check hit a hiccup, the job
forgot it had written the note and wrote a second identical one on the same
ticket. All three now say exactly what happened and nothing more.

The safety rule itself is untouched. It was tested by breaking the chat room on
purpose — pointing the job at a channel that does not exist — on a throwaway
ticket, three times over: chat working, chat broken with a note written, and
chat broken where writing a note would be pointless. Each behaved as intended,
and the throwaway tickets were deleted afterwards.
## 2026-08-23 — The video pipeline's to-do list (#405)

Second of eight pieces in the Studio work. This one is the list that remembers
which videos still need processing, hands each job to a worker, and — the part
that matters — takes the job back if that worker dies.

It keeps its list in a plain file on the Mini rather than in the main database.
That is a deliberate choice with a scar behind it: this list gets written to
thousands of times per video, and on 16 August the main database ran out of its
daily capacity and took every client site offline for two and a half hours.
Nothing precious is stored here — delete the file and the pipeline works its
list out again from scratch.

Two ideas do most of the work.

The first is that handing out a job has to happen in **one** step. Looking for a
free job and then marking it as taken are two separate steps, and two workers
can both finish looking before either one marks — which is how the same video
gets processed twice. Doing it in one motion makes that impossible rather than
unlikely.

The second is that a worker **borrows** a job for a while rather than locking
it. A lock is given up when a program finishes, which is precisely what a crash
does not do — a crashed worker would hold its lock forever. A borrowed job
simply comes back when the loan runs out, with nobody woken up to fix it. That
is the whole point on a machine nobody is watching at three in the morning.

There are two ways a job can go badly, and they are counted separately — which
took a review pass to get right. A job can **fail**: the worker ran it and it
did not work. Or the worker can simply **stop responding**, usually because the
machine went to sleep. The first version counted both together, and that single
number was wrong in both directions at once. A job that crashed its worker every
time looped forever without anyone being told, and four laptop naps could send a
perfectly healthy job to the scrapheap on its first genuine failure.

Now a job that keeps failing waits twice as long before each retry and stops
after five, and a job that keeps taking its worker down with it stops too — on a
separate, more generous count. Either way it stops in a state that **keeps the
reason**, and says which of the two it was, rather than quietly vanishing from
the list.

Worth recording how the test for the "two workers never get the same job" rule
went, because it took three attempts to become real. The first version ran the
two workers one after the other, so the first took everything and the second
took nothing — the test passed for a reason that had nothing to do with the
rule. The second version ran them properly at the same time but failed
unpredictably, because it checked something that genuinely varies. The third
version uncovered an actual bug in the new code, which was then fixed. Only
after that did a passing run mean anything.
## 2026-08-23 — Work handed to you now comes with a link you can click (#404)

You said it on the ecosystem-map task: *"This should include a clickable link I
can click to test... none of the 'How to test' options are clear how I actually
do it."*

The problem was real and slightly embarrassing. A "How to test" section written
by a developer tends to read *run the generator, then open the file in a
browser* — which is an instruction for somebody who already knows where the
generator is. It looks like a finished piece of work, and it quietly hands the
checking back to you at the exact moment the whole point was that it had been
done for you.

Two changes, at the two places it goes wrong.

**When a task is written**, every test step must now be one of exactly two
things: a link you can click, or an exact command to copy and paste with the
result it should print written next to it. Nothing else counts as a step. The
bad shapes are named outright — "open the page in a browser" is called out as
not being a step — because a rule that says "write good steps" is just advice,
while a rule that says "this exact sentence is not a step" is something that can
actually be enforced.

**When work is handed over for you to approve**, anything with a visible surface
has to arrive with a web address you can open. First choice is the temporary
preview site that every piece of work already gets built automatically — it is
the real thing rather than a description of it. And it has to be the *page*, not
the front door: "here is the preview" is no help on a site with 138 pages.
Underneath it, two or three lines of what to look for, written in plain terms.

If there is no link and there should be, the work goes back. And if there is
genuinely nothing to look at — something that runs behind the scenes — it has to
say so in one line, because otherwise you cannot tell the difference between
"nothing to see" and "somebody forgot".

Both halves are held in place by a check that fails if the rule is ever softened
back into a polite suggestion, which is how the previous attempt at this
disappeared.
## 2026-08-23 — Finished branches finally get cleaned up (#396)

Some background. When a piece of work is finished here, GitHub folds all of
its changes into a single entry on the main line — a tidy habit that keeps the
history readable. Separately, a housekeeping command goes round afterwards
deleting the leftover copies of work that has already shipped.

Those two things did not agree, and the housekeeping has been quietly failing
for months. It decided whether a branch was finished by comparing its changes
one at a time against the main line. If the work arrived as a single change, the
comparison matched and the leftover got cleaned up. If it arrived as **two or
more**, the fold left one entry matching none of them individually — so the
housekeeping concluded that none of that work had ever shipped, and left the
leftovers behind. Permanently.

Measured on this repository: **35 branches were sitting in that state, every
one of them finished and merged.** That is the whole explanation for the pile-up
of stale copies. The overview command was equally confused — it was listing 54
branches as unfinished work; the true number is 19.

It now asks three different ways, and one "no" is no longer enough. It compares
the changes as before; it checks whether the files that branch touched still
differ from the main line at all; and it asks GitHub outright whether the work
was merged. Only when every question that can be answered says "not finished"
is a branch left alone. There is also a fourth answer now — "could not tell" —
for when the checks cannot reach GitHub. That leaves the branch alone and says
so, rather than pretending to know.

The second half of the bug was quieter and arguably worse. When the
housekeeping passed a branch over, it printed **nothing at all** — so the
folder that survived four cleanup runs was never once mentioned, and the report
read as "nothing left to do". Every branch and folder it passes over is now
named, with the reason. All the safety rules are untouched: work you have not
committed, a folder you are standing in, and anything it cannot confirm are all
still left strictly alone, and every deletion still writes down how to undo it.
## 2026-08-23 — Abandoned bug-report screenshots now clean themselves up (#398)

When somebody reports a bug on one of your sites, they can attach a screenshot.
The picture has to be uploaded the moment they pick it, before they press Send,
because of a size limit on how much can travel in one go. That works — but it
means anyone who picks a screenshot and then wanders off leaves the picture
behind: a file sitting on public storage, and a row in the database, that
nothing will ever look at again. They accumulate, quietly, forever.

There is now a job that collects them. Once a day it looks for screenshots that
are more than a day old and that no bug report actually points at, and deletes
the file and the record together. You can also run it by hand and it will show
you the list without touching anything, so you can see what it is about to do
before it does it.

The care is all in what it refuses to do. It never deletes a picture some report
still points at, even one where the "attach" step failed and the screenshot was
left looking abandoned. If it cannot read the list of reports for any reason, it
stops entirely and deletes nothing, rather than concluding that everything is
unwanted. It deletes the file first and the record second, so it can never leave
a picture on public storage with nothing left to find it by — and if the file
will not delete, it keeps the record and says so out loud instead of reporting
a clean run. Anything it could not remove is named individually.
## 2026-08-23 — Two checkers can no longer review the same job at once (#391)

The loop has a checking step: after something is built, a separate pass goes
over it independently and says pass or fail. Last night two of those checks ran
on the same piece of work at the same time without either one knowing. They both
did the whole job — wasted effort — and then the slower one stamped its answer on
top of the faster one's. The faster one had said *fail*. What reached the queue
said "ready to merge". It was caught and put right by hand, but only because
somebody happened to look.

Two things changed. First, a checker now puts a visible flag on the ticket
before it starts — "being checked, started 3:41am" — right in the queue list, so
the next one sees it and moves on to something else. (If a flag is more than
about three quarters of an hour old the check clearly died, and the next one is
allowed to take it over and say so.) Second, when a checker writes its verdict
it now has to name the state it thought the ticket was in. If the ticket has
moved since — somebody else took it, or you answered something on it — the
verdict is simply refused, nothing is written, and the checker is told to go
read what actually happened rather than stamp a stale answer over it.

Both were tried for real on a scratch ticket before shipping: refused when the
ticket had moved, refused when the checker forgot to name the state, and allowed
when everything lined up — with the ticket proving that the two refusals really
did write nothing at all.
## 2026-08-23 — Writing down how approvals actually work (#377)

There is now one page, `docs/APPROVALS.md`, saying where you approve things,
what your answer means, and how agents are expected to file so every approval
looks the same.

The first draft of this described building a separate **Approvals** list for
you. Before writing it, we measured what that would cost: the Loop Queue's id
is typed into 18 places across 11 files, every one assuming an approval stays
put. Moving approvals off it means re-pointing all of them and keeping
one-click merge working across two lists at once — an epic, in exchange for a
tab. You chose to write the rules down instead and move nothing, so the page
now describes the surface you already use rather than one that would have to
be built.

Two things in it were worth stating out loud because nothing else says them:
that a **refusal** leaves your approval standing and goes through on its own
once the reason clears, while a **conflict hand-off** spends it and needs a
fresh "merge" from you — and that a ticket with no PR recorded on it can never
merge at all, however many times you approve it.

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
## 2026-08-22 — Every shared block now says what it is (#387)

The Builder lets one section be shared across many pages: you build a menu
banner once, and every page that uses it follows along. The trouble was that
nothing on screen said so. A block header showed a bare "(canonical)" tag, and
sometimes a "Changed" tag beside it, and that was the whole story — it never
said what the block was a copy of, and it never said how many pages an edit
would reach. The only place that lived was in Dane's head.

Each block header now carries a small coloured chip and, under it, one plain
sentence. The chip says one of four things: **Original** (this is the master —
saving it rewrites every page that follows), **Following** (a copy that still
takes updates), **Changed** (a copy someone edited on this page, so the next
push will skip it unless it is overwritten on purpose), or **Independent** (not
connected to anything). The sentence beneath names the master and counts the
reach — `Copy of "2 - Menu Banner" · used on 35 pages` — so the blast radius of
a save is readable before the save, not discovered after it.

This is a read-only change: nothing it adds can alter a page. The chip only
describes state that already existed, and a test pins that promise by failing
if rendering a block header calls a single one of the editor's save paths. The
buttons that act on these states — take the original, disconnect, reconnect —
are the next two pieces of this work.

Two things were found while building it. The block header is dark, so the new
line had to borrow the header's own white rather than the app's normal muted
grey, which was nearly invisible on the teal. And the test fixture had been
storing pages in a shape the server accepts but quietly strips lineage from,
which meant a canonical section seeded for a check came back looking
unconnected — it now writes the shape production actually stores, so a check
over shared sections is measuring the real thing.
## 2026-08-23 — Two instructions that contradicted each other, quietly (#399)

The automated build helper needs somewhere to work. For each task it makes a
fresh, private copy of the project — a separate folder so two jobs can never
tread on each other's files.

Two of our own documents disagreed about where those folders should live. The
guide you read said to start each helper *inside* one of those private copies,
and called that the most important safety rule we have. The helper's own
instructions worked out where to put things by asking "which folder am I
standing in?" Put those two together and every new task folder got tucked
*inside* the previous one — folders nested inside folders, several layers deep
over a long run.

Nothing ever went wrong loudly. Nothing errored, nothing was lost. The work
simply happened somewhere nobody expected, which is the kind of problem that
sits unnoticed for months.

The fix turned out to be short, because a piece of code that answers this
question properly already existed elsewhere in the project. It asks a different
question of git — one whose answer is the main folder regardless of which copy
you happen to be standing in. The helper now uses it, and where you start a
session stops mattering at all.

The guide now says to start them wherever is convenient, and explains why that
is safe: neither helper edits the folder it starts in. Each makes a fresh
folder per task and works there, so the collision the old rule was worried
about cannot happen from that direction. The underlying rule — one folder per
piece of work — is unchanged and still applies to the actual building. It was
never really about where a session is launched from; that was a misreading that
got written down.

Proved rather than assumed: the check builds a real repository with real linked
folders and confirms the answer comes back the same from either place.
## 2026-08-23 — A new work folder can reach a database on its own (#406)

Every piece of work here happens in its own folder — a separate copy of the
code, so two jobs cannot corrupt each other's files. A brand-new folder came up
with no settings in it, and settings are what tell the app which database to
talk to. Without them the app cannot start, cannot log in, and cannot be looked
at. The advice on screen was to copy the settings file over from the main
folder — but that file holds around eighty live passwords and keys, and the
agents doing the building are not allowed to touch those. Correctly so.

The consequence was narrow and expensive. One of our checks opens the site in a
real browser and measures whether the settings panels line up properly. It is
the only check of its kind, because the automatic system that runs on every
change has no browser at all — it simply cannot do it. So the one check nothing
else can perform was also the one check an unattended build could not perform.
It came up on three tickets in a row this week, and fifteen more were queued
behind it.

There is now a single command, `npm run env:local`, that gives a new folder
what it needs: settings pointed at the practice database running on the machine
itself. No real password is involved at any point — the practice database uses
the same publicly-published starter keys on every machine on earth. The three
places that used to tell you to copy the risky file now name this command
instead. Verified by doing it: a fresh folder, one command, and the panel check
ran through all 657 panels.
## 2026-08-23 — A pull request that nothing checked no longer sits there quietly (#393)

Before anything can be merged here, GitHub has to run its own checks on it —
that is the safety net that stops a broken change reaching the live site. Twice
this week a pull request was created and GitHub simply never ran them. Nothing
looked wrong: the page showed no red, no failure, no warning. It just showed
nothing at all, and because the merge step quite rightly refuses anything
unchecked, both pieces of work sat stuck for half an hour until something else
happened to jog it loose.

The suspicion was that the second computer doing the building had the wrong kind
of login and GitHub was ignoring its work. That turned out to be wrong, and it
is worth saying so plainly: of the nine pull requests that machine opened over
two days, seven had their checks running within four seconds. The two that
failed had something else in common — a second small change was pushed about
fifteen seconds after the request was opened, and GitHub lost track of both.

The important discovery is that this never fixes itself. The checks are not
"late"; they were never scheduled, and nothing that waits, retries or reruns
will summon them. The only thing that works is sending up one more change, which
gives GitHub a fresh reason to look. Our own tooling had been advising the
opposite — "this is probably just a delay, try again shortly" — which is why
both cases stalled rather than being rescued in a minute.

So the shipping tool now does that itself: if the checks have not appeared after
a reasonable wait, it sends up a harmless empty change to wake them, once, and
then waits again. If they still do not appear it says clearly that this is no
longer a delay and something is genuinely wrong. The rule a new build machine
has to satisfy, and how to test it in advance, is now written down so the third
machine does not rediscover any of this.
## 2026-08-23 — The menu editor's link list lines up with its own headings (#411)

Open a Navigation module and the bottom half is the list of links — a black
heading bar reading Parent Page / Page Name / Slug / Action, and a row of
boxes under it for each link in the menu.

The headings did not sit over the boxes they name. "Page Name" was fifteen
pixels right of the box beneath it and "Slug" twenty-one, and the drift grew
along the row, so the further right you looked the more the list read as two
things laid on top of each other rather than one table. The cause is the sort
of thing that only shows up on screen: the heading bar and the rows were each
working out their own column widths, from slightly different amounts of space,
so they were never going to agree. They now read those widths from one place,
which is the only way two separate strips can line up and stay lined up.

The mega-menu version had a worse version of the same problem. A menu item
that opens a panel carries a "Feature column" control, and that control was
sharing the line with the item's three boxes — so that one row's boxes came
out shorter than every other row's, its up/down/delete icons floated into the
middle of the list, and the words "Feature column" ran off the right-hand edge
of the panel entirely. It now sits on its own line under the row it belongs to,
and every row in the list is the same shape.

One thing that looks wrong and is not: a nested link still steps in from the
left and its icons still hang past the ones above. That was your call on
2026-08-14 and it is left exactly as it was — it is now written down as a
deliberate exception so nobody "fixes" it later.

The checker that measures these panels could not see this list at all, because
it only knew how to read a form with a label beside every box, and this list
has its labels once at the top. It has been taught the second shape, so the
list is now measured on every run instead of being skipped in silence. Before
believing the pass, the layout was broken three separate ways on purpose and
the checker was watched to fail each time.

## 2026-08-23 — The guard against touching the live branch had a gap (#397)

There is a rule here that an automated helper must never edit files directly in
the main folder — the one wired to the live site. There is a guard enforcing it,
and tonight something slipped past.

What happened: a build session was working in its own private copy, as it should
be. Between one command and the next, its working folder silently reverted to
the main one. The next command used a short filename, so an edit intended for
the private copy landed in the live folder instead. It was spotted immediately
and undone; the folder was clean again within a minute, nothing was sent
anywhere and the live site never saw it. No harm done. **The guard staying
silent is the part worth fixing.**

The reason is almost embarrassing in hindsight. There are many ways to write a
file, and the guard recognised only a few of them. It knew the ones that look
like classic command-line plumbing, and it did not know the one that was used —
a perfectly ordinary way to make a multi-line edit that simply was not on its
list. Nor several close relatives. Each is the same act spelled differently, and
the guard knew only the spellings someone had happened to think of.

That is the second time in one night the same shape of bug has turned up: a
guard built out of *patterns*, protecting a rule that is really about *meaning*.
The other one let an automated helper overwrite branch history despite four
rules forbidding it. Both are now closed.

There was a comic second half. When the problem was written up as a ticket, the
guard **refused to let the ticket be written** — because the ticket quoted an
example of a forbidden command as documentation. It could not tell an
instruction from a description of one. That is fixed too, by paying attention to
who a block of text is actually being handed to: text given to a program is
treated as a program, text being saved as notes is treated as notes. Writing
about a rule should never trip the rule, or people quietly stop writing the
examples down.

One deliberate restraint: the ticket argued for making the guard far more
suspicious — refuse anything that mentions a filename near anything that writes.
On reading the surrounding code that looked like the wrong trade, and it was not
done. There is a second, stronger check that runs before anything can reach the
live site, and tonight's incident is evidence for that arrangement rather than
against it: the damage was zero precisely because that later step never
happened. The specific gaps are closed; the guard has not been turned into
something that cries wolf.
## 2026-08-23 — starcaster.pro wears its own icon again (#409)

You reported that starcaster.pro was showing the favicon of whichever client you
happened to have selected, rather than the Starcaster one.

There are really two websites here. There is your admin app, which lives at
starcaster.pro, and there is each client's published site, which lives on that
client's own domain. Their tab icons should differ — yours should always be
Alphire's, theirs should always be their own — and the two had collapsed into a
single answer.

The admin app was deliberately swapping its tab icon to match the selected
project. That went in back in June, described at the time as showing the icon
"per active workspace", which sounds sensible right up until you notice where
the admin app actually runs: only ever at starcaster.pro. A client's domain is
served entirely different files. So the swap was never correct anywhere — it
simply meant the one tab that should always say Alphire wore whichever client
was open.

It now always shows the Starcaster icon.

Nothing changed for clients. Their sites get their icons by a completely
separate route on the server, and there is now a check exercising that, because
breaking the client side while fixing yours is the obvious way to get this
wrong. Choosing a favicon for a project in Settings still works and still
matters — that picture is what their published site uses. Only your admin tab
stops borrowing it.
## 2026-08-23 — The rule against force-pushing now actually holds (#394)

Some background first. "Force-pushing" means overwriting the history of a
branch — replacing what is stored with a different version, rather than adding
to it. It is the one git operation that can destroy work, so you long ago told
the system never to do it, and wrote four rules saying so.

Overnight, three unattended build runs did it anyway. Nothing was lost — each
one was rewriting its own branch, seconds old, that nobody else had touched.
But the rule not holding is the finding, and the only reason anyone knew is
that all three runs owned up to it afterwards.

Here is why it slipped. Your rules describe commands that *start* with the words
"git push". The way anything in this project actually pushes starts with a
short bit of setup first — a setting that tells git where to find the GitHub
password, which it cannot otherwise reach from an automated session. So the
command began with that setup rather than with "git push", and every one of the
four rules looked straight past it. Nobody invented that as a way around you;
it is simply how this repo has always pushed. The house habit walked through
the house rule.

Three other ways in turned out to be open too, including one where the command
contains no "force" anywhere — a single "+" character does the same job.

The fix stops matching the words and reads the command instead. It takes the
command apart, sets the settings and options aside, and asks two plain
questions: is this a push, and does anything in it overwrite? There is no
wording to word around, so the same gap cannot reopen in a new spelling. It
also refuses even when the rule file cannot be read at all — "I could not
check" must never come out as "go ahead" — and the one switch that used to
quiet these warnings can no longer quiet this one.

The last piece removes the temptation entirely. All three runs wanted to
force-push for the same small reason: they wrote this very log entry, opened
the pull request, then went back to stamp its number into the entry — and
changing something already sent means overwriting it. The build instructions
now say to add the log entry afterwards as its own separate step, with the
number already in hand. This entry was written that way.
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
