## 2026-08-26 — Checking the new merge lock before trusting it (#444)

Yesterday's work put a lock on the door: an automatic check that refuses to
merge a pull request unless its ticket carries a passing review of the code
actually being merged. The lock is fitted but not yet switched on — that is a
setting only you can tick — so right now it announces its answer and lets
everything through regardless.

Before flipping a switch like that, it is worth going over the lock itself, so
this pass did. Four things were wrong with it. None of them can do any harm
today, precisely because it is not switched on yet, but every one of them
becomes real the moment it is.

The serious one: the lock finds the ticket by taking the first ClickUp link in
the pull request's description, and nothing checked that it was the right
ticket. A description that mentioned some related ticket before its own would
have been checked against **that** ticket's approval — and would have been let
through if that other ticket happened to have a recent one. A lock that opens
because it read somebody else's paperwork is worse than no lock. It never
actually happened, but only because our automatic builder happens to always put
its own link first. That is a habit, and habits are the exact thing this lock
exists so we stop relying on. It now confirms the ticket it read really is
about this pull request, and says "I cannot tell" rather than yes when it
cannot.

The other three were smaller and quieter. Two of our commands disagreed about
what counts as naming a ticket, so a description one of them called perfectly
fine would be rejected by the other with a message saying the opposite of what
you could plainly see — they read the same piece of code now, so they cannot
disagree again. The lock's own messages happened to be worded in a way our
system reads as a **review rejection**, meaning that pasting one onto a ticket
to explain it would have registered as a rejection nobody wrote and jammed
three things at once. And a mismatch in how commit history is described could
have silently switched off a protection that stops perfectly good reviews from
being treated as out of date.

Each of the four fixes was then deliberately un-done, one at a time, to watch
the test that guards it actually fail — because a test that cannot fail proves
nothing, and this is a lock we are about to start trusting.

## 2026-08-26 — You can now stage a fake outage to check the backup plan works (#445)

Back on the 23rd, ClickUp's group chat broke for about sixteen hours. The
machines use that chat to tell each other things, so when it went down, five of
your answers sat in your queue doing nothing — the tickets you had replied to
never moved on. A fix went in afterwards: if the chat is unavailable, the relay
writes a short note on the ticket itself instead, and the ticket moves anyway.

The trouble is that backup plan only runs during an outage, and you cannot order
one. So it had never actually been watched working — only reasoned about. There
was a command that sounded like a practice run, but it quit early and never
touched the part it was supposedly practising, which is the worst kind of test:
one that passes without checking anything.

This adds a switch that pretends the chat is down. Nothing is sent and nothing
is written, but the real backup code runs and prints what it decided — so you
can see the ticket note being written and the ticket still moving, on demand, in
about five seconds. The switch refuses to run in any mode that could write
something, because faking an outage for real would leave a permanent note on a
ticket claiming a breakdown that never happened.

Worth recording: while proving this out, one of the new tests turned out to be
unable to fail. Breaking the code on purpose is the only way that ever shows up,
and it is why we do it before believing a passing run.

## 2026-08-26 — Test and documentation changes can now merge themselves, after giving you an hour to object (#438)

You are the last step on every merge, and lately that has meant saying "merge"
ninety-odd times a week. A word you say that often without pausing is not really
a decision any more — it is a rubber stamp, and a rubber stamp is worse than no
check at all, because it looks like oversight while providing none.

So this hands one narrow slice of that word to the machine, and only where your
answer was never in doubt: a piece of work that has already passed an
independent review and whose changes are **nothing but tests and documentation**
— nothing that runs on the site, nothing anybody can see. On work like that, the
pipeline now posts a comment on the ticket saying *"merging this at 9:15pm
unless you say otherwise"*, lists exactly which files earned it that treatment,
waits a full hour, and only then merges.

**To stop it, just comment on the ticket.** Anything — a word, a question, "hold
on". It is not looking for a keyword; if you are talking about it, it stops. And
once stopped it stays stopped: it will not raise the same thing again until a
fresh review has looked at it. That asymmetry is on purpose — stopping it by
accident costs you one word, whereas missing your objection would merge
something you did not want.

Two words turn the whole thing off wherever you are: **"stop auto-merging"** on
the party line or on any ticket. **"resume auto-merging"** puts it back. And if
the system cannot read those instructions for any reason — the chat is down, a
file will not open — it treats that as OFF rather than assuming everything is
fine, because "you never said stop" and "I could not find out whether you said
stop" look identical from the inside and only one of them is safe.

Four more brakes sit behind that: it will not do more than three in an hour or
twelve in a day; it posts one summary a day of everything it merged, and says
"none" on a quiet day so a silent day and a broken job never look alike; it
switches itself off if a run reports anything it could not fully check or if the
live site's build goes red; and it is allowed to undo its own merges without
asking.

What it will never touch: anything visual, anything that runs, any database
change — and, deliberately, none of the files that set the rules for the
machines themselves. It cannot merge a change to its own instructions, which
means this change could not have merged itself. There is a test that says so.

This is the smallest, safest slice on purpose. It is about a tenth of the weekly
volume and close to none of the risk, which makes it the right place to find out
whether the safety machinery actually works before anything larger is
considered.
## 2026-08-26 — A check that asks "is anything moving?" rather than "is it switched on" (#439)

Seven things went wrong in the pipeline last week, and here is the part worth
sitting with: **not one of them was a crash.** Every single one was a piece of
the system that started up, ran, reported success, and got nothing done. The
build loop turned away thirteen jobs in a row because a counter had got stuck.
Tickets sat three days in a stage that normally takes fifteen minutes. A pull
request and its ticket each knew about the other in only one direction, which is
exactly how two duplicate branches got opened a few days earlier.

None of it was noticed, and the reason is uncomfortable: **everything looked
healthy the whole time.** Every program was running. Every command reported
success. Any "is it alive?" check you could have run would have come back green
during all seven.

So `npm run pulse` asks a different question. It looks at three things and
prints a page you can read in about ten seconds. Has the build loop stopped
picking up work, and if so, *why* did it decline each time? Has any ticket been
sitting longer than that stage actually takes — with the time limit for each
stage set from how long the work really takes, and the reasoning written down
next to the number so nobody quietly retunes it on an irritating afternoon? And
do the tickets and the pull requests still agree with each other, checked in
*both* directions rather than one?

That last one sounds like a technicality and is not. The loop decides "has this
job been started already?" by reading the ticket. So a job whose link exists
only on the pull-request side is invisible to it, and it cheerfully starts the
same work a second time. That is not hypothetical — it happened, twice, on the
23rd.

Three deliberate choices are worth knowing about. **It never changes anything;
it only reads** — and not as a promise but as a property, with a test that fails
if anyone ever adds a way for it to write. When it finds a problem it tells you
and stops, because one of the four problems it detects has two sensible fixes
and only a person can pick the right one. **It always prints, even when
everything is fine** — that is the entire point, because "all clear" and "the
job died" looking identical is precisely what hid all seven incidents. And
**"I couldn't check that" is never reported as "fine"**; it is kept separate all
the way through to the end.

The first time it ran against the real pipeline it found two things wrong with
itself, both now fixed. It had been calling ordinary handed-back work "abandoned
branches", and it had been matching any ticket number that appeared anywhere in
a pull request's text — including, in one case, a made-up example number sitting
in a paragraph that explained error messages. Both are worth mentioning because
they are the failure this whole thing exists to prevent: a check that cries wolf
gets skimmed past, and then the day it means something, it gets skimmed past
then too.

**The review caught a third one, and it was the same bug a third time.** The
paragraph above says "I couldn't check that" is never reported as "fine" — and
that was the intention, but in one line of the printout it was not what the code
did. When the tool asked GitHub for the open pull requests and GitHub did not
answer, that check compared nothing, found nothing wrong because it had looked
at nothing, and printed **"all clear: every ticket and pull request names the
other"** — sitting directly above its own line admitting it could not read
GitHub at all. Read quickly, that is a green light on a check that never ran.

The fix is one rule applied in one place: a check may only say "all clear" if it
found nothing **and** managed to read everything, and that judgement now lives in
a single shared function rather than being re-decided in each section, so the
next check added to the tool inherits it instead of repeating the mistake. Two
tests hold it down — each one run against the old code first and watched to
fail, because a test that has never failed is not yet evidence of anything.

Worth noting where this was caught: not by the tests, which were green, and not
by the build, which passed. It was caught by the independent review step reading
the output with the question "would this line be true if the check had not run?"
That is the review lane earning its day.
## 2026-08-26 — A ticket sent back now says which trip round it is (#442)

You noticed this on the board on Monday: when a piece of work comes back from
review with notes, it goes back into the "Queued" column — the same column as
work nobody has started yet. From the outside those two look identical, so a
ticket on its third trip round reads exactly like a fresh one.

That is not just an eyesore. The same morning it jammed the build pipeline: the
limit on how much work can be in flight counts open pull requests, and three of
those belonged to tickets sitting in "Queued" *for rework* — so the limit was
blocking the only thing that could clear them.

Two changes, both the lighter option you chose rather than adding a new column
to ClickUp. First, the Loop note on a sent-back ticket now says the round and
the reason in one line — `↩ round 3 — three docs now contradict the change`
instead of the old, identical-every-time "returned to the line with notes".
The round is counted from the review comments already on the ticket, so nothing
new is stored and nothing can drift out of step.

Second, a fourth trip round no longer happens. Three rounds means the
*instructions* were wrong, not the work, so on what would be the fourth the
review pass stops and hands the ticket to you instead — with a card naming what
each of the three previous rounds found, one line each, and asking you to pick:
rewrite the spec, split it up, or drop it. Four and not three deliberately: two
rounds is ordinary and healthy, and this week's send-backs caught two real bugs
that would have been a waste of your attention to escalate.

## 2026-08-26 — The loops now decide their own nap length from the queue (#441)

The two background helpers that build and check work have always worked for
about fourteen minutes and then slept for a fixed stretch. That stretch was an
hour, chosen as a careful guess back when they first started running on their
own overnight, and never looked at since. It meant they sat idle roughly three
quarters of the time.

The trouble is that no single number is right for very long. When there are
thirty tickets waiting, a short nap costs almost nothing — starting up a
session is a rounding error next to a fourteen-minute job, so you are only
removing dead time from work you wanted done anyway. When the list is empty,
the same short nap is pure waste: a whole session fired up every few minutes
just to find out there is nothing to do. That is not a theory — one of the
loops was left on a two-minute timer on the 24th and ran roughly three hundred
and sixty passes, almost every one of them finding nothing.

So they now ask, after every pass, how long to sleep. Nothing waiting: an hour.
A few tickets: half an hour. Four or more: fifteen minutes, and never less than
that. That fifteen-minute floor is written down together with the reason it
exists, so nobody quietly lowers it on a day they are feeling impatient.

Two things make it safe. It counts only tickets it could actually pick up —
work belonging to a different codebase, or blocked waiting on something else,
or work it is not allowed to start because too much is already in flight, does
not count as a reason to wake up sooner. And every kind of confusion makes it
sleep *longer*, never shorter: if it cannot reach the ticket list, if it cannot
count what is already in progress, if the number comes back as nonsense, it
falls back to the old hour and writes down why. Sleeping too long shows up as
a slower response, which you would notice. Sleeping too little shows up only on
the bill.

One busy moment also cannot set the pace for the whole night: speeding up needs
two readings in a row agreeing, while slowing down happens straight away.

Every cycle now writes both the number and the reason into the log, so the
pace is never a mystery. The change takes effect the next time the loops are
restarted.

Review found two holes before it shipped, both fixed in the same PR: a ticket
waiting on work that had *already finished* would have looked blocked forever
(finished tickets never appear in the list it reads, so it now looks those up
separately), and a hand-edited settings file could have switched the
two-readings rule off. Both would have failed quietly toward sleeping longer.

## 2026-08-26 — The build loop stops jamming itself, and a dropped connection can no longer switch the brake off (#431)

There is a rule that stops the robot builder taking on new work when too much
is already half-finished. It was counting the wrong things. A job sent back for
another go still had its pull request open, so the rule counted it as "busy" —
even though the only way to finish that job was for the builder to pick it up
again. The brake was jammed on by the very work it was blocking. One morning
that left thirty-three jobs waiting and the builder doing nothing for four hours
straight, while everything looked normal.

It now counts jobs, not paperwork: only work somebody is genuinely moving
counts, and it says the breakdown out loud — "one in flight, four not counted:
two sent back, one already shipped" — instead of a bare number that told you
nothing.

The part that took three passes was the opposite failure. To count properly the
rule now has to ask ClickUp what state each job is in, and something had to
happen when ClickUp could not answer. If it cannot tell, it counts everything,
which is the cautious answer. But a broken network connection did not reach that
cautious answer at all — it crashed, and a crash was read further up as "carry
on regardless", so a moment of bad wifi would have taken the brake off entirely.
That is worse than the jam it was fixing. All three ways the answer can fail —
ClickUp saying no, ClickUp saying nothing, and never reaching ClickUp at all —
now land on the cautious answer, and there are tests that run the real command
with each failure underneath it to prove it.

Alongside it, the daily drift check learned to spot the matching mess: a job
marked finished whose pull request is still sitting open. It reports those and
leaves them for a person, because "close the leftover" and "that job was closed
too early" both happen and only you can tell which.
## 2026-08-26 — The settings fields and the Layout fields finally line up (#440)

Back on the 13th you looked at a two-column module editor and said the left
column's width "varies arbitrarily between the Settings fields and the Layout
fields." Yesterday's work fixed the top half of that. This is the bottom half.

Open Feature Cards and look down the left side. The rows at the top — Label,
Background, Alignment, the margins — put their boxes at one distance from the
left edge, and the rows right below them put theirs 33 pixels further over.
Two ragged edges where you are reading one list.

The reason it survived yesterday's fix is worth a sentence, because it is not
carelessness. Those top rows and the rows below them are two separate boxes on
the page, and in the language pages are laid out in, two separate boxes cannot
share a column width — each one measures its own longest label and puts its
fields wherever that happens to end. Written identically, they still land in
different places. There is a newer feature, `subgrid`, that lets two boxes
borrow their columns from a shared parent, and that is what they do now: the
widest label is measured across every row at once, so every box starts and
ends on one line. The two halves of the editor stay exactly the equal widths
you asked for in August — the card list still begins at the halfway mark, to
the pixel.

Two of the editors this was expected to touch turned out not to need touching,
and the only way to know that was to drive a real browser and measure. The
Carousel's top rows have nothing underneath them to disagree with. Social had
already solved it a different way months ago. Both were left alone.

The Program List editor, which was not on the ticket, turned out to have its
two columns backwards: the list of programs was stacked underneath the top
rows on the left while the settings sat off on the right, with the heading
"Settings" sitting over the list of programs. Nothing in the styling said so
— the rule that places those two halves had simply never named this editor.
It now matches Feature Cards, and the panel is about 850 pixels shorter.
There are before-and-after pictures on the ticket; that one is worth a look.

The last piece is the checker. `check:panels`, the tool that is supposed to
catch exactly this kind of misalignment, had been reporting a clean pass over
it for weeks — it compares each box against itself, so two boxes that are each
perfectly tidy inside while disagreeing with each other were invisible to it.
It now measures them together. Before believing the fix, the sharing was
switched off on purpose to confirm the checker fails loudly: it does, twelve
times over, at every screen width.

## 2026-08-25 — A pause button for the whole pipeline, so going fast is allowed (#434)

You said you needed an emergency shutdown that clears the decks so you can run
a priority job through yourself. What was actually missing was a *lane*: there
was the slow, careful one — spec, build, independent review, your merge, about
a day — and there was nothing else. So whenever something was urgent, the only
way to move was to step outside the whole system, into the one place where none
of the safety rules apply.

There is now a switch. `npm run pipeline -- pause` tells every machine to stop
taking new work, and then **waits** for anything already half-built to finish
before it tells you the decks are clear — it never just yanks the plug, because
a job killed halfway through leaves its ticket stuck in a place nothing ever
looks at again. That has already happened twice this month. If you do not want
to wait, `--now` stops instantly and names exactly what it left running, and
when you resume, anything that got stranded is put back in the line with a note
for whoever picks it up.

The important part is who listens. A pause the robots respected but people
ignored would not have prevented the thing that caused this: that was an
ordinary working session, not a robot, and it would never have thought to
check. So the switch lives in ClickUp, where everything already looks, and the
instruction to check it is written into the file every session reads when it
starts. If the switch cannot be read at all — ClickUp down, network out — the
answer is "paused", deliberately: working while you have the deck can wreck
what you are doing, while stopping when you have not costs some idle time and a
message on screen.

Anyone can pause the line, because stopping is a safety move. Only you can
start it again. And if a pause is still on after two hours it says so on the
party line and keeps saying so every hour, because a pipeline that is paused
and a pipeline that is broken look identical from the outside — which is
exactly the confusion that cost most of today.

The independent check on this work found two holes in it before it shipped, and
both are worth knowing about because they are the same shape. The switch keeps
its state as a note on a ClickUp ticket, and the hourly "still paused" reminder
is *also* a note on that same ticket — and ClickUp only hands back the newest
twenty-five. So after about a day of reminders, the reminders had pushed the
original "PAUSED" note out of sight, the machines could no longer find it, and
they would have quietly gone back to work while you still had the deck. The two
best features cancelled each other out, overnight, in the one place that was
supposed to be careful. It now reads the *whole* history, and separately, a
reminder with no pause behind it is treated as "I could not read this properly"
rather than "nothing to see" — because a reminder only ever gets written while
the line is off, so seeing one alone proves something is missing.

The second was smaller and would have hit you first: every command written down
here was missing two characters. `npm run` quietly swallows anything starting
with a dash unless you put `--` in front, so typing the resume command exactly
as documented got you told off for leaving out the very word you had just
typed. Every command in every document now has it, and there is a check that
fails if one ever loses it again.
## 2026-08-25 — An agent that asks you to spend money now has to show its work (#436)

A few days ago one of the agents came to you with a confident recommendation:
put the ClickUp workspace back on a paid plan. It had good-looking reasons. The
chat channel had been refusing to accept messages for sixteen hours, a separate
write had failed with an error mentioning plan limits, and the account did read
back as being on the free tier. Three facts, one tidy story.

The story was wrong. Checked again a few hours later — same account, same free
plan, nothing changed — every one of those things worked fine. The outage had
been temporary and had already cleared on its own. Paying would have fixed
nothing.

The bad guess is not really the problem; a guess like that is reasonable on a
day when two things break at once. The problem is that it got all the way to
your wallet without anybody re-running the thing that had been failing. That
would have taken one command and about ten seconds, and the moment of coming to
you is exactly when it is still cheap to check and already expensive to be
wrong.

So the request itself now demands the proof. When an agent writes you a card
that asks you to spend, buy, subscribe, upgrade, change a plan, rotate a
password or delete something, it simply will not post unless the card also
carries the command it ran, what that command actually printed, and the time it
ran it. Not a summary of the output — the output. And the time shows up in the
heading you read, so evidence gathered before an outage cannot quietly pass
itself off as evidence about right now.

Ordinary questions are untouched. "Should this sort by name or by date?" posts
exactly as it always did, and there is a test making sure it keeps doing so —
because a rule that nags about everything is a rule people learn to go around,
and then it protects nothing at all.

Review caught two holes in the first version, both now closed. The time shown in
the heading was taken from the first clock anywhere in the proof — including
inside the pasted output — so an agent who wrote "measured at 9:40pm" under a log
line from last Thursday got a card telling you the check was six days old. The
heading now reads only what the agent wrote in its own words, and a proof whose
only time is buried in the printout is refused with an explanation. Second, the
list of words that trip the rule knew "delete" and "deleting" but not "deletes",
so "this deletes all 550 rows" — the most natural way to describe what your yes
would do — sailed straight through with no proof at all. Every verb now carries
all three forms, and a test fails if a future one arrives missing any of them.

A second review round found three more, all of the same kind — the rule quietly
doing the wrong thing rather than complaining. The heading still took the first
time it found, and proof usually tells the story before it shows the receipt
("the outage started at 3:12pm; I re-ran it at 8:04pm"), so the card announced
the outage time as the measurement. It now reads the time the agent says it ran
the check at, and if there are two times and nothing says which is which, it
refuses and asks rather than guessing. A hyphen also switched the whole rule
off: "approve the hard-delete of those rows" was never checked at all, because
of a bad assumption about how word matching works. And "this will cost about
thirty dollars a month" slipped through while "it costs about thirty dollars a
month" was caught, because the list had one spelling of the word and not the
other.

The last fix went the other way. Words like "billing", "invoice" and "deletion"
were tripping the rule on cards that asked for nothing — "nothing needed, the
deletion already happened last week" was being refused, which is exactly how a
rule teaches people to route around it. Those words now only count when
something in the same sentence actually proposes the act: "approve the
deletion" still asks for proof, "the deletion already happened" does not.

A third review round found the heading getting the time wrong for the third
time, and it is worth saying why that one mattered more than the others.
Everywhere else this rule REFUSES something, and being wrong costs a reword.
The heading is the one place it TELLS you something — "measured at 8:04pm" —
so being wrong there means the card states, in the machine's own voice, that a
check was run at a time it was not. That is the same shape as the mistake the
whole thing exists to prevent.

Each of the three attempts had picked the time by where it sat in the sentence:
the first one, then the first one outside the printout, then the last one. Each
worked until somebody wrote the sentence a slightly different way. "I re-ran
the chat call at 9:40pm, well after the outage that began at 3:12pm" got read
as 3:12pm, because the words "re-ran" were allowed to claim every time later in
the sentence. The rule now says something different in kind: the phrase that
means "I ran this" belongs to the ONE time it introduces and no further. And if
an agent genuinely marks two different times as the run, the card no longer
picks a winner — it stops and asks which one to print.

Three smaller holes went with it. A time written on its own next to a printout
that carries its own timestamp is no longer trusted, because a bare time next
to a log is usually the thing that broke rather than the check that was run. A
command typed across two lines with a backslash was counting as "a command plus
its output" when there was no output at all. And the short list of harmless
phrases was being cut out of the text letter by letter rather than word by
word, so "pays offshore contractors" lost the phrase "pays off" out of the
middle of a word and stopped counting as money. Related: the words that turn a
noun into a request only knew their plainest spelling, so "proceeding with the
deletion", "performing the key rotation", "kicking off the migration" and
"signing off on the invoice" all posted with no proof required — all of them
ordinary English for exactly the things this rule is meant to catch.

One thing was deliberately left alone, and it is yours to call rather than
mine. Any dollar figure in a request trips the rule, even when the card is not
asking for anything — so "nothing needed, the Vercel bill came to $30 last
month" gets refused and has to be reworded. Requiring a request-word alongside
the figure would fix that, but it would also let "$29/month for Business or $49
for the tier above?" through silently, and that one is a real question about
your money. Which way that should go is a judgment about how much plain English
a word-matching rule ought to chase, and it seemed better to say so than to
quietly pick.

Then a fourth review round found the heading wrong a fourth time, and a fifth
found it a fifth. The sentence that broke it this time put the run time first
and the explanation after — "at 8:04pm I re-ran the failing call, well after
the outage began at 3:12pm" — and the card came out headed 3:12pm, the moment
things broke, presented as the moment they were checked. Five attempts, each
one a different rule for working out which time in a sentence is the
measurement, and each one correct until somebody wrote the next sentence.

So it went to you instead of round the loop again, and you picked option A:
stop guessing. The agent now writes the time on a line of its own —
`@@MEASURED 8:04pm` — and every other time anywhere in the proof is ignored,
narrated or printed. It costs an agent one extra line. What it buys is that
this particular bug cannot come back, because there is no longer a sentence to
misread: the five previous fixes were all answers to a question this version
does not ask. If the line is missing, written twice, buried inside the printout
or carrying something that is not a time, the card is refused and told exactly
which of those it is.

The same round fixed a smaller thing that needed no decision from you. Every
one of these words worked in the singular and went silent in the plural, so
"approve the deletion" demanded proof and "approve the deletions" did not —
the rule declining on the more expensive version of the same request. Six words
gained their plurals, with a test that now checks both spellings of each one
and fails if a future word arrives with only half of itself.

## 2026-08-26 — Somewhere to write down what footage exists (#422)

The video Studio needs a filing cabinet before it can have a workshop: a record
of which recording sessions exist and which files belong to each one. This is
that cabinet, and nothing else — nothing downloads, nothing processes video,
there is no screen to look at yet. Those come in the next seven pieces.

The care here went into two mistakes that have already cost this project real
money. The first is a table that forgets which client it belongs to: there are
two columns that decide that, and if a table carries only one of them, the code
that fills them in quietly gives up and fills in neither. Nothing errors. Rows
just land belonging to nobody, and you find out weeks later — 550 rows sat that
way in August. Both tables here carry both columns, and a test fails if anyone
removes one.

The second is deciding a file is a duplicate across every client at once. The
same footage handed to two clients is genuinely two things, and a rule that says
otherwise locks the second client out of their own file forever. That has
happened here before, with topic names. So "we already have this one" is asked
per client, never globally.

The tests are unusual in a way worth mentioning: they read the database design
straight out of the file that creates it, rather than keeping their own copy.
A copy stays right while the original goes wrong, which is exactly how the
forgotten-client bug survives being tested. To prove that works, the design was
broken three separate ways on purpose and the right tests failed each time.

Three rounds of review later, the same mistake had been found three times in
three different places, so this round went after the pattern rather than the
instances. The pattern is: you hand the system a value it cannot read, and
instead of refusing, it throws away the good value that was already there and
tells you it worked. A recording's length, its frame rate, its dimensions, how
confident we are about the audio sync — every one of those would accept the
word "N/A" from a piece of equipment that failed to read the file, wipe what
was there, and report success. Now each of them says no and leaves the good
value alone. That matters most because the very next pieces of this project are
the ones that read video files and write those numbers back, and equipment that
cannot read a file reports exactly that kind of nonsense.

One of those numbers deserved more than a refusal. The sync offset says how far
apart two recordings are in time, and it used to fall back to zero — but zero
is not a blank, it is the confident claim "these two are already perfectly
lined up." An unmeasured file was silently asserting something false about
itself. It can now say "nobody has measured this yet," which is the truth.

Also fixed: a database that was briefly unreachable used to be reported as
"that recording session does not exist," which would send somebody looking for
a problem that was not there. And the miniature stand-in database the tests run
against was quietly ignoring three of the rules the real one enforces, so a
future test could have proved something it was not actually checking. It now
enforces them, and refuses out loud when it meets a rule it does not understand
— which is what its own instructions had claimed all along.

Every one of these was proved twice: once by breaking the fix on purpose and
watching the right test fail, and once by running it against a real database.

A fourth review found the same shape twice more, in the two places nobody had
looked yet. Each recording session names one file as the one everybody else
gets lined up against — and the code that set that name never checked the file
belonged to the same client. One client could point at another client's
footage and be told it worked. Then the other client deletes their file and the
first one is pointing at nothing. There is no safety net underneath this in the
database itself, deliberately, so this code was the only thing that could have
caught it, and it was not looking. It looks now, and a test proves it both
refuses the other client's file and still accepts your own.

The second: every file gets a fingerprint so the same footage is not filed
twice. If something handed over a fingerprint that was not text — a whole
bundle of data instead of a line of it — it got quietly turned into the useless
word "[object Object]" and stored. The next genuinely different file then came
back as "we already have this one," which was simply untrue, about two files
with nothing in common. Now anything that is not text is refused outright, and
whatever was already recorded is left alone.

Four smaller things came with them, the notable one being the miniature
stand-in database the tests run against: it was reading the column types out of
the real design and then never checking anything against them, so a test could
hand it obvious nonsense and be told yes. It checks now — and, in keeping with
how the rest of it already worked, it refuses out loud when it meets a type it
does not know how to check, rather than waving it through.

Proved the same way as before, and deliberately: each of the seven fixes was
broken on purpose and the matching test failed each time, and both of the
serious ones were reproduced against a real database on the old code before
being confirmed fixed on the new.

A fifth review found six more, and the first one is the plainest example of
this whole pattern yet. There are two ways to spell the name of anything in
this system — `durationS` if you are writing code, `duration_s` if you are
looking at the database. Filing a new file accepted both spellings. Updating
one accepted only the first. So a piece of equipment reporting "this video is
99.5 seconds long" using the database's own spelling was told "saved" and the
old wrong length stayed. Nothing about that input was wrong. It was correct
data, in a correct field, dropped because of how it was spelled. And the only
code that will ever write those numbers is the next three pieces of this
project, which naturally use exactly that spelling. Both spellings now work
everywhere, giving the same field twice with two different answers is refused
rather than one being quietly picked, and a field name that is simply a typo is
now turned away instead of being ignored inside an otherwise successful save.

The session's chosen audio file got the same treatment one level deeper. Last
round taught it to refuse another client's file; it turned out it would still
accept a file belonging to a different session of your own. Delete that other
session and the first one is left pointing at something that no longer exists.
It now requires the file to belong to the session that is naming it.

Dates were the last of it, and the worst behaved. Handing over the number zero
where a date belongs stored "1 January 2000" — a real moment in time, invented
out of something that was not a date at all, reported as success. Asking for
the 30th of February stored the 2nd of March. And a time written without a time
zone was read in whatever zone the computer happened to be in, so the same
recording filed from the Mac Mini and from the laptop landed six hours apart.
All three are now refused or made consistent, which matters because these dates
are how footage gets lined up in the edit.

The other three were in the miniature stand-in database the tests run against.
It is going to be the test bench for the next seven pieces of this project, so
a rule it pretends to enforce is a rule that gets broken seven more times. It
was ignoring an instruction about what to send back — the exact mistake that
would make new code work perfectly in tests and fail on the live site. It was
only half-reading the rule about which client owns which row, in the direction
that shows too much rather than too little. And it treated two blanks as
identical to each other, inventing a restriction the real database does not
have.

All six were reproduced against a real database on the old code first, then
confirmed gone on the new. Each fix was also broken on purpose to watch the
right test fail — and that exercise caught something on its own: two of the
safety checks covered each other so completely that either could be deleted
with every test still passing. A check that cannot fail is not a check, so a
test was added that tells them apart.

A sixth review found five more, and two of them are the same story this whole
entry keeps telling: an answer that is wrong, delivered as a success.

The first is about how a name is spelled in capitals. Every recording session
has an id, and the database treats `A115C635` and `a115c635` as the same id —
it does not care about capitals. Our code did. So a session handed its own id
in capital letters refused its own audio file, with the message "that file
belongs to a different session." The file did belong to it. The session did
exist. The refusal simply was not true. Ids get typed, pasted and copied out of
logs by hand, and any of those can change the capitals without changing the id.

The second is what happens when a fingerprint is too long. There is a limit on
how much of one gets stored, and past that limit the system used to quietly cut
it short and say "saved." Two completely different files that happen to match
for the first stretch then look identical, and the second one is turned away as
"we already have this one" — untrue, about two files with nothing in common.
That is the same lie an earlier round fixed from the other end: the check that
reports the duplicate was corrected, but the thing that manufactured the
collision was not. Anything too long is now refused outright, saying which
field and what the limit is. The same applies to the file paths, where a
quietly shortened one is worse still — a shortened path points at nothing, and
the pieces of this project that write those paths are the next ones to be built.

The other three were in the miniature stand-in database again, and they matter
for the same reason as last round: it is the test bench for the next seven
pieces. It was matching genuinely empty values against the literal word "null"
— the third time that exact confusion has been found in this branch, in a third
place. It was accepting a misspelled column name and a malformed id by
answering "no results found" where the real database refuses the question
outright, which had already caused a test here to be checking for the wrong
answer entirely. And it was silently unable to handle three of the column types
it listed as supported, which today's design does not use — a trap set for
whichever of the next seven pieces uses one first.

Fixing the capitals problem turned up something the tests could never have
found: the fake ids the tests use were made entirely of zeroes, so "the same id
in capitals" was not a thing that could exist in a test. They have letters in
them now, and that change alone immediately exposed a second copy of the
capitals bug in the stand-in database itself.

All five were reproduced against a real database on the old code before being
fixed, and twenty-one checks against that real database confirm the new
behaviour — each one reading the row back with a direct query rather than
asking the code that wrote it. Every fix was then broken on purpose, nine
different ways, to watch the right test fail each time.

## 2026-08-25 — One command that answers what is actually waiting on you (#435)

Twice on the evening of the 23rd an agent told you something needed you when it
did not, and you went and dealt with it both times. Eleven of the "seventeen
tickets waiting on your merge word" already had your approval on them — they
were stuck on a machine that could not reach GitHub. And the YouTube worker
question you were asked a second time, you had already answered "A" an hour
before. Neither agent was lying or thinking badly. Both had stated something
about how things stood right now while reading something that was not how
things stood right now — an old terminal window in one case, a stale memory of
a list in the other. In both cases the true answer was one lookup away.

Writing down a rule would not have fixed it, because the problem is that asking
"wait, is this really his?" takes a moment of doubt, and nobody had a quick way
to settle it. So instead there is now a command that is faster to run than the
sentence is to think about: `npm run clickup -- waiting`. With no arguments it
sweeps every open ticket in both lists you watch and shows only the ones that
genuinely need you. Point it at one ticket and it prints that ticket's status,
whether your name is on it, who spoke last and what they said, and then its
verdict.

It works out that verdict from three things it has just looked up, and nothing
else: which column the ticket is in, whether you are assigned, and whether the
newest comment is yours. If the newest comment is yours, it is never waiting on
you — you have spoken, something else owes the next move. And when it cannot
establish one of those three facts it says "cannot tell" and names the reason,
rather than picking the comfortable answer. Guessing "nothing needs you" is how
a question you already answered sits unread for nine hours.

The same rule now guards the other direction. The command that hands a ticket
back to you refuses to do it when your own comment is already the newest one —
that is the "please answer this a third time" failure, and it was arriving
through the very thing built to stop it. There are two ways for a machine to
put a ticket in your column, and review caught that the refusal was only
standing across one of them; it now stands across both. A lock on one of two
doors is worse than no lock, because everyone stops checking the handle.

It proved itself on its first live run. Two tickets are sitting in Ready to
launch with your name on them where you already typed "merge" — the exact shape
that produced the wrong sentence on the 23rd. The old way of looking would call
those two things waiting on you. The command says they are not: you did your
part, a machine owes those merges.
## 2026-08-25 — The "don't merge unreviewed work" rule is now a lock, not a sign (#433)

Earlier today a pull request went straight to the live site without anyone
reviewing it. Nothing was broken by it, but the way it happened is worth
fixing: a second Claude window you had open ran the ordinary "merge this"
command, and it had no way of knowing that the review lane was still waiting on
that piece of work. The ticket jumped from "being built" to "live" without ever
stopping at "ready to launch" for your say-so.

The rule against that has always existed — it is written down, and every part
of the automatic pipeline obeys it. But a written rule only reaches the people
and programs that have read it. A fresh window, a terminal you forgot was open,
or a hurried moment on your own machine are all outside it. So the rule has been
turned into a lock: GitHub itself now runs a check on every pull request that
looks up the work's ticket, finds the most recent review verdict on it, and
refuses the merge unless that verdict is a pass — and a pass on the *current*
code, not on an older version that has since been rewritten. If the ticket has
no review at all, or the review sent the work back, or the pull request does not
even say which ticket it belongs to, the check says no and explains in plain
words what has to happen next.

There is a deliberate escape hatch, because a rule with no way out gets worked
around instead of used: writing `[gate-waived: reason]` in the pull request lets
it through, and doing so announces itself on the team chat with the reason. An
override nobody can see is not an override, it is a hole.

Two honest notes. First, the check is currently a **warning, not a lock** — it
watches and reports but blocks nothing, because switching it on is a setting in
GitHub's own website that only you can change, and it deserves a few days of
watching first to be sure it never says no when it should say yes. Second, it
needs a password stored with GitHub so it can read your ClickUp tickets, and
this project has none stored yet; that one is also yours to add. Both steps are
written out in the project notes, and neither was guessed at or faked.

The escape hatch had a flaw of its own, and it showed up immediately: this very
pull request has to *explain* the escape hatch, and the check read its own
explanation as a real override and let itself straight through. That was fixed
by requiring the override to sit alone on its own line — a mention inside a
sentence is talk about the rule, not the rule. The review then found the same
flaw one step further out: an override written out as a code example, the way
this project documents everything, still sat alone on a line and still counted.
So examples shown as code are now skipped entirely, which is why the notes for
this feature can quote the syntax as often as they like without arming it. When
in doubt the check now loses an override rather than granting one — a lost
override costs one edit, a granted one costs a merge.

One thing was caught before it could cause trouble. The obvious version of
"has this been reviewed recently enough?" compares the review against the newest
change on the branch. But this project keeps branches up to date by pulling in
the latest main code, which counts as a change — so every properly reviewed
piece of work would have looked stale the moment it was refreshed, and the whole
pipeline would have jammed. Running the new check against the real record found
exactly that on two recent pull requests, and the rule now ignores those
housekeeping updates and looks only at genuine edits.

## 2026-08-25 — The robot that reads your replies now checks every 10 minutes (#426)

There is a small program on the Mac Mini whose whole job is to read your ClickUp
tickets and act on what you wrote — most importantly, to merge a PR when you
reply with the word "merge". It was waking up once an hour.

Nothing about the job needed an hour. It is not an AI session, it costs nothing
to run, and it finishes everything it has to do in about fourteen seconds. The
hour was a leftover default from back when the program only sent notifications;
when it was given the power to merge, nobody went back and asked whether the
timer still made sense. So work you had already approved could sit waiting on a
clock rather than on anything real. It now wakes every ten minutes.

Two things were worth checking before speeding it up, and both were measured
rather than assumed. First, whether six times the traffic would annoy ClickUp:
a real run uses 39 of the roughly 100 requests ClickUp allows per minute, so
there is comfortable room, and the program now reports that number on every run
so it stays honest as the queue grows. Second, whether two runs could overlap
and post your message to the team chat twice — a real worry at ten minutes that
barely existed at sixty. A throwaway test job proved macOS refuses to start a
second copy while the first is still going, so they cannot stack. Useful to
know that the protection comes from macOS and not from our own code.

One piece is still yours: the Mini's schedule file has to be regenerated with a
single command before the change takes effect there. Every run now says out loud
whether the machine's schedule matches what the code says, and prints the exact
command to fix it, so this cannot drift silently.

Review caught that last promise not quite holding. The check had two answers —
"matches" and "does not match" — and no way to say "I could not read it". If
the schedule file were missing or unreadable it said nothing at all, or worse,
printed a reassuring "matching" with a question mark where the number should
have been. Since the whole point of that check is to stop the one manual step
from being quietly forgotten, a check that can say everything is fine without
knowing is worse than none. It now has a third answer that says plainly what it
could not read. The same reading is also printed by the status command a person
would actually run, which previously did not mention the schedule at all.

A second review round found the same shape of problem twice more. The check
could still give a fourth answer nobody asked for: it picked the number out of
the schedule file by grabbing the last one on the line, so a file written all on
one line would report a completely unrelated setting as the timer — wrong, and
confident about it. It now reads the number that actually belongs to the timer.
And the change had quietly made three other documents false, because they still
described the program as running hourly: the ecosystem map, which is published
and read by people; the page describing how your one-word "merge" reply works,
where a faster merge is the entire visible point; and the reviewer's own
instructions. All three now say ten minutes. Worth naming the pattern — the
number lives in six places, only two of which make anything happen, and nothing
checks the other four. They are now listed in one table so the next person to
change it knows where to look.

A third review round then made the neatest point of the three: that table said
"every place" and was short by eight. The word "hourly" was still sitting in a
handful of code comments explaining why various safety guards exist, and in one
message printed on screen to whoever installs the program. None of it breaks
anything — it just quietly misinforms the next person, which is the same
failure the previous round was sent back for, moved one layer down. All eight
are fixed, and most of them no longer name a schedule at all: where the sentence
only ever meant "every time it runs", it now says that, so it cannot go stale
again. The table has stopped claiming to be complete and instead hands you the
one-line search that actually is — with a note that the number is written out as
"ten minutes" in some places and "10" in others, which is exactly how half a
list like this gets missed.

Two smaller things came out of the same round. There was a limit in the code
meant to stop a single run dragging on forever, set to fifteen minutes back when
the program ran hourly — so after the speed-up it was permitting a run half
again as long as the entire gap between runs. It is no longer a number anyone
typed: the test now reads the real schedule and insists a run must finish inside
it, so if the timer is ever shortened again this fails loudly instead of
silently allowing an overrun. And the "I could not read it" message had been
telling you to check by running the very command that had just printed it — a
circle. It now names the two things that could actually be true and what to do
about each. Both are pinned by tests, and I broke each on purpose first to
confirm the tests can fail rather than trusting a green run.

## 2026-08-25 — The top of every module panel lines up now, and images can cast a shadow

You sent a picture of the image module and said it had drifted away from our
standards. It had, though not in the image module's own settings — those were
fine. The problem was the strip of shared controls that sits above them, the
one every module wears: **Label**, **Background**, **Alignment**, the margins
and the nudge.

Those seven rows were being laid out by three separate mechanisms that had no
way to agree with each other, so they lined up in three different places on the
screen — Background stranded off to the left with the whole margin stack
floating to its right. They are one list now, one label column and one field
column, on every module, not just the image one.

Two things had kept this hidden. Two panels had a patch that stacked their
chrome vertically, which made the problem invisible in exactly the two places
anyone had looked. And the automatic layout checker was scoring the Background
row on its own, where it could only ever be compared with itself — so it passed
the whole time. Both are fixed: the checker now measures Background inside the
group with everything else, and it was broken on purpose first to prove it
would catch this again.

**Drop shadows on images.** New on the image module's **Frame** column, behind
a tickbox: colour, X, Y, blur, spread and opacity. They are the same six
controls, the same defaults and the same soft look the Carousel's pictures have
had since August, on purpose — one picture and a row of pictures should not
mean two different things by "Drop Shadow". Off by default, so nothing on a
live page moves until you tick it.

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

## 2026-08-22 — Public forms can no longer file themselves under a made-up client (#373)

Every StarCaster client site has a few pages that anyone can use without
logging in: the contact form, the "forgot my password" box, the bug-report
button. Each of those sends the site's client id along with the message, so we
know whose inbox it belongs in.

On a client's own web address that id is checked against the address — a form
on brandonmarinoff.com cannot file into another client's records. But on our
own addresses (starcaster.pro, a preview link, or your laptop while you are
working) there is no client address to check against, so the id was simply
believed. Anyone who typed a made-up id got a real submission filed under a
client that does not exist: a row nobody owns, that shows up on nobody's
screen and cannot be cleaned up because nobody knows it is there. Typing a
*real* client's id was worse — it filed into their records.

There is now one piece of code that answers "which client is this request
allowed to act on", and every public form goes through it. A made-up id is
turned away before anything is written. A real one still works, which is
deliberate: those same forms are already open to the world on the client's own
website, so refusing them here would protect nothing and would break both
local testing and the Builder's own preview.

The four remaining places that use the older, looser check were reviewed one
by one — all of them only *read* pages that are public anyway — and a test now
fails the build if anyone adds a fifth without making that call.

While this was waiting to be checked, a seventh public form went live: the
picture upload behind the new bug-report button. It had its own private copy
of the "which client is this" check, which is exactly how two versions of the
same rule start to drift apart. It now goes through the shared one, and the
private copy is gone. The build check that is supposed to catch this had a
blind spot — it trusted one whole file rather than each form inside it, and
that file is where public forms live — so it now looks at every form
individually. Run against the old code it correctly refuses to pass, which is
how we know it is actually looking.

## 2026-08-23 — Parkour: the last of the four picture effects you asked for (#395)

Back on 19 August you looked at a list of animations that were built into the
Builder but that nobody could actually pick, and you chose four to bring out.
Three of them — Slide, Axis Rotate and Flips — arrived on the 22nd. **Parkour
is the fourth and last, and it is now in the Effect dropdown** on both the
Image and the Floating Image panels.

Parkour is the busy one. The picture travels across the page, bounces as it
goes, and spins on two axes at the same time — turning like a clock face while
also tumbling towards and away from you, the way a card looks when you flip it
over end-over-end. It is the only effect that does all three things at once,
so it is also the only one that offers every control: Direction, Speed,
Rotation Rate, Frequency, Bounce Height, Start Delay and Repeat.

Two things made this harder than its three siblings, and both are worth
knowing because they cost time elsewhere:

The first is that the tool the other effects use to rotate a picture only
turns it about **one** axis. There is no setting for "spin and tumble at the
same time", so parkour needed its own purpose-built piece of animation. It is
still driven by the same Rotation Rate control as everything else, so "25
turns a minute" means the same thing here as it does on Spin.

The second is a trap this codebase has now fallen into twice. There was an old,
abandoned version of Parkour still sitting in the stylesheet — a fixed-speed
animation that ignores every setting, plus some layout rules that squash a
floating picture into a fixed 240-pixel band. Slide hit exactly this and took
three review rounds to sort out. So parkour deliberately goes by a slightly
different internal name, which the abandoned rules do not recognise. That was
checked in a real browser rather than assumed: under the old name the picture
gets flattened and every setting is ignored; under the new one it behaves.

Also confirmed by eye, on a real rendered page: the picture does visibly travel,
bounce and turn on both axes together, and it stops completely for a visitor
whose computer is set to reduce motion.

Cartwheels is still deliberately absent — it is Tumbleweed under another name,
which is what you said at the time, and there is now a test that stops a future
tidy-up from "helpfully" adding it back.
## 2026-08-23 — The always-on Mac Mini is no longer a blind spot (#400)

There is a command here whose job is to ask "does the written-down map of my
machines still match reality?" It had a gap: it would prove the Mac Mini was
awake and reachable, and then decline to check anything actually living on it,
reporting those things as "cannot tell" rather than checking them.

Saying "cannot tell" instead of "fine" is the right instinct and it stays. But
once the Mini has answered the door, we can look — and the first thing that
turned up hiding in that gap was a container runtime that had been fatally
broken since the day the Mini was set up, with nothing able to report it. The
gap was also set to widen, since every new job the Mini takes on became one
more thing nobody could verify.

Now, when a machine is reachable, the checks for things living there run there.
They ask exactly the same questions as before; only the location changes. Three
rules keep it honest: it knocks once per machine rather than reconnecting for
every item; a sleeping or closed machine is reported as "could not check" in
the words it always used and never as a problem; and — the important one —
"the Mini is asleep" and "colima is installed but will not start" are told
apart, so only the second one raises an alarm.

Proving this normally takes two machines, and the machine it was built on can
only reach the other one in one direction. So it is covered by tests that stand
in a pretend second machine, exercising both directions the work called for:
awake-and-broken must raise an alarm, asleep must not. Both halves were then
broken on purpose to confirm the tests genuinely catch it.

Review caught three ways it would have cried wolf, all now fixed. The important
one: when you ask another Mac to run a command over the network, it starts in a
stripped-down environment that cannot find most of the software installed on it
— so the check would have looked at a perfectly healthy Mini and announced that
colima and Docker were both missing. Every remote question is now asked through
a proper login session, which is the same thing that happens when you open a
Terminal window yourself, so the machine can find its own tools. The other two
were smaller versions of the same fault: a machine that accepted the connection
and then stalled was reported as broken rather than unreachable, and a
connection that dropped halfway through the Docker check was reported as
"Docker is not installed there". Both now say "could not check", which is the
honest answer.

That distinction is the whole point. A check that raises false alarms is worse
than no check, because you stop reading it — and this one would have raised
several, about a machine with nothing wrong with it, the first time it ran.

## 2026-08-23 — Trying the "Report a problem" button while you build no longer files a real report (#403)

The Bug Report module puts a little bug icon on a tenant's page; a visitor
clicks it, describes what went wrong, and the report lands in the queue. The
obvious thing to do after dropping that module onto a page is to click it
yourself and see what happens — and until today, doing that filed a genuine
report. Inside the Builder, where the site you are editing is already known,
the row went in for real. Once the piece that turns reports into ClickUp tasks
goes live, that same curious click would have put a task in your queue.

Now the button behaves differently depending on where it is. On a published
tenant page, nothing has changed at all — a real report, exactly as before.
Anywhere else, which means the Builder and its preview, it still asks you to
describe the problem, still shows the thank-you message the site owner wrote,
and still closes itself after two seconds, so you see the whole thing a visitor
would see. It just adds one quiet line underneath: *Preview — nothing was
sent.* Nothing leaves the browser.

Two smaller things came along with it. When a report genuinely cannot be sent,
the visitor now reads one plain sentence instead of whatever the server said —
some of those messages were written for a programmer and named internal fields,
which tells a member of the public nothing they can act on. And the tests that
cover this module used to check the "send" path while pretending to be in
preview, which is exactly the confusion that hid the bug; they now run against
a real page, with separate tests holding the preview side down.
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
