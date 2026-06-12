"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

type BuilderCodeEmbedProps = {
  html: string;
  className?: string;
  /** When true (default), chart iframes load only after the user opts in — prevents focus/scroll steal. */
  requireActivation?: boolean;
};

function deferIframeSrc(html: string) {
  return html.replace(
    /<iframe\b([^>]*?)\ssrc=(["'])([^"']+)\2/gi,
    '<iframe$1 data-deferred-src=$2$3$2'
  );
}

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

/**
 * Renders sanitized Code-module HTML. Chart iframes (Dexscreener, etc.) are deferred
 * until the user clicks through so third-party embeds cannot grab focus on page load.
 */
export function BuilderCodeEmbed({
  html,
  className = "builder-preview-code-render",
  requireActivation = true
}: BuilderCodeEmbedProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  const [activated, setActivated] = useState(!requireActivation);

  const renderedHtml = useMemo(() => {
    if (!html) {
      return "";
    }

    return requireActivation && !activated ? deferIframeSrc(html) : html;
  }, [activated, html, requireActivation]);

  useLayoutEffect(() => {
    if (!requireActivation || activated) {
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
  }, [activated, renderedHtml, requireActivation]);

  useLayoutEffect(() => {
    if (!requireActivation || activated) {
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
  }, [activated, requireActivation, renderedHtml]);

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

  const showShield = requireActivation && !activated;

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
            onClick={() => setActivated(true)}
            aria-label="Load interactive chart"
          >
            <span className="builder-code-embed-shield-label">Load Chart</span>
            <ChartLoadIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}
