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

/** The gap kept between Back to top and a Bug Report button below it. */
const STACK_GAP_PX = 12;
/** Back to top's own resting distance from the bottom edge (matches the CSS). */
const RESTING_BOTTOM_PX = 20;

/**
 * How far from the bottom edge Back to top must sit so it clears a floating
 * Bug Report button in the same corner (review of PR #1067: both default to
 * the bottom-right, and the higher z-index took Bug Report's clicks).
 *
 * `triggerTop` is the trigger's top edge in viewport pixels, or null when no
 * trigger floats bottom-right. Returns null when no lift is needed.
 */
export function backToTopLiftBottom(triggerTop: number | null, viewportHeight: number): number | null {
  if (triggerTop === null || !Number.isFinite(triggerTop) || !Number.isFinite(viewportHeight)) return null;
  const clearance = viewportHeight - triggerTop + STACK_GAP_PX;
  return clearance > RESTING_BOTTOM_PX ? Math.ceil(clearance) : null;
}

/**
 * Ink for the arrow: dark on a pale accent, white on a dark one (review of
 * PR #1067, note 6 — a white arrow on a pale accent all but disappears).
 * Reads #rgb, #rrggbb and rgb()/rgba(); anything else keeps the white default.
 */
export function backToTopInk(accent: string): string | null {
  const value = String(accent || "").trim().toLowerCase();
  let rgb: number[] | null = null;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  }
  if (!rgb) return null;
  // WCAG relative luminance; 0.179 is where black and white text tie on contrast.
  const [r, g, b] = rgb.map((c) => {
    const v = Math.min(255, c) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? "#111111" : "#ffffff";
}

function floatingBugReportTop(): number | null {
  const trigger = document.querySelector(
    ".builder-bug-report-trigger.is-floating.builder-bug-report-trigger--bottom-right"
  );
  if (!trigger) return null;
  const rect = trigger.getBoundingClientRect();
  return rect.height > 0 ? rect.top : null;
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
  const [liftBottom, setLiftBottom] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const update = () => {
      setVisible(backToTopShouldShow(window.scrollY, window.innerHeight));
      // Measured on every update, not once: the Bug Report trigger is portaled
      // in after its own settings load, so it may not exist at first paint.
      setLiftBottom(backToTopLiftBottom(floatingBugReportTop(), window.innerHeight));
    };
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
  const ink = accent ? backToTopInk(accent) : null;
  const styleVars: Record<string, string> = {};
  if (accent) styleVars["--site-back-to-top-bg"] = accent;
  if (ink) styleVars["--site-back-to-top-ink"] = ink;
  const style: CSSProperties | undefined =
    accent || liftBottom !== null
      ? ({ ...styleVars, ...(liftBottom !== null ? { bottom: `${liftBottom}px` } : {}) } as CSSProperties)
      : undefined;

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
