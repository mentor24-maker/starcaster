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
 * It also shows what changes on each of those pages, not only their names —
 * see `lib/builder-client/saved-section-diff.ts`. Pages that change identically
 * share one block so the page that drifted stands on its own beside them, and
 * "no visible change" is a block of its own rather than a gap.
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
import {
  GROUP_CHANGE_PREVIEW,
  GROUP_PAGE_PREVIEW,
  PAGE_LIST_LIMIT,
  capList,
  describeGroupCount,
  describeGroupVerdict,
  describePageCount,
  describeSectionDiff,
  type SavedSectionDiff,
  type SectionChange,
  type SectionDiffGroup,
} from "@/lib/saved-section-diff";

type BuilderSectionSaveModalProps = {
  /** The saved section this page section came from. */
  canonicalName: string;
  /** What overwriting would touch, from `describeCanonicalOverwrite`. */
  impact: CanonicalOverwriteImpact;
  /**
   * What changes on each of those pages, from `diffSavedSectionOverwrite`.
   * Optional so a caller that cannot work it out still gets the page list.
   */
  diff?: SavedSectionDiff | null;
  isSaving: boolean;
  onOverwrite: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
};

/** One change: a before/after pair, or a structural line with its detail. */
function ChangeLine({ change }: { change: SectionChange }) {
  return (
    <li className="builder-section-diff-change" data-kind={change.kind}>
      <span className="builder-section-diff-change-label">{change.label}</span>
      {change.detail ? <span className="builder-section-diff-change-detail">{change.detail}</span> : null}
      {change.before !== undefined || change.after !== undefined ? (
        <span className="builder-section-diff-values">
          <span className="builder-section-diff-value" data-side="before">
            <em>was</em> {change.before}
          </span>
          <span className="builder-section-diff-value" data-side="after">
            <em>now</em> {change.after}
          </span>
        </span>
      ) : null}
    </li>
  );
}

/**
 * One block of pages that all change the same way.
 *
 * The heading — how many pages, how many changes, and which pages — is ALWAYS
 * visible; only the change lines fold away. Drawn the other way round first,
 * with whole groups expanded, one group filled the panel and pushed the rest
 * out of sight. That is the same burying this grouping exists to undo, so the
 * headings stay put and one group's detail is open at a time.
 *
 * The group with no visible change is not a `<details>` at all: there is
 * nothing behind it, and a disclosure arrow that opens onto nothing is a lie.
 */
function DiffGroup({ group, defaultOpen }: { group: SectionDiffGroup; defaultOpen: boolean }) {
  const pages = capList(group.pageLabels, GROUP_PAGE_PREVIEW);
  const changes = capList(group.changes, GROUP_CHANGE_PREVIEW);

  const heading = (
    <>
      <span className="builder-section-diff-group-count">{describeGroupCount(group)}</span>
      <span className="builder-section-diff-group-verdict">{describeGroupVerdict(group)}</span>
      <span className="builder-section-diff-group-pages">
        {pages.shown.join(" · ")}
        {pages.more > 0 ? ` …and ${pages.more} more` : ""}
      </span>
    </>
  );

  if (group.unchanged) {
    return (
      <div className="builder-section-diff-group" data-unchanged="true">
        <p className="builder-section-diff-group-heading">{heading}</p>
      </div>
    );
  }

  return (
    <details className="builder-section-diff-group" data-unchanged="false" open={defaultOpen}>
      <summary className="builder-section-diff-group-heading">{heading}</summary>
      <ul className="builder-section-diff-changes">
        {changes.shown.map((change, index) => (
          <ChangeLine change={change} key={`${change.kind}-${change.label}-${index}`} />
        ))}
        {changes.more > 0 ? (
          <li className="builder-section-diff-change" data-kind="more">
            <span className="builder-section-diff-change-label">…and {changes.more} more changes</span>
          </li>
        ) : null}
      </ul>
    </details>
  );
}

export function BuilderSectionSaveModal({
  canonicalName,
  impact,
  diff,
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

            {diff && diff.pages > 0 ? (
              <div className="builder-choice-dialog-detail builder-section-diff">
                <p className="builder-choice-dialog-detail-title">
                  Overwriting rewrites this section on {describePageCount(diff.pages)}. {describeSectionDiff(diff)}
                </p>
                {diff.truncated ? (
                  <p className="builder-section-diff-truncated">
                    The editor loads at most {PAGE_LIST_LIMIT} pages and this project is at that limit, so there may be
                    following pages missing from this list. The overwrite still reaches them.
                  </p>
                ) : null}
                <div className="builder-section-diff-groups">
                  {diff.groups.map((group, index) => (
                    // Only the first group's detail is open. Groups are ordered
                    // rarest-first, so that is the page that drifted — the one
                    // worth reading before clicking.
                    <DiffGroup defaultOpen={index === 0} group={group} key={`${group.unchanged ? "same" : "changed"}-${index}`} />
                  ))}
                </div>
              </div>
            ) : impact.pageLabels.length ? (
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
