import React, { useCallback, useEffect, useState } from 'react';
import { SubstackDecisionDialog, reasonTally, type Decision } from '../substack-miner/substack-decision-dialog';

/**
 * YouTube's Find creators stage, worked on the Outreach screen itself —
 * Outreach wizard 15/19 (task 86bcrmbrf).
 *
 * Find channels searches YouTube for the wizard's keywords
 * (POST /api/outreach/youtube/creators/find), then asks for a suggestion on
 * each undecided channel (…/suggest). Each card shows the channel's picture,
 * name, subscribers and newest three videos, the suggestion and its reason,
 * and Approve / Reject / Agree. Approve and Reject open the Substack Miner's
 * own "why?" window, so a reason means the same thing on both screens; Agree
 * takes the suggestion as his decision, reasons included.
 *
 * A search the YouTube quota stopped says "Cannot tell — YouTube quota used up
 * until <time>" — never "no channels found", which would read as an answer
 * about his keywords (landmine 17).
 */

export const CREATORS_PATH = '/api/outreach/youtube/creators';
export const KEYWORDS_PATH = '/api/outreach/keywords';

export type Suggestion = { action: Decision; reasons: string[]; confidence: 'high' | 'medium' | 'low'; why: string };
export type YoutubeCreator = {
  id: string;
  channelId: string;
  channelUrl: string;
  name: string;
  avatarUrl: string;
  subscriberCount: number | null;
  latestVideos: Array<{ videoId: string; title: string }>;
  keywordsHit: string[];
  status: 'candidate' | Decision;
  decisionReasons: string[];
  note: string;
  suggestion: Suggestion | null;
};
export type Keywords = { keywords: string[]; source: 'saved' | 'substack_miner' | 'none' };

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const app = (window as unknown as { App?: { api?: Api } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error';
}

/** "12,400 subscribers"; a hidden count says so rather than showing 0. */
export function subscriberText(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'subscribers hidden';
  return `${n.toLocaleString('en-US')} subscriber${n === 1 ? '' : 's'}`;
}

/** Where the keywords came from, said plainly. */
export function keywordsSourceText(k: Keywords | null): string {
  if (!k) return '';
  if (k.source === 'saved') return 'Searching YouTube for these keywords.';
  if (k.source === 'substack_miner') return 'No outreach keywords saved yet, so these are the Substack Miner\'s. Save to make them the Outreach list.';
  return 'No keywords yet. Add the subjects you want creators in, separated by commas.';
}

/** One run's outcome as a sentence. `cannotTell` (quota) leads, because it overrides the counts. */
export function findSummaryText(found: Record<string, any> | null, suggested: Record<string, any> | null): string {
  if (!found) return '';
  const parts: string[] = [];
  parts.push(`Searched ${found.keywordsSearched?.length || 0} keyword${found.keywordsSearched?.length === 1 ? '' : 's'}: ${found.added || 0} new channel${found.added === 1 ? '' : 's'}, ${found.merged || 0} already on the list.`);
  if (found.notRead?.length) parts.push(`Not read: ${found.notRead.map((n: any) => `${n.what} (${n.reason})`).join('; ')}.`);
  if (found.keywordsSkipped?.length) parts.push(`Not searched this time (ten a run): ${found.keywordsSkipped.join(', ')}.`);
  if (suggested) {
    parts.push(`Suggested ${suggested.suggested?.length || 0} of ${suggested.undecided || 0} undecided.`);
    if (suggested.fromCanonOnly) parts.push('With fewer than 5 YouTube decisions of yours to learn from, these come from your canon and are marked low confidence.');
    if (suggested.notReached) parts.push(`${suggested.notReached} not reached${suggested.stoppedBecause ? ` — stopped: ${suggested.stoppedBecause}` : '; run it again for the rest'}.`);
  }
  return parts.join(' ');
}

const ACTION_WORD: Record<Decision, string> = { approved: 'Approve', rejected: 'Reject' };

function CreatorCard({ creator, busy, onDecide, onAgree }: {
  creator: YoutubeCreator;
  busy: boolean;
  onDecide: (c: YoutubeCreator, d: Decision) => void;
  onAgree: (c: YoutubeCreator) => void;
}): React.ReactElement {
  const s = creator.suggestion;
  return (
    <li className="yt-creator-card" data-channel-id={creator.channelId} data-status={creator.status}>
      <div className="yt-creator-head">
        {creator.avatarUrl ? <img className="yt-creator-avatar" src={creator.avatarUrl} alt="" width={48} height={48} loading="lazy" /> : <span className="yt-creator-avatar" aria-hidden="true" />}
        <div>
          <a className="yt-creator-name" href={creator.channelUrl} target="_blank" rel="noreferrer noopener">{creator.name || creator.channelId}</a>
          <p className="yt-creator-meta">{subscriberText(creator.subscriberCount)}{creator.keywordsHit.length ? ` · found for ${creator.keywordsHit.join(', ')}` : ''}</p>
        </div>
      </div>
      {creator.latestVideos.length ? (
        <ul className="yt-creator-videos" aria-label="Newest videos">
          {creator.latestVideos.slice(0, 3).map((v) => (
            <li key={v.videoId}><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`} target="_blank" rel="noreferrer noopener">{v.title || v.videoId}</a></li>
          ))}
        </ul>
      ) : <p className="yt-creator-meta">No recent videos were read for this channel.</p>}
      {creator.status === 'candidate' ? (
        <>
          {s ? (
            <p className="yt-creator-suggestion" data-suggestion={s.action}>
              <strong>Suggested: {ACTION_WORD[s.action]}</strong> ({s.confidence} confidence)
              {s.reasons.length ? ` — ${s.reasons.join(', ')}` : ''}. {s.why}
            </p>
          ) : <p className="yt-creator-meta">No suggestion yet.</p>}
          <div className="outreach-wizard-stage-actions">
            {s ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAgree(creator)}>Agree</button> : null}
            <button type="button" className="btn" disabled={busy} onClick={() => onDecide(creator, 'approved')}>Approve</button>
            <button type="button" className="btn" disabled={busy} onClick={() => onDecide(creator, 'rejected')}>Reject</button>
          </div>
        </>
      ) : (
        <p className="yt-creator-meta">
          {creator.status === 'approved' ? 'Approved' : 'Rejected'}{creator.decisionReasons.length ? ` — ${creator.decisionReasons.join(', ')}` : ''}{creator.note ? `. ${creator.note}` : ''}
        </p>
      )}
    </li>
  );
}

export default function YoutubeCreators({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const [creators, setCreators] = useState<YoutubeCreator[] | null>(null);
  const [keywords, setKeywords] = useState<Keywords | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  /** The list's own read failure, kept apart so a re-read cannot wipe an action's error. */
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [cannotTell, setCannotTell] = useState('');
  const [showDecided, setShowDecided] = useState(false);
  const [deciding, setDeciding] = useState<{ creator: YoutubeCreator; decision: Decision } | null>(null);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) { setReadError('The admin app is still loading — try again in a moment.'); return; }
    try {
      const reply = await api(CREATORS_PATH);
      setCreators(reply?.data?.creators || []);
      setKeywords(reply?.data?.keywords || null);
      setDraft((reply?.data?.keywords?.keywords || []).join(', '));
      setReadError('');
    } catch (err) {
      setCreators(null);
      setReadError(`The YouTube creator list could not be read: ${errorText(err)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: unknown, method = 'POST') => {
    const api = getApi();
    if (!api) throw new Error('The admin app is still loading — try again in a moment.');
    return api(path, { method, body: JSON.stringify(body || {}) });
  };

  const saveKeywords = async () => {
    setBusy('keywords'); setError('');
    try {
      const list = draft.split(',').map((k) => k.trim()).filter(Boolean);
      const reply = await post(KEYWORDS_PATH, { keywords: list }, 'PUT');
      setKeywords(reply?.data || null);
      setNotice('Keywords saved.');
    } catch (err) {
      setError(`The keywords were not saved: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const findChannels = async () => {
    setBusy('find'); setError(''); setNotice(''); setCannotTell('');
    let found: Record<string, any> | null = null;
    try {
      found = (await post(`${CREATORS_PATH}/find`, {}))?.data || null;
    } catch (err) {
      setError(`YouTube was not searched: ${errorText(err)}`);
      setBusy('');
      return;
    }
    if (found?.cannotTell) setCannotTell(found.cannotTell);
    setBusy('suggest');
    let suggested: Record<string, any> | null = null;
    try {
      suggested = (await post(`${CREATORS_PATH}/suggest`, {}))?.data || null;
    } catch (err) {
      setError(`Channels were found, but not suggested: ${errorText(err)}`);
    }
    setNotice(findSummaryText(found, suggested));
    setBusy('');
    await load();
    onChanged?.();
  };

  const decide = async (creator: YoutubeCreator, status: Decision, decisionReasons: string[], note: string): Promise<boolean> => {
    setBusy(creator.id); setDialogError('');
    try {
      const reply = await post(`${CREATORS_PATH}/${encodeURIComponent(creator.id)}/decide`, { status, decisionReasons, note });
      const saved = reply?.data as YoutubeCreator;
      setCreators((list) => (list || []).map((c) => (c.id === creator.id ? saved : c)));
      setNotice(`${saved.name || 'The channel'} ${status === 'approved' ? 'approved' : 'rejected'}${decisionReasons.length ? `, because: ${decisionReasons.join(', ')}` : ''}.`);
      onChanged?.();
      return true;
    } catch (err) {
      const message = `The decision was not saved: ${errorText(err)}`;
      if (deciding) setDialogError(message); else setError(message);
      return false;
    } finally { setBusy(''); }
  };

  const list = creators || [];
  const undecided = list.filter((c) => c.status === 'candidate');
  const decided = list.filter((c) => c.status !== 'candidate');
  const finding = busy === 'find' || busy === 'suggest';

  return (
    <div className="yt-creators" data-yt-creators>
      <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void saveKeywords(); }}>
        <label htmlFor="yt-creators-keywords">Keywords</label>
        <input id="yt-creators-keywords" type="text" className="outreach-wizard-account-input yt-creators-keywords" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn" disabled={!!busy || !draft.trim()}>Save keywords</button>
      </form>
      {keywords ? <p className="outreach-wizard-muted">{keywordsSourceText(keywords)}</p> : null}
      <div className="outreach-wizard-stage-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy || !keywords?.keywords.length} onClick={() => void findChannels()}>
          {busy === 'find' ? 'Searching YouTube…' : busy === 'suggest' ? 'Suggesting…' : 'Find channels'}
        </button>
      </div>
      {cannotTell ? <p className="outreach-wizard-error" role="alert" data-cannot-tell>{cannotTell}</p> : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
      {readError ? <p className="outreach-wizard-error" role="alert">{readError}</p> : null}
      {creators && !finding ? (
        <p className="outreach-wizard-muted">
          {list.length
            ? `${undecided.length} waiting for your decision, ${decided.filter((c) => c.status === 'approved').length} approved, ${decided.filter((c) => c.status === 'rejected').length} rejected.`
            : 'No channels found yet.'}
        </p>
      ) : null}
      {undecided.length ? (
        <ul className="yt-creator-list">
          {undecided.map((c) => (
            <CreatorCard
              key={c.id}
              creator={c}
              busy={!!busy}
              onDecide={(creator, decision) => { setDialogError(''); setDeciding({ creator, decision }); }}
              onAgree={(creator) => { if (creator.suggestion) void decide(creator, creator.suggestion.action, creator.suggestion.reasons, ''); }}
            />
          ))}
        </ul>
      ) : null}
      {decided.length ? (
        <button type="button" className="btn" aria-expanded={showDecided} onClick={() => setShowDecided((v) => !v)}>
          {showDecided ? 'Hide decided' : `Show decided (${decided.length})`}
        </button>
      ) : null}
      {showDecided && decided.length ? (
        <ul className="yt-creator-list">
          {decided.map((c) => <CreatorCard key={c.id} creator={c} busy={!!busy} onDecide={() => {}} onAgree={() => {}} />)}
        </ul>
      ) : null}
      {deciding ? (
        <SubstackDecisionDialog
          decision={deciding.decision}
          writerName={deciding.creator.name || deciding.creator.channelId}
          initialNote=""
          offered={reasonTally(list, deciding.decision)}
          busy={busy === deciding.creator.id}
          error={dialogError}
          onCancel={() => setDeciding(null)}
          onConfirm={(note, reasons) => {
            void decide(deciding.creator, deciding.decision, reasons, note).then((ok) => { if (ok) setDeciding(null); });
          }}
        />
      ) : null}
    </div>
  );
}
