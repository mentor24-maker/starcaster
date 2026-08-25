// The relay's interval drift check must have THREE answers, not two.
//
// It is the compensating control for a step only a person can do (re-running
// the installer on the Mini). A check like that may say "matching" only when
// it actually compared two numbers — a check that says "all clear" when it
// could not read anything is worse than no check, because it retires the
// suspicion that would otherwise make someone look (docs/DOCTRINE.md 3.11).
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'bus_relay_interval.sh');

function repoInterval() {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'install_bus_relay.sh'), 'utf8');
  const m = src.match(/^INTERVAL_SECONDS=(\d+)/m);
  assert.ok(m, 'install_bus_relay.sh must declare INTERVAL_SECONDS');
  return m[1];
}

function run(plistBody, { plistExists = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-interval-'));
  const plist = path.join(dir, 'com.starcaster.bus-relay.plist');
  if (plistExists) fs.writeFileSync(plist, plistBody);
  try {
    const out = execFileSync(SCRIPT, [], {
      encoding: 'utf8',
      env: { ...process.env, REPO, BUS_RELAY_PLIST: plist },
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const plistWith = (value) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n` +
  `  <key>StartInterval</key>\n  <integer>${value}</integer>\n</dict></plist>\n`;

test('agreeing plist reports a match, with the number it compared', () => {
  const want = repoInterval();
  const { code, out } = run(plistWith(want));
  assert.strictEqual(code, 0);
  assert.match(out, new RegExp(`every ${want}s, matching the repo`));
});

test('a different interval is a loud MISMATCH naming both values', () => {
  const want = repoInterval();
  const other = String(Number(want) + 1234);
  const { code, out } = run(plistWith(other));
  assert.strictEqual(code, 2, 'drift must not exit 0');
  assert.match(out, /MISMATCH/);
  assert.ok(out.includes(other) && out.includes(want), 'names both intervals');
  assert.match(out, /install_bus_relay\.sh/, 'names the command that fixes it');
  // The installer refuses to run from a worktree, so a fix command pointing at
  // one is a command that cannot work. It must name the main checkout.
  const cmd = out.split('\n').find((l) => l.includes('install_bus_relay.sh') && l.includes('cd '));
  assert.ok(cmd, 'the fix is given as a runnable command');
  assert.ok(!/\.claude\/worktrees\//.test(cmd), `fix command must not point at a worktree: ${cmd}`);
});

test('an unreadable StartInterval says CANNOT TELL, never "matching"', () => {
  const { code, out } = run(plistWith(''));
  assert.strictEqual(code, 1, 'not-known must not exit 0');
  assert.match(out, /CANNOT TELL/);
  assert.doesNotMatch(out, /matching the repo/, 'must not claim a match it never made');
  assert.doesNotMatch(out, /every \?s/, 'must not print a placeholder as if it were a value');
});

test('a plist with no StartInterval key at all says CANNOT TELL', () => {
  const noKey = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n' +
    '  <key>StartCalendarInterval</key>\n  <dict><key>Hour</key><integer>3</integer></dict>\n' +
    '</dict></plist>\n';
  const { code, out } = run(noKey);
  assert.strictEqual(code, 1);
  assert.match(out, /CANNOT TELL/);
  assert.doesNotMatch(out, /matching the repo/);
});

test('a missing plist is reported out loud, not by staying silent', () => {
  const { code, out } = run('', { plistExists: false });
  assert.strictEqual(code, 1);
  assert.match(out, /CANNOT TELL/);
  assert.ok(out.trim().length > 0, 'silence reads as all-clear; it must say something');
  assert.match(out, /may not be running the relay on a schedule/);
});

test('both callers use the shared check rather than their own copy', () => {
  for (const caller of ['run_bus_relay.sh', 'install_bus_relay.sh']) {
    const src = fs.readFileSync(path.join(REPO, 'scripts', caller), 'utf8');
    assert.match(src, /bus_relay_interval\.sh/, `${caller} must call the shared check`);
    assert.doesNotMatch(src, /matching the repo/, `${caller} must not re-implement the verdict`);
  }
});
