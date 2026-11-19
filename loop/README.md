# loop/

The ticket door for StarCaster: the commands a session uses to read and move
StarCaster's tickets (`npm run clickup -- <command>`) and to check its keys and
repository (`npm run doctor`).

Every file here except this README is copied byte for byte from
[Spirality](https://github.com/mentor24-maker/spirality) at commit
`a262334` (2026-11-18, SC-867), keeping Spirality's layout (`scripts/` beside `lib/`) so no import
changes. The project settings it reads are StarCaster's own
`spirality.project.json` at the repository root.

Do not edit these files here. A change is made in Spirality first, then
copied in by Spirality's setup wizard (`npm run onboard:copy`) from a newer
commit. `npm run test:loop` runs the copied tests.

`d538a7f` brings in the two door changes SC-818 needs: a project's bus in its
own queue (Spirality #290, `804c1f4`) and the `move` command (Spirality #299,
`e2b2c4e`). Seven files are new with it, each copied whole: `fileHold.js`,
`loopNoticeboards.js`, `prFiles.js`, `releaseFollow.mjs` and `ticketClass.js`
(the door imports them) with their tests, plus `loopThroughput.js` and
`watchdogPosts.js`, which only `loopNoticeboards.test.js` needs. Spirality
tests that read Spirality's own `docs/` or `tracker/` folders (for example
`trackerBus.test.js` and `moveDoor.test.mjs`) are not copied, because those
folders are not here.

`a262334` (SC-867) brings in the door's SQL check (Spirality #313): `ask`
and `comment` refuse, before anything is posted or moved, a body that names a
`.sql` file without the DOCTRINE 6.5 run block for it. StarCaster's build pass
ran the older copy on 2026-11-17 and put a bare SQL path on SC-832's card eight
hours after Spirality had the check. Only six files differed from `d538a7f`
(`scripts/clickup.mjs`, `scripts/lib/operatorCard.mjs` and its test,
`scripts/lib/expectedSecrets.mjs`, `lib/relayLane.js` and its test); every
other file here was already identical, so the whole door is now that commit.

**Something now watches this copy** (SC-868). `npm run loop:drift` compares
every file here except this README with the same file on Spirality's `main`,
by git file id, and answers IN STEP, BEHIND (naming each file that differs or
that Spirality has deleted, and Spirality's commit) or CANNOT TELL. The relay
runs it on its wake (`scripts/run_bus_relay.sh`) and posts BEHIND and CANNOT
TELL to StarCaster's bus once a day each, with one all-clear when the copy
matches again. It only says so; bringing the copy up to date is still a pull
request that copies from Spirality's commit and passes `npm run test:loop`.
The runner scripts below are not watched: they are behind on purpose.

## The runner scripts

**The runner scripts below are still from `e5d86e4`**, deliberately: the door
moved to `d538a7f` in SC-819, but neither change SC-818 needs touches a runner,
and Spirality's runner changes since then are about running a project's lanes
from Spirality's own folder (SP-273), which this stopgap copy exists instead
of. The newer door still answers every command these runners call
(`npm run test:runner` passes against it).

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
