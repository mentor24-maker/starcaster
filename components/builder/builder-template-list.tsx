import type { BackgroundSettings, BuilderTemplateKind, BuilderTemplateRecord, BuilderTheme } from "@/lib/builder-template";
import {
  BUILDER_EMAIL_FUNCTIONS,
  BUILDER_EMAIL_MERGE_TOKENS,
  getEmailFunctionLabel,
  type BuilderEmailFunction
} from "@/lib/builder-email-template";
import { useEffect, useRef, useState } from "react";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { formatTemplateTimestamp } from "./builder-utils";

type BuilderTemplateListProps = {
  templates: BuilderTemplateRecord[];
  selectedTemplateId: string;
  draftName: string;
  templateKind: BuilderTemplateKind;
  emailFunction: BuilderEmailFunction | "";
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  previewDevice: "desktop" | "mobile";
  isSaving: boolean;
  onSelectTemplate: (templateId: string) => void;
  onPreviewTemplate: (template: BuilderTemplateRecord) => void;
  onDeleteTemplate: (templateId: string, templateName: string) => void;
  onSetDraftName: (name: string) => void;
  onSetTemplateKind: (kind: BuilderTemplateKind) => void;
  onSetEmailFunction: (value: BuilderEmailFunction | "") => void;
  onUpdatePageBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onUpdateTheme: (updater: (theme: BuilderTheme) => BuilderTheme) => void;
  onSetPreviewDevice: (device: "desktop" | "mobile") => void;
  onPreviewDraft: () => void;
  onNewTemplate: () => void;
  onTemplateEditorFocus: (focused: boolean) => void;
  themeColors?: Array<{ label: string; hex: string }>;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

export function BuilderTemplateList({
  templates,
  selectedTemplateId,
  draftName,
  templateKind,
  emailFunction,
  pageBackground,
  previewDevice,
  isSaving,
  onSelectTemplate,
  onPreviewTemplate,
  onDeleteTemplate,
  onSetDraftName,
  onSetTemplateKind,
  onSetEmailFunction,
  onUpdatePageBackground,
  onSetPreviewDevice,
  onPreviewDraft,
  onNewTemplate,
  onTemplateEditorFocus,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: BuilderTemplateListProps) {
  const isEmailTemplate = templateKind === "email";
  const [collapsedPanels, setCollapsedPanels] = useState({
    templates: true,
    details: true
  });
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusDetailsRef = useRef(false);

  function togglePanel(panel: keyof typeof collapsedPanels) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel]
    }));
  }

  function openDetailsAndFocus() {
    shouldFocusDetailsRef.current = true;
    setCollapsedPanels((current) => ({ ...current, details: false }));
  }

  function handleEditTemplate(templateId: string) {
    onSelectTemplate(templateId);
    onTemplateEditorFocus(true);
    openDetailsAndFocus();
  }

  function handleNewTemplate() {
    onNewTemplate();
    onTemplateEditorFocus(true);
    openDetailsAndFocus();
  }

  function handleTemplateKindChange(kind: BuilderTemplateKind) {
    onSetTemplateKind(kind);

    if (kind === "email" && !emailFunction) {
      onSetEmailFunction("signup_confirmation");
    }
  }

  useEffect(() => {
    onTemplateEditorFocus(!collapsedPanels.details);
  }, [collapsedPanels.details, onTemplateEditorFocus]);

  useEffect(() => {
    if (collapsedPanels.details || !shouldFocusDetailsRef.current) {
      return;
    }

    shouldFocusDetailsRef.current = false;
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [collapsedPanels.details, selectedTemplateId]);

  return (
    <>
      <div className="builder-toolbar-shell">
        <div className="builder-panel-toggle-row">
          <button
            aria-expanded={!collapsedPanels.templates}
            aria-label={collapsedPanels.templates ? "Expand Templates" : "Collapse Templates"}
            className="builder-panel-toggle"
            onClick={() => togglePanel("templates")}
            title={collapsedPanels.templates ? "Expand Templates" : "Collapse Templates"}
            type="button"
          >
            <span className="panel-label">Templates</span>
            <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsedPanels.templates} /></span>
          </button>
          <span className="builder-panel-heading-actions">
            <button
              className="submit-button builder-panel-heading-button"
              onClick={handleNewTemplate}
              type="button"
            >
              New Template
            </button>
          </span>
        </div>
        {!collapsedPanels.templates ? (
          <div className="table-shell builder-templates-shell">
            <table className="polls-table builder-templates-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Format</th>
                  <th>Function</th>
                  <th>Updated</th>
                  <th className="crud-actions-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => {
                  const isSelected = template.id === selectedTemplateId;

                  return (
                    <tr className={isSelected ? "is-selected-row" : undefined} key={template.id}>
                      <td>
                        <strong>{template.name || "Untitled template"}</strong>
                      </td>
                      <td>{template.templateKind === "email" ? "Email" : "Page"}</td>
                      <td>{getEmailFunctionLabel(template.emailFunction)}</td>
                      <td>{formatTemplateTimestamp(template.updatedAt)}</td>
                      <td className="crud-actions-cell">
                        <div className="builder-template-actions">
                          <button
                            className="polls-icon-button polls-icon-button-edit"
                            onClick={() => handleEditTemplate(template.id)}
                            type="button"
                            aria-label={isSelected ? "Editing current template" : "Edit template"}
                            title={isSelected ? "Editing current template" : "Edit template"}
                          >
                            {isSelected ? "●" : "✎"}
                          </button>
                          <button
                            className="polls-icon-button polls-icon-button-view"
                            onClick={() => onPreviewTemplate(template)}
                            type="button"
                            aria-label="Preview template"
                            title="Preview template"
                          >
                            <span aria-hidden="true" className="polls-icon-glyph-eye" />
                          </button>
                          <button
                            className="polls-icon-button polls-icon-button-danger"
                            onClick={() => onDeleteTemplate(template.id, template.name)}
                            type="button"
                            disabled={isSaving}
                            aria-label="Delete template"
                            title="Delete"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {templates.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={5}>No templates found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="builder-toolbar-shell">
        <button
          aria-expanded={!collapsedPanels.details}
          aria-label={collapsedPanels.details ? "Expand Template Details" : "Collapse Template Details"}
          className="builder-panel-toggle"
          onClick={() => togglePanel("details")}
          title={collapsedPanels.details ? "Expand Template Details" : "Collapse Template Details"}
          type="button"
        >
          <span className="panel-label">Template Details</span>
          <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsedPanels.details} /></span>
        </button>
        {!collapsedPanels.details ? (
          <div className="builder-meta-grid builder-meta-grid-templates">
            <label className="field">
              <span>Template name</span>
              <input
                ref={nameInputRef}
                type="text"
                value={draftName}
                onChange={(event) => onSetDraftName(event.target.value)}
                placeholder="Untitled template"
              />
            </label>

            {isEmailTemplate ? (
              <div className="builder-email-merge-tokens-panel">
                <p className="builder-email-merge-tokens-title">Email merge tokens</p>
                <p className="builder-email-merge-tokens-copy">
                  Paste these into button links or rich text. Supabase replaces them when the email sends — you never insert the raw token yourself.
                </p>
                <ul className="builder-email-merge-tokens-list">
                  {BUILDER_EMAIL_MERGE_TOKENS.map((entry) => (
                    <li key={entry.token}>
                      <code>{entry.token}</code>
                      <span>{entry.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="builder-template-format-row">
              <fieldset className="builder-preview-radio-group builder-template-format-group" aria-label="Template format">
                <legend className="builder-template-format-legend">Template format</legend>
                <div className="builder-template-format-options">
                  <label>
                    <input
                      checked={templateKind === "modular"}
                      name="template-format"
                      onChange={() => handleTemplateKindChange("modular")}
                      type="radio"
                    />
                    <span>Page</span>
                  </label>
                  <label>
                    <input
                      checked={templateKind === "email"}
                      name="template-format"
                      onChange={() => handleTemplateKindChange("email")}
                      type="radio"
                    />
                    <span>Email</span>
                  </label>
                </div>
              </fieldset>
            </div>

            {isEmailTemplate ? (
              <label className="field builder-template-function-field">
                <span>Function</span>
                <select
                  value={emailFunction}
                  onChange={(event) => onSetEmailFunction(event.target.value as BuilderEmailFunction | "")}
                >
                  <option disabled value="">
                    Select a function
                  </option>
                  {BUILDER_EMAIL_FUNCTIONS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="builder-meta-actions">
              <div className="builder-template-preview-controls">
                {isEmailTemplate ? (
                  <>
                    <p className="builder-email-preview-note">
                      Email templates render in a fixed 600px pod below. Desktop and Mobile preview modes apply to page templates only.
                    </p>
                    <button className="submit-button" onClick={onPreviewDraft} type="button">
                      Preview Email
                    </button>
                  </>
                ) : (
                  <>
                    <fieldset className="builder-preview-radio-group" aria-label="Preview device">
                      <legend className="builder-template-format-legend">Preview device</legend>
                      <div className="builder-template-format-options">
                        <label>
                          <input
                            checked={previewDevice === "desktop"}
                            name="template-preview-device"
                            onChange={() => onSetPreviewDevice("desktop")}
                            type="radio"
                          />
                          <span>Desktop</span>
                        </label>
                        <label>
                          <input
                            checked={previewDevice === "mobile"}
                            name="template-preview-device"
                            onChange={() => onSetPreviewDevice("mobile")}
                            type="radio"
                          />
                          <span>Mobile</span>
                        </label>
                      </div>
                    </fieldset>
                    <button className="submit-button" onClick={onPreviewDraft} type="button">
                      Preview
                    </button>
                  </>
                )}
              </div>
            </div>

            <BuilderBackgroundControls
              label={isEmailTemplate ? "Email Background" : "Page Background"}
              background={pageBackground}
              compact
              onChange={onUpdatePageBackground}
              themeBackgroundColor={themeBackgroundColor}
              themeColors={themeColors}
              themePrimaryColor={themePrimaryColor}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
