"use client";

/**
 * "Saving this changes these pages. Do you want them live too?"
 *
 * THE STEP THIS REPLACES
 * Saving a saved section already rewrites it on every page that follows —
 * that fan-out is not missing. What is missing is the rest of the journey:
 * the fan-out writes DRAFTS only, so the operator's next move was to leave
 * this screen, open a page, save it, publish it, and repeat. He described it
 * exactly that way (2026-09-03), and a step you have to remember at the far
 * end of another screen is a step that gets skipped — which is how a section
 * edit "did not take" on a live site while the manager said "Saved."
 *
 * So the decision is asked ONCE, here, before the write:
 *   · Save              — today's behaviour exactly. Drafts change, nothing
 *                         goes live. Right when the edit is not finished.
 *   · Save & Publish    — the same save, then those pages go live.
 *   · Cancel            — nothing is written.
 *
 * WHY THREE BUTTONS AND NOT A CONFIRM
 * This was a `window.confirm` carrying `describePushImpact`'s text blob. A
 * two-button confirm cannot offer a third way out, and the page list — the
 * thing worth reading before clicking — arrived as an unformatted wall.
 * Modelled on {@link BuilderSectionSaveModal}: an alertdialog, Escape closes
 * it because that is a deliberate keystroke, backdrop clicks do not because
 * one of these buttons reaches the live site.
 *
 * WHAT PUBLISH REACHES
 * Only the pages this push actually rewrote — the ids come back in the
 * propagation tally and are handed to the publish route by name. Drifted
 * pages are skipped by the push, so they are not rewritten and not published;
 * they are named here so that is visible rather than surprising.
 */

import { useEffect } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";
import type { CanonicalOverwriteImpact } from "@/lib/shared-block-usage";

export type SharedBlockSaveChoice = "save" | "save-and-publish";

type BuilderSharedBlockSaveModalProps = {
  /** "saved section" / "saved module" — this dialog serves both. */
  blockKind: string;
  /** The block's name, for the heading and the buttons. */
  name: string;
  /** What the save will touch, from `describeCanonicalOverwrite`. */
  impact: CanonicalOverwriteImpact;
  /** One line when this save also moves the block's NAME. Null when it does not. */
  renameNotice?: string | null;
  isSaving: boolean;
  onChoose: (choice: SharedBlockSaveChoice) => void;
  onCancel: () => void;
};

export function BuilderSharedBlockSaveModal({
  blockKind,
  name,
  impact,
  renameNotice,
  isSaving,
  onChoose,
  onCancel,
}: BuilderSharedBlockSaveModalProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  const label = name.trim() || `the ${blockKind}`;

  // A drifted page appears in `impact.pageLabels` too — that list is every
  // page FOLLOWING the master, which is the population drift is measured
  // within. Showing it unfiltered put the same page under "These pages
  // change" and under "Left alone", one contradicting the other, which is
  // worse than either list on its own.
  const driftedSet = new Set(impact.driftedPageLabels);
  const changing = impact.pageLabels.filter((pageLabel) => !driftedSet.has(pageLabel));
  const publishable = Math.max(0, changing.length + impact.more);
  const pagesWord = publishable === 1 ? "page" : "pages";

  return (
    <BuilderBodyPortal>
      <div className="builder-gallery-overlay" role="presentation">
        <div
          aria-modal="true"
          className="builder-gallery-modal builder-centered-modal builder-choice-dialog"
          role="alertdialog"
          aria-labelledby="builder-shared-block-save-title"
          style={{ width: "max-content", minWidth: "min(560px, calc(100vw - 48px))", maxWidth: "min(75vw, calc(100vw - 48px))" }}
        >
          <div className="builder-gallery-header builder-centered-modal-banner">
            <div>
              <h3 id="builder-shared-block-save-title">Save “{label}”</h3>
            </div>
          </div>

          <div className="builder-gallery-body builder-choice-dialog-body">
            <p className="builder-choice-dialog-lead">
              {impact.summary}
              {renameNotice ? <span className="builder-choice-dialog-rename">{renameNotice}</span> : null}
            </p>

            {changing.length ? (
              <div className="builder-choice-dialog-detail">
                <p className="builder-choice-dialog-detail-title">
                  {publishable === 1 ? "This page changes:" : "These pages change:"}
                </p>
                <ul className="builder-choice-dialog-list">
                  {changing.map((pageLabel, index) => (
                    <li key={`page-${pageLabel}-${index}`}>{pageLabel}</li>
                  ))}
                  {impact.more > 0 ? <li>…and {impact.more} more</li> : null}
                </ul>
              </div>
            ) : null}

            {impact.driftedPageLabels.length ? (
              <div className="builder-choice-dialog-detail">
                <p className="builder-choice-dialog-detail-title">
                  Left alone — these have their own local changes, so they are neither rewritten nor published:
                </p>
                <ul className="builder-choice-dialog-list">
                  {impact.driftedPageLabels.map((pageLabel, index) => (
                    <li key={`drift-${pageLabel}-${index}`}>{pageLabel}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <dl className="builder-choice-dialog-choices">
              <dt>Save</dt>
              <dd>
                Updates the {blockKind} and the {publishable === 1 ? "page" : "pages"} above as drafts. Nothing
                visitors see changes until you publish.
              </dd>
              <dt>Save &amp; Publish</dt>
              <dd>
                {publishable > 0 ? (
                  <>
                    {`The same save, then ${
                      publishable === 1 ? "that page goes" : `those ${publishable} ${pagesWord} go`
                    } live. No other page is published.`}{" "}
                    {/* Publishing is per PAGE, not per section. If one of these
                        pages is carrying other unfinished draft edits, they go
                        live too — which is not obvious from a dialog about a
                        saved section, and is the one surprise this button can
                        deliver. */}
                    <span className="builder-choice-dialog-rename">
                      {publishable === 1
                        ? "Publishing is per page: any other unpublished edit on that page goes live with it."
                        : `Publishing is per page: any other unpublished edits on those ${pagesWord} go live with them.`}
                    </span>
                  </>
                ) : (
                  "The same save. There is nothing to put live from this change."
                )}
              </dd>
            </dl>

            <div className="builder-choice-dialog-actions">
              <button
                className="submit-button"
                disabled={isSaving}
                onClick={() => onChoose("save-and-publish")}
                type="button"
              >
                {isSaving ? "Saving..." : "Save & Publish"}
              </button>
              <button
                className="secondary-button"
                disabled={isSaving}
                onClick={() => onChoose("save")}
                type="button"
              >
                Save
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
