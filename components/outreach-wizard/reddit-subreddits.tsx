import React, { useCallback, useEffect, useState } from 'react';
import { RowIcon, SortHeader, filterRows, sortRows, type SortState, type SortValue } from './outreach-table';

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
 *
 * Since SC-890 the list is a sortable table with a filter bar, built from the
 * shared pieces in outreach-table.tsx (the same look as YouTube's Find
 * creators): Subreddit, Status, Suggested by, Why, Self-promotion rule, Last
 * read and square icon actions. The Status filter opens on Suggested +
 * Watching and replaces the old "Show rejected" button.
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

export type SubredditSortKey = 'subreddit' | 'status' | 'lastRead';
export type SubredditStatusFilter = 'open' | 'candidate' | 'approved' | 'rejected' | 'all';
export type SubredditFilters = { search: string; status: SubredditStatusFilter };

export const DEFAULT_SUBREDDIT_FILTERS: SubredditFilters = { search: '', status: 'open' };

/** The word the table shows for a status: an approved subreddit is one the Mini watches. */
export const SUBREDDIT_STATUS_WORD: Record<Subreddit['status'], string> = { candidate: 'Suggested', approved: 'Watching', rejected: 'Rejected' };

const STATUS_FILTER_WORD: Record<SubredditStatusFilter, string> = {
  open: 'suggested or watched ',
  candidate: 'suggested ',
  approved: 'watched ',
  rejected: 'rejected ',
  all: '',
};

/** What a column sorts by. A subreddit never read sorts last by Last read, whichever direction. */
export function subredditSortValue(s: Subreddit, key: SubredditSortKey): SortValue {
  if (key === 'subreddit') return s.name;
  if (key === 'status') return SUBREDDIT_STATUS_WORD[s.status];
  const t = s.lastReadAt ? new Date(s.lastReadAt).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/** The rows the filter bar lets through; both filters must pass. */
export function filterSubreddits(list: Subreddit[], f: SubredditFilters): Subreddit[] {
  const needle = f.search.trim().toLowerCase().replace(/^\/?r\//, '');
  return filterRows(list, [
    needle ? (s) => s.name.toLowerCase().includes(needle) : null,
    f.status === 'all' ? null : (s) => (f.status === 'open' ? s.status !== 'rejected' : s.status === f.status),
  ]);
}

/**
 * Why the table is empty, naming the filters in force, so an empty table
 * never reads as a broken one (landmine 17): "No rejected subreddits match
 * 'yoga'."
 */
export function emptySubredditsText(f: SubredditFilters): string {
  const search = f.search.trim();
  return `No ${STATUS_FILTER_WORD[f.status]}subreddits${search ? ` match '${search}'` : ''}.`;
}

/** The Last read cell: a subreddit that is not watched and was never read says so instead of "not read yet". */
function lastReadCell(s: Subreddit): string {
  if (!s.lastReadState && s.status !== 'approved') return 'Not watched';
  return readText(s);
}

function SubredditRow({ s, busy, message, onDecide }: {
  s: Subreddit;
  busy: boolean;
  message: { text: string; error: boolean } | null;
  onDecide: (s: Subreddit, status: Subreddit['status']) => void;
}): React.ReactElement {
  const label = `r/${s.name}`;
  const href = `https://www.reddit.com/r/${encodeURIComponent(s.name)}/`;
  return (
    <>
      <tr className="reddit-sub-row" data-subreddit={s.name} data-status={s.status}>
        <td className="reddit-sub-name"><a href={href} target="_blank" rel="noreferrer noopener">{label}</a></td>
        <td className="reddit-sub-status">{SUBREDDIT_STATUS_WORD[s.status]}</td>
        <td className="reddit-sub-by">{s.suggestedBy === 'ai' ? 'AI' : 'You'}</td>
        <td className="reddit-sub-why">
          {s.why ? <span className="reddit-sub-clamp" title={s.why}>{s.why}</span> : <span className="outreach-wizard-muted">—</span>}
        </td>
        <td className="reddit-sub-rule">
          {s.promotionRule
            ? <span className="reddit-sub-clamp" title={s.promotionRule}>{s.promotionRule}</span>
            : <span className="outreach-wizard-muted">{s.lastReadState === 'read' ? 'None stated' : s.status === 'approved' || s.lastReadState ? 'Not read yet' : '—'}</span>}
        </td>
        <td className="reddit-sub-read" data-read-state={s.lastReadState || 'never'}>{lastReadCell(s)}</td>
        <td className="actions-col">
          <div className="table-actions-row">
            {s.status !== 'approved' ? <RowIcon glyph="approve" tone="primary" label={`Approve ${label}`} disabled={busy} onClick={() => onDecide(s, 'approved')} /> : null}
            {s.status === 'candidate' ? <RowIcon glyph="reject" label={`Reject ${label}`} disabled={busy} onClick={() => onDecide(s, 'rejected')} /> : null}
            {s.status === 'approved' ? <RowIcon glyph="unwatch" label={`Stop Watching ${label}`} disabled={busy} onClick={() => onDecide(s, 'rejected')} /> : null}
            <RowIcon glyph="open" label={`Open ${label} on Reddit`} href={href} />
          </div>
        </td>
      </tr>
      {message ? (
        <tr className="reddit-sub-message-row" data-row-message={s.name}>
          <td colSpan={7}>
            <p className={message.error ? 'outreach-wizard-error' : 'outreach-wizard-notice'} role={message.error ? 'alert' : 'status'}>{message.text}</p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function RedditSubreddits({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const [subs, setSubs] = useState<Subreddit[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState<SubredditFilters>(DEFAULT_SUBREDDIT_FILTERS);
  const [sort, setSort] = useState<SortState<SubredditSortKey>>(null);
  /** One row's own outcome (a decision saved or refused), shown directly under that row. */
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; error: boolean } | null>(null);

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
    setBusy('suggest'); setError(''); setNotice(''); setRowMessage(null);
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
    setBusy('add'); setError(''); setNotice(''); setRowMessage(null);
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
    setBusy(s.id); setError(''); setRowMessage(null);
    try {
      const reply = await post(`${SUBREDDITS_PATH}/${encodeURIComponent(s.id)}/decide`, { status });
      const saved = reply?.data as Subreddit;
      setSubs((list) => (list || []).map((x) => (x.id === s.id ? saved : x)));
      setRowMessage({
        id: s.id,
        error: false,
        text: status === 'approved' ? `r/${s.name} approved — the Mini reads it within the next few passes.` : `r/${s.name} ${s.status === 'approved' ? 'is no longer watched' : 'rejected'}.`,
      });
      onChanged?.();
    } catch (err) {
      setRowMessage({ id: s.id, error: true, text: `The decision on r/${s.name} was not saved: ${errorText(err)}` });
    } finally { setBusy(''); }
  };

  const list = subs || [];
  const rows = sortRows(filterSubreddits(list, filters), sort, subredditSortValue);
  // A decision can move its row out of the filter (Reject under the default
  // Suggested + Watching), and a message under a row nobody can see is lost,
  // so that row's message shows above the table instead.
  const hiddenRowMessage = rowMessage && !rows.some((s) => s.id === rowMessage.id) ? rowMessage : null;

  return (
    <div className="reddit-subs" data-reddit-subreddits>
      <div className="outreach-wizard-stage-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void findSubreddits()}>
          {busy === 'suggest' ? 'Asking the AI…' : 'Find subreddits for my topics'}
        </button>
      </div>
      <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void addByName(); }}>
        <label htmlFor="reddit-subs-add">Add by Name</label>
        <input id="reddit-subs-add" type="text" className="outreach-wizard-account-input" placeholder="r/polymath" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={!!busy || !name.trim()}>Add</button>
      </form>
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
      {readError ? <p className="outreach-wizard-error" role="alert">{readError}</p> : null}
      {hiddenRowMessage ? (
        <p className={hiddenRowMessage.error ? 'outreach-wizard-error' : 'outreach-wizard-notice'} role={hiddenRowMessage.error ? 'alert' : 'status'} data-row-message-hidden>{hiddenRowMessage.text}</p>
      ) : null}
      {/* The counts are the stage's own summary line, above; only an empty list needs a sentence here. */}
      {subs && !list.length ? <p className="outreach-wizard-muted">No subreddits on the list yet — find some for your topics, or add one by name.</p> : null}
      {list.length ? (
        <div className="table-wrap reddit-subs-table-wrap">
          <table className="reddit-subs-table">
            {/* Fixed column widths (src/css/_outreach-wizard.css), the same
                reason as YouTube's table: text wraps inside its column and
                cannot push the Actions icons out of the card at 1280. */}
            <colgroup>
              <col className="reddit-subs-col-name" />
              <col className="reddit-subs-col-status" />
              <col className="reddit-subs-col-by" />
              <col className="reddit-subs-col-why" />
              <col className="reddit-subs-col-rule" />
              <col className="reddit-subs-col-read" />
              <col className="reddit-subs-col-actions" />
            </colgroup>
            <thead>
              <tr className="table-filter-row">
                <th>
                  <input type="search" placeholder="Subreddit" aria-label="Search subreddit names" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </th>
                {/* Two columns wide: "Suggested + Watching" needs more room than Status alone has at 1280. */}
                <th colSpan={2}>
                  <select aria-label="Status" className="reddit-subs-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as SubredditStatusFilter })}>
                    <option value="open">Suggested + Watching</option>
                    <option value="candidate">Suggested</option>
                    <option value="approved">Watching</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All</option>
                  </select>
                </th>
                <th />
                <th />
                <th />
                <th className="actions-col" />
              </tr>
              <tr>
                <SortHeader label="Subreddit" sortKey="subreddit" sort={sort} onSort={setSort} />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                <th scope="col">Suggested by</th>
                <th scope="col">Why</th>
                <th scope="col">Self-promotion rule</th>
                <SortHeader label="Last Read" sortKey="lastRead" sort={sort} onSort={setSort} firstDir="desc" />
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((s) => (
                <SubredditRow
                  key={s.id}
                  s={s}
                  busy={!!busy}
                  message={rowMessage && rowMessage.id === s.id ? rowMessage : null}
                  onDecide={(x, st) => void decide(x, st)}
                />
              )) : (
                <tr className="reddit-subs-empty-row"><td colSpan={7} data-empty-filter>{emptySubredditsText(filters)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
