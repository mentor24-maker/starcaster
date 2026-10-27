'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');

/**
 * Outreach wizard 3/19 (86bcrmbb4) — the door keeper on the Mini.
 *
 * TWO KINDS OF TEST, ON PURPOSE. Most of these drive the real request handling
 * — real HTTP, real WebSocket — against a FAKE Chrome and a fake clock, which
 * is how the pass rules and the 3-minute idle close are proved without waiting
 * three minutes. The last block starts the REAL Chrome on this machine, because
 * two acceptance criteria are about what Chrome itself does: whether it calls
 * itself automated (`navigator.webdriver`), and whether a password typed
 * through the window ends up anywhere it should not.
 *
 * The `navigator.webdriver` one is KNOWN-FAILING on current Chrome and is
 * marked as a TODO, by Dane's decision — see the note above it.
 *
 * Those real-Chrome tests run only on a Mac with Chrome installed — the Mini,
 * where the door keeper lives. CI's Linux runner has no screen for a visible
 * Chrome, and the door keeper never runs a hidden one (a hidden Chrome reports
 * itself as automated, which is what Google refuses). They SKIP THERE BY NAME;
 * on a Mac with no Chrome, the first real-Chrome test FAILS rather than skip,
 * because a reading not taken on the machine that matters is not a pass.
 */

const door = require('../../workers/browser-door/door.js');
const chrome = require('../../workers/browser-door/chrome.js');
const { createDoor, HOST, parseAttach } = require('../../workers/browser-door/server.js');

const SECRET = 'test-secret-'.padEnd(40, 'x');
const MARKER = 'Marker-Pw-7f3K9qZ!';

function newPass() {
  return crypto.randomBytes(32).toString('hex');
}

/** Hand-driven timers: nothing fires until the test advances the clock. */
function fakeClock(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

/** A stand-in Chrome that records what the door keeper asked of it. */
function fakeBrowserFactory() {
  const opened = [];
  const openBrowser = async (target) => {
    const listeners = new Set();
    const calls = [];
    const handle = {
      target,
      calls,
      closed: false,
      sessionId: 'S1',
      cdp: {
        on: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      page: async (method, params) => {
        calls.push({ method, params });
        if (method === 'Page.navigate') {
          setImmediate(() => { for (const fn of [...listeners]) fn({ method: 'Page.loadEventFired', sessionId: 'S1', params: {} }); });
        }
        return {};
      },
      async close() {
        handle.closed = true;
      },
      emitFrame(n) {
        for (const fn of listeners) {
          fn({ method: 'Page.screencastFrame', sessionId: 'S1', params: { sessionId: n, data: `frame-${n}`, metadata: {} } });
        }
      },
    };
    opened.push(handle);
    return handle;
  };
  return { opened, openBrowser };
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function signedOpen(port, payload, { secret = SECRET, timestamp = Date.now() } = {}) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port,
      path: '/open',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-door-timestamp': String(timestamp),
        'x-door-signature': door.signOpen(secret, String(timestamp), body),
      },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Connect a viewer, send the hello, and collect everything the door keeper sends. */
function viewer(port, hello) {
  const ws = new WebSocket(`ws://${HOST}:${port}/live`);
  const received = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    received.push(msg);
    for (const w of waiters.splice(0)) w();
  });
  ws.on('close', () => { for (const w of waiters.splice(0)) w(); });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    received,
    async ready() {
      await opened;
      if (hello) ws.send(JSON.stringify(hello));
    },
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    async waitFor(pred, ms = 5000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = received.find(pred);
        if (hit) return hit;
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
      throw new Error(`timed out waiting; got ${JSON.stringify(received.map((m) => m.type))}`);
    },
  };
}

async function settle(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ── The pass ────────────────────────────────────────────────────────────────

test('a pass works once, and a second use of the same pass is refused', () => {
  const book = new door.PassBook();
  const pass = newPass();
  assert.equal(book.issue({ pass, projectId: 'projA', site: 'youtube' }).ok, true);
  assert.deepEqual(book.consume(pass), { ok: true, projectId: 'projA', site: 'youtube' });
  assert.deepEqual(book.consume(pass), { ok: false, reason: 'unknown' });
});

test('a pass dies 60 seconds after it was issued, and a late one is spent rather than left to retry', () => {
  const clock = fakeClock();
  const book = new door.PassBook({ now: clock.now });
  const pass = newPass();
  book.issue({ pass, projectId: 'projA', site: 'youtube' });
  clock.advance(60_001);
  assert.deepEqual(book.consume(pass), { ok: false, reason: 'expired' });
  assert.equal(book.size, 0);
});

test('a pass is kept only as its hash', () => {
  const book = new door.PassBook();
  const pass = newPass();
  book.issue({ pass, projectId: 'projA', site: 'youtube' });
  assert.ok(![...book.entries.keys()].includes(pass));
  assert.ok(book.entries.has(door.hashPass(pass)));
});

test('a short pass, an unknown site or a malformed project id is refused at issue', () => {
  const book = new door.PassBook();
  assert.equal(book.issue({ pass: 'short', projectId: 'projA', site: 'youtube' }).ok, false);
  assert.equal(book.issue({ pass: newPass(), projectId: 'projA', site: 'myspace' }).ok, false);
  assert.equal(book.issue({ pass: newPass(), projectId: '../projB', site: 'youtube' }).ok, false);
});

test('a profile folder is named by project id and cannot climb out of the profiles folder', () => {
  const root = '/tmp/profiles';
  assert.equal(door.profileDirFor('projA', root), path.resolve(root, 'projA'));
  for (const bad of ['../projB', 'projA/../projB', 'a/b', '', '.', '..', 'x'.repeat(65)]) {
    assert.throws(() => door.profileDirFor(bad, root), /not a project id/, bad);
  }
});

// ── The signed "open" ───────────────────────────────────────────────────────

test('only a correctly signed, current "open" registers a pass', async (t) => {
  const fake = fakeBrowserFactory();
  const d = createDoor({ secret: SECRET, openBrowser: fake.openBrowser, profilesRoot: tmpDir('door-') });
  const { port } = await d.listen(0);
  t.after(() => d.close());

  const payload = { pass: newPass(), project_id: 'projA', site: 'youtube' };
  assert.equal((await signedOpen(port, payload, { secret: 'wrong-secret' })).status, 401);
  assert.equal((await signedOpen(port, payload, { timestamp: Date.now() - 120_000 })).status, 401);
  assert.equal(d.passes.size, 0);
  assert.equal((await signedOpen(port, payload)).status, 200);
  assert.equal(d.passes.size, 1);
});

test('the door keeper listens on 127.0.0.1 only, and answers nothing but /open and /live', async (t) => {
  const d = createDoor({ secret: SECRET, openBrowser: fakeBrowserFactory().openBrowser });
  const address = await d.listen(0);
  t.after(() => d.close());
  assert.equal(address.address, '127.0.0.1');
  const res = await fetch(`http://${HOST}:${address.port}/health`);
  assert.equal(res.status, 404);
  const getOpen = await fetch(`http://${HOST}:${address.port}/open`);
  assert.equal(getOpen.status, 404);
});

test('the door keeper refuses to start without a shared secret', () => {
  assert.throws(() => createDoor({ secret: '' }), /BROWSER_DOOR_SECRET is required/);
});

test('BROWSER_DOOR_ATTACH names project ids and ports, and nothing else', () => {
  assert.deepEqual([...parseAttach('projA=18800, projB=9222')], [['projA', 18800], ['projB', 9222]]);
  assert.equal(parseAttach('').size, 0);
  assert.throws(() => parseAttach('../x=18800'), /not <project-id>=<port>/);
  assert.throws(() => parseAttach('projA=abc'), /not <project-id>=<port>/);
});

// ── Keeping clients apart ───────────────────────────────────────────────────

test('a pass for project A cannot reach project B — whatever the viewer sends', async (t) => {
  const fake = fakeBrowserFactory();
  const root = tmpDir('door-');
  const d = createDoor({ secret: SECRET, openBrowser: fake.openBrowser, profilesRoot: root });
  const { port } = await d.listen(0);
  t.after(() => d.close());

  const passA = newPass();
  await signedOpen(port, { pass: passA, project_id: 'projA', site: 'youtube' });
  // The viewer tries to steer: a project field in the hello, and a project in the URL.
  const v = viewer(port, { type: 'hello', pass: passA, project_id: 'projB', projectId: 'projB' });
  await v.ready();
  await settle(100);
  assert.equal(fake.opened.length, 1);
  assert.equal(fake.opened[0].target.profileDir, path.join(root, 'projA'));
  assert.ok(!fs.existsSync(path.join(root, 'projB')), 'nothing was created for project B');

  // The same pass, presented again for B, opens nothing.
  const again = viewer(port, { type: 'hello', pass: passA });
  await again.ready();
  const closed = await again.waitFor((m) => m.type === 'closed');
  assert.equal(closed.reason, 'refused');
  assert.equal(fake.opened.length, 1);
});

test('a pass that was never issued, or no hello at all, opens nothing', async (t) => {
  const fake = fakeBrowserFactory();
  const d = createDoor({ secret: SECRET, openBrowser: fake.openBrowser, profilesRoot: tmpDir('door-') });
  const { port } = await d.listen(0);
  t.after(() => d.close());

  const v = viewer(port, { type: 'hello', pass: newPass() });
  await v.ready();
  assert.equal((await v.waitFor((m) => m.type === 'closed')).reason, 'refused');
  const w = viewer(port, { type: 'mouse', action: 'down', x: 1, y: 1 });
  await w.ready();
  assert.equal((await w.waitFor((m) => m.type === 'closed')).reason, 'refused');
  assert.equal(fake.opened.length, 0);
  assert.ok(!v.received.some((m) => m.type === 'frame'));
});

test('a second window on a project already open is refused, and another project is unaffected', async (t) => {
  const fake = fakeBrowserFactory();
  const root = tmpDir('door-');
  const d = createDoor({ secret: SECRET, openBrowser: fake.openBrowser, profilesRoot: root });
  const { port } = await d.listen(0);
  t.after(() => d.close());

  const [p1, p2, p3] = [newPass(), newPass(), newPass()];
  await signedOpen(port, { pass: p1, project_id: 'projA', site: 'youtube' });
  await signedOpen(port, { pass: p2, project_id: 'projA', site: 'youtube' });
  await signedOpen(port, { pass: p3, project_id: 'projB', site: 'substack' });
  const a = viewer(port, { type: 'hello', pass: p1 });
  await a.ready();
  await settle(100);
  const a2 = viewer(port, { type: 'hello', pass: p2 });
  await a2.ready();
  assert.equal((await a2.waitFor((m) => m.type === 'closed')).reason, 'already-open');
  const b = viewer(port, { type: 'hello', pass: p3 });
  await b.ready();
  await settle(100);
  assert.deepEqual(fake.opened.map((h) => path.basename(h.target.profileDir)), ['projA', 'projB']);
});

test('an attached project opens a tab in the Chrome already running, never a new profile', async (t) => {
  const fake = fakeBrowserFactory();
  const root = tmpDir('door-');
  const d = createDoor({ secret: SECRET, openBrowser: fake.openBrowser, profilesRoot: root, attach: new Map([['dane', 18800]]) });
  const { port } = await d.listen(0);
  t.after(() => d.close());
  const pass = newPass();
  await signedOpen(port, { pass, project_id: 'dane', site: 'youtube' });
  const v = viewer(port, { type: 'hello', pass });
  await v.ready();
  await settle(100);
  assert.deepEqual(fake.opened[0].target, { kind: 'attach', port: 18800 });
  assert.ok(!fs.existsSync(path.join(root, 'dane')));
});

// ── Input relay ─────────────────────────────────────────────────────────────

test('viewer input becomes Chrome input; anything malformed is dropped and counted', () => {
  assert.deepEqual(door.toCdpInput({ type: 'mouse', action: 'down', x: 10, y: 20 }), {
    kind: 'mouse',
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1, modifiers: 0 },
  });
  assert.equal(door.toCdpInput({ type: 'key', action: 'down', key: 'a', text: 'a' }).params.text, 'a');
  assert.equal(door.toCdpInput({ type: 'key', action: 'up', key: 'a', text: 'a' }).params.text, undefined);
  assert.deepEqual(door.toCdpInput({ type: 'paste', text: 'hi' }).params, { text: 'hi' });
  for (const bad of [null, 'x', {}, { type: 'mouse', action: 'teleport' }, { type: 'key', action: 'down' },
    { type: 'paste', text: '' }, { type: 'paste', text: 'x'.repeat(5000) }, { type: 'Runtime.evaluate' },
    { type: 'key', action: 'down', key: 'x'.repeat(40) }]) {
    assert.equal(door.toCdpInput(bad), null, JSON.stringify(bad).slice(0, 60));
  }
});

test('the relay sends only input commands to Chrome, and the log records counts, never what was typed', async (t) => {
  const fake = fakeBrowserFactory();
  const logLines = [];
  const d = createDoor({
    secret: SECRET,
    openBrowser: fake.openBrowser,
    profilesRoot: tmpDir('door-'),
    log: (event, fields) => logLines.push(JSON.stringify({ event, ...fields })),
  });
  const { port } = await d.listen(0);
  t.after(() => d.close());
  const pass = newPass();
  await signedOpen(port, { pass, project_id: 'projA', site: 'youtube' });
  const v = viewer(port, { type: 'hello', pass });
  await v.ready();
  await settle(100);
  for (const ch of MARKER) {
    v.send({ type: 'key', action: 'down', key: ch, text: ch });
    v.send({ type: 'key', action: 'up', key: ch });
  }
  v.send({ type: 'paste', text: MARKER });
  v.send({ type: 'mouse', action: 'down', x: 5, y: 5 });
  v.send({ type: 'Runtime.evaluate', expression: 'document.cookie' });
  await settle(100);
  v.ws.close();
  await settle(100);

  const methods = new Set(fake.opened[0].calls.map((c) => c.method));
  assert.deepEqual([...methods].sort(), ['Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'Input.insertText',
    'Page.enable', 'Page.navigate', 'Page.startScreencast']);
  const all = logLines.join('\n');
  assert.ok(!all.includes(MARKER), 'the marker reached the log');
  assert.ok(!all.includes('Marker'), 'part of the marker reached the log');
  const closed = JSON.parse(logLines.find((l) => l.includes('window-closed')));
  assert.deepEqual(closed.inputs, { mouse: 1, key: MARKER.length * 2, paste: 1, rejected: 1 });
  assert.equal(closed.reason, 'finished');
  assert.equal(fake.opened[0].closed, true);
});

// ── The frame cap ───────────────────────────────────────────────────────────

test('pictures are capped at 15 a second, and the newest one is never lost', () => {
  const clock = fakeClock();
  const sent = [];
  const throttle = new door.FrameThrottle({ now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, send: (f) => sent.push(f) });
  for (let i = 0; i < 60; i += 1) { // one second of a moving page at 60 a second
    throttle.push(i);
    clock.advance(1000 / 60);
  }
  clock.advance(1000);
  assert.ok(sent.length <= 16 && sent.length >= 14, `sent ${sent.length}`);
  assert.equal(sent[sent.length - 1], 59, 'the last picture the page showed reached the viewer');
});

// ── The window closes itself ────────────────────────────────────────────────

test('the window closes after 3 minutes with no input, and input pushes that back', () => {
  const quiet = fakeClock();
  const quietCloses = [];
  new door.WindowClock({ setTimer: quiet.setTimer, clearTimer: quiet.clearTimer, onClose: (r) => quietCloses.push(r) });
  quiet.advance(door.IDLE_CLOSE_MS - 1);
  assert.deepEqual(quietCloses, [], 'not before 3 minutes');
  quiet.advance(1);
  assert.deepEqual(quietCloses, ['idle'], 'a window nobody touches closes at exactly 3 minutes');

  const clock = fakeClock();
  const closes = [];
  const c = new door.WindowClock({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, onClose: (r) => closes.push(r) });
  clock.advance(2 * 60_000);
  c.touch();
  clock.advance(2 * 60_000);
  assert.deepEqual(closes, [], 'input at 2 minutes kept it open past 3');
  clock.advance(60_001);
  assert.deepEqual(closes, ['idle']);
  clock.advance(60 * 60_000);
  assert.deepEqual(closes, ['idle'], 'it closes once');
});

test('the window closes at 15 minutes however busy it is', () => {
  const clock = fakeClock();
  const closes = [];
  const c = new door.WindowClock({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, onClose: (r) => closes.push(r) });
  for (let i = 0; i < 15 * 6; i += 1) {
    clock.advance(10_000);
    c.touch();
  }
  assert.deepEqual(closes, ['time-limit']);
});

test('an idle window really closes: the viewer is told why and the browser is shut', async (t) => {
  const clock = fakeClock(Date.now());
  const fake = fakeBrowserFactory();
  const logLines = [];
  const d = createDoor({
    secret: SECRET,
    openBrowser: fake.openBrowser,
    profilesRoot: tmpDir('door-'),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    log: (event, fields) => logLines.push({ event, ...fields }),
  });
  const { port } = await d.listen(0);
  t.after(() => d.close());
  const pass = newPass();
  await signedOpen(port, { pass, project_id: 'projA', site: 'youtube' });
  const v = viewer(port, { type: 'hello', pass });
  await v.ready();
  await settle(100);
  fake.opened[0].emitFrame(1);
  await v.waitFor((m) => m.type === 'frame');

  clock.advance(door.IDLE_CLOSE_MS - 1);
  await settle();
  assert.equal(fake.opened[0].closed, false, 'still open one millisecond before the idle limit');
  clock.advance(1);
  const closed = await v.waitFor((m) => m.type === 'closed');
  assert.equal(closed.reason, 'idle');
  assert.match(closed.message, /3 minutes/);
  await settle();
  assert.equal(fake.opened[0].closed, true);
  assert.equal(d.windows.size, 0);
  assert.equal(logLines.find((l) => l.event === 'window-closed').reason, 'idle');
});

// ── Chrome flags ────────────────────────────────────────────────────────────

test('Chrome is started with its control port on loopback and no flag that marks it automated', () => {
  const args = chrome.chromeArgs('/tmp/p');
  assert.ok(args.includes('--remote-debugging-port=0'));
  for (const flag of chrome.FORBIDDEN_FLAGS) {
    assert.ok(!args.some((a) => a === flag || a.startsWith(`${flag}=`)), flag);
  }
  const src = fs.readFileSync(path.join(__dirname, '../../workers/browser-door/chrome.js'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '../../workers/browser-door/server.js'), 'utf8');
  assert.ok(!/require\(['"]playwright/.test(src), 'the door keeper must never use Playwright');
});

// ── The REAL Chrome ─────────────────────────────────────────────────────────

const CHROME = chrome.findChrome();
const REAL = process.platform === 'darwin';
const realSkip = !REAL ? 'needs a Mac with a screen (the Mini) — Linux CI cannot run a visible Chrome' : false;

test('Chrome is installed on this Mac, or the real-Chrome proof below is not being taken', { skip: realSkip }, () => {
  if (process.env.BROWSER_DOOR_ALLOW_NO_CHROME === '1') return;
  assert.ok(CHROME, 'No Google Chrome found. Install it, set BROWSER_DOOR_CHROME, or set '
    + 'BROWSER_DOOR_ALLOW_NO_CHROME=1 to say out loud that this machine is not taking the reading.');
});

const chromeSkip = realSkip || (!CHROME && 'Chrome is not installed');

// KNOWN-FAILING, by Dane's decision (option B on ticket 86bcrmbb4, 2026-10-26).
// The plan measured `false` in October. On the Mini's Chrome 156 just switching
// on the remote-control port makes it `true`, with nothing connected. The only
// fix found is a flag that HIDES the signal from sites, and Dane chose to leave
// Chrome honest and let slice 5 find out whether Google refuses a real sign-in.
// So this still runs and still reports what it reads, but as a TODO: a `true`
// is expected and does not fail the suite. If it ever reads `false` again, the
// TODO line says so and this marker can come off.
const WEBDRIVER_KNOWN_FAILING = 'known-failing: Chrome 156 reports navigator.webdriver=true whenever its '
  + 'remote-control port is on; Dane chose to leave Chrome honest (86bcrmbb4, option B) — slice 5 tests Google';

test('the Chrome the door keeper opens does not call itself automated (navigator.webdriver is false)', { skip: chromeSkip, todo: WEBDRIVER_KNOWN_FAILING, timeout: 60_000 }, async () => {
  const profileDir = tmpDir('door-chrome-');
  const b = await chrome.openBrowser({ kind: 'launch', chromePath: CHROME, profileDir });
  try {
    const r = await b.page('Runtime.evaluate', { expression: 'navigator.webdriver', returnByValue: true });
    assert.equal(r.result.value, false);
  } finally {
    await b.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test('a marker password typed through the window reaches the page, and no log and no saved-password list', { skip: chromeSkip, timeout: 120_000 }, async (t) => {
  // A local sign-in page that records what it was sent, so the test can prove
  // the keys really arrived — a marker that is absent because it was never
  // typed would make the rest of this test meaningless.
  const received = [];
  const site = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push(new URLSearchParams(body).get('password'));
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<h1>Signed in</h1>');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<form method="post" action="/"><input name="username" value="test-user" autocomplete="username">'
      + '<input id="pw" name="password" type="password" autocomplete="current-password" autofocus>'
      + '<button>Sign in</button></form>');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const siteUrl = `http://127.0.0.1:${site.address().port}/`;

  const root = tmpDir('door-real-');
  const logFile = path.join(root, 'logs', 'browser-door.log');
  const d = createDoor({
    secret: SECRET,
    chromePath: CHROME,
    profilesRoot: path.join(root, 'browsers'),
    sites: { test: siteUrl },
    log: door.createLogger({ file: logFile, echo: false }),
  });
  const { port } = await d.listen(0);
  t.after(async () => {
    await d.close();
    site.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const pass = newPass();
  assert.equal((await signedOpen(port, { pass, project_id: 'projMarker', site: 'test' })).status, 200);
  const v = viewer(port, { type: 'hello', pass });
  await v.ready();
  const frame = await v.waitFor((m) => m.type === 'frame', 30_000);
  assert.ok(frame.data.length > 100, 'a real picture arrived');
  if (process.env.BROWSER_DOOR_FRAME_OUT) fs.writeFileSync(process.env.BROWSER_DOOR_FRAME_OUT, Buffer.from(frame.data, 'base64'));

  // Click the password field (it is also autofocused), type half, paste the rest, press Enter.
  const half = Math.floor(MARKER.length / 2);
  for (const ch of MARKER.slice(0, half)) {
    v.send({ type: 'key', action: 'down', key: ch, text: ch });
    v.send({ type: 'key', action: 'up', key: ch });
  }
  v.send({ type: 'paste', text: MARKER.slice(half) });
  await settle(300);
  v.send({ type: 'key', action: 'down', key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
  v.send({ type: 'key', action: 'up', key: 'Enter', code: 'Enter', keyCode: 13 });
  const deadline = Date.now() + 15_000;
  while (!received.length && Date.now() < deadline) await settle(100);
  assert.deepEqual(received, [MARKER], 'the marker typed through the window reached the page');

  await settle(1500); // give Chrome its moment to offer to save the password, if it were going to
  v.ws.close();
  while (d.windows.size && Date.now() < deadline + 15_000) await settle(100);
  assert.equal(d.windows.size, 0, 'the window closed and Chrome was shut');

  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /window-closed/);
  assert.ok(!log.includes(MARKER) && !log.includes(MARKER.slice(0, half)) && !log.includes(MARKER.slice(half)),
    'the marker reached the door keeper log');

  const profileDir = path.join(root, 'browsers', 'projMarker');
  const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, 'Default', 'Preferences'), 'utf8'));
  assert.equal(prefs.credentials_enable_service, false, 'Chrome was told not to offer to save passwords');
  const loginData = path.join(profileDir, 'Default', 'Login Data');
  if (fs.existsSync(loginData)) {
    const q = spawnSync('sqlite3', [loginData, 'SELECT COUNT(*) FROM logins;'], { encoding: 'utf8' });
    assert.equal(q.status, 0, `could not read the saved-password list: ${q.stderr}`);
    assert.equal(q.stdout.trim(), '0', 'Chrome saved a password');
  }
  // And nowhere else in the profile in plain text either.
  const stack = [profileDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile() && fs.statSync(p).size < 50 * 1024 * 1024) {
        assert.ok(!fs.readFileSync(p).includes(MARKER), `the marker is stored in ${path.relative(profileDir, p)}`);
      }
    }
  }
});
