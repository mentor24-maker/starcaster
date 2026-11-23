import React, { useCallback, useEffect, useState } from 'react';
import { SubstackDecisionDialog, reasonTally, type Decision } from '../substack-miner/substack-decision-dialog';
import {
  parseSeedLines,
  plainError,
  searchSummaryText,
  seedSummaryText,
  type Candidate,
} from '../substack-miner/substack-miner-panel';
import { RowIcon, SortHeader, filterRows, sortRows, type SortState, type SortValue } from './outreach-table';
import { KEYWORDS_PATH, type Keywords } from './youtube-creators';

/**
 * Substack's Find creators stage, worked on the Outreach screen itself —
 * Outreach wizard 19/19, slice C (task SC-916). Until now this stage's button
 * opened Acquire › Substack Miner.
 *
 * It does what that screen does for this step and nothing more: paste a
 * writer's link, search the web for writers on the wizard's keywords, and
 * Approve or Reject each writer found. Every call is the Miner's own endpoint
 * (/api/acquire/substack-miner, routes/substackMiner.js), so a decision here
 * IS the decision there — Approve still puts the writer in Contacts, on the
 * server — and the "why?" window is the Miner's own, so a reason means the
 * same thing on both screens.
 *
 * The search is sent the wizard's shared keywords (GET /api/outreach/keywords:
 * the saved list, else the Miner's own), so one keyword list drives all three
 * channels.
 *
 * Empty is always explained (landmine 17): no writers yet, and a filter that
 * hides every row, each say so.
 */

export const WRITERS_PATH = '/api/acquire/substack-miner/candidates';
export const RUN_PATH = '/api/acquire/substack-miner/run';

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const app = (window as unknown as { App?: { api?: Api } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error';
}

export type WriterStatusFilter = 'undecided' | 'approved' | 'rejected' | 'all';
export type WriterSortKey = 'writer' | 'status';

const STATUS_WORD: Record<string, string> = { candidate: 'Candidate', approved: 'Approved', rejected: 'Rejected' };

/** The rows the status filter keeps. "Undecided" is the Miner's `candidate`. */
export function writersShown(list: Candidate[], status: WriterStatusFilter): Candidate[] {
  return filterRows(list, [
    status === 'all' ? null : (c) => c.status === (status === 'undecided' ? 'candidate' : status),
  ]);
}

/** Why the table is empty under a filter, said plainly. */
export function writersEmptyText(status: WriterStatusFilter): string {
  if (status === 'undecided') return 'No writers waiting for your decision. Set Status to All to see the ones already decided.';
  if (status === 'all') return 'No writers found yet.';
  return `No ${status} writers yet.`;
}

function writerSortValue(c: Candidate, key: WriterSortKey): SortValue {
  if (key === 'status') return c.status;
  return (c.name || c.handle || '').toLowerCase();
}

function writerName(c: Candidate): string {
  return c.name || c.handle || c.publicationUrl;
}

export default function SubstackWriters({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const [writers, setWriters] = useState<Candidate[] | null>(null);
  const [keywords, setKeywords] = useState<Keywords | null>(null);
  const [readError, setReadError] = useState('');
  const [seedText, setSeedText] = useState('');
  const [busy, setBusy] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<WriterStatusFilter>('undecided');
  const [sort, setSort] = useState<SortState<WriterSortKey>>(null);
  const [deciding, setDeciding] = useState<{ writer: Candidate; decision: Decision } | null>(null);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) { setReadError('The admin app is still loading — try again in a moment.'); return; }
    const [list, words] = await Promise.allSettled([api(`${WRITERS_PATH}?limit=1000`), api(KEYWORDS_PATH)]);
    if (list.status === 'fulfilled') {
      setWriters(Array.isArray(list.value?.data) ? (list.value.data as Candidate[]) : []);
      setReadError('');
    } else {
      setWriters(null);
      setReadError(`The Substack writer list could not be read: ${errorText(list.reason)}`);
    }
    setKeywords(words.status === 'fulfilled' ? ((words.value?.data as Keywords) || null) : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, body: unknown, method = 'POST') => {
    const api = getApi();
    if (!api) throw new Error('The admin app is still loading — try again in a moment.');
    return api(path, { method, body: JSON.stringify(body || {}) });
  };

  const addLinks = async () => {
    const { rows, lines: at } = parseSeedLines(seedText);
    if (!rows.length) return;
    setBusy('add'); setError(''); setLines([]);
    try {
      const reply = await call(`${WRITERS_PATH}/import`, { candidates: rows });
      setLines(seedSummaryText(reply?.data, at));
      if (!reply?.data?.refused) setSeedText('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(`Nothing was added: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const findWriters = async () => {
    setBusy('find'); setError(''); setLines([]);
    try {
      const reply = await call(RUN_PATH, { keywords: keywords?.keywords || [] });
      setLines(searchSummaryText(reply?.data));
      await load();
      onChanged?.();
    } catch (err) {
      setError(`The web was not searched: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const decide = async (writer: Candidate, decision: Decision, reasons: string[], note: string): Promise<boolean> => {
    setBusy(writer.id); setDialogError('');
    const body: Record<string, unknown> = { status: decision, note };
    // As on the Miner: reasons ride along only when there is something to say.
    if (reasons.length || (writer.decisionReasons || []).length) body.decisionReasons = reasons;
    try {
      const reply = await call(`${WRITERS_PATH}/${encodeURIComponent(writer.id)}`, body, 'PATCH');
      const { contact, ...row } = (reply?.data || {}) as Record<string, any>;
      setWriters((list) => (list || []).map((c) => (c.id === writer.id ? ({ ...c, ...row } as Candidate) : c)));
      const name = writerName(writer);
      setLines([decision === 'approved'
        ? `${name} approved${contact ? ' and added to Contacts' : ''}. Their newest Notes are read within about two hours, and the ones worth replying to show in Find conversations.`
        : `${name} rejected.`]);
      onChanged?.();
      return true;
    } catch (err) {
      setDialogError(`The decision was not saved: ${plainError(errorText(err))}`);
      return false;
    } finally { setBusy(''); }
  };

  const list = writers || [];
  const counts = {
    waiting: list.filter((c) => c.status === 'candidate').length,
    approved: list.filter((c) => c.status === 'approved').length,
    rejected: list.filter((c) => c.status === 'rejected').length,
  };
  const rows = sortRows(writersShown(list, status), sort, writerSortValue);
  const keywordList = keywords?.keywords || [];

  return (
    <div className="substack-writers" data-substack-writers>
      <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void addLinks(); }}>
        <label htmlFor="substack-writers-links">Writer Links</label>
        <textarea
          id="substack-writers-links"
          className="outreach-wizard-account-input substack-writers-links"
          rows={2}
          placeholder="One per line: an article, publication or profile link"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
        />
        <button type="submit" className="btn btn-save" disabled={!!busy || !seedText.trim()}>{busy === 'add' ? 'Adding…' : 'Add writers'}</button>
      </form>
      <p className="outreach-wizard-muted">
        {keywordList.length
          ? `Find writers searches the web for Substack writers on your keywords: ${keywordList.join(', ')}. It can take a few minutes.`
          : 'No keywords yet, so there is nothing to search for. Add them under Getting started above, or in YouTube\'s Find creators — the three channels share one list.'}
      </p>
      <div className="outreach-wizard-stage-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy || !keywordList.length} onClick={() => void findWriters()}>
          {busy === 'find' ? 'Searching the web…' : 'Find writers'}
        </button>
      </div>
      {lines.map((l) => <p key={l} className="outreach-wizard-notice" role="status">{l}</p>)}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
      {readError ? <p className="outreach-wizard-error" role="alert">{readError}</p> : null}
      {writers ? (
        <p className="outreach-wizard-muted" data-writer-counts>
          {list.length
            ? `${counts.waiting} waiting for your decision, ${counts.approved} approved, ${counts.rejected} rejected.`
            : 'No writers found yet. Paste a writer\'s link above, or Find writers.'}
        </p>
      ) : null}
      {list.length ? (
        <div className="table-wrap substack-writers-table-wrap">
          <table className="substack-writers-table">
            <colgroup>
              <col className="substack-writers-col-writer" />
              <col className="substack-writers-col-subs" />
              <col className="substack-writers-col-keywords" />
              <col className="substack-writers-col-status" />
              <col className="substack-writers-col-actions" />
            </colgroup>
            <thead>
              <tr className="table-filter-row">
                <th />
                <th />
                <th />
                <th>
                  <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as WriterStatusFilter)}>
                    <option value="undecided">Undecided</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All</option>
                  </select>
                </th>
                <th className="actions-col" />
              </tr>
              <tr>
                <SortHeader label="Writer" sortKey="writer" sort={sort} onSort={setSort} />
                <th scope="col">Subscribers</th>
                <th scope="col">Keywords</th>
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((w) => {
                const name = writerName(w);
                return (
                  <tr key={w.id} className="substack-writer-row" data-writer-id={w.id} data-status={w.status}>
                    <td className="substack-writer-name">
                      <strong>{name}</strong>
                      {w.description ? <span className="substack-writer-description">{w.description}</span> : null}
                    </td>
                    <td>{w.subscriberText || <span className="outreach-wizard-muted">not shown</span>}</td>
                    <td>{(w.keywordsHit || []).join(', ')}</td>
                    <td>
                      {STATUS_WORD[w.status] || w.status}
                      {(w.decisionReasons || []).length ? <span className="outreach-wizard-muted"> — {(w.decisionReasons || []).join(', ')}</span> : null}
                    </td>
                    <td className="actions-col">
                      <div className="table-actions-row">
                        {w.status === 'candidate' ? (
                          <>
                            <RowIcon glyph="approve" label={`Approve ${name}`} disabled={!!busy} onClick={() => { setDialogError(''); setDeciding({ writer: w, decision: 'approved' }); }} />
                            <RowIcon glyph="reject" label={`Reject ${name}`} disabled={!!busy} onClick={() => { setDialogError(''); setDeciding({ writer: w, decision: 'rejected' }); }} />
                          </>
                        ) : null}
                        {w.publicationUrl ? <RowIcon glyph="open" label={`Open ${name} on Substack`} href={w.publicationUrl} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr className="substack-writers-empty-row"><td colSpan={5} data-empty-filter>{writersEmptyText(status)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {deciding ? (
        <SubstackDecisionDialog
          decision={deciding.decision}
          writerName={writerName(deciding.writer)}
          initialNote={deciding.writer.note || ''}
          offered={reasonTally(list, deciding.decision)}
          busy={busy === deciding.writer.id}
          error={dialogError}
          onCancel={() => setDeciding(null)}
          onConfirm={(note, reasons) => {
            void decide(deciding.writer, deciding.decision, reasons, note).then((ok) => { if (ok) setDeciding(null); });
          }}
        />
      ) : null}
    </div>
  );
}
