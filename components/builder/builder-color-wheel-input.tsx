"use client";

type BuilderColorWheelInputProps = {
  /** Hex value shown in the core of the wheel. */
  value: string;
  onChange: (hex: string) => void;
  /** Id the row label points at, so clicking the label opens the picker. */
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
};

/**
 * A color input drawn as a color wheel: a rainbow ring around the current
 * color. The browser's bare `input[type="color"]` renders as a plain pale box
 * that reads as decoration, so the operator clicked the row label instead and
 * nothing happened (2026-08-10). Pair it with `BuilderSettingRow`'s `labelFor`
 * so the label is a real click target too.
 */
export function BuilderColorWheelInput({
  value,
  onChange,
  id,
  disabled = false,
  ariaLabel,
  title = "Open the color picker"
}: BuilderColorWheelInputProps) {
  return (
    <input
      aria-label={ariaLabel}
      className="builder-color-wheel-input"
      disabled={disabled}
      id={id}
      onChange={(event) => onChange(event.target.value)}
      title={title}
      type="color"
      value={value}
    />
  );
}
