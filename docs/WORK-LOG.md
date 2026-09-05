## 2026-09-05 — A main menu item now joins up with its dropdown instead of floating above it (#615)

When you hover a top menu item that has a dropdown — "Pickleball", for
instance — the item and the panel underneath it read as two separate rounded
pills stacked on top of each other, with a gap between them. This adds a
checkbox to the Navigation module, **Square bottom when open**, which squares
off the bottom two corners of the item and the top two corners of the panel
while that dropdown is open, so the pair touch and read as one connected
shape. Move the mouse away and the item is fully rounded again.

It is off until you switch it on, so no client's menu changes on its own. The
way that promise is kept is worth a line: with the box unticked the code sends
the browser nothing new at all, and every new styling rule is written to fall
back to exactly what it does today. So a menu nobody has touched is not merely
"the same numbers" — it receives the identical instructions it received before
this existed. Three tests check that, one of them by comparing the whole set
of instructions before and against after.

Menus that stack into a phone-style drawer are left alone deliberately. There
the panel is an indented list rather than a card hanging off a bar, so there
is nothing for a squared corner to join to, and squaring it would just look
like a fault.

One tool got a small upgrade along the way. The check that photographs what a
module renders could only read a page sitting still, and this feature only
exists while the mouse is on something — so it can now hover before it looks.
Without that, the only proof available would have been a unit test and
somebody's eye.
## 2026-09-04 — The pipeline switch now records who handed the deck back, and on what word (#607)

The build pipeline has a switch. When Dane needs the machines to stop — he is
working on something by hand and does not want them claiming tickets underneath
him — someone pauses it, and pausing already records *why*. Resuming recorded
only who and when. So the one question worth asking afterwards — *on whose word
did this start up again?* — could not be answered from the switch's own ticket
at all.

That is not a hypothetical. On 1 September the line was paused because Dane was
fast-tracking a task by hand. At 2:33pm he wrote, in a different window, "I am
finished (for now) with the other fast-track task." Nineteen seconds later that
session resumed the pipeline. But finishing one task is not the same as saying
"you can have the machines back", and he had not said it. Finding out what had
actually happened meant digging a transcript off the disk of another session,
because the ticket had nothing to say.

Resuming now refuses unless whoever runs it pastes in Dane's actual words. The
point is not really the record it leaves — it is the moment of typing: an agent
that has to go and find the sentence discovers, right there, whether one exists.
That 2:34pm session would have found that none did. An optional box would have
been skipped by exactly the session that most needed to fill it in.

It does not try to check that the words really are a quote, because nothing can
check that, and a check that pretended to would be worse than none.

Two smaller things came with it: the status command now prints the reason on a
*running* line too, not only a paused one — so today it reads "why: (not
recorded)" against that 1 September resume, which is the incident itself,
finally visible where people already look. And who is allowed to resume has not
changed one bit: still Dane's call alone.

Review caught one thing before this went out, and it was the thing the whole
change is about. The switch's record keeps one line per fact, so a quote typed
across two lines was being stored as its first line only — the rest silently
dropped, with nothing on the ticket to say a half was missing. A half-sentence
presented as Dane's words is worse than no quote at all. Worse still, if the
second line happened to begin "by:", it replaced the name of whoever resumed,
so the record could credit somebody who did nothing. His real sentences run to
more than one line routinely — the one from 1 September does.

Resume now refuses a quote that spans lines and asks for it joined onto one,
rather than quietly reflowing it: his words are the evidence here, and a script
that rewrites the evidence without saying so is not evidence. Underneath that,
the record-writing itself was patched so no reason of any kind — a pause's as
much as a resume's — can ever be cut in half or overwrite another fact.

A second review pass found that fix was only three-quarters of one, and the
missing quarter failed worse than the bug it was fixing. There is more than one
invisible character that ends a line, and only the common one was being caught.
A quote carrying one of the other three sailed straight through the new guard —
and then, because of how the record is read back, its reason was dropped
*entirely* rather than cut in half. The resume would report success and print
Dane's words back to whoever ran it, while the ticket recorded no reason at all.
That is precisely the 1 September situation this whole change exists to prevent,
arriving through the guard written to prevent it. All four characters are now
treated as one thing, defined in a single place so the check that refuses them
and the code that stores them cannot drift apart. The paragraph above this one
now says something true; when it was written it did not.
## 2026-09-04 — The drift check had a blind spot the size of the whole queue (#608)

`npm run reconcile` is the housekeeper that compares the ClickUp board against
what is really on GitHub, and says when the two have drifted apart. It sorted
every ticket into one of two piles — "being worked on" and "finished" — and
checked each pile for a different kind of mismatch.

The queue itself was in neither pile. A ticket that is waiting to be picked up,
or that has been sent back for rework, fell straight through the gap: not
reported as a problem, not even reported as "I could not check this one". The
run finished, said everything was clean, and meant nothing of the sort.

The case that matters is a ticket sitting in the queue that has *already been
built*. It looks untouched, so the next build session can pick it up and build
the same thing a second time, on a second branch, fighting the first — which is
exactly the collision that cost a whole day's work back in August. The one
safety check that would catch it could not see those tickets at all.

The housekeeper now checks the queue too. If the ticket's pull request is still
open, it says so loudly and writes a note on the ticket itself, where the next
session to pick it up cannot miss it — but it changes nothing, because only a
reader can tell whether the ticket is stale or the branch is. If the pull
request has already merged, the work is live and the ticket is closed out
properly. If the branch was abandoned, that is fine and it says so.

On its very first real run it found two live examples, one of each kind. And
the list of statuses is now kept in one place instead of three, with a test
that fails if a new status is ever added and forgotten — which is precisely how
this hole opened in the first place.

Review sent the first version back, and three things changed. The alarm was
firing on tickets that were perfectly healthy: a ticket sent back for rework is
*supposed* to still have its branch and its pull request open — that is what a
send-back is — so the housekeeper was going to raise a false alarm on every one
of them, forever. It now treats the two kinds of waiting ticket differently. A
ticket nobody has started that already has a branch is still a real problem and
still gets said out loud; a ticket sent back for more work is reported as
normal, and the report says why.

The second problem was a loop. The note the housekeeper leaves when it closes a
ticket tells the reader "if this is wrong, reopen the ticket and say so on it" —
but reopening puts the ticket right back into the pile it had just started
closing, so the next run half an hour later would close it again, and again.
It now leaves alone any ticket somebody has spoken on since the work merged.

The third was smaller and more dangerous: if a ticket's record pointed at an
older, finished pull request while a newer one was still open, it would have
closed the ticket over live work. It now stops and says the two records
disagree, rather than picking one.
## 2026-09-05 — The safety brake on the SQL hand-off check now actually works (#609)

When an agent finishes a turn, two automatic checks read what it was about to
say. One of them refuses the turn if the work added a SQL file you need to run
and the reply forgot to hand it to you properly. Any check that can refuse
needs a limit — it gives up after three tries, because a check that can refuse
forever can lock a conversation shut, which is worse than the thing it was
guarding against.

That limit works by keeping a small count on disk. If the count cannot be
saved, it reads as zero every single time, and "three tries" quietly becomes
unlimited. The ticket said this happened in the folders we actually work in,
and it used to — but that had already been fixed before this task started. What
had not been fixed was the same failure arriving a different way: the place the
count is saved can exist and still refuse to accept the file, because the disk
is full or the folder is read-only. Tested by deliberately making that folder
read-only, the check refused six turns out of six and would have kept going.

Two things changed. The count now has a second place to go if the first one
will not take it — and, more importantly, the check will only refuse a turn if
it managed to save the count somewhere. If it cannot keep score, it lets the
turn end rather than refusing with no limit. Separately, it now respects the
signal the system itself sends to say "this turn has already been blocked
once", which is a second, independent brake, so neither one failing on its own
can wedge a session.

That last part came back for a second round, because the first attempt at it
had the order wrong. The signal saying "this turn has already been blocked
once" arrives on exactly the turn where the agent supplies the missing
hand-off — that is what a continuation *is*. The check was stepping aside the
instant it saw the signal, before reading the reply, so it never noticed that
the hand-off it had asked for was sitting right there. It then demanded the
same file again on the next turn, and the one after, spending its whole
three-try limit on SQL you already had — and once that limit was spent, a
genuinely new SQL file added later in the same session went through unnoticed.
That is the check failing at the one job it exists for. It now reads the reply
and records what was handed off first, and only then steps aside. The other
check can step aside immediately, and still does, because it remembers nothing
between turns and so has nothing to lose by skipping one.

Two of the things the ticket asked for turned out to be wrong, and they were
corrected on the ticket before any code was written rather than built as
written. One of them asked this check to keep refusing when the `git` tool is
unavailable — but this check works out whether there is SQL to hand off *by
asking git*, so without it, it has no idea whether there is anything to
complain about. Refusing there would be refusing for no reason. It stands aside
instead.

Every fix was proved by breaking it on purpose and watching the specific test
for it fail. That also turned up a flaw in the new tests themselves: they left
a file behind, so running the test suite a second time failed for reasons that
had nothing to do with the code. They clean up after themselves now, and three
runs in a row pass.
## 2026-09-05 — One list of tags instead of two, and each tag knows where it came from (#611)

Starcaster had two separate lists of tags, and only one of them was ever being
used. `messaging_tags` has held the real ones since March — 149 tags across two
projects. The other, `asset_tags`, was created a few days ago alongside the
Media Manager and never had a single tag written to it: zero rows, in every
project. Dane asked for one list, with each tag recording where it came from,
and the fact that there was nothing to move across is what made this a small
change rather than a nervous one.

So the Media Manager's tag list now lives in the same table as everything else,
and a tag added through a client's own admin back-end is stamped as having come
from there. A tag added in the Starcaster back-end behaves exactly as it did
before — it simply does not claim an origin, which is the honest answer for it
and for all 149 tags that existed before the stamp did.

Two smaller things were worth getting right. The messaging side of Starcaster
squeezes every tag into hashtag shape — it capitalises it and throws away
anything past the third word — which is fine for "Junior Tennis" and wrong for
a photo tagged "Center Court North Entrance". Photo tags keep what was typed,
and there is now a test that fails if anyone quietly merges the two behaviours.
And the old list had a rule the surviving one did not: one project cannot end
up with "Courts" and "courts" as two separate entries. That rule came across
with it, because a tag list that splits like that is useless within a month.

One button had been quietly impossible to use, and this fixed it. "Clone Tag"
in Messaging names the copy by adding the word "Copy" on the end — but a
messaging tag is only ever allowed three words, so on a tag that already had
three, that fourth word was thrown straight back away and the copy came out
with exactly the same name as the original. The list refuses two tags with the
same name, so the button could never once succeed. It now understands that a
copy is not a new tag being invented: it keeps the name exactly as it is
stored, adds "Copy", and puts a number on the end if that is taken too. The
confirmation message says the name it actually used, because it is not always
the one you would expect.

A third round of review caught the same button doing something worse than
failing. Now that photo tags and messaging tags share one list, a photo tag of
more than three words sits in Messaging with a Clone button next to it — and
the button was still treating the copy as a brand new tag, so it ran the
three-word rule over it. Cloning "Center Court North Entrance" quietly created
a tag called "Center Court North": not a copy of anything, no "Copy" in the
name, matching none of the photos, and reported as a success. The fix is the
distinction the code had been missing all along — inventing a tag and copying
one are different acts, and only the first gets the three-word rule. There is
now a test that drives the real code against a stand-in database and fails if
a copy ever comes back without the original name inside it.

Two quieter things went with it. Adding a tag used to read the project's entire
tag list first, every single time, just to check the name was not taken — and
two of the bulk import tools do that in a loop, so importing six hundred tags
meant six hundred full reads of the table. That is the shape that has silently
cut long jobs off half way before. It now asks the database for the one tag it
cares about. And re-running an import with "force" on, where everything already
exists, used to report a hard failure: every tag came back "already there", and
"already there" was being counted as an error. For an import, a tag that
already exists is the job being done, so it is counted as skipped now, and a
genuine failure still counts as one.

The database needs one small change before the stamp can be stored, which is
Dane's to apply. Nothing breaks if it is not applied straight away: a tag
created in the meantime is still saved, and the screen now says plainly that
it could not record where the tag came from rather than reporting a silent
success. That warning existed in the code from the start but nothing passed it
on to anyone, so a tag added before the database change would have been stored
unmarked for good with nobody any the wiser.

Review caught two things before this went live, both of them at the new join
between the two lists. The first: a photo tag was being kept in full when it
was saved but shortened again every time it was *read*, so "Center Court North
Entrance" showed up in the Messaging tag list as "Center Court North". That was
worse than it looked, because opening that tag in Messaging to change its topic
filled the name box with the shortened version and saved it back — so a tidy-up
that had nothing to do with the name would have quietly renamed the tag for
good, and it would no longer have matched the photos filed under it. The
shortening now happens in one place only: when Messaging creates a brand new
tag of its own. Reading a tag, and saving one, leave the name exactly as it is.

The second: once Dane applies the database change, a project cannot have the
same tag twice. The Media Manager already handled that gracefully, but
Messaging did not — it would have shown the raw database complaint,
`duplicate key value violates unique constraint "idx_messaging_tags_project_tag"`,
in a little pop-up. It now says which tag already exists and, where the
shortening rule is what caused the clash, says that too — which matters for the
Clone button, since cloning "Junior Tennis Camp" sends "Junior Tennis Camp
Copy", the fourth word is dropped again, and it lands right back on the tag it
was cloned from. Renaming a tag onto an existing one gets the same sentence;
saving a tag without renaming it is untouched.
## 2026-09-04 — When a connection breaks, the screen now says what actually broke (#612)

The Connections screen shows one card per social account a client has hooked
up. A card turns amber when something has gone wrong with that account, and
that part has worked for a while. What it said, though, was always one of four
canned sentences — "the platform refused it", and nothing more.

Meanwhile a background check was quietly working out the real reason and
writing it down: this Bluesky handle now signs in as a different account, this
permission expires tomorrow, this one was withdrawn. Nothing ever read it.
Every one of those specific findings arrived at the client as the same vague
line. The card now shows the real reason, and still tells them what to do
about it.

The second half is a client pressing Connect and being turned down — an
Instagram account that is still a personal account, say. Instagram explains
exactly what to change, that explanation was already being carried back to the
screen, and the screen was throwing it away: the client landed back on
Connections with no idea why nothing had happened. Now the explanation appears
right under that platform's card, in Instagram's own words, with Connect still
there to press once they have fixed it. Reload the page and it is gone, the
way a message you have already read should be.

Worth recording how one of these was found: every automated test passed while
the screen showed nothing at all. The message was being read a fraction of a
second too late, after another part of the app had already wiped it off the
address bar. Only opening the page in a real browser caught it.

A review then caught what showing the real reason had opened up. That reason is
whatever the platform last told us, and platforms do not always answer in
sentences — when a gateway is having a bad day it answers with a whole web page
of error markup, and one of ours passes that straight through. A client's card
would have read "<!DOCTYPE html><html><head><title>502 Bad Gateway</title>…
Reconnect to fix it." A real explanation still comes through word for word; one
that is markup, or far too long to be a sentence, now falls back to the plain
canned line instead. Wrong-but-readable beats a page of code every time.

Two smaller things went in alongside it. If the list of accounts failed to load
in the moment right after a client was turned down, the explanation was shown
nowhere at all — and it had already been cleared off the address bar, so it was
gone for good. It now appears at the top of the panel when there is no card to
put it on. And the list of things the screen tidies out of the address bar had
drifted out of step with what actually gets put there.

A second review round then found the same page of error markup arriving by the
other door. The guard had been fitted to the amber card — the one that reads a
reason we stored earlier — but a client turned down at the moment they press
Connect gets their reason handed over on the way back to the screen, and that
path had no guard at all. Measured in a real browser, the Facebook Page card
read "<!DOCTYPE html>…502 Bad Gateway…" in amber. It is the same rule now, kept
in one place both halves read from, and applied where the server hands the text
to the browser — so the markup never reaches the address bar either. A platform
that answers in real sentences is still quoted word for word. And a very long
web address inside one of those sentences now wraps inside the card instead of
pushing it wider than the screen.

A third round then caught the fix breaking the thing it was protecting. "Far
too long to be a sentence" needs a number, and the number chosen was measured
honestly — against the background check's own wording, which never runs past
189 characters. It was then quietly reused on the other door, where the
sentences are much longer, because Instagram's explanation ends by naming the
client's own account and Page: *"…The account we found is
@delraybeachtennisctr on your Page "Delray Beach Tennis Center & Swim and
Racquet Club"."* Ordinary names push that past the limit, so the very sentence
this whole piece of work exists to deliver was being thrown away and replaced
with "Instagram refused the connection" — no hint that the answer is to switch
the account type in the Instagram app. Two other refusals had it worse: the
one about a missing Page permission went over the limit for *any* client whose
Page has a name at all.

So each of the two doors now carries its own limit, measured against the
sentences that actually come through it, with the worst case written down
beside it. And the check refuses to run at all unless it is told which door it
is on — no more inheriting a number that was measured somewhere else, which is
the mistake itself rather than the symptom.
## 2026-09-04 — Background jobs get out of your way on ClickUp (#605)

ClickUp lets our whole company make about a hundred requests a minute — one
allowance shared by every automatic job on the Mac Mini and by whatever session
you happen to be talking to. Until now nothing knew that. Each program counted
only its own requests, so a background job could truthfully report "I have only
used 97" and still be refused, because four other programs had been spending at
the same time. That is what took the relay down on 3 September.

Your decision that day was that background jobs get out of the way — "you are
never blocked by a background job" — and this is that, made mechanical. Every
program on a machine now writes what it spends into one small shared file, so
they can all see each other. A background job stops once the minute's budget is
down to the last 25 requests, says out loud what it did not get to, and does
not pretend it finished. A session you are talking to never stops, even at the
very last request.

The 25 was measured rather than picked: a new command reads the relay's own log
— 854 real passes over ten days — and five real interactive commands run back
to back inside one minute turned out to cost six requests in total. So the
reserve is four times the busiest interactive minute actually observed. The
cost is stated too, rather than discovered later: about one relay pass in six
will now stop early and finish on the next one instead of running the budget
down to single digits.

One honest limit, written into the code so nobody mistakes it for a promise:
this works within a single machine. The Mini and the MacBook spend against the
same ClickUp allowance and share no files, so this makes collisions rarer, not
impossible.
## 2026-09-04 — A merge that gets stuck now says so once, instead of forever (#606)

When you say "merge" on a ticket, a background job picks it up and tries. If
GitHub gives an answer it cannot make sense of, that job says so in its log and
tries again on the next pass, ten minutes later. Sometimes it can never make
sense of the answer, and the job would repeat itself in exactly the same words
forever — five identical passes over fifty minutes on 4 September, while you
had said "merge" nearly an hour earlier and had to ask what was happening.
Nothing counted the repeats and nothing ever said "this is the fifth time",
so a block that would never clear on its own looked precisely like one about
to clear on the next try.

Now it keeps count. If the same unresolvable answer comes back for ninety
minutes, you get one message — on the ticket and on the party line — saying how
long it has been stuck, how many tries that was, exactly what the answer said,
and which machine is telling you. Then it goes quiet until something actually
changes. It does not nag, and when the block clears it forgets it ever
happened, so the next one starts from zero.

The ninety minutes was measured, not guessed. Every stuck run in the job's own
history was listed: the ones that sorted themselves out took up to 54 minutes,
and the ones that needed somebody to step in took 2 hours or more. Nothing at
all sits in between, and ninety minutes sits in that empty gap — late enough
that an ordinary wait never trips it, early enough that a real block does not
sit unmentioned for half a day.

Half of this shipped a few hours earlier (#604) and deliberately stopped short:
the part that remembers the count between tries sat behind a trap that would
have made it forget every time, silently, with every test still passing. That
trap is closed here, and the test that would have caught it is in place.

A review pass then caught a third version of the same problem, and it is worth
knowing because it is the sort of thing that only shows up against real data.
The job decided "this is still the same block I was counting" by comparing the
sentence GitHub gave it — and GitHub has two different ways of saying it cannot
tell, and swaps between them. Every swap looked like a brand new problem, so
the clock went back to zero and ninety minutes was never reached. Replayed
against the job's own log from that day, it would have spoken up about one of
the three genuinely stuck merges and stayed silent on the other two, including
the very one this work was written about.

It now recognises a stuck merge by which pull request and which version of the
code it is stuck on, rather than by the words GitHub happens to choose. The
message still quotes what GitHub said most recently, and says how many times it
changed its mind. The same review turned up two smaller gaps, both closed here:
merges the system approves on its own were not being counted at all, and a
ticket with no pending merge instruction was being read as "the problem went
away". The proof is a test that replays all four of the stuck merges from that
day, pass by pass, at the real ten-minute spacing — the three that needed a
person get exactly one message each, and the one that sorted itself out in
under an hour stays quiet.

A second review pass then found that the whole thing was still silent in
practice, and the reason is worth writing down because it is a trap anybody
could fall into. The job decided whether an answer counted as "GitHub cannot
tell me" by looking for those words in the sentence — and a change that shipped
earlier the same day had reworded that sentence and taken the words out. So the
counter was watching for a phrase the system had stopped saying. It was worse
than simply not counting: an answer that did not match was treated as "the
problem has gone away", which wiped the clock every time. Replayed against the
real log, the version that had already passed every check and gone green spoke
up about none of the three genuinely stuck merges.

The fix stops reading the sentence at all. The part of the system that works
out what GitHub said now labels its own answer — "I got a real reading" or "I
could not tell" — and the counter reads the label. Wording can change freely
from now on without unhooking anything. A check on the source itself refuses
any future answer that does not carry a label, which is the check that would
have caught this the day the rewording landed, and the replay test now builds
its examples by asking the real code what it says today rather than by quoting
what a log said in September. Replayed that way, all three stuck merges get
exactly one message and all six that sorted themselves out stay quiet.

One more small thing was fixed alongside it: when the system catches a branch
up by itself, it was recording the version of the code from just before that
push rather than just after, so the very next try thought it was looking at a
new problem and started the ninety minutes over. That happened once per
catch-up, and catch-ups are now routine.

## 2026-09-03 — X: a client can post to their own X account, not to Starcaster's (#563)

Until now, when Starcaster posted to X on a client's behalf, the post actually
went out through Starcaster's own X account. There was one set of X keys for
the whole platform, and no way to sign in as anybody else. This adds the
missing half: a client presses Connect on the Connections screen, approves it
on X's own screen, and from then on their posts go out as them.

Dane's own X posting is untouched and keeps working exactly as before. A
client with no X connection still goes out the old way, on the same code, so
nothing that works today can stop working because of this.

The reason this was more than "add another platform" is that X has two
completely different ways of signing in, and the one Starcaster already used
cannot represent anybody but the account it was set up with. So the second way
had to be built alongside it, and the two now have to coexist without ever
getting muddled — a post signed with half of one and half of the other belongs
to nobody, X rejects it, and the error names neither account. The code makes
that mixture impossible to build rather than merely unlikely.

One small thing that turns out to matter a lot: an X permission expires after
about two hours. The renewal machinery built last week could never actually
renew one, and it needed two separate things to be able to: the value it
renews *with*, and the deadline that tells it when to bother. Neither had
anywhere to travel. Facebook and Instagram never noticed, since their
permissions do not expire.

Both are carried now. The first was fixed in the original round of this work;
the second was caught in review, and it was the one that mattered more,
because it failed *silently*. Everything looked right — the permission saved,
the card went green, the renewal check ran on schedule and reported success —
and it renewed nothing, because it had never been told when the permission
runs out and read that silence as "this one lasts forever". A client's posts
would have started failing an afternoon later with nothing anywhere saying
why. A permission that arrives without the means to renew itself is also now
refused outright rather than saved, for the same reason.

Two smaller things were corrected alongside it. When X refuses a client's post
for want of permission, the message used to send whoever was reading it off to
Starcaster's own developer settings to change a key that has nothing to do
with that client — it now names the connection that actually needs redoing.
And image posting is flagged, in the code, as unproven: it goes through an
address X has announced it is retiring, nothing here can test it without a
live X account, and it was carrying a comment that claimed otherwise.

Before any of this can be switched on, X's developer site has to issue two new
values and be told the address to send clients back to. Until that is done the
Connect button says so in plain English, and says which two values it means —
they are easy to confuse with the ones already saved.

One last thing came out of storing that deadline, and it was hiding in a shared
piece of plumbing rather than in anything to do with X. Every stored date passes
a check that refuses impossible times — hour 25, minute 61, the 30th of
February. That check was reading the seconds wrongly. Clocks in this system
record time down to the millisecond, so the seconds arrive as something like
"59.096", and the check compared that against 59 and decided a second which does
not exist had been supplied. It was right about 60. It was wrong about every
fraction of the 59th, which is one ordinary second in every sixty.

Nothing had met it before, because no part of the connection code stored a real
deadline until this work. Now every X connection stores one — so a client who
happened to press Connect in the last second of a minute would have been told
their account could not be saved, with a reason nobody could act on, roughly one
attempt in sixty. It also explains a test that had been failing at random. The
check now reads the whole seconds and ignores the fraction, so 60 is still
refused and 59.999 is correctly a real time.

Review then found the thing all of that had made reachable, and it was the
worst kind: it looked like success. Storing the deadline was right, but two
places treated "past its deadline" as "dead" when what it actually means is
"nobody has renewed it yet". A client's X permission lasts about two hours. Any
project that went an afternoon without posting was past that, and from then on
every post it sent went out on Starcaster's own X account instead — with the
card still green, nothing written to any log, and the whole point of this work
quietly reversed. The renewal machinery was sitting right there and worked
perfectly; nothing ever asked it, because it only ran on permissions that had
NOT yet run out, which is exactly backwards.

The second place was the scheduled health check, and it made the first one
permanent. On finding a lapsed permission it wrote it off as dead without
trying to renew it — so once the check had been past, that account was
finished for good rather than until the next renewal.

Both now try renewing first and only give up if the renewal genuinely fails,
in which case they say which account and why. A permission the client or X
actually withdrew is still refused outright: only the clock is recoverable, and
no amount of renewing overrules somebody taking a permission back.

One trap had to be avoided on the way. The act of renewing a permission also
marks that account as the most recently touched — and "most recently touched"
is how Starcaster decides which of a client's accounts to post from. That is
right when the renewal happens because a post is about to go out. It would be
badly wrong on a schedule: a client with two X accounts would find their posts
drifting onto whichever one the health check happened to renew last, on a
timer, with nothing visibly wrong. The scheduled renewal is marked not to
re-elect. The test proving it does that had to be rewritten once — the first
version could not actually fail, because everything in a test happens inside
the same millisecond and the ordering it was checking held by accident.

Finally, the note about image posting being unproven moved out of the code and
onto the card the client actually reads, and a sign-in route that could never
have completed an X connection — it dropped one of the two values the sign-in
needs — was fixed. Nothing visible was broken by that second one, because the
live screen uses a different route, but a route that looks like it works is
worse than one that is missing.

A third round of checking found the same accident arriving through yet another
door, and this time the answer was to close the room rather than the door.

The door: if X could not be reached at the moment a client's permission needed
renewing — a momentary outage, a slow answer, a busy signal — the system wrote
that permission down as dead. Not "not renewed yet". Dead. And "dead" is a
verdict it never revisits, deliberately, because a client who takes their
permission back must not have it quietly renewed. So one bad second at X ended
the connection for good, the client's own permission still perfectly valid, and
every post from then on went out on Dane's account with the card still green.
The distinction that was missing is an ordinary one: X saying "no" is an answer,
and X not answering at all is not. Only the first is written down as final now.
The second says so on the card and is tried again on the next post.

The room: for every other platform, the account Starcaster falls back to is
Starcaster's own — wrong, but institutional. For X it is Dane's personal
account. Three rounds of review each found a different route by which a
client's post could end up there, and each was closed individually. So the rule
is now stated once, at the exit itself: if a project has its own X connection
and it cannot be used right now, the post does not go out at all, for any
reason — including a reason nobody has thought of yet. It fails loudly, says
which account and why, and can be retried. A project with no X connection is
untouched and still posts the old way, which is Dane's own posting and the one
thing that must not change.

Two smaller repairs went with it. A permission already past its deadline whose
stored value could not be read was leaving a green card on a connection the
clock had plainly condemned; it now goes amber and says why, without being
written off, because failing to read our own records is our fault and not a
verdict about the client. And the client identifier is now sent on the three
calls to X that identify Starcaster as an application — X's own published
examples include it, leaving it out would fail every client sign-in, and adding
it costs nothing if it turns out to be optional. That one is unproven against
the live service, as everything about X here still is.

Something was also wrong with the tests themselves, and it is worth recording
because it made a whole class of checking worthless. The test scaffolding
rebuilt its fake database for each test but let one module keep talking to the
previous one — so any test asking "what did this actually write down?" was
reading an abandoned copy. No test had ever asked that question, so nothing
noticed. The reproduction for the fault above is the first one that had to, and
it passed on its own and failed alongside the others until the scaffolding was
fixed.
## 2026-09-04 — A pull request that could never merge, saying it was about to (#597)

Every task adds one line to the top of the work log, so any two jobs running at
once always bump into each other there. Years ago we told git "on that one file,
just keep both entries" — and git does exactly that. The trouble is that GitHub
answers two different questions about merging, and only one of them respects
that instruction. When GitHub actually performs a merge, it obeys. But the little
"can this be merged?" badge GitHub works out in advance and shows on the pull
request does not — so a branch that merges perfectly can wear a red CONFLICTING
badge.

That badge is not just cosmetic. GitHub refuses to auto-merge anything it has
badged, so the pull request stops dead: every check green, the merge armed, and
nothing happening. That is what happened to #585 yesterday. You had said
`merge`. The relay checked, correctly noticed that GitHub and git disagreed,
declined to call it a conflict — and then told you five times over fifty minutes
that auto-merge was armed and would land it. It was never going to.

Two changes. The note in the settings file that claimed GitHub honours the
instruction everywhere now says which question gets which answer. And the relay
now performs the fix instead of describing it: when GitHub says conflicting and
git says clean, it merges `main` into the branch and pushes, which clears the
badge in seconds — exactly what clearing #585 by hand did. It writes a note on
the ticket when it does, because a machine pushing to your branch on its own
initiative should never be silent. If the merge turns out to genuinely conflict,
it aborts and hands off untouched, and it never force-pushes.

## 2026-09-04 — Every script that talks to ClickUp now goes through one door, so the budget is finally a real number (#592)

ClickUp only allows us about a hundred requests a minute, and that allowance
belongs to the *login*, not to any one script — one allowance shared by
everything we run. Until yesterday six different pieces of our machinery each
opened their own connection to ClickUp and none of them had any idea the
others existed. So there was no way to ask the obvious question: how much of
this minute's allowance have we already spent? On 3 September that cost us a
day. One job was quietly burning 114 requests a minute against a hundred-a-minute
allowance, got refused on every single pass, and the lane that merges finished
work sat dead for 271 passes in a row before anybody noticed.

Yesterday's ticket built the single shared door and moved the biggest script
through it. This one moves the last four: the pause switch every loop asks
before it starts, the hourly health check on the Mini, the gate that runs in
GitHub on every pull request, and the piece that files a bug report when one
comes in. From here the count is a count of *everything*, which is the only
kind of budget worth having.

One of those four had been invisible the whole time, and that is the part
worth remembering. The bug-report forwarder never *looked* like it was calling
ClickUp — it picked its connection up in a roundabout way, so the automatic
check that hunts for stray connections read clean while the forwarder spent
requests nobody was counting. There is now a second check that looks for that
sleight of hand, and we deliberately broke it to watch it catch it.

The first version of that second check only recognised *one way of writing*
the trick, while the note above it told the next reader that the whole trick
was covered. Review caught it, and that overclaim was the real defect: a guard
that says more than it does is worse than no guard, because the next person
trusts the sentence and stops looking. It got better at this three times over,
and each round the note above it still promised a little more than the check
below it delivered.

So this entry is not going to make that promise a fourth time. The check now
recognises several more ways of writing the trick, each one named and
separately proved catchable, and it decides which files to inspect by looking
for ClickUp itself rather than for a variable name that three unrelated files
happen to share. What it does **not** do is guarantee that no second door
exists anywhere in the repo, and review found three specific ways past it that
still work. Dane's call was to ship the migration — which is the valuable half,
and is correct — and to book the guard's remaining holes as work of their own
rather than spend a fifth round on them. That is ticket 86bbuzq5f, and the
probes review used to find each hole are already written down there as the
things it has to make fail.

The lesson underneath four rounds of this is worth keeping: we were trying to
prove a rule about the *whole repo* by searching the text of the code for
patterns, and English sentences describing a rule will always outrun the
patterns that look for it. Whether that check should keep scanning the text at
all, or should instead watch the running program and object the moment a
request goes out the wrong way, is the open question on that ticket.

The riskiest piece was the gate that runs inside GitHub, because its ClickUp
login has quietly expired on us before, and a gate that keeps answering while
its login is dead is worse than one that stops. It also sat in a file that
starts running the moment anything touches it, which meant nothing could test
it — so what it does with a missing or dead login had never actually been
checked by anything. We moved those calls somewhere testable and wrote that
test **before** changing how they connect. It does not simply check for the
right wording; it runs the *old* code alongside the new one and insists they
give the same answer for a healthy reply, an expired login, a revoked one, a
refusal, and a ClickUp that cannot be reached at all.

There is exactly one case where the two do *not* agree, and this entry claimed
otherwise until review checked. When ClickUp answers normally but sends back
something that is not readable at all, the old code called it "ClickUp is
unreachable" — which is the one thing it definitely was not; it answered. The
new wording describes the reply that actually arrived. Nothing downstream
changes: the gate says "cannot tell" either way, and only the sentence a human
reads is different. That difference is now written down as a test of its own,
so it is a decision on the record rather than something a future reader has to
rediscover by diffing.

Review then flagged that the one test which uses the real connection was
secretly calling ClickUp on every test run. We measured it rather than
assuming, and it was not: the test file points the ClickUp address at a
deliberately non-existent one before it starts, so the request goes nowhere.
Recording that here because the mistake is an easy one and we made it too at
first — running that code from a scratch file behaves differently from running
it under its test, on purpose. The suggested fix was still worth doing for a
different reason, so we did it. The test now hands the machinery a stand-in
connection of its own, which means it depends on nothing outside the computer
it runs on, and it proves more than it used to: not merely that *a* counter
moved, but that the shared door itself was what carried the request. A version
that quietly went around the door, with everything else about it correct, now
fails. So does one that forgets to put the stand-in back afterwards.

All four commands were photographed before and after: two are identical down
to the byte, and the others differ only in their clocks and in which tickets
happened to be moving at the time.

Review sent it back once more, and this time the finding held up. The check
that hunts for stray connections to ClickUp was only opening **two** of the
codebase's folders, while the note beside it told the next reader that every
ClickUp request in the whole codebase was accounted for. We proved it by
measurement rather than by reading: we wrote an obvious stray connection into
two of the folders it never opens, ran the check, and it reported all clear —
twelve checks, twelve passes. One of those folders is not hypothetical; it is
where the live request path that files a bug report actually lives, which is
one of the very things this ticket moved. The check now starts at the top of
the codebase and walks all of it, skipping a short list of folders that each
say in writing why they are skipped — the code that runs in a visitor's
browser (which cannot use the shared door at all, and must never carry our
login), retired code that nothing runs, and other people's code.

The more useful half is a check on the check. Everything here could already
prove it was able to *spot* a stray connection; nothing proved it was ever
*looking at the file*. A guard can go blind in either direction, and a guard
that has quietly stopped opening a folder looks exactly like a codebase with
nothing wrong in it. So it now fails outright if it stops reaching any folder
that has code in it today, naming which one went missing, and it fails if the
skip list ever names a folder that no longer exists — because that entry would
be silently excusing whatever folder later took the name.

One more sentence had stopped being true. The note at the top of one file told
the next reader to hand it a stand-in connection under a name the code does not
accept. Nothing would have gone wrong loudly: an unrecognised name is ignored
in silence, so their stand-in would simply never run and the real login would
be used instead — inside GitHub, on every pull request, while their test
reported success. That is the third time this one ticket has been sent back for
a sentence sitting beside a check that no longer matched it, so rather than
just correcting the sentence we made it fail on its own: a test now reads the
note and the code together, and complains if the note names anything the code
will not take.
## 2026-09-04 — The Pages list stops claiming every page uses the same template (#598)

On Builder: Pages, the Template column said "Standard Right-Form" on every
single row, and the Template dropdown above it listed "Standard Right-Form"
five times over. Neither was true, and both came from the same mistake.

A page carries two template-ish values that mean different things. One is a
leftover layout name the server makes up from the page's own web address, and
it names no template at all. The other records which saved template the page
was actually built from. The screen was reading the first one — and the code
that turns a value into a name ends with "…or if you don't recognise it, give
me the first template in the list". The first template in the list is Standard
Right-Form. So every value it could not recognise came out wearing that name,
on every row. The dropdown then added one entry per unrecognised page, each
labelled through the same guess, which is where the five identical entries
came from.

The column now reads the value that actually means something, and the code
behind it never guesses: it gives the template's real name, or says "No
template" when a page genuinely has none, or says "Unknown template" and shows
the value when something is set that names nothing. That last case is a real
data problem and should look like one rather than hiding behind a plausible
name. The dropdown is rebuilt from real templates only.

Two problems turned up only because the screen was opened and used rather than
just read. The same list of options was also filling the bulk-edit dropdown,
which *writes* to pages — so it could have offered "No template" as something
to save onto them. And real template names are longer than the fake one had
been, so a long one ran straight across the neighbouring column and made the
web addresses unreadable; it now shortens with the same word-boundary
cropping the other columns already use, with the full name on hover.

Checked against the live database first, because the whole change depends on
that second value existing there: it does, and 116 of the 136 pages have one.
Nothing about the database was changed.

## 2026-09-04 — A job that has stopped working now says so within hours, not the next day (#596)

On 3 September the step that merges finished work was dead for sixteen hours,
and nothing told anybody. Four separate reporting surfaces were all working
correctly and all stayed quiet — one of them cheerfully reported everything as
fine.

The reason turned out to be about resolution rather than about anything being
broken. Each scheduled job records a "beat" when it runs, and those beats are
copied to a shared ClickUp ticket at most once a day so both machines can read
them. That is the right arrangement for noticing a machine that has been
switched off. It is useless for noticing a job dying on a machine that is wide
awake, because a perfectly healthy job legitimately shows up as twenty-one
hours old between copies, and nobody reading that can tell it apart from a dead
one.

There has always been a second copy of every beat, written on the machine
itself, on every single run, accurate to the minute. Nothing was reading it.
Now something does, every ten minutes, and it speaks up once on the party line
when a job it owns has stopped.

The interesting part was choosing how long to wait before calling a job dead.
The ticket proposed one hour, and required that the number be measured before
being trusted. Fourteen days of this machine's real logs said one hour would
have gone off about once every ten runs, on jobs that were working perfectly —
and this project had already had to kill one alarm for that exact reason a
couple of days earlier. The finding that settled it was that the biggest
ordinary gaps are not glitches at all: when a loop hits a usage limit it reads
the stated reset time and deliberately sleeps for hours, which is precisely the
right behaviour and would have been reported as a fault. So the threshold is
worked out per job from that job's own rhythm, with a floor, and lands at three
hours for the fast one and six for the rest. Not "within the hour" — but it
turns a sixteen-hour silence into at most six, and it will not cry wolf.

Two things the original ticket assumed turned out not to be true, and both were
corrected on the ticket before any code was written rather than quietly built
as described. And the command that reports on the automatic merge lane now says
in words whether that lane has ever merged anything at all; it used to print
"RUNNING" beside a note that no merge had ever happened, which reads as healthy
and described a lane that had never once done its job.
## 2026-09-04 — A repair on a timer was taking tickets away from builds that were still running (#595)

When a build loop starts a job, it moves that job's ticket to **Building** and
leaves a small note on disk saying "I have this one". If the loop dies partway,
that ticket would sit in Building forever, because nothing ever picks work up
from there — so a repair step exists to find the abandoned note and put the
ticket back in the queue.

That step decided a build was dead from one fact: the ticket is in Building.
Which is a fair guess in the one place it was written for — it runs as the very
first thing a new build pass does, and a new pass starting really does mean the
old one has finished.

Then the same repair was put on a timer, running every ten minutes. A clock
going off tells you nothing about whether a build is still running. So any job
taking longer than half an hour had its ticket pulled out from under it and put
back in the queue while it was still being built — it happened twice in one
morning. For that stretch the ticket was sitting there available with a live
build already on it, so a second loop could have started building the very same
thing on a second branch. Two loops doing one job is the exact problem the
claim system was built to prevent, and it was arriving through the machinery
meant to guard against the opposite. Neither side got a warning: the build
carried on unaware, and the hand-back note read like ordinary tidying.

The repair now says which seat it is sitting in. Called by a new build pass, it
behaves exactly as before. Called by the timer, it looks at how old the claim
is instead — under ninety minutes it leaves the ticket alone and says why, over
that it hands it back as it always did. A claim whose timestamp cannot be read
is left alone too, and says so out loud rather than quietly picking a side.
The ninety minutes is not a new number; it is the same one the stranded-ticket
sweep already uses, borrowed rather than copied so the two cannot drift apart.

The ticket that reported this suggested checking whether the recorded process
id was still alive. That turned out not to work: the id belongs to the tiny
command that writes the claim note, not to the build itself, and it is gone
within seconds. Checking it would have called every claim dead — the same bug
wearing new clothes — and process ids get recycled, so it would occasionally
have done the reverse and left a ticket stranded for good. That correction went
on the ticket before anything was built.

The cost, stated plainly: a build that dies five minutes in now waits up to
ninety minutes for the *timer* to clean up after it. It does not wait for the
ordinary repair, which still happens the moment the next build pass starts. A
ticket repaired late is visible sitting in the queue; a ticket built twice is
silent and expensive.

Review found three things wrong with that first version, all now fixed.

The "I cannot tell how old this claim is" case could never actually happen.
Reading the note off disk was quietly filling in a missing timestamp with the
current time, so a note with no date read as "claimed just now" — and because
every timer run is a fresh start, it read that way again on the next run, and
the one after, for as long as you like. The ticket would never have been handed
back and the honest "I cannot tell" answer could never have been given. The
clock now belongs to the moment the claim is made and to nowhere else; reading
a note never changes what it says.

The tidy-up note the repair leaves on a ticket was crediting the wrong thing.
It said the next build pass had returned the ticket, when on a timer no build
pass ran at all — the scheduled repair did — and it printed a command to
reproduce it that was missing the very flag that makes it the scheduled
version. Anyone re-running the line as written would have got a different
program. The note now names whichever one actually ran, and prints the command
that matches.

And the ninety minutes is now measured the same way in both places that use it.
It was the same number but a different starting line: the stranded-ticket sweep
counts ninety minutes since anything last happened on the ticket, while this
counted ninety minutes since the claim was made and never looked again. So a
build that had visibly done something ten minutes ago could still be declared
dead, and the two halves of one repair run could disagree about the same
ticket. It now counts from whichever is more recent — the claim, or the last
sign of life on the ticket.

Worth recording, because it happened while this very fix was being written: the
timer took this ticket away from the build working on it, at 10:28, and left
the note crediting a build pass that never ran. Both defects, live, on their own
ticket.
## 2026-09-03 — Three watchdogs saw a stuck ticket and none of them reached you (#586)

A ticket you had already said `merge` on sat in "Ready to launch" for twelve
hours. Its pull request was already merged; the work was already live on the
site. Three separate watchdogs were awake and pointed straight at it, and not
one of them said anything. The loudest reported "nothing is stuck" — honestly,
because its rule was "say something after 24 hours", and twelve is less than
twenty-four. You found it by asking about an unrelated ticket that looked odd.

There are two clocks now. A ticket nobody has touched still gets its 24 hours:
you have not said anything about it, and nagging you about work you never asked
to be finished is how a watchdog becomes noise. A ticket carrying your own
`merge` comment is a different thing entirely — you have said what you expect —
and it is now flagged after **two hours**.

The part that matters is what those two hours are counted from. Not the
ticket's "last changed" time, which is what every clock here used before: any
edit at all resets that, and this ticket collected twenty-five automated
refusal comments while it sat there. A clock reading ticket age would have been
reset, over and over, by the exact refusals it exists to notice. So the fuse
burns from **your comment**, which nothing can reset. A ticket that looks four
minutes old by the old measure is still caught, and there is a test that fails
if anyone ever points it back at ticket age.

The two hours are not a new number. They are read from the threshold the system
already gives a build in flight — your words, "no new constant enters the
codebase without a sibling" — and a test pins both ends, so retuning one of them
fails loudly instead of quietly moving the other.

The second watchdog, the one that had named this ticket exactly and reached
nobody, got the two habits a background job owes. It asks the pause switch
before it does anything, so it stands down while you have the deck. And its
messages now expire after six hours and clear when the problem is fixed — before
this, a problem reported once was struck off forever, which is an alarm that
fires the first time and then never again. A check that stood down for you now
reports "paused" rather than "clean", because a pass that looked at nothing must
never read as a healthy one.

Both tools also now say what they cost. A drift pass spends 32 requests against
ClickUp's roughly one hundred per minute; the new fuse adds one per ticket in
the stage. That was measured rather than guessed, because the ticket asked for
it — and the measuring turned up something larger, which is written on the
ticket rather than fixed here: the ten-minute relay is already spending 108 to
114 requests a pass and is retrying against the limit thirty-six times in the
current log. Two tickets already own that problem.

The third thing the ticket raised is not solved and is not claimed to be: all of
this still reports to the bus, and the bus was not read. Saying so plainly is
the honest half of the fix.

Review sent this back once, and it was right to. The drift watchdog asks the
pause switch by running it and reading the answer — but the switch has two ways
of saying "no", and this code was hearing them as one. "Dane has the deck" and
"I could not reach ClickUp to find out" both come back as the same refusal, on
purpose, because both must lead to the same action: stand down. What they must
never share is the sentence. The first version printed *"Dane has the deck"* for
both, so a rotated token or a rate-limited read — and the relay is currently
retrying against that limit thirty-six times a log — would have made the
watchdog announce something about you that it had no way of knowing, then go
quiet indefinitely while every board stayed green. That is the exact shape of
failure this whole ticket was written to close, arriving through the check meant
to close it.

It now says "could not tell", does not mention you, and reports differently
enough that the surrounding job reads the whole pass as CANNOT TELL rather than
as a healthy paused one. The action is unchanged: it still stands down, which is
the safe direction either way. Two other things came out of the same read — the
switch call and every step of the repair job now have a time limit, so a call
that never answers can no longer pin the ten-minute cycle with nothing to break
it, and the request counter counts requests that were actually sent rather than
attempts that never left the machine, which matters because that figure is the
one being budgeted against.

Review sent it back a second time, and that one was not about the work at all:
the main line of code moved underneath it in the two hours after the pull
request went up, and it landed in the one file this ticket's headline
measurement lives in. Two people had solved the same small problem within a day
of each other — how do you count what a pass costs — and both answers were
sitting there, disagreeing on purpose about what counts as a request. Keeping
both would have left the report with two numbers and nothing saying which one it
meant. There is one now, and the argument that lost is written down beside it,
because the losing argument is the part a future reader needs.

Underneath that was a worse one, and it is the kind of thing that never
announces itself. The same two days had each given the same exit code a meaning:
one branch made "3" mean *you have taken the deck, so I stood down*, the other
made it mean *I just closed a ticket*. Both were right on their own. Merged
carelessly, a pass that had just changed the board would have been read by the
supervising job as a pass that politely declined to run — and reported as
"paused". Nothing would have failed; an exit code is just a number, and every
check in the repo stays green through a wrong one. The decline keeps 3, because
that is what every other tool here means by it. Writing took a number nobody had
claimed. Two tests now fail if anyone ever collapses them back together, and one
of them reads both files to make sure the two ends still agree.

The last thing was a line nothing was testing: the very last line a drift pass
prints, the one reporting what it spent. It calls a function that lives in
another file, and if that name ever changed, the pass would crash **after**
doing all of its work — every ticket read, every repair applied, and then a
failure at the finish line. That is exactly what nearly happened here, and only
the merge conflict made anyone look. It is tested now, from both ends, and so is
the identical last line in the other watchdog.

The measurement was retaken through the surviving counter: **31 requests in 19
seconds** against a 340-ticket queue. That is the read half only — the writes go
out through a separate program with its own budget, so the printed number is a
floor, and it now says so. The repair job takes a fresh reading at most every
half hour, which 31 requests buys comfortably; it would not be safe on the
ten-minute cycle, and that throttle is deliberate rather than incidental.

## 2026-09-03 — A refusal that can never clear stops promising it will (#585)

When you comment `merge` on a finished ticket, an automatic step goes to GitHub
and merges it. Sometimes it cannot, and it says why on the ticket. Every one of
those messages ended with the same reassurance: *your approval is still
standing, you do not have to say merge again, the moment the reason above is
dealt with it goes through on its own.*

That sentence is true of some reasons and false of others, and nothing in the
system knew the difference. "The tests are failing" clears itself the moment
somebody pushes a fix — a later pass really does merge it. "This pull request
has already been merged" never clears. There is no later. But both got the same
comforting paragraph.

One ticket sat for twelve hours in the approved-and-waiting column with its
work already merged and live on the site, while the step posted twenty-five
messages telling you it was handled. Sixteen of them were for a reason that
could never come right. Then the messages stopped, because the system suppresses
a repeat that has not changed — so the ticket went from lying reassuringly to
saying nothing at all. It was only found because you asked about a different
ticket that looked stuck.

Every reason the step can give is now written down in one place and marked as
either *it will clear on its own* or *it will not*. A reason that will not clear
no longer gets the reassurance. It says plainly what it needs and who has to do
it — an agent session, or you — and that nothing further is coming, so nobody
reads it as progress. Anything the step genuinely could not work out counts as
the second kind: if it cannot honestly tell you to wait, it tells you to look.

A new reason cannot be added without deciding which kind it is. There is no
default and no way to skip the question; the step refuses to write the message
at all rather than guess.

The separate sweep that already noticed this exact situation — finished work
sitting in a column you have to move it out of — used to report it only in the
group chat, where it scrolled past with everything else. It now also writes it
on the ticket itself, once, where the next reader of that ticket cannot miss it.
It still never moves the ticket for you: that column is yours.

Review caught three things in the first version of this, all of the same shape:
the label saying which kind of reason it is was being *dropped* somewhere
between where it is decided and where the message is written. On one route that
made the message fall back to the reassuring wording again — the exact bug,
rebuilt. On another it stopped the hourly job dead partway through, so the rest
of that run's tickets were never looked at, which is the same silence in
different clothes. The label now travels with the answer everywhere, a mistake
like it can no longer take the whole run down with it, and a reason the step
genuinely *cannot* work out is now announced as "I cannot tell" rather than as a
confident "this will never clear".

The sweep's note on the ticket also had to be fixed to reach the tickets that
already had the finding. It was sharing one "already said this" marker with the
group-chat message, so on every ticket flagged before the note existed the note
was suppressed before it was ever written once — including a real one sitting on
the board. The two now keep separate markers, which also means either one
failing gets retried instead of being quietly written off.

## 2026-09-03 — Four checks that said "I could not look at this" and then reported a pass (#584)

Five of this project's checks work by opening a real web browser and looking at
the screen — do the settings panels line up, does a page fit its window, does
that button actually change anything. They are the only checks the automated
build system cannot run for us, because it has no browser. So when one of them
finishes, the single number it hands back — pass or fail — is the whole of what
anything else ever learns about it.

Four of the five had places where they could not see anything at all, said so
clearly in writing, and then handed back **pass**.

The clearest one: run the screen-layout check without first setting up its test
content, and it printed

> 9 screen-width combination(s) checked, 0 skipped, 0 failing.

That is word for word what it prints after a completely clean sweep. Three lines
higher it had already said the run was "hollow" — but nobody reads three lines
higher when the last line says nothing is failing, and no script can read at all.
Every screen it measured was blank.

The navigation check had the same shape from the other direction. It kept a list
of controls it could not test, printed that list, and then simply never looked at
it again when deciding pass or fail. If it had somehow lost every one of them it
would have announced "all 0 controls move the rendered page" and called that a
success.

So these checks now give one of three answers instead of two, which is the same
scheme the pipeline's own health report has used for a while:

- **passed** — I looked, and it is fine
- **failed** — I looked, and your change broke something
- **could not tell** — I could not look at all; this says nothing about your change

That third answer is the whole fix, and the distinction between it and "failed"
matters as much as the one between it and "passed". A missing test fixture or a
half-finished build is a problem with the *measuring instrument*, not with the
work being measured — calling it a failure sends whoever reads the log hunting a
bug that was never there.

Two of the five turned out to have been fixed back in August and were left
alone. Every path that changed was broken deliberately and the answer read off
the screen, rather than trusted because the code looked right.

**And then the review caught this fix making the exact mistake it was written
to remove.** In three places the new code asked "could I see anything?" *before*
it asked "did I find anything wrong?" — and because the first question quits on
the spot, real problems were never even printed. Break the page preview on
purpose and the rendering check went from correctly saying "failed" to saying
"could not tell": a genuine defect reported as a broken instrument. Worse in
the general case — a change that broke all 41 of its rendering rules would have
reported "could not tell" and listed none of them, because a rule that fails to
render was never counted as measured.

Both questions now go through the single shared rule that already knew the
right answer: a real failure outranks a could-not-tell, and a pass never does.
The two orderings were broken deliberately and read off the screen the same way
everything else here was — the old code says "could not tell" and prints
nothing, the new code says "failed" and prints all 41.

Four smaller things went with it: a run that reached only some of its screens
no longer calls the rest clean; the screenshot tool now answers only "fine" or
"could not tell", never "your change is broken", because it never judges the
change in the first place — it just takes the pictures; a setup step that
produces a lot of output is no longer killed for being chatty and then blamed
for failing; and the test that polices all of this now reads the code with the
comments stripped out, having twice matched its own explanations of the very
mistakes it was checking for.
## 2026-09-03 — Overlay screens get their own written record (#558)

An overlay screen is the layer of colour, gradient or picture that sits over a
row's background and under its words. It is what makes white text readable on a
photograph, and what stops a background video from competing with the writing on
top of it. It got its editor a few days ago, and until now the only thing
written down about it was four paragraphs buried inside the video-backgrounds
document — written back when an overlay was a detail of how video tinting
worked, rather than a feature in its own right.

It has its own document now, `docs/OVERLAY_SCREENS.md`, including a plain
section on what an overlay is for and where the controls are. Two things in it
are worth knowing even if you never open the file. The first is that there are
**two** opacity controls in that panel and they are not the same knob — one is
inside the colour swatch, one is the labelled Opacity row below it, and they
multiply. That is why an overlay sometimes looks stubbornly too faint with the
slider already at full. The second is the reason the document is named the way
it is: a setting in the Builder has four separate parts, and all of them have to
be there. The type, the bit that saves and loads it, the bit that draws it, and
the panel you change it in. This feature has now shipped **twice** with three of
the four working perfectly — the value saved, loaded and drew correctly, and
there was simply no way to reach it. Both times every test passed, because every
test was true.

Writing it turned up three things the task itself had wrong. It asked for three
follow-up features to be described as not yet built; one of them, gradient
direction, had already shipped, so describing it as unbuilt would have been the
exact mistake the task was trying to prevent, just pointing the other way. The
line references it gave had drifted by as much as ninety-six lines. And a
long-standing warning about there being three copies of one dropdown turned out
to describe two different mechanisms as if they were one. All three were
corrected on the task before a word was written, and the document says what is
actually true of the code today.

The list of what is built and what is not then went wrong twice more before this
landed, in opposite directions on the same three features — which is the best
argument for how it is now written. It no longer records where a feature stands
with a reviewer, because that changes hourly; it records only whether the code
is on the live branch, which anyone can check and which cannot go stale. All
three follow-ups have since shipped, so the "not yet merged" list is currently
empty, and it says so out loud rather than being deleted.

## 2026-09-03 — A safety brake that had never once been applied (#567)

When an agent finishes a turn, a check looks at whether the work added a
database script you have to run by hand, and refuses to end the turn until the
reply hands that script over as a clickable link. Because a check like that
could in principle argue with an agent forever, it was given a brake: after
three refusals in one session, give up and let the turn end.

The brake has never worked. Not once, since it was written.

It counted the refusals in a small file tucked inside the repo's hidden `.git`
folder. That works in the main copy of the project, where `.git` really is a
folder. But every piece of work here happens in a separate side folder, and
there `.git` is not a folder at all — it is a one-line text file pointing at
the real one. Writing a file inside a file is impossible, so the count was
never saved. The failure was caught and thrown away without a word, under a
comment reassuring the reader that losing the count cost "at worst one extra
prompt."

It did not cost one extra prompt. It cost the whole brake: with nothing ever
counted, the tally read zero forever, so the third refusal never arrived. The
same missing file also meant a script that *had* been handed over properly was
demanded all over again on the next turn, and the next.

Worth saying plainly: nothing bad has actually happened because of this. Going
back through every session on this machine, the check has genuinely fired five
times, each in a side folder, and each of those sessions complied on its very
next turn — so no session ever reached even a second refusal, let alone needed
the brake. The repair is a precaution, not a rescue.

The fix is to ask git where the real folder is instead of guessing. The more
interesting part is why this survived: the test covering the brake built its
practice repo in the one shape where the bug cannot appear, so it passed
cheerfully the entire time. The new tests build a genuine side folder and check
that the file `.git` really is a file before asserting anything — and reverting
the fix now makes them refuse forever, in writing, which is the only kind of
proof worth having. The same mistake had already been fixed a week earlier in
the twin check next door and left alive in this one, so the shared piece now
lives in a single file that both of them read.
## 2026-09-03 — A map on a directions page shows the map (#571)

Open the Delray directions page and you did not get a map. You got a grey
rectangle with a **Load Chart** button on it, and you had to click that before
the map appeared — on the one page where the map is the whole reason a person
went there.

That grey panel was doing a real job, just to the wrong thing. Some embedded
widgets — the crypto price charts in particular — snatch the page's attention
the moment they load and scroll you down to themselves mid-read. The panel was
built to hold those back until you ask for them. But it was put in front of
*every* embed, and nobody noticed, because inside the Builder the embeds always
showed straight away. Only visitors to the finished site ever saw the button.

Now the hold-back is only used on the handful of widgets it was built for. A
Google Map, a YouTube video, a Calendly booking form all appear as the page
loads, the way anyone would expect. Existing pages carrying a price chart are
untouched — the panel is still in front of those, and clicking it still works.
If you ever want to decide for yourself, each Code module has a new **Loading**
choice in its settings: leave it on Automatic, or say "load right away" or
"wait for a click" for that one module.

The button also stopped calling everything a chart. When it does appear, it now
says what it is covering — "Load map", "Load video", "Load embed".

## 2026-08-29 — One loose row above four tidy panels (#449)

Open the settings for a Confetti or Speech Bubble module and the controls sit
in neat columns, except for one row at the top — the "Trigger" setting, and on
Confetti the "Button Label" under it. That row was laying itself out by
proportion rather than by content: the single word "Trigger" was handed a
414-pixel label slot, and the dropdown beside it was stretched into the middle
of the panel and then stopped, leaving 268 pixels of empty space before the
edge. One sprawling row sitting above a set of tidy ones.

It now sizes itself the way every other block in a panel does — to its own
content — so the label and its dropdown read as a compact pair. Nothing was
made wider to fix it; the stretching was taken away.

The more useful half of this is that nothing had been *looking* at that row.
The browser check that enforces the alignment rules examines three kinds of
block, and this was none of them, so it was skipped in silence — the gap had
been passing as a clean green run for as long as the row has existed. It now
announces itself to the check, which picks up twelve more blocks than it
could see before.

Two of the mistakes on the way there are worth writing down, because every
automated check passed while the panel was visibly wrong both times. Pulling
the block in tight also squeezed the explanatory sentence under it from one
line into a five-line sliver; and the fix for THAT scattered Confetti's two
rows across three columns. Neither was caught by a test. Both were caught by
opening the panel and looking at it, which remains the only thing that can.

Two panels named in the ticket, Image and Floating Image, turned out to need
nothing — measuring them showed they already obeyed the rules — so they are
unchanged to the pixel. The shared row also appears on the two Proximity
Effect panels, which get the same improvement for free.

## 2026-09-03 — A tint on one column, not the whole row (#557)

You could already lay a coloured screen over a whole band of the page — the
thing that dims a photograph so the words on top of it stay readable. You could
not lay one over a single column inside that band. So a two-up row with a
photograph on each side offered exactly one choice: darken both, or neither.

Now each cell has its own Overlay group, with the same controls the row's has.
Tint the left column dark blue at 60% and the right one keeps its photograph
completely untouched.

Three of the checks that were supposed to be watching this could not actually
see it, and each was fixed and then proven by breaking the code on purpose:
the panel check was blind to the new group because its opacity control only
appears once an overlay is set and the test fixture had none — a deliberate
layout violation still reported a clean 660-panel pass; no browser check could
place content in a named column at all; and one test compared two positions to
prove the tint sits behind the text, which quietly passed even with the tint
element deleted entirely.

What the change does was then measured rather than argued about, by reading
real pixels out of a real browser: the tinted cell, the untouched one beside
it, and the words themselves, which come through at full strength.

Review caught the feature quietly re-stacking somebody else's decor, and that
is now fixed too. A floating image is a module like any paragraph, so the rule
keeping the tint behind the words reached it as well and pulled it down onto
the same layer as the text beside it. The image did not move, it just stopped
being reliably in front — at equal layers the browser falls back to whichever
came first in the page. Only a column that had just been given a tint was
affected, so nothing already published changed. A browser check now measures
that exact arrangement — a floating image and ordinary words in one tinted
column — and it was watched failing on the old rule before the fix went in.

Review then found the other half of that same problem, one column further
over. A floating image is often set to hang out past the edge of its column on
purpose — there is a control for exactly that. Switching on a cell tint had
been sealing the column off as its own self-contained layer, which sounded
tidy and meant the image's "sit in front of everything" instruction now only
applied inside that one column. The moment it crossed into the next column, it
went behind it. Nothing moved and no number changed; only the answer to which
thing is in front. That sealing turned out to be unnecessary — the tint sits
behind the words because it is numbered below them, and that holds whether the
column is sealed or not — so it is gone, and a floating image reaches over its
neighbour exactly as it did before this feature existed.

Finding it needed a tool the browser checks did not have: they could read the
layer numbers on every element and all of them were identical before and
after. What changed was what a person would actually SEE. So the checker can
now point at a spot where two things overlap and ask the browser which one is
on top — and the new check does that where the image crosses into the next
column, and refuses to pass if the scene has drifted so they no longer overlap
at all. A check that quietly stops overlapping is a check that passes forever
while testing nothing, which has already happened three times on this one
ticket.

One thing on the ticket turned out to be wrong, and it was wrong before this
work started: its test steps predict the row's own faint haze appearing on top
of the columns. It does not, and never did — a column sits above the row's
screen, so any column carrying its own background hides it. Both screens
paint, on different surfaces. Reported on the ticket rather than changed,
since touching the row overlay was explicitly out of scope.
## 2026-09-03 — Connections that look after themselves, and a Disconnect that really disconnects (#556)

When a client hands Starcaster permission to post to their own Facebook Page
or Bluesky account, that permission used to be filed away and never looked at
again. Three things change here.

A permission can expire — some platforms hand out ones that last only hours.
Until now a permission with ten minutes left on it passed every check and then
died halfway through the post it was fetched for. Now the very last thing that
happens before Starcaster uses a client's permission is a quiet renewal, if it
is close to running out. If the renewal fails the post still goes out, because
the permission is genuinely still good for those last few minutes — the
connection is just flagged as needing attention, so the client's screen can say
so. (The amber warning on the card itself is the next slice.)

There is also a health check now: it goes round asking each platform "does this
still work, and is it still the same account?", and writes the answer down. It
works through a handful at a time and reports how many are left, rather than
trying to do everything at once — a server that gets cut off partway through a
long job leaves half of it done and no record of which half. Nothing runs it on
a timer yet; that is a deliberate separate step, so it gets watched working by
hand first.

And Disconnect now actually tells the platform. Before, pressing it made
Starcaster forget the token while the permission stayed granted at Facebook —
which the client discovers months later, in their own settings, as an app they
were certain they had removed. Now the platform is told first and the stored
credential is deleted second. If the platform cannot be reached, nothing is
deleted and the client is told why, because trying again is the only thing that
fixes it and trying again needs the credential we would otherwise have thrown
away. Bluesky is an honest exception: it offers no way for another app to
retire an app password, so the answer says exactly that rather than claiming a
revoke that never happened.

Two problems turned up while building it, both of which would have been very
hard to notice from outside. The health check, written the obvious way, would
have silently changed *which* of a client's accounts posts — the same column
that records "this row changed" is also how the app picks the active account,
so a routine check would have re-elected whichever account it looked at last,
on a schedule, with every test still green. And a loading order between five
files formed a loop, which makes Node hand back a half-built file; the practical
effect would have been every Bluesky post crashing in production while nothing
at startup said a word. Both are fixed.

One postscript, because it is the more interesting half. The guard that keeps
the health check from moving which account posts had a test that could not
fail: it worked by running a check and then asking "which account posts now?",
and in the test's stand-in database both writes landed inside the same
millisecond, so the two rows tied and a tie-break put them back in the original
order all by itself. Delete the guard and the test still said fine. The review
pass caught it, measured that the hazard is real, and it is fixed two ways —
the test now watches the guard being passed at the moment of the write, which
no clock can undo, and the older test pauses the way a real check of a live
account does so it has a difference to see. Both were confirmed by deleting the
guard on purpose and watching them fail. No working code changed; a comment
that promised more protection than existed was corrected.

## 2026-09-03 — Overlays can tint a photo now, instead of only fogging it (#553)

A section in the Builder can paint a sheet of colour over its own background.
Until now that sheet could only ever *fog* the photograph underneath: turn the
strength up and the picture got flatter and greyer, until at full strength it
disappeared completely under solid colour. If you wanted a photo that was, say,
orange, you could not have one — you could only have a photo you could barely
see, or an orange rectangle.

There is now a **Blend** setting beside the overlay's Opacity, offering seven
choices. The one most people want is **Multiply**: it keeps every dark part of
the photograph dark and recolours everything else, so the picture stays fully
visible but reads as though it were taken through a coloured filter. **Screen**
does the opposite, washing the photo pale toward the overlay colour, and
**Overlay** pushes the contrast up hard.

Two things were done deliberately to keep this from disturbing any site that is
already live. The setting defaults to **Normal**, and Normal writes nothing at
all into the page — so every overlay that already exists renders exactly as it
did before, which was confirmed by photographing six pages through both the old
code and the new and finding them identical to the pixel. And the seven choices
are a fixed list: if a page somehow carries any other value, it is ignored
rather than passed through to the browser.

One thing was found on the way. The code that switches the tint on when a row
becomes a video row rebuilt the overlay from a hand-written list of its parts,
which meant it quietly dropped the new Blend setting the moment that setting
existed. A test caught it. It now copies the whole overlay across instead, so
the next setting added will not hit the same trap.
## 2026-08-29 — The Tractor Nav settings panel is one rectangle again (#447)

Open the settings for a Tractor Nav module and look down the Placement column.
The dropdown at the top ran the full width of the column; the three boxes under
it — Position X, Position Y, Z-Index — stopped about 74 pixels early. The column
read as a rectangle with a bite out of its right side.

The cause was a width written onto those three boxes by hand, back when someone
decided nine characters was about right. That is the one thing the panel rules
forbid outright: widths are supposed to come from the column so that every row
in it agrees. So the fix was a deletion — take the hand-written width out and
the shared rule sizes them, the way it already sizes everything around them.

The four slider rows had the same problem a size smaller. A slider is a track
plus a small number beside it, and the number sized itself to its own text, so
"80%" and "200ms" in the same column ended three pixels apart. Three pixels is
small enough to look like nothing and is still the thing the eye reads as
unfinished. The number now gets a fixed slot and the slider stretches into
whatever is left, so the rows end on the same line at any panel width.

One thing found on the way that is worth writing down: the automatic panel
checker could not see this bug, and reported a clean pass on it. It measures the
slot a control sits in rather than the control itself, and all three short boxes
sat in correctly sized slots. Measuring the real page instead turned up 25 rows
across six panels with the same shape of defect; four were this panel and the
rest belong to later tickets in the same sweep. Teaching the checker to look
inside the slot would fail those panels today, so it is written down here and on
the ticket rather than done in this change.

## 2026-09-02 — The alarm that watches the queue could go blind and say nothing (#535)

Two days ago we added a check that asks the one question nothing else asked:
*is the queue actually getting shorter?* It exists because on 31 August the
build loop ran every hour, finished cleanly every time, and shipped nothing —
a cheerful log that read as health. A review of that new check found six ways
the check itself could go quiet. Four are fixed here.

The worst of them: the check has four possible answers, and one of them is "I
could not take a reading." That answer went to a log file nobody opens. So if
the ClickUp password were ever rotated, the alarm would simply be dead —
forever, silently, while every other job on the board still looked fine. It
now says so on the party line, with the reason, at most once every six hours,
and shuts up as soon as it can see again.

It was also making its own trouble worse. It is meant to check once an hour,
but it only wrote down "I checked" when the check *succeeded*. So the one time
it most needed to back off — ClickUp saying "too many requests" — it went
straight back six times an hour instead, keeping itself broken. It now starts
the clock when it tries.

The other two were wrong sentences rather than silence. It could announce
"the loops ARE firing, so the problem is elsewhere" on evidence that only
showed *somebody edited a ticket* — which could be Dane leaving a comment.
That is exactly the sentence that sends you hunting in the wrong place. And a
day where everything shipped could be reported as a stall, because a handful
of tickets finish without a closure date on them and the count could not see
those. It now says "I am not sure" instead of accusing the pipeline, and only
when such a ticket was touched in the last day, so the alarm still fires for
real stalls. Measured against the live queue: the one ticket in that state was
last touched 36 days ago, so nothing is switched off by this.

Every fix was broken on purpose afterwards and watched to fail, which is the
only way to know a test for a monitor is a real test.

Review sent this back once, and caught something worth having. The new
"I could not take a reading" message was being used for two quite different
situations, and it only described one of them. On the other — the day where a
ticket finished without a closure date — the reading had actually worked
perfectly, every number was there, and the fix was one missing field on one
ticket. The message nevertheless announced that the check had gone blind and
told the reader to go and find out whether ClickUp was reachable at all. That
is the same fault this whole ticket is about, arriving through the fix for it:
a message saying something its own evidence does not support, in the direction
that wastes the most of the reader's morning. There are two messages now. The
second one names the ticket to go and fix, and carries the queue numbers with
it, because a real stall can happen on that day too and used to arrive stripped
of everything that made it worth acting on.

Review sent it back a second time, on the same theme once more. Having split
that message in two, we were still using one "already said this recently" note
for both of them — and the whole point of that note is to stop the same alarm
repeating every ten minutes for six hours. So the two alarms could gag each
other. The likelier direction was the bad one: there is a real ticket in the
Live column that is never going to grow a closure date, so the gentler message
("one field needs filling in") would tend to fire first, and could then silence
the serious one ("nothing is watching whether the queue is getting shorter")
for six hours. Each alarm now keeps its own note. Driven for real: with the
gentle one just fired, the serious one still gets through — and with the old
shared note put back, it vanishes, which is what the defect looked like.

Review sent it back a third time, on the same theme a third time — a second
road to the same silence. Giving each alarm its own note fixed the case where
both of them fire. It left the case where one of them simply stops applying.
The note that says *I could not read the queue* was only being torn up at the
very end of a completely clean run, and the gentle alarm finishes early, before
that point. So: ClickUp goes down at nine and the serious alarm fires; at ten
ClickUp answers fine and the gentle alarm fires — which is itself proof the
queue can be read again; at eleven ClickUp goes down once more and the serious
alarm is swallowed until three in the afternoon, on the strength of a note that
ten o'clock should already have torn up. Now the moment the queue is read at
all, that note goes, before any of the later exits. The reverse is deliberately
*not* true, and the code says so where somebody would be tempted to tidy it: a
run that could not read the queue proves nothing about whether some ticket has
grown a closure date, so it leaves the gentle alarm's note exactly where it is.

Two smaller things. A verdict of "I cannot tell" was being treated as an
all-clear for the stall alarm on one of its two paths, quietly re-arming an
alert that had already been sent; it now leaves that alarm exactly as it found
it, because not being able to tell is not the same as recovering, and the note
expires on its own after six hours either way. And the command cheat-sheet at
the top of the repo still said this check "posts if it has STALLED" — the
prose ten lines below it had been corrected, but not the one line anybody
skimming for the command actually reads. That line now has a test on it, so it
cannot drift back.
## 2026-09-02 — Instagram connects itself, and says why when it cannot (#545)

Instagram is now a real card on the Connections screen rather than a greyed
"coming soon" one, so a client can hook up their own account without Dane
pasting a token into Vercel for them. It rides the same Facebook sign-in the
Facebook Page card already uses — it is one consent screen, asked for two more
permissions — so the connecting part was the easy half.

The hard half, and most of this work, is the two checks that run before
anything is saved. Instagram will not let *any* app post to a personal
account, and every Instagram post an app can make physically travels out
through a Facebook Page. Break either rule and Meta's own answer is a code
like `OAuthException` with a number after it, or — far more often — a
perfectly cheerful "success" that just never mentions Instagram at all. A
client reading either of those has no idea what went wrong. So both cases now
stop the connection dead and say, in English, what to change and which screen
to change it on: "This Instagram account is a personal account. Instagram only
allows posting to Business or Creator accounts. Change it in the Instagram app
under Settings, Account type and tools, then try again."

Telling those two apart turned out to hinge on one detail. Facebook reports a
Page's linked Instagram account under two different names: one that appears
only for Business and Creator accounts, and one that appears for any account
at all. Ask for only the first — which is where Meta's own instructions send
you — and "your account is the wrong type" and "you have not linked anything"
look exactly the same, so there is no honest way to tell someone which of two
quite different things to go and fix. Asking for both is the whole trick.

One nicety worth knowing: the card shows the Instagram handle, `@delraytennis`,
not the name of the Facebook Page the post travels through. Clients recognise
the first and do not recognise the second.

Review sent this back once, and the catch was a good one. If a client's
Facebook account covers two Pages and they only gave us posting permission on
one of them, the second Page came back from Facebook with no key attached —
and the code built a connection out of it anyway. What the client then saw was
their good account blocked by their bad one, an error message with the word
`accessToken` in it, and a card sitting there saying "connected" with nothing
behind it. That is precisely the failure the whole ticket was written to
prevent, arriving by a door nobody had checked. Now a Page with no key is
recognised for what it is and skipped, the good account connects normally, and
a client whose *only* Page is missing that permission is told exactly that
rather than being told they do not have a Facebook Page at all. The saving step
underneath was also changed to check every account before it writes any of
them, so "all of it or none of it" is now how the code is shaped rather than
something each new platform has to remember.

Two things nobody was testing are now tested: that Facebook handing us back an
Instagram sign-in reaches the Instagram code at all — the only route by which a
real Instagram connection can ever be made — and that a Facebook sign-in still
goes where it always did, which matters because there are clients on it today.

The existing Facebook connection is untouched — deliberately, byte for byte.
Facebook only accepts one return address for this app, so Instagram comes back
through Facebook's, and the signed token that makes the round trip now says
which of the two asked. A token issued before this went live does not say, and
is treated as Facebook, so anyone half-way through connecting when it deployed
still landed where they expected.

## 2026-09-02 — Gradients can point any direction now, not just diagonally (#540)

Every gradient background in the Builder ran at exactly one angle — diagonally,
top-left corner down to bottom-right. That was never a choice anybody made in
the design; the number was simply written into the code, on a single line that
happens to draw the gradients for everything at once: row backgrounds, page
backgrounds, buttons, module backgrounds and the overlay screen. There was no
way to make one run left-to-right or top-to-bottom.

There is now an **Angle** box sitting beside the two colour pickers, which shows
up only when the background Type is set to Gradient. Type 90 and the gradient
runs top to bottom; 0 runs it bottom to top.

The care in this one went into making sure nothing that already exists moved.
A gradient that was saved before today has no angle written on it, and every one
of those still paints at exactly the old angle — that is what most of the new
tests check, and each of them was deliberately broken first and watched failing,
because a test that cannot fail proves nothing. One of those break tests found a
real gap: the automated panel check could not see the new box at all, because
the test page it measures had no gradient anywhere on it, so a clean result was
not evidence of anything. That page now carries one. Six pages were also
photographed before and after and came out pixel-for-pixel identical.
## 2026-09-02 — The screen a client uses to connect their own accounts (#526)

Until now, putting a client's social account onto Starcaster meant you pasting
their tokens into Vercel by hand. This is the screen that replaces that: the
client opens Settings › Connections and sees one card per platform — Facebook
Page, Bluesky, and Instagram and X greyed as "coming soon" — and connects the
ones they want themselves. Four states, and each card is in exactly one of
them: not connected, connected (with the account name on it), needs attention
(with a plain sentence saying what broke), or coming soon with no button at all.

The cards are not written into the screen. They are generated from the list of
platforms the earlier slices built, so when Instagram is finished next, its card
turns from grey to a working Connect button with nothing in this screen edited.
There is a test that proves it by inventing a platform the code has never heard
of and checking a card appears for it.

Two things turned up while building it that were worth stopping for. The first:
one Facebook sign-in can cover several Pages, and they all get saved in the same
instant — so the screen could tell a client "posting to your main Page" while
the thing that actually posts had picked a different one. Nothing would have
looked wrong. The screen now reads back which one will really be used instead of
assuming. The second: none of the buttons on this screen showed anything when
you tabbed to them with the keyboard, because the admin app has never had a rule
for that. Measured both ways in a real browser — six controls with no ring
before, six with one after.

Disconnecting is deliberately honest about its limits: it forgets the account
here, and says out loud that it has not withdrawn the permission at Facebook or
Bluesky itself. That comes in a later slice, and until it does, "disconnected"
must not be read as "revoked".

One thing to confirm before this goes live: storing a connection needs an
encryption key that has been missing since a rotation was left unfinished in
July. This session could not read the production settings to check whether it is
there. If it is not, the Connect button will fail — for the earlier slices as
much as this one.

Review sent this back once, over the Disconnect button, and it was the right
catch. A client with three Facebook Pages under one sign-in was asked
"Disconnect Delray Tennis Center?" — one Page, by name — and pressing yes
removed all three. Both halves were reasonable on their own: the message
described the Page currently in use, and the delete cleared the platform. Put
together they promised one thing and did another, on the one kind of action you
cannot undo. The dialog now says what it means — "This removes all 3 connected
accounts", and names them — because that sentence IS the client's consent, and
consent to something that does not happen is not consent at all. Removing only
the one named Page was the other option and was rejected for a concrete reason:
a Page connected the old way is not stored the same way, so a narrower delete
would have quietly removed nothing and left the card connected. Both old tests
had seeded a single account, where the two behaviours look identical — the case
that could tell them apart now has a test in each suite, and both were watched
failing before the fix went back in.

## 2026-09-02 — The pipeline's own health check finally runs on a timer (#524)

We have a command, `npm run pulse`, that looks the whole build pipeline over and
says whether anything is stuck: is the build loop still picking up work, has any
ticket been sitting in one stage too long, does every ticket and its pull
request point at each other. It was built, checked, and marked finished back in
July — and it had never once run on its own, because nobody ever set up the
timer. It even ends with a line saying "if a scheduled run does not print this,
that absence IS the alert." There were no scheduled runs, so the absence was
permanent and told nobody anything. Run by hand on 31 August it turned up two
real problems and a third worth knowing about, none of which anyone had seen.

It now runs every hour on the Mac Mini. Every hour it writes its full report to
a single ClickUp ticket called "Pipeline pulse", replacing what was there before
— so there is exactly one of it and it is always today's. Only the things that
actually need somebody get announced on the party line, once each per six hours,
and they stop being announced when they clear. A clean report posted daily would
be 365 messages a year, which is how a channel stops getting read.

Two smaller things came with it. The job now records a heartbeat every time it
finishes, so if the Mini is ever switched off the missing heartbeat is noticed
by whichever machine is awake — a watchdog sitting on the machine it watches
cannot spot that machine going dark, and this closes that. And the whole
schedule is a committed script rather than something typed into one Mac by
hand, which is the mistake that lost the failure alert the last time a job moved
machines.

A review pass sent this back once and found seven things worth fixing, all of
them the same shape: ways this health check could go quiet without saying so.
The largest was that it treated "Dane has paused the pipeline" and "I could not
tell whether the pipeline is paused" as the same event. The first is normal —
the check looks, finds the line is stopped, and stays quiet. The second means
the check is blindfolded, and left as it was it would have published nothing,
every hour, indefinitely, with no alert; the only thing that would eventually
have noticed is the daily roll call, which would have said the job had stopped
running when it was running fine and being silenced. Those are now different
outcomes, and only the second is loud. A paused hour also records its heartbeat
now, so a day where Dane has the deck no longer reads on the roll call as the
job having died.

The rest: the rule for forgetting an old alarm is now the one that is actually
tested rather than a second copy of it living in the script; the report's
headline is counted from the findings printed underneath it, so it can no longer
say "nothing to report" above a line saying the queue could not be read; and the
"is it installed?" command stops printing the number zero twice on a log that is
empty, which is exactly the state it is in the first time anyone runs it.

A second review pass found that the deadlines went on the three big helpers and
not on the eight-thousand-odd calls a year this thing makes to ClickUp itself.
That matters more than it sounds. A request to a website does not always fail
when something goes wrong at the other end — sometimes the connection simply
opens and then nothing ever comes back, and the code sits there waiting, with no
error, for as long as the machine is on. If that happens on an hourly job, the
Mac will not start the next hour's copy while this one is still going, so the
check stops running entirely and nothing complains: no output, no failure, no
alert. The one thing that would eventually notice is the daily roll call, and it
would report that the job had stopped running — sending whoever read it to look
at the timer, which is fine, rather than at the stuck call, which is not. Every
call out now gives up after a set time and says plainly that it timed out, which
turns a permanent silence into an ordinary noisy failure that retries next hour.

The same pass added a check that the report actually arrived. ClickUp answers
"saved" to a write that in fact saved nothing, which we have been bitten by
before, and this report is the only thing the whole job produces — so it is now
read back afterwards and compared. If it comes back empty or a fraction of its
size, the run says so loudly instead of finishing cheerfully over a blank
ticket.

A third review pass found the last shape of the same problem, and it is the one
that sounds least like a bug: the check could run perfectly, find everything,
deliver none of it, and report a clean pass. If the message to the party line
failed to send, the code wrote a line about it in a log nobody reads and then
carried on to record its heartbeat and finish successfully. So a day where
ClickUp was refusing messages — it has a daily limit, and the chat has gone down
before — would have been a full day of real alarms reaching nobody, with every
surface saying the job was healthy. A run that ships nothing now ends as a
failure: it raises the ordinary failure alert straight away, and it withholds
its heartbeat, so the daily roll call notices too if the party line itself is the
thing that is down. Those two surfaces fail for different reasons, which is why
it takes both. What has not changed is that a failed message is never marked as
sent, so the next hour simply tries again and a one-off blip fixes itself.

The same pass fixed a bug that had not happened yet but had a date on it. When
one program prints something and another reads it, the pipe between them holds
64 kilobytes, and the printing program was quitting the instant it finished
writing rather than waiting for the reader to take it — so anything past 64
kilobytes was thrown away. Today's report is 39 kilobytes, comfortably under.
But it grows by about 145 bytes for every finished ticket, and there are 195 of
them; at somewhere around 380 the report would have crossed the line, and from
that hour on every single run would have failed to be read, posted an alarm
about a fault that did not exist, and gone blind to the real ones. It now waits
for its output to be taken before it leaves. Measured rather than reasoned
about: with the fix a 135-kilobyte report arrives whole, and without it the same
report arrives cut off at exactly 65,536 bytes and unreadable.

And the third: when the Mini cannot tell which machine it is — a one-line file
that says so has gone missing — the job correctly refuses to run rather than
guess. Its own comment said it refuses "out loud." It did not: it stopped one
step before the part that raises the alert, so the refusal went into a system
log and nowhere a person looks. Nothing would have surfaced for up to 25 hours,
and then as "the job has stopped firing," which points whoever reads it at the
timer rather than at the missing file. It now leaves by the same door as every
other failure, and a test fails if a future change ever adds a second exit ahead
of the alert again.
## 2026-09-01 — Handing you a command to paste is now something the machine refuses to do (#499)

There is a rule here that CC runs the operational commands itself and tells you
what happened, rather than handing you something to copy and paste. Pasting a
command at you is really a claim that CC could not run it, so a job that is
actually finished ends up looking like it is waiting on you. You have raised
this three times — 7 August, 23 August and 30 August — and it was broken all
three times, twice by sessions that had read the rule that same day.

So it is no longer only written down. There is now a small program that runs at
the moment a reply is about to reach you, reads it, and refuses to let the turn
end if the reply hands over a ready-to-paste command. The agent then has two
choices: run the thing and report what it said, or write one line naming which
of the four exceptions applies — a real secret value, a billing screen, a
browser login, or a decision that is genuinely yours.

It is deliberately narrow. Mentioning a command mid-sentence is fine; that is
explaining, not handing over. The one command that IS yours to run —
`pipeline resume`, the switch that hands the deck back after a pause — is
exempt. And it only watches sessions you are actually sitting in front of, not
the loops that run overnight and report to a ticket, because there is nobody
there to hand anything to. It also steps aside after three refusals in a
session: a guard that can jam a conversation shut is worse than the thing it
prevents.

Building it turned up a second bug worth mentioning. That "step aside after
three" counter was going to be stored in a place that only exists in the main
copy of the code — in a worktree, which is where essentially all work here
happens, the write would have failed silently and the counter would never have
counted. The safety valve would have been dead in every folder that uses it.
Fixed, with a test that builds a real worktree and fails if it stops working.
The older SQL hand-off hook has the same gap and still needs its own fix.

Review then caught the same counter failing a second way, and this one was
worse: the "step aside after three" limit only existed when the guard could
work out which folder it was in. If it could not — because the session was
started outside the code folder, or because the `git` command simply was not
available, which is the normal starting state for an agent on the Mac Mini —
the limit was skipped entirely and the guard would have refused **every** turn,
forever, with no way out. A safety brake that disappears in the one situation
it exists for. It now keeps its count in a scratch folder when it cannot find a
better place, and it also listens to the signal Claude Code itself sends after
a guard has already blocked once, so there are two independent brakes rather
than one. Both were measured over five turns in a row before and after, because
"it stops after three" and "it never stops" look identical if you only try it
twice.

Three smaller things came out of the same review. Naming an exception on a line
that started with a dash — an ordinary way to write a bullet point — was being
rejected, which would have pushed agents toward the override switch for no
reason. A command hidden behind a setting, like `PORT=3058 npm run something`,
was sailing through because the guard only looked at the very start of the
line. And it only ever read the first line of a pasted block, so the exact
two-line shape the project's own handbook prints slipped past untouched. All
three are closed, and the last one was checked against 11,803 real replies from
this project's history first to make sure the wider net does not start crying
wolf: it flagged the same 152 and not one more.

A second review round found the escape hatch itself was too fussy, and this is
the most interesting failure of the lot. To hand something over legitimately,
the reply writes a line naming which of the four exceptions applies. The guard
was only accepting that line when the exact phrase came first — `Exception:
decision` passed, but `Exception: a decision that is genuinely his` did not.
Look at that second one: it is the handbook's **own wording**, the exact
sentence an agent would copy out of the very document this guard exists to
enforce. Ten of sixteen normal, correct phrasings were being turned away,
including "a real secret VALUE". The document and its own tripwire disagreed
about what the four exceptions are called, and the cost of that is not a missed
catch — it is an agent being refused while doing the right thing, which is the
fastest possible route to somebody switching the guard off. It now looks for
the keyword anywhere in the line, so ordinary English works, while a reason
that is not one of the four ("Exception: I was busy") is still refused.

Two claims in the write-up were also corrected, because they were reading
better than the evidence supported. The check on 11,803 replies mentioned above
did not say **which** replies it read: re-measured across all 1,615 transcripts,
every single flagged reply came from the overnight loop sessions, which this
guard deliberately ignores. In the sessions it can actually fire in, nothing
flagged at all — so that reassuring number was taken almost entirely from
somewhere the guard never looks, and now says so. And "sessions you are sitting
in front of" turned out to be wishful: there is exactly one such session in this
project's whole history, and it is a loop you started at your terminal on 23
August that then ran by itself for seven days. The guard's own notes now say
plainly that nobody may be reading, which is precisely why the two brakes that
stop it jamming are not optional.
## 2026-09-02 — A refusal that named the wrong reason, on a pull request whose real problem was a conflict (#525)

On 1 September Dane told the system to merge a piece of finished work, and it
came back and said no. The reason it gave was that "a required review or check
is missing". That was not true, and it was not true in two separate ways: every
check on that work was green, and the actual problem was a **merge conflict** —
the branch and the live site's code had both changed the same lines, which is a
thing only a person can untangle.

A wrong reason is worse than no reason at all, because it looks like an answer.
Told a review was missing, the natural next move is to go looking for the review
— and there was never a review to find. The half-hour that costs is the whole
point of this fix; it is the third time in a week the same shape has bitten
(a gate reading its own note as the verdict, a blocked pull being called
"uncommitted changes"), and each time the machine sounded certain about
something it had not actually checked.

The cause was small and ordinary. GitHub reports the state of a pull request in
one word, and it has eight of them — behind, blocked, conflicted, clean, still
computing, and so on. The code was treating five of those as if they were one
thing and printing a single sentence for all of them. So now each word gets its
own sentence, saying what is actually true and whose hands it needs: *the branch
is behind, this machine will catch it up*; *this check failed, here is its name*;
*the branch conflicts, here are the files*. And where GitHub does not say enough
to know — it will happily report "blocked" without saying which rule — the
answer is now the honest one, **CANNOT TELL**, along with a note that a conflict
it has not finished working out looks exactly like this. It also stops guessing
in one more place: a state the code has never seen before used to quietly count
as "fine, merge it", and now it says so and stops.

The proof came from the real thing rather than a rehearsal. Two pull requests
sitting open right now were read twice a few seconds apart: the first read said
"still computing", the second said "conflicted". That is the exact sequence that
produced the wrong message in the first place — and this time it produced "I
cannot tell yet, I'll ask again" followed by "this is a conflict". Each fix was
also deliberately broken again afterwards to watch the tests that guard it fail,
so a future change cannot quietly put the old sentence back.

## 2026-09-02 — The Carousel settings panel, and a green check that could not say what it had looked at (#446)

The Carousel editor — the panel you open to edit a slideshow's slides — had been
built up over time rather than laid out. Its list of slides was a grid of titled
columns with a second, unrelated row of boxes hanging underneath each one, and
those two halves were sized independently, so nothing below a slide's first row
lined up with anything above it. This rebuilds the slide list the same way the
Feature Cards panel was already rebuilt: one labelled block per slide, every
label starting on one line and every box ending on one line, reusing that
panel's layout rather than inventing a second one.

The interesting part is why this took a second pass. There is an automatic
checker that opens every settings panel in a browser and measures whether the
labels and boxes line up. It went green. But a green result is only worth
something if you have watched the same check go red — so someone tried to break
the Carousel panel on purpose, four different ways, and the check stayed green
through all four. The obvious conclusion was that the checker never opens this
panel at all, and the work was sent back.

That conclusion was wrong, and finding out why is the rest of this entry. The
checker does open the panel and does measure it. What failed was the attempts to
break it: each one tried to make a box far too wide, and the page quietly refused
in two different ways — one rule capped the box's maximum size, and the boxes sit
in a row that shrinks its contents to fit. So nothing over-wide was ever drawn on
screen, and the checker honestly reported that nothing was over-wide. The check
was telling the truth; the experiment had failed without saying so.

The only reason those two possibilities could not be told apart is that the
checker's failure messages did not name what they were looking at. A problem was
reported as "panel #18" — an ordinal in a sweep of 594 panels — and the slide
list was labelled "chrome strip 3", which reads like anonymous page furniture
rather than the thing it is. Search that output for the word "carousel" and you
find nothing, whether or not the panel was ever opened.

So the messages now name the panel and the group: "panel #18 (carousel) /
Slides". With that in place the panel was broken on purpose twice more — once by
knocking a single box out of line, once by forcing a box past its size ceiling —
and both times the check failed, at all three screen widths, naming the carousel
in every line. Then the breaks were taken back out and it went green again. That
is the evidence the first pass was missing, and it is now cheap for the next
person to repeat on any panel.
## 2026-09-02 — The two stuck pull requests were never actually stuck (#513, #494)

You asked to clear the conflicts on two pull requests. GitHub was flagging both
of them red, with the word "conflicting" — which normally means two people
changed the same lines and somebody has to decide which version wins.

Neither one had a conflict. Not a small one, not a resolvable one: none. The
check that settles it takes about a second and does not touch any files, and
run every way it could be run — each branch against the version of the site it
was started from, and against the version that existed by then — all four came
back clean.

Why that matters more than it sounds: the obvious thing to do when a tool says
"conflict" is to open the files and start merging them by hand. If there was
never a conflict, that hand-editing is pure risk. It looks like work
afterwards, so nobody questions it, and it is one of the ways a branch quietly
loses lines that were supposed to be in it — which has already happened here
once, when a stale branch deleted 146 lines of the rules file on its way in.

There was a second trap, and it is the one that would have caused real damage.
After bringing both branches up to date and pushing, GitHub *still* said
conflicting. That reads exactly like "your fix did not work" — and the natural
response is to go back in and cut harder. It was not that at all: the site's
main copy had moved underneath the work while it was happening. Another change
had merged a few minutes earlier, so the branches were brought level with a
version that was already out of date by the time they got there. Fetching again
and checking a different way — not "did the merge command succeed" but "does
this branch actually contain the current main" — gave a straight answer
immediately.

Both are now merged and live. The lasting change is a written rule: when a tool
reports a conflict, confirm it locally before editing anything, and confirm a
branch is current by what it contains rather than by a command reporting
success. A green message from a command only tells you about the moment it ran.

## 2026-09-01 — A ticket waiting on a red build no longer tells you it is waiting on you (#494)

One of the weekly-report tickets sat in the "Ready to launch" column for six
days with your merge approval already on it. It was never waiting on you. The
merge step read your "merge", checked the build, found it red — one failing
test out of 1,846 — declined for that reason, said so once, and then nothing
in the system ever looked at that ticket again. From where you sit, you had
already said yes, so it looked handled. The same thing had happened the day
before on another one. Twice in a week is not bad luck, it is how that column
fails.

The column has nobody watching it, and that is on purpose: "Ready to launch"
is yours, so the machines deliberately keep their hands off. The catch is that
"keep your hands off" quietly became "nobody is looking".

There was one report that would have raised a flag, and what it would have
said was worse than saying nothing. It read: *"Bottleneck: OPERATOR — approved
tickets have waited past 24h for a merge. The machine side is keeping up."*
Both halves of that were false. The machine side was not keeping up, and it
would have pointed at you as the hold-up when you had already done your part.
That report only ever looked at ClickUp — it never once asked GitHub whether
the build had passed — so it could not tell the difference between a ticket
waiting on your word and a ticket waiting on a broken build. It just picked.

This adds a check that asks the real question: whose hands does this actually
need? It reads the ticket, finds its pull request the same way the merge step
does, asks GitHub what state the build is in, and then answers one of three
ways — yours, a machine's, or "cannot tell", which it says out loud with the
reason rather than guessing. If the build is red it names the failing check and
says, in as many words, *not waiting on you*. It runs every ten minutes off the
existing relay job, stays quiet unless something is genuinely stuck, says the
same thing at most once every six hours, and shuts up entirely while you have
the pipeline paused.

The old report's sentence is fixed too: with nothing to go on it now says whose
hands this needs is not known, and points at the command that does know, rather
than naming you by default.

You can ask it yourself any time with `npm run stale-ready`.
## 2026-09-01 — The pipeline's cleanup told the truth, then described itself wrongly (#513)

When Dane takes the deck to work on something urgent, the pipeline pauses, and
handing it back runs a cleanup pass over any ticket whose helper died mid-job.
That cleanup was already making the right call. A ticket whose *build* died goes
back into the queue to be built again. A ticket whose *reviewer* died stays
exactly where it is, because its work is finished and waiting to be checked —
sending it back to the queue would throw away a completed job and have somebody
build it a second time.

What went wrong was the sentence printed underneath. It said "1 stranded ticket
returned to the queue" about a ticket it had just correctly left alone, one line
after saying so. Whoever read that would go looking for the ticket in a list it
was never in. The cause was small: the cleanup kept only a list of ticket
numbers, so by the time it wrote its summary it had forgotten which ones it had
moved and which it had left, and it guessed the same answer for all of them.

It now remembers what it did to each ticket and says so one by one. The status
report had the same fault in its explanation of *why* a ticket is stuck — it
gave the reason that fits a dead build to every ticket, including ones whose
position is perfectly correct and whose only problem is a stale note saying
somebody is already looking at them. Each now gets the reason that actually
applies to it. Nothing about where a ticket ends up changed; only what the tool
says about it.

A review of that fix then caught the same fault standing right next to it. When
the cleanup found nothing to unstick it announced "No stranded tickets needed
unsticking" — an all-clear. But there are five ways to reach that sentence with
nothing cleaned up and a ticket still stuck: the note it tries to leave on the
ticket will not save, a stale marker will not clear, the status change comes
back refused, the queue cannot be read at all, or the cleanup was deliberately
skipped. In each of those the terminal read "it is still stranded" on one line
and "no stranded tickets" on the next — the exact contradiction this job was
opened to remove, moved one sentence over.

The report now distinguishes three different pieces of news that used to share
one sentence. Nothing was stuck, so the all-clear is true and it says it.
Something was stuck and could not be freed, so it says how many are still
stuck and where to look. Nothing was examined at all, so it says it could not
tell — which is never an all-clear. The message posted to the team chat used to
carry its own wording for the same event and could disagree with the terminal;
both now print the same sentence from the same place, so they cannot drift
apart.
## 2026-09-01 — Your words were being read as computer formatting (#515)

There is a switch that lets the machines merge small, safe changes on their own
— documentation and tests only, nothing that touches the site. It had turned
itself off two days earlier, which was the right call at the time: a check had
come back unreadable, and something that cannot verify its own footing should
not be merging anything.

The problem was everything after that. It wrote down only that "1 thing" could
not be checked, not which thing, and then it never mentioned it again. So the
lane sat switched off and looked exactly like a quiet couple of days. You found
it by noticing that nothing was reaching you and asking whether something was
stuck.

Turning it back on is your word, on purpose — the machines are not allowed to
un-brake themselves. You gave that word three times, and all three were
ignored, because of something nobody had thought about: when you PASTE a phrase
into ClickUp, ClickUp helpfully reformats it as a block of computer code. The
switch was comparing your whole message against two exact words, and your
message was no longer two exact words — it was two words wrapped in punctuation
you never typed and could not see the significance of.

So: your instruction is now read as what you typed, not as what ClickUp stored.
That applies to the merge word too, which had the same flaw — your "merge"
worked only because you happened to type it out by hand rather than paste it.

Two other things were fixed on the way, both invisible from the outside. Every
one of the machines posts to the party line using your account, so the switch
had no way to tell your words from theirs; it does now. And the check that was
supposed to tell them apart turned out to be matching nothing whatsoever —
found only by running it over the real messages in the channel rather than over
made-up examples, which is a habit worth keeping.

Still to do, and filed: the brake should say what it could not check, and
should keep saying it is on. Two days of silence is what made a five-minute
problem into an evening.

## 2026-08-24 — The machine that fetches YouTube video files (#419)

Getting a video's title and captions is easy and happens on the website itself.
Actually downloading the video and audio files is not: the service the website
runs on cannot write files, gives up after a few seconds, and gets blocked by
YouTube for being a data centre. So that job belongs on a small always-on
machine of our own.

This is that machine's program. You hand it a link, it answers straight away
with a ticket number, and it goes off and does the work — because the website
that asked is switched off within seconds of asking, so waiting for an answer
would never work.

It will not start at all without a password set, and it refuses any request
that does not carry it. That matters more than usual here: this thing downloads
whatever link it is given, so an unprotected one is a stranger's free video
factory running on our bill.

Not switched on anywhere yet, and it cannot be until you have chosen where it
should live — there is a question waiting for you on the ticket. (#PR)

## 2026-09-01 — A pull request is now named after its ticket, word for word (#514)

Dane pairs up two lists to see what shipped and when: the Closed column in
ClickUp, and the deploy list in GitHub and Vercel. He matches them by name. That
only works while a piece of work is called the same thing in both places, and
nothing in the system said it had to be — the ship command named the pull request
after whatever the last commit message on the branch happened to say, and the
build loop simply made a name up.

Checked against the ten most recently merged pull requests on 31 August, two of
them did not match their ticket. One was off by a single word ("drifts" where the
ticket said "scrolls"), which is the worst kind, because it reads as a match
until you look at it twice.

Now the pull request takes the ClickUp task name exactly. The branch already
knows which ticket it belongs to — that is stamped on when the thread is created
— so nothing has to be remembered or typed. GitHub still adds its "(#514)" on the
end, which is expected.

Three things can go wrong, and each of them says so out loud rather than quietly
doing something else: the branch has no ticket attached (perfectly normal, and it
falls back to the commit message), ClickUp cannot be reached, or ClickUp answers
with a blank. In every case it explains which happened and prints the one command
that renames the pull request by hand. None of them stops the work shipping — a
ClickUp outage is not a reason to strand a finished branch. The silence is the
point: if a fallback said nothing, "the name came from the ticket" and "the lookup
failed and nobody noticed" would look identical, which is exactly how this rule
would get lost again.
## 2026-09-01 — Two changes that never touched each other still broke the build (#503)

A piece of work was checked over, approved, and then sat for four days waiting
for Dane to say the word that puts it live. Nobody touched it in that time. When
he said the word, the automatic safety checks refused it — the work had gone from
fine to broken while sitting perfectly still.

What happened is that another job finished and went live during those four days.
The two pieces of work did not overlap: not one shared file, not one shared line.
The usual warning a machine gives you — "these two edits collide, decide which
one wins" — never fired, because there was nothing to collide about. What
collided was the *rule*. The waiting work had tightened a rule about how a job
ticket must be named; the other work had shipped a test that still expected the
old, looser rule. Each was correct on its own. Put them in the same place and one
of them has to be wrong.

Nothing in the written rules of this project covered that. The two entries that
come closest both start from "when the machine warns you about a clash, listen to
it" — and here the machine had nothing to warn about. So this adds a new entry
that starts from the opposite end: a quiet merge is not proof the two sides
agree. It also writes down the thing that made the four days matter — being
signed off is not a permanent condition. It says something was true about the
work on the day it was read, and the ground can move underneath it afterwards.
The practical habits that follow are: when you change a rule, go hunting for
anywhere else that already relies on it; and when an old test argues with a new
rule, don't just change the test's answer — make it say plainly which rule it is
now guarding, so the next time the two drift apart somebody hears about it.

## 2026-08-31 — A branch that was fine no longer gets filed as broken work (#487)

When Dane says "merge" on a finished ticket, the relay checks with GitHub first.
GitHub sometimes answers that the branch clashes with the live code when it does
not — its answer can be minutes out of date — so the machine tries the merge
itself before believing it. That second opinion comes back one of two ways: the
two really do collide and somebody has to decide what the merged file says, or
there was nothing to collide about.

The note written on the ticket read that second opinion and said the right thing.
The part that files a "somebody go fix this branch" job into the work queue never
read it at all — it filed whenever GitHub used the word conflict. So on 30 August
a branch that had merged perfectly, and only lost a race sending the result up to
GitHub, got two notes on its ticket a fifth of a second apart. One said a job had
been created and named it. The other said it would go through on the next attempt
and nobody needed to do anything. Both were on the screen at once, and whichever
one you read last is the one you believed. The job that got created told whoever
picked it up to go and clean up a mess that was not there. The ticket sat for two
hours next to it.

Now both halves ask the same single question, so they cannot answer it
differently — there is only one answer to read. And where the code used to ask
"did we create a job for this?" it now asks "who is going to act next?" Those
are not the same question: when there is nothing to fix, the next attempt IS the
actor, and it is a real one. Treating that as "nobody" is why the system had
been announcing a healthy branch as blocked every ten minutes and asking for
hands it did not need. It still speaks up if a branch has not sorted itself out
within a day, because at that point silence would be the wrong answer too.

Review caught that "where" being written as "everywhere" the first time round.
Four places had to change and only three did. The one that was missed is the
message that goes to the group chat Dane actually reads, and it is the message
sent when a branch has been stuck for a day — so once a day, about the branches
that matter most, it would have posted a single sentence saying both "nothing is
looking after this" and "every attempt has been retrying it on its own." The
same two-answers-at-once problem this whole job was written to remove, one level
down. It now says which of the two it is, the heading above it stops calling a
branch with nothing wrong a clash, and the test that guards it feeds the two
halves into each other the way the real code does — checking them one at a time
was why a fully passing test run still had this in it.

Review then caught something bigger, and it is the reason this went round a third
time. "The machine looked and found nothing wrong" and "the machine never managed
to look" had been filed as the same answer. They are not the same answer at all:
the first is a finding, the second is the absence of one. So when the check
failed to run — it could not reach the code, or the branch lives in a different
project this machine does not have a copy of — the note on the ticket honestly
said it could not check, while the message going to the group chat seconds later
announced that no clash had been found and nobody needed to do anything. Standing
the room down on a look nobody took. And a branch in one of the other projects
hits that every single time, forever, so it had quietly stopped creating any job
at all for work in those projects.

There are three answers now instead of two, and each one is only allowed to say
what it actually knows. A clean result still goes quiet and sorts itself out. A
real clash still gets a job created and a name attached. A check that could not
run says so plainly, in the same words everywhere it appears, and still gets a
job created — because somebody has to find out why. The wrong-project case says
out loud that it will never sort itself out from that machine, rather than
promising a retry that cannot work. Every outcome the checker can produce now
needs a decision written down beside it; a test fails if a new one is ever added
without one, which is how four of these came to be sharing an answer nobody had
chosen for them.

And a fourth time, for the most embarrassing version of the same thing. Splitting
those three answers apart fixed the note written on the ticket — and stopped
there. The ticket that note LINKS TO, the one somebody actually opens and works
from, still had a single set of words for all three. So the note would say
"whether there is anything to resolve is still unknown", you would click through
to find out, and land on a job titled "Resolve the merge conflict on PR #501"
telling you to leave no conflict markers behind. Word for word the mistake this
whole job was written to remove, one more level down — and for the branches that
live in the other projects it happened on every single pass, not occasionally.
Three more places had it too: the once-a-day chat message about a stuck branch,
the end-of-run summary above it, and the "things I could not check" list at the
bottom of every run.

The fix is one change rather than four, and it is the only shape that stays fixed.
Every one of those places used to hold its own words and pick between them by
asking a question that only had two answers — so none of them could tell "we
looked and found a clash" apart from "we never looked". The words now live in one
table, one row per answer, and every surface reads its row. Nothing writes its own
sentences any more, so nothing can describe a situation as something it is not.
Adding a fourth answer without filling in its whole row fails the tests.

One of the guard tests turned out to be holding the mistake in place: its written
description said "only a branch with a real clash may be announced as a clash",
which is right, while the check underneath it permitted exactly what the
description forbade. It says what it always meant now — and reverting it to the
old wording makes it fail, which is the proof it was load-bearing in the wrong
direction.
## 2026-08-31 — Work sent back for a fix stopped hiding in the queue (#489)

When a review found a problem, the ticket went back to the "Queued" pile — the
same pile as work nobody had started yet. Nothing on the board could tell the
two apart, and that turned out to cost more than it looked like it would.

Three things went wrong at once. The queue lied about its own size: fifty-two
tickets sitting in "Queued" looked like fifty-two fresh jobs, when six of them
were already half-built with the code sitting in a pull request waiting for one
small fix. Worse, a returned ticket went to the back of the line — the machines
pick by priority, and a returned ordinary job never beat a fresh urgent one. Four
of them had been waiting weeks that way, one since 25 August. They did not get
forgotten; the rule sent them to the back every single time. And the safety limit
that stops the machines starting more than five things at once was reporting "one
thing in progress" while five real branches sat open.

So returned work now has a status of its own — **Rework** — and the build
machines empty that pile first, oldest first, before touching anything new.
Finishing something half-built is cheaper than starting something fresh: the
branch is already there, the notes about what to fix are already there, and every
day it waits it drifts further from the live site and needs re-syncing. Rework
still does not count against the limit of five, because that limit is about how
many *new* things to start — but the count is now printed in plain sight on every
message rather than left out silently, which was the actual complaint.

The rest is plumbing that had to follow: the sleep timer counts rework as work
waiting (otherwise a queue full of returned tickets read as empty and the
machines dozed for an hour), the pause-and-resume tool puts a half-built ticket
back in the right pile, the daily health report measures rework on a shorter
fuse, and the weekly report draws the new column.

One step is left over on purpose. The tickets currently sitting in the wrong pile
get moved by a command that has to run *after* this goes live — until the new
rule is running, a ticket in "Rework" would be picked up by nothing at all, which
is worse than where they are now.
## 2026-08-31 — Posts now go out from the client's own account, not ours (#490)

A client connects their Facebook Page to Starcaster. The screen says
"connected". Their posts then go out from *our* account, and nobody finds out.

That was the state of things until this change, and it is worth being precise
about why. The last two pieces of work built the safe where a client's
permission is kept, and the code that collects it. Neither one ever read it
back. So the permission sat there, correctly stored, doing nothing, while every
post carried on using the platform-wide keys — Dane's own accounts.

This adds the missing piece: one function that every publisher now asks before
it posts, which answers "this client's own connection, if they have a working
one; ours otherwise". Facebook, Instagram, Threads, Bluesky, X and Buffer all
go through it now.

The thing that made this worth being careful about is that the failure is
completely silent. Posting to the wrong account is not an error — the platform
accepts it, the post appears, the job goes green. There is no log line, no
alert, and no way to notice except a client eventually asking why their page
has been quiet. So the new function is deliberately suspicious in three places.
It refuses to post at all if it could not tell whether a client has a
connection, rather than shrugging and using ours — "no connection" and "I could
not check" are different answers, and only one of them is safe to guess at. It
skips a token that has expired even when the record still claims it is fine,
because nothing checks those records yet. And when it does refuse, it hands
back an empty set of credentials rather than a flagged one, because an earlier
draft handed back *our* working credentials with a flag on them, which reads
perfectly and would have posted from the wrong account anyway.

Two things were left deliberately alone. The older place a client's Facebook
Page is stored is still consulted — it is live in production and holds real
clients today, and quietly skipping it would have moved their pages back onto
our account without a word. And the client's token replaces only the token: the
application credentials underneath it stay ours, because permission to post to
someone's page is not a new app, it is one key to one door.

Every safeguard here was broken on purpose and watched to fail before being
put back. One of those breaks earned its keep: taking the change out of a
single channel left every test passing while that channel quietly went back to
posting from our account. There is now a test watching for exactly that.

Review sent this back once, and the thing it caught is worth writing down,
because it is the same silent failure wearing a different coat. Some platforms
do not hand out one key — they hand out two, and both have to match. X is like
that, and so is Bluesky, where the password only works at the particular server
that issued it. Our safe has room for exactly one. So the code was taking the
client's key, noticing the second one was missing, and quietly filling that gap
from our own — producing a pair made of one key from each of two different
accounts, which unlocks nothing and reports an error naming neither. Worse, the
comment above it claimed the case was handled.

It now refuses instead, and says exactly which part it has nowhere to keep. That
is the same instinct as the rest of this work, one step further in: falling back
to our account is not the only way to end up posting as the wrong person — you
can also get there by assembling something half-and-half that merely looks
complete. Bluesky gets the matching fix, and it is the one that could have bitten
a real client: rather than sending their password to whatever server *our*
settings happen to name, it now uses the public one where such a password is
actually valid. A client running their own Bluesky server cannot connect yet, and
now gets an honest refusal instead of having their password handed somewhere it
does not belong.

Two smaller things review asked for are settled here too. A comment claiming an
account could be filed in the safe exactly as it arrives said the opposite of
what the safe actually does, so there is now a single small piece of code that
does that filing properly and one place to change it. And a known rough edge in
the Facebook code — asking for the list of a client's pages using the wrong one
of their two keys — is written down where the next piece of work will meet it,
along with why it is that piece of work's to fix rather than this one's.

Review sent it back a second time, and this one was the opposite kind of
failure — loud rather than silent, which is the lucky kind. Every post to X
was refused with "credentials are missing" while the credentials were sitting
right there, set and complete.

The cause was a translation done twice. Credentials arrive from storage
labelled one way and get relabelled into the form the posting code reads.
Because looking them up is worth doing only once for a post — the check, the
picture upload and the post itself all have to be the same account, or X
answers with an error naming neither — the code looks them up once and passes
the result along to all three. But the relabelling step was then handed
something already relabelled, did not recognise a single field, and returned
five blanks. Nothing errored; the post simply refused itself. And this was on
the shared-keys path, which is Dane's own posting, so it was not some future
client's problem — it was the only X path that runs today.

The relabelling now understands both forms, so doing it twice changes nothing.
That is the property the test asserts, rather than the one place that happened
to trip over it, because the next person to translate twice will not know it
was ever a hazard. The test that should have caught this listed four of the six
channels; X was missing from it, and X is the one channel that hands its
credentials along in an unusual shape — so the only unusual case in the file
was the one nothing was watching. Both gaps are closed.

One more thing review noticed while it was in there. There are two lists of
the shared keys, and they disagreed about who wins when a value is set both in
the settings screen and in the server's own configuration. One list preferred
the settings screen, the other preferred the server. With both set and
different, the same account posted under one name when a client project was
named and a different name when it was not — a wrong-account post, arriving as
success. There is one order now, and a test that fails if the two ever drift
apart again.
## 2026-08-31 — A saved section has one name, and renaming it now sticks (#454)

You renamed the Delray site header three times and it snapped back three
times. That was not stubbornness in the interface — the section genuinely had
two names. One was the name in the Saved Sections list, which is what you were
typing into; the other was stamped inside the section's own content, and that
is the one every page card shows in bold. Renaming changed only the first, and
then the thing that keeps every following page in sync pushed the section's
content — old name and all — back over every page. So the rename was undone by
the very machinery meant to spread it. The only way to move the other name was
to unlock a section on a page, retitle it there, and save it back to the
master, which is not something anybody would guess.

There is one name now, and you can move it from either end. Renaming in the
list changes the name everywhere it appears. Saving a section from a page
carries that page's title with it, so the two never split apart again. And
either way, the dialog that already tells you "this updates it on 35 pages"
now also tells you "this also renames it on 35 pages" — that rename used to
happen in silence, which is what hid the whole problem in the first place.

Page cards are also titled by the master now rather than by whatever the last
sync happened to stamp on them, so an old name cannot sit next to the new one
arguing with it. Nothing was rewritten in the database to fix the sections
that already disagree; they simply stop showing the wrong name, and they
correct themselves the next time the section is saved.

**A second round, after review.** The first version opened the same problem
through a different door. Saving a section from a page takes that page's name
with it — which is what makes the two names stay together — but on a section
that still had the old mismatch, the page was carrying the *stale* name, so
saving it put the old name back on the master and quietly undid a rename you
had just made in the list. Worse, the warning that was supposed to announce a
rename stayed silent, because it was comparing the wrong two strings: it
checked the name stamped in the content instead of the name in the list, and
on exactly those sections those two look identical. It now compares the name
you can actually see in the list, so the dialog says what it is about to do.
(That count went one step too far and is corrected in the third round
below.)

Second thing review caught: after saving a section from a page back to the
master, that section on the page immediately showed up as *Changed* — as if
you had edited it — even though you had just made it match. The relink was
only flipping a couple of flags, while the server tidies a section as it saves
it and fills in a few dozen settings the page never sent. So the two sides
differed the instant they were joined, and every later sync then skipped that
page on the grounds that somebody had edited it. The page now takes the
section back exactly as the server stored it, which is what "this is the same
section again" was always supposed to mean.

Finally, the little "add this saved section under…" list was still labelling
sections with the old stamped name, so it could offer you a section under a
different name from the one its own card was showing, one click away.

**A third round, after review.** Fixing the rename put a new wrong sentence
into the very dialog this whole ticket is about. When you save a section from
a page back over the master, that dialog lists every page it will change and
exactly what changes on each — and it was working that list out from the
section as it sits on your page, while the save itself now stamps the master's
name on before writing. So it was describing a write that no longer happens.
On a section with no title of its own it announced that the name was about to
be wiped off every following page, and named those pages as changing, when in
truth the name is kept and those pages are untouched. Telling somebody their
section is about to be renamed to nothing, in the week whose complaint was a
name behaving unpredictably, is worse than saying nothing. The preview and the
save are now one and the same thing — worked out once, in one place, so the
two cannot drift apart again.

The second round had also made the rename warning count only the pages the
save physically rewrites, skipping any page you had hand-edited. That is the
right rule for *content* and the wrong one for a *name*: a hand-edited page
still follows the section, so its card is titled by the master and it renames
on screen the moment you rename, edits or no edits. Where every page had been
hand-edited the warning therefore said nothing at all while every card
changed — the original complaint, one more time. It now counts every page that
will visibly rename, and says separately how many of them keep their own local
edits, so the two sentences in that dialog stop disagreeing without either of
them lying.

Last, creating a saved section was still making one with two names. The name
comes from a little prompt, and whatever you typed went onto the list entry
while the section's own content kept whatever title it already had. Answer
that prompt with anything but the default and the section was born with the
exact mismatch this ticket exists to remove — invisible at first, because the
cards now show the master's name either way, and back the moment somebody
saved a page's copy over it. Both places that create a section now set both
names together, and a test fails if a third one is ever added that does not.
## 2026-09-01 — A merge can glue two statements together, and nothing was checking (#491)

When two people change the same lines of a file, git stops and asks a human to
sort it out. One of the usual answers is "keep both of these" — and that answer
can quietly weld two separate instructions onto a single line. Git is happy,
because git only ever asked whether the *text* overlapped. The computer that
has to run the file is not happy at all, and it refuses to read the file at
all — not just the broken line, the whole file, every function in it, gone.

That happened on 30 August, in the one file every automated work-pass runs to
talk to ClickUp. It was caught by luck: an agent happened to check the file by
hand before committing. Nothing in the project would have caught it otherwise.
The check we already had for this only looked at the browser code; the tests
that mention that file only read it as text and never actually run it; and the
commit checker deliberately looks the other way during a merge. So it could
have gone live green, and the next work-pass would have died on its first line.
No error, no alert, nothing to see — just a queue of tickets that had silently
stopped moving, and no way to tell how long it had been like that.

So the check now reads the tool scripts and the shared code as well as the
browser code — about 600 files, in under half a second, every time anything is
committed and again before anything merges. Generated files are left out on
purpose, because they are rebuilt rather than written by hand, and they are not
even present at the moment this check runs.

The first time it ran, it found something nobody was looking for: a script for
importing tweets from a spreadsheet has had a missing bracket since the day it
was written. It has never once been able to run. One character, fixed. That is
the same lesson arriving from the other direction — nothing had ever read that
file either.

Review caught one more thing, and it is the same lesson a third time. The test
written to prove the check catches the 30 August problem did not actually
contain that problem. The example it used had a semicolon between the two
welded instructions — which makes it perfectly ordinary, valid code. The test
was passing on the strength of a *different* broken line sitting underneath,
and deleting the example entirely changed nothing. So the one test standing
guard over the whole incident would not have noticed if the check stopped
working. It now uses the real shape, on its own line, with a companion test
using the correctly-separated version to prove the failure comes from the weld
and nothing else — and both were broken on purpose to watch them fail.

The other fix: the list of "files the computer generates, so leave them alone"
is meant to be one list both checkers read, so they can never disagree about
it. One of them was reading only half of it, and the gap was real — a bundling
script writes six files into one folder and the list names three of them by
name, relying on a folder rule to cover the rest. Both checkers now ask the
same question, and a test fails if that ever comes apart again.

## 2026-08-31 — The alarm for a loop that runs perfectly and gets nothing done (#488)

We already had an alarm for a scheduled job that stops running. This adds the
one for the sneakier failure: the job runs fine, finishes cleanly, and nothing
comes out the other end.

That is not hypothetical. On the morning of 31 August the build loop woke up
every hour, did its work, exited cleanly every single time — and the queue did
not get any shorter. Fifty-two tickets waiting, one in review, and the oldest
sent-back pull request had been sitting untouched since the 25th. Nothing was
broken, so nothing complained. That is what makes this failure worse than a
crash: a crash writes an error, while a loop achieving nothing writes a long
cheerful log, and a cheerful log is exactly what stops anyone looking. It took
a morning of reading logs by hand to spot.

The existing alarm could never have caught it, because it only asks "is this
thing still alive?" — and it was, gloriously. So there is now a second question
being asked alongside it: **is the queue actually getting shorter?**

`npm run throughput` answers it. It shows how many tickets finished on each of
the last seven days, how big the backlog was at the end of each day, and how
long the oldest sent-back pull request has been waiting. Then it says one of
four things, and the distinction between the middle two is the entire point:
things are moving; nothing finished but there was nothing to finish (which is
perfectly healthy, and it says so rather than showing a worrying zero); nothing
finished while work sat waiting, which is the alarm; or it could not read
something and refuses to guess. That last one never gets dressed up as good
news.

It runs quietly alongside the existing check every ten minutes and only ever
speaks up when the queue has genuinely stopped moving — at most once every six
hours, and it goes silent again the moment work starts shipping. No daily
"everything is fine" messages that nobody reads.

Two mistakes worth recording, because both were caught by pointing the new
command at real data rather than by trusting the tests. The report printed the
backlog as 57 on one line and 56 two lines further down — two numbers for the
same thing, disagreeing, which is the precise sort of quiet wrongness this
whole feature exists to catch. One real ticket had been marked finished without
a completion date, and the two counts handled that differently. It now says out
loud how many tickets it had to make an assumption about instead of silently
papering over it. The other was smaller: ages were printing as "open 8d 0h ago"
when they should have read "opened 8d 0h ago".

And the detector itself was deliberately broken before being trusted — rigged
so it could never report a stall — to confirm the tests actually fail when it
stops working. Four of them did. A stall detector that cannot detect a stall
would have been a perfect example of the problem it was built to solve.

## 2026-08-31 — `npm run ship` now writes the note that lets a PR be merged (#484)

There are two ways a finished change reaches the live site. The loops do it on
their own, and Dane's own lane — `npm run ship` — does it by hand. A guard added
last week checks, before letting anything merge, that the ticket has a note on
it saying which pull request belongs to it. No note means the guard cannot tell,
and it never lets something through it cannot tell about.

The loops have been leaving that note for over a week. `ship` never has — it had
no connection to ClickUp at all. Nothing was broken yet only because the guard is
still advisory. The moment it is switched on for real, every change Dane ships by
hand would have been stuck, waiting on a command nobody would have known to run.

So `ship` writes the note itself now. It already knows which ticket the work is
for, because starting a piece of work stamps the ticket onto it; it just never
used that for this. It writes the note before it merges, so even a run that stops
on a failed check leaves the ticket properly labelled. Running `ship` twice does
not leave two notes — it asks the guard's own reader whether the note is already
there, so one written by a loop or typed by hand counts the same. A branch with
no ticket still ships perfectly well; it just says out loud that nothing was
recorded, rather than staying quiet, because quiet looks exactly like success.
And if ClickUp is down, the change still merges — the failure is reported
loudly with the one command that repairs it, because a note going missing in
silence is the entire thing being fixed here.

The rules behind all of that were written as their own small piece of code so
they could be tested, then broken on purpose one at a time — fourteen breaks,
each of which made a named test fail. Two of those breaks found real bugs before
the change ever left the branch: one test could not fail at all and was rewritten,
and the code was reading a ClickUp command that had been killed mid-run as
though it had succeeded, which is precisely the silent missing note the whole
job exists to prevent.

Review then found three more holes in that same work, all reproduced live rather
than reasoned about, and this fixes them. The first is the plainest: when the
note could not be written, the loud failure message handed over a command to
repair it — and that command was rejected the moment you ran it, because it named
the pull request by number where the tool wants the full web address. A repair
step that does not run is not a repair step, and the tests had been written
around the broken spelling, so fixing it would have looked like a regression.
There is now one place that spells out both addresses, `ship` uses it for the
command it prints and for the command it actually runs, and the two can no longer
drift apart.

The second was an ordering accident with real teeth. The guard works out which
ticket a pull request belongs to by taking the FIRST ClickUp link in its
description, and `ship` was adding its link at the bottom. So a change whose
commit message happened to mention a related ticket — "follows on from ..." —
would have sent the guard off to judge the work against the wrong ticket
entirely. It would have refused rather than waved the wrong thing through, but
the change it refused is the hand-shipped one, which is the exact thing this job
exists to unblock. The link goes at the top now, so there is nothing left to get
in the wrong order.

The third was a cheerful all-clear standing in front of a refusal. Because `ship`
is meant to be re-run, it asks first whether the note is already there and skips
writing a second copy — but that skip was jumping over the other half of the
check too, the one confirming the pull request points back at its ticket. So a
ticket that already had its note would report success no matter what, and the
guard would then reject the very same pull request for having no ticket link.
Now the skip only skips the writing; both halves are checked every time.

A second review pass found two more, and the first is the wrong-ticket problem
above surviving in the one case the fix stepped over. `ship` puts its link at the
top now, but it skips a description that already mentions this ticket — and
"mentions it somewhere" is not the question the guard asks. The guard asks which
link comes FIRST. So a description naming another ticket at the top and this one
further down was left exactly as it was, and the guard went off to judge the work
against somebody else's ticket, telling Dane about a ticket he had nothing to do
with. The skip now asks the guard's own question, and the test no longer checks
another example — it checks the rule itself, over five differently-shaped
descriptions: whatever came in, what comes out points at this ticket.

The second is a message that said more than it knew. When writing the note fails,
`ship` announced "this ticket now has no note" and handed over a repair command.
But one of the ways it fails is that the note WAS written and reading it back is
what broke — so the sentence was false, and the repair command it gave would have
added a second identical note, which is the duplicate the whole design goes out
of its way to avoid. It now says what it can actually stand behind: the note may
or may not be there, go and look. And both repair commands are the safe kind that
write only if the note is genuinely missing. A repair is by definition run when
nobody knows what landed, which is exactly when that matters.

One more turned up while testing this on the live ticket, and it is the same
mistake wearing different clothes. The whole point of the "only write if it is
missing" option is that running `ship` twice does not leave two notes. To decide
that, it reads the ticket's comments — and if that read came back without a list
of comments at all, the code treated it as "there are no comments", which means
"no note is there", which means write one. So the one check whose entire job is
to prevent a duplicate would create a duplicate precisely when it could not see.
It now tells the two apart: a ticket with genuinely no comments still gets its
note, but a reply it could not read makes it stop and say run this again. One
re-run costs nothing; a duplicate note sits on the ticket forever. The same
confusion sat one step further down, where a reply it could not read was
reported as "the note did not land" moments after the note had in fact been
posted successfully — it now says what it actually knows, which is that it could
not check.

## 2026-08-31 — One shape for every social platform, proven on two of them (#471)

Adding a new social network to Starcaster has always meant threading a new
special case through the whole app. This changes that: every platform now
answers the same six questions in the same way — where do I send the client to
say yes, what do I do with their answer, which accounts does this cover, is it
still working, make it work again, and give the permission back. Adding the
next platform after this is one new file and one line on a list.

A shape is only proven if something awkward fits it, so it was built against two
platforms that work nothing alike. Facebook Pages is the flow that already runs
in production, moved across rather than rewritten — if moving it had broken it,
that would have meant the shape was wrong, and it is far cheaper to learn that
with one platform on it than with five. Bluesky was written fresh, and second on
purpose: it has no browser sign-in, no authorisation code, no expiring token to
renew, and no way for us to hand the permission back on the client's behalf.
Every one of those is something a design drawn only from Facebook would have
assumed without noticing.

One real fix rode along. The address Facebook sends a client back to after they
agree used to be worked out from whichever web address the request happened to
arrive on. On a test deployment that address is different every single time, and
Facebook rejects any address it was not told about in advance — so the sign-in
would have failed there with an error naming nothing useful. It is now a fixed,
known address.

Review caught a real hole on the third look, and it is the kind worth writing
down. When a client connects an account, the code hands back a little record of
it — which account, what it is called, the key that lets us post. That record is
then what you pass back in later to ask "is this still working?" or "hand the
permission back". Except the record came out labelled one way and every later
question expected the other, so handing an account's own record straight back to
the code that made it got the account refused. On Bluesky the refusal read
"Bluesky needs a handle and an app password" — which is not a mismatch, it is a
sentence that would have sent a client off to replace a password that was never
wrong. Every test passed, because no test anywhere had ever fed a connection's
own record back in.

Both halves now use the one set of names — the same names the vault that stores
these connections already used — and the check that would have caught it walks
every platform on the list rather than the two that exist today. Platform seven
either proves its own record can be handed back to itself or it fails the test.

Nothing changes on any screen. The screen where a client actually clicks
"Connect" is the next piece but one.
## 2026-08-31 — Parallax was quietly removing a theme's photo tint (#481)

Themes can lay a wash of colour over a photo — the "Photo overlay tint" — and
it is not decoration. It is the thing that darkens a picture enough for white
words to be readable on top of it. Review found that switching parallax on
threw that wash away and left the white text sitting on the raw photo. On a
dark picture you might not notice; on a light one the words disappear.

The cause is the sort of thing only a browser tells you. The wash is painted
on the row itself, and the drifting copy of the picture is a separate piece
sitting inside the row — and a browser always paints the pieces inside a box
on top of the box's own paint, never underneath it. So the drifting picture
landed over the wash and hid it. The fix is that the drifting copy now carries
the same wash, so it looks identical to the still one it covers. Measured with
a red test tint before and after: the band read as raw photo before and as
properly tinted after.

Two checks came out of it. A new one photographs a themed row with parallax on
and fails if the drifting picture is not wearing the row's tint — every
existing parallax check used a plain untinted row, which is precisely why all
27 of them were green over this. And an old check that was supposed to prove
the video half of parallax still worked turned out to accept a video frozen to
the screen, which is worse than no parallax at all; that hole is closed, and
proved closed by freezing a video on purpose and watching it fail.

## 2026-08-31 — Backgrounds can drift slower than the page now (#481)

A section with a photo behind it used to look flat, and the reason was that the
picture scrolled at exactly the same rate as the words on top of it. Everything
moved as one sheet. Making the background drift a little slower than the text is
the cheapest thing there is for making a page feel like it has depth, and Delray
needs it.

It is a checkbox and a number, in the Motion group of a row's Background panel.
0 pins the picture to the screen, 1 is ordinary scrolling, and about 0.3 is the
usual look. It works on video backgrounds as well as photos. Nothing that exists
today changes: it is off unless you turn it on, and six pages were photographed
before and after to prove it — every pixel identical.

One thing to know before using it. The picture crops in tighter. That is not a
bug and it cannot be avoided: the picture has to be taller than the row to have
anywhere to drift to, so the stronger you set the effect the closer it is
cropped. If the photo has a logo or a face near an edge, use a higher number,
nearer 0.7. The panel says so in as many words.

There is an obvious one-line way to build this that half the internet uses, and
it was deliberately not used. It stops working the moment anything above it on
the page has a blur or a shrink on it — the same six properties that caused the
`blur(0px)` trouble a fortnight ago — and iPhones ignore it entirely. Both
failures are silent. The version that shipped moves a real element instead, which
nothing above it can switch off.

The arithmetic was pulled out into its own file with no page-drawing in it at
all, which is the house pattern for anything that moves, and for a plain reason:
nothing in this codebase can test how something LOOKS, so the sums are the only
part that can be pinned down and kept honest. Eleven checks were broken on
purpose afterwards and watched to fail, because a check that has never failed has
not been tested, only written. One of those breaks was worth the whole exercise:
a check meant to prove the feature stays out of the way passed on the exact bug
its own note described, and had to be replaced with one that actually looks at
the right thing.

Review then caught two things worth knowing about. The Speed box could not be
typed into: clearing it put 0.3 straight back, so typing 0.7 left you looking at
0.37. The cause was a small thing with a wide moral — the box was asking "what
does this value mean?" using the rule meant for values coming back out of the
database, where a blank means "never set, use the usual". Halfway through typing
a number, a blank means "not finished yet", which is the opposite. Those are now
two separate questions with two separate answers, and clearing the box leaves it
empty like every other field on the screen.

The other was the panel telling a small lie. It said parallax runs on phones,
which is true of a photo and not of a video — a video background is not loaded on
phones at all unless you switch that on, so there was nothing there to drift. The
note now says which is which and names the switch. A control that quietly does
nothing on half the devices people use is worse than one that says so.

A third pass caught something duller and just as real. This work renamed the one
file that draws a background — it was the "video background" file, and it is not
video-only any more — but two of the written guides still sent the reader to the
old name, which is now a file that does not exist. Both were corrected, and the
video guide was brought up to date to say that one layer now carries photos and
clips alike, and why that was the point rather than a side effect. A guide that
points at a deleted file is worse than no guide: it costs somebody the time to
find out it is wrong before they can start.
## 2026-08-29 — The CRM Form settings panel was never being checked (#451)

Back on 8/13 you pointed at a module's settings panel and said the column width
"varies arbitrarily between the Settings fields and the Layout fields." That
started a sweep to bring every panel onto one grid, so labels all start on the
same line and fields all end on the same one. This is panel 9 of 15: the two CRM
panels.

The interesting part is what the check had been telling us. There is an
automated check that opens the real app and measures every panel. It was passing.
But before changing anything I asked a narrower question — not "does this pass?"
but "is this panel actually being *looked at*?" — and the answer for the CRM Form
panel was no. Zero of its eleven fields were being measured. The panel was built
in a shape the checker does not recognise, so it was skipped, and a skipped panel
looks exactly like a perfect one in the summary line.

It was not perfect. With a picture taken of it, labels were sitting on top of
their own boxes, and two of them — "H Margin" and "Field Width" — were being
sliced off mid-word by the very control they were labelling. That has presumably
been sitting there for months, inside green run after green run.

The other panel in this ticket, the CRM contacts table, was genuinely fine: all
ten of its fields were being measured and all ten obeyed the rule. I left it
alone and said so, rather than touching it to look busy.

The fix changed no styling at all — only the structure of the panel, so that it
is built the same way the app builds the panels it generates automatically. That
also means it is now *visible* to the checker, which matters more than this one
fix: the next time someone breaks it, something will say so.

One thing worth recording, because it nearly let a false pass through here too.
The ticket asks that you break the check on purpose and watch it fail before you
believe it. My first attempt to break it **didn't fail** — and that was correct
behaviour, not a broken check. The grid makes every label box the same size
automatically, so deliberately setting one to the wrong width just gets absorbed.
A break that the check *can* see (shifting where the words start) failed
immediately at all three screen widths. Had I skipped that step, I would have
reported a green run as proof, exactly as has happened here before.
## 2026-08-31 — The overlay controls a row always deserved (#482)

Every row on a Builder page has been able to carry an overlay for months — a
wash of colour, a gradient, or a second image laid over the row's own
background, at whatever strength you pick. The setting was saved, and since
yesterday the page actually paints it. What was missing was the knobs. The
newer Builder had none at all, so the only overlay anyone could get was the
dark tint a video row quietly gives itself, and there was no way to soften it,
recolour it, or turn it off.

Open a row's settings now and there is an **Overlay** group: choose a type —
colour, gradient, a picture — and a strength control appears beside it. Put a
dark blue over a photo at half strength and the words on top become readable
while the photo still shows through. Pick a second image instead and the two
blend. Set the type back to None and the row goes back to exactly how it looked.
A video row opens with its tint already filled in, and that tint is finally
yours to change.

None of the machinery underneath moved — the saving, the loading and the
painting were all already right, and only the controls were absent. The one
thing worth recording is how nearly the layout check let this through. It
measures a group of settings by asking whether they line up with each other,
and while the overlay type sits at "None" the group holds exactly one setting.
One thing always lines up with itself. So the check happily passed a layout
that had been broken on purpose, until the test page was given a real overlay
to show. That is the third time this year a green check has turned out to mean
"nothing was looked at" rather than "nothing was wrong".

## 2026-08-25 — The weekly report gathers itself now; the writing is still yours (#437)

The first weekly report took most of an afternoon to put together. Almost none
of that was writing — it was fetching. How many pull requests merged, how many
lines changed, how long the tests took, where every ticket sat. Every one of
those numbers already existed inside a command; somebody just had to go and ask
for each one and copy it down.

So a program does that part now. Every Monday at 7am the Mac Mini gathers all of
it, builds the page, and opens a pull request with the figures already filled in
and a chart of what shipped each day, grouped by which part of the system it
touched. It stops there. It does not write a word of the actual report — the
"here is what mattered this week and why" part is judgement, and a paragraph
written by a machine would read like an opinion nobody actually holds. It leaves
an obvious blank space where that goes, and files a ticket so writing it does not
depend on anyone remembering. Ten minutes on top of finished numbers instead of
an afternoon.

The part worth insisting on is what happens when a number cannot be fetched. It
prints "not available" and says why, in amber so you cannot skim past it. It
never quietly leaves the row out, and it never estimates. A report missing a
metric looks exactly like a report where that metric was fine, and there is no
way to tell from the page which one you are reading. For the same reason, a
pull request only counts as shipped if GitHub itself says it merged — the first
edition credited one that was still open, because a commit message mentioning a
PR is not proof that the PR landed.

Two problems turned up while building it, both of the quiet kind. The first
would have broken something else entirely: the straightforward way to commit
the report would have left the Mac Mini's main folder sitting on the report's
own branch permanently, and the little program that reads your ClickUp replies
checks that folder's branch before updating itself. It would have stopped
updating, kept running old code, and mentioned it only in a log file nobody
opens. The second: the report was dating itself using Greenwich time, so a run
late in the evening stamped tomorrow's date on it and pulled the wrong week's
figures. Both are fixed, and there are tests that fail if either creeps back.

A review pass then caught three more of the same kind, and they are worth
knowing about because all three broke the one promise this thing makes — that a
number it could not fully look up says so. Asking GitHub "which pull requests
merged" only ever gets an answer about recent ones, so when the report was asked
to rebuild an older week it found two merges in a week that actually had
forty-three, and printed the two as though that were the whole story. It now
asks about each pull request it found by name, and anything GitHub will not
vouch for is said out loud on the page in amber — "this count is incomplete,
treat it as a floor" — rather than silently dropped. The same older-week rebuild
was also measuring how much code changed from that week all the way up to today
instead of stopping at the end of the week, which made one week look about fifty
times bigger than it was. And the Monday job had a quiet trap in it: it left its
own finished report sitting in the folder, then next Monday saw a folder with
loose files in it, decided somebody was working there, and skipped updating
itself — forever, since the files were never going to move on their own. It
tidies up after itself now, and there is a test that sets up that exact mess and
fails if the job goes back to sleep on it.

A second review pass found six more, and five of them were the same promise
broken from five new directions — a number that was short, printed as though it
were the whole story. The worst was the schedule itself. Running "the last seven
days" every Monday at 7am means each edition stops at 7am and the next one picks
up from Tuesday, so everything that happened on Monday during the day fell into
no report at all. Nobody would ever have noticed, because from the report's point
of view that time simply never existed — and it is not a rounding error: since
the start of July that is 70 of the 107 things that shipped on a Monday. It also
drew Monday's bar on the chart from seven hours of the day at the same width as
the six full days beside it, so every single week would have looked like it ended
on a slow note. The report now covers the week that has actually finished,
Monday through Sunday.

The second was the "how long does the build take" figure. It was asking GitHub
for the 200 most recent runs and measuring whichever of those fell inside the
week — but this repo now runs so much more than it used to that 200 runs only
reaches back about five and a half days. For the week just gone it was measuring
190 of the 282 runs that actually happened and printing the answer as if it
covered all seven days. It now asks GitHub for the week by date instead of taking
whatever is recent, and it can tell when it has been given everything — if it
ever cannot see far enough, it says so on the tile rather than printing a
confident number. The other four are smaller and the same shape: a count of
finished tickets that had a start date but no end date, so it kept crediting a
week with things closed days later; two scratch files written into the project
folder that, if a run were ever killed halfway, would have left the folder
looking "in use" and quietly stopped the Monday job updating itself again; the
report reading the project history without refreshing it first, which made three
separate figures silently short; and two settings that could be combined to write
the report somewhere nobody intended. Each one now has a test that fails if it
comes back, and each of those tests was deliberately broken first to check it was
capable of failing at all.
## 2026-08-30 — The review caught a way one client could have read another's permissions (#448)

The safe box for client permissions went in last week (the entry below this
one). Review then found four problems with it before it went anywhere near a
client, and one of them was serious enough to be worth understanding, because
the cause is not in that box at all — it is in a piece of plumbing that sits
underneath nearly everything.

Every time the app looks up stored records, it adds "…and only this client's"
to the request. To know whether a particular filing cabinet is even organised
by client, it asks the database once, early on, and then remembers the answer
so it does not have to keep asking.

The flaw was in what counted as an answer. If the database replied "no, that
cabinet isn't organised by client," that is a real answer and remembering it is
correct. But if the question simply failed to arrive — the database was briefly
asleep, the connection dropped, the sort of hiccup this setup genuinely has and
already warns us about — the app treated the silence as though it were the same
"no." And it remembered that. From then on, until the app next restarted, it
stopped adding "…and only this client's" to *anything*.

Nothing would have looked wrong. No error, no blank screen, no slowdown — in
fact the requests get faster and return more. It just quietly starts handing
back everybody's records instead of one client's. In the box we had just built,
those records are the permissions clients grant us to post on their own social
accounts. Rich could have been handed another client's.

It is fixed in two independent places, on purpose, because they fail
differently. The plumbing now only remembers a real answer; a hiccup means "ask
again next time," which costs nothing and lets it recover on its own. And
separately, the permissions box now refuses to run a lookup that has not had
"…and only this client's" attached to it — it stops and says so rather than
returning anything. Either fix alone would have closed this hole. Both together
mean the next piece of code built on that plumbing does not have to know this
story to be safe, which is the part worth paying for.

The other three problems were smaller and are also fixed: a way that recording
"this permission stopped working" could have wiped the permission itself
(unrecoverable — a client only hands it over once); a length limit measured
against the wrong thing, so an unusually long permission would save and then be
unreadable; and four fields that noticed a mistake and then stored a blank
anyway instead of reporting it.

Every fix was checked by deliberately breaking it again and confirming the
relevant test failed — a test that cannot fail is worse than no test, because
it tells you it is watching something when it is not.

You applied the database change the same day, and I confirmed against the live
database that both tables arrived correctly and are organised by client the way
they must be. The box is real and empty, which is exactly where it should be.
The next piece — the part that actually talks to Instagram and X — is unblocked.

## 2026-08-30 — Why the review-gate work sat two hours after you approved it

You said "merge" on the review-gate ticket and it stayed put. None of the reason
was visible from the ticket, so here it is.

Two things were genuinely wrong first, and both were handled correctly. The
automatic checks were failing for a real reason, so the merge step refused to
merge — the right call, and it said so quietly each time rather than nagging.
Another session fixed the failing check and saved its work.

The stall came after that. Before merging anything, the machinery brings the
branch up to date with the live code. It did, and that update was clean — there
was never anything to resolve. But in the moment it went to save the result, the
other session had just saved to the same branch, so its save was rejected. That
is two things arriving at once, not a disagreement in the work itself, and the
correct response is simply to try again on the next pass.

It half did that. One part of the machinery understood exactly what had happened
and posted "it will be merged on the next run." A second part, which never asks
whether a conflict is real, filed a whole new ticket titled "Resolve the merge
conflict" — for a conflict that did not exist — and posted that too. So the
ticket ended up carrying two notices, a fifth of a second apart, saying opposite
things: one that it would sort itself out, one that a new ticket now owned it.
Neither came true.

Cleared by hand: bring the branch up to date with today's live code, save it,
wait for the checks to go green, merge. The real repair — stop filing a conflict
ticket when there is no conflict — is filed as its own task. The rule the
incident produced is written down as DOCTRINE §2.6: work out who is waiting
once, in one place, so two halves of the same pass can never name two different
actors.

## 2026-08-31 — The merge lock can now actually read the tickets

The check that reads a ticket before letting anything merge has been running
blind since it was built. It needed a password to look at ClickUp, that password
was never added, and so on every single pull request it answered "I can't see" —
which it correctly treats as a refusal rather than an all-clear. Harmless so far,
because the check is still in warning mode and cannot block anything, but it
meant nobody had ever watched it do its actual job.

It has one now, and it works. On the first real run it named the ticket, read
the newest review on it, and correctly said the work had been sent back rather
than passed. I checked that ticket myself afterwards to be sure it was right and
not just producing a sensible-looking sentence. It was right.

**Getting it there took two wrong turns, and the second one is worth writing
down.** You were sent to the GitHub settings page to paste the password in by
hand. That page has a box for the *label* sitting directly above the box for the
*password*, and the password went in the label box — twice, with two different
passwords. GitHub scrambles a password so nobody can read it, but it does no such
thing to a label, so both were sitting there in plain sight until they were
deleted. Nobody but you can see that page, and there's no sign either was used,
but they should not have been there at all.

The cause was a rule of mine, applied backwards. It says an agent must never
handle a real password — and it was written after a photo went round with a
credentials file visible on a TV in the background. That rule is about a value
being *seen*, not about who is holding it. Read the other way, it sent the
password on a detour through the one screen in the whole process where it could
be typed into the wrong field. There was a one-line command available the whole
time that moves the password straight from one vault to the other without ever
showing it, and it had no label box to get wrong. That command is now what the
instructions say to use, and running it is my job.

The rule has been rewritten to say what it always meant: **the question is
whether the value ends up somewhere it could be read.** If no, the machine does
it. If yes — writing one down, making a new one, typing it into a web page —
that stays with you.

The lock still cannot block anything. One prerequisite is left before it is
switched on for real, and it has its own ticket.

## 2026-08-26 — Saving a shared section no longer wipes your page templates (#428)

The Builder lets you save a section — a footer, say — once and have every page
that uses it follow along. This change was meant to make that push reach page
templates too. It did, but it wrote them the wrong way: instead of updating
just the sections, it overwrote the template's whole record with mostly blanks.
A template called "Delray — Main Site Template" came back with no name at all,
and its subject line, colours, logos, banner images and feature copy went with
it. Templates keep no history, so there was nothing to undo it from.

The write now hands over the full template with only the sections changed —
the same way the page side has always done it. Two tests hold the line, and
both were deliberately broken first to confirm they actually catch it: one
runs a real push through the real storage code and checks the name and
everything around it survives, and one fails if someone later adds a field to
the saving half without adding it to the loading half, which is how this class
of bug gets back in.
## 2026-08-29 — A safe place to keep a client's own permissions (#448)

Right now, posting to a client's Instagram or X means somebody pastes that
client's password-equivalent into a settings screen by hand. The plan is to
replace that with the client clicking "Connect" on their own screen and granting
us the permission themselves. This is the safe box those permissions will go
into — and nothing else. There is no screen to look at yet, and nothing reads or
writes the box so far. Six more pieces follow.

Two things got the care here, both of them mistakes this project has already
paid for. The first is a record that forgets which client it belongs to. Two
columns decide that, and if a table carries only one, the code that fills them
in quietly gives up and fills in neither — nothing errors, the rows just land
belonging to nobody. That happened to 550 records in August. A record belonging
to nobody here would be a client's login permission with no name on it, so this
one does not merely test for the problem: it refuses to write at all if it
cannot put the client's name on the row.

The second is answering a question with a blank instead of an error. The
existing version of this code, when it cannot unscramble a stored permission,
hands back an empty one and reports success — so the app then tries to post with
no credential and Instagram's complaint reads as the client's fault. This one
says it could not read the permission, which is the true answer.

The permissions themselves are scrambled before they are stored, and that was
checked the only way worth checking: by looking at what actually landed in a
real database and searching every column of the table for the original text. It
is not there.
## 2026-08-26 — The new merge lock could have jammed itself shut (#443)

Yesterday's change put a real lock on the merge button: before anything goes
live, GitHub itself checks the work's ticket for a review pass. It works — but
it had a flaw that would only have shown up on the day you switched it from a
warning into a real block, and by then it would have stopped everything.

The problem is that these checks run **once**, right after code is pushed, and
they never think again. The review always lands *after* the last push — that is
what a review is. So the check looked at the ticket, saw no review yet, wrote
down "no", and then sat there forever with that answer. Nothing was ever going
to change its mind. The only way to make a check run again is to push more code,
and pushing more code cancels the review that just passed. Every properly
reviewed piece of work would have been stuck in that loop.

So the step that actually performs merges now asks one extra question first: is
this check answering a question that has since changed? If the check ran before
the review landed, it runs it again and waits for the real answer — about three
minutes — instead of merging on the old one. If the fresh answer is a no, the
merge is refused and you are told why. If the check cannot be run again at all,
or its answer never arrives, the merge is refused too: not being able to see is
never treated as an all-clear. And when the check is already up to date, nothing
happens and nothing is spent, which is the ordinary case.

Nothing about the lock itself was loosened to achieve this — "out of date" only
ever means run it again, never let it through. With this in place the
branch-protection setting is safe to turn on.

The review pass caught something important before this shipped: the new
question was being asked in the wrong place. Once the lock is switched on, an
out-of-date check shows up as a *failed* check — and the merge step's very
first rule is "never merge past a failed check", so it was giving up before it
ever got to the new question. Everything looked fine in testing because the
lock is still in warning mode, where the old answer stays green. The question
now gets asked before that first rule instead of after it, a test pins the
order so it cannot quietly drift back, and three smaller catches from the same
review ride along: the step no longer pays for a re-run it has no time left to
wait for, a branch that falls behind during the wait is told "catch up first"
instead of being blamed for a failed check, and a moment where GitHub is
swapping the old answer for the new one no longer looks like "no check here,
go ahead".

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
## 2026-08-30 — The rule about who runs the commands, put where it gets read (#453)

Three times now you have had to say the same thing: when there is a command to
run, I should run it, not hand it to you to paste. The most recent was the
Delray header evening. Early on, one of my own safety gates refused a step —
and instead of treating that as "this one call was blocked", I treated it as
"I am not allowed to touch production tonight", and everything after that came
back to you as something to copy. One of those was a script with two halves: a
practice run that shows what it *would* change, and a second command that
actually changes it. You ran the practice half. Nothing told you the real one
was still sitting there waiting, so the fix was written but not applied, and
most of an evening went on it.

The reason it keeps coming back is dull and fixable: the rule was only written
down in my memory and in the vault, and neither of those gets loaded when a
session opens this repo. `CLAUDE.md` does — every session reads it. So the rule
now lives there, in the "Coach the operator" section, with the full story and
the incident behind it in `docs/DOCTRINE.md`.

It says four things. I run the operational commands and tell you what happened
in plain English. There are exactly four things I hand over instead — a real
password or key, a billing screen, a login in your browser, and a decision
that is genuinely yours — and when I hand something over I have to say which
of the four it is, so "I need you" never arrives unexplained. A refusal applies
to the one command it refused, not to the rest of the session. And a fix with
a practice run and a real run is one job, not two: I run both and tell you what
changed.

Nothing about the app changed — this is a change to the instructions I read.
## 2026-08-30 — Small, safe changes now merge themselves after an hour's notice (#438)

Your ruling from the 24th is now running code: a pull request that touches
nothing but tests and documentation, and has already passed review, announces
itself on its ticket — "merging at 9:15pm unless you say otherwise" — waits
one hour, and merges. Any comment from you during that hour stops it; not a
keyword, anything at all. Everything riskier still waits for your word, and
Lane C — anything visual, routes, data, sign-in — is never automated.

It shipped the careful way: the first review pass sent it back because the
branch had fallen behind the main line, and the second found six real holes
before anyone was exposed to them. The two that mattered: the loop agents'
own instruction files counted as "documentation", so a change rewriting the
review rules could have merged itself — now anything that instructs an agent
is on the never-auto-merge list; and a damaged memory file (the little ledger
that records "Dane said stop") was being replaced with a blank one, which
would have quietly lifted your stop order a pass later — now a ledger that
cannot be read is never written over, it is left for a person to look at.

Also from that review: an announcement that sat armed for more than a day
goes stale and is cancelled instead of merged, the daily digest no longer
lists the same merge twice, and a dry run truly writes nothing. Every one of
those rules was broken on purpose to prove a named test catches it. The
switch is `stop auto-merging` on the party line or any Loop Queue ticket,
and `npm run clickup -- auto-merge-status` shows the lane's state any time.

## 2026-08-30 — Tickets now end on what they need from you, in red (#457)

You asked for three things while looking at a merge ticket: put the "NEEDED
FROM DANE" block last, make it properly red and bold, and put the actual ask
on the same line as the label instead of hiding below the banner. All three
shipped the same day through the fast-track lane.

Every card a machine puts in front of you now ends on the banner — your words
first, then the explanation, then any proof, and the ask dead last, where your
eye stops. The banner is bold and true red (#CC0000). The washed-out red you
were seeing before was never a choice anybody made: it was ClickUp's standard
colouring for "computer text", which the banner was wrapped in for safety.

Getting the real red meant changing how cards are sent. ClickUp only allows
coloured text through its structured format, and that format ignores the
usual **bold** markup agents write — so the card builder now translates as it
posts, and the tests prove the translation both ways: break the colour, a
named test fails; move the banner up, another one fails.

There is a living sample on the ticket itself (86bbq5ruz) — the newest card
from Pulse ends exactly the way every future one will.

## 2026-08-30 — When a merge gets stuck, somebody is now actually told to fix it (#452)

You found PR #434 sitting untouched for three days and asked why nothing had
happened. Here is what was going on, and it was not anybody forgetting.

When two pieces of work change the same lines of the same file, the computer
cannot safely guess which version wins — that is a "merge conflict", and it
needs a pair of hands. The system knew that. On hitting one it did two things:
it left a note on your ticket saying your approval still stood and you did not
need to do anything, and it posted a message on the party line asking for a
session to come and sort the branch out.

The second half never worked. **Nothing reads the party line.** There is no
watcher on that channel turning those requests into work, so the message went
into an empty room — while the note on your ticket, sitting right next to it,
described a process that was well underway. Both halves individually looked
fine. Together they meant a job nobody had, under a message saying it was in
hand. And it was quiet, so nothing looked wrong: every hourly check reported
"handed off, nothing new to say" and "0 merged", which is exactly what a
healthy system says when it has nothing to report.

You picked the fix: instead of asking an empty room, **file it as an ordinary
job in the queue**. The build loop already empties that queue every pass, on a
timer, today — so the worker exists and is already running. Now a conflict
creates a normal ticket ("Resolve the merge conflict on PR #N"), carrying the
branch, what clashed, and a note telling whoever picks it up not to come back
and ask you to approve a second time, because you already did.

Two more things came with it. Every message the merge step writes now has to
name **who** is going to act next, and if the answer is nobody it has to say so
out loud — "Nothing is currently working on it" — rather than reaching for the
comfortable phrasing that implies someone. And silence now expires: a conflict
with no ticket behind it is flagged immediately, and one that has not been
sorted within a day reports itself by name once a day until it is cleared —
each report re-arms the clock, so a day of silence is the most it can buy
(that cadence was the review's fix; as first built it nagged every pass).
Three days of nothing cannot happen again without something saying so.
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
