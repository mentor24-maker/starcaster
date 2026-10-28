import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReasonPicker, { type RejectReason } from './reason-picker';

/**
 * Substack's Find conversations, inside the wizard — Outreach wizard 14/19
 * (task 86bcrmbqu). The Notes the scheduled read (every two hours) and the
 * Mini's search (every six) found, best first, each with its writer and the
 * one sentence on why it ranked there (lib/outreachRanking.js).
 *
 * Per Note: **Write replies** lines up the reply and writes its three options,
 * then opens the Substack Notes screen where the chooser is; **Skip** asks why
 * with the shared reason picker and takes it off the list; **Add writer**
 * (a writer a keyword found, not yet approved) approves them through the
 * Miner's own approve flow.
 *
 * A reading that has not come back says "Cannot tell" and names the writers —
 * an empty list is never drawn as "0 found" unless every approved writer was
 * read in the last week (lib/substackConversations.js readingVerdict).
 */

export const CONVERSATIONS_PATH = '/api/outreach/substack/conversations';
const MINER_CANDIDATES_PATH = '/api/acquire/substack-miner/candidates';
const NOTES_PAGE = 'engageSubstackNotesPage';

export type Conversation = {
  url: string;
  text: string;
  postedAt: string;
  foundAt: string;
  keyword: string;
  approved: boolean;
  score: number;
  reason: string;
  replyItemId: string;
  replyStatus: string;
  writer: { id: string; handle: string; name: string; status: string; publicationUrl: string };
  author: { handle: string; profileUrl: string };
};

export type Reading = { state: 'current' | 'cannot_tell' | 'no_writers'; sentence: string };

export type ConversationsReply = {
  items: Conversation[];
  newCount: number;
  reading: Reading;
  canon?: { ok: boolean; words?: number; error?: string };
  skippedCount: number;
};

type ApiFn = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

type AppShape = { api?: ApiFn; setActivePage?: (pageId: string) => void };

function getApp(): AppShape | null {
  return (window as unknown as { App?: AppShape }).App || null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** What the reply button says: a reply already waiting is picked up, not made twice. */
export function replyLabel(c: Conversation): string {
  if (c.replyStatus === 'draft') return 'Open the replies';
  return 'Write replies';
}

function excerpt(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 280 ? `${t.slice(0, 277)}…` : t;
}

export default function SubstackConversations(): React.ReactElement {
  const [data, setData] = useState<ConversationsReply | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<{ url: string; action: string } | null>(null);
  const [rowError, setRowError] = useState<{ url: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [skipping, setSkipping] = useState<Conversation | null>(null);
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
      const reply = await api(CONVERSATIONS_PATH);
      if (mine !== seq.current) return;
      setData((reply?.data as ConversationsReply) || null);
      setError('');
    } catch (err) {
      if (mine !== seq.current) return;
      setData(null);
      setError(`Cannot tell what there is to reply to: ${errorText(err, 'the list could not be read')}`);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: unknown, method = 'POST') => {
    const api = getApp()?.api;
    if (typeof api !== 'function') throw new Error('the admin app is still loading');
    return api(path, { method, body: JSON.stringify(body) });
  };

  const writeReplies = async (c: Conversation) => {
    setBusy({ url: c.url, action: 'reply' });
    setRowError(null);
    try {
      await post(`${CONVERSATIONS_PATH}/reply`, { url: c.url });
      setNotice(`Replies written for ${c.writer.name}'s Note — choose one on the Substack Notes screen.`);
      const app = getApp();
      if (typeof app?.setActivePage === 'function') app.setActivePage(NOTES_PAGE);
      void load();
    } catch (err) {
      setRowError({ url: c.url, message: `No replies written: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const confirmSkip = async (why: RejectReason) => {
    const c = skipping;
    if (!c) return;
    setBusy({ url: c.url, action: 'skip' });
    setRowError(null);
    try {
      await post(`${CONVERSATIONS_PATH}/skip`, { url: c.url, reasons: why.reasons, note: why.note });
      setSkipping(null);
      setNotice(`Skipped ${c.writer.name}'s Note${why.reasons.length ? ` (${why.reasons.join(', ')})` : ''}.`);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.url !== c.url), newCount: Math.max(0, d.newCount - 1) } : d));
    } catch (err) {
      setRowError({ url: c.url, message: `Not skipped: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  const addWriter = async (c: Conversation) => {
    setBusy({ url: c.url, action: 'add' });
    setRowError(null);
    try {
      await post(`${MINER_CANDIDATES_PATH}/${encodeURIComponent(c.writer.id)}`, { status: 'approved' }, 'PATCH');
      setNotice(`${c.writer.name} is approved — their Notes are read on the next scheduled pass.`);
      void load();
    } catch (err) {
      setRowError({ url: c.url, message: `${c.writer.name} was not added: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="outreach-wizard-error" role="alert">{error}</p>;
  if (!data) return <p className="outreach-wizard-muted">{loading ? 'Reading the Notes found so far…' : ''}</p>;

  return (
    <div className="outreach-conversations" data-reading={data.reading.state}>
      {/* No headline of its own: the stage's sentence above IS the headline —
          how many, or why it cannot tell (lib/outreachOverview.js
          conversationsStage) — so the two can never disagree. */}
      {data.canon && !data.canon.ok ? (
        <p className="outreach-wizard-muted">{`Ranked without your canon, so no Note scores for fitting it: ${data.canon.error}`}</p>
      ) : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {data.items.length ? (
        <ol className="outreach-conversations-list">
          {data.items.map((c) => {
            const isBusy = busy?.url === c.url;
            return (
              <li key={c.url} className="outreach-conversation" data-score={c.score}>
                <p className="outreach-conversation-head">
                  <a href={c.author.profileUrl} target="_blank" rel="noreferrer">{c.writer.name}</a>
                  <span className="outreach-wizard-muted">
                    {c.approved ? ' · approved writer' : ` · not approved yet${c.keyword ? `, found by "${c.keyword}"` : ''}`}
                  </span>
                </p>
                <p className="outreach-conversation-why">{c.reason}</p>
                {c.text ? <p className="outreach-conversation-text">{excerpt(c.text)}</p> : null}
                <div className="outreach-wizard-stage-actions">
                  <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void writeReplies(c)}>
                    {isBusy && busy?.action === 'reply' ? 'Writing…' : replyLabel(c)}
                  </button>
                  <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => { setRowError(null); setSkipping(c); }}>
                    Skip
                  </button>
                  {c.writer.status === 'candidate' ? (
                    <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void addWriter(c)}>
                      {isBusy && busy?.action === 'add' ? 'Adding…' : 'Add writer'}
                    </button>
                  ) : null}
                  <a className="btn" href={c.url} target="_blank" rel="noreferrer">Open the Note</a>
                </div>
                {rowError?.url === c.url ? <p className="outreach-wizard-error" role="alert">{rowError.message}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {skipping ? (
        <ReasonPicker
          title={`Skip ${skipping.writer.name}'s Note? It leaves this list.`}
          api={getApp()?.api}
          busy={busy?.url === skipping.url && busy?.action === 'skip'}
          error={rowError?.url === skipping.url ? rowError.message : ''}
          onCancel={() => setSkipping(null)}
          onConfirm={(why) => void confirmSkip(why)}
        />
      ) : null}
    </div>
  );
}
