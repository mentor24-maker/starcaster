import React, { useState } from 'react';
import { SUGGESTED_WORD } from './substack-suggestion-dialog';
import { matchPostKeywords } from './match-post-keywords';
import {
  FOUND_VIA_LABELS,
  decisionWhyText,
  latestPosts,
  postDateText,
  shortDate,
  type Candidate,
  type ContactLink,
  type MinerSettings,
} from './substack-miner-panel';

/**
 * One writer, everything known about them, on one page (Substack Miner
 * upgrade 4/4, task 86bcuxwq2). The View button beside Approve opens it, at a
 * real address — `#page=acquireSubstackPage&candidate=<id>` — so it can be
 * bookmarked or pasted, and the browser's Back button returns to the list.
 *
 * It reads and decides; it never edits a writer. Approve and Reject open the
 * same SubstackDecisionDialog the list uses (the panel owns it), and Re-read
 * posts is the one fetch it starts (POST /candidates/:id/read-posts, 1/4).
 *
 * THE ADDRESS AND THE SHELL. The vanilla shell rewrites the hash to
 * `#page=<id>` whenever it activates a page — on the first load, and on every
 * Back/Forward — so a `candidate=` part would be gone before this screen could
 * read it. The panel therefore reads it at three moments the shell cannot
 * reach: when this module loads (INITIAL_CANDIDATE, before the shell's first
 * activation), from the history entry's own state on Back/Forward, and from
 * the hash itself when it is still there. It then puts the address back.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17): each section that has
 * nothing names why — posts not read, recommended by nobody, no Notes read.
 */

export const SUBSTACK_PAGE_ID = 'acquireSubstackPage';
export const CANDIDATE_PARAM = 'candidate';

/** The writer id a hash names, but only on this screen's own address. */
export function candidateFromHash(hash: string): string {
  const bare = String(hash || '').replace(/^#/, '');
  if (!bare) return '';
  const pairs = new Map<string, string>();
  for (const pair of bare.split('&')) {
    const at = pair.indexOf('=');
    if (at < 1) continue;
    let value = pair.slice(at + 1);
    try { value = decodeURIComponent(value); } catch { /* keep it as typed */ }
    pairs.set(pair.slice(0, at), value);
  }
  if (pairs.get('page') !== SUBSTACK_PAGE_ID) return '';
  return (pairs.get(CANDIDATE_PARAM) || '').trim();
}

export function candidateHash(id: string): string {
  return `#page=${SUBSTACK_PAGE_ID}&${CANDIDATE_PARAM}=${encodeURIComponent(id)}`;
}

export const LIST_HASH = `#page=${SUBSTACK_PAGE_ID}`;

/**
 * The deep link the page was OPENED with, taken when this module loads — the
 * shell strips it from the address before the panel's page is first shown.
 */
export const INITIAL_CANDIDATE: string = typeof window === 'undefined' ? '' : candidateFromHash(window.location.hash);

// Writer ids are uuids, so a mangled one pasted into the address reaches the
// database and comes back as its type error rather than as "not found". To
// Dane both mean the same thing: there is no such writer.
const NOT_FOUND = /not found|invalid input syntax for type uuid/i;

/** True when an error from GET /candidates/:id means "no such writer here". */
export function isNotFound(message: string): boolean {
  return NOT_FOUND.test(message);
}

const STATUS_LABELS: Record<string, string> = { candidate: 'Waiting for a decision', approved: 'Approved', rejected: 'Rejected' };

/**
 * A picture that removes itself when it cannot load, instead of showing the
 * browser's broken-image icon. Fixed size (the CSS class sets it, and the
 * width/height attributes reserve the room) and loaded only when scrolled into
 * view.
 */
export function WriterImage({ src, alt, className, size }: { src?: string; alt: string; className: string; size: number }): React.ReactElement | null {
  const [failed, setFailed] = useState('');
  if (!src || failed === src) return null;
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(src)}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="substack-miner-card substack-writer-section" aria-label={title}>
      <h3 className="substack-miner-card-title">{title}</h3>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="substack-miner-card-note substack-miner-muted">{children}</p>;
}

function substackUrl(handle: string): string {
  return `https://${handle}.substack.com`;
}

/** Every stored post, newest first (1/4 keeps at most 8). */
export function allPosts(c: Candidate) {
  return latestPosts(c, Number.MAX_SAFE_INTEGER);
}

/** "Also mentions" across ALL stored posts, minus the keywords that found them. */
export function alsoMentionsAll(c: Candidate, settings: Pick<MinerSettings, 'keywords' | 'widerKeywords'> | null): string[] {
  const keywords = [...(settings?.keywords || []), ...(settings?.widerKeywords || []).map((k) => k.keyword)];
  return matchPostKeywords(allPosts(c), keywords, c.keywordsHit);
}

type Props = {
  writerId: string;
  writer: Candidate | null;
  loading: boolean;
  /** The sentence GET /candidates/:id refused with; a not-found one gets its own message. */
  loadError: string;
  all: Candidate[];
  settings: MinerSettings | null;
  busy: boolean;
  rowError: string;
  link?: ContactLink;
  rereadBusy: boolean;
  rereadLines: string[];
  onBack: () => void;
  onView: (id: string) => void;
  onDecide: (decision: 'approved' | 'rejected') => void;
  onThinkAgain: () => void;
  onAgree: () => void;
  onReread: () => void;
  onOpenContact: (contactId: string, known?: Record<string, unknown>) => void;
};

export function SubstackWriterDetails(props: Props): React.ReactElement {
  const { writerId, writer: c, loading, loadError, all, settings, busy, rowError, link } = props;

  const backButton = <button type="button" className="btn" onClick={props.onBack}>Back to list</button>;

  if (!c) {
    let message: React.ReactNode;
    if (loading) message = 'Reading this writer…';
    else if (loadError && isNotFound(loadError)) message = 'No writer with that id in this project.';
    else if (loadError) message = `This writer could not be read: ${loadError}`;
    else message = 'Reading this writer…';
    return (
      <div className="substack-writer-details" data-testid="substack-writer-details" data-writer-id={writerId}>
        <p className={loadError ? 'substack-miner-error' : 'substack-miner-empty'} role={loadError ? 'alert' : undefined}>{message}</p>
        <p className="substack-miner-empty">
          <a
            href={LIST_HASH}
            className="substack-miner-link"
            onClick={(e) => { e.preventDefault(); props.onBack(); }}
          >
            Back to the list of writers
          </a>
        </p>
      </div>
    );
  }

  const posts = allPosts(c);
  const mentions = alsoMentionsAll(c, settings);
  const byHandle = new Map(all.map((w) => [w.handle, w]));
  const notes = c.recentNotes || [];
  const why = decisionWhyText(c);

  return (
    <div className="substack-writer-details" data-testid="substack-writer-details" data-writer-id={c.id}>
      {/* A div, not <header>: the admin app styles every header element as its own black banner. */}
      <div className="substack-writer-header">
        <div className="substack-writer-pictures">
          <WriterImage src={c.photoUrl} alt={`${c.name || c.handle}'s photo`} className="substack-writer-photo" size={72} />
          <WriterImage src={c.logoUrl} alt={`${c.name || c.handle}'s publication logo`} className="substack-writer-logo" size={72} />
        </div>
        <div className="substack-writer-heading">
          <h3 className="substack-writer-name">{c.name || c.handle}</h3>
          <span className="substack-miner-handle">{c.handle}</span>
          <a className="substack-miner-link" href={c.publicationUrl || substackUrl(c.handle)} target="_blank" rel="noopener noreferrer">
            Open on Substack
          </a>
          {c.description ? <p className="substack-writer-description">{c.description}</p> : null}
          <dl className="substack-writer-facts">
            <dt>Subscribers</dt><dd>{c.subscriberText || 'Not shown on their page'}</dd>
            <dt>Status</dt><dd data-testid="substack-writer-status">{STATUS_LABELS[c.status] || c.status}</dd>
            <dt>First found</dt><dd title={c.createdAt}>{shortDate(c.createdAt)}</dd>
            <dt>Last seen</dt><dd title={c.lastSeenAt || ''}>{shortDate(c.lastSeenAt)}</dd>
          </dl>
        </div>
      </div>

      <div className="substack-miner-actions substack-writer-buttons">
        {c.status === 'candidate' ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => props.onDecide('approved')}>
              {busy ? 'Saving…' : 'Approve'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => props.onDecide('rejected')}>Reject</button>
          </>
        ) : null}
        {c.status === 'approved' ? (
          <button type="button" className="btn" disabled={busy} onClick={() => props.onDecide('rejected')}>Reject</button>
        ) : null}
        {c.status === 'rejected' ? (
          <button type="button" className="btn" disabled={busy} onClick={props.onThinkAgain}>Think again</button>
        ) : null}
        <button type="button" className="btn" disabled={props.rereadBusy} onClick={props.onReread}>
          {props.rereadBusy ? 'Reading…' : 'Re-read posts'}
        </button>
        {backButton}
      </div>
      {rowError ? <p className="substack-miner-error" role="alert">{rowError}</p> : null}
      {props.rereadLines.length ? (
        <div className="substack-miner-result" role="status" aria-label="What re-reading the posts did">
          <p>{props.rereadLines[0]}</p>
          {props.rereadLines.length > 1 ? <ul>{props.rereadLines.slice(1).map((line) => <li key={line}>{line}</li>)}</ul> : null}
        </div>
      ) : null}

      <Section title="Articles">
        {!c.postsReadAt ? (
          <Muted>Posts not read yet — click Re-read posts.</Muted>
        ) : !posts.length ? (
          <Muted>No posts found when they were read on {shortDate(c.postsReadAt)}.</Muted>
        ) : (
          <ul className="substack-writer-articles">
            {posts.map((p) => (
              <li key={p.url || p.title} className="substack-writer-article">
                <WriterImage src={p.coverImage} alt="" className="substack-writer-cover" size={96} />
                <div className="substack-writer-article-text">
                  <a className="substack-miner-link substack-writer-article-title" href={p.url} target="_blank" rel="noopener noreferrer">
                    {p.title || p.url}
                  </a>
                  <span className="substack-miner-post-date" title={p.postedAt}>
                    {postDateText(p.postedAt) || 'Date unknown'}
                    {p.paid ? <span className="substack-miner-chip substack-writer-paid">Paid</span> : null}
                  </span>
                  {p.subtitle ? <span className="substack-writer-subtitle">{p.subtitle}</span> : null}
                  {p.excerpt ? <span className="substack-writer-excerpt">{p.excerpt}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Keywords">
        <p className="substack-miner-card-note">Found by searching for:</p>
        {c.keywordsHit.length ? (
          <span className="substack-miner-chips">{c.keywordsHit.map((k) => <span key={k} className="substack-miner-chip">{k}</span>)}</span>
        ) : (
          <Muted>No search keyword — this writer was found another way (see How found).</Muted>
        )}
        <p className="substack-miner-card-note">Also mentions, across every stored post:</p>
        {!c.postsReadAt ? (
          <Muted>Posts not read yet, so there is nothing to look in.</Muted>
        ) : !posts.length ? (
          <Muted>No posts to look in.</Muted>
        ) : mentions.length ? (
          <span className="substack-miner-chips" data-testid="substack-writer-mentions">{mentions.map((k) => <span key={k} className="substack-miner-chip">{k}</span>)}</span>
        ) : (
          <Muted>None of your keywords beyond the ones above.</Muted>
        )}
      </Section>

      <Section title="How found">
        <p className="substack-miner-card-note">Found via: {FOUND_VIA_LABELS[c.foundVia] || c.foundVia || 'Not recorded'}</p>
        {c.recommendedBy.length ? (
          <>
            <p className="substack-miner-card-note">Recommended by:</p>
            <ul className="substack-writer-list">
              {c.recommendedBy.map((h) => {
                const known = byHandle.get(h);
                return (
                  <li key={h}>
                    <a className="substack-miner-link" href={substackUrl(h)} target="_blank" rel="noopener noreferrer">{known?.name || h}</a>
                    {known ? (
                      <>
                        {' · '}
                        <a
                          className="substack-miner-link"
                          href={candidateHash(known.id)}
                          onClick={(e) => { e.preventDefault(); props.onView(known.id); }}
                        >
                          View
                        </a>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <Muted>Not recommended by anyone in your list.</Muted>
        )}
      </Section>

      <Section title="Notes">
        {notes.length ? (
          <ul className="substack-writer-list">
            {notes.map((n) => (
              <li key={n.url || n.text}>
                <span className="substack-miner-post-date">{shortDate(n.postedAt)}</span>{' '}
                {n.text}{' '}
                {n.url ? <a className="substack-miner-link" href={n.url} target="_blank" rel="noopener noreferrer">Open the Note</a> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>
            {c.lastNotesReadAt
              ? `No Notes found when they were read on ${shortDate(c.lastNotesReadAt)}.`
              : c.status === 'approved' ? 'No Notes read yet.' : 'No Notes read yet — Notes are read for approved writers only.'}
          </Muted>
        )}
      </Section>

      <Section title="Suggestion">
        {c.suggestion ? (
          <>
            <p className="substack-miner-card-note">
              <strong>{SUGGESTED_WORD[c.suggestion.action]}</strong>, {c.suggestion.confidence} confidence
              {c.suggestion.basedOn ? ` — learned from ${c.suggestion.basedOn} of your decisions` : ''}
            </p>
            {c.suggestion.why ? <p className="substack-miner-card-note">{c.suggestion.why}</p> : null}
            {c.suggestion.reasons.length ? (
              <span className="substack-miner-chips">{c.suggestion.reasons.map((r) => <span key={r} className="substack-miner-chip">{r}</span>)}</span>
            ) : null}
            {c.status === 'candidate' ? (
              <div className="substack-miner-actions">
                <button type="button" className="btn" disabled={busy} onClick={props.onAgree}>Agree</button>
              </div>
            ) : <Muted>Already decided, so the suggestion no longer applies.</Muted>}
          </>
        ) : (
          <Muted>
            {c.status === 'candidate'
              ? 'No suggestion yet — Run tab, Suggest decisions.'
              : 'No suggestion was made before this writer was decided.'}
          </Muted>
        )}
      </Section>

      <Section title="Decision">
        <p className="substack-miner-card-note">Status: {STATUS_LABELS[c.status] || c.status}</p>
        {c.status === 'candidate' ? <Muted>Not decided yet.</Muted> : null}
        {why ? <p className="substack-miner-card-note substack-miner-why">{why}</p> : null}
        {c.status !== 'candidate' && !why ? <Muted>No reason was given.</Muted> : null}
        {c.contactId ? (
          <p className="substack-miner-contact" role={link ? 'status' : undefined}>
            {link ? `${link.mode === 'linked' ? 'Linked to a contact already in Contacts' : 'Added to Contacts'}: ` : 'In Contacts: '}
            <a
              href="#page=contactsPage"
              className="substack-miner-link"
              onClick={(e) => { e.preventDefault(); props.onOpenContact(c.contactId, link?.contact); }}
            >
              {link?.name || 'open the contact'}
            </a>
          </p>
        ) : c.status === 'approved' ? <Muted>Approved, but no contact is linked.</Muted> : null}
      </Section>
    </div>
  );
}
