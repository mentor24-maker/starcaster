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

/**
 * The options to render, and which one is selected.
 *
 * A saved value does not have to sit on the step grid. It can predate the
 * step (a width saved at 403 before the control counted in fives), or come
 * from an import, or from a step that has since changed. Snapping the display
 * to the nearest option would show 405 while 403 stayed in the document —
 * the panel quietly disagreeing with the page, which is the worst kind of
 * wrong because it looks fine.
 *
 * So an off-grid value is added to the list, in order, and selected. The
 * operator sees what is actually set; the moment they pick anything else it
 * rejoins the grid and the stray option disappears.
 */
export function resolveNumberSelectOptions(
  value: string | undefined,
  fallback: string,
  min: number,
  max: number,
  step = 1
): { options: string[]; selected: string } {
  const options = buildNumberSelectOptions(min, max, step);
  const parsed = Number.parseFloat(String(value ?? fallback));

  if (!Number.isFinite(parsed)) {
    return { options, selected: normalizeNumberSelectValue(value, fallback, min, max, step) };
  }

  const clamped = String(Math.min(max, Math.max(min, parsed)));
  if (options.includes(clamped)) {
    return { options, selected: clamped };
  }

  return {
    options: [...options, clamped].sort((left, right) => Number(left) - Number(right)),
    selected: clamped
  };
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
  const { options, selected } = resolveNumberSelectOptions(value, fallback, min, max, step);
  const digitCount = getNumericSelectDigitCount(max, min);

  return (
    <select
      className="builder-number-select-control"
      disabled={disabled}
      style={buildNumericSelectWidthStyle(digitCount)}
      value={selected}
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
  const { options, selected } = resolveNumberSelectOptions(value, fallback, min, max, step);

  return (
    <label className="field builder-inline-number-field">
      <span>{label}</span>
      <select value={selected} onChange={(event) => onChange(event.target.value)}>
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
