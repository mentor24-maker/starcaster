# Module Development Pipeline

How Builder module projects move from "I saw a problem on a page" to
merged, verified code — with ClickUp as the intake and paper trail.
Established 2026-08-06 with the Site Import slider work as the pilot
(ClickUp `86bb9xt0y`, Starcaster › Dev Backlog).

The Site Import phases proved the groove: **spec before code, operator
ratifies, tests are first-class, live-fire verification closes it.**
This pipeline is that groove, sized for module-scale projects.

## Where work lives

| Thing | Place |
|---|---|
| Intake + status + ratification trail | ClickUp task in **Starcaster › Dev Backlog** |
| Specs and deviations | The ClickUp task description/comments; repo docs only for platform-wide contracts |
| Code | One worktree + branch per project (`git worktree add .claude/worktrees/<topic> -b <topic> origin/main`) |
| Review | GitHub PR; CI `verify` must be green; operator says "merge" |

## The stages (copy this checklist into every intake task)

1. **Intake** — problem statement in plain language, evidence (which
   page, which job/project, screenshot), and what "fixed" looks like.
   Anyone can file; nothing is built from a verbal report alone.
2. **Discovery** — read the actual data (captured IR, DB rows, rendered
   output) before proposing anything. Findings posted to the task.
3. **Spec** — short written plan: approach, detection/mapping rules,
   fallbacks, test fixtures, definition of done. Posted for ratification.
4. **Ratify** — operator approves on the task (a comment is the record).
   Scope changes after this point go back through spec.
5. **Build** — own worktree, tests written with the code (fixtures for
   engines, snapshot tests for documents, vitest for UI). The CLAUDE.md
   definition-of-done commands all pass locally. **Module work is checked
   against `docs/MODULE_STANDARDS.md` before the PR opens**; rules that
   don't apply are stated and skipped, never silently ignored.
6. **Verify** — live-fire against real data (the scratch project is the
   proving ground), operator eyeball required.
7. **Merge & close** — PR merged on the operator's word; deviations
   recorded; ClickUp task closed with links to PR + evidence.

## Rules inherited from hard experience

- **A checklist item skipped is a decision, not an accident** — say so
  on the task ("skipped Discovery: trivial CSS fix").
- **Module-type registration is dual** (landmine #1): any new module
  type needs `npm run build:builder-template` or the server silently
  coerces it to `text`. Full quality bar: `docs/MODULE_STANDARDS.md`.
- **Boy-scout rule**: a module touched for any reason is brought up to
  the standards doc in the same PR, and the PR says which rules it now
  meets. The palette predates the standard; this is how it converges.
- **Imports and generators must reconcile** — tools that transform
  content carry coverage accounting; unexplained loss blocks merge.
- **The scratch project is disposable by design** — verify there first
  when the change touches tenant-visible rendering.

## Relationship to the Loop Queue

Dev Backlog is human-paced: spec'd, ratified, operator-verified. The
**Loop Queue** (loop-engineering, PR #51) is for autonomous recurring
work and never merges on its own. A Dev Backlog task may *spawn* loop
work (e.g. test-coverage sweeps) but module projects themselves ride
this pipeline.
