import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Portals builder overlays (gallery, module palette, floating rails, etc.) to
 * <body> wrapped in a `.builder-react-root` element.
 *
 * The builder stylesheet is scoped under `.builder-react-root` in Starcaster
 * (see scripts/extract:builder-css), and its design tokens are defined as CSS
 * variables on that same root. When the builder runs as a mounted island the
 * editor lives under one `.builder-react-root`, but a portal straight to
 * document.body escapes it — the overlay then renders with none of its scoped
 * rules (no `position: fixed`, no z-index, no sizing) and is effectively
 * invisible. Re-establishing the root class on the portal subtree restores the
 * styles and variables.
 */
export function BuilderBodyPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(<div className="builder-react-root">{children}</div>, document.body);
}
