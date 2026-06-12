import { GAME_AUDIENCE_OPTIONS, type GameAudience } from "@/lib/game-audience";
import { BuilderSettingRow } from "@/components/builder/builder-setting-row";

type AdminGameAudienceFieldProps = {
  value: GameAudience;
  onChange: (audience: GameAudience) => void;
};

export function AdminGameAudienceField({ value, onChange }: AdminGameAudienceFieldProps) {
  return (
    <BuilderSettingRow fullWidth label="Audience">
      <select
        className="admin-game-reward-field-select"
        value={value}
        onChange={(event) => onChange(event.target.value as GameAudience)}
      >
        {GAME_AUDIENCE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </BuilderSettingRow>
  );
}
