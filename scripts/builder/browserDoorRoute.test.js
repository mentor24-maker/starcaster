'use strict';

/**
 * The browser door keeper's route (Outreach wizard 5/19 · sign-in window
 * slice 3, ticket 86bcrmbdw): scripts/install_browser_door.sh and the outside
 * check, scripts/check_browser_door_route.sh.
 *
 * The outside check is driven against a FAKE curl and dig on PATH, so each
 * verdict it can give is taken on purpose: a private port that connects must
 * fail it, a refusal on a port nothing listens on must not pass it, and a
 * tailnet that cannot be reached must not read as a tailnet that is closed.
 * The real reading is taken from the MacBook and pasted on the ticket.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const INSTALLER = path.join(__dirname, '..', 'install_browser_door.sh');
const CHECK = path.join(__dirname, '..', 'check_browser_door_route.sh');
const INSTALLER_SOURCE = fs.readFileSync(INSTALLER, 'utf8');

function functionBody(source, name) {
  // Anchored at a line start: `status() {` is also the tail of `funnel_status() {`.
  const at = source.indexOf(`\n${name}() {`);
  assert.notEqual(at, -1, `${name}() is not in the script`);
  const start = at + 1;
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end + 3);
}

function codeLines(source) {
  return source.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

// --- the installer ------------------------------------------------------------

test('the plist runs the door keeper under doppler prd, through the named scope, and carries no secret', () => {
  const plist = execFileSync('bash', [INSTALLER, '--print-plist'], { encoding: 'utf8' });
  assert.match(plist, /run --scope \S+ --project starcaster --config prd --no-check-version -- \S+ \S+\/workers\/browser-door\/server\.js/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>BROWSER_DOOR_PORT<\/key>\s*<string>8091<\/string>/);
  assert.doesNotMatch(plist, /BROWSER_DOOR_SECRET/, 'the secret reaches the door keeper through doppler, never through the plist');
});

test('the plist is one launchd accepts', (t) => {
  if (os.platform() !== 'darwin') {
    t.skip('plutil exists only on macOS, so this reading cannot be taken here');
    return;
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdr-')), 'p.plist');
  fs.writeFileSync(file, execFileSync('bash', [INSTALLER, '--print-plist'], { encoding: 'utf8' }));
  execFileSync('plutil', ['-lint', file]);
});

test('nothing pipes `launchctl list` into grep — under pipefail that reads a loaded job as not loaded', () => {
  const offenders = codeLines(INSTALLER_SOURCE)
    .map((l) => l.replace(/\|\|/g, ' '))
    .filter((l) => /launchctl\s+list[^|]*\|/.test(l));
  assert.deepEqual(offenders, []);
});

test('the route is added only AFTER the door keeper answers, and never on a missing secret or tunnel', () => {
  const body = functionBody(INSTALLER_SOURCE, 'install_it');
  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.notEqual(i, -1, `install_it no longer contains ${needle}`);
    return i;
  };
  const addRoute = at('funnel --bg --yes --set-path "$ROUTE" "http://127.0.0.1:$PORT"');
  assert.ok(at('settings_preflight') < addRoute, 'the secret is checked before anything is exposed');
  assert.ok(at('launchctl list "$TAILSCALE_LABEL"') < addRoute, 'the tunnel must be under launchd first');
  assert.ok(at('if ! door_answers; then') < addRoute, 'a route to a port nothing answers on reads as installed');
  assert.ok(at('checkRole') < addRoute, 'only the machine that owns the role may install');
});

test('--status exits 0 whenever it took the reading, so doctor:node can read "not installed"', () => {
  const body = functionBody(INSTALLER_SOURCE, 'status');
  const returns = body.match(/return\s+[^\n;]+/g) || [];
  assert.deepEqual(returns, ['return 0'], 'a non-zero status exit reads as "did not answer" in doctor:node');
});

test('uninstall takes the route away too — a route left behind points the internet at whatever next takes 8091', () => {
  assert.match(functionBody(INSTALLER_SOURCE, 'uninstall'), /^\s*remove_route$/m);
});

// --- the outside check, against a fake network ----------------------------------

/**
 * A fake curl: it reads the URL and answers from a table. `$FAKE_NET` is a list
 * of `<host:port>=<exit>` (for bare probes, and for an HTTPS request pinned to
 * `<ip>:443` with --resolve) and the HTTPS answers come from
 * FAKE_LIVE: `door` (the real door keeper's replies), `502`, or `other`.
 */
const FAKE_CURL = `#!/bin/bash
url="" ; ws="" ; pinned=""
for a in "$@"; do
  case "$a" in http://*|https://*) url="$a" ;; "Upgrade: websocket") ws=1 ;; *:443:*) pinned="\${a##*:}" ;; esac
done
case "$url" in
  https://*)
    # A request pinned to an address answers only if that address's :443 has no rule saying otherwise.
    for rule in $FAKE_NET; do
      [ "\${rule%%=*}" = "$pinned:443" ] && exit "\${rule#*=}"
    done
    case "$FAKE_LIVE" in
      502) [ -n "$ws" ] && { printf 'HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n'; exit 0; }; printf 'Bad gateway\\n502'; exit 0 ;;
      other) [ -n "$ws" ] && { printf 'HTTP/1.1 401 Unauthorized\\r\\n\\r\\n'; exit 0; }; printf '{"error":"Unauthorized"}\\n401'; exit 0 ;;
      frame) if [ -n "$ws" ]; then printf 'HTTP/1.1 101 Switching Protocols\\r\\n\\r\\n{"type":"frame","data":"x"}'; exit 0; fi ;;
    esac
    case "$url" in
      */live/) printf 'Not found\\n404' ;;
      */live/open) printf 'Refused\\n401' ;;
      */live/live) printf 'HTTP/1.1 101 Switching Protocols\\r\\n\\r\\n{"type":"closed","reason":"refused","message":"x"}' ;;
    esac
    exit 0 ;;
esac
hp="\${url#http://}"; hp="\${hp%%/*}"
for rule in $FAKE_NET; do
  [ "\${rule%%=*}" = "$hp" ] && exit "\${rule#*=}"
done
exit 7
`;

function runCheck({ live = 'door', net = '', args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdr-check-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), FAKE_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'dig'), '#!/bin/bash\necho 203.0.113.9\n', { mode: 0o755 });
  const r = spawnSync('bash', [CHECK, '--host', 'mini.example.ts.net', '--lan', '192.0.2.5', '--tailnet', '100.64.0.5', ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, FAKE_LIVE: live, FAKE_NET: net },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

// 8080 answers on the home network and the tailnet: the controls are good.
const CONTROLS = '192.0.2.5:8080=0 100.64.0.5:8080=0';

test('everything closed and the door keeper answering on /live -> PASS, exit 0', () => {
  const r = runCheck({ net: CONTROLS });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /VERDICT: PASS/);
  assert.match(r.out, /203\.0\.113\.9/, 'the public checks use the address public DNS gives');
});

test('a private port that CONNECTS fails it — the OpenClaw gateway on the tailnet, as measured 2026-10-27', () => {
  const r = runCheck({ net: `${CONTROLS} 100.64.0.5:18789=0` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+tailnet\s+100\.64\.0\.5:18789 -> CONNECTED/);
});

test('something other than the door keeper behind /live fails it (the YouTube helper answering there today)', () => {
  const r = runCheck({ live: 'other', net: CONTROLS });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /not the door keeper's bare 404/);
});

test('a picture sent without a pass fails it', () => {
  const r = runCheck({ live: 'frame', net: CONTROLS });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a PICTURE was sent/);
});

test('a route with nothing behind it (502) is CANNOT TELL, not a pass', () => {
  const r = runCheck({ live: '502', net: CONTROLS });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /nothing answers behind the route/);
});

test('a refusal on a port nothing listens on proves nothing -> CANNOT TELL', () => {
  const r = runCheck({ net: CONTROLS, args: ['--idle', '18800'] });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CANNOT TELL\s+tailnet\s+100\.64\.0\.5:18800 .*proves nothing/);
});

test('a tailnet this machine cannot reach at all is CANNOT TELL, never "closed"', () => {
  const r = runCheck({ net: '192.0.2.5:8080=0' }); // tailnet control times out
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CANNOT TELL\s+tailnet .*control \(port 8080\) is not reachable/);
});

test('shields up: the private ports read as closed, but the Connect window cannot open from a tailnet device -> FAIL', () => {
  const r = runCheck({ net: '192.0.2.5:8080=0 100.64.0.5:443=28', args: ['--tailnet-shielded'] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /PASS\s+tailnet\s+100\.64\.0\.5 -> shields up: not even 8080/);
  assert.match(r.out, /FAIL\s+tailnet\s+wss:.*cannot open from a computer with Tailscale on.*shields up blocks it/);
});

test('from a tailnet device: the viewer socket answers on the tailnet address -> PASS line', () => {
  const r = runCheck({ net: CONTROLS });
  assert.match(r.out, /PASS\s+tailnet\s+wss:\/\/mini\.example\.ts\.net\/live\/live via 100\.64\.0\.5 -> the door keeper answers/);
});

test('an access rule that drops tailnet 443 fails it — the MacBook, 2026-10-28 (86bcu7d6h)', () => {
  const r = runCheck({ net: `${CONTROLS} 100.64.0.5:443=28` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL\s+tailnet\s+wss:.*not reachable \(curl exit 28\).*must allow tcp:443 to the Mini/);
  assert.match(r.out, /PASS\s+GET https:\/\/mini\.example\.ts\.net\/live\//, 'the internet route still reads as working');
});

test('a tailnet this machine cannot reach takes no tailnet-device reading at all', () => {
  const r = runCheck({ net: '192.0.2.5:8080=0' });
  assert.doesNotMatch(r.out, /wss:.* via 100\.64\.0\.5/);
});

test('shields reported up but the tailnet control connects -> FAIL', () => {
  const r = runCheck({ net: CONTROLS, args: ['--tailnet-shielded'] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /CONNECTED although the Mini reports shields up/);
});

test('it refuses to run on the Mini itself — a refusal from inside proves nothing about outside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdr-mini-'));
  fs.writeFileSync(path.join(dir, '.alphire-node'), 'mac-mini\n');
  const r = spawnSync('bash', [CHECK, '--host', 'mini.example.ts.net'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /this is the Mini/);
});
