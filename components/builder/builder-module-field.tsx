import type { ReactNode } from "react";

/** Declared control widths for builder module field strips. */
export type BuilderModuleFieldWidth =
  | "label"
  | "select-sm"
  | "select-md"
  | "num"
  | "color"
  | "align"
  | "check"
  | "text-md"
  | "auto"
  | "full";

type BuilderModuleFieldStripProps = {
  children: ReactNode;
  className?: string;
};

type BuilderModuleFieldProps = {
  label: ReactNode;
  /**
   * Required on purpose (doctrine 1a.E2, docs/MODULE_UI_DOCTRINE.md).
   *
   * This was optional, defaulting to "auto", which made "every field declares
   * a width token" unenforceable — a control left to size itself stretches to
   * fill leftover row space and the strip looks unfinished. All 70 call sites
   * already passed one, so requiring it costs nothing and moves the rule from
   * an eyeball check to a compile error. Pass "auto" explicitly when a field
   * genuinely should size to its content.
   */
  width: BuilderModuleFieldWidth;
  children: ReactNode;
};

export function BuilderModuleFieldStrip({ children, className }: BuilderModuleFieldStripProps) {
  return <div className={["builder-module-field-strip", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function BuilderModuleField({ label, width, children }: BuilderModuleFieldProps) {
  return (
    <div className={`builder-module-field builder-module-field--${width}`}>
      <span className="builder-module-field-label">{label}</span>
      <div className="builder-module-field-control">{children}</div>
    </div>
  );
}
