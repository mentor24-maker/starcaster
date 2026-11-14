# loop/

The ticket door for StarCaster: the commands a session uses to read and move
StarCaster's tickets (`npm run clickup -- <command>`) and to check its keys and
repository (`npm run doctor`).

Every file here except this README is copied byte for byte from
[Spirality](https://github.com/mentor24-maker/spirality) at commit
`e5d86e4`, keeping Spirality's layout (`scripts/` beside `lib/`) so no import
changes. The project settings it reads are StarCaster's own
`spirality.project.json` at the repository root.

Do not edit these files here. A change is made in Spirality first, then
copied in by Spirality's setup wizard (`npm run onboard:copy`) from a newer
commit. `npm run test:loop` runs the copied tests.

## The runner scripts

The loop jobs on the Mini are run by files copied from Spirality. They live in
the repository's own `scripts/`, not here, because each one finds the
project's folder from where it sits.

**Byte for byte from `e5d86e4`** (SC-807): `scripts/pause_check.sh`,
`scripts/work_check.sh`, and in `scripts/lib/`: `wakeSetting.mjs`,
`modelSetting.mjs`, `laneModels.mjs`, `workCheck.mjs`, `loopSchedule.mjs` and
`scratchGit.js` (Spirality's `lib/scratchGit.js`, which the tests use).

**Copied with only an import path changed**: `scripts/project_config.mjs` and
`scripts/lib/wakeLane.mjs` import `../loop/lib/projectConfig.mjs` (or
`../../loop/lib/…`) instead of Spirality's `lib/projectConfig.mjs`. The four
tests in `scripts/lib/*.test.mjs` (`npm run test:runner`) point at those same
places, leave out the one check that needs Spirality's `tracker/` folder, and
add StarCaster's own guards to the runner tests.

**Merged, not copied**: `scripts/loop_runner.sh`, `scripts/run_relay.sh` and
`scripts/install_loop_runner.sh` are Spirality's at `e5d86e4` with
StarCaster's own guards kept (listed at the top of `loop_runner.sh`: the
background-caller flag, the `npm run pipeline -- check` switch, the shared
lane policy, the usage-limit guard and a heartbeat on every pass, skipped and
paused ones included). Spirality's application-checks step on the relay
(SP-274) is not in StarCaster's copy. `scripts/builder/pulse.js` takes
Spirality's START-line pattern, which allows the `(model: …)` note.

**The loop-build skill carries Spirality's `wip-check` step** (SP-238), copied
from `e5d86e4` with only the `lib/wipCap.js` path changed to
`loop/lib/wipCap.js`. The runner asks the cap inside its work check, but it
skips that check on the first pass after a restart and on the forced idle
pass, so the skill's own step is what holds the cap on those passes.
`scripts/builder/loopBuildSkillWipCheck.test.js` fails if the skill stops
asking `wip-check` before it claims.

This whole copy is a stopgap, deleted when Spirality runs StarCaster's lanes
from its own folder (SP-273 / SP-276).
