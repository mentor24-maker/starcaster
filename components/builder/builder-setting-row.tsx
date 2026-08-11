import type { ReactNode } from "react";

type BuilderSettingRowProps = {
  label: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
  /**
   * Id of the control this row labels. Renders the label as a real `<label>`,
   * so clicking the words activates the control — the fix for "the label text
   * isn't clickable" (operator, 2026-08-10).
   */
  labelFor?: string;
};

export function BuilderSettingRow({
  label,
  children,
  fullWidth = false,
  labelFor
}: BuilderSettingRowProps) {
  return (
    <div className={`builder-setting-row${fullWidth ? " builder-setting-row-full" : ""}`}>
      {labelFor ? (
        <label className="builder-setting-label" htmlFor={labelFor}>
          {label}
        </label>
      ) : (
        <span className="builder-setting-label">{label}</span>
      )}
      <div className="builder-setting-value">{children}</div>
    </div>
  );
}
