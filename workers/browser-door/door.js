'use strict';

/**
 * The door keeper's rules (Outreach wizard 3/19 · sign-in window slice 1).
 *
 * Everything here is plain logic with no Chrome and no network, so every rule
 * the plan makes a promise about can be tested on its own — and broken on
 * purpose. The plan is docs/LIVE_BROWSER_VIEW.md; the section numbers below
 * point into it.
 *
 * THE PASS DECIDES THE PROFILE, AND NOTHING ELSE DOES (§5). Starcaster's server
 * registers "pass P may open project X for site S" with a signed request. The
 * viewer then presents P and nothing more: there is no field anywhere in what a
 * viewer sends that names a project, so there is nothing to tamper with. A pass
 * is stored only as its SHA-256, is spent the moment it is presented (spent
 * even when it turns out to be late, so a guess cannot be retried), and dies
 * 60 seconds after it was issued.
 *
 * THE KEYS ARE COUNTED, NEVER KEPT (§6). The relay turns a viewer's message
 * into one Chrome input command and forgets it. What reaches a log is how many
 * mouse, key and paste inputs arrived — never a key, never pasted text.
 *
 * THE WINDOW CLOSES ITSELF (§4). Three minutes with no input, or fifteen
 * minutes in all, whichever comes first. The clock is injected so the tests can
 * prove both without waiting fifteen minutes.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PASS_TTL_MS = 60 * 1000;
const IDLE_CLOSE_MS = 3 * 60 * 1000;
const MAX_WINDOW_MS = 15 * 60 * 1000;
/** About 15 pictures a second: plenty for signing in, comfortable on a phone (§2). */
const MAX_FPS = 15;
/** A signed "open" request older or newer than this is refused, so a captured one cannot be replayed later. */
const SIGNATURE_SKEW_MS = 60 * 1000;
/** A pass is 32 random bytes; anything much shorter is not one Starcaster made. */
const MIN_PASS_LENGTH = 32;
const MAX_PASTE_CHARS = 4096;

/**
 * Where each site's window starts. A site that is not in this list cannot be
 * opened at all, so the door keeper never becomes a general-purpose browser.
 */
const SITES = Object.freeze({
  google: 'https://accounts.google.com/',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
  substack: 'https://substack.com/sign-in',
  reddit: 'https://www.reddit.com/login/',
});

/**
 * A project id becomes a folder name, so it is held to a shape that cannot
 * climb out of the profiles folder (`..`, `/`) or be empty. The folder is named
 * by id and never by project name, so renaming a project cannot point it at
 * another client's sign-ins (§5).
 */
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isProjectId(value) {
  return typeof value === 'string' && PROJECT_ID_RE.test(value);
}

function defaultProfilesRoot() {
  return path.join(os.homedir(), '.starcaster', 'browsers');
}

function profileDirFor(projectId, root = defaultProfilesRoot()) {
  if (!isProjectId(projectId)) {
    throw new Error(`refusing a profile folder for "${String(projectId).slice(0, 80)}": not a project id`);
  }
  const dir = path.resolve(root, projectId);
  // Belt and braces: the pattern already forbids it, and this says so out loud if it ever stops.
  if (path.dirname(dir) !== path.resolve(root)) throw new Error(`profile folder escaped ${root}`);
  return dir;
}

function hashPass(pass) {
  return crypto.createHash('sha256').update(String(pass)).digest('hex');
}

// ── Passes ──────────────────────────────────────────────────────────────────

/**
 * Issued passes, keyed by hash. Single-use: `consume` deletes before it checks
 * anything else, so a pass presented twice fails the second time whatever
 * happened the first.
 */
class PassBook {
  constructor({ now = Date.now, ttlMs = PASS_TTL_MS, sites = SITES } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.sites = sites;
    this.entries = new Map();
  }

  issue({ pass, projectId, site }) {
    if (typeof pass !== 'string' || pass.length < MIN_PASS_LENGTH) {
      return { ok: false, error: `a pass must be a string of at least ${MIN_PASS_LENGTH} characters` };
    }
    if (!isProjectId(projectId)) return { ok: false, error: 'project_id is not a project id' };
    if (!Object.prototype.hasOwnProperty.call(this.sites, site)) {
      return { ok: false, error: `unknown site "${String(site).slice(0, 40)}" — known: ${Object.keys(this.sites).join(', ')}` };
    }
    this.sweep();
    const key = hashPass(pass);
    if (this.entries.has(key)) return { ok: false, error: 'that pass was already issued' };
    this.entries.set(key, { projectId, site, expiresAt: this.now() + this.ttlMs });
    return { ok: true };
  }

  /** -> { ok: true, projectId, site } or { ok: false, reason: 'unknown' | 'expired' } */
  consume(pass) {
    if (typeof pass !== 'string' || !pass) return { ok: false, reason: 'unknown' };
    const key = hashPass(pass);
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry) return { ok: false, reason: 'unknown' };
    if (this.now() > entry.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, projectId: entry.projectId, site: entry.site };
  }

  sweep() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (now > entry.expiresAt) this.entries.delete(key);
  }

  get size() {
    return this.entries.size;
  }
}

// ── The signed "open" request from Starcaster ──────────────────────────────

/** HMAC-SHA256 over `<timestamp>.<body>`, hex. Starcaster's half (slice 2) signs the same way. */
function signOpen(secret, timestamp, body) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex');
}

function verifyOpen({ secret, timestamp, signature, body, now = Date.now() }) {
  if (!secret) return { ok: false, error: 'no shared secret configured' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: 'missing timestamp' };
  if (Math.abs(now - ts) > SIGNATURE_SKEW_MS) return { ok: false, error: 'timestamp too far from now' };
  const expected = Buffer.from(signOpen(secret, String(timestamp), body), 'hex');
  const given = Buffer.from(String(signature || ''), 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, error: 'bad signature' };
  }
  return { ok: true };
}

// ── Input relay: a viewer message -> one Chrome input command ─────────────

const MOUSE_ACTIONS = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved', wheel: 'mouseWheel' };
const MOUSE_BUTTONS = new Set(['none', 'left', 'middle', 'right']);
const KEY_ACTIONS = { down: 'keyDown', up: 'keyUp' };

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortString(value, max) {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

/**
 * -> { kind: 'mouse'|'key'|'paste', method, params } or null for anything that
 * is not a well-formed input. A null is counted as rejected and dropped; it is
 * never passed to Chrome in any form.
 */
function toCdpInput(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.type === 'mouse') {
    const type = MOUSE_ACTIONS[message.action];
    if (!type) return null;
    const button = MOUSE_BUTTONS.has(message.button) ? message.button : (type === 'mouseMoved' || type === 'mouseWheel' ? 'none' : 'left');
    const params = {
      type,
      x: finite(message.x),
      y: finite(message.y),
      button,
      clickCount: Math.max(0, Math.min(3, Math.trunc(finite(message.clickCount, type === 'mouseMoved' ? 0 : 1)))),
      modifiers: Math.trunc(finite(message.modifiers)) & 15,
    };
    if (type === 'mouseWheel') {
      params.deltaX = finite(message.deltaX);
      params.deltaY = finite(message.deltaY);
    }
    return { kind: 'mouse', method: 'Input.dispatchMouseEvent', params };
  }
  if (message.type === 'key') {
    const type = KEY_ACTIONS[message.action];
    if (!type) return null;
    const key = shortString(message.key, 32);
    if (key === undefined) return null;
    const params = { type, key, modifiers: Math.trunc(finite(message.modifiers)) & 15 };
    const code = shortString(message.code, 32);
    if (code) params.code = code;
    const keyCode = Math.trunc(finite(message.keyCode, NaN));
    if (Number.isFinite(keyCode)) params.windowsVirtualKeyCode = keyCode;
    // A printable key carries its character, which is what makes Chrome type it.
    const text = shortString(message.text, 4);
    if (type === 'keyDown' && text) params.text = text;
    return { kind: 'key', method: 'Input.dispatchKeyEvent', params };
  }
  if (message.type === 'paste') {
    const text = shortString(message.text, MAX_PASTE_CHARS);
    if (!text) return null;
    return { kind: 'paste', method: 'Input.insertText', params: { text } };
  }
  return null;
}

// ── The frame throttle ─────────────────────────────────────────────────────

/**
 * Chrome sends a picture whenever the page changes — 60 a second on a moving
 * page (§2). This forwards at most `fps` of them. A picture that arrives too
 * soon is not thrown away for good: the newest one waiting is sent when the
 * interval is up, so the viewer always ends on what the page really shows.
 */
class FrameThrottle {
  constructor({ fps = MAX_FPS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, send }) {
    this.intervalMs = 1000 / fps;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.send = send;
    this.lastSentAt = -Infinity;
    this.pending = null;
    this.timer = null;
    this.sent = 0;
    this.dropped = 0;
  }

  push(frame) {
    const wait = this.lastSentAt + this.intervalMs - this.now();
    if (wait <= 0 && !this.timer) {
      this.emit(frame);
      return;
    }
    if (this.pending) this.dropped += 1;
    this.pending = frame;
    if (!this.timer) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        const next = this.pending;
        this.pending = null;
        if (next) this.emit(next);
      }, Math.max(0, wait));
    }
  }

  emit(frame) {
    this.lastSentAt = this.now();
    this.sent += 1;
    this.send(frame);
  }

  stop() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

// ── The window's own clock ─────────────────────────────────────────────────

/**
 * Calls `onClose(reason)` exactly once: 'idle' after IDLE_CLOSE_MS with no
 * input, 'time-limit' at MAX_WINDOW_MS whatever happens. `touch()` is called on
 * every accepted input and is the only thing that pushes the idle close back.
 */
class WindowClock {
  constructor({ idleMs = IDLE_CLOSE_MS, maxMs = MAX_WINDOW_MS, setTimer = setTimeout, clearTimer = clearTimeout, onClose }) {
    this.idleMs = idleMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onClose = onClose;
    this.closed = false;
    this.idleTimer = this.setTimer(() => this.fire('idle'), idleMs);
    this.maxTimer = this.setTimer(() => this.fire('time-limit'), maxMs);
  }

  touch() {
    if (this.closed) return;
    this.clearTimer(this.idleTimer);
    this.idleTimer = this.setTimer(() => this.fire('idle'), this.idleMs);
  }

  fire(reason) {
    if (this.closed) return;
    this.stop();
    this.onClose(reason);
  }

  stop() {
    this.closed = true;
    this.clearTimer(this.idleTimer);
    this.clearTimer(this.maxTimer);
  }
}

// ── Chrome profile preferences ─────────────────────────────────────────────

/**
 * Switch off "offer to save passwords" in a profile this door keeper creates,
 * so Chrome keeps the sign-in (a cookie) and never the password (§6). Merged
 * into whatever Preferences file is already there, so a profile that already
 * holds sign-ins keeps them.
 */
function writeNoPasswordPrefs(profileDir) {
  const prefsPath = path.join(profileDir, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`cannot read ${prefsPath}: ${err.message}`);
  }
  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;
  prefs.profile = { ...(prefs.profile || {}), password_manager_enabled: false };
  fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  return prefsPath;
}

// ── The log ────────────────────────────────────────────────────────────────

/**
 * One JSON line per event. The fields are fixed by the caller and none of them
 * is ever input text — `inputs` is a set of counts. This is the file the
 * marker-password test searches.
 */
function createLogger({ file, echo = true } = {}) {
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  return function log(event, fields = {}) {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
    if (file) fs.appendFileSync(file, `${line}\n`);
    if (echo) console.log(line);
  };
}

module.exports = {
  PASS_TTL_MS,
  IDLE_CLOSE_MS,
  MAX_WINDOW_MS,
  MAX_FPS,
  SIGNATURE_SKEW_MS,
  SITES,
  isProjectId,
  defaultProfilesRoot,
  profileDirFor,
  hashPass,
  PassBook,
  signOpen,
  verifyOpen,
  toCdpInput,
  FrameThrottle,
  WindowClock,
  writeNoPasswordPrefs,
  createLogger,
};
