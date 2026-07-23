"use client";

import { useEffect, useRef, useState } from "react";
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
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
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
      <label className="field">
        <span>CRM Form</span>
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
      </label>

      <BuilderBackgroundControls
        label="Background"
        background={getModuleBackgroundSettings(s)}
        horizontal
        onChange={onUpdateModuleBackground}
        themeBackgroundColor={themeBackgroundColor}
        themeColors={themeColors}
        themePrimaryColor={themePrimaryColor}
      />

      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Alignment" width="align">
          <BuilderAlignmentIconGroup
            value={moduleAlignment}
            onChange={(alignment) => updateModuleSetting("alignment", alignment)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="H Margin" width="num">
          <BuilderNumberSelectControl
            fallback="0"
            max={160}
            min={0}
            value={s.horizontalMargin ?? "0"}
            onChange={(horizontalMargin) => updateModuleSetting("horizontalMargin", horizontalMargin)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="V Margin" width="num">
          <BuilderNumberSelectControl
            fallback="0"
            max={160}
            min={0}
            value={s.verticalMargin ?? "0"}
            onChange={(verticalMargin) => updateModuleSetting("verticalMargin", verticalMargin)}
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      {crmFormId ? (
        <details className="hanging-details" open>
          <summary>Form Appearance</summary>
          {stylesLoading ? (
            <p className="builder-module-runtime-note">Loading form styles…</p>
          ) : (
            <>
              <BuilderModuleFieldStrip>
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
                    min={0}
                    value={borderRadius}
                    onChange={(value) => updateFormStyle("borderRadius", toPx(value))}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Padding" width="num">
                  <BuilderNumberSelectControl
                    fallback="18"
                    max={80}
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
              </BuilderModuleFieldStrip>

              <BuilderThemeColorSettingRow
                dialogLabel="Form border color"
                fallback="#18324a"
                fullWidth
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
                fullWidth
                label="Form Background"
                themeColors={themeColors}
                value={
                  /^#[0-9a-f]{3,6}$/i.test(formStyles.backgroundColor ?? "")
                    ? formStyles.backgroundColor!
                    : themeBackgroundColor || "#ffffff"
                }
                onChange={(backgroundColor) => updateFormStyle("backgroundColor", backgroundColor)}
              />

              {saveNotice ? (
                <p className={`develop-save-notice${saveNotice.includes("saved") ? " is-success" : ""}`}>
                  {saveNotice}
                </p>
              ) : null}
            </>
          )}
        </details>
      ) : null}
    </div>
  );
}

export function resolveCrmFormStyleSnapshot(
  settings: Record<string, string>
): Record<string, string> | null {
  return readStyleSnapshot(settings);
}
