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
  width?: BuilderModuleFieldWidth;
  children: ReactNode;
};

export function BuilderModuleFieldStrip({ children, className }: BuilderModuleFieldStripProps) {
  return <div className={["builder-module-field-strip", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function BuilderModuleField({ label, width = "auto", children }: BuilderModuleFieldProps) {
  return (
    <div className={`builder-module-field builder-module-field--${width}`}>
      <span className="builder-module-field-label">{label}</span>
      <div className="builder-module-field-control">{children}</div>
    </div>
  );
}
