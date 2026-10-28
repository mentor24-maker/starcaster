import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The sign-in window — Outreach wizard 6/19, sign-in window slice 4 (task
 * 86bcrmbfb). Plan: docs/LIVE_BROWSER_VIEW.md §9, Slice 4.
 *
 * A Connect button in the wizard's Connect stage. Clicking it asks Starcaster
 * for a one-time pass (POST /api/browser-view/open, slice 2), opens the door
 * keeper's live feed with it (workers/browser-door, slices 1 and 3), and draws
 * the Mini's browser — already on the site's sign-in page — with a countdown
 * and a Close button. Clicks, keys and paste go back as the door keeper's own
 * message shapes (top of workers/browser-door/server.js).
 *
 * The password typed here never touches Starcaster's server: this socket goes
 * straight to the door keeper, and each key is sent as one key press.
 *
 * When the window ends it ALWAYS says why, in plain words — closed by Dane,
 * idle, time limit, browser gone, refused, or the connection dropping — and
 * records that reason on the window's log row (POST /api/browser-view/:id/close).
 * Then it asks the Mini which account is signed in (the same "Check now" as
 * Outreach wizard 2/19) and offers "Post as this account?" once it answers.
 */

const OPEN_PATH = '/api/browser-view/open';

/** The door keeper's limits (workers/browser-door/door.js). Shown, not enforced: the Mini enforces them. */
export const MAX_WINDOW_MS = 15 * 60 * 1000;
export const IDLE_CLOSE_MS = 3 * 60 * 1000;

/** Mouse moves are sent at most this often; a click is always sent at once. */
const MOVE_EVERY_MS = 50;

/** How each ending is said, and what is recorded on the log row. */
export type CloseReason =
  | 'you-closed'
  | 'finished'
  | 'idle'
  | 'time-limit'
  | 'browser-gone'
  | 'refused'
  | 'already-open'
  | 'error'
  | 'dropped';

/** The reasons the log accepts from a viewer (lib/browserViewStore.js VIEWER_CLOSE_REASONS). */
export type LoggedReason = 'finished' | 'idle' | 'time-limit' | 'browser-gone' | 'error';

export const CLOSE_WORDS: Record<CloseReason, string> = {
  'you-closed': 'You closed the window.',
  finished: 'The Mini closed the window.',
  idle: 'The window closed after 3 minutes with no clicks or keys. Click Connect to open it again.',
  'time-limit': 'The window closed: 15 minutes is the most one window stays open. Click Connect to open it again.',
  'browser-gone': 'The browser on the Mini stopped. Click Connect to open it again.',
  refused: 'The Mini did not accept the pass (it is single-use and lasts 60 seconds). Click Connect to get a new one.',
  'already-open': "This project's browser is already open in another window. Close that one first.",
  error: 'The window could not be opened on the Mini.',
  dropped: 'The connection to the Mini dropped. Click Connect to open the window again.',
};

/** The door keeper's `closed` reason, as this window names it. Unknown → error, never silence. */
export function reasonFromDoor(reason: unknown): CloseReason {
  const r = String(reason || '');
  return r in CLOSE_WORDS && r !== 'you-closed' && r !== 'dropped' ? (r as CloseReason) : 'error';
}

/** What the log row records for each ending. */
export function loggedReason(reason: CloseReason): LoggedReason {
  switch (reason) {
    case 'you-closed':
    case 'finished':
      return 'finished';
    case 'idle':
    case 'time-limit':
    case 'browser-gone':
      return reason;
    default:
      return 'error';
  }
}

/** "14:07" — whole seconds, never negative. */
export function clockFor(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The sooner of the two closes the door keeper will make: 15 minutes after it
 * opened, or 3 minutes after the last click or key.
 */
export function countdown(now: number, openedAt: number, lastInputAt: number): { ms: number; idle: boolean } {
  const total = openedAt + MAX_WINDOW_MS - now;
  const idle = lastInputAt + IDLE_CLOSE_MS - now;
  return idle < total ? { ms: idle, idle: true } : { ms: total, idle: false };
}

/** Chrome's screen-feed description of one picture (Page.screencastFrame metadata). */
export type FrameMetadata = { deviceWidth?: number; deviceHeight?: number; offsetTop?: number };

/**
 * A point on the drawn picture, as page pixels in the Mini's browser. The
 * picture is scaled to fit this screen, so the click is scaled back.
 */
export function toPagePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  meta: FrameMetadata | null,
): { x: number; y: number } | null {
  if (!meta || !meta.deviceWidth || !meta.deviceHeight || !rect.width || !rect.height) return null;
  const x = ((clientX - rect.left) / rect.width) * meta.deviceWidth;
  const y = ((clientY - rect.top) / rect.height) * meta.deviceHeight;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Chrome's modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

/**
 * Cmd/Ctrl+V is NOT sent as keys: the Mini would paste the Mini's clipboard.
 * The browser's own paste event carries this computer's clipboard instead.
 */
export function isPasteShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v';
}

/** One key press as the door keeper's `key` message. A printable key carries its character. */
export function keyMessage(
  action: 'down' | 'up',
  e: { key: string; code: string; keyCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    type: 'key',
    action,
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    modifiers: modifiersOf(e),
  };
  if (action === 'down' && !e.ctrlKey && !e.metaKey) {
    if (e.key.length === 1) msg.text = e.key;
    else if (e.key === 'Enter') msg.text = '\r';
  }
  return msg;
}

const MOUSE_BUTTONS = ['left', 'middle', 'right'];

type AppShape = { api?: (path: string, options?: RequestInit) => Promise<Record<string, any>> };

function getApi(): AppShape['api'] | null {
  const api = (window as unknown as { App?: AppShape }).App?.api;
  return typeof api === 'function' ? api : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

type Phase = 'idle' | 'asking' | 'connecting' | 'open' | 'closed';

export type SignInWindowProps = {
  site: string;
  label: string;
  /** Called once a window that was opened has ended: run the sign-in check now. */
  onClosed: () => void;
  /** Optional: a WebSocket maker, for tests. */
  makeSocket?: (url: string) => WebSocket;
};

export default function SignInWindow({ site, label, onClosed, makeSocket }: SignInWindowProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('idle');
  const [frame, setFrame] = useState('');
  const [closeReason, setCloseReason] = useState<CloseReason | null>(null);
  const [error, setError] = useState('');
  const [logNote, setLogNote] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const socket = useRef<WebSocket | null>(null);
  const sessionId = useRef('');
  const ended = useRef(false);
  const meta = useRef<FrameMetadata | null>(null);
  const openedAt = useRef(0);
  const lastInputAt = useRef(0);
  const lastMoveAt = useRef(0);
  const surface = useRef<HTMLDivElement | null>(null);
  const picture = useRef<HTMLImageElement | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  /**
   * End the window exactly once: say why, record it, then ask who is signed
   * in. `quiet` is the screen being left — record it, but there is nobody to
   * show a sentence to or to ask for a check.
   */
  const finish = useCallback((reason: CloseReason, quiet = false) => {
    if (ended.current) return;
    ended.current = true;
    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState <= 1) {
      try { ws.close(); } catch { /* already gone */ }
    }
    if (!quiet) {
      setCloseReason(reason);
      setPhase('closed');
      setFrame('');
    }
    const id = sessionId.current;
    const api = getApi();
    if (id && api) {
      api(`/api/browser-view/${encodeURIComponent(id)}/close`, {
        method: 'POST',
        body: JSON.stringify({ reason: loggedReason(reason) }),
      }).catch((err) => {
        if (!quiet) setLogNote(`(The window's log could not record how it ended: ${errorText(err, 'unknown error')}.)`);
      });
    }
    if (!quiet) onClosedRef.current();
  }, []);

  // Leaving the screen closes the window: nothing is left open on the Mini.
  useEffect(() => () => {
    if (!ended.current && socket.current) finish('you-closed', true);
  }, [finish]);

  // The countdown ticks once a second while the window is open.
  useEffect(() => {
    if (phase !== 'open' && phase !== 'connecting') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(msg));
    lastInputAt.current = Date.now();
  }, []);

  const open = async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    setError('');
    setLogNote('');
    setCloseReason(null);
    setFrame('');
    meta.current = null;
    sessionId.current = '';
    ended.current = false;
    setPhase('asking');
    let reply: Record<string, any>;
    try {
      reply = await api(OPEN_PATH, { method: 'POST', body: JSON.stringify({ site }) });
    } catch (err) {
      // The server has already logged this attempt as not opened.
      setPhase('idle');
      setError(`The window did not open: ${errorText(err, 'unknown error')}`);
      return;
    }
    const data = reply?.data || {};
    const pass = String(data.pass || '');
    const url = String(data.viewerUrl || '');
    sessionId.current = String(data.session?.id || '');
    if (!pass || !url) {
      setPhase('idle');
      setError('The window did not open: Starcaster answered without a pass for the Mini.');
      return;
    }
    let ws: WebSocket;
    try {
      ws = makeSocket ? makeSocket(url) : new WebSocket(url);
    } catch {
      finish('dropped');
      return;
    }
    socket.current = ws;
    openedAt.current = Date.now();
    lastInputAt.current = openedAt.current;
    setNow(openedAt.current);
    setPhase('connecting');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', pass }));
    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg?.type === 'frame' && typeof msg.data === 'string') {
        meta.current = msg.metadata || meta.current;
        setFrame(`data:image/jpeg;base64,${msg.data}`);
        setPhase((p) => (p === 'connecting' ? 'open' : p));
      } else if (msg?.type === 'closed') {
        finish(reasonFromDoor(msg.reason));
      }
    };
    ws.onclose = () => finish('dropped');
    ws.onerror = () => { /* the close that always follows says why */ };
  };

  // The picture takes focus when it appears, so typing goes to the Mini at once.
  useEffect(() => {
    if (phase === 'open') surface.current?.focus();
  }, [phase]);

  // A wheel must be non-passive to stop this page scrolling instead.
  useEffect(() => {
    const el = surface.current;
    if (!el || phase !== 'open') return undefined;
    const onWheel = (e: WheelEvent) => {
      const img = picture.current;
      const p = img ? toPagePoint(e.clientX, e.clientY, img.getBoundingClientRect(), meta.current) : null;
      if (!p) return;
      e.preventDefault();
      send({ type: 'mouse', action: 'wheel', ...p, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiersOf(e) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [phase, send]);

  const mouse = (action: 'down' | 'up' | 'move') => (e: React.MouseEvent) => {
    if (!picture.current) return;
    if (action === 'move') {
      const t = Date.now();
      if (t - lastMoveAt.current < MOVE_EVERY_MS) return;
      lastMoveAt.current = t;
    }
    const p = toPagePoint(e.clientX, e.clientY, picture.current.getBoundingClientRect(), meta.current);
    if (!p) return;
    if (action === 'down') surface.current?.focus();
    const msg: Record<string, unknown> = { type: 'mouse', action, ...p, modifiers: modifiersOf(e) };
    if (action !== 'move') {
      msg.button = MOUSE_BUTTONS[e.button] || 'left';
      msg.clickCount = e.detail || 1;
    }
    // The door keeper counts a move as input too, so the countdown does the same.
    send(msg);
  };

  const onKey = (action: 'down' | 'up') => (e: React.KeyboardEvent) => {
    if (isPasteShortcut(e)) return; // let the paste event below carry this computer's clipboard
    e.preventDefault();
    send(keyMessage(action, e.nativeEvent));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) send({ type: 'paste', text });
  };

  const left = countdown(now, openedAt.current, lastInputAt.current);
  const live = phase === 'connecting' || phase === 'open';

  return (
    <div className="sign-in-window" data-sign-in-window={site} data-phase={phase}>
      {!live ? (
        <div className="outreach-wizard-stage-actions">
          <button type="button" className="btn" disabled={phase === 'asking'} onClick={() => void open()}>
            {phase === 'asking' ? 'Opening…' : `Connect ${label}`}
          </button>
        </div>
      ) : (
        <div className="sign-in-window-frame" role="region" aria-label={`The Mini's browser, on ${label}`}>
          <div className="sign-in-window-bar">
            <span className="sign-in-window-countdown" role="timer" aria-live="off">
              {phase === 'connecting'
                ? `Opening the Mini's browser on ${label}…`
                : `Closes in ${clockFor(left.ms)}${left.idle ? ' with no clicks or keys' : ''}`}
            </span>
            <button type="button" className="btn" onClick={() => finish('you-closed')}>Close</button>
          </div>
          <div
            ref={surface}
            className="sign-in-window-surface"
            tabIndex={0}
            aria-label={`Sign in to ${label} here. Clicks and keys go to the Mini's browser.`}
            onMouseDown={mouse('down')}
            onMouseUp={mouse('up')}
            onMouseMove={mouse('move')}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={onKey('down')}
            onKeyUp={onKey('up')}
            onPaste={onPaste}
          >
            {frame ? (
              <img ref={picture} className="sign-in-window-picture" src={frame} alt={`The Mini's browser on ${label}`} draggable={false} />
            ) : null}
          </div>
        </div>
      )}
      {closeReason ? (
        <p className="outreach-wizard-notice" role="status" data-close-reason={closeReason}>
          {CLOSE_WORDS[closeReason]}{logNote ? ` ${logNote}` : ''}
        </p>
      ) : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
    </div>
  );
}
