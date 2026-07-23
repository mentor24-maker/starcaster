"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";

export type BuilderFloatingSaveAction = {
  label: string;
  savingLabel: string;
  onSave: () => void;
};

type BuilderFloatingSaveRailProps = {
  actions: BuilderFloatingSaveAction[];
  isSaving: boolean;
  /**
   * The one element this rail shadows. While that element is on screen the
   * rail hides, so the same button is never visible twice. Pass null for
   * surfaces that have no in-page save button (the rail then just floats).
   */
  anchorSelector?: string | null;
};

/** Marks the single in-page button the pages-mode rail shadows. */
export const BUILDER_SAVE_ANCHOR_ATTR = "data-builder-save-anchor";
export const BUILDER_SAVE_ANCHOR_SELECTOR = `[${BUILDER_SAVE_ANCHOR_ATTR}]`;

// Distance from the top/bottom viewport edge when the anchor is scrolled away.
const EDGE_GAP = 24;
const BUTTON_RESERVE = 74;

const FALLBACK_POSITION: CSSProperties = {
  top: "50%",
  right: "60px",
  left: "auto",
  transform: "translateY(-50%)",
  visibility: "visible"
};

const HIDDEN_POSITION: CSSProperties = {
  top: "-9999px",
  left: "-9999px",
  right: "auto",
  transform: "none",
  visibility: "hidden"
};

function isOnScreen(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function readAnchorPosition(anchorSelector: string | null): CSSProperties {
  if (!anchorSelector) {
    return FALLBACK_POSITION;
  }

  const anchor = Array.from(document.querySelectorAll<HTMLElement>(anchorSelector)).find(
    el => el.getBoundingClientRect().height > 0
  );

  if (!anchor) {
    return FALLBACK_POSITION;
  }

  const rect = anchor.getBoundingClientRect();

  // The real button is in view — show only that one.
  if (isOnScreen(rect)) {
    return HIDDEN_POSITION;
  }

  // Scrolled away: keep the rail in the anchor's column, pinned to whichever
  // edge the anchor went past.
  const right = Math.max(window.innerWidth - rect.right, 12);
  const top = rect.bottom <= 0 ? EDGE_GAP : window.innerHeight - BUTTON_RESERVE;

  return {
    top: `${top}px`,
    right: `${right}px`,
    left: "auto",
    transform: "none",
    visibility: "visible"
  };
}

function positionSignature(style: CSSProperties) {
  return `${style.top ?? ""}|${style.left ?? ""}|${style.right ?? ""}|${style.transform ?? ""}|${style.visibility ?? ""}`;
}

export function BuilderFloatingSaveRail({
  actions,
  isSaving,
  anchorSelector = BUILDER_SAVE_ANCHOR_SELECTOR
}: BuilderFloatingSaveRailProps) {
  const [position, setPosition] = useState<CSSProperties>(HIDDEN_POSITION);
  const actionsRef = useRef(actions);
  const positionSignatureRef = useRef("");
  const actionKey = actions.length > 0 ? actions[0]?.label ?? "" : "";

  actionsRef.current = actions;

  useLayoutEffect(() => {
    if (actions.length === 0) {
      positionSignatureRef.current = "";
      return;
    }

    let frameId = 0;

    function applyPosition() {
      const next = readAnchorPosition(anchorSelector);
      const signature = positionSignature(next);

      if (signature === positionSignatureRef.current) {
        return;
      }

      positionSignatureRef.current = signature;
      setPosition(next);
    }

    function schedulePositionUpdate() {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = 0;
        applyPosition();
      });
    }

    positionSignatureRef.current = "";
    applyPosition();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    // The anchor can move without a scroll or resize — panels collapse, the
    // page list re-renders — so watch the layout too.
    const observer = new ResizeObserver(schedulePositionUpdate);
    observer.observe(document.documentElement);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      observer.disconnect();
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      positionSignatureRef.current = "";
    };
  }, [actionKey, actions.length, anchorSelector]);

  if (actions.length === 0) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return (
    <BuilderBodyPortal>
      <aside aria-label="Save actions" className="builder-floating-save-rail" style={position}>
        {actionsRef.current.map((action) => (
          <button
            key={action.label}
            className="submit-button admin-blog-add-button"
            disabled={isSaving}
            onClick={action.onSave}
            type="button"
          >
            {isSaving ? action.savingLabel : action.label}
          </button>
        ))}
      </aside>
    </BuilderBodyPortal>
  );
}
