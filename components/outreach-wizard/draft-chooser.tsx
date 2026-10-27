import React, { useState } from 'react';

/**
 * Three replies to choose from — Outreach wizard 9/19 (task 86bcrmbke).
 *
 * Shared by every channel's approval card: Reddit uses it first
 * (components/reddit-comments/reddit-comments-panel.tsx); YouTube (10/19) and
 * Substack (11/19) are next. The server (lib/draftOptions.js) writes the
 * options and checks each against the rules; this only shows them.
 *
 * Three cards side by side (stacked on a phone). Clicking one — or pressing
 * 1, 2 or 3 — makes it the editable box, with Approve and Reject under it.
 * Three more asks for a fresh set and replaces all three. An option the
 * server DROPPED is not a card: one line says how many were dropped and why,
 * so a card with two options never reads as a bug (landmine 17).
 */

/** One entry of a draft's options, as the server stores it. */
export type DraftOption = {
  text?: string;
  angle?: string;
  dropped?: boolean;
  rule?: { ok: boolean; reason?: string };
};

/** A kept option, with its place in the stored list (that index is what Approve sends). */
export type KeptOption = { index: number; text: string; angle: string };

/** The options that can be picked, in order, each carrying its stored index. */
export function keptOptions(options: DraftOption[] | null | undefined): KeptOption[] {
  return (Array.isArray(options) ? options : [])
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o && !o.dropped && typeof o.text === 'string' && o.text.trim())
    .map(({ o, index }) => ({ index, text: String(o.text), angle: String(o.angle || '').trim() }));
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

/** "One option was dropped: it names Dane of Earth." — the same sentence lib/draftOptions.js writes. */
export function droppedLine(options: DraftOption[] | null | undefined): string {
  const dropped = (Array.isArray(options) ? options : []).filter((o) => o && o.dropped);
  if (!dropped.length) return '';
  const reasons = dropped.map((o) => String(o.rule?.reason || '').trim()).filter(Boolean);
  const n = dropped.length;
  const head = `${NUMBER_WORDS[n] || n} option${n === 1 ? ' was' : 's were'} dropped`;
  return reasons.length ? `${head}: ${reasons.join('; ')}.` : `${head}.`;
}

/** Is a key press aimed at typing (so 1/2/3 must type, not pick)? */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'textarea' || tag === 'input' || tag === 'select' || Boolean(el.isContentEditable);
}

export type DraftChooserProps = {
  /** Every stored option, kept and dropped, in the order the server wrote them. */
  options: DraftOption[];
  /** Prefix for element ids, so several choosers on one screen stay distinct. */
  idPrefix: string;
  /** What the action is busy with, if anything: 'draft' | 'approve' | ''. */
  busy: string;
  error: string;
  /** A line under the box — e.g. which canon the replies were written from. */
  footnote?: string;
  onApprove: (text: string, option: number) => void;
  onReject: () => void;
  /** "Three more" — asks for a fresh set; the parent re-renders with new options. */
  onMore: () => void;
};

export default function DraftChooser({ options, idPrefix, busy, error, footnote, onApprove, onReject, onMore }: DraftChooserProps): React.ReactElement {
  const kept = keptOptions(options);
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState('');
  const boxId = `${idPrefix}-box`;
  const dropped = droppedLine(options);

  const pick = (option: KeptOption) => {
    setPicked(option.index);
    setText(option.text);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    const n = Number(event.key);
    if (!Number.isInteger(n) || n < 1 || n > kept.length) return;
    event.preventDefault();
    pick(kept[n - 1]);
  };

  return (
    // The keys are heard anywhere inside the card that is not a text box.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="draft-chooser" onKeyDown={onKeyDown}>
      <p className="draft-chooser-help">
        {picked === null
          ? `Pick a reply to edit and approve${kept.length > 1 ? ` — or press ${kept.map((_, i) => i + 1).join(', ').replace(/, (\d)$/, ' or $1')}` : ''}.`
          : 'Edit it if you like, then Approve — or pick another.'}
      </p>
      <div className="draft-chooser-options" role="group" aria-label="Replies to choose from">
        {kept.map((option, i) => (
          <button
            key={option.index}
            type="button"
            className={`draft-chooser-option${picked === option.index ? ' draft-chooser-option--picked' : ''}`}
            aria-pressed={picked === option.index}
            data-option={option.index}
            disabled={Boolean(busy)}
            onClick={() => pick(option)}
          >
            <span className="draft-chooser-angle">
              <span className="draft-chooser-key" aria-hidden="true">{i + 1}</span>
              {option.angle || `Reply ${i + 1}`}
            </span>
            <span className="draft-chooser-text">{option.text}</span>
          </button>
        ))}
      </div>
      {dropped ? <p className="draft-chooser-dropped">{dropped}</p> : null}
      {picked !== null ? (
        <>
          <label className="draft-chooser-label" htmlFor={boxId}>Your comment</label>
          <textarea id={boxId} className="draft-chooser-box" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="draft-chooser-help">{`${text.trim().length} characters`}</p>
        </>
      ) : null}
      {footnote ? <p className="draft-chooser-help">{footnote}</p> : null}
      {error ? <p className="draft-chooser-error" role="alert">{error}</p> : null}
      <div className="draft-chooser-actions">
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={onMore}>
          {busy === 'draft' ? 'Writing… (about 30 seconds)' : 'Three More'}
        </button>
        <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={onReject}>Reject</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(busy) || picked === null || !text.trim()}
          onClick={() => { if (picked !== null) onApprove(text, picked); }}
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
