type Props = {
  colors: Array<{ label: string; hex: string }>;
  onSelect: (hex: string) => void;
};

const PALETTE_LABELS = new Set(["Primary", "Secondary", "Accent", "Background"]);

export function BuilderThemeSwatches({ colors, onSelect }: Props) {
  const palette = colors.filter((c) => PALETTE_LABELS.has(c.label) && c.hex);
  if (!palette.length) return null;
  return (
    <div className="builder-theme-swatches">
      {palette.map(({ label, hex }) => (
        <button
          key={label}
          className="builder-theme-swatch"
          style={{ background: hex }}
          title={label}
          type="button"
          onClick={() => onSelect(hex)}
        />
      ))}
    </div>
  );
}
