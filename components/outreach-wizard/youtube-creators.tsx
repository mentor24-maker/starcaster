import React, { useCallback, useEffect, useState } from 'react';
import { SubstackDecisionDialog, reasonTally, type Decision } from '../substack-miner/substack-decision-dialog';
import { RowIcon, SortHeader, filterRows, sortRows, type SortState, type SortValue } from './outreach-table';

/**
 * YouTube's Find creators stage, worked on the Outreach screen itself —
 * Outreach wizard 15/19 (task 86bcrmbrf).
 *
 * Find channels searches YouTube for the wizard's keywords
 * (POST /api/outreach/youtube/creators/find), then asks for a suggestion on
 * each undecided channel (…/suggest). Since SC-887 the channels are a sortable
 * table with a filter bar (search, keyword, status — Undecided by default —
 * and suggestion): one row per channel with its picture, name, subscribers,
 * matched keywords, newest videos, the suggestion (its reason on hover) and
 * square icon actions Agree / Approve / Reject / Open. Approve and Reject open the Substack Miner's
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
const STATUS_WORD: Record<YoutubeCreator['status'], string> = { candidate: 'candidate', approved: 'approved', rejected: 'rejected' };

export type CreatorSortKey = 'channel' | 'subscribers' | 'suggestion' | 'status';
export type StatusFilter = 'undecided' | 'approved' | 'rejected' | 'all';
export type SuggestionFilter = '' | 'approved' | 'rejected' | 'none';
export type CreatorFilters = { search: string; keyword: string; status: StatusFilter; suggestion: SuggestionFilter };

export const DEFAULT_FILTERS: CreatorFilters = { search: '', keyword: '', status: 'undecided', suggestion: '' };

const CONFIDENCE_RANK: Record<Suggestion['confidence'], number> = { high: 3, medium: 2, low: 1 };

/**
 * What a column sorts by. Suggestion is one scale from "surest Approve" to
 * "surest Reject", so high-to-low puts the channels most worth approving first;
 * a channel with no suggestion sorts last.
 */
export function creatorSortValue(c: YoutubeCreator, key: CreatorSortKey): SortValue {
  if (key === 'channel') return c.name || c.channelId;
  if (key === 'subscribers') return typeof c.subscriberCount === 'number' && Number.isFinite(c.subscriberCount) ? c.subscriberCount : null;
  if (key === 'status') return STATUS_WORD[c.status];
  const s = c.suggestion;
  if (!s) return null;
  return s.action === 'approved' ? 3 + CONFIDENCE_RANK[s.confidence] : 4 - CONFIDENCE_RANK[s.confidence];
}

/** The rows the filter bar lets through; every filter must pass (AND). */
export function filterCreators(list: YoutubeCreator[], f: CreatorFilters): YoutubeCreator[] {
  const needle = f.search.trim().toLowerCase();
  const keyword = f.keyword.trim().toLowerCase();
  return filterRows(list, [
    needle ? (c) => (c.name || c.channelId).toLowerCase().includes(needle) : null,
    keyword ? (c) => c.keywordsHit.some((k) => k.toLowerCase() === keyword) : null,
    f.status === 'all' ? null : (c) => (f.status === 'undecided' ? c.status === 'candidate' : c.status === f.status),
    f.suggestion === '' ? null : (c) => (f.suggestion === 'none' ? !c.suggestion : c.suggestion?.action === f.suggestion),
  ]);
}

/**
 * Why the table is empty, naming every filter in force — "No rejected channels
 * match 'yoga'" — so an empty table never reads as a broken one (landmine 17).
 */
export function emptyFilterText(f: CreatorFilters): string {
  const statusWord = f.status === 'undecided' ? 'undecided ' : f.status === 'all' ? '' : `${f.status} `;
  const parts: string[] = [];
  if (f.search.trim()) parts.push(`match '${f.search.trim()}'`);
  if (f.keyword) parts.push(`were found for '${f.keyword}'`);
  if (f.suggestion === 'none') parts.push('have no suggestion');
  else if (f.suggestion) parts.push(`have the suggestion ${ACTION_WORD[f.suggestion]}`);
  return `No ${statusWord}channels${parts.length ? ` ${parts.join(' and ')}` : ''}.`;
}

function suggestionHover(s: Suggestion): string {
  return `${s.reasons.length ? `${s.reasons.join(', ')}. ` : ''}${s.why}`.trim();
}

function CreatorRow({ creator, busy, onDecide, onAgree }: {
  creator: YoutubeCreator;
  busy: boolean;
  onDecide: (c: YoutubeCreator, d: Decision) => void;
  onAgree: (c: YoutubeCreator) => void;
}): React.ReactElement {
  const s = creator.suggestion;
  const name = creator.name || creator.channelId;
  const videos = creator.latestVideos.slice(0, 3);
  const [first, ...rest] = videos;
  const statusWord = creator.status === 'candidate' ? 'Candidate' : creator.status === 'approved' ? 'Approved' : 'Rejected';
  return (
    <tr className="yt-creator-row" data-channel-id={creator.channelId} data-status={creator.status}>
      <td className="yt-creator-channel">
        <span className="yt-creator-head">
          {creator.avatarUrl ? <img className="yt-creator-avatar" src={creator.avatarUrl} alt="" width={32} height={32} loading="lazy" /> : <span className="yt-creator-avatar" aria-hidden="true" />}
          <a className="yt-creator-name" href={creator.channelUrl} target="_blank" rel="noreferrer noopener">{name}</a>
        </span>
      </td>
      <td className="yt-creator-subs">{creator.subscriberCount === null || creator.subscriberCount === undefined || !Number.isFinite(creator.subscriberCount) ? 'hidden' : creator.subscriberCount.toLocaleString('en-US')}</td>
      <td className="yt-creator-keywords">{creator.keywordsHit.join(', ')}</td>
      <td className="yt-creator-videos">
        {first ? (
          <>
            <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(first.videoId)}`} target="_blank" rel="noreferrer noopener">{first.title || first.videoId}</a>
            {rest.length ? <span className="yt-creator-more" title={rest.map((v) => v.title || v.videoId).join('\n')}> +{rest.length} more</span> : null}
          </>
        ) : <span className="outreach-wizard-muted">none read</span>}
      </td>
      <td className="yt-creator-suggestion" data-suggestion={s?.action || ''} title={s ? suggestionHover(s) : undefined}>
        {s ? `${ACTION_WORD[s.action]} (${s.confidence})` : <span className="outreach-wizard-muted">No suggestion yet</span>}
      </td>
      <td className="yt-creator-status" title={creator.note || undefined}>
        <span className="yt-creator-status-word">{statusWord}</span>
        {creator.decisionReasons.length ? <span className="yt-creator-status-reasons"> — {creator.decisionReasons.join(', ')}</span> : null}
      </td>
      <td className="actions-col">
        <div className="table-actions-row">
          {creator.status === 'candidate' ? (
            <>
              {s ? <RowIcon glyph="agree" tone="primary" label={`Agree: ${ACTION_WORD[s.action].toLowerCase()} ${name}`} disabled={busy} onClick={() => onAgree(creator)} /> : null}
              <RowIcon glyph="approve" label={`Approve ${name}`} disabled={busy} onClick={() => onDecide(creator, 'approved')} />
              <RowIcon glyph="reject" label={`Reject ${name}`} disabled={busy} onClick={() => onDecide(creator, 'rejected')} />
            </>
          ) : null}
          <RowIcon glyph="open" label={`Open ${name} on YouTube`} href={creator.channelUrl} />
        </div>
      </td>
    </tr>
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
  const [filters, setFilters] = useState<CreatorFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState<CreatorSortKey>>(null);
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
  const keywordOptions = Array.from(new Set([...(keywords?.keywords || []), ...list.flatMap((c) => c.keywordsHit)]));
  const rows = sortRows(filterCreators(list, filters), sort, creatorSortValue);

  return (
    <div className="yt-creators" data-yt-creators>
      <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void saveKeywords(); }}>
        <label htmlFor="yt-creators-keywords">Keywords</label>
        <input id="yt-creators-keywords" type="text" className="outreach-wizard-account-input yt-creators-keywords" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-save" disabled={!!busy || !draft.trim()}>Save keywords</button>
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
      {list.length ? (
        <div className="table-wrap yt-creators-table-wrap">
          <table className="yt-creators-table">
            <thead>
              <tr className="table-filter-row">
                <th>
                  <input type="search" className="yt-creators-filter-search" placeholder="Channel" aria-label="Search channel names" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </th>
                <th />
                <th>
                  <select aria-label="Keyword" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}>
                    <option value="">Any</option>
                    {keywordOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </th>
                <th />
                <th>
                  <select aria-label="Suggestion" value={filters.suggestion} onChange={(e) => setFilters({ ...filters, suggestion: e.target.value as SuggestionFilter })}>
                    <option value="">Any</option>
                    <option value="approved">Approve</option>
                    <option value="rejected">Reject</option>
                    <option value="none">None</option>
                  </select>
                </th>
                <th>
                  <select aria-label="Status" className="yt-creators-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as StatusFilter })}>
                    <option value="undecided">Undecided</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All</option>
                  </select>
                </th>
                <th className="actions-col" />
              </tr>
              <tr>
                <SortHeader label="Channel" sortKey="channel" sort={sort} onSort={setSort} />
                <SortHeader label="Subscribers" sortKey="subscribers" sort={sort} onSort={setSort} firstDir="desc" />
                <th scope="col">Keywords</th>
                <th scope="col">Newest videos</th>
                <SortHeader label="Suggestion" sortKey="suggestion" sort={sort} onSort={setSort} firstDir="desc" />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((c) => (
                <CreatorRow
                  key={c.id}
                  creator={c}
                  busy={!!busy}
                  onDecide={(creator, decision) => { setDialogError(''); setDeciding({ creator, decision }); }}
                  onAgree={(creator) => { if (creator.suggestion) void decide(creator, creator.suggestion.action, creator.suggestion.reasons, ''); }}
                />
              )) : (
                <tr className="yt-creators-empty-row"><td colSpan={7} data-empty-filter>{emptyFilterText(filters)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
