# Weekly reports

**Nothing is written here any more.** The one edition here (`2026-08-30`) and
the index beside it are history — what shipped while the report published itself
as a pull request. They stay because they are the record; deleting them to tidy
up would throw away the only thing this folder was ever for.

New editions live in **Google Drive → Projects → Starcaster → Weekly Reports**
on the `mentor24@gmail.com` account:
<https://drive.google.com/drive/folders/1cnnlchiXlFQj_D_iv-x0mj1P1TGqP8KC>

## Why they moved (2026-09-14, task 86bc0nbwq)

Writing a report into the checkout made `git status` non-empty, and a machine
with uncommitted work in its checkout refuses to update itself. So one Monday
run switched off the Mac Mini's updates and it went on running the previous
week's pipeline code — on 2026-09-14 that cost 7 merges, including the same
day's own pipeline fixes (#689, #700). `scripts/run_weekly_report.sh` already
carried two cleanup passes written against exactly this, and they did not
prevent it, which is the argument for not writing here at all.

Dane, 2026-09-14: *"It shouldn't be saved to the Mini. It should either be saved
to the MacBook and/or Google Drive in the Projects/Starcaster folder in a
dedicated sub-folder."*

The report now writes to a folder **outside every git checkout** — by default
`~/Documents/Starcaster/Weekly Reports`, and `lib/weeklyReportHome.js` refuses
to run at all if that folder turns out to be inside a repo — and `--publish`
uploads the edition to the Drive folder above, reading each file back from Drive
before calling it done. An upload that fails is a failed run: it posts to the
bus and exits non-zero, which `scripts/report_job_failure.mjs` turns into an
alert. There is no quiet path where the report exists on one machine only.

## Two rules about the Drive folder

Both were added on 2026-09-15 after the first review pass of this work.

**Your writing is safe there.** Once `<date>.html` is in Drive it is never
overwritten. Download it, write the narrative on it, put it back under the same
name — if that week's report is ever run again (a Monday that failed halfway
does get run again), it finds the page already there, leaves it exactly as you
left it and says so in its log. Only the figures file and the index are
rewritten. To publish a fresh figures page over yours on purpose, delete or
rename the page in Drive and run again.

**`index.html` is built from what is in the Drive folder**, not from the folder
on whichever machine ran the report, and its links are Drive's own file links.
Two reasons: moving `weekly-report` to another machine is a one-line edit in
`lib/nodeRoles.js`, and that machine's local folder holds one edition — an index
built from it would list one edition while every earlier one sat in Drive
unlisted. And a relative link (`href="2026-09-14.html"`) resolves to nothing
when the page is opened from Drive, which is the only place it is ever opened.

## Who writes what

| | Who | How long |
| ---| ---| --- |
| The figures | `scripts/weekly_report.mjs`, Mondays 07:00 on the Mini | seconds |
| The narrative | a person, on top of the figures | about ten minutes |

The script does **not** write prose. The ranked five, the plain-language
summaries, "your inputs" and any incident write-ups are judgement; a generated
paragraph would read like a decision nobody made. Each edition lands in Drive
with a visible empty slot for the narrative, and a ClickUp ticket so writing it
is queued work rather than something to remember.

A figure the script could not read says **"not available" with its reason** — it
is never omitted and never estimated. Only pull requests GitHub reports as
MERGED are counted.

Full arrangement: `docs/LOOP_ENGINEERING.md` → "The weekly report".
