import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";

/**
 * The round "Back to top" button a page can turn on in its Page Details
 * (task SC-864). Styled in `_builder-react-overrides.css` (`.site-back-to-top`).
 *
 * Shared by BuilderPublicSitePage and the preview page, so the render contract
 * measures the same button a visitor gets.
 *
 * - It is a real link to `#top`, which every browser scrolls to the top of the
 *   document even with no element of that name — so it works from the keyboard
 *   (Tab, then Enter) and would work without the click handler at all.
 * - It is hidden until the reader has scrolled further than one window height.
 *   Hidden means `visibility: hidden`, which also takes it out of the Tab
 *   order, so a keyboard visitor never lands on an invisible control.
 * - The click scrolls smoothly, unless the visitor asked their system for
 *   reduced motion, and moves focus nowhere surprising: the address stays
 *   clean (no `#top` appended) because the default jump is replaced.
 */

/** Scrolled far enough for the button to show: more than one screen down. */
export function backToTopShouldShow(scrollY: number, viewportHeight: number): boolean {
  if (!Number.isFinite(scrollY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
  return scrollY > viewportHeight;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function SiteBackToTop({ enabled, accentColor }: { enabled: boolean; accentColor?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const update = () => setVisible(backToTopShouldShow(window.scrollY, window.innerHeight));
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);

  // Off means NOTHING in the markup — not a hidden element (acceptance: an
  // existing page's live markup is unchanged).
  if (!enabled) return null;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.scrollTo({ top: 0, left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const accent = String(accentColor || "").trim();
  const style = accent ? ({ "--site-back-to-top-bg": accent } as CSSProperties) : undefined;

  return (
    <a
      className={`site-back-to-top${visible ? " is-visible" : ""}`}
      href="#top"
      aria-label="Back to top"
      title="Back to top"
      onClick={onClick}
      style={style}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M12 5l-7 7 1.4 1.4L11 8.8V20h2V8.8l4.6 4.6L19 12z" fill="currentColor" />
      </svg>
    </a>
  );
}
