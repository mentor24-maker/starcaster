type BuilderCollapseIconProps = {
  /** Panel open (collapse ▾) vs closed (expand ▸). */
  expanded: boolean;
  className?: string;
};

/**
 * SVG expand/collapse mark — circle chrome is CSS on the parent; triangle size is exact ink, not font metrics.
 */
export function BuilderCollapseIcon({ expanded, className = "" }: BuilderCollapseIconProps) {
  const shellClass = ["builder-collapse-icon-mark", className].filter(Boolean).join(" ");

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
