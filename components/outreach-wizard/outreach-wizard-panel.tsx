import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PROJECT_SWITCH_EVENT } from '../reddit-comments/reddit-comments-panel';

export { PROJECT_SWITCH_EVENT };

/**
 * Engage › Outreach — one screen that says, for YouTube, Substack and Reddit,
 * where each of the five stages stands and the one next step. Outreach
 * wizard 1/19 (task 86bcrmb8x).
 *
 * A React island in the frozen vanilla app, mounted into
 * #outreachWizardReactRoot by react-entry.js. Data: GET /api/outreach/overview
 * (routes/outreach.js over lib/outreachOverview.js), which reads the existing
 * outreach stores and changes nothing.
 *
 * It REPORTS and ROUTES, with one exception: the Connect stage is where Dane
 * chooses the account each channel posts as, asks the Mini to check its
 * sign-in now, and (Reddit) sets the pace — Outreach wizard 2/19, task
 * 86bcrmba0, over POST /api/outreach/accounts/:site/*. Nothing posts on a
 * channel until its account is chosen. Every other stage's one button opens
 * the existing screen for that step (slice 19 brings the work inside). The
 * first stage that is not done is open and highlighted.
 *
 * The shape is the Engage panels' on purpose: it (re)loads when its page is
 * SHOWN and when the project is SWITCHED, and drops a reply that lands after a
 * newer request or a switch. A stage the server could not read says "Cannot
 * tell" and why — it is never drawn as done.
 */

const OVERVIEW_PATH = '/api/outreach/overview';

/** Where the last channel picked is remembered, per viewer (this browser). */
export const CHANNEL_STORAGE_KEY = 'starcaster:outreach-wizard:channel';

export type StageState = 'done' | 'needs_you' | 'waiting_mini' | 'not_started' | 'cannot_tell';

export type OutreachStage = {
  key: string;
  label: string;
  state: StageState;
  sentence: string;
  next: { label: string; page: string } | null;
};

/** The Connect stage's account question (lib/outreachOverview.js accountView). */
export type OutreachAccount = {
  expectedAccount: string;
  observedAccount: string;
  confirmedAt: string | null;
  checkRequestedAt: string | null;
  browserCheckedAt: string | null;
  pace?: { maxCommentsPerDay: number; minMinutesBetween: number };
};

export type OutreachChannel = { key: string; label: string; stages: OutreachStage[]; account?: OutreachAccount | null };

const ACCOUNTS_PATH = '/api/outreach/accounts';

/** After "Check now", how often and how long the screen re-reads the overview. */
export const CHECK_POLL_MS = 20 * 1000;
export const CHECK_POLL_TIMES = 15;

export type OutreachOverview = { generatedAt: string; channels: OutreachChannel[] };

/** What each state is called on the screen. */
export const STATE_WORDS: Record<StageState, string> = {
  done: 'Done',
  needs_you: 'Needs you',
  waiting_mini: 'Waiting on the Mini',
  not_started: 'Not started',
  cannot_tell: 'Cannot tell',
};

/** The stage that is open: the first one that is not done. -1 when all are. */
export function openStageIndex(stages: OutreachStage[]): number {
  return stages.findIndex((s) => s.state !== 'done');
}

export function readSavedChannel(): string {
  try {
    return window.localStorage.getItem(CHANNEL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveChannel(key: string): void {
  try {
    window.localStorage.setItem(CHANNEL_STORAGE_KEY, key);
  } catch {
    /* storage is off (private window, quota) — the choice just is not remembered */
  }
}

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
  setActivePage?: (pageId: string) => void;
};

function getApp(): AppShape | null {
  return (window as unknown as { App?: AppShape }).App || null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Open another admin screen. The link's href is the same place, for a new tab. */
export function openPage(event: React.MouseEvent, page: string): void {
  const app = getApp();
  if (typeof app?.setActivePage !== 'function') return; // fall through to the href
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  app.setActivePage(page);
}

function clockText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The Connect stage's controls: who the Mini is signed in as, which account
 * this channel posts as, Check now, and Reddit's pace. `onChanged` re-reads
 * the overview; `onCheckAsked` starts the re-reads that pick up the answer.
 */
export function ConnectControls({ channel, onChanged, onCheckAsked }: {
  channel: OutreachChannel;
  onChanged: () => void;
  onCheckAsked: () => void;
}): React.ReactElement | null {
  const account = channel.account;
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [perDay, setPerDay] = useState(String(account?.pace?.maxCommentsPerDay ?? ''));
  const [gap, setGap] = useState(String(account?.pace?.minMinutesBetween ?? ''));

  useEffect(() => {
    setPerDay(String(account?.pace?.maxCommentsPerDay ?? ''));
    setGap(String(account?.pace?.minMinutesBetween ?? ''));
  }, [account?.pace?.maxCommentsPerDay, account?.pace?.minMinutesBetween]);

  if (!account) return null;
  const site = channel.key;
  const label = channel.label;
  const { expectedAccount, observedAccount } = account;

  const send = async (verb: string, body: Record<string, unknown> | null, what: string): Promise<boolean> => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return false;
    }
    setBusy(verb);
    setError('');
    try {
      await api(`${ACCOUNTS_PATH}/${encodeURIComponent(site)}/${verb}`, { method: 'POST', body: JSON.stringify(body || {}) });
      return true;
    } catch (err) {
      setError(`${what} was not saved: ${errorText(err, 'unknown error')}`);
      return false;
    } finally {
      setBusy('');
    }
  };

  const choose = async (chosen: string) => {
    if (await send('choose', { account: chosen }, 'The account')) {
      setOther(false);
      setName('');
      setNotice(chosen === observedAccount
        ? `${label} now posts as ${chosen}. The sentence above is the Mini's last reading — click Check now to have it confirm.`
        : `${label} will post as ${chosen}. Sign the Mini's browser in as ${chosen} (Screen Sharing to the Mini, for now), then click Check now.`);
      onChanged();
    }
  };

  const checkNow = async () => {
    if (await send('check', null, 'The check request')) {
      setNotice(`Check asked for at ${clockText(new Date().toISOString())}. The Mini picks it up within about half a minute, and the check itself can take a few minutes; this sentence updates on its own.`);
      onCheckAsked();
    }
  };

  const savePace = async () => {
    if (await send('pace', { maxCommentsPerDay: Number(perDay), minMinutesBetween: Number(gap) }, 'The pace')) {
      setNotice(`Reddit's pace saved: ${perDay} a day, at least ${gap} minutes apart.`);
      onChanged();
    }
  };

  return (
    <div className="outreach-wizard-connect" data-connect={site}>
      {/* With no account chosen, the stage's own sentence already names who
          the Mini sees and asks for a choice; these lines add only what it
          does not say. */}
      {expectedAccount ? (
        <p>
          Posting as <strong>{expectedAccount}</strong>.
          {observedAccount && observedAccount !== expectedAccount
            ? <> The Mini is signed in to {label} as <strong>{observedAccount}</strong>.</>
            : null}
        </p>
      ) : null}
      <div className="outreach-wizard-stage-actions">
        {observedAccount && observedAccount !== expectedAccount ? (
          <button type="button" className="btn" disabled={!!busy} onClick={() => void choose(observedAccount)}>Post as this account</button>
        ) : null}
        <button type="button" className="btn" disabled={!!busy} aria-expanded={other} onClick={() => setOther((v) => !v)}>
          I&apos;ll sign in as someone else
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void checkNow()}>
          {busy === 'check' ? 'Asking…' : 'Check now'}
        </button>
      </div>
      {other ? (
        <form
          className="outreach-wizard-connect-form"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) void choose(name.trim()); }}
        >
          <label htmlFor={`outreach-account-${site}`}>{`${label} account to post as`}</label>
          <input
            id={`outreach-account-${site}`}
            type="text"
            className="outreach-wizard-account-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!!busy || !name.trim()}>Post as this account</button>
        </form>
      ) : null}
      {account.pace ? (
        <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void savePace(); }}>
          <label htmlFor="outreach-reddit-per-day">Comments a day</label>
          <input id="outreach-reddit-per-day" type="number" min={1} max={50} className="outreach-wizard-number" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
          <label htmlFor="outreach-reddit-gap">Minutes apart, at least</label>
          <input id="outreach-reddit-gap" type="number" min={0} max={1440} className="outreach-wizard-number" value={gap} onChange={(e) => setGap(e.target.value)} />
          <button type="submit" className="btn" disabled={!!busy}>Save pace</button>
        </form>
      ) : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
    </div>
  );
}

function StageRow({ stage, index, open, children }: {
  stage: OutreachStage;
  index: number;
  open: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <li
      className={`outreach-wizard-stage outreach-wizard-stage--${stage.state}${open ? ' outreach-wizard-stage--open' : ''}`}
      data-stage={stage.key}
      data-state={stage.state}
      aria-current={open ? 'step' : undefined}
    >
      <span className="outreach-wizard-stage-number" aria-hidden="true">{stage.state === 'done' ? '✓' : index + 1}</span>
      <div className="outreach-wizard-stage-body">
        <p className="outreach-wizard-stage-head">
          <strong>{stage.label}</strong>
          <span className="outreach-wizard-stage-state">{STATE_WORDS[stage.state] || stage.state}</span>
        </p>
        <p className="outreach-wizard-stage-sentence">{stage.sentence}</p>
        {children}
        {open && stage.next ? (
          <div className="outreach-wizard-stage-actions">
            <a className="btn btn-primary" href={`#page=${stage.next.page}`} onClick={(e) => openPage(e, stage.next!.page)}>
              {stage.next.label}
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function OutreachWizardPanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  const [overview, setOverview] = useState<OutreachOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<string>(() => readSavedChannel() || 'youtube');
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const reply = await api(OVERVIEW_PATH);
      if (seq !== requestSeq.current) return;
      setOverview((reply?.data as OutreachOverview) || null);
      setError('');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setOverview(null);
      setError(`Where outreach stands could not be read: ${errorText(err, 'unknown error')}`);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Load each time the page is shown.
  useEffect(() => {
    const page = hostRef.current?.closest('.app-page');
    const visible = () => !page || !page.classList.contains('hidden');
    if (visible()) void load();
    if (!page || typeof MutationObserver === 'undefined') return undefined;
    let wasVisible = visible();
    const observer = new MutationObserver(() => {
      const now = visible();
      if (now && !wasVisible) void load();
      wasVisible = now;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [load]);

  // A project switch: drop the old project's answer at once and read the new one's.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      setOverview(null);
      setError('');
      setLoading(false);
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  // After "Check now": re-read every CHECK_POLL_MS for a while, so the new
  // sentence appears without a reload. One poll at a time; stopped on unmount.
  const startCheckPoll = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    let left = CHECK_POLL_TIMES;
    pollTimer.current = setInterval(() => {
      left -= 1;
      void load();
      if (left <= 0 && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, CHECK_POLL_MS);
  }, [load]);
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  const channels = overview?.channels || [];
  const current = channels.find((c) => c.key === channel) || channels[0] || null;
  const openIndex = current ? openStageIndex(current.stages) : -1;

  const pick = (key: string) => {
    setChannel(key);
    saveChannel(key);
  };

  return (
    <div className="outreach-wizard-panel" ref={hostRef}>
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
      {!overview && !error ? <p className="outreach-wizard-muted">{loading ? 'Reading where each channel stands…' : ''}</p> : null}
      {channels.length ? (
        <div className="outreach-wizard-tabs" role="tablist" aria-label="Channel">
          {channels.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              className={`btn outreach-wizard-tab${current?.key === c.key ? ' outreach-wizard-tab--active' : ''}`}
              aria-selected={current?.key === c.key}
              onClick={() => pick(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {current ? (
        <section role="tabpanel" aria-label={`${current.label} outreach`} className="outreach-wizard-channel" data-channel={current.key}>
          {openIndex === -1 ? (
            <p className="outreach-wizard-muted">{`Every ${current.label} stage is done.`}</p>
          ) : null}
          <ol className="outreach-wizard-stages">
            {current.stages.map((s, i) => (
              <StageRow key={s.key} stage={s} index={i} open={i === openIndex}>
                {s.key === 'connect' ? (
                  <ConnectControls key={current.key} channel={current} onChanged={() => void load()} onCheckAsked={startCheckPoll} />
                ) : null}
              </StageRow>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
