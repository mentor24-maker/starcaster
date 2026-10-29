import React, { useCallback, useEffect, useState } from 'react';

/**
 * Reddit's Find creators stage, worked on the Outreach screen itself —
 * Outreach wizard 18/19 (task 86bcrmbwm). On Reddit the "creators" are
 * subreddits: the communities the Mini watches every four hours.
 *
 * **Find subreddits for my topics** asks the AI to read the canon and the
 * wizard's shared keywords and propose subreddits, each with a sentence on
 * why (POST /api/outreach/reddit/subreddits/suggest). Dane approves or
 * rejects each one; only approved subreddits are watched. One can also be
 * added by name. Each approved subreddit says when the Mini last read it and
 * what it found — or why it could not — and its stated self-promotion rule.
 */

export const SUBREDDITS_PATH = '/api/outreach/reddit/subreddits';

export type Subreddit = {
  id: string;
  name: string;
  status: 'candidate' | 'approved' | 'rejected';
  suggestedBy: 'ai' | 'hand';
  why: string;
  promotionRule: string;
  lastReadState: '' | 'read' | 'failed' | 'signed_out';
  lastReadAt: string | null;
  lastReadError: string;
  lastReadSeen: number;
  lastReadKept: number;
};

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const app = (window as unknown as { App?: { api?: Api } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error';
}

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** What the Mini's last read of an approved subreddit found, in a sentence. */
export function readText(s: Subreddit): string {
  if (!s.lastReadState) return 'Not read yet — the Mini reads two subreddits every four hours.';
  if (s.lastReadState === 'signed_out') return `Not read ${when(s.lastReadAt)}: the Mini's browser was signed out of Reddit.`;
  if (s.lastReadState === 'failed') return `Last read failed ${when(s.lastReadAt)}: ${s.lastReadError}`;
  return `Read ${when(s.lastReadAt)}: ${s.lastReadSeen} posts looked at, ${s.lastReadKept} kept.`;
}

/** One suggestion run's outcome as a sentence. */
export function suggestSummary(data: Record<string, any> | null): string {
  if (!data) return '';
  const added = Array.isArray(data.added) ? data.added.length : 0;
  const kept = Array.isArray(data.kept) ? data.kept.length : 0;
  const parts = [`${added} new subreddit${added === 1 ? '' : 's'} suggested from ${data.keywords || 0} keyword${data.keywords === 1 ? '' : 's'} and ${data.canonDocs || 0} canon document${data.canonDocs === 1 ? '' : 's'}.`];
  if (kept) parts.push(`${kept} already on your list ${kept === 1 ? 'was' : 'were'} left as ${kept === 1 ? 'it was' : 'they were'}.`);
  if (!added && !kept) parts.push('The AI had nothing new to suggest.');
  return parts.join(' ');
}

function SubredditCard({ s, busy, onDecide }: {
  s: Subreddit;
  busy: boolean;
  onDecide: (s: Subreddit, status: Subreddit['status']) => void;
}): React.ReactElement {
  return (
    <li className="reddit-sub-card" data-subreddit={s.name} data-status={s.status}>
      <p className="reddit-sub-head">
        <a href={`https://www.reddit.com/r/${encodeURIComponent(s.name)}/`} target="_blank" rel="noreferrer noopener">{`r/${s.name}`}</a>
        <span className="outreach-wizard-muted">{s.suggestedBy === 'ai' ? ' · suggested' : ' · added by you'}</span>
      </p>
      {s.why ? <p className="reddit-sub-why">{s.why}</p> : null}
      {s.status === 'approved' ? (
        <>
          <p className="outreach-wizard-muted" data-read-state={s.lastReadState || 'never'}>{readText(s)}</p>
          {s.promotionRule ? <p className="reddit-sub-rule"><strong>Self-promotion rule:</strong> {s.promotionRule}</p> : null}
        </>
      ) : null}
      <div className="outreach-wizard-stage-actions">
        {s.status !== 'approved' ? <button type="button" className="btn" disabled={busy} onClick={() => onDecide(s, 'approved')}>Approve</button> : null}
        {s.status !== 'rejected' ? <button type="button" className="btn" disabled={busy} onClick={() => onDecide(s, 'rejected')}>{s.status === 'approved' ? 'Stop watching' : 'Reject'}</button> : null}
      </div>
    </li>
  );
}

export default function RedditSubreddits({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const [subs, setSubs] = useState<Subreddit[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [showRejected, setShowRejected] = useState(false);

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) { setReadError('The admin app is still loading — try again in a moment.'); return; }
    try {
      const reply = await api(SUBREDDITS_PATH);
      setSubs((reply?.data as Subreddit[]) || []);
      setReadError('');
    } catch (err) {
      setSubs(null);
      setReadError(`The subreddit list could not be read: ${errorText(err)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: unknown) => {
    const api = getApi();
    if (!api) throw new Error('The admin app is still loading — try again in a moment.');
    return api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  };

  const findSubreddits = async () => {
    setBusy('suggest'); setError(''); setNotice('');
    try {
      const reply = await post(`${SUBREDDITS_PATH}/suggest`, {});
      setNotice(suggestSummary(reply?.data || null));
      await load();
      onChanged?.();
    } catch (err) {
      setError(`No subreddits suggested: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const addByName = async () => {
    const wanted = name.split(',').map((n) => n.trim()).filter(Boolean);
    if (!wanted.length) return;
    setBusy('add'); setError(''); setNotice('');
    try {
      const reply = await post(SUBREDDITS_PATH, { names: wanted });
      const refused = (reply?.data?.refused || []) as Array<{ name: string; why: string }>;
      const added = (reply?.data?.added || []).length;
      setNotice(`${added} added — approve ${added === 1 ? 'it' : 'them'} below to start watching.${refused.length ? ` Not added: ${refused.map((r) => `"${r.name}" (${r.why})`).join(', ')}.` : ''}`);
      setName('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(`Not added: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const decide = async (s: Subreddit, status: Subreddit['status']) => {
    setBusy(s.id); setError('');
    try {
      const reply = await post(`${SUBREDDITS_PATH}/${encodeURIComponent(s.id)}/decide`, { status });
      const saved = reply?.data as Subreddit;
      setSubs((list) => (list || []).map((x) => (x.id === s.id ? saved : x)));
      setNotice(status === 'approved' ? `r/${s.name} approved — the Mini reads it within the next few passes.` : `r/${s.name} ${s.status === 'approved' ? 'is no longer watched' : 'rejected'}.`);
      onChanged?.();
    } catch (err) {
      setError(`The decision was not saved: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const list = subs || [];
  const waiting = list.filter((s) => s.status === 'candidate');
  const approved = list.filter((s) => s.status === 'approved');
  const rejected = list.filter((s) => s.status === 'rejected');

  return (
    <div className="reddit-subs" data-reddit-subreddits>
      <div className="outreach-wizard-stage-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void findSubreddits()}>
          {busy === 'suggest' ? 'Asking the AI…' : 'Find subreddits for my topics'}
        </button>
      </div>
      <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void addByName(); }}>
        <label htmlFor="reddit-subs-add">Add by name</label>
        <input id="reddit-subs-add" type="text" className="outreach-wizard-account-input" placeholder="r/polymath" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={!!busy || !name.trim()}>Add</button>
      </form>
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
      {readError ? <p className="outreach-wizard-error" role="alert">{readError}</p> : null}
      {waiting.length ? (
        <>
          <p className="outreach-wizard-muted">{`Waiting for your decision (${waiting.length}):`}</p>
          <ul className="reddit-sub-list">{waiting.map((s) => <SubredditCard key={s.id} s={s} busy={!!busy} onDecide={(x, st) => void decide(x, st)} />)}</ul>
        </>
      ) : null}
      {approved.length ? (
        <>
          <p className="outreach-wizard-muted">{`Watched (${approved.length}):`}</p>
          <ul className="reddit-sub-list">{approved.map((s) => <SubredditCard key={s.id} s={s} busy={!!busy} onDecide={(x, st) => void decide(x, st)} />)}</ul>
        </>
      ) : null}
      {rejected.length ? (
        <button type="button" className="btn" aria-expanded={showRejected} onClick={() => setShowRejected((v) => !v)}>
          {showRejected ? 'Hide rejected' : `Show rejected (${rejected.length})`}
        </button>
      ) : null}
      {showRejected && rejected.length ? (
        <ul className="reddit-sub-list">{rejected.map((s) => <SubredditCard key={s.id} s={s} busy={!!busy} onDecide={(x, st) => void decide(x, st)} />)}</ul>
      ) : null}
    </div>
  );
}
