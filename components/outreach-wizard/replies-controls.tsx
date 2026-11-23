import React, { useState } from 'react';
import ReasonPicker, { decisionNotice, rejectNotice, type DecisionFeedback, type RejectReason } from './reason-picker';
import { TODAY_SOURCES, rowContext, type Row, type TodayChannelKey } from './today-view';
import type { OutreachChannel, OutreachStage } from './outreach-wizard-panel';

/**
 * Write replies, on the Outreach screen (SC-916, Outreach wizard 19/19 slice C).
 * Four jobs, each through the channel's own endpoints, so a decision here is
 * the same decision as one made anywhere else:
 *
 *  - Work through the drafts waiting for Approve or Reject — the Today view's
 *    walk-through, started from here rather than duplicated.
 *  - Write drafts for the ideas still waiting to be written (POST …/:id/draft,
 *    one at a time). On Substack only a Note or reply has words to draft; a
 *    restack or like is never sent to the drafter (it would refuse every time).
 *  - Approve or Reject Substack's restack and like ideas as they are — they
 *    have no words, so they are decided right here.
 *  - Show the replies already decided (approved, posting, posted, failed,
 *    rejected), so a decided reply can still be found on this screen.
 *
 * Every list is read up to LIST_LIMIT rows — the same ceiling the overview
 * counts to (lib/outreachOverview.js COUNT_LIMIT), so the button never promises
 * ideas the list it then reads cannot reach.
 */

export const LIST_LIMIT = 1000;

/**
 * Write drafts writes at most this many per press. Each is an AI call of up to
 * a minute, one after another, with the stage's buttons held; a batch of a
 * thousand would hold the screen for hours with no way to stop it.
 */
export const WRITE_BATCH = 10;

/** The Substack kinds that carry words (lib/substackNotesStore.js TEXT_KINDS). */
const SUBSTACK_TEXT_KINDS = ['note', 'reply'];

/** A decided reply's status, in plain words. */
export const DECIDED_WORDS: Record<string, string> = {
  approved: 'Approved — waiting for the Mini to post it',
  posting: 'Being posted',
  posted: 'Posted',
  failed: 'Posting failed',
  rejected: 'Rejected',
};

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const api = (window as unknown as { App?: { api?: Api } }).App?.api;
  return typeof api === 'function' ? api : null;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function rowsOf(reply: Record<string, any> | null | undefined): Row[] {
  return (Array.isArray(reply?.data) ? reply!.data : []).filter((r: Row) => r && r.id);
}

/** The ideas that can be drafted: every idea, except Substack's restacks and likes. */
export function ideasFrom(rows: unknown, channel: string): Array<{ id: string }> {
  return (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r && r.status === 'idea' && r.id)
    .filter((r: any) => channel !== 'substack' || SUBSTACK_TEXT_KINDS.includes(r.kind))
    .map((r: any) => ({ id: String(r.id) }));
}

/** Substack's restack and like ideas: decided as they are, never drafted. */
export function wordlessIdeasFrom(rows: unknown): Row[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r && r.status === 'idea' && r.id && !SUBSTACK_TEXT_KINDS.includes(r.kind));
}

/** The replies already decided, newest first. */
export function decidedFrom(rows: unknown): Row[] {
  // The LATEST thing that happened to it: a rejection records no time of its
  // own, so its updatedAt is when it was rejected, and a reply rejected today
  // must sort above one approved last week.
  const when = (r: Row) => [r.postedAt, r.approvedAt, r.updatedAt, r.createdAt]
    .map((t) => String(t || '')).sort().pop() || '';
  return (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r && r.id && Object.prototype.hasOwnProperty.call(DECIDED_WORDS, r.status))
    .sort((a: Row, b: Row) => when(b).localeCompare(when(a)));
}

function kindWord(row: Row): string {
  const k = String(row.kind || 'idea');
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export default function RepliesControls({ channel, stage, onWalk, onChanged }: {
  channel: OutreachChannel;
  stage: OutreachStage & { toDecideCount?: number };
  onWalk: () => void;
  onChanged: () => void;
}): React.ReactElement | null {
  const [busy, setBusy] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [wordless, setWordless] = useState<Row[] | null>(null);
  const [decided, setDecided] = useState<Row[] | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [rejectError, setRejectError] = useState('');
  const key = channel.key as TodayChannelKey;
  const source = TODAY_SOURCES[key];
  if (stage.state === 'cannot_tell') return null;
  const waiting = stage.waitingCount || 0;
  const toWrite = stage.toWriteCount || 0;
  const batch = Math.min(toWrite, WRITE_BATCH);
  const toDecide = key === 'substack' ? stage.toDecideCount || 0 : 0;

  const readList = async (query: string): Promise<Row[]> => {
    const api = getApi();
    if (!api || !source) throw new Error('the admin app is still loading — try again in a moment');
    return rowsOf(await api(`${source.base}?${query}limit=${LIST_LIMIT}`));
  };

  const writeDrafts = async () => {
    const api = getApi();
    if (!api || !source) return;
    setBusy('write'); setLines([]); setError('');
    const out: string[] = [];
    try {
      const ideas = ideasFrom(await readList('status=idea&'), key).slice(0, WRITE_BATCH);
      let written = 0;
      for (const idea of ideas) {
        try {
          await api(`${source.base}/${encodeURIComponent(idea.id)}/draft`, { method: 'POST', body: '{}' });
          written += 1;
        } catch (err) {
          out.push(`One was not drafted: ${errorText(err)}`);
        }
      }
      out.unshift(ideas.length
        ? `${plural(written, 'draft', 'drafts')} written${written < ideas.length ? `, ${ideas.length - written} not` : ''}.${written ? ' Work through them with the button above.' : ''}`
        : 'Nothing was waiting to be written any more.');
    } catch (err) {
      out.unshift(`The ${channel.label} list could not be read, so nothing was drafted: ${errorText(err)}`);
    } finally {
      setBusy('');
      setLines(out);
      onChanged();
    }
  };

  const showWordless = async () => {
    setBusy('wordless'); setError('');
    try {
      setWordless(wordlessIdeasFrom(await readList('status=idea&')));
    } catch (err) {
      setError(`The restacks and likes could not be read: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  const decideWordless = async (row: Row, action: 'approve' | 'reject', why?: RejectReason) => {
    const api = getApi();
    if (!api || !source) return;
    setBusy(`${action}:${row.id}`); setError(''); setRejectError('');
    try {
      const reply = await api(`${source.base}/${encodeURIComponent(String(row.id))}/${action}`, {
        method: 'POST', body: JSON.stringify(action === 'reject' ? why || {} : {}),
      });
      const feedback = (reply?.data as { feedback?: DecisionFeedback })?.feedback;
      const what = kindWord(row);
      setLines([action === 'approve'
        ? decisionNotice(`${what} approved. The Mini does it within Substack's pace.`, feedback)
        : rejectNotice(`${what} rejected. It will not be done.`, feedback)]);
      setRejecting(null);
      setWordless((list) => (list || []).filter((r) => r.id !== row.id));
      onChanged();
    } catch (err) {
      const said = `${action === 'approve' ? 'Not approved' : 'Not rejected'}: ${errorText(err)}`;
      if (action === 'reject') setRejectError(said); else setError(said);
    } finally { setBusy(''); }
  };

  const toggleDecided = async () => {
    if (decided) { setDecided(null); return; }
    setBusy('decided'); setError('');
    try {
      setDecided(decidedFrom(await readList('')));
    } catch (err) {
      setError(`The decided replies could not be read: ${errorText(err)}`);
    } finally { setBusy(''); }
  };

  return (
    <div className="outreach-wizard-replies" data-replies={channel.key}>
      {waiting ? (
        <div className="outreach-wizard-stage-actions">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={onWalk}>
            {`Work through ${plural(waiting, 'waiting reply', 'waiting replies')}`}
          </button>
        </div>
      ) : null}
      {toWrite && source ? (
        <div className="outreach-wizard-stage-actions">
          <button type="button" className={waiting ? 'btn' : 'btn btn-primary'} disabled={!!busy} onClick={() => void writeDrafts()}>
            {busy === 'write' ? 'Writing drafts…' : `Write ${plural(batch, 'draft', 'drafts')}`}
          </button>
          <p className="outreach-wizard-muted">
            {toWrite > batch
              ? `Each draft takes under a minute to write. ${toWrite} ideas are waiting; this writes the first ${batch}, press again for more.`
              : 'Each draft takes under a minute to write.'}
          </p>
        </div>
      ) : null}
      {!toWrite && stage.writeBlocked ? <p className="outreach-wizard-muted" data-write-blocked>{stage.writeBlocked}</p> : null}
      {waiting ? (
        <p className="outreach-wizard-muted">Each one opens in Today, above: choose a wording, edit it if you like, then Approve or Reject. Approved replies are posted by the Mini within the channel&apos;s pace.</p>
      ) : !toWrite && !toDecide && !stage.writeBlocked ? (
        <p className="outreach-wizard-muted">{`No ${channel.label} replies are waiting for you. Replies are written from Find conversations: click Write Replies on one there, and it comes back here for your Approve or Reject.`}</p>
      ) : null}

      {toDecide ? (
        <div className="outreach-wizard-wordless" data-wordless>
          <p className="outreach-wizard-muted">
            {`${plural(toDecide, 'restack or like is', 'restacks and likes are')} waiting for your Approve or Reject. They have no words to draft, so they are decided as they are.`}
          </p>
          {wordless === null ? (
            <div className="outreach-wizard-stage-actions">
              <button type="button" className="btn" disabled={!!busy} onClick={() => void showWordless()}>
                {busy === 'wordless' ? 'Reading…' : 'Show restacks and likes'}
              </button>
            </div>
          ) : wordless.length ? (
            <ul className="outreach-wizard-reply-list">
              {wordless.map((row) => {
                const ctx = rowContext('substack', { ...row, kind: 'reply' });
                return (
                  <li key={String(row.id)} className="outreach-wizard-reply-item" data-wordless-item={String(row.id)}>
                    <p className="outreach-wizard-reply-head">
                      <strong>{kindWord(row)}</strong>
                      {ctx.url ? <> of <a href={ctx.url} target="_blank" rel="noreferrer">this Note</a></> : null}
                    </p>
                    {ctx.detail ? <p className="outreach-wizard-muted">{ctx.detail}</p> : null}
                    <div className="outreach-wizard-stage-actions">
                      <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void decideWordless(row, 'approve')}>
                        {busy === `approve:${row.id}` ? 'Approving…' : 'Approve'}
                      </button>
                      <button type="button" className="btn" disabled={!!busy} onClick={() => { setRejectError(''); setRejecting(row); }}>Reject</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="outreach-wizard-muted">No restacks or likes are waiting any more: they were decided since this page was read.</p>
          )}
        </div>
      ) : null}

      <div className="outreach-wizard-stage-actions">
        <button type="button" className="btn" disabled={!!busy} aria-expanded={!!decided} onClick={() => void toggleDecided()}>
          {busy === 'decided' ? 'Reading…' : decided ? 'Hide decided replies' : 'Show decided replies'}
        </button>
      </div>
      {decided ? (
        decided.length ? (
          <ul className="outreach-wizard-reply-list" data-decided>
            {decided.map((row) => {
              // A decided restack or like names what it acted on, not "A Note".
              const ctx = key === 'substack' && !SUBSTACK_TEXT_KINDS.includes(row.kind)
                ? { ...rowContext('substack', { ...row, kind: 'reply' }), title: `${kindWord(row)} of a Note` }
                : rowContext(key, row);
              const words = String(row.finalText || row.draftText || '');
              return (
                <li key={String(row.id)} className="outreach-wizard-reply-item" data-decided-item={String(row.id)} data-status={row.status}>
                  <p className="outreach-wizard-reply-head">
                    <strong>{DECIDED_WORDS[row.status]}</strong>
                    {' · '}
                    {ctx.url ? <a href={ctx.url} target="_blank" rel="noreferrer">{ctx.title}</a> : ctx.title}
                  </p>
                  {words ? <p className="outreach-wizard-reply-text">{words}</p> : <p className="outreach-wizard-muted">{`${kindWord(row)}, no words.`}</p>}
                  {row.status === 'failed' && row.error ? <p className="outreach-wizard-error">{String(row.error)}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="outreach-wizard-muted">{`No ${channel.label} replies have been approved or rejected yet.`}</p>
        )
      ) : null}

      {lines.map((l, i) => <p key={`${i}-${l}`} className="outreach-wizard-notice" role="status">{l}</p>)}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
      {rejecting ? (
        <ReasonPicker
          title={`Reject this ${kindWord(rejecting).toLowerCase()}? It will not be done.`}
          api={getApi()}
          busy={busy === `reject:${rejecting.id}`}
          error={rejectError}
          onCancel={() => setRejecting(null)}
          onConfirm={(why) => void decideWordless(rejecting, 'reject', why)}
        />
      ) : null}
    </div>
  );
}
