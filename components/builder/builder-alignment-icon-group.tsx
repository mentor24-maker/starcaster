"use client";

export type BuilderModuleAlignment = "left" | "center" | "right";

const alignmentOptions = [
  { value: "left", label: "Align left" },
  { value: "center", label: "Align center" },
  { value: "right", label: "Align right" }
] as const satisfies ReadonlyArray<{ value: BuilderModuleAlignment; label: string }>;

export function BuilderAlignmentBars() {
  return (
    <span aria-hidden className="builder-alignment-bars">
      <span />
      <span />
      <span />
    </span>
  );
}

type BuilderAlignmentIconGroupProps = {
  value: BuilderModuleAlignment;
  onChange: (value: BuilderModuleAlignment) => void;
  ariaLabel?: string;
};

export function BuilderAlignmentIconGroup({
  value,
  onChange,
  ariaLabel = "Module alignment"
}: BuilderAlignmentIconGroupProps) {
  return (
    <div className="builder-alignment-icon-group" role="group" aria-label={ariaLabel}>
      {alignmentOptions.map((option) => (
        <button
          key={option.value}
          aria-label={option.label}
          className={`builder-icon-button builder-alignment-icon-button builder-alignment-icon-button-${option.value}${
            option.value === value ? " builder-icon-button-active" : ""
          }`}
          onClick={() => onChange(option.value)}
          title={option.label}
          type="button"
        >
          <BuilderAlignmentBars />
        </button>
      ))}
    </div>
  );
}
