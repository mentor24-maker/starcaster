"use client";

/**
 * "These links still point at the page you are about to delete."
 *
 * Shown by Builder › Pages ONLY when something links to a page being deleted
 * (task 86bcxn69z). When nothing does, the delete asks exactly what it always
 * asked, so this never appears for an ordinary delete.
 *
 * Renaming a page can no longer break a link to it — links store the page
 * itself (86bcxmrw2). Deleting it still can, and the only moment anybody can
 * do something about that is now, before the click. So the dialog names each
 * link: where it sits, which module, which menu item. The list comes from
 * lib/pageInboundLinks.js, the same scan the weekly broken-link check uses.
 *
 * Not dismissible by clicking the backdrop, for the save-conflict dialog's
 * reason: a stray click must not answer a question about deleting. Escape
 * cancels.
 */

import { useEffect } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

export type PageDeleteLinks = {
  pageId: string;
  pageName: string;
  links: string[];
};

type BuilderPageDeleteModalProps = {
  /** Only the pages something links to; there is at least one. */
  pages: PageDeleteLinks[];
  /** How many pages the delete covers in total (bulk delete). */
  deleteCount: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function linkCountLabel(count: number): string {
  return `${count} link${count === 1 ? "" : "s"}`;
}

export function BuilderPageDeleteModal({ pages, deleteCount, onConfirm, onCancel }: BuilderPageDeleteModalProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  const total = pages.reduce((sum, page) => sum + page.links.length, 0);
  const single = deleteCount === 1 && pages.length === 1;
  const title = single
    ? `${linkCountLabel(total)} still point${total === 1 ? "s" : ""} to "${pages[0].pageName}"`
    : `${linkCountLabel(total)} still point to ${pages.length === 1 ? "a page" : "pages"} you are deleting`;

  return (
    <BuilderBodyPortal>
      <div className="builder-gallery-overlay" role="presentation">
        <div
          aria-modal="true"
          className="builder-gallery-modal builder-centered-modal builder-page-delete-modal"
          role="alertdialog"
          aria-labelledby="builder-page-delete-title"
          style={{ width: "max-content", minWidth: "min(520px, calc(100vw - 48px))", maxWidth: "min(75vw, calc(100vw - 48px))" }}
        >
          <div className="builder-gallery-header builder-centered-modal-banner">
            <div>
              <h3 id="builder-page-delete-title">{title}</h3>
            </div>
          </div>

          <div className="builder-gallery-body builder-choice-dialog-body">
            <p className="builder-choice-dialog-lead">
              After the delete, {total === 1 ? "this link goes" : "these links go"} nowhere — a visitor who
              clicks {total === 1 ? "it" : "one"} gets a missing page. Change {total === 1 ? "it" : "them"} to
              point somewhere else first, or delete anyway and fix {total === 1 ? "it" : "them"} afterwards.
              Deleting cannot be undone.
            </p>

            {pages.map((page) => (
              <div key={page.pageId} data-page-delete-links={page.pageId}>
                {single ? null : (
                  <p className="builder-choice-dialog-detail-title">
                    "{page.pageName}" — {linkCountLabel(page.links.length)}
                  </p>
                )}
                <ul className="builder-choice-dialog-list">
                  {page.links.map((text, index) => (
                    <li key={`${index}-${text}`}>{text}</li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="builder-choice-dialog-actions">
              <button className="btn btn-danger" onClick={onConfirm} type="button">
                Delete Anyway
              </button>
              <button className="btn btn-ghost" onClick={onCancel} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
