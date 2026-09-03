"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  embedKind,
  embedRequiresActivation,
  embedShieldAriaLabel,
  embedShieldLabel,
  type EmbedActivationMode
} from "@/lib/builder-code-embed-activation";

type BuilderCodeEmbedProps = {
  html: string;
  className?: string;
  /**
   * Hard override, ignoring the snippet and the module's setting. The Builder
   * canvas passes `false` so the editor always sees the live embed.
   */
  requireActivation?: boolean;
  /** The module's own setting. Omitted / unknown reads as "auto". */
  activation?: EmbedActivationMode | string;
};

function ChartLoadIcon() {
  return (
    <svg
      className="builder-code-embed-shield-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4 19V5M4 19H20M8 17V12M12 17V8M16 17V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Generic "open this thing" mark — a bar chart drawn over a map is its own small lie. */
function EmbedLoadIcon() {
  return (
    <svg
      className="builder-code-embed-shield-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M10 9.5v5l4.5-2.5L10 9.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function deferIframeSrc(html: string) {
  return html.replace(
    /<iframe\b([^>]*?)\ssrc=(["'])([^"']+)\2/gi,
    '<iframe$1 data-deferred-src=$2$3$2'
  );
}

/**
 * Renders sanitized Code-module HTML. Focus-stealing chart widgets
 * (Dexscreener and friends) are deferred behind a click so they cannot grab
 * focus and scroll the page on load; a map, a video or any other embed
 * renders immediately, because that is what a visitor came for. Which of the
 * two happens is `activation` — see `builder-code-embed-activation.ts`.
 */
export function BuilderCodeEmbed({
  html,
  className = "builder-preview-code-render",
  requireActivation,
  activation
}: BuilderCodeEmbedProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLButtonElement>(null);

  const shieldWanted = useMemo(
    () => requireActivation ?? embedRequiresActivation(html, activation),
    [activation, html, requireActivation]
  );

  // What the visitor clicked through, not a bare boolean: the snippet can
  // change under this component (the operator edits it, or a canvas preview
  // swaps modules), and a boolean left over from the previous snippet would
  // hand the next one a free pass past its own shield.
  const [activatedHtml, setActivatedHtml] = useState<string | null>(null);
  const activated = !shieldWanted || activatedHtml === html;

  const renderedHtml = useMemo(() => {
    if (!html) {
      return "";
    }

    return activated ? html : deferIframeSrc(html);
  }, [activated, html]);

  useLayoutEffect(() => {
    if (!shieldWanted || activated) {
      return;
    }

    const root = rootRef.current;
    if (!root) {
      return;
    }

    for (const iframe of root.querySelectorAll("iframe")) {
      const src = iframe.getAttribute("src");
      if (src) {
        iframe.dataset.deferredSrc = src;
        iframe.removeAttribute("src");
      }
    }
  }, [activated, renderedHtml, shieldWanted]);

  useLayoutEffect(() => {
    if (!shieldWanted || activated) {
      return;
    }

    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) {
      return;
    }

    const initialScroll = window.scrollY;

    const restoreScroll = () => {
      window.scrollTo({ top: initialScroll, left: 0, behavior: "instant" });
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLIFrameElement) || !root.contains(target)) {
        return;
      }

      event.preventDefault();
      sentinel.focus({ preventScroll: true });
      restoreScroll();
    };

    document.addEventListener("focusin", onFocusIn, true);

    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [activated, shieldWanted, renderedHtml]);

  useLayoutEffect(() => {
    const hash = window.location.hash.slice(1);
    const root = rootRef.current;
    if (!hash || !root?.querySelector(`#${CSS.escape(hash)}`)) {
      return;
    }

    history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    window.scrollTo(0, 0);
  }, [renderedHtml]);

  if (!html) {
    return null;
  }

  const showShield = shieldWanted && !activated;
  const kind = showShield ? embedKind(html) : "embed";

  return (
    <div className={`builder-code-embed-host${activated ? " is-activated" : ""}`}>
      <div className="builder-code-embed-stage">
        <div
          ref={rootRef}
          className={className}
          inert={showShield ? true : undefined}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {showShield ? (
          <button
            ref={sentinelRef}
            type="button"
            className="builder-code-embed-shield"
            onClick={() => setActivatedHtml(html)}
            aria-label={embedShieldAriaLabel(html)}
          >
            <span className="builder-code-embed-shield-label">{embedShieldLabel(html)}</span>
            {kind === "chart" ? <ChartLoadIcon /> : <EmbedLoadIcon />}
          </button>
        ) : null}
      </div>
    </div>
  );
}
