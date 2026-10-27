'use strict';

/**
 * The door keeper (Outreach wizard 3/19 · sign-in window slice 1).
 *
 * A small program on the Mini that opens one project's Chrome, sends a live
 * picture of it, and passes clicks and keys back — so Dane can sign in to a
 * site in a window inside Starcaster and the Mini keeps the sign-in.
 * Plan: docs/LIVE_BROWSER_VIEW.md. Rules: ./door.js. Chrome: ./chrome.js.
 *
 * IT LISTENS ON 127.0.0.1 AND NOWHERE ELSE. The address is not configurable:
 * this slice is "reachable from nowhere yet", and an environment variable that
 * could widen it is a variable somebody sets at 2am. The internet route is a
 * separate Tailscale Funnel path added in slice 3, which forwards to loopback.
 *
 * It answers exactly two things, and refuses everything else with a bare 404:
 *
 *   POST /open   signed by Starcaster's server (HMAC, ±60 s), body
 *                { pass, project_id, site } — "this pass may open this
 *                project's profile on this site". Registers the pass; opens
 *                nothing yet.
 *   GET  /live   a WebSocket. The viewer's FIRST message must be
 *                { type: 'hello', pass } within 5 s. A good pass opens the
 *                window; then the door keeper sends
 *                  { type: 'frame', data: <jpeg base64>, metadata }
 *                  { type: 'closed', reason, message }
 *                and accepts
 *                  { type: 'mouse', action: down|up|move|wheel, x, y, button?, clickCount?, deltaX?, deltaY?, modifiers? }
 *                  { type: 'key', action: down|up, key, code?, keyCode?, text?, modifiers? }
 *                  { type: 'paste', text }
 *                Coordinates are page pixels, as described by the frame's metadata.
 *
 * Environment (see README.md):
 *   BROWSER_DOOR_SECRET    required — shared with Starcaster's server only
 *   BROWSER_DOOR_PORT      default 8091
 *   BROWSER_DOOR_ATTACH    "<project-id>=<cdp port>,…" — projects whose Chrome is
 *                          already running (OpenClaw's, for Dane) and is attached to
 *   BROWSER_DOOR_PROFILES  default ~/.starcaster/browsers
 *   BROWSER_DOOR_LOG       default ~/.starcaster/logs/browser-door.log
 *   BROWSER_DOOR_CHROME    path to Chrome, if it is not in the usual place
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const door = require('./door.js');
const chrome = require('./chrome.js');

const HOST = '127.0.0.1';
const HELLO_TIMEOUT_MS = 5000;
const MAX_OPEN_BODY = 4096;

const CLOSE_MESSAGES = {
  finished: 'Window closed.',
  idle: 'Window closed after 3 minutes with no clicks or keys. Click Connect to open it again.',
  'time-limit': 'Window closed: 15 minutes is the most one window stays open. Click Connect to open it again.',
  refused: 'This pass is not valid. Click Connect to get a new one.',
  'already-open': "This project's browser is already open in another window. Close that one first.",
  'browser-gone': 'The browser on the Mini stopped. Click Connect to open it again.',
  error: 'The window could not be opened on the Mini.',
};

/**
 * Chrome swaps the page out underneath its first navigation, and asking for
 * the screen feed in that instant answers "Not attached to an active page"
 * (seen on the Mini about one launch in two). Only that answer is retried.
 */
async function startScreencast(browser, { tries = 10, waitMs = 200 } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await browser.page('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 900 });
    } catch (err) {
      if (i >= tries || !/not attached to an active page/i.test(String(err && err.message))) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

function parseAttach(value) {
  const map = new Map();
  for (const part of String(value || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [projectId, port] = part.split('=').map((s) => s.trim());
    if (!door.isProjectId(projectId) || !/^\d{2,5}$/.test(port || '')) {
      throw new Error(`BROWSER_DOOR_ATTACH entry "${part}" is not <project-id>=<port>`);
    }
    map.set(projectId, Number(port));
  }
  return map;
}

/**
 * Build a door keeper. Everything that touches the world is injectable so the
 * tests can drive the real request handling against a fake Chrome, or a real
 * one, and a fake clock.
 */
function createDoor({
  secret,
  profilesRoot = door.defaultProfilesRoot(),
  attach = new Map(),
  sites = door.SITES,
  chromePath,
  openBrowser = chrome.openBrowser,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = door.createLogger({ echo: false }),
} = {}) {
  if (!secret) throw new Error('BROWSER_DOOR_SECRET is required — refusing to start a door keeper anyone could sign for');

  const passes = new door.PassBook({ now, sites });
  /** projectId -> the open window */
  const windows = new Map();

  function refuse(res, status) {
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(status === 404 ? 'Not found' : 'Refused');
  }

  function handleOpen(req, res) {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OPEN_BODY) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return refuse(res, 413);
      const body = Buffer.concat(chunks).toString('utf8');
      const check = door.verifyOpen({
        secret,
        timestamp: req.headers['x-door-timestamp'],
        signature: req.headers['x-door-signature'],
        body,
        now: now(),
      });
      if (!check.ok) {
        log('open-refused', { why: check.error });
        return refuse(res, 401);
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return refuse(res, 400);
      }
      const issued = passes.issue({ pass: parsed.pass, projectId: parsed.project_id, site: parsed.site });
      res.writeHead(issued.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(issued.ok ? { ok: true } : { ok: false, error: { message: issued.error } }));
      if (issued.ok) log('pass-issued', { projectId: parsed.project_id, site: parsed.site });
      else log('open-refused', { why: issued.error });
      return undefined;
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://door');
    if (req.method === 'POST' && url.pathname === '/open') return handleOpen(req, res);
    return refuse(res, 404);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://door');
    if (url.pathname !== '/live') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => greet(ws));
  });

  function sendJson(ws, value) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value));
  }

  function bye(ws, reason) {
    sendJson(ws, { type: 'closed', reason, message: CLOSE_MESSAGES[reason] || CLOSE_MESSAGES.finished });
    ws.close();
  }

  /** Nothing is shown and nothing is opened until the first message carries a good pass. */
  function greet(ws) {
    const timer = setTimer(() => bye(ws, 'refused'), HELLO_TIMEOUT_MS);
    ws.once('message', (data) => {
      clearTimer(timer);
      let hello;
      try {
        hello = JSON.parse(String(data));
      } catch {
        hello = null;
      }
      const spent = hello && hello.type === 'hello' ? passes.consume(hello.pass) : { ok: false, reason: 'no-hello' };
      if (!spent.ok) {
        log('window-refused', { why: spent.reason });
        bye(ws, 'refused');
        return;
      }
      if (windows.has(spent.projectId)) {
        log('window-refused', { why: 'already-open', projectId: spent.projectId });
        bye(ws, 'already-open');
        return;
      }
      openWindow(ws, spent.projectId, spent.site);
    });
  }

  async function openWindow(ws, projectId, site) {
    const id = crypto.randomBytes(6).toString('hex');
    const win = {
      id,
      projectId,
      site,
      openedAt: now(),
      inputs: { mouse: 0, key: 0, paste: 0, rejected: 0 },
      browser: null,
      // The launch while it is still under way, and the means to call it off.
      // Closing a window mid-launch must stop THAT Chrome, not find nothing to
      // close and free the project's slot while it is still starting.
      opening: null,
      abort: new AbortController(),
      throttle: null,
      clock: null,
      closing: null,
    };
    windows.set(projectId, win);
    const buffered = [];
    const onMessage = (data) => buffered.push(data);
    ws.on('message', onMessage);
    ws.on('close', () => closeWindow(win, ws, 'finished'));

    try {
      let target;
      if (attach.has(projectId)) {
        target = { kind: 'attach', port: attach.get(projectId) };
      } else {
        const profileDir = door.profileDirFor(projectId, profilesRoot);
        fs.mkdirSync(profileDir, { recursive: true });
        door.writeNoPasswordPrefs(profileDir);
        target = { kind: 'launch', chromePath, profileDir };
      }
      win.opening = openBrowser(target, { signal: win.abort.signal });
      win.browser = await win.opening;
      if (win.closing) {
        // closeWindow is already shutting what the launch returned.
        await win.closing;
        return;
      }
      log('window-opened', { windowId: id, projectId, site, mode: target.kind });

      win.throttle = new door.FrameThrottle({
        now,
        setTimer,
        clearTimer,
        send: (frame) => sendJson(ws, { type: 'frame', data: frame.data, metadata: frame.metadata }),
      });
      win.clock = new door.WindowClock({ setTimer, clearTimer, onClose: (reason) => closeWindow(win, ws, reason) });

      win.browser.cdp.on((msg) => {
        if (msg.method === 'Door.disconnected') {
          closeWindow(win, ws, 'browser-gone');
          return;
        }
        if (msg.sessionId !== win.browser.sessionId) return;
        if (msg.method === 'Page.screencastFrame') {
          // Chrome sends the next picture only after this one is acknowledged.
          win.browser.page('Page.screencastFrameAck', { sessionId: msg.params.sessionId }).catch(() => {});
          win.throttle.push({ data: msg.params.data, metadata: msg.params.metadata });
        }
      });

      await win.browser.page('Page.enable');
      const loaded = new Promise((resolve) => {
        const off = win.browser.cdp.on((msg) => {
          if (msg.sessionId === win.browser.sessionId && msg.method === 'Page.loadEventFired') {
            off();
            resolve();
          }
        });
        setTimeout(() => { off(); resolve(); }, 10_000);
      });
      await win.browser.page('Page.navigate', { url: sites[site] });
      await loaded;
      await startScreencast(win.browser);

      ws.off('message', onMessage);
      ws.on('message', (data) => relay(win, ws, data));
      for (const data of buffered.splice(0)) relay(win, ws, data);
    } catch (err) {
      log('window-failed', { windowId: id, projectId, site, why: String(err && err.message ? err.message : err).slice(0, 300) });
      await closeWindow(win, ws, 'error');
    }
  }

  function relay(win, ws, data) {
    if (win.closing) return;
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      message = null;
    }
    const input = door.toCdpInput(message);
    if (!input) {
      win.inputs.rejected += 1;
      return;
    }
    win.inputs[input.kind] += 1;
    win.clock.touch();
    win.browser.page(input.method, input.params).catch(() => {
      win.inputs.rejected += 1;
    });
  }

  function closeWindow(win, ws, reason) {
    if (win.closing) return win.closing;
    win.closing = (async () => {
      if (win.clock) win.clock.stop();
      if (win.throttle) win.throttle.stop();
      bye(ws, reason);
      win.abort.abort();
      // A launch still under way is waited for and whatever it opened is shut,
      // so neither a shutdown nor a viewer leaving mid-launch strands a Chrome
      // on the project's profile. Review round 2, ticket 86bcrmbb4.
      const browser = win.browser || (win.opening ? await win.opening.catch(() => null) : null);
      if (browser) await browser.close().catch(() => {});
      if (windows.get(win.projectId) === win) windows.delete(win.projectId);
      log('window-closed', {
        windowId: win.id,
        projectId: win.projectId,
        site: win.site,
        reason,
        durationMs: now() - win.openedAt,
        inputs: { ...win.inputs },
        frames: win.throttle ? { sent: win.throttle.sent, dropped: win.throttle.dropped } : { sent: 0, dropped: 0 },
      });
    })();
    return win.closing;
  }

  return {
    server,
    passes,
    windows,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, () => resolve(server.address()));
      });
    },
    async close() {
      await Promise.all([...windows.values()].map((w) => w.closing || closeWindow(w, { readyState: 3, close() {} }, 'finished')));
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main() {
  const secret = String(process.env.BROWSER_DOOR_SECRET || '').trim();
  const chromePath = chrome.findChrome();
  if (!chromePath) {
    console.error('No Chrome found. Install Google Chrome or set BROWSER_DOOR_CHROME to its path.');
    process.exit(1);
  }
  const logFile = process.env.BROWSER_DOOR_LOG || path.join(os.homedir(), '.starcaster', 'logs', 'browser-door.log');
  const d = createDoor({
    secret,
    chromePath,
    attach: parseAttach(process.env.BROWSER_DOOR_ATTACH),
    profilesRoot: process.env.BROWSER_DOOR_PROFILES || door.defaultProfilesRoot(),
    log: door.createLogger({ file: logFile }),
  });
  const address = await d.listen(Number(process.env.BROWSER_DOOR_PORT || 8091));
  console.log(`browser-door listening on ${address.address}:${address.port} (loopback only)`);
  const stop = () => d.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { HOST, CLOSE_MESSAGES, parseAttach, createDoor };
