import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReasonPicker, { type RejectReason } from './reason-picker';
import { RowIcon, SortHeader, filterRows, sortRows, type SortState, type SortValue } from './outreach-table';

/**
 * YouTube's Find conversations, inside the wizard — Outreach wizard 16/19
 * (task 86bcrmbtn). The newest videos of the channels Dane approved, each with
 * its comments best first, who wrote each and the one sentence on why it ranked
 * there (lib/outreachRanking.js). The scheduled read refreshes them every
 * three hours (lib/acquire/YoutubeCommentsReadDue.js).
 *
 * Per comment: **Write replies** puts the video on the YouTube outreach list
 * with this comment's id filled in — no more typing ids by hand — writes its
 * three options and opens the YouTube outreach screen where the chooser is;
 * **Skip** asks why with the shared reason picker and takes it off the list;
 * **Save as contact** adds the commenter to Contacts. Per video: **Comment on
 * the video** does the same as Write replies for a top-level comment.
 *
 * Since SC-888 it is a sortable table with a filter bar (search, channel,
 * video, reply), one row per comment best first, every action a square
 * RowIcon from outreach-table.tsx (shared with Find creators). The rank's
 * one-sentence reason is the Rank cell's hover; a long comment is cut between
 * words with the whole text on hover.
 *
 * A video can carry one reply at a time (one outreach target per video), so a
 * video whose reply is already waiting says so and holds its other buttons
 * until that one is finished or rejected.
 *
 * **Read now** (SC-880) reads this project's approved channels straight away,
 * with the scheduled read's own code, instead of waiting up to three hours for
 * it. It holds itself while the read runs, then reloads the list and says what
 * came back.
 *
 * The count above the list is the stage's sentence, which the wizard reads from
 * the overview, so every change calls `onChanged` and the wizard hands the new
 * overview's time back as `version` — the same contract as the Substack list.
 */

export const YT_CONVERSATIONS_PATH = '/api/outreach/youtube/conversations';
const YOUTUBE_PAGE = 'engageYoutubeOutreachPage';

export type YtComment = {
  commentId: string;
  videoId: string;
  url: string;
  text: string;
  postedAt: string;
  likes: number;
  replies: number;
  score: number;
  reason: string;
  replyStatus: string;
  author: { name: string; channelUrl: string; channelId: string };
};

export type YtVideo = {
  videoId: string;
  videoUrl: string;
  title: string;
  publishedAt: string;
  commentsDisabled: boolean;
  channel: { id: string; channelId: string; name: string; url: string };
  targetId: string;
  state: 'open' | 'waiting' | 'paused';
  blocked: string;
  waitingOn: string;
  replyStatus: string;
  comments: YtComment[];
};

export type YtConversationsReply = {
  videos: YtVideo[];
  newCount: number;
  reading: { state: 'current' | 'not_read_yet' | 'cannot_tell' | 'no_creators'; sentence: string };
  canon?: { ok: boolean; words?: number; error?: string };
  skippedCount: number;
  commentedCount: number;
};

type ApiFn = (path: string, options?: RequestInit) => Promise<Record<string, any>>;
type AppShape = { api?: ApiFn; setActivePage?: (pageId: string) => void };

function getApp(): AppShape | null {
  return (window as unknown as { App?: AppShape }).App || null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Can this button act? A waiting video lets only the reply it is waiting on be opened. */
export function canAct(video: YtVideo, pointer: string): boolean {
  if (video.state === 'open') return true;
  return video.state === 'waiting' && video.waitingOn === pointer;
}

/** What the reply button says: a draft already waiting is opened, not written twice. */
export function replyLabel(replyStatus: string, forVideo = false): string {
  if (replyStatus === 'draft') return 'Open the replies';
  return forVideo ? 'Comment on the video' : 'Write replies';
}

/** What to say once a reply call answers; `drafted: false` means nothing new was written. */
export function replyNotice(who: string, reply: Record<string, any> | null | undefined): string {
  if (reply?.data?.drafted === false) return `Already drafted — open the reply ${who} on the YouTube outreach screen.`;
  return `Three replies written ${who} — choose one on the YouTube outreach screen.`;
}

export type ReadNowReport = {
  channels: number;
  read: number;
  comments: number;
  failed: Array<{ channel?: string; error: string }>;
  notReached: Array<{ channel?: string; reason: string }>;
  quota: { resetsAt: string } | null;
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Nov 19, 1:00am" in Mountain time — Dane's clock. */
function mountain(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(at)).replace(/\s?([AP])M$/i, (_, m: string) => `${m.toLowerCase()}m`);
}

/** The one line Read now leaves behind: what was read, and each failure by channel name. */
export function readNowNotice(r: ReadNowReport | null | undefined): string {
  if (!r) return 'The read finished but did not say what it read. Reload the list to see.';
  const failed = r.failed || [];
  // A list that could not be read leaves channels at 0 with the reason in
  // `failed`: say the failure, never "no approved channels" over it.
  if (!r.channels && !failed.length) return 'There are no approved channels to read. Approve channels in Find creators first.';
  const bits = [`Read ${plural(r.read, 'channel')}: ${plural(r.comments, 'comment')}.`];
  for (const f of failed) bits.push(`${f.channel || 'The channel list'} was not read: ${f.error}`);
  // The channel whose read hit the quota lands in neither `failed` nor
  // `notReached`, so count what is left over rather than either list.
  const unread = Math.max(0, (r.channels || 0) - (r.read || 0) - failed.length);
  if (r.quota) bits.push(`YouTube's quota is used up until ${mountain(r.quota.resetsAt)}, so ${plural(unread, 'channel')} could not be read.`);
  else if ((r.notReached || []).length) bits.push(`${plural(r.notReached.length, 'channel')} ran out of time and will be read next time.`);
  return bits.join(' ');
}

/**
 * The comment cut to at most `max` characters BETWEEN WORDS, never through
 * one (docs/UI_RULES.md L4, T7 rung 10): whole words are dropped from the end
 * until it fits, and an ellipsis says something was dropped. The full text
 * stays on the cell's hover (T2). A single word longer than `max` is the one
 * case with no boundary to cut at, so it is kept whole and wraps.
 */
export function cutBetweenWords(text: string, max = 160): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const words = t.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max - 1) break;
    out = next;
  }
  if (!out) return words[0];
  return `${out.replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** "Nov 18" in Mountain time; a date from another year carries the year. */
export function postedText(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const year = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric' }).format(new Date(ms));
  const sameYear = year(at) === year(now);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  }).format(new Date(at));
}

/** The Reply column's word for a comment's (or a video's) replyStatus. */
export function replyWord(replyStatus: string): string {
  if (!replyStatus || replyStatus === 'lined_up') return 'none';
  return replyStatus;
}

/** A reply written and on its way out. 'lined_up' (the video points here, nothing written yet) is not one. */
const WAITING_REPLY = new Set(['draft', 'approved', 'posting']);

/**
 * One table row: a comment with the video it is under, or — for a video with
 * no comments to list — the video alone, so Comment on the video stays
 * reachable for it.
 */
export type ConversationRow = { key: string; video: YtVideo; comment: YtComment | null };

/** Every video's comments as one flat list of rows, in the order the server ranked them. */
export function conversationRows(videos: YtVideo[]): ConversationRow[] {
  const rows: ConversationRow[] = [];
  for (const v of videos) {
    if (v.comments.length) for (const c of v.comments) rows.push({ key: c.commentId, video: v, comment: c });
    else rows.push({ key: `video:${v.videoId}`, video: v, comment: null });
  }
  return rows;
}

export type ConversationSortKey = 'posted' | 'likes' | 'rank' | 'video';
export type ReplyFilter = 'not_replied' | 'waiting' | 'all';
export type ConversationFilters = { search: string; channel: string; video: string; reply: ReplyFilter };

export const DEFAULT_CONVERSATION_FILTERS: ConversationFilters = { search: '', channel: '', video: '', reply: 'all' };
/** Best rank first (the order the server meant). */
export const DEFAULT_CONVERSATION_SORT: SortState<ConversationSortKey> = { key: 'rank', dir: 'desc' };

/** A video-only row has no comment, so Posted, Likes and Rank are unknown and sort last. */
export function conversationSortValue(row: ConversationRow, key: ConversationSortKey): SortValue {
  const c = row.comment;
  if (key === 'video') return row.video.title || row.video.videoId;
  if (!c) return null;
  if (key === 'likes') return Number.isFinite(c.likes) ? c.likes : null;
  if (key === 'rank') return Number.isFinite(c.score) ? c.score : null;
  const at = Date.parse(c.postedAt);
  return Number.isFinite(at) ? at : null;
}

function rowReplyStatus(row: ConversationRow): string {
  return row.comment ? row.comment.replyStatus : row.video.replyStatus;
}

/** The rows the filter bar lets through; every filter must pass (AND). */
export function filterConversations(rows: ConversationRow[], f: ConversationFilters): ConversationRow[] {
  const needle = f.search.trim().toLowerCase();
  return filterRows(rows, [
    needle ? (r) => Boolean(r.comment) && `${r.comment!.text} ${r.comment!.author.name}`.toLowerCase().includes(needle) : null,
    f.channel ? (r) => r.video.channel.id === f.channel : null,
    f.video ? (r) => r.video.videoId === f.video : null,
    f.reply === 'all' ? null : (r) => {
      const status = rowReplyStatus(r);
      const waiting = WAITING_REPLY.has(status);
      const replied = waiting || status === 'posted';
      return f.reply === 'waiting' ? waiting : !replied;
    },
  ]);
}

/**
 * Why the filtered table is empty, naming every filter in force — "No comments
 * match 'tennis' on 'A video' with a reply waiting." — so an empty table never
 * reads as a broken one (landmine 17).
 */
export function emptyConversationsText(f: ConversationFilters, videos: YtVideo[]): string {
  const parts: string[] = [];
  if (f.search.trim()) parts.push(`match '${f.search.trim()}'`);
  const video = f.video ? videos.find((v) => v.videoId === f.video) : null;
  if (video) parts.push(`on '${video.title || video.videoId}'`);
  else if (f.channel) {
    const ch = videos.find((v) => v.channel.id === f.channel)?.channel;
    parts.push(`on ${ch ? `${ch.name}'s videos` : 'that channel\'s videos'}`);
  }
  if (f.reply === 'not_replied') parts.push('without a reply waiting or posted');
  else if (f.reply === 'waiting') parts.push('with a reply waiting');
  return `No comments${parts.length ? ` ${parts.join(' ')}` : ''}.`;
}

type Props = {
  /** Something on the list changed: re-read the stage sentence above it. */
  onChanged?: () => void;
  /** The overview's time; a new one re-reads the list in place. */
  version?: string;
};

type Busy = { key: string; action: string } | null;

export default function YoutubeConversations({ onChanged, version }: Props = {}): React.ReactElement {
  const [data, setData] = useState<YtConversationsReply | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [skipping, setSkipping] = useState<YtComment | null>(null);
  const [readingNow, setReadingNow] = useState(false);
  const [readError, setReadError] = useState('');
  const [filters, setFilters] = useState<ConversationFilters>(DEFAULT_CONVERSATION_FILTERS);
  const [sort, setSort] = useState<SortState<ConversationSortKey>>(DEFAULT_CONVERSATION_SORT);
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
      const reply = await api(YT_CONVERSATIONS_PATH);
      if (mine !== seq.current) return;
      setData((reply?.data as YtConversationsReply) || null);
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

  const post = async (verb: string, body: unknown) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') throw new Error('the admin app is still loading');
    return api(`${YT_CONVERSATIONS_PATH}/${verb}`, { method: 'POST', body: JSON.stringify(body) });
  };

  const readNow = async () => {
    if (readingNow) return;
    setReadingNow(true);
    setReadError('');
    setNotice('');
    try {
      const reply = await post('read-now', {});
      setNotice(readNowNotice(reply?.data as ReadNowReport));
      await load();
      onChanged?.();
    } catch (err) {
      setReadError(`Not read: ${errorText(err, 'unknown error')}`);
    } finally {
      setReadingNow(false);
    }
  };

  /** `key` is the ROW clicked, so its busy state and any failure show on that row. */
  const write = async (key: string, verb: 'reply' | 'video', body: Record<string, string>, who: string) => {
    setBusy({ key, action: verb });
    setRowError(null);
    try {
      const reply = await post(verb, body);
      setNotice(replyNotice(who, reply));
      const app = getApp();
      if (typeof app?.setActivePage === 'function') app.setActivePage(YOUTUBE_PAGE);
      onChanged?.();
    } catch (err) {
      setRowError({ key, message: `No replies written: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const saveContact = async (c: YtComment) => {
    setBusy({ key: c.commentId, action: 'contact' });
    setRowError(null);
    try {
      const reply = await post('contact', { commentId: c.commentId });
      setNotice(reply?.data?.mode === 'existing'
        ? `${c.author.name} is already in your contacts.`
        : `${c.author.name} is saved to your contacts (source: YouTube outreach).`);
    } catch (err) {
      setRowError({ key: c.commentId, message: `${c.author.name} was not saved: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const confirmSkip = async (why: RejectReason) => {
    const c = skipping;
    if (!c) return;
    setBusy({ key: c.commentId, action: 'skip' });
    setRowError(null);
    try {
      await post('skip', { commentId: c.commentId, reasons: why.reasons, note: why.note });
      setSkipping(null);
      setNotice(`Skipped ${c.author.name}'s comment${why.reasons.length ? ` (${why.reasons.join(', ')})` : ''}.`);
      setData((d) => (d ? {
        ...d,
        newCount: Math.max(0, d.newCount - 1),
        videos: d.videos.map((v) => (v.videoId === c.videoId ? { ...v, comments: v.comments.filter((x) => x.commentId !== c.commentId) } : v)),
      } : d));
      onChanged?.();
    } catch (err) {
      setRowError({ key: c.commentId, message: `Not skipped: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="outreach-wizard-error" role="alert">{error}</p>;
  if (!data) return <p className="outreach-wizard-muted">{loading ? 'Reading the comments found so far…' : ''}</p>;

  const allRows = conversationRows(data.videos);
  const channels = [...new Map(data.videos.map((v) => [v.channel.id, v.channel])).values()];
  // A filter whose choice has left the list (a video aged out on a re-read)
  // would show "Any" while still hiding rows, so it counts as cleared.
  const live: ConversationFilters = {
    ...filters,
    channel: channels.some((c) => c.id === filters.channel) ? filters.channel : '',
    video: data.videos.some((v) => v.videoId === filters.video) ? filters.video : '',
  };
  const videoOptions = live.channel ? data.videos.filter((v) => v.channel.id === live.channel) : data.videos;
  const rows = sortRows(filterConversations(allRows, live), sort, conversationSortValue);
  // A held video says why under the FIRST of its rows on screen, whatever the sort.
  const firstOfVideo = new Set<string>();
  const seenVideo = new Set<string>();
  for (const r of rows) if (!seenVideo.has(r.video.videoId)) { seenVideo.add(r.video.videoId); firstOfVideo.add(r.key); }

  const renderRow = (row: ConversationRow): React.ReactElement[] => {
    const v = row.video;
    const c = row.comment;
    const videoName = v.title || v.videoId;
    const rowBusy = Boolean(busy);
    const held = (pointer: string) => !canAct(v, pointer);
    const heldTip = (label: string, pointer: string) => (held(pointer) && v.blocked ? `${label}: ${v.blocked}` : label);
    const out: React.ReactElement[] = [];
    const status = rowReplyStatus(row);
    out.push(
      <tr key={row.key} className="yt-conversation-row" data-comment-id={c?.commentId || undefined} data-video-id={v.videoId} data-state={v.state} data-score={c ? c.score : undefined}>
        <td className="yt-conversation-text" title={c && c.text ? c.text : undefined}>
          {c ? (c.text ? cutBetweenWords(c.text) : <span className="outreach-wizard-muted">(no text)</span>)
            : <span className="outreach-wizard-muted">{v.commentsDisabled ? 'Comments are turned off on this video.' : 'No comments to reply to on this video yet.'}</span>}
        </td>
        <td className="yt-conversation-author">
          {c ? (c.author.channelUrl
            ? <a href={c.author.channelUrl} target="_blank" rel="noreferrer noopener">{c.author.name}</a>
            : <strong>{c.author.name}</strong>) : null}
        </td>
        <td className="yt-conversation-video-cell">
          <span className="yt-conversation-video-line">
            <a className="yt-conversation-video-title" href={v.videoUrl} target="_blank" rel="noreferrer noopener">{videoName}</a>
            {v.commentsDisabled ? null : (
              <RowIcon
                glyph="comment"
                label={heldTip(`${replyLabel(v.replyStatus, true)}: ${videoName}`, 'video')}
                disabled={rowBusy || held('video')}
                onClick={() => void write(row.key, 'video', { videoId: v.videoId }, `on "${videoName}"`)}
              />
            )}
          </span>
          <a className="yt-conversation-channel" href={v.channel.url} target="_blank" rel="noreferrer noopener">{v.channel.name}</a>
        </td>
        <td className="yt-conversation-posted">{c ? postedText(c.postedAt) : ''}</td>
        <td className="yt-conversation-likes">{c ? c.likes : ''}</td>
        <td className="yt-conversation-rank" title={c?.reason || undefined}>{c ? c.score : ''}</td>
        <td className="yt-conversation-reply" data-reply={status || 'none'}>{replyWord(status)}</td>
        <td className="actions-col">
          {c ? (
            <div className="table-actions-row">
              <RowIcon
                glyph="write"
                tone="primary"
                label={heldTip(`${replyLabel(c.replyStatus)} to ${c.author.name}`, c.commentId)}
                disabled={rowBusy || held(c.commentId)}
                onClick={() => void write(row.key, 'reply', { commentId: c.commentId }, `to ${c.author.name}`)}
              />
              <RowIcon glyph="skip" label={`Skip Comment: ${c.author.name}`} disabled={rowBusy} onClick={() => { setRowError(null); setSkipping(c); }} />
              {c.author.channelUrl ? (
                <RowIcon glyph="contact" label={`Save as Contact: ${c.author.name}`} disabled={rowBusy} onClick={() => void saveContact(c)} />
              ) : null}
              <RowIcon glyph="open" label={`Open Comment on YouTube: ${c.author.name}`} href={c.url} />
            </div>
          ) : null}
        </td>
      </tr>,
    );
    if (v.blocked && firstOfVideo.has(row.key)) {
      out.push(
        <tr key={`${row.key}:blocked`} className="yt-conversation-note-row">
          <td colSpan={8} className="outreach-wizard-muted" data-blocked>{v.blocked}</td>
        </tr>,
      );
    }
    if (rowError?.key === row.key) {
      out.push(
        <tr key={`${row.key}:error`} className="yt-conversation-note-row">
          <td colSpan={8}><p className="outreach-wizard-error" role="alert">{rowError.message}</p></td>
        </tr>,
      );
    }
    return out;
  };

  return (
    <div className="outreach-conversations yt-conversations" data-reading={data.reading.state}>
      {/* No headline of its own: the stage's sentence above IS the headline
          (lib/outreachOverview.js youtubeConversationsStage), so the two can
          never disagree. */}
      {data.reading.state !== 'no_creators' ? (
        <div className="outreach-wizard-stage-actions">
          <button type="button" className="btn" disabled={readingNow} aria-busy={readingNow} onClick={() => void readNow()}>
            {readingNow ? 'Reading…' : 'Read now'}
          </button>
        </div>
      ) : null}
      {readError ? <p className="outreach-wizard-error" role="alert">{readError}</p> : null}
      {data.canon && !data.canon.ok ? (
        <p className="outreach-wizard-muted">{`Ranked without your canon, so no comment scores for fitting it: ${data.canon.error}`}</p>
      ) : null}
      {data.commentedCount ? (
        <p className="outreach-wizard-muted">
          {`${data.commentedCount} ${data.commentedCount === 1 ? 'video you have' : 'videos you have'} already commented on ${data.commentedCount === 1 ? 'is' : 'are'} left out.`}
        </p>
      ) : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {data.videos.length ? (
        <div className="table-wrap yt-conversations-table-wrap">
          <table className="yt-conversations-table">
            {/* Fixed column widths (src/css/_outreach-wizard.css), the same
                way Find creators keeps its Actions icons in the card at 1280. */}
            <colgroup>
              <col className="yt-conversations-col-comment" />
              <col className="yt-conversations-col-author" />
              <col className="yt-conversations-col-video" />
              <col className="yt-conversations-col-posted" />
              <col className="yt-conversations-col-likes" />
              <col className="yt-conversations-col-rank" />
              <col className="yt-conversations-col-reply" />
              <col className="yt-conversations-col-actions" />
            </colgroup>
            <thead>
              <tr className="table-filter-row">
                <th>
                  <input type="search" placeholder="Comment or author" aria-label="Search comments and authors" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </th>
                <th />
                <th>
                  <div className="yt-conversations-filter-stack">
                    <select aria-label="Channel" value={live.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value, video: '' })}>
                      <option value="">Any channel</option>
                      {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                    </select>
                    <select aria-label="Video" value={live.video} onChange={(e) => setFilters({ ...filters, video: e.target.value })}>
                      <option value="">Any video</option>
                      {videoOptions.map((v) => <option key={v.videoId} value={v.videoId}>{v.title || v.videoId}</option>)}
                    </select>
                  </div>
                </th>
                <th />
                <th />
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
                <th scope="col">Comment</th>
                <th scope="col">Author</th>
                <SortHeader label="Video" sortKey="video" sort={sort} onSort={setSort} />
                <SortHeader label="Posted" sortKey="posted" sort={sort} onSort={setSort} firstDir="desc" />
                <SortHeader label="Likes" sortKey="likes" sort={sort} onSort={setSort} firstDir="desc" />
                <SortHeader label="Rank" sortKey="rank" sort={sort} onSort={setSort} firstDir="desc" />
                <th scope="col">Reply</th>
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.flatMap(renderRow) : (
                <tr className="yt-conversations-empty-row"><td colSpan={8} data-empty-filter>{emptyConversationsText(live, data.videos)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {skipping ? (
        <ReasonPicker
          title={`Skip ${skipping.author.name}'s comment? It leaves this list.`}
          api={getApp()?.api}
          busy={busy?.key === skipping.commentId && busy?.action === 'skip'}
          error={rowError?.key === skipping.commentId ? rowError.message : ''}
          onCancel={() => setSkipping(null)}
          onConfirm={(why) => void confirmSkip(why)}
        />
      ) : null}
    </div>
  );
}
