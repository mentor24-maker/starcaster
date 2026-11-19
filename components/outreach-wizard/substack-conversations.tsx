import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReasonPicker, { type RejectReason } from './reason-picker';
import { RowIcon, SortHeader, filterRows, sortRows, type SortState, type SortValue } from './outreach-table';

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
 * Since SC-889 the Notes are a sortable table with a filter bar (search,
 * Keyword, Writer, Writers approved/all, Reply), one row per Note, best rank
 * first, built from the shared pieces in outreach-table.tsx; the actions are
 * square RowIcons and a row's own message sits in a full-width line under it.
 *
 * A reading that has not come back says "Cannot tell" and names the writers —
 * an empty list is never drawn as "0 found" unless every approved writer was
 * read in the last 8 days (lib/substackConversations.js readingVerdict).
 *
 * The count above the list is the stage's sentence, which the wizard reads
 * from the overview. So every action that changes the list calls `onChanged`
 * for the wizard to re-read it, and the wizard hands the new overview's time
 * back as `version` — the list then re-reads too, in place, keeping its notice.
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

/**
 * What to say once the reply call answers. `drafted: false` means the reply was
 * already a draft and nothing new was written — saying "Replies written" then
 * would claim work that did not happen.
 */
export function replyNotice(c: Conversation, reply: Record<string, any> | null | undefined): string {
  if (reply?.data?.drafted === false) return `Already drafted — open ${c.writer.name}'s reply on the Substack Notes screen.`;
  return `Replies written for ${c.writer.name}'s Note — choose one on the Substack Notes screen.`;
}

type Props = {
  /** Something on the list changed: re-read the stage sentence above it. */
  onChanged?: () => void;
  /** The overview's time; a new one re-reads the list in place. */
  version?: string;
};

/**
 * A Note's text cut to `max` characters at the last space before the limit,
 * so a word is never sliced in half; a run with no space in it (a long link)
 * is cut where the limit falls. The full text goes on the cell's hover.
 */
export function cutBetweenWords(text: string, max = 160): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  const cut = space > max * 0.5 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,.;:!?—-]+$/, '')}…`;
}

export type ConversationSortKey = 'posted' | 'rank' | 'writer' | 'keyword';
export type WritersFilter = 'approved' | 'all';
export type ReplyFilter = 'not_replied' | 'waiting' | 'all';
export type ConversationFilters = { search: string; keyword: string; writer: string; writers: WritersFilter; reply: ReplyFilter };

export const DEFAULT_FILTERS: ConversationFilters = { search: '', keyword: '', writer: '', writers: 'all', reply: 'all' };
/** Best rank first, the order the server ranked them in. */
export const DEFAULT_SORT: SortState<ConversationSortKey> = { key: 'rank', dir: 'desc' };

/** What the Reply column says. A reply already lined up or drafted is waiting on him. */
export function replyStatusText(c: Conversation): string {
  if (c.replyStatus === 'draft') return 'Drafted';
  if (c.replyStatus === 'idea') return 'Lined up';
  if (c.replyStatus) return c.replyStatus;
  return 'Not replied';
}

/** What a column sorts by. A Note with no date (a keyword search shows none) sorts last. */
export function conversationSortValue(c: Conversation, key: ConversationSortKey): SortValue {
  if (key === 'rank') return Number.isFinite(c.score) ? c.score : null;
  if (key === 'writer') return c.writer.name || c.writer.handle || null;
  if (key === 'keyword') return c.keyword || null;
  const when = Date.parse(c.postedAt || '');
  return Number.isFinite(when) ? when : null;
}

/** The distinct values a select offers, first spelling kept, repeats ignoring case dropped. */
function distinct(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw || '').trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

export function keywordOptions(items: Conversation[]): string[] {
  return distinct(items.map((c) => c.keyword));
}

export function writerOptions(items: Conversation[]): string[] {
  return distinct(items.map((c) => c.writer.name || c.writer.handle));
}

/** The rows the filter bar lets through; every filter must pass (AND). */
export function filterConversations(items: Conversation[], f: ConversationFilters): Conversation[] {
  const needle = f.search.trim().toLowerCase();
  const keyword = f.keyword.trim().toLowerCase();
  const writer = f.writer.trim().toLowerCase();
  return filterRows(items, [
    needle ? (c) => [c.text, c.writer.name, c.writer.handle, c.author.handle].some((v) => String(v || '').toLowerCase().includes(needle)) : null,
    keyword ? (c) => (c.keyword || '').toLowerCase() === keyword : null,
    writer ? (c) => (c.writer.name || c.writer.handle).toLowerCase() === writer : null,
    f.writers === 'approved' ? (c) => c.approved : null,
    f.reply === 'not_replied' ? (c) => !c.replyStatus : null,
    f.reply === 'waiting' ? (c) => Boolean(c.replyStatus) : null,
  ]);
}

/**
 * Why the table is empty, naming every filter in force — "No Notes from
 * approved writers found by 'yoga' that are not replied to" — so an empty
 * table never reads as a broken one (landmine 17).
 */
export function emptyFilterText(f: ConversationFilters): string {
  const parts: string[] = [];
  if (f.writer) parts.push(`from ${f.writer}`);
  else if (f.writers === 'approved') parts.push('from approved writers');
  if (f.keyword) parts.push(`found by '${f.keyword}'`);
  if (f.search.trim()) parts.push(`matching '${f.search.trim()}'`);
  if (f.reply === 'not_replied') parts.push('that are not replied to');
  if (f.reply === 'waiting') parts.push('with a reply waiting');
  const why = f.writers === 'approved' && !f.writer
    ? ' Notes a keyword found from writers you have not approved are hidden; set Writers to All to see them.'
    : ' Clear a filter to see the rest.';
  return `No Notes ${parts.join(' ')}.${why}`.replace('No Notes .', 'No Notes.');
}

function postedText(c: Conversation): { text: string; title?: string } {
  const when = Date.parse(c.postedAt || '');
  if (Number.isFinite(when)) return { text: new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), title: new Date(when).toLocaleString('en-US') };
  const found = Date.parse(c.foundAt || '');
  return { text: 'Not dated', title: Number.isFinite(found) ? `Substack's search shows no date. Found ${new Date(found).toLocaleString('en-US')}.` : "Substack's search shows no date." };
}

const COLUMNS = 8;

export default function SubstackConversations({ onChanged, version }: Props = {}): React.ReactElement {
  const [data, setData] = useState<ConversationsReply | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<{ url: string; action: string } | null>(null);
  const [rowError, setRowError] = useState<{ url: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [skipping, setSkipping] = useState<Conversation | null>(null);
  const [filters, setFilters] = useState<ConversationFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState<ConversationSortKey>>(DEFAULT_SORT);
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

  useEffect(() => { void load(); }, [load, version]);

  const items = data?.items || [];
  const keywords = keywordOptions(items);
  const writers = writerOptions(items);
  // A select whose choice has left the list (the Note was skipped, say)
  // would show "Any" while still hiding rows, so it is cleared.
  const staleKeyword = Boolean(filters.keyword) && !keywords.some((k) => k.toLowerCase() === filters.keyword.toLowerCase());
  const staleWriter = Boolean(filters.writer) && !writers.some((w) => w.toLowerCase() === filters.writer.toLowerCase());
  useEffect(() => {
    if (data && (staleKeyword || staleWriter)) {
      setFilters((f) => ({ ...f, keyword: staleKeyword ? '' : f.keyword, writer: staleWriter ? '' : f.writer }));
    }
  }, [data, staleKeyword, staleWriter]);

  const post = async (path: string, body: unknown, method = 'POST') => {
    const api = getApp()?.api;
    if (typeof api !== 'function') throw new Error('the admin app is still loading');
    return api(path, { method, body: JSON.stringify(body) });
  };

  const writeReplies = async (c: Conversation) => {
    setBusy({ url: c.url, action: 'reply' });
    setRowError(null);
    try {
      const reply = await post(`${CONVERSATIONS_PATH}/reply`, { url: c.url });
      setNotice(replyNotice(c, reply));
      const app = getApp();
      if (typeof app?.setActivePage === 'function') app.setActivePage(NOTES_PAGE);
      onChanged?.();
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
      onChanged?.();
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
      onChanged?.();
    } catch (err) {
      setRowError({ url: c.url, message: `${c.writer.name} was not added: ${errorText(err, 'unknown error')}` });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="outreach-wizard-error" role="alert">{error}</p>;
  if (!data) return <p className="outreach-wizard-muted">{loading ? 'Reading the Notes found so far…' : ''}</p>;

  const rows = sortRows(filterConversations(items, filters), sort, conversationSortValue);

  return (
    <div className="outreach-conversations substack-conversations" data-reading={data.reading.state}>
      {/* No headline of its own: the stage's sentence above IS the headline —
          how many, or why it cannot tell (lib/outreachOverview.js
          conversationsStage) — so the two can never disagree. */}
      {data.canon && !data.canon.ok ? (
        <p className="outreach-wizard-muted">{`Ranked without your canon, so no Note scores for fitting it: ${data.canon.error}`}</p>
      ) : null}
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {items.length ? (
        <div className="table-wrap substack-conversations-table-wrap">
          <table className="substack-conversations-table">
            {/* Fixed column widths (src/css/_outreach-wizard.css): a long Note
                or an unbroken name wraps inside its column and can never
                push Actions off the card at 1280 (SC-887's lesson). */}
            <colgroup>
              <col className="substack-conversations-col-note" />
              <col className="substack-conversations-col-writer" />
              <col className="substack-conversations-col-author" />
              <col className="substack-conversations-col-keyword" />
              <col className="substack-conversations-col-posted" />
              <col className="substack-conversations-col-rank" />
              <col className="substack-conversations-col-reply" />
              <col className="substack-conversations-col-actions" />
            </colgroup>
            <thead>
              <tr className="table-filter-row">
                <th>
                  <input type="search" placeholder="Search" aria-label="Search the Notes" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </th>
                <th>
                  <select aria-label="Writer" value={filters.writer} onChange={(e) => setFilters({ ...filters, writer: e.target.value })}>
                    <option value="">Any</option>
                    {writers.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </th>
                <th>
                  <select aria-label="Writers" value={filters.writers} onChange={(e) => setFilters({ ...filters, writers: e.target.value as WritersFilter })}>
                    <option value="all">All</option>
                    <option value="approved">Approved only</option>
                  </select>
                </th>
                <th>
                  <select aria-label="Keyword" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}>
                    <option value="">Any</option>
                    {keywords.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </th>
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
                <th scope="col">Note</th>
                <SortHeader label="Writer" sortKey="writer" sort={sort} onSort={setSort} />
                <th scope="col">Author</th>
                <SortHeader label="Keyword" sortKey="keyword" sort={sort} onSort={setSort} />
                <SortHeader label="Posted" sortKey="posted" sort={sort} onSort={setSort} firstDir="desc" />
                <SortHeader label="Rank" sortKey="rank" sort={sort} onSort={setSort} firstDir="desc" />
                <th scope="col">Reply</th>
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((c) => {
                const name = c.writer.name || c.writer.handle;
                const posted = postedText(c);
                const message = rowError?.url === c.url && !skipping ? rowError.message : '';
                const disabled = Boolean(busy);
                return (
                  <React.Fragment key={c.url}>
                    <tr className="substack-conversation-row" data-score={c.score} data-approved={c.approved ? 'true' : 'false'}>
                      <td className="substack-conversation-note" title={c.text || undefined}>
                        {c.text ? cutBetweenWords(c.text) : <span className="outreach-wizard-muted">No text read</span>}
                      </td>
                      <td className="substack-conversation-writer">
                        <a href={c.writer.publicationUrl} target="_blank" rel="noreferrer noopener">{name}</a>
                        {c.approved ? <span className="substack-conversation-badge" data-badge="approved">approved</span> : null}
                      </td>
                      <td className="substack-conversation-author">
                        <a href={c.author.profileUrl} target="_blank" rel="noreferrer noopener">{c.author.handle ? `@${c.author.handle}` : name}</a>
                      </td>
                      <td className="substack-conversation-keyword">{c.keyword || <span className="outreach-wizard-muted">their own Note</span>}</td>
                      <td className="substack-conversation-posted" title={posted.title}>{posted.text}</td>
                      <td className="substack-conversation-rank" title={c.reason || undefined}>{c.score}</td>
                      <td className="substack-conversation-reply" data-reply={c.replyStatus || 'none'}>{replyStatusText(c)}</td>
                      <td className="actions-col">
                        <div className="table-actions-row">
                          <RowIcon glyph="write" tone="primary" label={`${replyLabel(c)} to ${name}'s Note`} disabled={disabled} onClick={() => void writeReplies(c)} />
                          <RowIcon glyph="skip" label={`Skip ${name}'s Note`} disabled={disabled} onClick={() => { setRowError(null); setSkipping(c); }} />
                          {c.writer.status === 'candidate' ? (
                            <RowIcon glyph="contact" label={`Add Writer ${name}`} disabled={disabled} onClick={() => void addWriter(c)} />
                          ) : null}
                          <RowIcon glyph="open" label={`Open ${name}'s Note on Substack`} href={c.url} />
                        </div>
                      </td>
                    </tr>
                    {message ? (
                      <tr className="substack-conversation-message-row">
                        <td colSpan={COLUMNS}><p className="outreach-wizard-error" role="alert">{message}</p></td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              }) : (
                <tr className="substack-conversations-empty-row"><td colSpan={COLUMNS} data-empty-filter>{emptyFilterText(filters)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
