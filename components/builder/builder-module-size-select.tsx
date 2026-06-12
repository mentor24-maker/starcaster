"use client";

import { BuilderSettingRow } from "./builder-setting-row";

export const BUILDER_MODULE_SIZE_OPTIONS = [
  { value: "10", label: "10%" },
  { value: "15", label: "15%" },
  { value: "25", label: "25%" },
  { value: "33", label: "33%" },
  { value: "50", label: "50%" },
  { value: "66", label: "66%" },
  { value: "75", label: "75%" },
  { value: "100", label: "100%" }
] as const;

type BuilderModuleSizeSelectProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
};

export function BuilderModuleSizeSelect({
  label = "Size",
  value,
  onChange
}: BuilderModuleSizeSelectProps) {
  return (
    <BuilderSettingRow label={label}>
      <select value={value || "100"} onChange={(event) => onChange(event.target.value)}>
        {BUILDER_MODULE_SIZE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </BuilderSettingRow>
  );
}
