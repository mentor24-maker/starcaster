"use client";

/**
 * "Somebody else saved this page while you had it open."
 *
 * A MODAL rather than the inline banner this started as (operator, 2026-08-15):
 * the save was refused and the operator has a decision to make — take their
 * version or overwrite it — and a notice further up a long Builder page can sit
 * off screen entirely while they carry on editing a page that will not save.
 *
 * Three ways out, all explicit:
 *   · Reload the page   — discard my edits, take theirs
 *   · Overwrite anyway  — keep mine (theirs stays in Page History)
 *   · Keep editing      — decide later; the next save asks again
 *
 * Deliberately NOT dismissible by clicking the backdrop. Every other builder
 * overlay closes that way because closing them costs nothing; here a stray
 * click would dismiss the one message explaining why the work on screen is not
 * saved. Escape still closes, because a keyboard user needs a way out and it is
 * a deliberate keystroke rather than a slipped mouse.
 */

import { useEffect } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

type BuilderSaveConflictModalProps = {
  /** Who saved it, when it can be established. Empty renders "Somebody else". */
  savedByName: string;
  /** " 4 minutes ago", already formatted, or "" when the time is unreadable. */
  age: string;
  isSaving: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onKeepEditing: () => void;
};

export function BuilderSaveConflictModal({
  savedByName,
  age,
  isSaving,
  onReload,
  onOverwrite,
  onKeepEditing,
}: BuilderSaveConflictModalProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onKeepEditing();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onKeepEditing]);

  const who = savedByName || "Somebody else";

  return (
    <BuilderBodyPortal>
      <div className="builder-gallery-overlay" role="presentation">
        <div
          aria-modal="true"
          className="builder-gallery-modal builder-centered-modal builder-save-conflict-modal"
          role="alertdialog"
          aria-labelledby="builder-save-conflict-title"
          style={{ width: "max-content", minWidth: "min(520px, calc(100vw - 48px))", maxWidth: "min(75vw, calc(100vw - 48px))" }}
        >
          <div className="builder-gallery-header builder-centered-modal-banner">
            <div>
              <h3 id="builder-save-conflict-title">This page changed while you had it open</h3>
            </div>
          </div>

          <div className="builder-gallery-body builder-save-conflict-body">
            <p className="builder-save-conflict-lead">
              <strong>
                {who} saved this page{age}.
              </strong>{" "}
              Your copy is out of date, so <strong>nothing was saved just now</strong> — every edit
              you made is still here on screen.
            </p>

            <dl className="builder-save-conflict-choices">
              <dt>Reload the page</dt>
              <dd>Throws away your edits and shows you their version.</dd>
              <dt>Overwrite anyway</dt>
              <dd>
                Saves yours over theirs. Their version is kept in Page History, so it can still be
                brought back.
              </dd>
            </dl>

            <div className="builder-save-conflict-actions">
              <button className="submit-button" disabled={isSaving} onClick={onReload} type="button">
                Reload the page
              </button>
              <button className="secondary-button" disabled={isSaving} onClick={onOverwrite} type="button">
                {isSaving ? "Saving..." : "Overwrite anyway"}
              </button>
              <button className="btn btn-ghost" disabled={isSaving} onClick={onKeepEditing} type="button">
                Keep editing
              </button>
            </div>
          </div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
