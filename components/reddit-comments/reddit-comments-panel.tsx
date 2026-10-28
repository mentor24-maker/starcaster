import React, { useCallback, useEffect, useRef, useState } from 'react';
import { agoText, whenText, MINI_STALE_MS, type BrowserCheck } from '../youtube-outreach/youtube-outreach-panel';
import DraftChooser, { keptOptions, type DraftOption } from '../outreach-wizard/draft-chooser';
import ReasonPicker, { decisionNotice, rejectNotice, type DecisionFeedback, type RejectReason } from '../outreach-wizard/reason-picker';

/**
 * Engage › Comments — Reddit comments written in Dane's voice. Reddit
 * comments 3/4 (task 86bch3jp7).
 *
 * A React island in the frozen vanilla app, mounted into
 * #redditCommentsReactRoot by react-entry.js. Data:
 * /api/engage/reddit-comments (routes/redditComments.js over
 * lib/redditCommentsStore.js, slice 2/4). It replaced the old vanilla form,
 * which tried to post straight through a Reddit login that was never set up.
 *
 * Dane pastes a link and it lands on "To write" as "Reading…": the Mini's
 * signed-in browser opens it and fills in the post and its top comments
 * within a couple of minutes (Outreach wizard 17/19, task 86bcrmbuv), and
 * this screen re-reads the list by itself while anything is reading. Reddit
 * refuses reads that are not signed in (measured 2026-10-12), so when the
 * Mini is not signed in Add answers POST_TEXT_NEEDED: the screen shows the
 * server's reason and asks for the post pasted by hand, then sends Add again
 * with it. A post the Mini could not read says why on its card, with the
 * same paste box and "Try reading again". "Write with AI" puts
 * a draft on Approvals in an editable box, under the canon it was written
 * from; Approve sends the box's words and the SERVER checks them against the
 * blocklist, so its refusal is shown word for word. Since Outreach wizard 9/19
 * (task 86bcrmbke) Write with AI gives THREE replies to choose from, shown by
 * the shared components/outreach-wizard/draft-chooser.tsx; a draft written
 * before then has no options and keeps its single box. Nothing here posts — the
 * Mini's worker does (workers/youtube-outreach/adapters/reddit.js, 4/4, task
 * 86bch3jpg) and fills the Posted tab. The line at the top says whether the
 * Mini's browser is signed in to Reddit and how fast it posts, read from
 * /api/engage/reddit-comments/status; a comment the Mini could not prove
 * either way sits on Posted as "check this one by hand".
 *
 * The shape is components/substack-notes/substack-notes-panel.tsx's on
 * purpose: it (re)loads when its page is SHOWN and when the project is
 * SWITCHED, and drops a reply that lands after a newer request or a switch.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17), and a read that fails
 * says which read failed.
 */

const ITEMS_PATH = '/api/engage/reddit-comments/items';
const STATUS_PATH = '/api/engage/reddit-comments/status';

/** The window event public/js/projectContext.js emits on every project switch. */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';

export type CanonUsed = { docKey: string; syncedAt: string | null };

export type RedditItem = {
  id: string;
  targetUrl: string;
  postId: string;
  parentCommentId: string;
  subreddit: string;
  postTitle: string;
  postBody: string;
  postAuthor: string;
  parentCommentAuthor: string;
  parentCommentText: string;
  postReadFrom: string;
  /** 17/19: '' (the post is in), 'reading' (the Mini has it) or 'failed'. */
  readState?: string;
  readError?: string;
  readCode?: string;
  readRequestedAt?: string | null;
  draftText: string;
  finalText: string;
  canonUsed: CanonUsed[];
  /** 9/19: the replies to choose from — kept and dropped, in order. Empty on an older draft. */
  draftOptions?: DraftOption[];
  /** 9/19: which of draftOptions was approved. */
  chosenOption?: number | null;
  status: string;
  approvedAt: string | null;
  postedUrl: string;
  screenshotUrl: string;
  postedAt: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
  /** 4/4: the Mini could not prove either way whether it posted. */
  needsHandCheck?: boolean;
  /** 4/4: why an approved comment has not gone out yet, in the worker's words. */
  waitReason?: string;
};

export type RedditPace = { maxCommentsPerDay: number; minMinutesBetween: number; jitterMinutes: number };

/** What /status answers: the account the Mini posts as, its pace, and its last sign-in check. */
export type RedditStatus = {
  account: string;
  pace: RedditPace | null;
  browserCheck: BrowserCheck | null;
  browserCheckError: string;
};

export type SignInLine = { tone: 'ok' | 'warn' | 'alarm'; state: string; text: string };

/**
 * The line at the top: is the Mini's browser signed in to Reddit, and when
 * did it last look? It always says when, so "never checked", "stopped
 * checking" and "signed out" each read as what they are (landmine 17).
 */
export function signInLine(status: RedditStatus | null, now: number = Date.now()): SignInLine {
  if (status?.browserCheckError) {
    return { tone: 'warn', state: 'unread', text: `The Mini's Reddit sign-in check could not be read: ${status.browserCheckError}` };
  }
  const check = status?.browserCheck;
  const checkedAt = check?.checkedAt ? Date.parse(check.checkedAt) : NaN;
  const ago = agoText(check?.checkedAt, now);
  const message = (check?.message || '').trim().replace(/\.$/, '');
  if (!check?.state || !Number.isFinite(checkedAt)) {
    return {
      tone: 'warn',
      state: 'unknown',
      text: 'Mini: has not checked its Reddit sign-in yet, so nothing here says whether posting to Reddit would work — the posting worker on the Mini may not be running.',
    };
  }
  if (now - checkedAt > MINI_STALE_MS) {
    return {
      tone: 'warn',
      state: 'stale',
      text: `The Mini last checked its Reddit sign-in ${ago}, so the posting worker may have stopped. That check said: ${message}.`,
    };
  }
  if (check.state === 'signed_in') return { tone: 'ok', state: check.state, text: `${message}, checked ${ago}.` };
  if (check.state === 'cannot_tell') return { tone: 'warn', state: check.state, text: `${message} (checked ${ago}).` };
  const since = check.signedInAt ? ` Last signed in: ${whenText(check.signedInAt)}.` : '';
  return { tone: 'alarm', state: check.state, text: `${message}. Checked ${ago}.${since}` };
}

/** "Posts at most 3 comments a day, at least 20 minutes apart (plus up to 10 minutes at random)." */
export function paceLine(status: RedditStatus | null): string {
  const pace = status?.pace;
  if (!pace) return '';
  const day = `${pace.maxCommentsPerDay} comment${pace.maxCommentsPerDay === 1 ? '' : 's'} a day`;
  const extra = pace.jitterMinutes ? ` (plus up to ${pace.jitterMinutes} minutes at random)` : '';
  const who = status?.account ? ` as u/${status.account}` : '';
  const named = status?.account ? '' : ' No Reddit account has been chosen for it to post as yet, so nothing posts until one is.';
  return `The Mini posts${who} at most ${day}, at least ${pace.minMinutesBetween} minutes apart${extra}.${named}`;
}

/** A read taking longer than this is past the ticket's "a couple of minutes": offer the paste box. */
export const READ_SLOW_MS = 5 * 60 * 1000;

/** How often the list is re-read while a post is being read. */
export const READING_POLL_MS = 15 * 1000;

/**
 * The line on a card whose post is not in yet, and whether to offer the
 * paste box under it. Always says how long, so a worker that is not running
 * reads as that, not as "still reading" forever (landmine 17).
 */
export function readingLine(
  item: Pick<RedditItem, 'readState' | 'readError' | 'readRequestedAt'>,
  now: number = Date.now(),
): { text: string; offerPaste: boolean; slow: boolean } | null {
  if (item.readState === 'failed') {
    return { text: item.readError || 'The Mini could not read this post, and nothing said why.', offerPaste: true, slow: false };
  }
  if (item.readState !== 'reading') return null;
  const asked = item.readRequestedAt ? Date.parse(item.readRequestedAt) : NaN;
  if (Number.isFinite(asked) && now - asked > READ_SLOW_MS) {
    return {
      text: `Still waiting for the Mini to read this post — asked ${agoText(item.readRequestedAt, now)}. Its worker may not be running. You can paste the post instead.`,
      offerPaste: true,
      slow: true,
    };
  }
  return { text: 'Reading… the Mini is opening this post in its browser. It shows here within a couple of minutes.', offerPaste: false, slow: false };
}

type Tab = 'write' | 'approvals' | 'posted';

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
};

function getApi(): AppShape['api'] | null {
  const app = (window as unknown as { App?: AppShape }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function errorCode(err: unknown): string {
  return String((err as { code?: unknown } | null)?.code || '');
}

/** The canon documents' keys, as Dane knows them. Unknown keys are tidied, not dropped. */
const CANON_NAMES: Record<string, string> = {
  'DANE-OF-EARTH': 'Dane of Earth',
  VOICE: 'Voice',
  DEO: 'DEO',
  ECOSYSTEM: 'Ecosystem',
  'AIISM-BLOCKLIST': 'AI-ism blocklist',
};

/** Words that stay in capitals inside a longer key ("DEO-DATA-THESIS" → "DEO data thesis"). */
const CANON_ACRONYMS = new Set(['DEO']);

export function canonName(docKey: string): string {
  if (CANON_NAMES[docKey]) return CANON_NAMES[docKey];
  const words = docKey.split('-').filter(Boolean).map((w) => (CANON_ACRONYMS.has(w) ? w : w.toLowerCase()));
  if (!words.length) return docKey;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

/**
 * "Written from: Dane of Earth, Voice, DEO, Ecosystem — canon copied Oct 12".
 * The date is the newest copy among the documents used, which is the one that
 * says how fresh the draft's sources were.
 */
export function canonLine(used: CanonUsed[] | null | undefined): string {
  const list = Array.isArray(used) ? used.filter((d) => d && d.docKey) : [];
  if (!list.length) return 'Written from: no canon was recorded for this draft.';
  const names = list.map((d) => canonName(d.docKey)).join(', ');
  const times = list.map((d) => (d.syncedAt ? Date.parse(d.syncedAt) : NaN)).filter(Number.isFinite);
  if (!times.length) return `Written from: ${names} — when the canon was copied is not recorded.`;
  const copied = new Date(Math.max(...times)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Written from: ${names} — canon copied ${copied}`;
}

/** The first few lines of the post, for its row. */
export function postPreview(body: string, max = 280): string {
  const text = String(body || '').trim();
  if (!text) return '';
  const lines = text.split(/\n+/).slice(0, 3).join('\n');
  return lines.length > max ? `${lines.slice(0, max).trimEnd()}…` : lines;
}

export function subredditLabel(item: Pick<RedditItem, 'subreddit'>): string {
  return item.subreddit ? `r/${item.subreddit}` : 'Subreddit not known';
}

/** People paste "reddit.com/r/x/…" without the https://. Add it rather than refuse. */
export function withScheme(link: string): string {
  const trimmed = link.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

/** Is this a link to one comment inside a post (so the reply is to that comment)? */
export function isCommentLink(link: string): boolean {
  return /\/comments\/[a-z0-9]+\/[^/?#]*\/[a-z0-9]+/i.test(link) || /\/comment\/[a-z0-9]+/i.test(link);
}

/**
 * Which tab a row lives on. Rejected rows are on none; the To write tab
 * counts them. A `posting` row the Mini could not prove either way goes on
 * Posted, where its "check this one by hand" and its link are.
 */
export function tabFor(status: string, needsHandCheck = false): Tab | null {
  if (status === 'posting' && needsHandCheck) return 'posted';
  if (status === 'idea') return 'write';
  if (status === 'draft' || status === 'approved' || status === 'posting') return 'approvals';
  if (status === 'posted' || status === 'failed') return 'posted';
  return null;
}

export function postedStatusText(item: Pick<RedditItem, 'status' | 'postedAt' | 'needsHandCheck'>): string {
  if (item.needsHandCheck) return 'Check this one by hand — the Mini could not tell whether it posted';
  if (item.status === 'failed') return 'Failed to post';
  return item.postedAt ? `Posted ${whenText(item.postedAt)}` : 'Posted';
}

function PostSummary({ item }: { item: RedditItem }): React.ReactElement {
  const preview = postPreview(item.postBody);
  return (
    <div className="reddit-comments-post">
      <p className="reddit-comments-post-sub">
        <strong>{subredditLabel(item)}</strong>
        {item.postReadFrom === 'pasted' ? <span className="reddit-comments-muted"> · pasted by hand</span> : null}
      </p>
      <p className="reddit-comments-post-title">{item.postTitle || '(no title)'}</p>
      {preview ? <p className="reddit-comments-text reddit-comments-muted">{preview}</p> : null}
      {item.parentCommentId && item.parentCommentText ? (
        <p className="reddit-comments-text">
          <strong>{item.parentCommentAuthor ? `Replying to ${item.parentCommentAuthor}: ` : 'Replying to: '}</strong>
          {postPreview(item.parentCommentText, 200)}
        </p>
      ) : null}
      {item.targetUrl ? (
        <a className="reddit-comments-link" href={item.targetUrl} target="_blank" rel="noopener noreferrer">Open on Reddit</a>
      ) : null}
    </div>
  );
}

/**
 * A post on To write that is not in yet: "Reading…", or why the Mini could
 * not read it, with the paste box and "Try reading again".
 */
function ReadingCard({ item, busy, error, onPaste, onReadAgain, onReject }: {
  item: RedditItem;
  busy: string;
  error: string;
  onPaste: (fields: Record<string, string>) => void;
  onReadAgain: () => void;
  onReject: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const line = readingLine(item);
  const failed = item.readState === 'failed';
  const id = (what: string) => `rc-${what}-${item.id}`;
  return (
    <li className="reddit-comments-card" data-item-id={item.id} data-read-state={item.readState || ''}>
      <div className="reddit-comments-post">
        <p className="reddit-comments-post-sub"><strong>{subredditLabel(item)}</strong></p>
        <a className="reddit-comments-link" href={item.targetUrl} target="_blank" rel="noopener noreferrer">{item.targetUrl}</a>
      </div>
      {line ? (
        <p className={failed ? 'reddit-comments-error' : 'reddit-comments-status'} role={failed ? 'alert' : 'status'}>{line.text}</p>
      ) : null}
      {line?.offerPaste ? (
        <div className="reddit-comments-paste">
          <p className="reddit-comments-help">Open the link, copy the post into these boxes, then click Save.</p>
          <label className="reddit-comments-label" htmlFor={id('title')}>Post title</label>
          <input id={id('title')} type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="reddit-comments-label" htmlFor={id('body')}>Post text</label>
          <textarea id={id('body')} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          {item.parentCommentId ? (
            <>
              <label className="reddit-comments-label" htmlFor={id('comment')}>The comment you are replying to</label>
              <textarea id={id('comment')} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="reddit-comments-error" role="alert">{error}</p> : null}
      <div className="reddit-comments-actions">
        <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={onReject}>Reject</button>
        {failed ? (
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={onReadAgain}>
            {busy === 'read-again' ? 'Asking…' : 'Try reading again'}
          </button>
        ) : null}
        {line?.offerPaste ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy) || !(title.trim() || body.trim())}
            onClick={() => onPaste({ postTitle: title.trim(), postBody: body.trim(), parentCommentText: comment.trim() })}
          >
            {busy === 'paste' ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function DraftCard({ item, busy, error, onApprove, onReject, onRedraft }: {
  item: RedditItem;
  busy: string;
  error: string;
  onApprove: (text: string, option?: number) => void;
  onReject: () => void;
  onRedraft: () => void;
}): React.ReactElement {
  const [text, setText] = useState(item.draftText);
  if (keptOptions(item.draftOptions).length) {
    return (
      <article className="reddit-comments-card" data-item-id={item.id} aria-label="Comment waiting for approval">
        <PostSummary item={item} />
        <DraftChooser
          options={item.draftOptions || []}
          idPrefix={`rc-draft-${item.id}`}
          busy={busy}
          error={error}
          footnote={canonLine(item.canonUsed)}
          onApprove={(words, option) => onApprove(words, option)}
          onReject={onReject}
          onMore={onRedraft}
        />
      </article>
    );
  }
  const boxId = `rc-draft-${item.id}`;
  return (
    <article className="reddit-comments-card" data-item-id={item.id} aria-label="Comment waiting for approval">
      <PostSummary item={item} />
      <label className="reddit-comments-label" htmlFor={boxId}>Your comment</label>
      <textarea id={boxId} className="reddit-comments-draft" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="reddit-comments-help">{`${text.trim().length} characters`}</p>
      <p className="reddit-comments-help reddit-comments-canon">{canonLine(item.canonUsed)}</p>
      {error ? <p className="reddit-comments-error" role="alert">{error}</p> : null}
      <div className="reddit-comments-actions">
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={onRedraft}>
          {busy === 'draft' ? 'Writing… (about 20 seconds)' : 'Write another'}
        </button>
        <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={onReject}>Reject</button>
        <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !text.trim()} onClick={() => onApprove(text)}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </article>
  );
}

function ApprovedCard({ item, busy, error, onReject }: {
  item: RedditItem;
  busy: string;
  error: string;
  onReject: () => void;
}): React.ReactElement {
  const waiting = item.status === 'posting' ? 'Posting now — the Mini has it' : 'Approved — waiting for the Mini to post it';
  return (
    <article className="reddit-comments-card" data-item-id={item.id} aria-label="Approved comment">
      <PostSummary item={item} />
      <p className="reddit-comments-status">{waiting}</p>
      {item.status === 'approved' && item.waitReason ? <p className="reddit-comments-help">{item.waitReason}</p> : null}
      <p className="reddit-comments-text">{item.finalText || item.draftText}</p>
      {error ? <p className="reddit-comments-error" role="alert">{error}</p> : null}
      {item.status === 'approved' ? (
        <div className="reddit-comments-actions">
          <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={onReject}>Reject</button>
        </div>
      ) : null}
    </article>
  );
}

function PostedRow({ item }: { item: RedditItem }): React.ReactElement {
  return (
    <li className="reddit-comments-posted-row" data-item-id={item.id}>
      {item.screenshotUrl ? (
        <a className="reddit-comments-posted-shot" href={item.screenshotUrl} target="_blank" rel="noopener noreferrer">
          <img src={item.screenshotUrl} alt="Screenshot of the posted comment" />
        </a>
      ) : null}
      <div className="reddit-comments-posted-body">
        <p className="reddit-comments-status">{postedStatusText(item)}</p>
        <p>{`${subredditLabel(item)} — ${item.postTitle || '(no title)'}`}</p>
        <p className="reddit-comments-text">{item.finalText || item.draftText}</p>
        {item.error ? <p className="reddit-comments-error">{item.error}</p> : null}
        <div className="reddit-comments-actions reddit-comments-actions--start">
          {item.postedUrl ? (
            <a className="btn" href={item.postedUrl} target="_blank" rel="noopener noreferrer">Open the comment</a>
          ) : null}
          {item.targetUrl ? (
            <a className="btn" href={item.targetUrl} target="_blank" rel="noopener noreferrer">Open the post</a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function RedditCommentsPanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  // Bumped on every project switch; a write started under one project checks
  // it before showing its reply, so the old client's row never lands here.
  const projectEpoch = useRef(0);
  const [items, setItems] = useState<RedditItem[] | null>(null);
  const [status, setStatus] = useState<RedditStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('write');
  const [link, setLink] = useState('');
  // Reddit refused the read: the post, pasted by hand, goes with the next Add.
  const [needsPaste, setNeedsPaste] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [pasteComment, setPasteComment] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [rowBusy, setRowBusy] = useState<{ id: string; what: string }>({ id: '', what: '' });
  const [rowError, setRowError] = useState<{ id: string; message: string }>({ id: '', message: '' });
  /** The row whose Reject is asking why (Outreach wizard 12/19); null when no picker is open. */
  const [rejecting, setRejecting] = useState<RedditItem | null>(null);

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const reply = await api(ITEMS_PATH);
      if (seq !== requestSeq.current) return;
      setItems(Array.isArray(reply?.data) ? (reply.data as RedditItem[]) : []);
      setError('');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setItems(null);
      setError(`The Reddit comments could not be read: ${errorText(err, 'unknown error')}`);
    }
    // Read after the list, on its own: a status that cannot be read says so
    // on its own line and never hides the comments.
    try {
      const reply = await api(STATUS_PATH);
      if (seq !== requestSeq.current) return;
      setStatus((reply?.data as RedditStatus) || null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setStatus({ account: '', pace: null, browserCheck: null, browserCheckError: errorText(err, 'unknown error') });
    }
    setLoading(false);
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

  // A project switch: drop the old client's rows at once and read the new one's.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      projectEpoch.current += 1;
      setItems(null);
      setStatus(null);
      setError('');
      setNotice('');
      setAddError('');
      setLoading(false);
      setAdding(false);
      setRowBusy({ id: '', what: '' });
      setRowError({ id: '', message: '' });
      // Half-typed words belong to the old client; Add must not file them here.
      setLink('');
      setNeedsPaste(false);
      setPasteTitle('');
      setPasteBody('');
      setPasteComment('');
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  // While the Mini is reading a post, re-read the list so the post appears
  // by itself. Only while the page is shown; stops when nothing is reading.
  const anyReading = (items || []).some((i) => i.readState === 'reading');
  useEffect(() => {
    if (!anyReading) return undefined;
    const timer = window.setInterval(() => {
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    }, READING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyReading, load]);

  const replaceItem = (next: RedditItem) => {
    setItems((list) => (list || []).map((i) => (i.id === next.id ? next : i)));
  };

  const addItem = async (event: React.FormEvent) => {
    event.preventDefault();
    const api = getApi();
    const url = withScheme(link);
    if (!api || !url) return;
    const body: Record<string, string> = { url };
    if (needsPaste) {
      if (pasteTitle.trim()) body.postTitle = pasteTitle.trim();
      if (pasteBody.trim()) body.postBody = pasteBody.trim();
      if (pasteComment.trim()) body.parentCommentText = pasteComment.trim();
    }
    const epoch = projectEpoch.current;
    setAdding(true);
    setAddError('');
    setNotice('');
    try {
      const reply = await api(ITEMS_PATH, { method: 'POST', body: JSON.stringify(body) });
      if (epoch !== projectEpoch.current) return;
      const made = reply?.data as RedditItem;
      setItems((list) => [made, ...(list || [])]);
      setLink('');
      setNeedsPaste(false);
      setPasteTitle('');
      setPasteBody('');
      setPasteComment('');
      setTab('write');
      setNotice(made.readState === 'reading'
        ? 'Added — the Mini is reading the post. It shows here within a couple of minutes.'
        : `Added: ${made.postTitle || made.targetUrl}`);
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      if (errorCode(err) === 'POST_TEXT_NEEDED') setNeedsPaste(true);
      setAddError(errorText(err, 'The link was not added.'));
    } finally {
      if (epoch === projectEpoch.current) setAdding(false);
    }
  };

  /** One row action; the server's refusal is shown on that row, word for word. */
  const runAction = async (item: RedditItem, what: 'draft' | 'approve' | 'reject' | 'paste' | 'read-again', body?: Record<string, unknown>): Promise<boolean> => {
    const api = getApi();
    if (!api) return false;
    const epoch = projectEpoch.current;
    setRowBusy({ id: item.id, what });
    setRowError({ id: '', message: '' });
    setNotice('');
    try {
      const reply = await api(`${ITEMS_PATH}/${encodeURIComponent(item.id)}/${what}`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      });
      if (epoch !== projectEpoch.current) return false;
      const next = reply?.data as RedditItem;
      replaceItem(next);
      if (what === 'draft') {
        setTab('approvals');
        const n = keptOptions(next?.draftOptions).length;
        const written = n ? `${n === 1 ? 'One reply' : `${n} replies`} to choose from` : 'A draft';
        setNotice(item.status === 'draft' ? `${written} — the old ones are replaced.` : `${written} — on Approvals, ready to pick.`);
      } else if (what === 'approve') {
        setNotice(decisionNotice('Approved — waiting for the Mini to post it.', (reply?.data as { feedback?: DecisionFeedback })?.feedback));
      } else if (what === 'paste') {
        setNotice('Saved — the post is in. Click Write with AI on it.');
      } else if (what === 'read-again') {
        setNotice('Asked the Mini to read it again.');
      } else {
        setNotice(rejectNotice('Rejected. It will not be posted.', (reply?.data as { feedback?: DecisionFeedback })?.feedback));
      }
      return true;
    } catch (err) {
      if (epoch !== projectEpoch.current) return false;
      setRowError({ id: item.id, message: errorText(err, 'That did not work, and the server gave no reason.') });
      return false;
    } finally {
      if (epoch === projectEpoch.current) setRowBusy({ id: '', what: '' });
    }
  };

  /** Reject asks why first: the picker is the confirmation, and Cancel rejects nothing (12/19). */
  const reject = (item: RedditItem) => {
    setRowError({ id: '', message: '' });
    setRejecting(item);
  };
  const confirmReject = async (why: RejectReason) => {
    if (!rejecting) return;
    if (await runAction(rejecting, 'reject', why)) setRejecting(null);
  };

  const all = items || [];
  const toWrite = all.filter((i) => tabFor(i.status, i.needsHandCheck) === 'write');
  const approvals = all.filter((i) => tabFor(i.status, i.needsHandCheck) === 'approvals');
  const posted = all.filter((i) => tabFor(i.status, i.needsHandCheck) === 'posted');
  const rejectedCount = all.filter((i) => i.status === 'rejected').length;
  const busyFor = (item: RedditItem) => (rowBusy.id === item.id ? rowBusy.what : '');
  const errorFor = (item: RedditItem) => (rowError.id === item.id ? rowError.message : '');

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      className={`btn${tab === value ? ' btn-primary' : ''}`}
      aria-selected={tab === value}
      onClick={() => { setTab(value); setNotice(''); }}
    >
      {label}
    </button>
  );

  // Nothing was read, so nothing can be said about what is or is not here.
  const unread = items === null;
  const rejectedNote = rejectedCount
    ? `${rejectedCount} rejected ${rejectedCount === 1 ? 'comment is' : 'comments are'} not shown.`
    : '';

  // Only once /status has answered: before that, "never checked" would be a guess.
  const signIn = status ? signInLine(status) : null;
  const pace = paceLine(status);

  return (
    <div ref={hostRef} className="reddit-comments-panel">
      {signIn ? (
        <p
          className={`reddit-comments-signin reddit-comments-signin--${signIn.tone}`}
          data-signin-state={signIn.state}
          role={signIn.tone === 'alarm' ? 'alert' : 'status'}
        >
          {signIn.text}
        </p>
      ) : null}
      {pace ? <p className="reddit-comments-help reddit-comments-pace">{pace}</p> : null}
      <form className="reddit-comments-add" onSubmit={addItem}>
        <label className="reddit-comments-label" htmlFor="rc-link">Paste a Reddit post or comment link</label>
        <div className="reddit-comments-add-row">
          <input
            id="rc-link"
            type="text"
            value={link}
            placeholder="https://www.reddit.com/r/…/comments/…"
            onChange={(e) => setLink(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={adding || !link.trim()}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError ? <p className="reddit-comments-error" role="alert">{addError}</p> : null}
        {needsPaste ? (
          <div className="reddit-comments-paste">
            <p className="reddit-comments-help">Open the link, copy the post into these boxes, then click Add again.</p>
            <label className="reddit-comments-label" htmlFor="rc-paste-title">Post title</label>
            <input id="rc-paste-title" type="text" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} />
            <label className="reddit-comments-label" htmlFor="rc-paste-body">Post text</label>
            <textarea id="rc-paste-body" rows={5} value={pasteBody} onChange={(e) => setPasteBody(e.target.value)} />
            {isCommentLink(link) ? (
              <>
                <label className="reddit-comments-label" htmlFor="rc-paste-comment">The comment you are replying to</label>
                <textarea id="rc-paste-comment" rows={3} value={pasteComment} onChange={(e) => setPasteComment(e.target.value)} />
              </>
            ) : null}
          </div>
        ) : null}
      </form>

      <div className="reddit-comments-toolbar">
        <div className="reddit-comments-tabs" role="tablist" aria-label="Reddit comments">
          {tabButton('write', toWrite.length ? `To write (${toWrite.length})` : 'To write')}
          {tabButton('approvals', approvals.length ? `Approvals (${approvals.length})` : 'Approvals')}
          {tabButton('posted', posted.length ? `Posted (${posted.length})` : 'Posted')}
        </div>
        <button type="button" className="btn" onClick={() => { setNotice(''); void load(); }} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="reddit-comments-error" role="alert">{error}</p> : null}
      {notice ? <p className="reddit-comments-notice" role="status">{notice}</p> : null}

      {tab === 'write' ? (
        <div className="reddit-comments-tabpanel" role="tabpanel" aria-label="To write">
          {unread ? null : toWrite.length ? (
            <ul className="reddit-comments-list">
              {toWrite.map((item) => (item.readState === 'reading' || item.readState === 'failed' ? (
                <ReadingCard
                  key={item.id}
                  item={item}
                  busy={busyFor(item)}
                  error={errorFor(item)}
                  onPaste={(fields) => void runAction(item, 'paste', fields)}
                  onReadAgain={() => void runAction(item, 'read-again')}
                  onReject={() => reject(item)}
                />
              ) : (
                <li key={item.id} className="reddit-comments-card" data-item-id={item.id}>
                  <PostSummary item={item} />
                  {errorFor(item) ? <p className="reddit-comments-error" role="alert">{errorFor(item)}</p> : null}
                  <div className="reddit-comments-actions">
                    <button type="button" className="btn btn-danger" disabled={Boolean(busyFor(item))} onClick={() => reject(item)}>Reject</button>
                    <button type="button" className="btn btn-primary" disabled={Boolean(busyFor(item))} onClick={() => void runAction(item, 'draft')}>
                      {busyFor(item) === 'draft' ? 'Writing… (about 20 seconds)' : 'Write with AI'}
                    </button>
                  </div>
                </li>
              )))}
            </ul>
          ) : (
            <p className="reddit-comments-empty">
              {all.length
                ? 'Nothing waiting to be written — every post added so far has a draft or has been dealt with.'
                : 'No Reddit posts added yet — paste a link above.'}
            </p>
          )}
          {rejectedNote ? <p className="reddit-comments-help">{rejectedNote}</p> : null}
        </div>
      ) : null}

      {tab === 'approvals' ? (
        <div className="reddit-comments-tabpanel" role="tabpanel" aria-label="Approvals">
          {unread ? null : approvals.length ? (
            approvals.map((item) => (item.status === 'draft' ? (
              <DraftCard
                key={`${item.id}:${item.updatedAt}:${item.draftText}`}
                item={item}
                busy={busyFor(item)}
                error={errorFor(item)}
                onApprove={(text, option) => void runAction(item, 'approve', option === undefined ? { text } : { text, option })}
                onReject={() => reject(item)}
                onRedraft={() => void runAction(item, 'draft')}
              />
            ) : (
              <ApprovedCard key={item.id} item={item} busy={busyFor(item)} error={errorFor(item)} onReject={() => reject(item)} />
            )))
          ) : (
            <p className="reddit-comments-empty">
              {toWrite.length
                ? 'No drafts yet — click Write with AI on a post in To write.'
                : 'No drafts yet — paste a Reddit link above, then click Write with AI on it.'}
            </p>
          )}
        </div>
      ) : null}

      {tab === 'posted' ? (
        <div className="reddit-comments-tabpanel" role="tabpanel" aria-label="Posted">
          {unread ? null : posted.length ? (
            <ul className="reddit-comments-list">
              {posted.map((item) => <PostedRow key={item.id} item={item} />)}
            </ul>
          ) : (
            <p className="reddit-comments-empty">
              Nothing posted yet — the Mac Mini posts approved comments, and each one lands here with its link once Reddit shows it.
            </p>
          )}
        </div>
      ) : null}

      {rejecting ? (
        <ReasonPicker
          title="Reject this comment? It will not be posted, and this screen cannot bring it back."
          api={getApi()}
          busy={busyFor(rejecting) === 'reject'}
          error={errorFor(rejecting)}
          onCancel={() => setRejecting(null)}
          onConfirm={(why) => void confirmReject(why)}
        />
      ) : null}
    </div>
  );
}
