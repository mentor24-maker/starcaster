import type { CSSProperties, ReactNode } from "react";

export function getNumericSelectDigitCount(max: number, min = 0): number {
  const largest = Math.max(Math.abs(min), Math.abs(max));
  return Math.max(1, String(largest).length);
}

export function getNumericSelectDigitCountFromOptions(options: Array<string | number>): number {
  let maxDigits = 1;

  for (const option of options) {
    const digits = String(option).match(/\d/g)?.length ?? 0;
    maxDigits = Math.max(maxDigits, digits);
  }

  return maxDigits;
}

export function buildNumericSelectWidthStyle(digitCount: number): CSSProperties {
  return { "--numeric-select-digit-count": String(Math.max(1, digitCount)) } as CSSProperties;
}

export function buildNumberSelectOptions(min: number, max: number, step = 1) {
  const options: string[] = [];

  for (let value = min; value <= max; value += step) {
    options.push(String(value));
  }

  return options;
}

export function normalizeNumberSelectValue(
  value: string | undefined,
  fallback: string,
  min: number,
  max: number,
  step = 1
) {
  const parsed = Number.parseFloat(String(value ?? fallback));

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.min(max, Math.max(min, parsed));
  const stepped = Math.round((clamped - min) / step) * step + min;

  return String(stepped);
}

type BuilderInlineNumberSelectProps = {
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  fallback: string;
  onChange: (value: string) => void;
};

type BuilderNumberSelectControlProps = {
  value: string;
  min: number;
  max: number;
  step?: number;
  fallback: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function BuilderNumberSelectControl({
  value,
  min,
  max,
  step = 1,
  fallback,
  disabled = false,
  onChange
}: BuilderNumberSelectControlProps) {
  const options = buildNumberSelectOptions(min, max, step);
  const normalized = normalizeNumberSelectValue(value, fallback, min, max, step);
  const digitCount = getNumericSelectDigitCount(max, min);

  return (
    <select
      className="builder-number-select-control"
      disabled={disabled}
      style={buildNumericSelectWidthStyle(digitCount)}
      value={normalized}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export function BuilderInlineNumberSelect({
  label,
  value,
  min,
  max,
  step = 1,
  fallback,
  onChange
}: BuilderInlineNumberSelectProps) {
  const options = buildNumberSelectOptions(min, max, step);
  const normalized = normalizeNumberSelectValue(value, fallback, min, max, step);

  return (
    <label className="field builder-inline-number-field">
      <span>{label}</span>
      <select value={normalized} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={`${label}-${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BuilderInlineNumberSelectRow({ children }: { children: ReactNode }) {
  return <div className="builder-inline-number-row">{children}</div>;
}

type BuilderInlinePercentSelectProps = {
  label: string;
  value: string;
  fallback?: string;
  onChange: (value: string) => void;
};

export function BuilderInlinePercentSelect({
  label,
  value,
  fallback = "1",
  onChange
}: BuilderInlinePercentSelectProps) {
  const fallbackPercent = String(Math.round(Number.parseFloat(fallback) * 100));
  const percentValue = String(Math.round(Number.parseFloat(value || fallback) * 100));

  return (
    <BuilderInlineNumberSelect
      label={label}
      value={percentValue}
      min={0}
      max={100}
      step={1}
      fallback={fallbackPercent}
      onChange={(next) => onChange(String(Number(next) / 100))}
    />
  );
}
