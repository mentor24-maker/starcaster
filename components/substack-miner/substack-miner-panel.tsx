import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PROJECT_SWITCH_EVENT, splitLines } from '../substack-notes/substack-notes-panel';

/**
 * Acquire › Substack Miner — where Dane sees every Substack writer Starcaster
 * found, approves or rejects each one, and runs the search and the snowball.
 * Substack Miner 4/7 (task 86bcfprxq).
 *
 * A React island in the frozen vanilla app, mounted into
 * #substackMinerReactRoot by react-entry.js. Data: /api/acquire/substack-miner
 * (routes/substackMiner.js over lib/substackMinerStore.js, slice 1/7). The
 * web search is slice 2's run, the snowball slice 3's.
 *
 * APPROVE PUTS THE WRITER IN CONTACTS, on the server
 * (lib/acquire/SubstackContactCapture.js): one contact per publication per
 * project, linked rather than duplicated. The row then says "Added to
 * Contacts" with a link that opens the contact.
 *
 * The shape is components/substack-notes/substack-notes-panel.tsx's on
 * purpose: the server owns every rule and this screen shows its sentence when
 * it refuses; it (re)loads when its page is SHOWN and when the project is
 * SWITCHED, and drops a reply that lands after a newer request or a switch.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17): "No candidates yet. Add
 * keywords on the Run tab…", "Nothing approved yet.", and a filter that hides
 * every row says which filter.
 */

const BASE = '/api/acquire/substack-miner';
const CANDIDATES_PATH = `${BASE}/candidates`;
const SETTINGS_PATH = `${BASE}/settings`;
/** The store's own ceiling for one list (lib/storeLimit.js). */
export const LIST_LIMIT = 1000;

export type Candidate = {
  id: string;
  handle: string;
  publicationUrl: string;
  name: string;
  description: string;
  subscriberText: string;
  keywordsHit: string[];
  foundVia: string;
  recommendedBy: string[];
  lastSeenAt: string | null;
  status: string;
  contactId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type MinerSettings = {
  keywords: string[];
  maxResultsPerKeyword: number | null;
  pauseMsBetweenFetches: number | null;
  saved: boolean;
  updatedAt: string;
};

export type ContactLink = { id: string; name: string; mode: string; contact?: Record<string, unknown> };

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
  setActivePage?: (pageId: string) => void;
  contacts?: { openViewPage?: (contact: unknown) => void };
};

function getApp(): AppShape | null {
  return (window as unknown as { App?: AppShape }).App || null;
}

function getApi(): AppShape['api'] | null {
  const app = getApp();
  return typeof app?.api === 'function' ? app.api : null;
}

export const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'candidate', label: 'Candidates' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export const FOUND_VIA_LABELS: Record<string, string> = {
  seed: 'Seed list',
  web_search: 'Web search',
  recommendations: 'Recommendations',
  notes_search: 'Notes search',
};

const FIELD_WORDS: Array<[RegExp, string]> = [
  [/\bpublicationUrl\b/g, 'The publication address'],
  [/\bkeywordsHit\b/g, 'Keywords'],
  [/\bwhyFit\b/g, 'Why it fits'],
  [/\bkeywords\b/g, 'Keywords'],
];

export function plainError(message: string): string {
  return FIELD_WORDS.reduce((text, [pattern, words]) => text.replace(pattern, words), message);
}

function errorText(err: unknown, fallback: string): string {
  return plainError(err instanceof Error && err.message ? err.message : fallback);
}

/** "Oct 9" this year, "Oct 9, 2025" otherwise (UI_RULES T7 rung 7); the full date is on hover. */
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Counting, filtering, sorting ───────────────────────────────────────────

export function headerCounts(candidates: Candidate[]): { found: number; approved: number; rejected: number; inContacts: number } {
  return {
    found: candidates.length,
    approved: candidates.filter((c) => c.status === 'approved').length,
    rejected: candidates.filter((c) => c.status === 'rejected').length,
    inContacts: candidates.filter((c) => Boolean(c.contactId)).length,
  };
}

/** Most recommended first; ties go to the one seen most recently. */
export function visibleCandidates(candidates: Candidate[], status: string, foundVia: string): Candidate[] {
  return candidates
    .filter((c) => c.status === status && (!foundVia || c.foundVia === foundVia))
    .sort((a, b) => {
      const byCount = (b.recommendedBy?.length || 0) - (a.recommendedBy?.length || 0);
      if (byCount) return byCount;
      return Date.parse(b.lastSeenAt || '') - Date.parse(a.lastSeenAt || '') || 0;
    });
}

/** Why the table is empty, in a sentence that names the cause. */
export function emptyText(candidates: Candidate[], status: string, foundVia: string): string {
  const via = foundVia ? ` found via ${(FOUND_VIA_LABELS[foundVia] || foundVia).toLowerCase()}` : '';
  if (status === 'approved') return foundVia ? `Nothing approved${via}.` : 'Nothing approved yet.';
  if (status === 'rejected') return foundVia ? `Nothing rejected${via}.` : 'Nothing rejected yet.';
  if (!candidates.length) return 'No candidates yet. Add keywords on the Run tab and click Search the web.';
  return foundVia
    ? `No candidates waiting${via}. Try another "Found via" choice.`
    : 'No candidates waiting — every writer found has been approved or rejected. Run a search or read recommendations on the Run tab for more.';
}

// ── The seed list ──────────────────────────────────────────────────────────

export type SeedRow = { handle: string; whyFit?: string };

/**
 * One writer per line, `handle, why it fits`. The handle may be a bare name,
 * an @name or the publication's address; the server decides which are real.
 * Blank lines are dropped, and `lines` maps each row back to the line it came
 * from so a refusal can name the line Dane typed.
 */
export function parseSeedLines(text: string): { rows: SeedRow[]; lines: number[] } {
  const rows: SeedRow[] = [];
  const lines: number[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const comma = line.indexOf(',');
    const handle = (comma === -1 ? line : line.slice(0, comma)).trim();
    const whyFit = comma === -1 ? '' : line.slice(comma + 1).trim();
    rows.push(whyFit ? { handle, whyFit } : { handle });
    lines.push(index + 1);
  });
  return { rows, lines };
}

export function seedSummaryText(data: Record<string, any> | null | undefined, lines: number[]): string[] {
  const added = Number(data?.added) || 0;
  const merged = Number(data?.merged) || 0;
  const out = [`${added} added${merged ? `, ${merged} already here (their details were brought up to date)` : ''}.`];
  for (const r of (data?.refusals || []) as Array<{ index: number; handle?: string; error: string }>) {
    const line = lines[r.index] ?? r.index + 1;
    out.push(`Line ${line}${r.handle ? ` (${r.handle})` : ''} was not added: ${plainError(r.error)}`);
  }
  return out;
}

// ── What a run did, in plain language ──────────────────────────────────────

export function searchSummaryText(s: Record<string, any> | null | undefined): string[] {
  if (!s) return [];
  const searched: string[] = s.keywordsSearched || [];
  const out = [
    `Searched ${plural(searched.length, 'keyword')}${s.engine ? ` with ${s.engine}` : ''}: ${plural(Number(s.resultsSeen) || 0, 'result')}, `
    + `${plural(Number(s.handlesFound) || 0, 'writer')} found — ${Number(s.added) || 0} new, ${Number(s.merged) || 0} already here.`,
  ];
  if (Number(s.droppedNotSubstack)) out.push(`${plural(Number(s.droppedNotSubstack), 'result')} pointed somewhere other than a Substack publication and ${Number(s.droppedNotSubstack) === 1 ? 'was' : 'were'} skipped.`);
  for (const e of (s.searchErrors || []) as Array<{ keyword: string; error: string }>) out.push(`The search for "${e.keyword}" failed: ${e.error}`);
  if ((s.keywordsNotSearched || []).length) out.push(`Not searched — the run ran out of time: ${(s.keywordsNotSearched as string[]).join(', ')}. Click Search the web again for these.`);
  for (const p of (s.unreadablePages || []) as Array<{ handle: string; reason: string }>) out.push(`${p.handle}: front page not read (${p.reason}). The writer is saved anyway.`);
  for (const r of (s.refused || []) as Array<{ handle: string; error: string }>) out.push(`${r.handle} was not saved: ${plainError(r.error)}`);
  return out;
}

export function snowballSummaryText(s: Record<string, any> | null | undefined): string[] {
  if (!s) return [];
  const out = [
    `Read the recommendations of ${Number(s.sourcesRead) || 0} of ${plural(Number(s.sourcesRequested) || 0, 'approved writer')}: `
    + `${plural(Number(s.linksFound) || 0, 'writer')} recommended — ${Number(s.added) || 0} new, ${Number(s.merged) || 0} already here.`,
  ];
  for (const src of (s.sources || []) as Array<{ handle: string; read: string; httpStatus?: number; reason?: string }>) {
    if (src.read === 'failed') out.push(`${src.handle}: recommendations page could not be read${src.httpStatus ? ` (HTTP ${src.httpStatus})` : ''} — ${src.reason}.`);
  }
  for (const n of (s.notRead || []) as Array<{ handle: string; reason: string }>) out.push(`${n.handle}: ${n.reason}.`);
  if (Number(s.skippedNotSubstack)) out.push(`${plural(Number(s.skippedNotSubstack), 'recommendation')} on a publication's own domain ${Number(s.skippedNotSubstack) === 1 ? 'was' : 'were'} skipped — the address does not say which Substack it is.`);
  for (const r of (s.refused || []) as Array<{ handle: string; error: string }>) out.push(`${r.handle} was not saved: ${plainError(r.error)}`);
  return out;
}

// ── One row ────────────────────────────────────────────────────────────────

function RecommendedBy({ handles }: { handles: string[] }): React.ReactElement {
  if (!handles.length) return <span>0</span>;
  return (
    <details className="substack-miner-recommended">
      <summary title={handles.join(', ')}>{handles.length}</summary>
      <ul>{handles.map((h) => <li key={h}>{h}</li>)}</ul>
    </details>
  );
}

function RunResult({ lines, label }: { lines: string[]; label: string }): React.ReactElement | null {
  if (!lines.length) return null;
  return (
    <div className="substack-miner-result" role="status" aria-label={label}>
      <p>{lines[0]}</p>
      {lines.length > 1 ? <ul>{lines.slice(1).map((line) => <li key={line}>{line}</li>)}</ul> : null}
    </div>
  );
}

type Tab = 'candidates' | 'run';

export default function SubstackMinerPanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  // Bumped on every project switch; a write started under one project checks
  // it before showing its reply, so the old project's row never lands here.
  const projectEpoch = useRef(0);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [settings, setSettings] = useState<MinerSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('candidates');
  const [statusFilter, setStatusFilter] = useState('candidate');
  const [foundViaFilter, setFoundViaFilter] = useState('');
  const [rowBusy, setRowBusy] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string }>({ id: '', message: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, ContactLink>>({});
  const [keywordsText, setKeywordsText] = useState('');
  const [keywordsBusy, setKeywordsBusy] = useState(false);
  const [keywordsMessage, setKeywordsMessage] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchLines, setSearchLines] = useState<string[]>([]);
  const [snowballBusy, setSnowballBusy] = useState(false);
  const [snowballLines, setSnowballLines] = useState<string[]>([]);
  const [seedText, setSeedText] = useState('');
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedLines, setSeedLines] = useState<string[]>([]);

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const [list, saved] = await Promise.allSettled([api(`${CANDIDATES_PATH}?limit=${LIST_LIMIT}`), api(SETTINGS_PATH)]);
    if (seq !== requestSeq.current) return;
    const problems: string[] = [];
    if (list.status === 'fulfilled') {
      setCandidates(Array.isArray(list.value?.data) ? (list.value.data as Candidate[]) : []);
    } else {
      setCandidates(null);
      problems.push(`The writers found could not be read: ${errorText(list.reason, 'unknown error')}`);
    }
    if (saved.status === 'fulfilled') {
      const next = (saved.value?.data as MinerSettings) || null;
      setSettings(next);
      setKeywordsText((next?.keywords || []).join('\n'));
    } else {
      setSettings(null);
      problems.push(`The keyword list could not be read: ${errorText(saved.reason, 'unknown error')}`);
    }
    setError(problems.join(' '));
    setLoading(false);
  }, []);

  // Load each time the page is shown.
  useEffect(() => {
    const page = hostRef.current?.closest('.app-page');
    const visible = () => !page || !page.classList.contains('hidden');
    if (visible()) void load();
    if (!page || typeof MutationObserver === 'undefined') return undefined;
    let wasVisible = visible();
    const observer = new MutationObserver(() => {
      const now = visible();
      if (now && !wasVisible) void load();
      wasVisible = now;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [load]);

  // A project switch: drop the old project's rows at once and read the new one's.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      projectEpoch.current += 1;
      setCandidates(null);
      setSettings(null);
      setError('');
      setLoading(false);
      setRowBusy('');
      setRowError({ id: '', message: '' });
      setNotes({});
      setLinks({});
      setKeywordsText('');
      setKeywordsMessage('');
      setSearchLines([]);
      setSnowballLines([]);
      // A half-pasted seed list belongs to the old project; Add must not file it here.
      setSeedText('');
      setSeedLines([]);
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  const replaceRow = (row: Candidate) => {
    setCandidates((list) => (list || []).map((c) => (c.id === row.id ? row : c)));
  };

  /** PATCH one writer; the server's answer replaces the row. */
  const patchRow = async (candidate: Candidate, body: Record<string, unknown>): Promise<Record<string, any> | null> => {
    const api = getApi();
    if (!api) return null;
    const epoch = projectEpoch.current;
    setRowBusy(candidate.id);
    setRowError({ id: '', message: '' });
    try {
      const reply = await api(`${CANDIDATES_PATH}/${encodeURIComponent(candidate.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (epoch !== projectEpoch.current) return null;
      const data = reply?.data as Record<string, any>;
      const { contact, ...row } = data || {};
      replaceRow(row as Candidate);
      return data;
    } catch (err) {
      if (epoch !== projectEpoch.current) return null;
      setRowError({ id: candidate.id, message: errorText(err, 'unknown error') });
      return null;
    } finally {
      if (epoch === projectEpoch.current) setRowBusy('');
    }
  };

  const noteFor = (c: Candidate) => (notes[c.id] !== undefined ? notes[c.id] : c.note);
  const noteChanged = (c: Candidate) => notes[c.id] !== undefined && notes[c.id] !== c.note;
  const withNote = (c: Candidate, body: Record<string, unknown>) => (noteChanged(c) ? { ...body, note: notes[c.id] } : body);

  const approve = async (c: Candidate) => {
    const data = await patchRow(c, withNote(c, { status: 'approved' }));
    if (data?.contact) setLinks((m) => ({ ...m, [c.id]: data.contact as ContactLink }));
  };
  const decide = (c: Candidate, status: string) => void patchRow(c, withNote(c, { status }));
  const saveNote = (c: Candidate) => {
    if (noteChanged(c) && rowBusy !== c.id) void patchRow(c, { note: notes[c.id] });
  };

  const openContact = async (contactId: string, known?: Record<string, unknown>) => {
    const app = getApp();
    if (!app) return;
    let contact = known;
    if (!contact && app.api) {
      try {
        const reply = await app.api(`/api/contacts/${encodeURIComponent(contactId)}`);
        contact = reply?.data as Record<string, unknown>;
      } catch (err) {
        setError(`The contact could not be opened: ${errorText(err, 'unknown error')}`);
        return;
      }
    }
    if (contact && typeof app.contacts?.openViewPage === 'function') app.contacts.openViewPage(contact);
    else app.setActivePage?.('contactsPage');
  };

  const saveKeywords = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setKeywordsBusy(true);
    setKeywordsMessage('');
    try {
      const reply = await api(SETTINGS_PATH, { method: 'PUT', body: JSON.stringify({ keywords: splitLines(keywordsText) }) });
      if (epoch !== projectEpoch.current) return;
      const next = reply?.data as MinerSettings;
      setSettings(next);
      setKeywordsText((next?.keywords || []).join('\n'));
      setKeywordsMessage(`Saved ${plural((next?.keywords || []).length, 'keyword')}.`);
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setKeywordsMessage(`Not saved: ${errorText(err, 'unknown error')}`);
    } finally {
      if (epoch === projectEpoch.current) setKeywordsBusy(false);
    }
  };

  /** POST a run; its summary is shown, then the list is read again. */
  const runPass = async (path: string, setBusy: (b: boolean) => void, setLines: (l: string[]) => void, describe: (d: any) => string[], what: string) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setBusy(true);
    setLines([]);
    try {
      const reply = await api(path, { method: 'POST', body: JSON.stringify({}) });
      if (epoch !== projectEpoch.current) return;
      setLines(describe(reply?.data));
      void load();
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setLines([`${what} did not run: ${errorText(err, 'unknown error')}`]);
    } finally {
      if (epoch === projectEpoch.current) setBusy(false);
    }
  };

  const addSeeds = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getApi();
    if (!api) return;
    const { rows, lines } = parseSeedLines(seedText);
    if (!rows.length) return;
    const epoch = projectEpoch.current;
    setSeedBusy(true);
    setSeedLines([]);
    try {
      const reply = await api(`${CANDIDATES_PATH}/import`, { method: 'POST', body: JSON.stringify({ candidates: rows }) });
      if (epoch !== projectEpoch.current) return;
      setSeedLines(seedSummaryText(reply?.data, lines));
      if (!(reply?.data?.refused)) setSeedText('');
      void load();
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setSeedLines([`Nothing was added: ${errorText(err, 'unknown error')}`]);
    } finally {
      if (epoch === projectEpoch.current) setSeedBusy(false);
    }
  };

  const all = candidates || [];
  const counts = headerCounts(all);
  const rows = visibleCandidates(all, statusFilter, foundViaFilter);
  const keywordsDirty = settings ? keywordsText.trim() !== (settings.keywords || []).join('\n').trim() : false;
  const approvedCount = counts.approved;

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      className={`btn${tab === value ? ' btn-primary' : ''}`}
      aria-selected={tab === value}
      onClick={() => setTab(value)}
    >
      {label}
    </button>
  );

  return (
    <div ref={hostRef} className="substack-miner-panel">
      <p className="substack-miner-counts" data-testid="substack-miner-counts">
        {candidates
          ? `${counts.found} found · ${counts.approved} approved · ${counts.rejected} rejected · ${counts.inContacts} in Contacts`
          : (loading ? 'Reading the writers found…' : 'The writers found have not been read.')}
      </p>
      {candidates && candidates.length >= LIST_LIMIT ? (
        <p className="substack-miner-note">Showing the {LIST_LIMIT.toLocaleString()} most recently seen writers; the counts above cover those only.</p>
      ) : null}

      <div className="substack-miner-toolbar">
        <div className="substack-miner-tabs" role="tablist" aria-label="Substack Miner">
          {tabButton('candidates', 'Candidates')}
          {tabButton('run', 'Run')}
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="substack-miner-error" role="alert">{error}</p> : null}

      {tab === 'candidates' ? (
        <div className="substack-miner-tabpanel" role="tabpanel" aria-label="Candidates">
          <div className="substack-miner-filters">
            <label className="substack-miner-filter">
              <span>Show</span>
              <select aria-label="Show" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="substack-miner-filter">
              <span>Found via</span>
              <select aria-label="Found via" value={foundViaFilter} onChange={(e) => setFoundViaFilter(e.target.value)}>
                <option value="">Any way</option>
                {Object.entries(FOUND_VIA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          {candidates && !rows.length ? (
            <p className="substack-miner-empty">{emptyText(all, statusFilter, foundViaFilter)}</p>
          ) : null}

          {rows.length ? (
            <div className="table-wrap substack-miner-table-wrap">
              <table className="substack-miner-table">
                <thead>
                  <tr>
                    <th scope="col">Writer</th>
                    <th scope="col">Subscribers</th>
                    <th scope="col">Keywords</th>
                    <th scope="col">Recommended by</th>
                    <th scope="col">Found via</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Note</th>
                    <th scope="col" className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const busy = rowBusy === c.id;
                    const link = links[c.id];
                    return (
                      <tr key={c.id} data-candidate-id={c.id} data-handle={c.handle}>
                        <td className="substack-miner-name-cell">
                          <a className="substack-miner-link" href={c.publicationUrl} target="_blank" rel="noopener noreferrer">{c.name || c.handle}</a>
                          {/* The handle beneath the name, as a slug beneath a title (UI_RULES T7 rung 3). */}
                          <span className="substack-miner-handle">{c.handle}</span>
                          {c.description ? <span className="substack-miner-description">{c.description}</span> : null}
                        </td>
                        <td>{c.subscriberText || '—'}</td>
                        <td>
                          {c.keywordsHit.length ? (
                            <span className="substack-miner-chips">
                              {c.keywordsHit.map((k) => <span key={k} className="substack-miner-chip">{k}</span>)}
                            </span>
                          ) : '—'}
                        </td>
                        <td><RecommendedBy handles={c.recommendedBy || []} /></td>
                        <td>{FOUND_VIA_LABELS[c.foundVia] || c.foundVia}</td>
                        <td title={c.lastSeenAt || ''}>{shortDate(c.lastSeenAt)}</td>
                        <td>
                          <input
                            type="text"
                            className="substack-miner-note-input"
                            aria-label={`Note on ${c.name || c.handle}`}
                            value={noteFor(c)}
                            disabled={busy}
                            onChange={(e) => setNotes((m) => ({ ...m, [c.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            onBlur={(e) => {
                              // Approve and Reject carry the note themselves; saving it
                              // here too would disable the button being clicked.
                              const next = e.relatedTarget as HTMLElement | null;
                              if (next?.tagName === 'BUTTON' && next.closest('tr') === e.currentTarget.closest('tr')) return;
                              saveNote(c);
                            }}
                          />
                        </td>
                        <td className="actions-col">
                          <div className="table-actions-row">
                            {c.status === 'candidate' ? (
                              <>
                                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void approve(c)}>
                                  {busy ? 'Saving…' : 'Approve'}
                                </button>
                                <button type="button" className="btn" disabled={busy} onClick={() => decide(c, 'rejected')}>Reject</button>
                              </>
                            ) : null}
                            {c.status === 'approved' ? (
                              <button type="button" className="btn" disabled={busy} onClick={() => decide(c, 'rejected')}>Reject</button>
                            ) : null}
                            {c.status === 'rejected' ? (
                              <button type="button" className="btn" disabled={busy} onClick={() => decide(c, 'candidate')}>Think again</button>
                            ) : null}
                          </div>
                          {c.contactId ? (
                            <p className="substack-miner-contact" role={link ? 'status' : undefined}>
                              {link ? `${link.mode === 'linked' ? 'Linked to a contact already in Contacts' : 'Added to Contacts'}: ` : 'In Contacts: '}
                              <a
                                href="#page=contactsPage"
                                className="substack-miner-link"
                                onClick={(e) => { e.preventDefault(); void openContact(c.contactId, link?.contact); }}
                              >
                                {link?.name || 'open the contact'}
                              </a>
                            </p>
                          ) : null}
                          {rowError.id === c.id ? <p className="substack-miner-error" role="alert">{rowError.message}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'run' ? (
        <div className="substack-miner-tabpanel" role="tabpanel" aria-label="Run">
          <form className="substack-miner-card" aria-label="Keywords" onSubmit={saveKeywords}>
            <label className="substack-miner-card-title" htmlFor="sm-keywords">Keywords</label>
            <p className="substack-miner-card-note">
              {settings && !settings.saved
                ? 'No keywords saved yet. One per line — the web search looks for Substack writers who use them.'
                : 'One per line. The web search looks for Substack writers who use them.'}
            </p>
            <textarea id="sm-keywords" rows={5} value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} disabled={!settings} />
            {keywordsMessage ? <p className="substack-miner-card-note" role="status">{keywordsMessage}</p> : null}
            <div className="substack-miner-actions">
              <button type="submit" className="btn btn-primary" disabled={keywordsBusy || !settings || !keywordsDirty}>
                {keywordsBusy ? 'Saving…' : 'Save keywords'}
              </button>
            </div>
          </form>

          <section className="substack-miner-card" aria-label="Search the web">
            <h3 className="substack-miner-card-title">Search the web</h3>
            <p className="substack-miner-card-note">
              {keywordsDirty
                ? 'Save the keywords first — the search uses the saved list.'
                : (settings?.keywords?.length
                  ? `Searches the web for Substack writers using ${plural(settings.keywords.length, 'saved keyword')}. It can take a few minutes.`
                  : 'There are no saved keywords to search with yet. Add some above and save them.')}
            </p>
            <div className="substack-miner-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={searchBusy || keywordsDirty || !settings?.keywords?.length}
                onClick={() => void runPass(`${BASE}/run`, setSearchBusy, setSearchLines, searchSummaryText, 'The search')}
              >
                {searchBusy ? 'Searching…' : 'Search the web'}
              </button>
            </div>
            <RunResult lines={searchLines} label="What the search did" />
          </section>

          <section className="substack-miner-card" aria-label="Read recommendations">
            <h3 className="substack-miner-card-title">Read recommendations of approved writers</h3>
            <p className="substack-miner-card-note">
              {approvedCount
                ? `Reads the publications each of your ${plural(approvedCount, 'approved writer')} recommends and adds them as candidates.`
                : 'Nothing approved yet. Approve a writer on the Candidates tab, then their recommendations can be read.'}
            </p>
            <div className="substack-miner-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={snowballBusy || !approvedCount}
                onClick={() => void runPass(`${BASE}/snowball`, setSnowballBusy, setSnowballLines, snowballSummaryText, 'Reading recommendations')}
              >
                {snowballBusy ? 'Reading…' : 'Read recommendations of approved writers'}
              </button>
            </div>
            <RunResult lines={snowballLines} label="What reading recommendations did" />
          </section>

          <form className="substack-miner-card" aria-label="Paste a seed list" onSubmit={addSeeds}>
            <label className="substack-miner-card-title" htmlFor="sm-seeds">Paste a seed list</label>
            <p className="substack-miner-card-note">One writer per line: <code>handle, why it fits</code>. The handle is the part before .substack.com, or paste the address.</p>
            <textarea id="sm-seeds" rows={5} value={seedText} onChange={(e) => setSeedText(e.target.value)} />
            <div className="substack-miner-actions">
              <button type="submit" className="btn btn-primary" disabled={seedBusy || !parseSeedLines(seedText).rows.length}>
                {seedBusy ? 'Adding…' : 'Add seeds'}
              </button>
            </div>
            <RunResult lines={seedLines} label="What adding the seeds did" />
          </form>
        </div>
      ) : null}
    </div>
  );
}
