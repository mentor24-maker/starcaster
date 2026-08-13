import { useEffect, useRef } from "react";
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

/**
 * Where the option list starts.
 *
 * Counting up from `min` gave a control whose numbers were all off the round
 * ones: Icon Size runs 16–160 in fives, so the list read 16, 21, 26, 31 …
 * (operator, 2026-08-12: "a bunch of odd options"). The step is the size of
 * the jump; it says nothing about where the jumps should land. They should
 * land on multiples of the step — 20, 25, 30 — which is where a person
 * expects to find them.
 *
 * Only whole steps above 1 are aligned. A step of 1 already hits every
 * integer, and a fractional step (the Tractor Nav speed counts in tenths)
 * would pick up floating-point dust from the division.
 */
function firstOptionValue(min: number, step: number): number {
  if (!Number.isInteger(step) || step <= 1) return min;
  return Math.ceil(min / step) * step;
}

export function buildNumberSelectOptions(min: number, max: number, step = 1) {
  const options: string[] = [];

  for (let value = firstOptionValue(min, step); value <= max; value += step) {
    options.push(String(value));
  }

  // A range too narrow to hold a single aligned value still needs something
  // to show, and min is the honest one — it is the floor the renderer clamps
  // to anyway.
  if (options.length === 0) options.push(String(min));

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
 * from an import, or from a step that has since changed.
 *
 * Until 2026-08-12 such a value was ADDED to the list and selected, so the
 * panel could never disagree with the page — the concern being that showing
 * 405 while 403 stayed in the document is the worst kind of wrong, because it
 * looks fine. The operator's call that day was the opposite: an off-grid
 * value should move to the next value DOWN (405 → 400 for 403), so the lists
 * stay clean.
 *
 * Those two only conflict if the document is left alone. So the display no
 * longer diverges from the document — it changes the document. The controls
 * below report the snapped value through `onChange` as they mount, which is
 * why `off` is returned: it tells the caller a write is owed. An unset or
 * non-numeric value is NOT snapped; empty means "use the default" on a lot of
 * these settings, and writing a number over it would be inventing a choice
 * the operator never made.
 */
export function resolveNumberSelectOptions(
  value: string | undefined,
  fallback: string,
  min: number,
  max: number,
  step = 1
): { options: string[]; selected: string; off: boolean } {
  const options = buildNumberSelectOptions(min, max, step);
  const parsed = Number.parseFloat(String(value ?? fallback));

  if (!Number.isFinite(parsed)) {
    return { options, selected: normalizeNumberSelectValue(value, fallback, min, max, step), off: false };
  }

  const clamped = String(Math.min(max, Math.max(min, parsed)));
  if (options.includes(clamped)) {
    return { options, selected: clamped, off: false };
  }

  // The next option DOWN, or the lowest one when the value sits below the
  // whole list (16 on a control whose options now start at 20).
  const below = options.filter((option) => Number(option) <= Number(clamped));
  const selected = below.length > 0 ? below[below.length - 1] : options[0];

  // Only a real, present, numeric setting is worth rewriting. An empty one
  // was never a number to begin with.
  const off = String(value ?? "").trim().length > 0;

  return { options, selected, off };
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

/**
 * Writes a snapped value back to the setting it came from.
 *
 * The control shows the next option down from an off-grid value; without this
 * the document would keep the old one and the panel would be describing a
 * page that renders differently. It settles in one pass — the write makes
 * `value` equal `selected`, and `off` is false from then on.
 */
function useSnapToOption(off: boolean, value: string, selected: string, onChange: (value: string) => void) {
  // Every call site passes an inline arrow, so `onChange` is a new function on
  // each render and the effect re-runs whether or not anything changed. The
  // ref makes the write once-per-value: if the parent normalizes the setting
  // straight back to what it was, this stops instead of writing forever.
  const written = useRef<string | null>(null);

  useEffect(() => {
    if (!off || value === selected || written.current === value) return;
    written.current = value;
    onChange(selected);
  }, [off, onChange, selected, value]);
}

export function BuilderNumberSelectControl({
  value,
  min,
  max,
  step = 1,
  fallback,
  disabled = false,
  onChange
}: BuilderNumberSelectControlProps) {
  const { options, selected, off } = resolveNumberSelectOptions(value, fallback, min, max, step);
  const digitCount = getNumericSelectDigitCount(max, min);

  // A disabled control is showing a setting the operator cannot reach — a
  // greyed-out field rewriting the document behind them would be indefensible.
  useSnapToOption(off && !disabled, value, selected, onChange);

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
  const { options, selected, off } = resolveNumberSelectOptions(value, fallback, min, max, step);

  useSnapToOption(off, value, selected, onChange);

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
