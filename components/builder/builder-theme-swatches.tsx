type ThemeSwatch = { label: string; hex: string };

type Props = {
  colors: ThemeSwatch[];
  onSelect: (hex: string) => void;
  showLabels?: boolean;
};

const PALETTE_ORDER = ["Primary", "Secondary", "Background", "Accent"] as const;

export function BuilderThemeSwatches({ colors, onSelect, showLabels = false }: Props) {
  const colorMap = new Map(
    colors
      .filter((entry) => PALETTE_ORDER.includes(entry.label as (typeof PALETTE_ORDER)[number]) && entry.hex)
      .map((entry) => [entry.label, entry.hex])
  );

  return (
    <div className={`builder-theme-swatches${showLabels ? " builder-theme-swatches-labeled" : ""}`}>
      {PALETTE_ORDER.map((label) => {
        const hex = colorMap.get(label);

        return (
          <div className="builder-theme-swatch-cell" key={label}>
            <button
              className={`builder-theme-swatch${hex ? "" : " builder-theme-swatch-empty"}`}
              disabled={!hex}
              onClick={() => {
                if (hex) {
                  onSelect(hex);
                }
              }}
              style={hex ? { background: hex } : undefined}
              title={hex ? label : `${label} (not set on theme)`}
              type="button"
            />
            {showLabels ? <span className="builder-theme-swatch-label">{label}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
