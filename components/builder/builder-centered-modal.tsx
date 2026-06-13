import type { CSSProperties, ReactNode } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

type BuilderCenteredModalProps = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Caps the dialog width; defaults to a comfortable form width. */
  maxWidth?: number;
};

/**
 * A viewport-centered modal for editors that would otherwise render inline at a
 * deeply-nested element's location (e.g. a module inside a far-right table
 * cell), where their position in the layout makes them clipped or unreachable.
 * Rendering through {@link BuilderBodyPortal} detaches the editor from that
 * location so it is always centered and accessible, and reuses the existing
 * gallery-overlay styling so it matches the other builder modals.
 */
export function BuilderCenteredModal({ title, onClose, children, maxWidth = 560 }: BuilderCenteredModalProps) {
  const modalStyle: CSSProperties = { width: `min(${maxWidth}px, 100%)` };

  return (
    <BuilderBodyPortal>
      <div className="builder-gallery-overlay" onClick={onClose} role="presentation">
        <div
          className="builder-gallery-modal builder-centered-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          style={modalStyle}
        >
          <div className="builder-gallery-header">
            <div>
              <h3>{title}</h3>
            </div>
            <div className="builder-gallery-header-actions">
              <button className="secondary-button" onClick={onClose} type="button">
                Done
              </button>
            </div>
          </div>
          <div className="builder-gallery-body">{children}</div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
