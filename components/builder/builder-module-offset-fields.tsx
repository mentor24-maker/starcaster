import { normalizeSignedOffsetValue } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type BuilderModuleOffsetFieldsProps = {
  horizontalOffset: string;
  verticalOffset: string;
  onHorizontalOffsetChange: (value: string) => void;
  onVerticalOffsetChange: (value: string) => void;
};

export function BuilderModuleOffsetFields({
  horizontalOffset,
  verticalOffset,
  onHorizontalOffsetChange,
  onVerticalOffsetChange
}: BuilderModuleOffsetFieldsProps) {
  return (
    <div className="builder-module-offset-fields">
      <BuilderSettingRow label="Horizontal Offset" fullWidth>
        <div className="builder-setting-value-stack">
          <input
            type="number"
            min={-500}
            max={500}
            step={1}
            value={horizontalOffset}
            onChange={(event) =>
              onHorizontalOffsetChange(normalizeSignedOffsetValue(event.target.value, "0"))
            }
          />
          <span className="builder-module-offset-hint">Positive moves right; negative moves left.</span>
        </div>
      </BuilderSettingRow>
      <BuilderSettingRow label="Vertical Offset" fullWidth>
        <div className="builder-setting-value-stack">
          <input
            type="number"
            min={-500}
            max={500}
            step={1}
            value={verticalOffset}
            onChange={(event) =>
              onVerticalOffsetChange(normalizeSignedOffsetValue(event.target.value, "0"))
            }
          />
          <span className="builder-module-offset-hint">Positive moves up; negative moves down.</span>
        </div>
      </BuilderSettingRow>
    </div>
  );
}
