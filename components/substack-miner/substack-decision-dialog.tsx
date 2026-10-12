/**
 * Why Dane approved or rejected a writer (task 86bch0j99). Approve and Reject
 * on the Candidates table open this instead of acting at once: his sentence
 * ("Why did you Approve?" / "Why did you Disapprove?") goes in the writer's
 * note, and the short reasons he ticks go in `decisionReasons`.
 *
 * The reasons offered are every one used before FOR THAT DECISION, counted
 * across the writers on screen (reasonTally), so the list builds itself and an
 * approving reason is never offered for a rejection. A new one is typed in the
 * box below the list and arrives ticked.
 *
 * Styled with the admin app's shared `c-modal` classes, so it looks like every
 * other window in the app.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type Decision = 'approved' | 'rejected';
export type ReasonCount = { reason: string; count: number };

/** Lowercased, trimmed, inner spaces collapsed — so "Polymath " and "polymath" are one reason. */
function reasonKey(reason: string): string {
  return reason.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Every reason used for `decision`, most used first, then A–Z. Spelling is the
 * first one seen; differences of case and spacing count as the same reason.
 */
export function reasonTally(
  writers: Array<{ status: string; decisionReasons?: string[] }>,
  decision: Decision,
): ReasonCount[] {
  const tally = new Map<string, ReasonCount>();
  for (const w of writers) {
    if (w.status !== decision) continue;
    const seen = new Set<string>();
    for (const raw of w.decisionReasons || []) {
      const key = reasonKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const hit = tally.get(key);
      if (hit) hit.count += 1;
      else tally.set(key, { reason: raw.trim().replace(/\s+/g, ' '), count: 1 });
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export const DECISION_WORDING: Record<Decision, { question: string; action: string; past: string }> = {
  approved: { question: 'Why did you Approve?', action: 'Approve', past: 'approving' },
  rejected: { question: 'Why did you Disapprove?', action: 'Reject', past: 'rejecting' },
};

const MAX_REASON_LENGTH = 80;

type Props = {
  decision: Decision;
  writerName: string;
  initialNote: string;
  offered: ReasonCount[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (note: string, reasons: string[]) => void;
};

export function SubstackDecisionDialog({ decision, writerName, initialNote, offered, busy, error, onCancel, onConfirm }: Props) {
  const words = DECISION_WORDING[decision];
  const [note, setNote] = useState(initialNote);
  const [ticked, setTicked] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { noteRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const rows: ReasonCount[] = [
    ...offered,
    ...added.filter((a) => !offered.some((o) => reasonKey(o.reason) === reasonKey(a))).map((reason) => ({ reason, count: 0 })),
  ];
  const isTicked = (reason: string) => ticked.some((t) => reasonKey(t) === reasonKey(reason));
  const toggle = (reason: string) => setTicked((list) => (
    isTicked(reason) ? list.filter((t) => reasonKey(t) !== reasonKey(reason)) : [...list, reason]
  ));

  const addReason = () => {
    const reason = draft.trim().replace(/\s+/g, ' ');
    if (!reason) return;
    if (reason.length > MAX_REASON_LENGTH) {
      setDraftError(`A reason is a few words (${MAX_REASON_LENGTH} characters at most); the sentence goes in the box above.`);
      return;
    }
    const known = rows.find((r) => reasonKey(r.reason) === reasonKey(reason));
    if (!known) setAdded((list) => [...list, reason]);
    if (!isTicked(known ? known.reason : reason)) setTicked((list) => [...list, known ? known.reason : reason]);
    setDraft('');
    setDraftError('');
  };

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // In the order they appear in the list, so the saved order matches what he saw.
    onConfirm(note.trim(), rows.map((r) => r.reason).filter(isTicked));
  };

  const titleId = `sm-decision-title-${decision}`;
  return createPortal(
    <div className="c-modal__backdrop substack-decision-backdrop" role="presentation" onClick={() => { if (!busy) onCancel(); }}>
      <form
        className="c-modal__dialog substack-decision-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-decision={decision}
        onClick={(e) => e.stopPropagation()}
        onSubmit={confirm}
      >
        <div className="c-modal__header">
          <h3 className="c-modal__title" id={titleId}>{words.action}: {writerName}</h3>
          <button type="button" className="c-modal__close" aria-label="Close" disabled={busy} onClick={onCancel}>×</button>
        </div>
        <div className="c-modal__body substack-decision-body">
          <label className="substack-decision-label" htmlFor="sm-decision-note">{words.question}</label>
          <textarea id="sm-decision-note" ref={noteRef} rows={4} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />

          <fieldset className="substack-decision-reasons">
            <legend>Reasons you have used when {words.past}</legend>
            {rows.length ? (
              <table className="substack-decision-table">
                <thead>
                  <tr>
                    <th scope="col" aria-label="Use" />
                    <th scope="col">Reason</th>
                    <th scope="col">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={reasonKey(r.reason)}>
                      <td>
                        <input
                          type="checkbox"
                          id={`sm-reason-${reasonKey(r.reason).replace(/[^a-z0-9]+/g, '-')}`}
                          checked={isTicked(r.reason)}
                          onChange={() => toggle(r.reason)}
                        />
                      </td>
                      <td><label htmlFor={`sm-reason-${reasonKey(r.reason).replace(/[^a-z0-9]+/g, '-')}`}>{r.reason}</label></td>
                      <td>{r.count ? `${r.count}×` : 'new'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="substack-decision-empty">No reasons yet for {words.past} a writer. Add one below and it will be offered next time.</p>
            )}
            <div className="substack-decision-add">
              <label htmlFor="sm-decision-new-reason">Add a reason</label>
              <input
                id="sm-decision-new-reason"
                type="text"
                value={draft}
                maxLength={MAX_REASON_LENGTH + 20}
                onChange={(e) => { setDraft(e.target.value); setDraftError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReason(); } }}
              />
              <button type="button" className="btn" onClick={addReason} disabled={!draft.trim()}>Add</button>
            </div>
            {draftError ? <p className="substack-miner-error" role="alert">{draftError}</p> : null}
          </fieldset>
          {error ? <p className="substack-miner-error" role="alert">{error}</p> : null}
        </div>
        <div className="c-modal__footer">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className={decision === 'approved' ? 'btn btn-primary' : 'btn btn-danger'} disabled={busy}>
            {busy ? 'Saving…' : words.action}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
