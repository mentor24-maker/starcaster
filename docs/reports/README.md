# Weekly reports

One edition per week: `YYYY-MM-DD.html` (the page) and `YYYY-MM-DD.data.json`
(every number on that page, so a narrative pass re-gathers nothing).
`index.html` lists the editions, newest first.

**These are records, not build artifacts.** They are committed on purpose and
must never be added to `.gitignore` or to `check_conventions`' generated list —
the same category as `docs/WORK-LOG.md`. A report that vanishes on the next
build is not a record, and a test pins this so a future tidy-up cannot quietly
reclassify them.

## Who writes what

| | Who | How long |
| ---| ---| --- |
| The figures | `scripts/weekly_report.mjs`, Mondays 07:00 on the Mini | seconds |
| The narrative | a person, on top of the figures | about ten minutes |

The script does **not** write prose. The ranked five, the plain-language
summaries, "your inputs" and any incident write-ups are judgement; a generated
paragraph would read like a decision nobody made. Each edition arrives as a
pull request with a visible empty slot for the narrative, and a ClickUp ticket
so writing it is queued work rather than something to remember.

A figure the script could not read says **"not available" with its reason** — it
is never omitted and never estimated. Only pull requests GitHub reports as
MERGED are counted.

Full arrangement: `docs/LOOP_ENGINEERING.md` → "The weekly report".
