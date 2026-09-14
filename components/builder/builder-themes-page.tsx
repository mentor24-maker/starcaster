import { useState, useEffect, useCallback, useId } from "react";
import type {
  BackgroundSettings,
  BuilderTheme,
  BuilderThemeTypography,
  BuilderThemePalette,
  BuilderThemeTreatments,
  BuilderThemeHeroBanner,
} from "@/lib/builder-template";
import {
  createDefaultBackgroundSettings,
  finalizeThemeStylesPageBackground,
  normalizeBackgroundSettings,
  normalizeBuilderAssetUrl,
  promoteThemeStylesPageBackground,
} from "@/lib/builder-template";
import { BuilderColorWheelInput } from "./builder-color-wheel-input";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeTypographySettings } from "./builder-theme-typography-settings";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderButtonBackgroundPicker } from "./builder-button-background-picker";
import { BuilderGalleryModal } from "./builder-gallery-modal";
import { buildBuilderThemePaletteColors, seedThemeStylesPageBackground } from "./builder-utils";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { publishNamedPages } from "@/lib/publish-pages";
import {
  describeThemeSaveImpact,
  readThemeUsage,
  themeUsagePageIds,
  type ThemeUsagePage,
} from "@/lib/theme-save-impact";
import type { CanonicalOverwriteImpact } from "@/lib/shared-block-usage";
import { BuilderSharedBlockSaveModal, type SharedBlockSaveChoice } from "./builder-shared-block-save-modal";
import { BuilderThemeWizard } from "@/components/builder/builder-theme-wizard";

type DevelopThemeRecord = {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  accentColor: string;
  borderThickness: number;
  borderRadius: number;
  containerBlur: number;
  contrastLevel: number;
  topMargin: number;
  bottomMargin: number;
  sideMargins: number;
  contentWidth: number;
  logoWideId: string;
  logoSquareId: string;
  featureImageId: string;
  backgroundImageId: string;
  stylesPageBackground: BackgroundSettings;
  typography: BuilderThemeTypography | null;
  palette?: BuilderThemePalette | null;
  treatments?: BuilderThemeTreatments | null;
  heroBanner?: BuilderThemeHeroBanner | null;
  heroBanners?: string[] | null;
  /** The theme every page with no theme of its own uses (task 86bbzybx6). */
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_TYPOGRAPHY: BuilderThemeTypography = {
  fonts: { heading: "", body: "", mono: "" },
  scale: { baseSize: 0, ratio: 0, baseLineHeight: 0 },
  colors: { text: "", heading: "", muted: "", link: "", linkHover: "", selection: "", linkUnderline: true, linkHoverUnderline: true },
  elements: {},
};

function defaultDraft(): DevelopThemeRecord {
  return {
    id: "",
    name: "",
    primaryColor: "#0b82d4",
    secondaryColor: "#6c757d",
    backgroundColor: "#f5fbff",
    accentColor: "#1a4f81",
    borderThickness: 1,
    borderRadius: 12,
    containerBlur: 0,
    contrastLevel: 0,
    topMargin: 0,
    bottomMargin: 0,
    sideMargins: 0,
    contentWidth: 0,
    logoWideId: "",
    logoSquareId: "",
    featureImageId: "",
    backgroundImageId: "",
    stylesPageBackground: createDefaultBackgroundSettings(),
    typography: { ...DEFAULT_TYPOGRAPHY },
    palette: null,
    treatments: null,
    heroBanner: null,
    heroBanners: null,
    createdAt: "",
    updatedAt: "",
  };
}

function toBuilderTheme(draft: DevelopThemeRecord): BuilderTheme {
  return { typography: draft.typography ?? DEFAULT_TYPOGRAPHY };
}

function themeStylesPageBackgroundFromRecord(
  theme: Partial<DevelopThemeRecord> & { pageBackground?: BackgroundSettings }
): BackgroundSettings {
  const promoted = promoteThemeStylesPageBackground(
    theme.stylesPageBackground ?? theme.pageBackground
  );
  return promoted ?? createDefaultBackgroundSettings();
}

function buildPayload(draft: DevelopThemeRecord) {
  const stylesPageBackground = finalizeThemeStylesPageBackground(draft.stylesPageBackground);
  return {
    name: draft.name.trim(),
    primaryColor: draft.primaryColor,
    secondaryColor: draft.secondaryColor,
    backgroundColor: draft.backgroundColor,
    accentColor: draft.accentColor,
    borderThickness: draft.borderThickness,
    borderRadius: draft.borderRadius,
    containerBlur: draft.containerBlur,
    contrastLevel: draft.contrastLevel,
    topMargin: draft.topMargin,
    bottomMargin: draft.bottomMargin,
    sideMargins: draft.sideMargins,
    contentWidth: draft.contentWidth,
    logoWideId: draft.logoWideId,
    logoSquareId: draft.logoSquareId,
    featureImageId: draft.featureImageId,
    backgroundImageId: draft.backgroundImageId,
    stylesPageBackground,
    pageBackground: stylesPageBackground,
    // Wizard-written facets MUST ride along: this form sends the whole theme
    // object, so leaving them out of the payload silently erased them on the
    // next save from this screen.
    palette: draft.palette || null,
    treatments: draft.treatments || null,
    heroBanners: (draft.heroBanners || []).filter(Boolean),
    heroBanner: (() => {
      const first = (draft.heroBanners || []).find(Boolean);
      return first ? { url: first } : draft.heroBanner || null;
    })(),
    typography: {
      ...(draft.typography ?? DEFAULT_TYPOGRAPHY),
      pageLayout: {
        topMargin: draft.topMargin,
        bottomMargin: draft.bottomMargin,
        sideMargins: draft.sideMargins,
        // No DB column for this one — the typography JSON is its only home,
        // so dropping it from this payload is how it would get erased.
        contentWidth: draft.contentWidth,
      },
    },
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
  const inputId = useId();

  return (
    <BuilderSettingRow label={label} labelFor={inputId}>
      <BuilderColorWheelInput
        ariaLabel={label}
        id={inputId}
        value={value || "#000000"}
        onChange={onChange}
      />
    </BuilderSettingRow>
  );
}

const PALETTE_ROLE_ROWS: Array<{ bg: keyof BuilderThemePalette; text: keyof BuilderThemePalette; label: string }> = [
  { bg: "header", text: "headerText", label: "Header" },
  { bg: "surface", text: "surfaceText", label: "Section" },
  { bg: "band", text: "bandText", label: "Soft band" },
  { bg: "inverse", text: "inverseText", label: "Dark band" },
  { bg: "button", text: "buttonText", label: "Button" },
];

export function BuilderThemesPage() {
  const [themes, setThemes] = useState<DevelopThemeRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<DevelopThemeRecord>(defaultDraft());
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackgroundGalleryOpen, setIsBackgroundGalleryOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  // The Save / Save & Publish / Cancel question, while it is open. `resolve`
  // hands the answer back to handleSave, which is waiting on it.
  const [savePrompt, setSavePrompt] = useState<{
    resolve: (choice: SharedBlockSaveChoice | null) => void;
    impact: CanonicalOverwriteImpact;
  } | null>(null);

  const themeColors = buildBuilderThemePaletteColors(draft);

  const loadThemes = useCallback(async () => {
    try {
      const res = await appApi("/api/builder/themes");
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
    setDraft(
      found
        ? {
            ...found,
            // Themes saved before Content Width existed come back without the
            // key; the slider is controlled, so undefined would break it.
            contentWidth: Number(found.contentWidth) || 0,
            stylesPageBackground: themeStylesPageBackgroundFromRecord(found),
            typography: found.typography ?? { ...DEFAULT_TYPOGRAPHY },
          }
        : defaultDraft()
    );
    setStatus(null);
  }

  function handleNew() {
    setSelectedId("");
    setDraft(defaultDraft());
    setStatus(null);
  }

  function answerSavePrompt(choice: SharedBlockSaveChoice | null) {
    savePrompt?.resolve(choice);
    setSavePrompt(null);
  }

  /**
   * Which pages does saving this theme reach? Null when the read failed —
   * which is NOT zero: a theme dozens of pages follow must not save with no
   * question asked because one request dropped.
   */
  async function loadThemeUsage(themeId: string): Promise<ThemeUsagePage[] | null> {
    try {
      const res = await appApi(`/api/builder/themes/${encodeURIComponent(themeId)}/usage`);
      return readThemeUsage(res);
    } catch {
      return null;
    }
  }

  /**
   * Save, or Save and put the pages that use this theme live?
   *
   * A theme is a reference: saving it writes the theme row and no page row,
   * and the pages that use it pick the change up at render. But a PUBLISHED
   * page is a snapshot, so until 2026-09-13 a theme save reached nobody —
   * the Publish panel counted nothing as pending, and the operator's only
   * way to get a new headline colour live was to open every page, save it
   * by hand, and publish (task 86bbzy9ym). The server now counts a page as
   * pending when its theme is newer than its build; this asks the same
   * question the saved-section manager asks, and publishes THOSE pages by
   * id — never the whole site.
   *
   * A brand-new theme has no pages yet, so it is created without the question.
   */
  async function handleSave() {
    if (!draft.name.trim()) {
      setStatus({ message: "Theme name is required", isError: true });
      return;
    }
    const isNew = !draft.id;
    let publish = false;
    let usage: ThemeUsagePage[] | null = [];
    if (!isNew) {
      usage = await loadThemeUsage(draft.id);
      if (usage === null || usage.length > 0) {
        const choice = await new Promise<SharedBlockSaveChoice | null>((resolve) => {
          setSavePrompt({ resolve, impact: describeThemeSaveImpact(draft.name, usage) });
        });
        if (!choice) return;
        publish = choice === "save-and-publish";
      }
    }

    setIsSaving(true);
    setStatus(null);
    const url = isNew
      ? "/api/builder/themes"
      : `/api/builder/themes/${encodeURIComponent(draft.id)}`;
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
      const savedStyles = themeStylesPageBackgroundFromRecord(saved);
      setDraft({
        ...saved,
        contentWidth: Number(saved.contentWidth) || 0,
        stylesPageBackground:
          savedStyles.mode !== "none"
            ? savedStyles
            : finalizeThemeStylesPageBackground(draft.stylesPageBackground),
        typography: saved.typography ?? { ...DEFAULT_TYPOGRAPHY },
      });

      if (isNew) {
        setStatus({ message: "Theme created", isError: false });
        return;
      }

      const pageCount = usage?.length ?? 0;
      const pagesWord = pageCount === 1 ? "page" : "pages";
      if (!publish) {
        setStatus({
          message:
            pageCount > 0
              ? `Theme saved. ${pageCount} ${pagesWord} now ${pageCount === 1 ? "has" : "have"} changes to publish — open Publish to put ${pageCount === 1 ? "it" : "them"} live.`
              : "Theme saved",
          isError: false,
        });
        return;
      }

      // The save landed. A publish that does not is smaller, separate news —
      // it must not read as the save having failed.
      const outcome = await publishNamedPages(
        (body) =>
          builderAdminFetch("/api/admin/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        themeUsagePageIds(usage)
      );
      if (outcome.error) {
        setStatus({
          message: `Theme saved. Publishing did not finish: ${outcome.error} Open Publish to put these pages live.`,
          isError: true,
        });
        return;
      }
      setStatus({
        message:
          outcome.published > 0
            ? `Theme saved and published on ${outcome.published} ${outcome.published === 1 ? "page" : "pages"}.`
            : "Theme saved. Nothing needed publishing — those pages were already live with this theme.",
        isError: false,
      });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not save theme", isError: true });
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Make this the project's default — the theme every page WITHOUT a theme of
   * its own uses. It used to be whichever theme was saved last, so saving any
   * theme could recolour all of those pages (task 86bbzybx6); now it moves
   * only here. Published pages are snapshots, so the ones that change are
   * named as pending rather than silently left showing the old theme.
   */
  async function handleMakeDefault() {
    if (!draft.id) return;
    const name = draft.name || draft.id;
    if (!window.confirm(`Make "${name}" the default theme? Every page that has no theme of its own will use it.`)) return;
    setIsSaving(true);
    setStatus(null);
    try {
      await appApi(`/api/builder/themes/${encodeURIComponent(draft.id)}/default`, { method: "POST" });
      await loadThemes();
      setDraft((prev) => ({ ...prev, isDefault: true }));
      const usage = await loadThemeUsage(draft.id);
      const count = usage?.length ?? 0;
      setStatus({
        message:
          usage === null
            ? `"${name}" is now the default theme. Open Publish to put the pages that use it live.`
            : count > 0
              ? `"${name}" is now the default theme. ${count} ${count === 1 ? "page uses" : "pages use"} it and now ${count === 1 ? "has" : "have"} changes to publish — open Publish to put ${count === 1 ? "it" : "them"} live.`
              : `"${name}" is now the default theme. No published page uses it yet.`,
        isError: false,
      });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not make this the default theme", isError: true });
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
      await appApi(`/api/builder/themes/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
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

  const updatePaletteRole = (role: keyof BuilderThemePalette, value: string) => {
    updateDraft({ palette: { ...(draft.palette || {}), [role]: value } });
  };

  function handleTypographyChange(updater: (theme: BuilderTheme) => BuilderTheme) {
    setDraft((prev) => {
      const next = updater(toBuilderTheme(prev));
      return { ...prev, typography: next.typography };
    });
    setStatus(null);
  }

  const isEditing = Boolean(draft.id);

  // The wizard takes over this panel rather than mounting its own React root.
  // A separate root would need a host element registered in App.els and a
  // vanilla-JS call site to mount it — two more places to get wrong, for a
  // screen that belongs to Themes anyway.
  if (isWizardOpen) {
    return (
      <BuilderThemeWizard
        onClose={() => {
          setIsWizardOpen(false);
          // The wizard can save a new theme and change every page, so the list
          // behind it is stale the moment it closes.
          void loadThemes();
        }}
      />
    );
  }

  return (
    <div className="builder-themes-page">
      {savePrompt ? (
        <BuilderSharedBlockSaveModal
          blockKind="theme"
          name={draft.name}
          impact={savePrompt.impact}
          isSaving={isSaving}
          onChoose={(choice) => answerSavePrompt(choice)}
          onCancel={() => answerSavePrompt(null)}
        />
      ) : null}
      <div className="builder-themes-header">
        <button
          type="button"
          className="secondary-button builder-themes-btn"
          onClick={() => setIsWizardOpen(true)}
        >
          Theme Wizard
        </button>
        <select
          className="builder-themes-selector"
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">— Select theme —</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || t.id}{t.isDefault ? " (default)" : ""}
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
        <button type="button" className="secondary-button builder-themes-btn" onClick={handleNew}>
          New
        </button>
        <button
          type="button"
          className="submit-button builder-themes-btn"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : isEditing ? "Save" : "Create"}
        </button>
        {isEditing && !draft.isDefault && (
          <button
            type="button"
            className="secondary-button builder-themes-btn"
            onClick={handleMakeDefault}
            disabled={isSaving}
            title="Pages with no theme of their own use the default theme"
          >
            Make default
          </button>
        )}
        {isEditing && draft.isDefault && (
          <span className="builder-themes-default-note" title="Pages with no theme of their own use this theme">
            Default theme
          </span>
        )}
        {isEditing && (
          <button
            type="button"
            className="danger-button builder-themes-btn"
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
        <div className="builder-themes-col-stack">
          <div className="builder-themes-col">
            <h3 className="builder-themes-col-heading">Palette</h3>
            <ColorRow
              label="Primary"
              value={draft.primaryColor}
              onChange={(v) => updateDraft({ primaryColor: v })}
            />
            <ColorRow
              label="Secondary"
              value={draft.secondaryColor}
              onChange={(v) => updateDraft({ secondaryColor: v })}
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
          </div>

          <div className="builder-themes-col">
            <h3 className="builder-themes-col-heading">Colour Roles</h3>
            <p className="builder-themes-col-note">
              The banded page system: each surface pairs a background with its text
              colour. Empty = the pre-theme default.
            </p>
            {PALETTE_ROLE_ROWS.map((row) => (
              <div key={row.bg} className="builder-themes-role-pair">
                <ColorRow
                  label={row.label}
                  value={draft.palette?.[row.bg] || ""}
                  onChange={(v) => updatePaletteRole(row.bg, v)}
                />
                <ColorRow
                  label={`${row.label} text`}
                  value={draft.palette?.[row.text] || ""}
                  onChange={(v) => updatePaletteRole(row.text, v)}
                />
              </div>
            ))}
          </div>


          <div className="builder-themes-col">
            <h3 className="builder-themes-col-heading">Styles</h3>
            <BuilderSettingRow label="Page Background">
              <BuilderButtonBackgroundPicker
                background={seedThemeStylesPageBackground(draft.stylesPageBackground, draft)}
                onChange={(stylesPageBackground) => updateDraft({ stylesPageBackground })}
                onChooseImage={() => setIsBackgroundGalleryOpen(true)}
                themeColors={themeColors}
                dialogTitle="Page Background"
              />
            </BuilderSettingRow>
            <SliderRow
              label="Top Margin"
              value={draft.topMargin}
              min={0}
              max={80}
              onChange={(v) => updateDraft({ topMargin: v })}
            />
            <SliderRow
              label="Bottom Margin"
              value={draft.bottomMargin}
              min={0}
              max={80}
              onChange={(v) => updateDraft({ bottomMargin: v })}
            />
            <SliderRow
              label="Side Margins"
              value={draft.sideMargins}
              min={0}
              max={80}
              onChange={(v) => updateDraft({ sideMargins: v })}
            />
            <SliderRow
              label="Content Width"
              value={draft.contentWidth}
              min={0}
              max={1600}
              step={20}
              onChange={(v) => updateDraft({ contentWidth: v })}
            />
            <p className="builder-themes-slider-note">
              0 = off. Any other number centres every row&rsquo;s content to that many
              pixels wide, while row backgrounds still run edge to edge — so the
              contact strip, the header and the hero all start on the same left edge.
            </p>
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
        </div>

        <div className="builder-themes-col">
          <h3 className="builder-themes-col-heading">Typography</h3>
          <BuilderThemeTypographySettings
            theme={toBuilderTheme(draft)}
            onChange={handleTypographyChange}
          />
        </div>

        <div className="builder-themes-col-stack">
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
          <div className="builder-themes-col">
            <h3 className="builder-themes-col-heading">Hero &amp; Treatments</h3>
            <p className="builder-themes-col-note">
              Up to three hero banner options. <strong>Banner 1 is shown at the top of
              every page</strong>, tinted by the overlay below so headlines stay readable;
              the Theme Wizard designs one look around each option.
            </p>
            {[0, 1, 2].map((slot) => (
              <div key={slot} className="builder-themes-asset-group">
                <p className="builder-themes-asset-label">
                  Hero Banner {slot + 1}{slot === 0 ? " — shown on pages" : ""}
                </p>
                <BuilderImagePickerField
                  value={draft.heroBanners?.[slot] || ""}
                  onChange={(url) =>
                    updateDraft({
                      heroBanners: [0, 1, 2].map((i) => (i === slot ? url : draft.heroBanners?.[i] || "")),
                    })}
                  placeholder="Banner image URL"
                />
              </div>
            ))}
            <ColorRow
              label="Photo overlay tint"
              value={draft.treatments?.heroOverlay || ""}
              onChange={(v) => updateDraft({ treatments: { ...(draft.treatments || {}), heroOverlay: v } })}
            />
            <SliderRow
              label="Overlay strength %"
              value={Math.round((draft.treatments?.heroOverlayOpacity ?? 0.45) * 100)}
              min={0}
              max={75}
              onChange={(v) =>
                updateDraft({ treatments: { ...(draft.treatments || {}), heroOverlayOpacity: v / 100 } })}
            />
            <BuilderSettingRow label="Cards overlap photo">
              <input
                type="checkbox"
                checked={draft.treatments?.cardOverlap === true}
                onChange={(e) =>
                  updateDraft({ treatments: { ...(draft.treatments || {}), cardOverlap: e.target.checked } })}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Dark footer band">
              <input
                type="checkbox"
                checked={draft.treatments?.footerInverse === true}
                onChange={(e) =>
                  updateDraft({ treatments: { ...(draft.treatments || {}), footerInverse: e.target.checked } })}
              />
            </BuilderSettingRow>
          </div>
        </div>
      </div>

      {isBackgroundGalleryOpen ? (
        <BuilderGalleryModal
          isUploading={false}
          onSelectImage={(path) => {
            updateDraft({
              stylesPageBackground: {
                ...draft.stylesPageBackground,
                mode: "image",
                imageUrl: normalizeBuilderAssetUrl(path),
              },
            });
            setIsBackgroundGalleryOpen(false);
          }}
          onClose={() => setIsBackgroundGalleryOpen(false)}
        />
      ) : null}
    </div>
  );
}
