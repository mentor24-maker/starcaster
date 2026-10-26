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
 * It REPORTS and ROUTES only. The open stage's one button opens the existing
 * screen for that step (slice 19 brings the work inside). The first stage that
 * is not done is open and highlighted; the others show their sentence.
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

export type OutreachChannel = { key: string; label: string; stages: OutreachStage[] };

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

function StageRow({ stage, index, open }: { stage: OutreachStage; index: number; open: boolean }): React.ReactElement {
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
              <StageRow key={s.key} stage={s} index={i} open={i === openIndex} />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
