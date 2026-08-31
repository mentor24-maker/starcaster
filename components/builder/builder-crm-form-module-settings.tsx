"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import {
  DEFAULT_CRM_FORM_STYLES,
  normalizeCrmFormStyles
} from "../../lib/crmFormStyles.js";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderModuleSpacingFields } from "./builder-spacing-fields";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";
import { getModuleAlignment, getModuleBackgroundSettings } from "./builder-utils";

type CrmFormRecord = {
  id: string;
  name: string;
  accentColor?: string;
  styles?: Record<string, string | undefined>;
};

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  themeColors?: BuilderThemePalette;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

export const CRM_FORM_STYLE_SNAPSHOT_KEY = "crmFormStyleSnapshot";

/**
 * D8 axes, declared the way the schema generator declares them
 * (`--builder-axis-count`). The count drives the flex track CSS in
 * `_builder-react-overrides.css`: each column is sized to its own content
 * and the leftover width goes into the 40px-floor gap between them, first
 * column flush left and last flush right (L8).
 *
 * The count is the number of columns actually rendered. Form Appearance
 * only exists once a form is chosen — there is nothing to style before
 * that — so before then this really is a one-axis panel and says so.
 */
function axisStyle(count: number): CSSProperties {
  return { "--builder-axis-count": String(count) } as CSSProperties;
}

function parsePxNumber(value: string | undefined, fallback: string): string {
  const text = String(value ?? fallback).trim();
  const match = text.match(/^(\d+)/);
  if (match) return match[1];
  const digits = fallback.replace(/\D/g, "");
  return digits || "0";
}

function toPx(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return `${digits || "0"}px`;
}

function readStyleSnapshot(settings: Record<string, string>): Record<string, string> | null {
  const raw = settings[CRM_FORM_STYLE_SNAPSHOT_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStyleSnapshot(
  onUpdateModule: Props["onUpdateModule"],
  styles: Record<string, string>
) {
  const serialized = JSON.stringify(styles);
  onUpdateModule((current) =>
    current.settings[CRM_FORM_STYLE_SNAPSHOT_KEY] === serialized
      ? current
      : {
          ...current,
          settings: {
            ...current.settings,
            [CRM_FORM_STYLE_SNAPSHOT_KEY]: serialized
          }
        }
  );
}

export function BuilderCrmFormModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: Props) {
  const s = module.settings;
  const crmFormId = s.crmFormId ?? "";
  const moduleAlignment = getModuleAlignment(s);

  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [formStyles, setFormStyles] = useState<Record<string, string>>({});
  const [stylesLoading, setStylesLoading] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The parent passes a fresh arrow function on every render, so this callback
  // can never be an effect dependency — the style-snapshot write below would
  // re-trigger the fetch that produced it, looping once per round trip.
  const onUpdateModuleRef = useRef(onUpdateModule);
  useEffect(() => {
    onUpdateModuleRef.current = onUpdateModule;
  });

  useEffect(() => {
    fetch("/api/crm/forms", { credentials: "include", headers: starcasterScopedHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const list = d?.forms ?? d?.data ?? [];
        setForms(Array.isArray(list) ? list : []);
      })
      .catch(() => {})
      .finally(() => setFormsLoading(false));
  }, []);

  useEffect(() => {
    if (!crmFormId) {
      setFormStyles({});
      return;
    }

    setStylesLoading(true);
    fetch(`/api/crm/forms/${encodeURIComponent(crmFormId)}`, {
      credentials: "include",
      headers: starcasterScopedHeaders()
    })
      .then((r) => r.json())
      .then((d) => {
        const form = (d?.form ?? d?.data) as CrmFormRecord | null;
        if (!form || form.id !== crmFormId) {
          setFormStyles({});
          return;
        }
        const normalized = normalizeCrmFormStyles(form.styles, form.accentColor) as Record<string, string>;
        setFormStyles(normalized);
        writeStyleSnapshot(onUpdateModuleRef.current, normalized);
      })
      .catch(() => setFormStyles({}))
      .finally(() => setStylesLoading(false));
  }, [crmFormId]);

  function updateModuleSetting(key: string, value: string) {
    updateModuleSettings({ [key]: value });
  }

  /** Several settings in one update — a matched spacing row writes both sides. */
  function updateModuleSettings(values: Record<string, string>) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, ...values }
    }));
  }

  function queueFormStylesSave(nextStyles: Record<string, string>) {
    if (!crmFormId) return;
    writeStyleSnapshot(onUpdateModule, nextStyles);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/crm/forms/${encodeURIComponent(crmFormId)}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          ...starcasterScopedHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ styles: nextStyles })
      })
        .then((r) => r.json())
        .then(() => setSaveNotice("Form styles saved"))
        .catch(() => setSaveNotice("Could not save form styles"))
        .finally(() => {
          setTimeout(() => setSaveNotice(""), 2400);
        });
    }, 500);
  }

  function updateFormStyle(key: string, value: string) {
    const nextStyles = normalizeCrmFormStyles(
      { ...formStyles, [key]: value },
      formStyles.buttonBackgroundColor
    ) as Record<string, string>;
    setFormStyles(nextStyles);
    queueFormStylesSave(nextStyles);
  }

  const borderSize = parsePxNumber(formStyles.borderSize, DEFAULT_CRM_FORM_STYLES.borderSize);
  const borderRadius = parsePxNumber(formStyles.borderRadius, DEFAULT_CRM_FORM_STYLES.borderRadius);
  const padding = parsePxNumber(formStyles.padding, DEFAULT_CRM_FORM_STYLES.padding);
  const fieldWidth = parsePxNumber(formStyles.fieldWidth, DEFAULT_CRM_FORM_STYLES.fieldWidth);

  return (
    <div className="builder-crm-form-module-settings">
      {/*
        W0 — this panel is hand-written, so it has to build the lattice the
        schema generator builds for a generated one. Before 2026-08-29 it did
        not: its fields sat directly in the editor root, which matches none of
        `check_panels`' three group selectors, so all eleven of them were
        SKIPPED rather than passing. A panel the check cannot see is a panel
        the rule does not cover — the same lesson as the heading offsets and
        the Feature Cards card list.
      */}

      {/*
        ONE strip, and therefore one grid — the same shape `sharedModuleChrome`
        uses in builder-module-card.tsx. Background used to be a SIBLING of the
        strip here, which is the exact arrangement that laid the chrome out as
        two ragged sub-columns: the background block at the left edge and the
        alignment/margin stack floating to its right. `crm-form` renders its own
        chrome on purpose (it is excluded from `needsRestoredChrome` so there is
        never a second copy, E6), so it has to render the right one.
      */}
      <div className="builder-module-chrome">
        <BuilderModuleFieldStrip>
          <BuilderBackgroundControls
            label="Background"
            background={getModuleBackgroundSettings(s)}
            horizontal
            onChange={onUpdateModuleBackground}
            themeBackgroundColor={themeBackgroundColor}
            themeColors={themeColors}
            themePrimaryColor={themePrimaryColor}
          />
          <BuilderModuleField label="Alignment" width="align">
            <BuilderAlignmentIconGroup
              value={moduleAlignment}
              onChange={(alignment) => updateModuleSetting("alignment", alignment)}
            />
          </BuilderModuleField>
          {/* W7 names and side order, E4b pairing — the same component
              marginFields() gives a generated panel. */}
          <BuilderModuleSpacingFields
            box="margin"
            max={160}
            onChange={updateModuleSettings}
            settings={s}
          />
        </BuilderModuleFieldStrip>
      </div>

      {/* D8 axes, the same shape the sibling crm-contacts-table panel gets
          from the schema generator: which form this module shows is Content,
          how that form looks is its own column beside it. The picker used to
          be a bare `label.field` hung off the editor root — a real pair
          shape, but one that is only measured when it sits inside a column. */}
      <div className="builder-schema-panel-columns" style={axisStyle(crmFormId ? 2 : 1)}>
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Content</div>
          <BuilderModuleField label="CRM Form" width="select-md">
            {formsLoading ? (
              <select disabled>
                <option>Loading forms…</option>
              </select>
            ) : forms.length === 0 ? (
              <div className="builder-module-runtime-note" style={{ marginTop: 0 }}>
                <p>No CRM forms found. Create one in <strong>Builder › CRM › Forms</strong>.</p>
              </div>
            ) : (
              <select
                value={crmFormId}
                onChange={(e) => updateModuleSetting("crmFormId", e.target.value)}
              >
                <option value="">— Select a form —</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || f.id}
                  </option>
                ))}
              </select>
            )}
          </BuilderModuleField>
        </div>

        {/* These six write to the CRM FORM RECORD over the API, not to the
            module's settings — the same form styled once, wherever it is
            placed. That is why the column carries the form's name rather
            than a generic "Style", and why it disappears with no form. */}
        {crmFormId ? (
          <div className="builder-schema-panel-column">
            <div className="builder-schema-group-title">Form Appearance</div>
            {stylesLoading ? (
              <p className="builder-module-runtime-note">Loading form styles…</p>
            ) : (
              <>
                <BuilderModuleField label="Border Size" width="num">
                  <BuilderNumberSelectControl
                    fallback="0"
                    max={24}
                    min={0}
                    value={borderSize}
                    onChange={(value) => updateFormStyle("borderSize", toPx(value))}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Border Radius" width="num">
                  <BuilderNumberSelectControl
                    fallback="10"
                    max={80}
                    step={5}
                    min={0}
                    value={borderRadius}
                    onChange={(value) => updateFormStyle("borderRadius", toPx(value))}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Padding" width="num">
                  <BuilderNumberSelectControl
                    fallback="18"
                    max={80}
                    step={5}
                    min={0}
                    value={padding}
                    onChange={(value) => updateFormStyle("padding", toPx(value))}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Field Width" width="num">
                  <BuilderNumberSelectControl
                    fallback="75"
                    max={100}
                    min={25}
                    step={5}
                    value={fieldWidth}
                    onChange={(value) => updateFormStyle("fieldWidth", `${value}%`)}
                  />
                </BuilderModuleField>

                <BuilderThemeColorSettingRow
                  dialogLabel="Form border color"
                  fallback="#18324a"
                  label="Border Color"
                  themeColors={themeColors}
                  value={
                    /^#[0-9a-f]{3,6}$/i.test(formStyles.borderColor ?? "")
                      ? formStyles.borderColor!
                      : themePrimaryColor || "#18324a"
                  }
                  onChange={(borderColor) => updateFormStyle("borderColor", borderColor)}
                />

                <BuilderThemeColorSettingRow
                  dialogLabel="Form background color"
                  fallback="#ffffff"
                  label="Form Background"
                  themeColors={themeColors}
                  value={
                    /^#[0-9a-f]{3,6}$/i.test(formStyles.backgroundColor ?? "")
                      ? formStyles.backgroundColor!
                      : themeBackgroundColor || "#ffffff"
                  }
                  onChange={(backgroundColor) => updateFormStyle("backgroundColor", backgroundColor)}
                />
              </>
            )}
          </div>
        ) : null}
      </div>

      {saveNotice ? (
        <p className={`develop-save-notice${saveNotice.includes("saved") ? " is-success" : ""}`}>
          {saveNotice}
        </p>
      ) : null}
    </div>
  );
}

export function resolveCrmFormStyleSnapshot(
  settings: Record<string, string>
): Record<string, string> | null {
  return readStyleSnapshot(settings);
}
