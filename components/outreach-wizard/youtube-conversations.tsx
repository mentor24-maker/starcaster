import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReasonPicker, { type RejectReason } from './reason-picker';

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
 * A video can carry one reply at a time (one outreach target per video), so a
 * video whose reply is already waiting says so and holds its other buttons
 * until that one is finished or rejected.
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
  reading: { state: 'current' | 'cannot_tell' | 'no_creators'; sentence: string };
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

function excerpt(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 280 ? `${t.slice(0, 277)}…` : t;
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

  return (
    <div className="outreach-conversations yt-conversations" data-reading={data.reading.state}>
      {/* No headline of its own: the stage's sentence above IS the headline
          (lib/outreachOverview.js youtubeConversationsStage), so the two can
          never disagree. */}
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
        <ol className="outreach-conversations-list yt-conversation-videos">
          {data.videos.map((v) => {
            const videoKey = `video:${v.videoId}`;
            return (
              <li key={v.videoId} className="yt-conversation-video" data-video-id={v.videoId} data-state={v.state}>
                <p className="outreach-conversation-head">
                  <a href={v.videoUrl} target="_blank" rel="noreferrer">{v.title || v.videoId}</a>
                  <span className="outreach-wizard-muted">{' · '}<a href={v.channel.url} target="_blank" rel="noreferrer">{v.channel.name}</a></span>
                </p>
                {v.blocked ? <p className="outreach-wizard-muted" data-blocked>{v.blocked}</p> : null}
                {v.commentsDisabled ? (
                  <p className="outreach-wizard-muted">Comments are turned off on this video.</p>
                ) : (
                  <div className="outreach-wizard-stage-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={Boolean(busy) || !canAct(v, 'video')}
                      onClick={() => void write(videoKey, 'video', { videoId: v.videoId }, `on "${v.title || v.videoId}"`)}
                    >
                      {busy?.key === videoKey ? 'Writing…' : replyLabel(v.replyStatus, true)}
                    </button>
                  </div>
                )}
                {rowError?.key === videoKey ? <p className="outreach-wizard-error" role="alert">{rowError.message}</p> : null}
                {v.comments.length ? (
                  <ol className="outreach-conversations-list">
                    {v.comments.map((c) => (
                      <li key={c.commentId} className="outreach-conversation" data-score={c.score} data-comment-id={c.commentId}>
                        <p className="outreach-conversation-head">
                          {c.author.channelUrl
                            ? <a href={c.author.channelUrl} target="_blank" rel="noreferrer">{c.author.name}</a>
                            : <strong>{c.author.name}</strong>}
                        </p>
                        <p className="outreach-conversation-why">{c.reason}</p>
                        {c.text ? <p className="outreach-conversation-text">{excerpt(c.text)}</p> : null}
                        <div className="outreach-wizard-stage-actions">
                          <button
                            type="button"
                            className="btn"
                            disabled={Boolean(busy) || !canAct(v, c.commentId)}
                            onClick={() => void write(c.commentId, 'reply', { commentId: c.commentId }, `to ${c.author.name}`)}
                          >
                            {busy?.key === c.commentId && busy.action === 'reply' ? 'Writing…' : replyLabel(c.replyStatus)}
                          </button>
                          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => { setRowError(null); setSkipping(c); }}>
                            Skip
                          </button>
                          {c.author.channelUrl ? (
                            <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void saveContact(c)}>
                              {busy?.key === c.commentId && busy.action === 'contact' ? 'Saving…' : 'Save as contact'}
                            </button>
                          ) : null}
                          <a className="btn" href={c.url} target="_blank" rel="noreferrer">Open the comment</a>
                        </div>
                        {rowError?.key === c.commentId ? <p className="outreach-wizard-error" role="alert">{rowError.message}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="outreach-wizard-muted">{v.commentsDisabled ? '' : 'No comments to reply to on this video yet.'}</p>
                )}
              </li>
            );
          })}
        </ol>
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
