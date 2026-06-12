import type { ReactNode } from "react";

type BuilderSettingRowProps = {
  label: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
};

export function BuilderSettingRow({ label, children, fullWidth = false }: BuilderSettingRowProps) {
  return (
    <div className={`builder-setting-row${fullWidth ? " builder-setting-row-full" : ""}`}>
      <span className="builder-setting-label">{label}</span>
      <div className="builder-setting-value">{children}</div>
    </div>
  );
}
