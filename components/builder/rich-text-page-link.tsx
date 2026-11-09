"use client";

import Link from "@tiptap/extension-link";
import { useEffect, useState } from "react";
import { isPageLink, makePageLink, PAGE_LINK_ATTR, parsePageLink } from "@/lib/page-link";
import { type BuilderPickerOption, loadPickerOptions } from "@/components/builder/builder-project-data-picker";

/**
 * A link inside rich text that can point at one of the site's own pages BY
 * REFERENCE (task 86bcxthq5, the last slice of 86bcxmt5x).
 *
 * The stored HTML keeps a working `href` — the page's address when it was
 * picked — and carries the reference beside it:
 *
 *     <a href="/about" data-page-link="page:12|/about">
 *
 * The renderer swaps in the page's current address (`resolvePageLinksInHtml`
 * in lib/builder-client/page-link.js), so renaming the page never breaks the
 * link. A link typed as a web address carries no attribute and is exactly
 * what it always was.
 *
 * Without this extension tiptap's Link mark knows only href/target/rel/class
 * and would silently drop the attribute the moment the text was opened.
 */
export const PageLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      pageLink: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute(PAGE_LINK_ATTR);
          return isPageLink(value) ? value : null;
        },
        renderHTML: (attributes: { pageLink?: string | null }) =>
          attributes.pageLink ? { [PAGE_LINK_ATTR]: attributes.pageLink } : {}
      }
    };
  }
});

export type RichTextLinkValue = { href: string; pageLink: string | null };

type Mode = "page" | "web";

/** Which mode and page the dialog opens on, for the link under the cursor. Exported for tests. */
export function initialLinkChoice(
  current: RichTextLinkValue,
  pages: BuilderPickerOption[]
): { mode: Mode; pageId: string; missingFallback: string } {
  const reference = parsePageLink(current.pageLink);
  if (reference) {
    const found = pages.some((page) => page.id === reference.pageId);
    return { mode: "page", pageId: reference.pageId, missingFallback: found ? "" : reference.fallback };
  }
  if (current.href) {
    // An old typed address that is one of the site's pages opens on that
    // page, so applying the dialog upgrades it to a reference.
    const match = pages.find((page) => page.path === current.href);
    return match ? { mode: "page", pageId: match.id, missingFallback: "" } : { mode: "web", pageId: "", missingFallback: "" };
  }
  return { mode: pages.length ? "page" : "web", pageId: "", missingFallback: "" };
}

/** What a choice saves. Exported for tests. */
export function linkValueForChoice(mode: Mode, page: BuilderPickerOption | undefined, address: string): RichTextLinkValue | null {
  if (mode === "page") {
    if (!page) return null;
    return { href: page.path, pageLink: makePageLink(page.id, page.path) };
  }
  const href = address.trim();
  return href ? { href, pageLink: null } : null;
}

/**
 * The toolbar's Link dialog: "A page on this site" (stored by id) or "A web
 * address" (typed). Replaces the old `window.prompt`, which could only take a
 * typed address.
 */
export function RichTextLinkDialog({
  current,
  onApply,
  onRemove,
  onClose
}: {
  current: RichTextLinkValue;
  onApply: (value: RichTextLinkValue) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<BuilderPickerOption[] | null>(null);
  const [mode, setMode] = useState<Mode>("web");
  const [pageId, setPageId] = useState("");
  const [missingFallback, setMissingFallback] = useState("");
  const [address, setAddress] = useState(current.pageLink ? "https://" : current.href || "https://");

  useEffect(() => {
    let alive = true;
    const settle = (loaded: BuilderPickerOption[]) => {
      if (!alive) return;
      setPages(loaded);
      const choice = initialLinkChoice(current, loaded);
      setMode(choice.mode);
      setPageId(choice.pageId);
      setMissingFallback(choice.missingFallback);
    };
    // A page list that will not load must never block typing an address.
    loadPickerOptions("pages").then(settle, () => settle([]));
    return () => {
      alive = false;
    };
    // The dialog is mounted fresh for each opening; `current` is that opening's link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPage = pages?.find((page) => page.id === pageId);
  const next = linkValueForChoice(mode, selectedPage, address);

  return (
    <div
      className="builder-rich-text-link-dialog"
      role="dialog"
      aria-label="Link"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Enter" && next) {
          event.preventDefault();
          onApply(next);
        }
      }}
    >
      <div className="builder-rich-text-link-dialog-modes" role="radiogroup" aria-label="Link to">
        <label>
          <input
            type="radio"
            name="builder-rich-text-link-mode"
            checked={mode === "page"}
            disabled={!pages?.length}
            onChange={() => setMode("page")}
          />
          A page on this site
        </label>
        <label>
          <input
            type="radio"
            name="builder-rich-text-link-mode"
            checked={mode === "web"}
            onChange={() => setMode("web")}
          />
          A web address
        </label>
      </div>
      {mode === "page" ? (
        <>
          <select aria-label="Page" value={pageId} onChange={(event) => { setPageId(event.target.value); setMissingFallback(""); }}>
            <option value="">{pages === null ? "Loading…" : "Choose a page…"}</option>
            {missingFallback ? <option value={pageId}>Missing page ({missingFallback})</option> : null}
            {(pages ?? []).map((page) => (
              <option key={page.id} value={page.id}>
                {page.label}
              </option>
            ))}
          </select>
          {missingFallback ? (
            <span className="builder-rich-text-link-dialog-note" role="note">
              The page this linked to no longer exists. Visitors are sent to its old address ({missingFallback}); choose another page.
            </span>
          ) : null}
        </>
      ) : (
        <input
          aria-label="Web address"
          autoFocus
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      )}
      {pages !== null && !pages.length ? (
        <span className="builder-rich-text-link-dialog-note" role="note">
          This site's page list could not be loaded, so only a web address can be typed.
        </span>
      ) : null}
      <div className="builder-rich-text-link-dialog-actions">
        <button type="button" disabled={!next} onClick={() => next && onApply(next)}>
          Apply
        </button>
        {current.href || current.pageLink ? (
          <button type="button" onClick={onRemove}>
            Remove link
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
