# The Development Ecosystem — how this works

`inventory.yaml` in this folder is **the thing a human edits.** The diagram,
the Obsidian pages and the links between them are all *generated* from it.

Nobody ever drags a box. That is the whole point.

## Why it is a file and not a drawing

Every ecosystem diagram Dane has watched rot at previous jobs rotted for the
same reason: it was a *drawing*. A drawing is accurate exactly once — the day
it is drawn — and the moment reality moves, the picture quietly starts lying.
Nobody notices, because a diagram has no way to complain.

An inventory can complain. `npm run check:ecosystem` refuses a file that
contradicts itself, and a later drift check (a separate task) will refuse a
file that contradicts *reality*.

## Not to be confused with the other ECOSYSTEM

The vault has `doctrine/ECOSYSTEM.md`, which is ratified canon and describes
the **business** ecosystem — Dane, Alphire, Starcaster, Normie, DEO, Agora,
the clients. It outranks everything.

This file is the **development** ecosystem: machines, repos, containers,
scheduled jobs, wires. Different subject, no overlap. Call this one the
*Development Ecosystem* so the two are never confused in conversation.

## Where the generated output goes

Into the vault, at `~/vault/wiki/ecosystem/` — the diagram, the map note,
one page per object, and `ecosystem.html`: a standalone, self-contained copy
of the map for anyone without the vault (a teammate, or Dane on his phone).
It opens with no network at all, works in light and dark, and clicking a box
shows that object's story in a side panel instead of opening Obsidian.

```
npm run build:ecosystem          # the diagram (ecosystem.svg)
npm run build:ecosystem-notes    # the map note + one note per object
npm run build:ecosystem-html     # the standalone page (ecosystem.html)
```

None of them publishes anything. After regenerating, commit and push the
vault yourself; the generators only write files.

The machinery lives here rather than in the vault because the vault's own
rulebook (`~/vault/CLAUDE.md`) says folders are layers rather than topics, and
that machinery does not get built there. So: this repo holds the parts that
run, the vault holds the parts a person reads.

Every generator takes `--out <dir>`. It must, or a build running in a git
worktree would reach outside itself and write into the real vault as a side
effect of running its own tests.

## Editing it

Open `inventory.yaml`. The field reference is at the top of the file. Then:

```
npm run check:ecosystem
```

It reports **every** problem it finds rather than stopping at the first, and
it names the object or relationship at fault. Common ones:

- a relationship naming an object that does not exist (usually a typo in an id)
- two objects sharing an id — ids become filenames, so they cannot collide
- an object with no relationships and no host, which would render as an
  island nobody can interpret

## Touched on decision, not on schedule

Same rule as doctrine. If you change how the system is wired — a job moves
machines, a service is retired, a new repo appears — this file changes the
same day. It is a record, and a record that lags is worse than none, because
people trust it.
