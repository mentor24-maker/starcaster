import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReasonPicker, { type RejectReason } from './reason-picker';
import { RowIcon, SortHeader, filterRows, sortRows, type SortState, type SortValue } from './outreach-table';

/**
 * Reddit's Find conversations, inside the wizard — Outreach wizard 18/19
 * (task 86bcrmbwm). The posts the Mini's four-hourly watch kept from the
 * approved subreddits, best first (lib/redditConversations.js), each with its
 * author, its strongest comments and their authors, the subreddit's stated
 * self-promotion rule, and the one sentence on why it ranked there.
 *
 * Since SC-891 it is a sortable table with a filter bar (search, subreddit,
 * keyword, reply), one row per post, built from the same pieces as YouTube's
 * Find creators (outreach-table.tsx). Rank is the server's order — best
 * first, the default — with its reason on hover. A post's expand icon shows
 * its subreddit's self-promotion rule, its text and its strongest comments as
 * indented rows beneath it, each comment with its own icons.
 *
 * Per post: **Write replies** (to the post, or to one of its comments) lines
 * up the comment from what the Mini already read and writes its three
 * options, then brings Write replies below into view, where the chooser is
 * (SC-916: it no longer leaves the Outreach screen);
 * **Skip** asks why with the shared reason picker; **Save as contact** keeps
 * a commenter (or the post's author) as a lead.
 *
 * **Read now** (SC-883) asks the Mini to read this project's subreddits on
 * its next ten-minute check — only its signed-in browser can read Reddit, so
 * the button leaves a request rather than reading. While a fresh request
 * waits the button says so and holds itself, and the list reloads every
 * minute (and when the window comes back into focus) so a finished read
 * shows. A request the Mini has not picked up in 20 minutes says so plainly —
 * its check may not be running — and a press then asks again; so does a
 * press after the Mini reported it could not start the read.
 *
 * Signed out or a read that did not come back is "Cannot tell" in the stage's
 * sentence above — never "0 found" — so this list draws no headline of its own.
 */

export const REDDIT_CONVERSATIONS_PATH = '/api/outreach/reddit/conversations';

/** `replyItemId` / `replyStatus`: the reply to THIS comment, kept apart from the post's own. */
export type RedditComment = { id: string; author: string; body: string; score: number; replyItemId?: string; replyStatus?: string };

/** The comment's reply button: a draft is reopened, a reply already sent is not written again. */
export function commentReplyLabel(m: RedditComment): string {
  if (m.replyStatus === 'draft') return 'Open the replies';
  if (m.replyStatus && m.replyStatus !== 'idea') return 'Replied';
  return 'Reply to this comment';
}

export type RedditConversation = {
  postId: string;
  subreddit: string;
  url: string;
  title: string;
  body: string;
  author: string;
  postedAt: string;
  /** The ranker's 0-100 score (the Rank column orders by it); not Reddit's points. */
  score: number;
  /** Reddit's own points for the post: the Score column (SC-891). */
  redditScore?: number;
  numComments: number;
  keyword: string;
  topComments: RedditComment[];
  commentsReadAt: string | null;
  promotionRule: string;
  replyItemId: string;
  replyStatus: string;
  reason: string;
};

export type RedditConversationsReply = {
  items: RedditConversation[];
  newCount: number;
  reading: { state: string; sentence: string };
  /** Read now's request still waiting for the Mini, if any (SC-883). */
  readRequest?: {
    ok: boolean;
    /** When the waiting request was made; null when nothing waits. */
    requestedAt: string | null;
    /** Waiting so long that the Mini plainly has not picked it up. */
    stale?: boolean;
    /** The Mini tried and could not start the read: why. '' otherwise. */
    failedWhy?: string;
    failedAt?: string | null;
    error?: string;
  };
  canon?: { ok: boolean; words?: number; error?: string };
};

/** "just now", "4 minutes ago", "2 hours ago"; '' if the time cannot be read. */
export function agoText(iso: string | null | undefined, now: number): string {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return '';
  const min = Math.max(0, Math.round((now - at) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

/** Is a request waiting that a press should leave alone? (Fresh, not stale, not failed.) */
export function readRequestHolds(r: RedditConversationsReply['readRequest']): boolean {
  return Boolean(r && r.ok && r.requestedAt && !r.stale);
}

/** What Read now's area says, from the list's request state. '' when nothing is waiting. */
export function readRequestNote(r: RedditConversationsReply['readRequest'], now: number = Date.now()): string {
  if (!r) return '';
  if (!r.ok) return `Cannot tell whether a read is already waiting: ${r.error || 'it could not be read'}`;
  if (r.failedWhy) {
    const when = agoText(r.failedAt, now);
    return `The Mini tried to read${when ? ` ${when}` : ''} and could not start: ${r.failedWhy} Press Read now to ask again.`;
  }
  if (!r.requestedAt) return '';
  const when = agoText(r.requestedAt, now);
  if (r.stale) {
    return `Asked the Mini to read${when ? ` ${when}` : ''}, and it has not picked this up. Its Read now check may not be running `
      + '(on the Mini: scripts/install_reddit_watch.sh --status). Press Read now to ask again.';
  }
  return `Asked the Mini to read${when ? ` ${when}` : ''}. It picks this up within about 10 minutes.`;
}

/** How often the list reloads while a request waits, so a finished read shows. */
export const READ_REQUEST_POLL_MS = 60 * 1000;

type ApiFn = (path: string, options?: RequestInit) => Promise<Record<string, any>>;
type AppShape = { api?: ApiFn };

function getApp(): AppShape | null {
  return (window as unknown as { App?: AppShape }).App || null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function excerpt(text: string, max = 280): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 3)}…` : t;
}

/** The comments line when none are shown: read and empty, or not read yet. */
export function commentsNote(c: RedditConversation): string {
  if (c.topComments.length) return '';
  if (c.commentsReadAt) return 'No comments yet — you would be first.';
  return `${c.numComments} comment${c.numComments === 1 ? '' : 's'}; not read yet (the Mini reads the comments on the best few posts each pass).`;
}


/** "3h ago" inside a day, "Nov 18" this year, "Nov 18, 2025" before it — dates in Mountain time. */
export function postedText(postedAt: string, now = Date.now()): string {
  const at = Date.parse(postedAt || '');
  if (!Number.isFinite(at)) return 'unknown';
  const hours = Math.floor((now - at) / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const year = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric' }).format(new Date(ms));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', ...(year(at) === year(now) ? {} : { year: 'numeric' }),
  }).format(new Date(at));
}

/** A reply written and on its way out; 'idea' (lined up, nothing written yet) is not one. */
const WAITING_REPLY = new Set(['draft', 'approved', 'posting']);

/** The Reply column's word for a post's (or a comment's) replyStatus. */
export function replyWord(replyStatus: string): string {
  if (!replyStatus || replyStatus === 'idea') return 'none';
  if (WAITING_REPLY.has(replyStatus)) return `${replyStatus === 'draft' ? 'draft' : replyStatus} — waiting`;
  return replyStatus;
}

/** Reddit's points for a post, or null when the server did not send them (unknown, never 0). */
export function redditPoints(c: RedditConversation): number | null {
  return typeof c.redditScore === 'number' && Number.isFinite(c.redditScore) ? c.redditScore : null;
}

export type RedditSortKey = 'posted' | 'score' | 'comments' | 'rank' | 'subreddit';
export type ReplyFilter = 'not_replied' | 'waiting' | 'all';
export type RedditFilters = { search: string; subreddit: string; keyword: string; reply: ReplyFilter };

export const DEFAULT_REDDIT_FILTERS: RedditFilters = { search: '', subreddit: '', keyword: '', reply: 'all' };
/** Best rank first: the server's own order, which is what the list opened on before it was a table. */
export const DEFAULT_REDDIT_SORT: SortState<RedditSortKey> = { key: 'rank', dir: 'asc' };

/** A post with the place the server ranked it (1 = best). */
export type RankedPost = { post: RedditConversation; rank: number };

export function rankPosts(items: RedditConversation[]): RankedPost[] {
  return items.map((post, i) => ({ post, rank: i + 1 }));
}

export function redditSortValue(r: RankedPost, key: RedditSortKey): SortValue {
  if (key === 'rank') return r.rank;
  if (key === 'score') return redditPoints(r.post);
  if (key === 'comments') return r.post.numComments;
  if (key === 'subreddit') return r.post.subreddit || null;
  const at = Date.parse(r.post.postedAt || '');
  return Number.isFinite(at) ? at : null;
}

/** The choices a select offers: each value once, ignoring case, in A-to-Z order. */
export function distinctOptions(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw || '').trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** The rows the filter bar lets through; every filter must pass (AND). */
export function filterPosts(rows: RankedPost[], f: RedditFilters): RankedPost[] {
  const needle = f.search.trim().toLowerCase();
  const sub = f.subreddit.trim().toLowerCase();
  const keyword = f.keyword.trim().toLowerCase();
  return filterRows(rows, [
    needle ? (r) => `${r.post.title}\n${r.post.body}`.toLowerCase().includes(needle) : null,
    sub ? (r) => r.post.subreddit.toLowerCase() === sub : null,
    keyword ? (r) => r.post.keyword.toLowerCase() === keyword : null,
    f.reply === 'all' ? null : (r) => {
      const waiting = WAITING_REPLY.has(r.post.replyStatus);
      return f.reply === 'waiting' ? waiting : !waiting && replyWord(r.post.replyStatus) === 'none';
    },
  ]);
}

/**
 * Why the table is empty, naming every filter in force and how many posts
 * they hid — "No posts in r/polymath match 'yoga' with a reply waiting (4
 * listed, all hidden by these filters)." — so an empty table never reads as a
 * broken one (landmine 17).
 */
export function emptyPostsText(f: RedditFilters, listed: number): string {
  const conditions: string[] = [];
  if (f.search.trim()) conditions.push(`match '${f.search.trim()}'`);
  if (f.keyword) conditions.push(`were found by the keyword '${f.keyword}'`);
  const reply = f.reply === 'not_replied' ? ' without a reply' : f.reply === 'waiting' ? ' with a reply waiting' : '';
  const where = f.subreddit ? ` in r/${f.subreddit}` : '';
  const what = `No posts${where}${conditions.length ? ` ${conditions.join(' and ')}` : ''}${reply}`;
  return `${what} (${listed} listed, all hidden by these filters).`;
}

const COLUMNS = 10;

type Props = {
  onChanged?: () => void;
  /** A reply was written (or found already drafted): show Write replies, on this screen. */
  onDrafted?: () => void;
  version?: string;
};

export default function RedditConversations({ onChanged, onDrafted, version }: Props = {}): React.ReactElement {
  const [data, setData] = useState<RedditConversationsReply | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<{ postId: string; action: string } | null>(null);
  /** `key` is the row the message belongs under: the post id, or `<post>:<comment>`. */
  const [rowError, setRowError] = useState<{ postId: string; key: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [skipping, setSkipping] = useState<RedditConversation | null>(null);
  const [filters, setFilters] = useState<RedditFilters>(DEFAULT_REDDIT_FILTERS);
  const [sort, setSort] = useState<SortState<RedditSortKey>>(DEFAULT_REDDIT_SORT);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      const reply = await api(REDDIT_CONVERSATIONS_PATH);
      if (mine !== seq.current) return;
      setData((reply?.data as RedditConversationsReply) || null);
      setError('');
    } catch (err) {
      if (mine !== seq.current) return;
      setData(null);
      setError(`Cannot tell what there is to reply to: ${errorText(err, 'the list could not be read')}`);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, version]);

  // While a request waits, reload every minute and on focus: the Mini clears
  // it when its read finishes, and a list that never looks again would hold
  // the button and its promise for good.
  const waitingFor = data?.readRequest?.ok && data.readRequest.requestedAt ? data.readRequest.requestedAt : '';
  useEffect(() => {
    if (!waitingFor) return undefined;
    const timer = window.setInterval(() => { void load(); }, READ_REQUEST_POLL_MS);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [waitingFor, load]);

  const post = async (path: string, body: unknown) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') throw new Error('the admin app is still loading');
    return api(path, { method: 'POST', body: JSON.stringify(body) });
  };

  const readNow = async () => {
    if (asking || readRequestHolds(data?.readRequest)) return;
    setAsking(true);
    setAskError('');
    try {
      await post(`${REDDIT_CONVERSATIONS_PATH}/read-now`, {});
      await load();
    } catch (err) {
      setAskError(`Not asked: ${errorText(err, 'unknown error')}`);
    } finally {
      setAsking(false);
    }
  };

  const rowKey = (c: RedditConversation, comment?: RedditComment) => (comment ? `${c.postId}:${comment.id}` : c.postId);

  const writeReplies = async (c: RedditConversation, comment?: RedditComment) => {
    setBusy({ postId: c.postId, action: comment ? `reply:${comment.id}` : 'reply' });
    setRowError(null);
    try {
      const reply = await post(`${REDDIT_CONVERSATIONS_PATH}/reply`, { postId: c.postId, ...(comment ? { commentId: comment.id } : {}) });
      setNotice(reply?.data?.drafted === false
        ? 'Already drafted — it is waiting in Write replies below.'
        : `Replies written ${comment ? `to u/${comment.author}'s comment` : 'to the post'} — choose one in Write replies below.`);
      onChanged?.();
      onDrafted?.();
    } catch (err) {
      setRowError({ postId: c.postId, key: rowKey(c, comment), message: `No replies written: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const saveContact = async (c: RedditConversation, author: string, comment?: RedditComment) => {
    setBusy({ postId: c.postId, action: `contact:${author}` });
    setRowError(null);
    try {
      const reply = await post(`${REDDIT_CONVERSATIONS_PATH}/contact`, { postId: c.postId, author });
      setNotice(reply?.data?.created === false ? `u/${author} is already a contact.` : `u/${author} saved as a contact.`);
    } catch (err) {
      setRowError({ postId: c.postId, key: rowKey(c, comment), message: `u/${author} was not saved: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const confirmSkip = async (why: RejectReason) => {
    const c = skipping;
    if (!c) return;
    setBusy({ postId: c.postId, action: 'skip' });
    setRowError(null);
    try {
      await post(`${REDDIT_CONVERSATIONS_PATH}/skip`, { postId: c.postId, reasons: why.reasons, note: why.note });
      setSkipping(null);
      setNotice(`Skipped "${excerpt(c.title, 60)}"${why.reasons.length ? ` (${why.reasons.join(', ')})` : ''}.`);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.postId !== c.postId), newCount: Math.max(0, d.newCount - 1) } : d));
      onChanged?.();
    } catch (err) {
      setRowError({ postId: c.postId, key: 'skip', message: `Not skipped: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const toggle = (postId: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(postId)) next.delete(postId); else next.add(postId);
    return next;
  });

  if (error) return <p className="outreach-wizard-error" role="alert">{error}</p>;
  if (!data) return <p className="outreach-wizard-muted">{loading ? 'Reading the posts found so far…' : ''}</p>;

  const ranked = rankPosts(data.items);
  const subredditOptions = distinctOptions(data.items.map((i) => i.subreddit));
  const keywordOptions = distinctOptions(data.items.map((i) => i.keyword));
  const rows = sortRows(filterPosts(ranked, filters), sort, redditSortValue);

  const messageRow = (key: string) => (rowError?.key === key ? (
    <tr key={`${key}:message`} className="reddit-conversation-note-row" data-row-message>
      <td colSpan={COLUMNS}><p className="outreach-wizard-error" role="alert">{rowError.message}</p></td>
    </tr>
  ) : null);

  const renderPost = ({ post: c, rank }: RankedPost): React.ReactNode[] => {
    const title = excerpt(c.title, 60);
    const isOpen = open.has(c.postId);
    const anyBusy = Boolean(busy);
    const out: React.ReactNode[] = [
      <tr key={c.postId} className="reddit-conversation-row" data-post-id={c.postId} data-score={c.score} data-open={isOpen ? 'true' : 'false'}>
        <td className="reddit-conversation-post"><a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a></td>
        <td className="reddit-conversation-sub">{c.subreddit ? `r/${c.subreddit}` : ''}</td>
        <td className="reddit-conversation-author">{c.author ? `u/${c.author}` : <span className="outreach-wizard-muted">unknown</span>}</td>
        <td className="reddit-conversation-posted" title={c.postedAt || undefined}>{postedText(c.postedAt)}</td>
        <td className="reddit-conversation-num" data-col="score">{redditPoints(c) === null ? <span className="outreach-wizard-muted">unknown</span> : redditPoints(c)!.toLocaleString('en-US')}</td>
        <td className="reddit-conversation-num" data-col="comments">{c.numComments.toLocaleString('en-US')}</td>
        <td className="reddit-conversation-keyword">{c.keyword}</td>
        <td className="reddit-conversation-num reddit-conversation-rank" title={c.reason || undefined} data-col="rank">{`#${rank}`}</td>
        <td className="reddit-conversation-reply" data-reply={c.replyStatus || 'none'}>{replyWord(c.replyStatus)}</td>
        <td className="actions-col">
          <div className="table-actions-row">
            <RowIcon glyph={isOpen ? 'collapse' : 'expand'} expanded={isOpen} label={`${isOpen ? 'Hide' : 'Show'} the Comments on "${title}"`} onClick={() => toggle(c.postId)} />
            <RowIcon glyph="write" tone="primary" label={`${c.replyStatus === 'draft' ? 'Open the Replies to' : 'Write Replies to'} "${title}"`} disabled={anyBusy} onClick={() => void writeReplies(c)} />
            <RowIcon glyph="skip" label={`Skip "${title}"`} disabled={anyBusy} onClick={() => { setRowError(null); setSkipping(c); }} />
            {c.author ? <RowIcon glyph="contact" label={`Save ${c.author} as a Contact`} disabled={anyBusy} onClick={() => void saveContact(c, c.author)} /> : null}
            {c.url ? <RowIcon glyph="open" label={`Open "${title}" on Reddit`} href={c.url} /> : null}
          </div>
        </td>
      </tr>,
    ];
    const postMessage = messageRow(c.postId);
    if (postMessage) out.push(postMessage);
    if (!isOpen) return out;
    if (c.promotionRule || c.body) {
      out.push(
        <tr key={`${c.postId}:about`} className="reddit-conversation-note-row reddit-conversation-about">
          <td colSpan={COLUMNS}>
            {c.promotionRule ? <p className="reddit-sub-rule" data-promotion-rule><strong>{`r/${c.subreddit}'s self-promotion rule:`}</strong> {c.promotionRule}</p> : null}
            {c.body ? <p className="outreach-conversation-text">{excerpt(c.body)}</p> : null}
          </td>
        </tr>,
      );
    }
    if (!c.topComments.length) {
      out.push(
        <tr key={`${c.postId}:none`} className="reddit-conversation-note-row"><td colSpan={COLUMNS} className="outreach-wizard-muted" data-comments-note>{commentsNote(c)}</td></tr>,
      );
      return out;
    }
    for (const m of c.topComments.slice(0, 3)) {
      const label = commentReplyLabel(m);
      const replied = label === 'Replied';
      out.push(
        <tr key={`${c.postId}:${m.id}`} className="reddit-comment-row" data-comment-id={m.id}>
          <td colSpan={2} className="reddit-comment-text" title={m.body.length > 220 ? m.body : undefined}>{excerpt(m.body, 220)}</td>
          <td className="reddit-conversation-author">{`u/${m.author}`}</td>
          <td />
          <td className="reddit-conversation-num" data-col="score">{m.score.toLocaleString('en-US')}</td>
          <td colSpan={3} />
          <td className="reddit-conversation-reply" data-reply={m.replyStatus || 'none'}>{replyWord(m.replyStatus || '')}</td>
          <td className="actions-col">
            <div className="table-actions-row">
              <RowIcon
                glyph="write"
                label={replied ? `Replied to ${m.author}'s Comment` : `${label === 'Open the replies' ? 'Open the Replies' : 'Reply'} to ${m.author}'s Comment`}
                disabled={Boolean(busy) || replied}
                onClick={() => void writeReplies(c, m)}
              />
              <RowIcon glyph="contact" label={`Save ${m.author} as a Contact`} disabled={Boolean(busy)} onClick={() => void saveContact(c, m.author, m)} />
            </div>
          </td>
        </tr>,
      );
      const commentMessage = messageRow(`${c.postId}:${m.id}`);
      if (commentMessage) out.push(commentMessage);
    }
    return out;
  };

  return (
    <div className="outreach-conversations" data-reading={data.reading.state}>
      {data.reading.state !== 'no_subreddits' ? (
        <div className="outreach-wizard-stage-actions">
          <button
            type="button"
            className="btn"
            disabled={asking || readRequestHolds(data.readRequest)}
            aria-busy={asking}
            onClick={() => void readNow()}
          >
            {readRequestHolds(data.readRequest) ? 'Read asked for' : (asking ? 'Asking…' : 'Read now')}
          </button>
        </div>
      ) : null}
      {readRequestNote(data.readRequest) ? <p className="outreach-wizard-muted" role="status">{readRequestNote(data.readRequest)}</p> : null}
      {askError ? <p className="outreach-wizard-error" role="alert">{askError}</p> : null}
      {data.canon && !data.canon.ok ? (
        <p className="outreach-wizard-muted">{`Ranked without your canon, so no post scores for fitting it: ${data.canon.error}`}</p>
      ) : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {data.items.length ? (
        <div className="table-wrap reddit-conversations-table-wrap">
          <table className="reddit-conversations-table">
            {/* Fixed column widths (src/css/_outreach-wizard.css), the same
                way Find creators keeps its Actions icons in the card at 1280. */}
            <colgroup>
              <col className="reddit-conversations-col-post" />
              <col className="reddit-conversations-col-sub" />
              <col className="reddit-conversations-col-author" />
              <col className="reddit-conversations-col-posted" />
              <col className="reddit-conversations-col-num" />
              <col className="reddit-conversations-col-comments" />
              <col className="reddit-conversations-col-keyword" />
              <col className="reddit-conversations-col-num" />
              <col className="reddit-conversations-col-reply" />
              <col className="reddit-conversations-col-actions" />
            </colgroup>
            <thead>
              <tr className="table-filter-row">
                <th>
                  <input type="search" placeholder="Title or text" aria-label="Search post titles and text" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </th>
                <th>
                  <select aria-label="Subreddit" value={filters.subreddit} onChange={(e) => setFilters({ ...filters, subreddit: e.target.value })}>
                    <option value="">Any</option>
                    {subredditOptions.map((s) => <option key={s} value={s}>{`r/${s}`}</option>)}
                  </select>
                </th>
                <th />
                <th />
                <th />
                <th />
                <th>
                  <select aria-label="Keyword" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}>
                    <option value="">Any</option>
                    {keywordOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </th>
                <th />
                <th>
                  <select aria-label="Reply" value={filters.reply} onChange={(e) => setFilters({ ...filters, reply: e.target.value as ReplyFilter })}>
                    <option value="all">All</option>
                    <option value="not_replied">Not replied</option>
                    <option value="waiting">Waiting</option>
                  </select>
                </th>
                <th className="actions-col" />
              </tr>
              <tr>
                <th scope="col">Post</th>
                <SortHeader label="Subreddit" sortKey="subreddit" sort={sort} onSort={setSort} />
                <th scope="col">Author</th>
                <SortHeader label="Posted" sortKey="posted" sort={sort} onSort={setSort} firstDir="desc" />
                <SortHeader label="Score" sortKey="score" sort={sort} onSort={setSort} firstDir="desc" />
                <SortHeader label="Comments" sortKey="comments" sort={sort} onSort={setSort} firstDir="desc" />
                <th scope="col">Keyword</th>
                <SortHeader label="Rank" sortKey="rank" sort={sort} onSort={setSort} />
                <th scope="col">Reply</th>
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.flatMap(renderPost) : (
                <tr className="reddit-conversations-empty-row"><td colSpan={COLUMNS} data-empty-filter>{emptyPostsText(filters, data.items.length)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {skipping ? (
        <ReasonPicker
          title={`Skip "${excerpt(skipping.title, 60)}"? It leaves this list.`}
          api={getApp()?.api}
          busy={busy?.postId === skipping.postId && busy?.action === 'skip'}
          error={rowError?.postId === skipping.postId && rowError.key === 'skip' ? rowError.message : ''}
          onCancel={() => setSkipping(null)}
          onConfirm={(why) => void confirmSkip(why)}
        />
      ) : null}
    </div>
  );
}
