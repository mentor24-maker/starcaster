/**
 * What the suggestion pass guessed for one writer (task 86bch3f2v): clicking
 * the word in the Suggested column opens this. It shows the reasons the pass
 * applied — Dane's own reason tags wherever one fitted — how sure it was, and
 * the one sentence on why, with Agree to make that decision.
 *
 * Same shared c-modal frame as the Approve/Reject pop-up.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type Suggestion = {
  action: 'approved' | 'rejected';
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
  why: string;
  basedOn: number;
  model?: string;
  suggestedAt?: string;
};

export const SUGGESTED_WORD: Record<Suggestion['action'], string> = { approved: 'Approve', rejected: 'Reject' };

type Props = {
  suggestion: Suggestion;
  writerName: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAgree: () => void;
};

export function SubstackSuggestionDialog({ suggestion, writerName, busy, error, onClose, onAgree }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const word = SUGGESTED_WORD[suggestion.action];
  return createPortal(
    <div className="c-modal__backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="c-modal__dialog substack-suggestion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sm-suggestion-title"
        data-action={suggestion.action}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="c-modal__header">
          <h3 className="c-modal__title" id="sm-suggestion-title">Suggested: {word} {writerName}</h3>
          <button type="button" className="c-modal__close" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
        </div>
        <div className="c-modal__body substack-decision-body">
          <p className="substack-suggestion-confidence">
            Confidence: <strong>{suggestion.confidence}</strong>
            {suggestion.basedOn ? ` — learned from ${suggestion.basedOn} of your decisions` : ''}
          </p>
          {suggestion.why ? <p className="substack-suggestion-why">{suggestion.why}</p> : null}
          <div className="substack-decision-reasons">
            <span className="substack-decision-label">Reasons it applied</span>
            {suggestion.reasons.length ? (
              <ul className="substack-suggestion-reasons">
                {suggestion.reasons.map((r) => <li key={r} className="substack-miner-chip">{r}</li>)}
              </ul>
            ) : (
              <p className="substack-decision-empty">No reasons were given with this suggestion.</p>
            )}
          </div>
          <p className="substack-decision-empty">Agree {word === 'Approve' ? 'approves' : 'rejects'} this writer with these reasons{word === 'Approve' ? ' and adds them to Contacts' : ''}. To decide differently, close this and use Approve or Reject.</p>
          {error ? <p className="substack-miner-error" role="alert">{error}</p> : null}
        </div>
        <div className="c-modal__footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onAgree}>{busy ? 'Saving…' : 'Agree'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
