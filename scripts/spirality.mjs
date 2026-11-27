#!/usr/bin/env node
/**
 * Run Spirality's ticket door (or its doctor, or its Doppler wrapper) for this
 * checkout (SC-870). This is what `npm run clickup`, `npm run doctor` and
 * `npm run bus:move-in` call, so every `npm run clickup -- <command>` written
 * in CLAUDE.md works exactly as it did when the door was copied into `loop/`.
 *
 *   node scripts/spirality.mjs clickup <args>        the door, with this project's Doppler keys
 *   node scripts/spirality.mjs doctor <args>         Spirality's doctor, for this checkout
 *   node scripts/spirality.mjs with-doppler <cmd...> run a StarCaster script with this project's keys
 *   node scripts/spirality.mjs where                 print which Spirality folder is used, and why
 *
 * Spirality's folder is found by lib/spirality.cjs (the release the lanes run,
 * or SPIRALITY_DIR). SPIRALITY_PROJECT is set to THIS checkout, which is how
 * Spirality's door acts for a project from its own folder (Spirality SP-270).
 * No Spirality on this machine stops here, exit 1, saying what to do: never a
 * silent "no tickets".
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const spirality = require('../lib/spirality.cjs');

const [verb, ...rest] = process.argv.slice(2);
const VERBS = ['clickup', 'doctor', 'with-doppler', 'where'];
if (!VERBS.includes(verb)) {
  console.error(`spirality: say one of ${VERBS.join(', ')} (got ${verb ? JSON.stringify(verb) : 'nothing'}).`);
  process.exit(2);
}

let found;
try {
  found = spirality.locate();
} catch (err) {
  console.error(`spirality: ${err.message}`);
  process.exit(1);
}

if (verb === 'where') {
  console.log(`${found.dir}\n  found by: ${found.how}`);
  process.exit(0);
}

const at = (rel) => spirality.spiralityPath(rel);
const node = process.execPath;
const wrapper = [node, at('scripts/with_doppler.mjs')];
const command = {
  clickup: [...wrapper, node, at('scripts/clickup.mjs'), ...rest],
  doctor: [node, at('scripts/doctor.mjs'), ...rest],
  'with-doppler': [...wrapper, ...rest],
}[verb];

if (verb === 'with-doppler' && !rest.length) {
  console.error('spirality: with-doppler needs a command to run.');
  process.exit(2);
}

// Async, and every stop signal is passed on (SC-870 review). A caller's time
// limit (execFileSync `timeout`) signals THIS process only; with spawnSync the
// launcher died and the door it started kept running, so a bus post counted as
// unsent and retried next wake landed twice.
const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, SPIRALITY_PROJECT: spirality.REPO_ROOT },
});
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    try { child.kill(sig); } catch { /* already gone */ }
  });
}
child.on('error', (err) => {
  console.error(`spirality: could not start ${command[1] || command[0]}: ${err.message}`);
  process.exit(1);
});
// Stopped by a signal: the shell's convention, 128 + its number.
child.on('exit', (code, signal) => {
  process.exit(code ?? 128 + (constants.signals[signal] ?? 0));
});
