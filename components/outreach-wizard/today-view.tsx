import React, { useCallback, useEffect, useRef, useState } from 'react';
import { keptOptions, droppedLine, type DraftOption } from './draft-chooser';
import ReasonPicker, { decisionNotice, rejectNotice, type DecisionFeedback, type RejectReason } from './reason-picker';
import type { OutreachChannel } from './outreach-wizard-panel';

/**
 * Engage › Outreach › Today — Outreach wizard 19/19, slice A (task SC-642).
 *
 * One line per view saying what is waiting — "3 replies waiting for you ·
 * 12 new conversations · Mini signed in" — and one button, Start, that walks
 * through the waiting replies one after another. Keys while walking: 1–3
 * choose, E edits, A approves, R rejects, → skips.
 *
 * The line is read from the overview the panel already has (lib/outreachOverview.js
 * attaches `waitingCount` to each Write replies stage and `newCount` to each
 * Find conversations stage), so showing it costs no request. Start reads each
 * channel's own list of drafts — the same endpoints its own screen uses — and
 * Approve and Reject post to those same endpoints, so a decision here is the
 * same decision as one made there.
 *
 * Nothing posts from here. Approve hands the reply to the Mini, which posts it
 * within the channel's pace, exactly as on each channel's own screen.
 *
 * A number that could not be counted is never shown as 0: a channel whose
 * stage could not be read says "cannot tell" (landmine 17).
 */

export type TodayChannelKey = 'youtube' | 'substack' | 'reddit';

/** Where each channel's drafts are listed and decided. */
export const TODAY_SOURCES: Record<TodayChannelKey, { list: string; base: string }> = {
  youtube: { list: '/api/youtube-outreach/comments?status=draft', base: '/api/youtube-outreach/comments' },
  substack: { list: '/api/engage/substack-notes/items', base: '/api/engage/substack-notes/items' },
  reddit: { list: '/api/engage/reddit-comments/items', base: '/api/engage/reddit-comments/items' },
};

/** One reply waiting for Dane, whichever channel it is on. */
export type WaitingReply = {
  channel: TodayChannelKey;
  channelLabel: string;
  id: string;
  options: DraftOption[];
  /** Used only when an older draft has no options: it is offered as the one choice. */
  draftText: string;
  boxLabel: string;
  /** What it replies to: a heading, its link, and a line of context. */
  title: string;
  url: string;
  detail: string;
  createdAt: string;
};

export type Row = Record<string, any>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clip(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * What one row of a channel's list replies to — a heading, its link, a line of
 * context — and what its words are called. Shared by the walk-through and by
 * Write replies' list of decided replies (SC-916), so the two never describe
 * the same reply differently.
 */
export function rowContext(channel: TodayChannelKey, row: Row): { boxLabel: string; title: string; url: string; detail: string } {
  if (channel === 'substack') {
    const reply = row.kind === 'reply';
    return {
      boxLabel: reply ? 'Your Reply' : 'Your Note',
      title: reply ? 'A reply on Substack' : str(row.contentTitle) || 'A Note on Substack',
      url: reply ? str(row.targetUrl) : str(row.contentUrl),
      detail: clip(reply ? str(row.targetText) : str(row.ideaText)),
    };
  }
  if (channel === 'reddit') {
    return {
      boxLabel: 'Your Comment',
      title: str(row.postTitle) || 'A Reddit post',
      url: str(row.targetUrl),
      detail: clip(row.parentCommentText
        ? `${str(row.parentCommentAuthor) || 'Someone'} wrote: ${str(row.parentCommentText)}`
        : `${row.subreddit ? `r/${str(row.subreddit)}` : ''}${row.postBody ? ` · ${str(row.postBody)}` : ''}`.replace(/^ · /, '')),
    };
  }
  const videoId = str(row.videoId);
  return {
    boxLabel: 'Your Comment',
    title: str(row.videoTitle) || videoId || 'A YouTube video',
    url: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '',
    detail: str(row.channelName),
  };
}

/** The drafts in one channel's list that are waiting for Approve or Reject, oldest first. */
export function waitingFrom(channel: TodayChannelKey, channelLabel: string, rows: unknown): WaitingReply[] {
  const list = (Array.isArray(rows) ? rows : []) as Row[];
  const out: WaitingReply[] = [];
  for (const row of list) {
    if (!row || row.status !== 'draft' || !row.id) continue;
    // Substack ideas (restacks, likes) are not replies yet.
    if (channel === 'substack' && row.kind !== 'note' && row.kind !== 'reply') continue;
    out.push({
      channel,
      channelLabel,
      id: String(row.id),
      options: Array.isArray(row.draftOptions) ? (row.draftOptions as DraftOption[]) : [],
      draftText: str(row.finalText) || str(row.draftText),
      createdAt: str(row.createdAt),
      ...rowContext(channel, row),
    });
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The choices on a card: the kept options, or an older draft's one wording. */
export function choicesFor(reply: WaitingReply): Array<{ index: number | null; text: string; angle: string }> {
  const kept = keptOptions(reply.options);
  if (kept.length) return kept;
  return reply.draftText.trim() ? [{ index: null, text: reply.draftText, angle: 'The draft' }] : [];
}

/** What the Today line counts for one channel. `null` means it could not be counted. */
export type ChannelCounts = { label: string; waiting: number | null; conversations: number | null; signedIn: boolean | null };

export function countsFor(channel: OutreachChannel): ChannelCounts {
  const by = (key: string) => channel.stages.find((s) => s.key === key);
  const replies = by('replies') as (ReturnType<typeof by> & { waitingCount?: number }) | undefined;
  const convo = by('conversations') as (ReturnType<typeof by> & { newCount?: number }) | undefined;
  const connect = by('connect');
  const num = (stage: { state: string } | undefined, n: number | undefined) => (
    !stage || stage.state === 'cannot_tell' || typeof n !== 'number' ? null : n
  );
  return {
    label: channel.label,
    waiting: num(replies, replies?.waitingCount),
    // A channel with nothing to look in yet has found nothing: that 0 is counted.
    conversations: convo?.state === 'not_started' ? (convo.newCount ?? 0) : num(convo, convo?.newCount),
    signedIn: !connect || connect.state === 'cannot_tell' ? null : connect.state === 'done',
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 replies waiting for you · 12 new conversations · Mini signed in". */
export function todayLine(counts: ChannelCounts[]): string {
  const sum = (pick: (c: ChannelCounts) => number | null, one: string, many: string, what: string) => {
    const unknown = counts.filter((c) => pick(c) === null).map((c) => c.label);
    const total = counts.reduce((n, c) => n + (pick(c) || 0), 0);
    if (unknown.length === counts.length) return `${what}: cannot tell`;
    const head = plural(total, one, many);
    return unknown.length ? `${head} (cannot tell for ${unknown.join(' and ')})` : head;
  };
  const parts = [
    sum((c) => c.waiting, 'reply waiting for you', 'replies waiting for you', 'Replies waiting'),
    sum((c) => c.conversations, 'new conversation', 'new conversations', 'New conversations'),
  ];
  if (counts.length === 1) {
    const s = counts[0].signedIn;
    parts.push(s === null ? 'Mini sign-in: cannot tell' : s ? 'Mini signed in' : 'Mini not signed in');
  } else {
    const out = counts.filter((c) => c.signedIn === false).map((c) => c.label);
    const unknown = counts.filter((c) => c.signedIn === null).map((c) => c.label);
    if (out.length) parts.push(`Mini not signed in to ${out.join(' and ')}`);
    else if (unknown.length) parts.push(`Mini sign-in: cannot tell for ${unknown.join(' and ')}`);
    else parts.push('Mini signed in everywhere');
  }
  return parts.join(' · ');
}

/** What a key press means while walking. Typing in a box is never a command. */
export type WalkKey = { kind: 'pick'; n: number } | { kind: 'edit' } | { kind: 'approve' } | { kind: 'reject' } | { kind: 'skip' };

export function walkKey(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: EventTarget | null }): WalkKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const el = event.target as HTMLElement | null;
  const tag = (el?.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'input' || tag === 'select' || el?.isContentEditable) return null;
  const k = event.key;
  if (k === '1' || k === '2' || k === '3') return { kind: 'pick', n: Number(k) };
  if (k === 'e' || k === 'E') return { kind: 'edit' };
  if (k === 'a' || k === 'A') return { kind: 'approve' };
  if (k === 'r' || k === 'R') return { kind: 'reject' };
  if (k === 'ArrowRight') return { kind: 'skip' };
  return null;
}

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const api = (window as unknown as { App?: { api?: Api } }).App?.api;
  return typeof api === 'function' ? api : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The window event public/js/projectContext.js emits on every project switch. */
const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';

type Tally = { approved: number; rejected: number; skipped: number };

export default function TodayView({ channels, scopeLabel, onChanged, startSignal = 0 }: {
  /** The channels this view covers: one, or all three for "All channels". */
  channels: OutreachChannel[];
  /** "All channels", or the one channel's name. */
  scopeLabel: string;
  /** Re-read the overview after a decision. */
  onChanged: () => void;
  /**
   * Bumped by the Write replies stage's button (SC-916): each new value starts
   * the walk-through here, as Start does, and brings this view into sight —
   * so that stage's work happens on this screen instead of on another one.
   */
  startSignal?: number;
}): React.ReactElement {
  const [queue, setQueue] = useState<WaitingReply[] | null>(null);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [tally, setTally] = useState<Tally>({ approved: 0, rejected: 0, skipped: 0 });
  const epoch = useRef(0);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);

  const counts = channels.map(countsFor);
  const line = todayLine(counts);
  const knownWaiting = counts.reduce((n, c) => n + (c.waiting || 0), 0);
  const anyUnknown = counts.some((c) => c.waiting === null);
  const channelKeys = channels.map((c) => c.key).join(',');

  // A project switch, or another channel scope: stop walking.
  const stop = useCallback(() => {
    epoch.current += 1;
    setQueue(null);
    setAt(0);
    setPicked(null);
    setText('');
    setBusy('');
    setError('');
    setReadErrors([]);
    setRejecting(false);
  }, []);
  useEffect(() => {
    window.addEventListener(PROJECT_SWITCH_EVENT, stop);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, stop);
  }, [stop]);
  useEffect(() => { stop(); setNotice(''); }, [channelKeys, stop]);

  const current = queue && at < queue.length ? queue[at] : null;
  const choices = current ? choicesFor(current) : [];

  const start = async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const mine = ++epoch.current;
    setBusy('start');
    setError('');
    setNotice('');
    setTally({ approved: 0, rejected: 0, skipped: 0 });
    const reads = await Promise.allSettled(channels.map((c) => api(TODAY_SOURCES[c.key as TodayChannelKey]?.list || '')));
    if (mine !== epoch.current) return;
    const found: WaitingReply[] = [];
    const failed: string[] = [];
    reads.forEach((r, i) => {
      const c = channels[i];
      if (r.status === 'fulfilled') found.push(...waitingFrom(c.key as TodayChannelKey, c.label, r.value?.data));
      else failed.push(`${c.label}'s waiting replies could not be read: ${errorText(r.reason, 'unknown error')}`);
    });
    found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setReadErrors(failed);
    setQueue(found);
    setAt(0);
    setBusy('');
  };

  // The Write replies stage asked to start: walk from here (SC-916).
  // Only a CHANGE starts it: a view that mounts with a value already set (a
  // channel tab opened after the button was used on another) does not.
  // A walk already under way (or starting) is NOT restarted: that would reset
  // the tally and the position and throw away an edited, unapproved wording
  // (SC-916 send-back). The press then only brings the walk into sight.
  const startRef = useRef(start);
  startRef.current = start;
  const walkingRef = useRef(false);
  walkingRef.current = busy === 'start' || current !== null;
  const seenSignal = useRef(startSignal);
  useEffect(() => {
    if (startSignal === seenSignal.current) return;
    seenSignal.current = startSignal;
    hostRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (walkingRef.current) return;
    void startRef.current();
  }, [startSignal]);

  const pick = (n: number) => {
    const choice = choices[n - 1];
    if (!choice) return;
    setPicked(n - 1);
    setText(choice.text);
  };

  const edit = () => {
    if (picked === null) pick(1);
    // After the box renders.
    setTimeout(() => boxRef.current?.focus(), 0);
  };

  const advance = (what: keyof Tally) => {
    // The next card starts with nothing picked — reset now, in the same
    // render that shows it, so it never shows the last reply's words.
    setPicked(null);
    setText('');
    setError('');
    setTally((t) => ({ ...t, [what]: t[what] + 1 }));
    if (what === 'skipped') setAt((i) => i + 1);
    else setQueue((q) => (q && current ? q.filter((r) => !(r.channel === current.channel && r.id === current.id)) : q));
  };

  const decide = async (action: 'approve' | 'reject', why?: RejectReason) => {
    const api = getApi();
    if (!api || !current) return;
    const choice = picked === null ? null : choices[picked];
    if (action === 'approve' && (!choice || !text.trim())) return;
    const mine = epoch.current;
    const body = action === 'reject'
      ? why || {}
      : choice && choice.index !== null ? { text, option: choice.index } : { text };
    setBusy(action);
    setError('');
    try {
      const base = TODAY_SOURCES[current.channel].base;
      const reply = await api(`${base}/${encodeURIComponent(current.id)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      if (mine !== epoch.current) return;
      const feedback = (reply?.data as { feedback?: DecisionFeedback })?.feedback;
      setNotice(action === 'approve'
        ? decisionNotice(`Approved on ${current.channelLabel}. The Mini posts it within its pace.`, feedback)
        : rejectNotice(`Rejected on ${current.channelLabel}. It will not be posted.`, feedback));
      setRejecting(false);
      advance(action === 'approve' ? 'approved' : 'rejected');
      onChanged();
    } catch (err) {
      if (mine !== epoch.current) return;
      const said = errorText(err, 'unknown error');
      const lead = action === 'approve' ? 'Not approved' : 'Not rejected';
      setError(said.startsWith(lead) ? said : `${lead}: ${said}`);
    } finally {
      if (mine === epoch.current) setBusy('');
    }
  };

  // The keys, heard anywhere on the page while a card is showing.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (event: KeyboardEvent) => {
    if (!current || busy || rejecting) return;
    const k = walkKey(event);
    if (!k) return;
    event.preventDefault();
    if (k.kind === 'pick') pick(k.n);
    else if (k.kind === 'edit') edit();
    else if (k.kind === 'approve') void decide('approve');
    else if (k.kind === 'reject') setRejecting(true);
    else advance('skipped');
  };
  const walking = Boolean(current);
  useEffect(() => {
    if (!walking) return undefined;
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [walking]);

  const finished = queue !== null && !current;
  const left = queue ? queue.length - at : 0;
  const dropped = current ? droppedLine(current.options) : '';

  return (
    <section ref={hostRef} className="outreach-today" aria-label={`Today: ${scopeLabel}`} data-today={channelKeys}>
      <div className="outreach-today-head">
        <h3 className="outreach-today-title">Today</h3>
        <p className="outreach-today-line" data-today-line>{line}</p>
      </div>

      {queue === null ? (
        <div className="outreach-wizard-stage-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy) || (!knownWaiting && !anyUnknown)}
            onClick={() => void start()}
          >
            {busy === 'start' ? 'Reading the waiting replies…' : 'Start'}
          </button>
          {!knownWaiting && !anyUnknown ? (
            <p className="outreach-wizard-muted">
              {`No replies are waiting for you on ${scopeLabel === 'All channels' ? 'any channel' : scopeLabel}: every draft written so far has been approved or rejected.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {readErrors.map((e) => <p key={e} className="outreach-wizard-error" role="alert">{e}</p>)}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}

      {current ? (
        <article className="outreach-today-card" data-today-reply={`${current.channel}:${current.id}`}>
          <p className="outreach-today-where">
            {`${current.channelLabel} · ${plural(left, 'reply', 'replies')} left`}
          </p>
          <div className="outreach-today-context">
            {current.url
              ? <a href={current.url} target="_blank" rel="noopener noreferrer" className="outreach-today-context-title">{current.title}</a>
              : <strong className="outreach-today-context-title">{current.title}</strong>}
            {current.detail ? <span className="outreach-today-context-detail">{current.detail}</span> : null}
          </div>
          <div className="draft-chooser">
            <div className="draft-chooser-options" role="group" aria-label="Replies to choose from">
              {choices.map((choice, i) => (
                <button
                  key={`${choice.index}-${i}`}
                  type="button"
                  className={`draft-chooser-option${picked === i ? ' draft-chooser-option--picked' : ''}`}
                  aria-pressed={picked === i}
                  data-option={i}
                  disabled={Boolean(busy)}
                  onClick={() => pick(i + 1)}
                >
                  <span className="draft-chooser-angle">
                    <span className="draft-chooser-key" aria-hidden="true">{i + 1}</span>
                    {choice.angle || `Reply ${i + 1}`}
                  </span>
                  <span className="draft-chooser-text">{choice.text}</span>
                </button>
              ))}
            </div>
            {!choices.length ? (
              <p className="draft-chooser-help">This draft has no wording to approve. Reject it, or skip it and open it on its own screen.</p>
            ) : null}
            {dropped ? <p className="draft-chooser-dropped">{dropped}</p> : null}
            {picked !== null ? (
              <>
                <label className="draft-chooser-label" htmlFor="outreach-today-box">{current.boxLabel}</label>
                <textarea
                  id="outreach-today-box"
                  ref={boxRef}
                  className="draft-chooser-box"
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </>
            ) : null}
            {error ? <p className="draft-chooser-error" role="alert">{error}</p> : null}
            <div className="draft-chooser-actions">
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => advance('skipped')}>Skip</button>
              <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={() => setRejecting(true)}>Reject</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy) || picked === null || !text.trim()}
                onClick={() => void decide('approve')}
              >
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            </div>
            <p className="draft-chooser-help outreach-today-keys">
              {`Keys: ${choices.length > 1 ? `1–${choices.length} choose` : '1 chooses'}, E edits, A approves, R rejects, → skips.`}
            </p>
          </div>
        </article>
      ) : null}

      {finished ? (
        <div className="outreach-today-done">
          <p className="outreach-wizard-muted">
            {queue!.length || tally.approved || tally.rejected || tally.skipped
              ? `That was the last one: ${tally.approved} approved, ${tally.rejected} rejected, ${tally.skipped} skipped${tally.skipped ? ' (still waiting for you)' : ''}.`
              : readErrors.length
                ? 'No waiting replies could be listed — see above for why.'
                : `No replies are waiting for you on ${scopeLabel === 'All channels' ? 'any channel' : scopeLabel} right now: every draft has been approved or rejected since this page was read.`}
          </p>
          <div className="outreach-wizard-stage-actions">
            <button type="button" className="btn" onClick={() => { stop(); onChanged(); }}>Back to Today</button>
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="outreach-wizard-stage-actions">
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => { stop(); onChanged(); }}>Stop</button>
        </div>
      ) : null}

      {rejecting && current ? (
        <ReasonPicker
          title={`Reject this ${current.channelLabel} reply? It will not be posted.`}
          api={getApi()}
          busy={busy === 'reject'}
          error={error}
          onCancel={() => setRejecting(false)}
          onConfirm={(why) => void decide('reject', why)}
        />
      ) : null}
    </section>
  );
}
