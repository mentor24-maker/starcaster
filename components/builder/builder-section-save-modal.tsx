"use client";

/**
 * "You edited a section that came from a saved section. Which save did you mean?"
 *
 * Saving a section from inside a page used to have exactly one meaning: file a
 * brand new saved section under whatever name you typed. So the operator, who
 * had unlocked a canonical section, edited it, and wanted the original updated,
 * typed the original's name — and got a SECOND saved section carrying the same
 * name, with the real original untouched (2026-08-16). Nothing about the prompt
 * said that was the only thing it could do.
 *
 * Two saves are possible here and they are not interchangeable, so neither one
 * is assumed:
 *   · Update the original — rewrites the saved section AND every page following
 *     it, and relinks this copy so it follows again
 *   · Save as a new one   — leaves the original alone, files a separate section
 *
 * Modelled on {@link BuilderSaveConflictModal}: an alertdialog rather than a
 * `window.confirm`, because the page list this can rewrite has to be readable
 * before the click, and a two-button confirm cannot offer three ways out.
 * Backdrop clicks do not dismiss it — one of these buttons rewrites the site —
 * but Escape does, since that is a deliberate keystroke rather than a slip.
 */

import { useEffect } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";
import type { CanonicalOverwriteImpact } from "@/lib/shared-block-usage";

type BuilderSectionSaveModalProps = {
  /** The saved section this page section came from. */
  canonicalName: string;
  /** What overwriting would touch, from `describeCanonicalOverwrite`. */
  impact: CanonicalOverwriteImpact;
  isSaving: boolean;
  onOverwrite: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
};

export function BuilderSectionSaveModal({
  canonicalName,
  impact,
  isSaving,
  onOverwrite,
  onSaveAsNew,
  onCancel,
}: BuilderSectionSaveModalProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  const label = canonicalName || "the saved section";

  return (
    <BuilderBodyPortal>
      <div className="builder-gallery-overlay" role="presentation">
        <div
          aria-modal="true"
          className="builder-gallery-modal builder-centered-modal builder-choice-dialog"
          role="alertdialog"
          aria-labelledby="builder-section-save-title"
          style={{ width: "max-content", minWidth: "min(560px, calc(100vw - 48px))", maxWidth: "min(75vw, calc(100vw - 48px))" }}
        >
          <div className="builder-gallery-header builder-centered-modal-banner">
            <div>
              <h3 id="builder-section-save-title">Save this section</h3>
            </div>
          </div>

          <div className="builder-gallery-body builder-choice-dialog-body">
            <p className="builder-choice-dialog-lead">
              This section came from the saved section <strong>“{label}”</strong>. Saving can mean
              two different things — say which one.
            </p>

            <dl className="builder-choice-dialog-choices">
              <dt>Overwrite “{label}”</dt>
              <dd>
                {impact.summary} This copy links back to it, so it follows the original again.
              </dd>
              <dt>Save as a new section</dt>
              <dd>
                Leaves “{label}” exactly as it is and files this one separately, under a name you
                choose.
              </dd>
            </dl>

            {impact.pageLabels.length ? (
              <div className="builder-choice-dialog-detail">
                <p className="builder-choice-dialog-detail-title">Overwriting rewrites this section on:</p>
                <ul className="builder-choice-dialog-list">
                  {impact.pageLabels.map((pageLabel, index) => (
                    <li key={`${pageLabel}-${index}`}>{pageLabel}</li>
                  ))}
                  {impact.more > 0 ? <li>…and {impact.more} more</li> : null}
                </ul>
              </div>
            ) : null}

            <div className="builder-choice-dialog-actions">
              <button className="submit-button" disabled={isSaving} onClick={onOverwrite} type="button">
                {isSaving ? "Saving..." : `Overwrite “${label}”`}
              </button>
              <button className="secondary-button" disabled={isSaving} onClick={onSaveAsNew} type="button">
                Save as a new section
              </button>
              <button className="btn btn-ghost" disabled={isSaving} onClick={onCancel} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
