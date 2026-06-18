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
};

const FALLBACK_POSITION: CSSProperties = {
  top: "50%",
  right: "20px",
  left: "auto",
  transform: "translateY(-50%)",
  visibility: "visible"
};

function readShellAnchorPosition(): CSSProperties {
  const shell =
    document.querySelector<HTMLElement>(".builder-pages-details-shell") ??
    document.querySelector<HTMLElement>(".builder-editor-layout-main") ??
    document.querySelector<HTMLElement>(".builder-editor-section") ??
    document.querySelector<HTMLElement>(".admin-page .admin-shell");

  if (!shell) {
    return FALLBACK_POSITION;
  }

  const rect = shell.getBoundingClientRect();
  const gap = 20;
  const buttonReserve = 200;
  // Use the visible portion of the shell to compute mid — avoids clamping to
  // 96px (top of screen) when the page is scrolled and rect.top is negative.
  const clampedTop = Math.max(rect.top, 0);
  const clampedBottom = Math.min(rect.bottom, window.innerHeight);
  const anchorMid = clampedBottom > clampedTop
    ? (clampedTop + clampedBottom) / 2
    : window.innerHeight / 2;
  const top = Math.min(Math.max(anchorMid, 96), window.innerHeight - 96);
  const preferredLeft = rect.right + gap;
  const maxLeft = window.innerWidth - buttonReserve;

  if (preferredLeft > maxLeft || rect.width >= window.innerWidth - 48) {
    return {
      top: `${top}px`,
      right: "60px",
      left: "auto",
      transform: "translateY(-50%)",
      visibility: "visible"
    };
  }

  return {
    top: `${top}px`,
    left: `${preferredLeft}px`,
    right: "auto",
    transform: "translateY(-50%)",
    visibility: "visible"
  };
}

function positionSignature(style: CSSProperties) {
  return `${style.top ?? ""}|${style.left ?? ""}|${style.right ?? ""}|${style.transform ?? ""}|${style.visibility ?? ""}`;
}

export function BuilderFloatingSaveRail({ actions, isSaving }: BuilderFloatingSaveRailProps) {
  const [position, setPosition] = useState<CSSProperties>(FALLBACK_POSITION);
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
      const next = readShellAnchorPosition();
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

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      positionSignatureRef.current = "";
    };
  }, [actionKey, actions.length]);

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
