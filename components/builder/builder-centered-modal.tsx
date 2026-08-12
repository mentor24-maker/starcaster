import type { CSSProperties, ReactNode } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

type BuilderCenteredModalProps = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /**
   * Floor for the dialog width — it never opens narrower than this. The
   * dialog then grows with its content up to 75% of the screen. There is
   * deliberately no cap prop: a capped editor crops (D7).
   */
  minWidth?: number;
};

/**
 * A viewport-centered modal for editors that would otherwise render inline at a
 * deeply-nested element's location (e.g. a module inside a far-right table
 * cell), where their position in the layout makes them clipped or unreachable.
 * Rendering through {@link BuilderBodyPortal} detaches the editor from that
 * location so it is always centered and accessible, and reuses the existing
 * gallery-overlay styling so it matches the other builder modals.
 */
export function BuilderCenteredModal({ title, onClose, children, minWidth = 560 }: BuilderCenteredModalProps) {
  /*
   * D7 (UI_RULES.md): the dialog sizes to its content — as wide as the
   * editor inside needs, up to 75% of the screen. Until 2026-08-11 this was
   * a fixed `min(560px, 100%)` (680 for a popped-out module, 1200 for a
   * table cell), so a multi-axis panel opened into a box narrower than the
   * panel and cropped. The floor keeps a small editor from opening tiny;
   * the ceiling is the screen, not a number picked at the call site.
   */
  const modalStyle: CSSProperties = {
    width: "max-content",
    minWidth: `min(${minWidth}px, calc(100vw - 48px))`,
    maxWidth: "min(75vw, calc(100vw - 48px))"
  };

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
