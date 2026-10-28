import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReasonPicker, { type RejectReason } from './reason-picker';

/**
 * Reddit's Find conversations, inside the wizard — Outreach wizard 18/19
 * (task 86bcrmbwm). The posts the Mini's four-hourly watch kept from the
 * approved subreddits, best first (lib/redditConversations.js), each with its
 * author, its strongest comments and their authors, the subreddit's stated
 * self-promotion rule, and the one sentence on why it ranked there.
 *
 * Per post: **Write replies** (to the post, or to one of its comments) lines
 * up the comment on Engage › Comments from what the Mini already read and
 * writes its three options, then opens that screen, where the chooser is;
 * **Skip** asks why with the shared reason picker; **Save as contact** keeps
 * a commenter (or the post's author) as a lead.
 *
 * Signed out or a read that did not come back is "Cannot tell" in the stage's
 * sentence above — never "0 found" — so this list draws no headline of its own.
 */

export const REDDIT_CONVERSATIONS_PATH = '/api/outreach/reddit/conversations';
const COMMENTS_PAGE = 'engageCommentResponsesPage';

export type RedditComment = { id: string; author: string; body: string; score: number };

export type RedditConversation = {
  postId: string;
  subreddit: string;
  url: string;
  title: string;
  body: string;
  author: string;
  postedAt: string;
  score: number;
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
  canon?: { ok: boolean; words?: number; error?: string };
};

type ApiFn = (path: string, options?: RequestInit) => Promise<Record<string, any>>;
type AppShape = { api?: ApiFn; setActivePage?: (pageId: string) => void };

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

type Props = { onChanged?: () => void; version?: string };

export default function RedditConversations({ onChanged, version }: Props = {}): React.ReactElement {
  const [data, setData] = useState<RedditConversationsReply | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<{ postId: string; action: string } | null>(null);
  const [rowError, setRowError] = useState<{ postId: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [skipping, setSkipping] = useState<RedditConversation | null>(null);
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

  const post = async (path: string, body: unknown) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') throw new Error('the admin app is still loading');
    return api(path, { method: 'POST', body: JSON.stringify(body) });
  };

  const writeReplies = async (c: RedditConversation, comment?: RedditComment) => {
    setBusy({ postId: c.postId, action: comment ? `reply:${comment.id}` : 'reply' });
    setRowError(null);
    try {
      const reply = await post(`${REDDIT_CONVERSATIONS_PATH}/reply`, { postId: c.postId, ...(comment ? { commentId: comment.id } : {}) });
      setNotice(reply?.data?.drafted === false
        ? 'Already drafted — open it on Engage › Comments.'
        : `Replies written ${comment ? `to u/${comment.author}'s comment` : 'to the post'} — choose one on Engage › Comments.`);
      const app = getApp();
      if (typeof app?.setActivePage === 'function') app.setActivePage(COMMENTS_PAGE);
      onChanged?.();
    } catch (err) {
      setRowError({ postId: c.postId, message: `No replies written: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const saveContact = async (c: RedditConversation, author: string) => {
    setBusy({ postId: c.postId, action: `contact:${author}` });
    setRowError(null);
    try {
      const reply = await post(`${REDDIT_CONVERSATIONS_PATH}/contact`, { postId: c.postId, author });
      setNotice(reply?.data?.created === false ? `u/${author} is already a contact.` : `u/${author} saved as a contact.`);
    } catch (err) {
      setRowError({ postId: c.postId, message: `u/${author} was not saved: ${errorText(err, 'unknown error')}` });
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
      setRowError({ postId: c.postId, message: `Not skipped: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="outreach-wizard-error" role="alert">{error}</p>;
  if (!data) return <p className="outreach-wizard-muted">{loading ? 'Reading the posts found so far…' : ''}</p>;

  return (
    <div className="outreach-conversations" data-reading={data.reading.state}>
      {data.canon && !data.canon.ok ? (
        <p className="outreach-wizard-muted">{`Ranked without your canon, so no post scores for fitting it: ${data.canon.error}`}</p>
      ) : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {data.items.length ? (
        <ol className="outreach-conversations-list">
          {data.items.map((c) => {
            const isBusy = busy?.postId === c.postId;
            const note = commentsNote(c);
            return (
              <li key={c.postId} className="outreach-conversation" data-score={c.score} data-post-id={c.postId}>
                <p className="outreach-conversation-head">
                  <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
                  <span className="outreach-wizard-muted">{` · r/${c.subreddit}${c.author ? ` · u/${c.author}` : ''}`}</span>
                </p>
                <p className="outreach-conversation-why">{c.reason}</p>
                {c.body ? <p className="outreach-conversation-text">{excerpt(c.body)}</p> : null}
                {c.promotionRule ? (
                  <p className="reddit-sub-rule" data-promotion-rule><strong>{`r/${c.subreddit}'s self-promotion rule:`}</strong> {c.promotionRule}</p>
                ) : null}
                {c.topComments.length ? (
                  <ul className="reddit-comment-list" aria-label="Strongest comments">
                    {c.topComments.slice(0, 3).map((m) => (
                      <li key={m.id} className="reddit-comment">
                        <p>
                          <strong>{`u/${m.author}`}</strong>
                          <span className="outreach-wizard-muted">{` · ${m.score} point${m.score === 1 ? '' : 's'}`}</span>
                        </p>
                        <p className="outreach-conversation-text">{excerpt(m.body, 220)}</p>
                        <div className="outreach-wizard-stage-actions">
                          <button type="button" className="btn tiny-btn" disabled={Boolean(busy)} onClick={() => void writeReplies(c, m)}>
                            {isBusy && busy?.action === `reply:${m.id}` ? 'Writing…' : 'Reply to this comment'}
                          </button>
                          <button type="button" className="btn tiny-btn" disabled={Boolean(busy)} onClick={() => void saveContact(c, m.author)}>
                            {isBusy && busy?.action === `contact:${m.author}` ? 'Saving…' : 'Save as contact'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="outreach-wizard-muted">{note}</p>}
                <div className="outreach-wizard-stage-actions">
                  <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void writeReplies(c)}>
                    {isBusy && busy?.action === 'reply' ? 'Writing…' : (c.replyStatus === 'draft' ? 'Open the replies' : 'Write replies')}
                  </button>
                  <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => { setRowError(null); setSkipping(c); }}>
                    Skip
                  </button>
                  {c.author ? (
                    <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void saveContact(c, c.author)}>
                      {isBusy && busy?.action === `contact:${c.author}` ? 'Saving…' : 'Save author as contact'}
                    </button>
                  ) : null}
                </div>
                {rowError?.postId === c.postId ? <p className="outreach-wizard-error" role="alert">{rowError.message}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {skipping ? (
        <ReasonPicker
          title={`Skip "${excerpt(skipping.title, 60)}"? It leaves this list.`}
          api={getApp()?.api}
          busy={busy?.postId === skipping.postId && busy?.action === 'skip'}
          error={rowError?.postId === skipping.postId ? rowError.message : ''}
          onCancel={() => setSkipping(null)}
          onConfirm={(why) => void confirmSkip(why)}
        />
      ) : null}
    </div>
  );
}
