# Before / after screenshots — how a visual change reaches Dane

> Ratified as **charter Q5** (2026-08-18): *visual changes reach Dane as
> before/after screenshots in the approval queue; non-visual work ships on
> gates and a second-agent review.*

## The problem this solves

Nothing in this repo tests CSS. Every automated gate here answers a question
about *mechanism* — `check:css` asks which declarations survived, `check:render`
asks whether a control is dead, `check:panels` asks whether a panel's slots line
up. None of them can tell a bounce from a wobble (`docs/DOCTRINE.md` §5.14).

The only instrument that has ever caught a page *looking wrong* is Dane's eye.
So the job is not to judge a visual change automatically — it is to get the
change in front of that eye without him checking out a branch, running a
server, or knowing a branch exists.

## What to run

```
PORT=3058 node server.js                                   # in another shell
UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:shots
```

| Flag | What it does |
|---|---|
| `--task <clickup-id>` | comment on that ticket and attach the images to it |
| `--list <clickup-list-id>` | open a fresh "Visual review" ticket in `Needs your input` |
| `--dry-run` | write the images to `.ui-shots/` and file nothing |
| `--base <ref>` | compare against something other than `origin/main` |
| `--force` | shoot even when no watched file changed |

With no `--task` and no `--list` it writes the images locally and says so.
That is deliberate: filing into the operator's inbox is not something a
command should do by accident.

## What it actually does

1. **Decides whether to bother.** If nothing under `components/`,
   `lib/builder-client/`, `src/css/`, `public/images/`,
   `public/builder-preview.html` or `builder-react-entry.tsx` changed since the
   merge base, it prints that list and stops. A change *outside* those is
   assumed non-visual — the assumption is printed rather than hidden, and
   `--force` overrides it.
2. **Refuses to shoot the wrong build.** Same guard `check:render` and
   `check:panels` use (`scripts/ui/app-driver.mjs`): if the built files are
   older than their sources, or the server on that port belongs to another
   worktree, it stops before a browser opens.
3. **Builds the "before" side.** The merge base is extracted with `git archive`
   into `.ui-shots/baseline/` and bundled with the same two build scripts.
   Both sides are then built and photographed on the same machine, minutes
   apart.
4. **Photographs six scenes** on `builder-preview.html` — typography, a
   picture, a button, a card grid, a table, a pull quote — through this
   checkout's build and through the baseline's.
5. **Compares them exactly**, and files the pairs that differ.

## Why "before" is built rather than committed

The obvious design is a folder of expected PNGs in git. It does not work here.
The harness blocks the network so a font host can never decide a measurement
(the same reason `check:render` does), which means the browser falls back to
**system** fonts — so a baseline shot on the Mac and a shot on the Mini differ
in every letter, forever. Building the merge base on the spot removes the
machine from the comparison entirely.

The one thing that costs: the baseline is built against **today's**
dependencies. If the change under review is a dependency bump, the "before"
side is the old source against the new packages. Rare, but a wrong "before"
reads exactly like a right one, so it is named here rather than engineered
around.

## Why the comparison has no tolerance

One differing pixel is a change. A tolerance — "ignore anything under 0.05% of
pixels" — hides precisely what needs a human: a border that lost 1px, a colour
two shades off, a caption that moved.

Exactness is affordable only because the run **proves its own instrument
first**. Before anything is compared, one scene is shot twice: once normally,
once through the same request-interception machinery the baseline uses, serving
this checkout's own files. Those two must come back pixel-identical. If they do
not, the run fails and files nothing, because every verdict below it would be
noise. **If that control starts failing, fix the scene — never the
comparison.**

## Adding a scene

Scenes live in `scripts/ui/shot-scenes.mjs`. A scene must be **static**
(anything that polls, fetches or randomises makes two shots differ by the
milliseconds between them) and **self-contained** (no database, no login, no
seeded fixture — that is what makes the whole check cost a minute).

Then do the two things that make it real:

1. Run it twice with no changes and confirm it reports nothing.
2. Change something visible on purpose and watch it get photographed.

Step 2 is not ceremony. Writing this feature, two "deliberate" test changes
photographed as *unchanged* and both times the harness was right: the heading
and module wrappers write `color`, `letter-spacing` and `margin` as **inline
styles**, which outrank any stylesheet rule. And the table scene first shipped
with cell contents as strings when the renderer wants arrays of modules — it
photographed a table with six empty cells and passed cleanly.

## What a green run does and does not prove

A pixel count proves something changed. It never proves it changed *correctly*
(`docs/DOCTRINE.md` §5.14). The images are attached precisely because that
judgement is not automatable — the ticket asks "does this look right", which is
the only question left once every other gate is green.

Equally, "no scenes changed" means *these six scenes* did not change. A module
with no scene has no coverage here at all.
