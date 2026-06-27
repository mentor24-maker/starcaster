"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

type BuilderEditorPopupProps = {
  id?: string;
  ariaLabel: string;
  title?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(9, 16, 24, 0.42)",
  display: "grid",
  placeItems: "center",
  padding: 24,
  overflow: "hidden",
  zIndex: 10200
};

const dialogStyle: CSSProperties = {
  width: "min(360px, calc(100vw - 48px))",
  maxHeight: "min(85vh, calc(100dvh - 48px))",
  overflow: "hidden",
  border: "1px solid rgba(9, 16, 24, 0.16)",
  borderRadius: 18,
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(9, 16, 24, 0.2)",
  display: "flex",
  flexDirection: "column"
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "14px 14px 10px",
  borderBottom: "1px solid rgba(9, 16, 24, 0.08)",
  background: "#ffffff"
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 700,
  lineHeight: 1.2,
  color: "#18324a"
};

const bodyStyle: CSSProperties = {
  padding: 14,
  overflowX: "hidden",
  overflowY: "auto",
  display: "grid",
  gap: 12,
  flex: "1 1 auto",
  minHeight: 0,
  background: "#ffffff"
};

/**
 * Viewport-centered popup for compact module editor controls (color swatches,
 * background pickers, etc.). Portals through {@link BuilderBodyPortal} so the
 * dialog is never clipped by nested editor layout or overflow containers.
 *
 * Critical shell styles are inlined so the dialog remains readable even when
 * cached stylesheet bundles lag behind JS deploys.
 */
export function BuilderEditorPopup({
  id,
  ariaLabel,
  title,
  className = "",
  onClose,
  children
}: BuilderEditorPopupProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const dialogClassName = ["builder-editor-popup", className].filter(Boolean).join(" ");
  const popupTitle = title ?? ariaLabel;

  return (
    <BuilderBodyPortal>
      <div
        className="builder-gallery-overlay"
        onClick={onClose}
        role="presentation"
        style={overlayStyle}
      >
        <div
          className={dialogClassName}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onClick={(event) => event.stopPropagation()}
          style={dialogStyle}
        >
          <div className="builder-editor-popup-header" style={headerStyle}>
            <h3 className="builder-editor-popup-title" style={titleStyle}>
              {popupTitle}
            </h3>
            <button
              aria-label="Close"
              className="builder-icon-button"
              onClick={onClose}
              title="Close"
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="builder-editor-popup-body" style={bodyStyle}>
            {children}
          </div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
