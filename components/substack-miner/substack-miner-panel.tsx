import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PROJECT_SWITCH_EVENT, splitLines } from '../substack-notes/substack-notes-panel';
import { SubstackDecisionDialog, reasonTally, type Decision } from './substack-decision-dialog';
import { SubstackSuggestionDialog, SUGGESTED_WORD, type Suggestion } from './substack-suggestion-dialog';
import { matchPostKeywords } from './match-post-keywords';

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
 * IS THE PUSH WORKING (Substack Miner 7/7, task 86bcfprya): the header adds
 * Engaged and Subscribed from GET /stats (lib/acquire/SubstackMinerStats.js),
 * and the Run tab's Import subscribers box sends Substack's subscriber export
 * to lib/acquire/SubstackSubscriberImport.js, which marks matching contacts.
 *
 * ADD BY LINK (task 86bcux874): the Candidates tab — where Outreach's Find
 * creators lands — opens with a box for pasting article, publication or
 * profile links; lib/acquire/SubstackSeedImport.js works out the writer behind
 * each. It was the Run tab's "Paste a seed list", which Dane never found there.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17): "No candidates yet. Paste
 * a link above…", "Nothing approved yet.", and a filter that hides
 * every row says which filter.
 */

const BASE = '/api/acquire/substack-miner';
const CANDIDATES_PATH = `${BASE}/candidates`;
const SETTINGS_PATH = `${BASE}/settings`;
const STATS_PATH = `${BASE}/stats`;
const SUBSCRIBERS_IMPORT_PATH = `${BASE}/subscribers/import`;
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
  /** The short reasons ticked in the Approve/Reject pop-up (task 86bch0j99). */
  decisionReasons?: string[];
  /** What the suggestion pass guessed he would decide (task 86bch3f2v); null until it has run. */
  suggestion?: Suggestion | null;
  /** Substack Miner 5/7: the writer's newest Notes as last read, and when. */
  /** Substack Miner 6/7: a Note a Notes search found them by carries keyword + foundBy. */
  recentNotes?: { url: string; text: string; postedAt: string; keyword?: string; foundBy?: string }[];
  lastNotesReadAt?: string | null;
  /** Substack Miner upgrade 1/4: the newest posts as last read (newest first, at most 8), when, and the pictures. */
  recentPosts?: RecentPost[];
  postsReadAt?: string | null;
  photoUrl?: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type RecentPost = {
  title: string;
  url: string;
  postedAt: string;
  subtitle: string;
  excerpt: string;
  coverImage: string;
  paid: boolean;
};

export type MinerSettings = {
  keywords: string[];
  /** Substack Miner upgrade 2/4: keywords not searched for, only looked for in posts. Absent until 2/4 is live. */
  widerKeywords?: string[];
  maxResultsPerKeyword: number | null;
  pauseMsBetweenFetches: number | null;
  saved: boolean;
  updatedAt: string;
};

/** GET /stats (lib/acquire/SubstackMinerStats.js). A count it could not take is null. */
export type MinerStats = {
  found: number;
  approved: number;
  rejected: number;
  inContacts: number;
  engaged: number | null;
  subscribed: number | null;
  approvedWithContact: number;
  truncated: boolean;
  unknown: Array<{ count: string; reason: string }>;
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
  { value: 'all', label: 'All' },
];

/** What each status is called in a sentence, for the empty-list messages. */
const STATUS_WORDS: Record<string, string> = { candidate: 'a candidate', approved: 'approved', rejected: 'rejected' };

export const FOUND_VIA_LABELS: Record<string, string> = {
  seed: 'Pasted link',
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

/**
 * When this writer's Notes were last read (Substack Miner 5/7). Only approved
 * writers are read, so a candidate says nothing rather than "never".
 */
export function notesReadText(c: Candidate): string {
  if (c.lastNotesReadAt) return shortDate(c.lastNotesReadAt);
  return c.status === 'approved' ? 'Not yet' : '—';
}

function notesReadTitle(c: Candidate): string {
  if (!c.lastNotesReadAt) return c.status === 'approved' ? 'This writer\'s Notes have not been read yet.' : '';
  const n = (c.recentNotes || []).length;
  return `Notes read on ${c.lastNotesReadAt} — ${n} kept`;
}

/**
 * The Note a Notes search found this writer by (Substack Miner 6/7), or null.
 * A writer first found another way still gets the chip once a Notes search
 * turns them up, because the Note is the evidence either way.
 */
export function foundInNotes(c: Candidate): { url: string; text: string; keyword: string } | null {
  const note = (c.recentNotes || []).find((n) => n.foundBy === 'notes_search');
  if (!note) return null;
  return { url: note.url, text: note.text, keyword: note.keyword || '' };
}

function FoundInNotes({ c }: { c: Candidate }) {
  const note = foundInNotes(c);
  if (!note) return null;
  const why = note.keyword ? `Found searching Notes for "${note.keyword}"` : 'Found in a Notes search';
  return (
    <details className="substack-miner-found-note">
      <summary className="substack-miner-chip" title={`${why}: ${note.text}`}>Found in Notes</summary>
      <span className="substack-miner-found-note-text">
        {why}: “{note.text}”{' '}
        <a href={note.url} target="_blank" rel="noopener noreferrer">Open the Note</a>
      </span>
    </details>
  );
}

/**
 * Why a decided writer was approved or rejected, under their name: the reasons
 * ticked in the pop-up and the sentence typed there (task 86bch0j99). A writer
 * still waiting shows nothing; neither does a decision made with no reason.
 */
export function decisionWhyText(c: Candidate): string {
  if (c.status !== 'approved' && c.status !== 'rejected') return '';
  const reasons = (c.decisionReasons || []).join(', ');
  const note = (c.note || '').trim();
  if (!reasons && !note) return '';
  const head = c.status === 'approved' ? 'Why approved' : 'Why rejected';
  return `${head}: ${[reasons, note].filter(Boolean).join(' — ')}`;
}

function DecisionWhy({ c }: { c: Candidate }) {
  const why = decisionWhyText(c);
  return why ? <span className="substack-miner-why" data-testid="substack-miner-why">{why}</span> : null;
}

/** The suggestion pass's report, in plain language (task 86bch3f2v). */
export function suggestSummaryText(s: Record<string, any> | null | undefined): string[] {
  if (!s) return [];
  const suggested = (s.suggested || []) as Array<{ name: string; action: string; confidence: string }>;
  const approve = suggested.filter((x) => x.action === 'approved').length;
  const out = [
    `Learned from ${plural(Number(s.basedOn) || 0, 'decision')} (${Number(s.approvedExamples) || 0} approved, ${Number(s.rejectedExamples) || 0} rejected). `
    + `Suggested ${suggested.length} of ${plural(Number(s.undecided) || 0, 'undecided writer')}: ${approve} approve, ${suggested.length - approve} reject.`
    + (Number(s.alreadySuggested) ? ` ${Number(s.alreadySuggested)} already had a suggestion.` : ''),
  ];
  if (suggested.length) out.push('See the Suggested column on the Candidates tab.');
  for (const x of (s.notSuggested || []) as Array<{ name: string; reason: string }>) out.push(`${x.name} was not suggested: ${x.reason}.`);
  for (const x of (s.postsUnread || []) as Array<{ name: string; reason: string }>) out.push(`${x.name} was judged from its description only — ${x.reason}.`);
  if (Number(s.notReached)) {
    out.push(s.stoppedBecause
      ? `Stopped with ${Number(s.notReached)} not reached: ${s.stoppedBecause}`
      : `${Number(s.notReached)} not reached in this run — click Suggest decisions again for the rest.`);
  }
  return out;
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
/**
 * The rows the Show filter picks. `status` 'all' is every writer; `negate`
 * (the Not box) flips the status choice only — Found via still narrows — so
 * Not Approved is the candidates and the rejected. Not All is nothing, which
 * is why the screen disables the box while All is chosen.
 */
export function visibleCandidates(candidates: Candidate[], status: string, foundVia: string, negate = false): Candidate[] {
  const statusMatch = (c: Candidate) => (status === 'all' || c.status === status) !== negate;
  return candidates
    .filter((c) => statusMatch(c) && (!foundVia || c.foundVia === foundVia))
    .sort((a, b) => {
      const byCount = (b.recommendedBy?.length || 0) - (a.recommendedBy?.length || 0);
      if (byCount) return byCount;
      return Date.parse(b.lastSeenAt || '') - Date.parse(a.lastSeenAt || '') || 0;
    });
}

/** Why the table is empty, in a sentence that names the cause. */
export function emptyText(candidates: Candidate[], status: string, foundVia: string, negate = false): string {
  const via = foundVia ? ` found via ${(FOUND_VIA_LABELS[foundVia] || foundVia).toLowerCase()}` : '';
  if (status === 'all' || negate) {
    if (!candidates.length) return 'No writers yet. Paste a link above, or add keywords on the Run tab and click Search the web.';
    if (status === 'all') return `No writers${via}. Try another "Found via" choice.`;
    return `Every writer${via || ' found'} is ${STATUS_WORDS[status] || status}, so nothing is left once those are taken out. Untick Not to see them.`;
  }
  if (status === 'approved') return foundVia ? `Nothing approved${via}.` : 'Nothing approved yet.';
  if (status === 'rejected') return foundVia ? `Nothing rejected${via}.` : 'Nothing rejected yet.';
  if (!candidates.length) return 'No candidates yet. Paste a link above, or add keywords on the Run tab and click Search the web.';
  return foundVia
    ? `No candidates waiting${via}. Try another "Found via" choice.`
    : 'No candidates waiting — every writer found has been approved or rejected. Paste a link above, or run a search or read recommendations on the Run tab for more.';
}

/**
 * The header line. Found, approved, rejected and in Contacts are counted from
 * the writers on screen, which an Approve or Reject updates in place; Engaged
 * and Subscribed come from GET /stats, and read "?" when it could not count
 * them — never 0, which would be a different answer.
 */
export function headerText(stats: MinerStats | null, candidates: Candidate[]): string {
  const c = headerCounts(candidates);
  const n = (value: number | null | undefined) => (value === null || value === undefined ? '?' : String(value));
  return `${c.found} found · ${c.approved} approved · ${c.rejected} rejected · ${c.inContacts} in Contacts`
    + ` · ${n(stats?.engaged)} engaged · ${n(stats?.subscribed)} subscribed`;
}

/** Why Engaged or Subscribed reads as it does, when the number alone would mislead. */
export function statsNotes(stats: MinerStats | null, statsError: string): string[] {
  if (!stats) return statsError ? [`Engaged and Subscribed could not be counted: ${statsError}`] : [];
  const out = stats.unknown.map((u) => `${u.count === 'engaged' ? 'Engaged' : 'Subscribed'} could not be counted. ${u.reason}`);
  if (stats.approved && stats.subscribed === 0 && !stats.approvedWithContact) {
    // Importing cannot move this: the mark lives on a contact, and none of
    // the approved writers has one.
    out.push(`Subscribed is 0: none of the ${stats.approved} approved writer${stats.approved === 1 ? ' has' : 's has'} a contact yet, so there is nothing for a subscriber list to match. Approving a writer adds their contact.`);
  } else if (stats.approved && stats.subscribed === 0 && !stats.unknown.some((u) => u.count === 'subscribed')) {
    out.push('Subscribed is 0: none of the approved writers\' contacts is marked as a subscriber yet. Import the subscriber list on the Run tab; a writer only matches once their contact has the email they subscribed with.');
  }
  return out;
}

// ── The subscriber import ──────────────────────────────────────────────────

export function subscriberSummaryText(d: Record<string, any> | null | undefined): string[] {
  if (!d) return [];
  const out = [
    `${plural(Number(d.rowsRead) || 0, 'row')} read: ${Number(d.matched) || 0} matched a contact `
    + `(${Number(d.newlyMarked) || 0} newly marked, ${Number(d.alreadyMarked) || 0} already marked), `
    + `${Number(d.unmatched) || 0} unmatched${Number(d.unreadable) ? `, ${Number(d.unreadable)} could not be read` : ''}.`,
  ];
  out.push(d.dateColumn
    ? `Emails from the "${d.emailColumn}" column, subscription dates from "${d.dateColumn}".`
    : `Emails from the "${d.emailColumn}" column. The file has no subscription-date column, so contacts newly marked carry today's date.`);
  if (Number(d.matched)) {
    out.push(Number(d.approvedWriterMatches)
      ? `${plural(Number(d.approvedWriterMatches), 'matched row')} belong${Number(d.approvedWriterMatches) === 1 ? 's' : ''} to an approved writer, so Subscribed counts ${Number(d.approvedWriterMatches) === 1 ? 'it' : 'them'}.`
      : 'None of the matched contacts is an approved writer\'s, so Subscribed does not change.');
  }
  if (d.approvedWritersKnown === false) out.push('The approved writers could not be read, so the line above may be wrong.');
  if ((d.unmatchedEmails || []).length) out.push(`Unmatched (no contact in this project has the email): ${(d.unmatchedEmails as string[]).join(', ')}${Number(d.unmatched) > d.unmatchedEmails.length ? ', …' : ''}.`);
  for (const p of (d.problems || []) as Array<{ line: number; reason: string }>) out.push(`Line ${p.line} was skipped: ${p.reason}.`);
  if (d.contactsTruncated) out.push(`Only the first ${Number(d.contactsSearched).toLocaleString()} contacts were searched; some subscribers may have matched a contact beyond them.`);
  return out;
}

// ── The seed list ──────────────────────────────────────────────────────────

export type SeedRow = { handle: string; whyFit?: string };

/**
 * One writer per line, `handle, why it fits`. The handle may be a bare name,
 * an @name, the publication's address, an article's link (on Substack or the
 * publication's own domain) or a person's substack.com/@name profile link
 * (each looked up and filed under its publication); the server decides which
 * are real.
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
  for (const r of (data?.resolved || []) as Array<{ index: number; profile?: string; link?: string; handle: string; name?: string }>) {
    const line = lines[r.index] ?? r.index + 1;
    const where = `${r.name ? `"${r.name}" at ` : ''}${r.handle}.substack.com`;
    out.push(r.profile
      ? `Line ${line}: ${r.profile} writes ${where}, so they were added under that publication.`
      : `Line ${line}: that link is from ${where}, so the writer was added under that publication.`);
  }
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

/** What "Read writers' posts" did (lib/acquire/SubstackPostsReadRun.js). */
export function postsReadSummaryText(s: Record<string, any> | null | undefined): string[] {
  if (!s) return [];
  const writers = Number(s.writers) || 0;
  const read = (s.read || []) as Array<{ name: string; posts: number }>;
  const failed = (s.failed || []) as Array<{ name: string; reason: string }>;
  if (!Number(s.due)) {
    return [writers
      ? `Nothing to read: every writer was read in the last 7 days (${plural(writers, 'writer')}).`
      : 'Nothing to read: there are no writers yet, other than rejected ones.'];
  }
  const noPosts = read.filter((r) => !r.posts).length;
  const out = [
    `Read posts for ${plural(read.length, 'writer')}`
    + (failed.length ? `; ${failed.length} could not be read` : '')
    + (noPosts ? `; ${noPosts} ${noPosts === 1 ? 'has' : 'have'} no posts yet` : '')
    + '.'
    + (Number(s.recent) ? ` ${plural(Number(s.recent), 'other writer')} ${Number(s.recent) === 1 ? 'was' : 'were'} read in the last 7 days and skipped.` : ''),
  ];
  for (const f of failed) out.push(`${f.name}: not read — ${f.reason}.`);
  const left = Number(s.notReached) || 0;
  if (left) out.push(`${plural(left, 'writer')} not reached — the run ran out of time. Click Read writers' posts again for the rest.`);
  return out;
}

/** How many posts the Latest posts column shows (upgrade 3/4). */
export const LATEST_POSTS_SHOWN = 3;

/** The newest posts, newest first, whatever order they were stored in. */
export function latestPosts(c: Candidate, count = LATEST_POSTS_SHOWN): RecentPost[] {
  return [...(c.recentPosts || [])]
    .sort((a, b) => (Date.parse(b.postedAt || '') || 0) - (Date.parse(a.postedAt || '') || 0))
    .slice(0, count);
}

/** "Oct 21, 2026 · 8 days ago" — the full date always, so a list of them lines up. */
export function postDateText(iso: string, now: Date = new Date()): string {
  const date = new Date(iso || '');
  if (Number.isNaN(date.getTime())) return '';
  const full = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86400000);
  let ago: string;
  if (days <= 0) ago = 'today';
  else if (days === 1) ago = 'yesterday';
  else if (days < 60) ago = `${days} days ago`;
  else if (days < 730) ago = `${Math.round(days / 30.44)} months ago`;
  else ago = `${Math.floor(days / 365.25)} years ago`;
  return `${full} · ${ago}`;
}

/**
 * The "Also mentions" keywords: the search list plus the wider list (2/4),
 * found in the newest posts, minus what the Keywords column already says.
 * Without a wider list it is the search list alone.
 */
export function alsoMentions(c: Candidate, settings: Pick<MinerSettings, 'keywords' | 'widerKeywords'> | null): string[] {
  const keywords = [...(settings?.keywords || []), ...(settings?.widerKeywords || [])];
  return matchPostKeywords(latestPosts(c), keywords, c.keywordsHit);
}

function LatestPosts({ c }: { c: Candidate }): React.ReactElement {
  if (!c.postsReadAt) return <span className="substack-miner-muted" title="Run tab, Read writers' posts">Posts not read yet</span>;
  const posts = latestPosts(c);
  if (!posts.length) return <span className="substack-miner-muted" title={`Posts read on ${c.postsReadAt}`}>No posts</span>;
  return (
    <div className="substack-miner-posts">
      <span className="substack-miner-post-date" title={posts[0].postedAt}>{postDateText(posts[0].postedAt) || 'Date unknown'}</span>
      <ul>
        {posts.map((p) => (
          <li key={p.url || p.title}>
            <a className="substack-miner-link substack-miner-post-title" href={p.url} target="_blank" rel="noopener noreferrer" title={p.title}>
              {p.title || p.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlsoMentions({ c, settings }: { c: Candidate; settings: MinerSettings | null }): React.ReactElement {
  // The Latest posts cell beside this one already says why there is nothing.
  if (!c.postsReadAt) return <span className="substack-miner-muted" title="Posts not read yet">—</span>;
  if (!latestPosts(c).length) return <span className="substack-miner-muted" title="No posts to read keywords from">—</span>;
  const words = alsoMentions(c, settings);
  if (!words.length) return <span className="substack-miner-muted">None beyond its keywords</span>;
  return (
    <span className="substack-miner-chips">
      {words.map((k) => <span key={k} className="substack-miner-chip">{k}</span>)}
    </span>
  );
}

// ── One row ────────────────────────────────────────────────────────────────

/** Left the list in upgrade 3/4; kept for the details page (4/4). */
export function RecommendedBy({ handles }: { handles: string[] }): React.ReactElement {
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
  const [negateFilter, setNegateFilter] = useState(false);
  const [foundViaFilter, setFoundViaFilter] = useState('');
  const [rowBusy, setRowBusy] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string }>({ id: '', message: '' });
  const [deciding, setDeciding] = useState<{ candidate: Candidate; decision: Decision } | null>(null);
  const [viewingSuggestion, setViewingSuggestion] = useState<Candidate | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestLines, setSuggestLines] = useState<string[]>([]);
  const [suggestRedo, setSuggestRedo] = useState(false);
  const [links, setLinks] = useState<Record<string, ContactLink>>({});
  const [keywordsText, setKeywordsText] = useState('');
  const [keywordsBusy, setKeywordsBusy] = useState(false);
  const [keywordsMessage, setKeywordsMessage] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchLines, setSearchLines] = useState<string[]>([]);
  const [snowballBusy, setSnowballBusy] = useState(false);
  const [snowballLines, setSnowballLines] = useState<string[]>([]);
  const [postsBusy, setPostsBusy] = useState(false);
  const [postsLines, setPostsLines] = useState<string[]>([]);
  const [seedText, setSeedText] = useState('');
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedLines, setSeedLines] = useState<string[]>([]);
  const [stats, setStats] = useState<MinerStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvLines, setCsvLines] = useState<string[]>([]);

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const [list, saved, counted] = await Promise.allSettled([
      api(`${CANDIDATES_PATH}?limit=${LIST_LIMIT}`), api(SETTINGS_PATH), api(STATS_PATH),
    ]);
    if (seq !== requestSeq.current) return;
    if (counted.status === 'fulfilled') {
      setStats((counted.value?.data as MinerStats) || null);
      setStatsError('');
    } else {
      setStats(null);
      setStatsError(errorText(counted.reason, 'unknown error'));
    }
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

  /** Re-read only the counts — after an Approve or Reject, which can move Subscribed. */
  const refreshStats = useCallback(async () => {
    const api = getApi();
    if (!api) return;
    const seq = requestSeq.current;
    try {
      const reply = await api(STATS_PATH);
      if (seq !== requestSeq.current) return;
      setStats((reply?.data as MinerStats) || null);
      setStatsError('');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setStats(null);
      setStatsError(errorText(err, 'unknown error'));
    }
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
      setDeciding(null);
      setViewingSuggestion(null);
      setSuggestLines([]);
      setLinks({});
      setKeywordsText('');
      setKeywordsMessage('');
      setSearchLines([]);
      setSnowballLines([]);
      setPostsLines([]);
      // A half-pasted seed list belongs to the old project; Add must not file it here.
      setSeedText('');
      setSeedLines([]);
      setStats(null);
      setStatsError('');
      // A pasted subscriber list belongs to the old project too.
      setCsvText('');
      setCsvLines([]);
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
      void refreshStats();
      return data;
    } catch (err) {
      if (epoch !== projectEpoch.current) return null;
      setRowError({ id: candidate.id, message: errorText(err, 'unknown error') });
      return null;
    } finally {
      if (epoch === projectEpoch.current) setRowBusy('');
    }
  };

  /**
   * Approve and Reject ask why first (task 86bch0j99). The pop-up stays open
   * if the save fails, so what he typed is not lost; the error shows inside it.
   */
  const confirmDecision = async (note: string, reasons: string[]) => {
    if (!deciding) return;
    const { candidate: c, decision } = deciding;
    const body: Record<string, unknown> = { status: decision, note };
    // Reasons ride along only when there is something to say: a database
    // without the decision_reasons column still approves and rejects.
    if (reasons.length || (c.decisionReasons || []).length) body.decisionReasons = reasons;
    const data = await patchRow(c, body);
    if (!data) return;
    if (data.contact) setLinks((m) => ({ ...m, [c.id]: data.contact as ContactLink }));
    setDeciding(null);
  };
  const decide = (c: Candidate, status: string) => void patchRow(c, { status });

  /** Agree: make the suggested decision with the suggested reasons, as if he had ticked them. */
  const agree = async (c: Candidate) => {
    const s = c.suggestion;
    if (!s) return;
    const body: Record<string, unknown> = { status: s.action };
    if (s.reasons.length || (c.decisionReasons || []).length) body.decisionReasons = s.reasons;
    const data = await patchRow(c, body);
    if (!data) return;
    if (data.contact) setLinks((m) => ({ ...m, [c.id]: data.contact as ContactLink }));
    setViewingSuggestion(null);
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
  const runPass = async (path: string, setBusy: (b: boolean) => void, setLines: (l: string[]) => void, describe: (d: any) => string[], what: string, body: Record<string, unknown> = {}) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setBusy(true);
    setLines([]);
    try {
      const reply = await api(path, { method: 'POST', body: JSON.stringify(body) });
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

  const importSubscribers = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getApi();
    if (!api || !csvText.trim()) return;
    const epoch = projectEpoch.current;
    setCsvBusy(true);
    setCsvLines([]);
    try {
      const reply = await api(SUBSCRIBERS_IMPORT_PATH, { method: 'POST', body: JSON.stringify({ csv: csvText }) });
      if (epoch !== projectEpoch.current) return;
      setCsvLines(subscriberSummaryText(reply?.data));
      void load();
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setCsvLines([`Nothing was imported: ${errorText(err, 'unknown error')}`]);
    } finally {
      if (epoch === projectEpoch.current) setCsvBusy(false);
    }
  };

  const readCsvFile = (file: File | undefined) => {
    if (!file) return;
    const epoch = projectEpoch.current;
    file.text().then(
      (text) => { if (epoch === projectEpoch.current) { setCsvText(text); setCsvLines([]); } },
      (err) => { if (epoch === projectEpoch.current) setCsvLines([`The file could not be read: ${errorText(err, 'unknown error')}`]); },
    );
  };

  const all = candidates || [];
  const counts = headerCounts(all);
  // Not All would always be empty; the box is disabled then, and ignored.
  const negate = negateFilter && statusFilter !== 'all';
  const rows = visibleCandidates(all, statusFilter, foundViaFilter, negate);
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
          ? headerText(stats, all)
          : (loading ? 'Reading the writers found…' : 'The writers found have not been read.')}
      </p>
      {candidates ? statsNotes(stats, statsError).map((line) => (
        <p key={line} className="substack-miner-note" data-testid="substack-miner-stats-note">{line}</p>
      )) : null}
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
          <form className="substack-miner-card" aria-label="Add writers by link" onSubmit={addSeeds}>
            <label className="substack-miner-card-title" htmlFor="sm-seeds">Add writers by link</label>
            <p className="substack-miner-card-note">
              Paste one link per line — an article, a publication's address, or a person's profile (substack.com/@name) — and the
              writer behind it is added as a candidate. Links on a publication's own domain work too. To say why a writer fits,
              add a comma and a few words after the link.
            </p>
            <textarea
              id="sm-seeds"
              rows={3}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder={'https://www.example.com/p/an-article, writes about tennis coaching\nhttps://substack.com/@name'}
            />
            <div className="substack-miner-actions">
              <button type="submit" className="btn btn-primary" disabled={seedBusy || !parseSeedLines(seedText).rows.length}>
                {seedBusy ? 'Adding…' : 'Add writers'}
              </button>
            </div>
            <RunResult lines={seedLines} label="What adding the writers did" />
          </form>

          <div className="substack-miner-filters">
            <div className="substack-miner-filter" role="group" aria-label="Show filter">
              <span>Show</span>
              <label className="substack-miner-not" title={statusFilter === 'all' ? 'Not All would show nothing' : 'Show every writer except these'}>
                <input
                  type="checkbox"
                  aria-label="Not"
                  checked={negate}
                  disabled={statusFilter === 'all'}
                  onChange={(e) => setNegateFilter(e.target.checked)}
                />
                <span>Not</span>
              </label>
              <select aria-label="Show" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <label className="substack-miner-filter">
              <span>Found via</span>
              <select aria-label="Found via" value={foundViaFilter} onChange={(e) => setFoundViaFilter(e.target.value)}>
                <option value="">Any way</option>
                {Object.entries(FOUND_VIA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          {candidates && !rows.length ? (
            <p className="substack-miner-empty">{emptyText(all, statusFilter, foundViaFilter, negate)}</p>
          ) : null}

          {rows.length ? (
            <div className="table-wrap substack-miner-table-wrap">
              <table className="substack-miner-table">
                <thead>
                  <tr>
                    <th scope="col">Writer</th>
                    <th scope="col">Subscribers</th>
                    <th scope="col">Keywords</th>
                    <th scope="col">Latest posts</th>
                    <th scope="col">Also mentions</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Notes read</th>
                    <th scope="col">Suggested</th>
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
                          <FoundInNotes c={c} />
                          <DecisionWhy c={c} />
                        </td>
                        <td>{c.subscriberText || '—'}</td>
                        <td>
                          {c.keywordsHit.length ? (
                            <span className="substack-miner-chips">
                              {c.keywordsHit.map((k) => <span key={k} className="substack-miner-chip">{k}</span>)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="substack-miner-posts-cell"><LatestPosts c={c} /></td>
                        <td><AlsoMentions c={c} settings={settings} /></td>
                        <td className="substack-miner-date-cell" title={c.lastSeenAt || ''}>{shortDate(c.lastSeenAt)}</td>
                        <td title={notesReadTitle(c)}>{notesReadText(c)}</td>
                        <td className="substack-miner-suggested-cell">
                          {c.status === 'candidate' && c.suggestion ? (
                            <>
                              <button
                                type="button"
                                className="substack-miner-suggested-word"
                                data-action={c.suggestion.action}
                                title={`${c.suggestion.confidence} confidence — click to see the reasons`}
                                onClick={() => setViewingSuggestion(c)}
                              >
                                {SUGGESTED_WORD[c.suggestion.action]}
                              </button>
                              <span className="substack-miner-suggested-confidence">{c.suggestion.confidence}</span>
                              <button type="button" className="btn tiny-btn" disabled={busy} onClick={() => void agree(c)}>Agree</button>
                            </>
                          ) : (
                            <span title={c.status === 'candidate' ? 'Not suggested yet — Run tab, Suggest decisions' : 'Already decided'}>—</span>
                          )}
                        </td>
                        <td className="actions-col">
                          <div className="table-actions-row">
                            {c.status === 'candidate' ? (
                              <>
                                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setDeciding({ candidate: c, decision: 'approved' })}>
                                  {busy ? 'Saving…' : 'Approve'}
                                </button>
                                <button type="button" className="btn" disabled={busy} onClick={() => setDeciding({ candidate: c, decision: 'rejected' })}>Reject</button>
                              </>
                            ) : null}
                            {c.status === 'approved' ? (
                              <button type="button" className="btn" disabled={busy} onClick={() => setDeciding({ candidate: c, decision: 'rejected' })}>Reject</button>
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
                          {rowError.id === c.id && deciding?.candidate.id !== c.id ? <p className="substack-miner-error" role="alert">{rowError.message}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {viewingSuggestion?.suggestion ? (
            <SubstackSuggestionDialog
              key={viewingSuggestion.id}
              suggestion={viewingSuggestion.suggestion}
              writerName={viewingSuggestion.name || viewingSuggestion.handle}
              busy={rowBusy === viewingSuggestion.id}
              error={rowError.id === viewingSuggestion.id ? rowError.message : ''}
              onClose={() => { setViewingSuggestion(null); setRowError({ id: '', message: '' }); }}
              onAgree={() => void agree(viewingSuggestion)}
            />
          ) : null}
          {deciding ? (
            <SubstackDecisionDialog
              key={`${deciding.candidate.id}-${deciding.decision}`}
              decision={deciding.decision}
              writerName={deciding.candidate.name || deciding.candidate.handle}
              // A note typed while the writer was still waiting is about this
              // decision; one from the opposite decision is not, so it starts blank.
              initialNote={deciding.candidate.status === 'candidate' ? deciding.candidate.note : ''}
              offered={reasonTally(all, deciding.decision)}
              busy={rowBusy === deciding.candidate.id}
              error={rowError.id === deciding.candidate.id ? rowError.message : ''}
              onCancel={() => { setDeciding(null); setRowError({ id: '', message: '' }); }}
              onConfirm={(note, reasons) => void confirmDecision(note, reasons)}
            />
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

          <section className="substack-miner-card" aria-label="Suggest decisions">
            <h3 className="substack-miner-card-title">Suggest decisions</h3>
            <p className="substack-miner-card-note">
              Reads each undecided writer's newest posts and suggests Approve or Reject, with reasons, from the decisions you have
              already made. Nothing is decided until you click Agree on the Candidates tab. Each writer is one paid AI call.
            </p>
            <label className="substack-miner-not">
              <input type="checkbox" checked={suggestRedo} onChange={(e) => setSuggestRedo(e.target.checked)} />
              <span>Suggest again for writers that already have a suggestion</span>
            </label>
            <div className="substack-miner-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={suggestBusy}
                onClick={() => void runPass(`${BASE}/suggest`, setSuggestBusy, setSuggestLines, suggestSummaryText, 'Suggesting', suggestRedo ? { redo: true } : {})}
              >
                {suggestBusy ? 'Suggesting… (about 5 seconds a writer)' : 'Suggest decisions'}
              </button>
            </div>
            <RunResult lines={suggestLines} label="What suggesting did" />
          </section>

          <section className="substack-miner-card" aria-label="Read writers' posts">
            <h3 className="substack-miner-card-title">Read writers' posts</h3>
            <p className="substack-miner-card-note">
              Keeps each writer's newest posts, their photo and their publication's logo, for every writer you have not rejected.
              A writer read in the last 7 days is skipped. It reads Substack gently, so it can take a few minutes; it also runs by itself once a day.
            </p>
            <div className="substack-miner-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={postsBusy}
                onClick={() => void runPass(`${BASE}/read-posts`, setPostsBusy, setPostsLines, postsReadSummaryText, "Reading writers' posts")}
              >
                {postsBusy ? 'Reading…' : "Read writers' posts"}
              </button>
            </div>
            <RunResult lines={postsLines} label="What reading posts did" />
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

          <form className="substack-miner-card" aria-label="Import subscribers" onSubmit={importSubscribers}>
            <label className="substack-miner-card-title" htmlFor="sm-subscribers">Import subscribers</label>
            <p className="substack-miner-card-note">
              Download the subscriber list from your Substack dashboard (Subscribers, then Export) and choose the file or paste it here.
              Each email that belongs to a contact marks that contact as a subscriber; emails with no contact are counted, never added.
            </p>
            <input
              type="file"
              className="substack-miner-file"
              accept=".csv,text/csv"
              aria-label="Choose the subscriber export"
              onChange={(e) => { readCsvFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <textarea id="sm-subscribers" rows={5} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder="email,subscription_date" />
            <div className="substack-miner-actions">
              <button type="submit" className="btn btn-primary" disabled={csvBusy || !csvText.trim()}>
                {csvBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
            <RunResult lines={csvLines} label="What the subscriber import did" />
          </form>
        </div>
      ) : null}
    </div>
  );
}
