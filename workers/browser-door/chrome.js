'use strict';

/**
 * Starting the real Chrome, and talking to it (Outreach wizard 3/19).
 *
 * NEVER PLAYWRIGHT'S LAUNCH. Google refused to sign in a Chrome that Playwright
 * started (`navigator.webdriver = true`, "This browser or app may not be
 * secure") and let one through that was started as plain Chrome with only its
 * remote-control port switched on — measured on the Mini, docs/LIVE_BROWSER_VIEW.md
 * §1. So this file spawns the Chrome binary itself, with no `--enable-automation`
 * and no other flag a test harness would add, and speaks Chrome's remote-control
 * protocol (CDP) over a plain WebSocket. A test fails if a forbidden flag creeps in.
 *
 * `navigator.webdriver` IS TRUE in what it opens, on current Chrome. The plan
 * measured `false` in October; on the Mini's Chrome 156 switching on the
 * remote-control port by itself makes it `true`. The only fix found is a flag
 * that hides the signal from sites, and Dane chose not to disguise the browser
 * (ticket 86bcrmbb4, option B). Its test is kept as a known-failing TODO, and
 * slice 5 finds out whether Google refuses a real sign-in because of it.
 *
 * The control port is `--remote-debugging-port=0`: Chrome picks a free port and
 * listens on 127.0.0.1 only, which is its default and which nothing here
 * overrides. One Chrome per open window, so one client's Chrome is never
 * reachable through another client's window (§5).
 *
 * Dane's own project ATTACHES instead of launching: OpenClaw already runs
 * Chrome on his profile, a profile can only be open in one Chrome at a time,
 * and attaching means a sign-in reaches OpenClaw straight away. An attached
 * window opens its own tab and closes only that tab; OpenClaw's Chrome keeps
 * running.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const DEFAULT_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

/** Flags that mark a browser as automated, or that a test harness adds. Never passed. */
const FORBIDDEN_FLAGS = ['--enable-automation', '--headless', '--remote-debugging-pipe', '--remote-debugging-address'];

function findChrome(env = process.env) {
  const named = String(env.BROWSER_DOOR_CHROME || '').trim();
  if (named) return fs.existsSync(named) ? named : null;
  return DEFAULT_CHROME_PATHS.find((p) => fs.existsSync(p)) || null;
}

function chromeArgs(profileDir) {
  return [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank',
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chrome writes its chosen port and browser path to this file once it is listening. */
async function readDevToolsActivePort(profileDir, { timeoutMs = 20000, child } = {}) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`Chrome exited (code ${child.exitCode}) before it was listening`);
    try {
      const [port, wsPath] = fs.readFileSync(file, 'utf8').split('\n');
      if (port && wsPath) return { port: Number(port), wsUrl: `ws://127.0.0.1:${Number(port)}${wsPath.trim()}` };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not report a control port within ${timeoutMs} ms`);
}

/** A minimal CDP client over one browser-level WebSocket, with flattened page sessions. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.waiting = new Map();
    this.listeners = new Set();
    ws.on('message', (data) => this.onMessage(data));
    // `connect` only listens for the FIRST error. Without a lasting listener a
    // later socket error is unhandled and takes down the whole door keeper —
    // every other project's open window with it. The 'close' that follows an
    // error is what rejects the waiting calls.
    ws.on('error', () => {});
    ws.on('close', () => {
      for (const { reject } of this.waiting.values()) reject(new Error('Chrome connection closed'));
      this.waiting.clear();
      for (const fn of this.listeners) fn({ method: 'Door.disconnected', params: {} });
    });
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      ws.once('open', () => resolve(new Cdp(ws)));
      ws.once('error', reject);
    });
  }

  onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.id && this.waiting.has(msg.id)) {
      const { resolve, reject } = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'}`));
      else resolve(msg.result || {});
      return;
    }
    if (msg.method) for (const fn of this.listeners) fn(msg);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          this.waiting.delete(id);
          reject(err);
        }
      });
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Open one tab for a window and return a handle on it.
 *   { kind: 'launch', chromePath, profileDir }  — start a Chrome of our own
 *   { kind: 'attach', port }                    — a tab in a Chrome already running on 127.0.0.1:<port>
 */
async function openBrowser(target, { spawnFn = spawn, portTimeoutMs } = {}) {
  let child = null;
  let cdp = null;
  let targetId;
  let sessionId;
  try {
    let wsUrl;
    if (target.kind === 'launch') {
      const args = chromeArgs(target.profileDir);
      for (const flag of FORBIDDEN_FLAGS) {
        if (args.some((a) => a === flag || a.startsWith(`${flag}=`))) throw new Error(`refusing to start Chrome with ${flag}`);
      }
      try {
        fs.unlinkSync(path.join(target.profileDir, 'DevToolsActivePort'));
      } catch {
        /* not there — the usual case */
      }
      child = spawnFn(target.chromePath, args, { stdio: 'ignore' });
      ({ wsUrl } = await readDevToolsActivePort(target.profileDir, { child, timeoutMs: portTimeoutMs }));
    } else if (target.kind === 'attach') {
      const res = await fetch(`http://127.0.0.1:${Number(target.port)}/json/version`);
      if (!res.ok) throw new Error(`no Chrome answering on 127.0.0.1:${target.port} (HTTP ${res.status})`);
      wsUrl = (await res.json()).webSocketDebuggerUrl;
    } else {
      throw new Error(`unknown browser target kind "${target.kind}"`);
    }

    cdp = await Cdp.connect(wsUrl);
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } catch (err) {
    // A Chrome we started and could not take control of must not outlive the
    // failure: it holds that project's signed-in profile with its control port
    // on, escapes the 15-minute maximum, and makes every later window for the
    // project fail (a second Chrome on the same profile hands off to it and
    // exits). Review round 1, ticket 86bcrmbb4.
    if (cdp) cdp.close();
    if (child) await stopChild(child);
    throw err;
  }

  let closed = false;
  return {
    cdp,
    sessionId,
    targetId,
    child,
    page: (method, params) => cdp.send(method, params, sessionId),
    async close() {
      if (closed) return;
      closed = true;
      try {
        await cdp.send('Target.closeTarget', { targetId });
      } catch {
        /* the tab or the browser is already gone */
      }
      if (child) {
        try {
          await cdp.send('Browser.close');
        } catch {
          /* fall through to the signal */
        }
        await waitForExit(child, 5000);
      }
      cdp.close();
    },
  };
}

/** SIGTERM, then SIGKILL if it has not gone within a few seconds. */
async function stopChild(child, ms = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  await waitForExit(child, ms);
}

async function waitForExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const timer = sleep(ms).then(() => 'timeout');
  if ((await Promise.race([exited, timer])) === 'timeout') {
    child.kill('SIGKILL');
    await exited;
  }
}

module.exports = { FORBIDDEN_FLAGS, findChrome, chromeArgs, openBrowser, readDevToolsActivePort, Cdp };
