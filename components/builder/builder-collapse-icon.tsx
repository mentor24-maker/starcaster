type BuilderCollapseIconProps = {
  /** Panel open (collapse ▾) vs closed (expand ▸). */
  expanded: boolean;
  /**
   * The thing the panel shows is not here yet: draw a spinner in the same
   * circle instead of the triangle (task 86bczp0zy). Pair it with
   * `builderPanelToggleLoadingProps` on the button, so the bar cannot be
   * opened onto something half-loaded.
   */
  loading?: boolean;
  className?: string;
};

/**
 * SVG expand/collapse mark — circle chrome is CSS on the parent; triangle size is exact ink, not font metrics.
 */
export function BuilderCollapseIcon({ expanded, loading = false, className = "" }: BuilderCollapseIconProps) {
  const shellClass = ["builder-collapse-icon-mark", loading ? "is-loading" : "", className].filter(Boolean).join(" ");

  if (loading) {
    return (
      <span className={shellClass}>
        <svg
          aria-hidden="true"
          className="builder-collapse-icon-svg builder-collapse-icon-spinner"
          data-collapse-spinner=""
          focusable="false"
          viewBox="0 0 24 24"
        >
          {/* A three-quarter ring; CSS turns it (and stops turning it under
              reduced motion — the ring still shows, so "busy" still reads). */}
          <circle cx="12" cy="12" fill="none" r="8" stroke="currentColor" strokeDasharray="38 13" strokeLinecap="round" strokeWidth="3" />
        </svg>
      </span>
    );
  }

  return (
    <span className={shellClass}>
      <svg
        aria-hidden="true"
        className="builder-collapse-icon-svg"
        focusable="false"
        viewBox="0 0 24 24"
      >
        {expanded ? (
          <polygon fill="currentColor" points="4,7 20,7 12,20" />
        ) : (
          <polygon fill="currentColor" points="7,4 7,20 20,12" />
        )}
      </svg>
    </span>
  );
}

export const BUILDER_PAGE_LOADING_LABEL = "Loading page…";

/**
 * The button attributes for a panel bar whose content is still loading:
 * unclickable, announced as busy, and saying why. When not loading it hands
 * back the bar's own label and title untouched, so nothing changes for a bar
 * that has finished.
 */
export function builderPanelToggleLoadingProps(
  loading: boolean,
  label: string,
  title?: string,
): { disabled: boolean; "aria-busy"?: true; "aria-label": string; title?: string } {
  if (!loading) return { disabled: false, "aria-label": label, title };
  return { disabled: true, "aria-busy": true, "aria-label": BUILDER_PAGE_LOADING_LABEL, title: BUILDER_PAGE_LOADING_LABEL };
}

export type BuilderPageLoadingInput = {
  builderMode: "templates" | "modules" | "pages";
  /** The first pages request has come back — successfully OR not. */
  pagesLoaded: boolean;
  pageIds: string[];
  /** The editor was opened for this page (the Pages list's Edit pencil). */
  initialPageId?: string;
  /** That initial page has already been selected once. */
  initialSelectionApplied: boolean;
  selectedPageId: string;
  /** The page whose sections are currently in the draft ("" = none yet). */
  hydratedPageId: string;
};

/**
 * Is the page editor still waiting for its page? (task 86bczp0zy)
 *
 * "Loaded" means: the pages list has come back, AND if the editor was opened
 * for a particular page, that page has been selected and its sections poured
 * into the draft. Every branch that could wait forever lets go instead — a
 * failed pages request counts as come back (the error banner already says
 * what happened), and a page id that is not in the list stops the wait,
 * because the selection effects will never find it.
 */
export function isBuilderPageLoading(input: BuilderPageLoadingInput): boolean {
  if (input.builderMode !== "pages") return false;
  if (!input.pagesLoaded) return true;

  const hasPage = (id: string) => input.pageIds.some((pageId) => String(pageId) === String(id));

  if (input.initialPageId && !input.initialSelectionApplied) {
    return hasPage(input.initialPageId);
  }

  if (input.selectedPageId && input.hydratedPageId !== input.selectedPageId) {
    return hasPage(input.selectedPageId);
  }

  return false;
}
