/**
 * Why Dane rejected a draft — Outreach wizard 12/19 (task 86bcrmbnw).
 *
 * Shared by every channel's Reject (YouTube, Substack, Reddit) and, from
 * slice 19, the wizard's own Approvals. Grown from the Substack Miner's
 * decision dialog (components/substack-miner/substack-decision-dialog.tsx),
 * which now takes its reason matching from here, so "Too salesy " and
 * "too salesy" are one reason on both screens.
 *
 * ONE CLICK ON A CHIP IS THE WHOLE ANSWER: Reject, then a chip, and the draft
 * is rejected with that reason. The sentence box is optional and is sent with
 * whichever chip he clicks. Skip rejects with no reason, which the server
 * records as "no reason given". Cancel, ×, Escape or a click outside rejects
 * nothing at all.
 *
 * The chips are five defaults plus every reason he has used before
 * (GET /api/outreach/feedback/reasons). If those could not be read the
 * defaults are still offered and the window says why his own are missing —
 * an empty list never reads as "you have none" (landmine 17).
 *
 * Styled with the admin app's shared `c-modal` classes, like the Miner's.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const REASONS_PATH = '/api/outreach/feedback/reasons';

/** Offered before any of his own, in this order. Mirrors lib/outreachFeedbackStore.js DEFAULT_REASONS. */
export const DEFAULT_REASONS = ['too salesy', 'not my voice', 'misses the point', 'too long', 'too generic'];

export const MAX_REASON_LENGTH = 80;

export type ReasonCount = { reason: string; count: number };
export type SavedReasons = { defaults: ReasonCount[]; saved: ReasonCount[] };

/** Trimmed, inner spaces collapsed — the spelling that is saved. */
export function cleanReason(reason: string): string {
  return String(reason || '').trim().replace(/\s+/g, ' ');
}

/** Lowercased as well — so "Polymath " and "polymath" are one reason. */
export function reasonKey(reason: string): string {
  return cleanReason(reason).toLowerCase();
}

/** The chips in the order shown: the defaults, then his own not already among them. */
export function chipsFor(reasons: SavedReasons | null): ReasonCount[] {
  const defaults = reasons?.defaults?.length ? reasons.defaults : DEFAULT_REASONS.map((reason) => ({ reason, count: 0 }));
  const own = (reasons?.saved || []).filter((s) => !defaults.some((d) => reasonKey(d.reason) === reasonKey(s.reason)));
  return [...defaults, ...own];
}

/** What a Reject posts: `{ reasons, note }`. No reasons is Skip. */
export type RejectReason = { reasons: string[]; note: string };

/**
 * What an Approve or Reject answers with beside the decision: whether WHY was
 * saved, and — every fifth decision — whether the lessons refreshed
 * (lib/outreachFeedbackStore.js attachFeedback).
 */
export type DecisionFeedback = {
  recorded?: boolean;
  error?: string;
  lessons?: { refreshed?: boolean; error?: string } | null;
} | null | undefined;

/** `text` as one sentence: its own closing full stop, or one added. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The line the screen shows after an Approve: `lead`, plus the lessons'
 * failure when the automatic refresh this decision triggered did not work —
 * otherwise the lessons stop learning and nothing says so.
 */
export function decisionNotice(lead: string, feedback: DecisionFeedback): string {
  const failed = feedback?.lessons?.error;
  return failed ? `${lead} ${sentence(failed)}` : lead;
}

/** The line the screen shows after a Reject, from the server's answer. */
export function rejectNotice(lead: string, feedback: DecisionFeedback): string {
  if (!feedback || feedback.recorded) return decisionNotice(lead, feedback);
  return `${lead} The reason was NOT saved: ${feedback.error || 'the server gave no reason'}.`;
}

/** The app's api function; only a GET is made, so any channel's typing fits. */
type ApiFn = (path: string) => Promise<unknown>;

type Props = {
  /** "Reject this comment?" — names what is being rejected. */
  title: string;
  /** The app's api function, used to read his saved reasons. */
  api: ApiFn | null | undefined;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (why: RejectReason) => void;
};

export default function ReasonPicker({ title, api, busy, error, onCancel, onConfirm }: Props): React.ReactElement {
  const [reasons, setReasons] = useState<SavedReasons | null>(null);
  const [readError, setReadError] = useState('');
  const [note, setNote] = useState('');
  const [own, setOwn] = useState('');
  const [ownError, setOwnError] = useState('');
  const firstChip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    if (!api) return undefined;
    api(REASONS_PATH)
      .then((reply) => { if (live) setReasons(((reply as { data?: SavedReasons } | null)?.data) || null); })
      .catch((err: unknown) => {
        if (live) setReadError(err instanceof Error && err.message ? err.message : 'the server gave no reason');
      });
    return () => { live = false; };
  }, [api]);

  useEffect(() => { firstChip.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const chips = chipsFor(reasons);
  const send = (list: string[]) => { if (!busy) onConfirm({ reasons: list, note: note.trim() }); };

  const sendOwn = () => {
    const reason = cleanReason(own);
    if (!reason) return;
    if (reason.length > MAX_REASON_LENGTH) {
      setOwnError(`A reason is a few words (${MAX_REASON_LENGTH} characters at most); the sentence goes in the box above.`);
      return;
    }
    send([reason]);
  };

  return createPortal(
    <div className="c-modal__backdrop reason-picker-backdrop" role="presentation" onClick={() => { if (!busy) onCancel(); }}>
      <div
        className="c-modal__dialog reason-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="c-modal__header">
          <h3 className="c-modal__title" id="reason-picker-title">{title}</h3>
          <button type="button" className="c-modal__close" aria-label="Close" disabled={busy} onClick={onCancel}>×</button>
        </div>
        <div className="c-modal__body reason-picker-body">
          <p className="reason-picker-help">Why? Click a reason and it is rejected.</p>
          <div className="reason-picker-chips" role="group" aria-label="Reasons">
            {chips.map((c, i) => (
              <button
                key={reasonKey(c.reason)}
                ref={i === 0 ? firstChip : undefined}
                type="button"
                className="reason-picker-chip"
                data-reason={c.reason}
                disabled={busy}
                onClick={() => send([c.reason])}
              >
                {c.reason}
                {c.count ? <span className="reason-picker-count">{`${c.count}×`}</span> : null}
              </button>
            ))}
          </div>
          {readError ? (
            <p className="reason-picker-help" role="status">{`Your own saved reasons could not be read (${readError}), so only the five standard ones are shown.`}</p>
          ) : null}
          <label className="reason-picker-label" htmlFor="reason-picker-own">Or your own reason</label>
          <div className="reason-picker-own">
            <input
              id="reason-picker-own"
              type="text"
              value={own}
              maxLength={MAX_REASON_LENGTH + 20}
              disabled={busy}
              onChange={(e) => { setOwn(e.target.value); setOwnError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendOwn(); } }}
            />
            <button type="button" className="btn" disabled={busy || !own.trim()} onClick={sendOwn}>Reject</button>
          </div>
          {ownError ? <p className="reason-picker-error" role="alert">{ownError}</p> : null}
          <label className="reason-picker-label" htmlFor="reason-picker-note">A sentence, if you like (sent with the reason you click)</label>
          <textarea id="reason-picker-note" rows={2} value={note} maxLength={1000} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          {error ? <p className="reason-picker-error" role="alert">{error}</p> : null}
        </div>
        <div className="c-modal__footer">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => send([])}>
            {busy ? 'Rejecting…' : 'Skip — reject without a reason'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
