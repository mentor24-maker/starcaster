import { useState, useEffect, useCallback } from "react";
import type { BuilderTheme, BuilderThemeTypography } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeTypographySettings } from "./builder-theme-typography-settings";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

type DevelopThemeRecord = {
  id: string;
  name: string;
  primaryColor: string;
  backgroundColor: string;
  accentColor: string;
  borderThickness: number;
  borderRadius: number;
  containerBlur: number;
  contrastLevel: number;
  logoWideId: string;
  logoSquareId: string;
  featureImageId: string;
  backgroundImageId: string;
  typography: BuilderThemeTypography | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_TYPOGRAPHY: BuilderThemeTypography = {
  fonts: { heading: "", body: "", mono: "" },
  scale: { baseSize: 0, ratio: 0, baseLineHeight: 0 },
  colors: { text: "", heading: "", muted: "", link: "", linkHover: "", selection: "" },
  elements: {},
};

function defaultDraft(): DevelopThemeRecord {
  return {
    id: "",
    name: "",
    primaryColor: "#0b82d4",
    backgroundColor: "#f5fbff",
    accentColor: "#1a4f81",
    borderThickness: 1,
    borderRadius: 12,
    containerBlur: 0,
    contrastLevel: 0,
    logoWideId: "",
    logoSquareId: "",
    featureImageId: "",
    backgroundImageId: "",
    typography: { ...DEFAULT_TYPOGRAPHY },
    createdAt: "",
    updatedAt: "",
  };
}

function toBuilderTheme(draft: DevelopThemeRecord): BuilderTheme {
  return { typography: draft.typography ?? DEFAULT_TYPOGRAPHY };
}

function buildPayload(draft: DevelopThemeRecord) {
  return {
    name: draft.name.trim(),
    primaryColor: draft.primaryColor,
    backgroundColor: draft.backgroundColor,
    accentColor: draft.accentColor,
    borderThickness: draft.borderThickness,
    borderRadius: draft.borderRadius,
    containerBlur: draft.containerBlur,
    contrastLevel: draft.contrastLevel,
    logoWideId: draft.logoWideId,
    logoSquareId: draft.logoSquareId,
    featureImageId: draft.featureImageId,
    backgroundImageId: draft.backgroundImageId,
    typography: draft.typography ?? DEFAULT_TYPOGRAPHY,
  };
}

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
};

function SliderRow({ label, value, min, max, step = 1, onChange }: SliderRowProps) {
  return (
    <BuilderSettingRow label={label}>
      <span className="builder-themes-slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="builder-themes-slider-value">{value}</span>
      </span>
    </BuilderSettingRow>
  );
}

type ColorRowProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function ColorRow({ label, value, onChange }: ColorRowProps) {
  return (
    <BuilderSettingRow label={label}>
      <input type="color" value={value || "#000000"} onChange={(e) => onChange(e.target.value)} />
    </BuilderSettingRow>
  );
}

export function BuilderThemesPage() {
  const [themes, setThemes] = useState<DevelopThemeRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<DevelopThemeRecord>(defaultDraft());
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadThemes = useCallback(async () => {
    try {
      const res = await appApi("/api/develop/themes");
      const list: DevelopThemeRecord[] = unwrapEnvelope(res, "themes") ?? [];
      setThemes(list);
    } catch {
      setStatus({ message: "Could not load themes", isError: true });
    }
  }, []);

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const found = themes.find((t) => t.id === id);
    setDraft(found ? { ...found, typography: found.typography ?? { ...DEFAULT_TYPOGRAPHY } } : defaultDraft());
    setStatus(null);
  }

  function handleNew() {
    setSelectedId("");
    setDraft(defaultDraft());
    setStatus(null);
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      setStatus({ message: "Theme name is required", isError: true });
      return;
    }
    setIsSaving(true);
    setStatus(null);
    const isNew = !draft.id;
    const url = isNew
      ? "/api/develop/themes"
      : `/api/develop/themes/${encodeURIComponent(draft.id)}`;
    const method = isNew ? "POST" : "PATCH";
    try {
      const res = await appApi(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(draft)),
      });
      const saved: DevelopThemeRecord = unwrapEnvelope(res, "theme");
      await loadThemes();
      setSelectedId(saved.id);
      setDraft({ ...saved, typography: saved.typography ?? { ...DEFAULT_TYPOGRAPHY } });
      setStatus({ message: isNew ? "Theme created" : "Theme saved", isError: false });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not save theme", isError: true });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) {
      handleNew();
      return;
    }
    if (!window.confirm(`Delete theme "${draft.name || draft.id}"?`)) return;
    setIsSaving(true);
    try {
      await appApi(`/api/develop/themes/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      await loadThemes();
      handleNew();
      setStatus({ message: "Theme deleted", isError: false });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not delete theme", isError: true });
    } finally {
      setIsSaving(false);
    }
  }

  function updateDraft(patch: Partial<DevelopThemeRecord>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setStatus(null);
  }

  function handleTypographyChange(updater: (theme: BuilderTheme) => BuilderTheme) {
    setDraft((prev) => {
      const next = updater(toBuilderTheme(prev));
      return { ...prev, typography: next.typography };
    });
    setStatus(null);
  }

  const isEditing = Boolean(draft.id);

  return (
    <div className="builder-themes-page">
      <div className="builder-themes-header">
        <select
          className="builder-themes-selector"
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">— Select theme —</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || t.id}
            </option>
          ))}
        </select>
        <input
          className="builder-themes-name-input"
          type="text"
          placeholder="Theme name"
          value={draft.name}
          onChange={(e) => updateDraft({ name: e.target.value })}
        />
        <button type="button" className="builder-icon-button" onClick={handleNew}>
          New
        </button>
        <button
          type="button"
          className="builder-icon-button builder-icon-button-active"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : isEditing ? "Save" : "Create"}
        </button>
        {isEditing && (
          <button
            type="button"
            className="builder-icon-button"
            onClick={handleDelete}
            disabled={isSaving}
          >
            Delete
          </button>
        )}
      </div>

      {status && (
        <div
          className={`builder-themes-status${status.isError ? " builder-themes-status-error" : ""}`}
          role="status"
        >
          {status.message}
        </div>
      )}

      <div className="builder-themes-columns">
        <div className="builder-themes-col">
          <h3 className="builder-themes-col-heading">Palette</h3>
          <ColorRow
            label="Primary"
            value={draft.primaryColor}
            onChange={(v) => updateDraft({ primaryColor: v })}
          />
          <ColorRow
            label="Background"
            value={draft.backgroundColor}
            onChange={(v) => updateDraft({ backgroundColor: v })}
          />
          <ColorRow
            label="Accent"
            value={draft.accentColor}
            onChange={(v) => updateDraft({ accentColor: v })}
          />
          <h4 className="builder-themes-sub-heading">Styles</h4>
          <SliderRow
            label="Border thickness"
            value={draft.borderThickness}
            min={0}
            max={20}
            onChange={(v) => updateDraft({ borderThickness: v })}
          />
          <SliderRow
            label="Border radius"
            value={draft.borderRadius}
            min={0}
            max={50}
            onChange={(v) => updateDraft({ borderRadius: v })}
          />
          <SliderRow
            label="Container blur"
            value={draft.containerBlur}
            min={0}
            max={24}
            onChange={(v) => updateDraft({ containerBlur: v })}
          />
          <SliderRow
            label="Contrast"
            value={draft.contrastLevel}
            min={0}
            max={100}
            onChange={(v) => updateDraft({ contrastLevel: v })}
          />
        </div>

        <div className="builder-themes-col">
          <h3 className="builder-themes-col-heading">Typography</h3>
          <BuilderThemeTypographySettings
            theme={toBuilderTheme(draft)}
            onChange={handleTypographyChange}
          />
        </div>

        <div className="builder-themes-col">
          <h3 className="builder-themes-col-heading">Assets</h3>
          <div className="builder-themes-asset-group">
            <p className="builder-themes-asset-label">Logo — Wide</p>
            <BuilderImagePickerField
              value={draft.logoWideId}
              onChange={(v) => updateDraft({ logoWideId: v })}
              placeholder="Logo wide URL"
              buttonLabel="Choose Logo Wide"
            />
          </div>
          <div className="builder-themes-asset-group">
            <p className="builder-themes-asset-label">Logo — Square</p>
            <BuilderImagePickerField
              value={draft.logoSquareId}
              onChange={(v) => updateDraft({ logoSquareId: v })}
              placeholder="Logo square URL"
              buttonLabel="Choose Logo Square"
            />
          </div>
          <div className="builder-themes-asset-group">
            <p className="builder-themes-asset-label">Feature Image</p>
            <BuilderImagePickerField
              value={draft.featureImageId}
              onChange={(v) => updateDraft({ featureImageId: v })}
              placeholder="Feature image URL"
              buttonLabel="Choose Feature Image"
            />
          </div>
          <div className="builder-themes-asset-group">
            <p className="builder-themes-asset-label">Background Image</p>
            <BuilderImagePickerField
              value={draft.backgroundImageId}
              onChange={(v) => updateDraft({ backgroundImageId: v })}
              placeholder="Background image URL"
              buttonLabel="Choose Background Image"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
