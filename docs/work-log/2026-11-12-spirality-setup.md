## 2026-11-12 — StarCaster cannot run Spirality's loop yet: add its settings, verify check, ticket door, loop skills and lanes (#1003)

This pull request moves StarCaster onto the loop Spirality defines: its
settings file, the `verify` check, the ticket door, the four loop skills and
the scheduled lanes that run them.

The first version was sent back by review, for two good reasons:

- **It switched off StarCaster's safety guards.** The setup replaced
  `.claude/settings.json` (the file that tells Claude Code which checks to run
  before and after each action) with Spirality's much shorter one. That
  quietly turned off six guards StarCaster still depends on — including the
  one that stops anybody hand-editing a generated file, which is how the
  Contacts delete button broke for a month. The file is StarCaster's own again;
  the one guard Spirality wanted was already in it.
- **It deleted tests of code that is still in use.** The setup retired every
  old test that mentioned a file it rewrites. Seven of those were mostly
  testing commands that still run every day (`npm run ship`,
  `npm run pipeline`, `doctor:node`, throughput, the Stop hook). They are
  back; only the lines that checked the old wording of the rewritten docs are
  gone, each with a note saying why.

Bringing those tests back caught one more thing: the setup adds a fourth loop
skill, `loop-intake`, that the map of the whole system did not list. It does
now.
