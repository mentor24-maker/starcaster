"use client";

import { useEffect, type ReactNode } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

type BuilderEditorPopupProps = {
  id?: string;
  ariaLabel: string;
  title?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Viewport-centered popup for compact module editor controls (color swatches,
 * background pickers, etc.). Portals through {@link BuilderBodyPortal} so the
 * dialog is never clipped by nested editor layout or overflow containers.
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
      <div className="builder-gallery-overlay" onClick={onClose} role="presentation">
        <div
          className={dialogClassName}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="builder-editor-popup-header">
            <h3 className="builder-editor-popup-title">{popupTitle}</h3>
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
          <div className="builder-editor-popup-body">{children}</div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
