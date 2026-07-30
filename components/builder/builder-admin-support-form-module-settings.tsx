"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderAdminSupportFormModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const showTitle = (s.showTitle ?? "true") === "true";
  const showHistory = (s.showHistory ?? "true") === "true";
  const showContact = (s.showContact ?? "true") === "true";

  return (
    <div className="builder-crm-contacts-table-settings">
      <BuilderSettingRow label="Contact details">
        <select value={s.showContact ?? "true"} onChange={(e) => set("showContact", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {showContact && (
        <>
          <BuilderSettingRow label="Contact heading" fullWidth>
            <input
              type="text"
              value={s.contactHeading ?? "Need a hand with your website?"}
              onChange={(e) => set("contactHeading", e.target.value)}
              placeholder="Need a hand with your website?"
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Contact intro" fullWidth>
            <input
              type="text"
              value={s.contactIntro ?? ""}
              onChange={(e) => set("contactIntro", e.target.value)}
              placeholder="Optional line above the email and phone"
            />
          </BuilderSettingRow>
        </>
      )}

      <BuilderSettingRow label="Layout">
        <select value={s.layout ?? "two-column"} onChange={(e) => set("layout", e.target.value)}>
          <option value="two-column">Two columns</option>
          <option value="stacked">One column</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Show title">
        <select value={s.showTitle ?? "true"} onChange={(e) => set("showTitle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {showTitle && (
        <BuilderSettingRow label="Title text" fullWidth>
          <input
            type="text"
            value={s.formTitle ?? "Request Support"}
            onChange={(e) => set("formTitle", e.target.value)}
            placeholder="Request Support"
          />
        </BuilderSettingRow>
      )}

      <BuilderSettingRow label="Default priority">
        <select
          value={s.defaultPriority ?? "normal"}
          onChange={(e) => set("defaultPriority", e.target.value)}
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Screenshot upload">
        <select
          value={s.showScreenshot ?? "true"}
          onChange={(e) => set("showScreenshot", e.target.value)}
        >
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Button text" fullWidth>
        <input
          type="text"
          value={s.buttonText ?? "Send Request"}
          onChange={(e) => set("buttonText", e.target.value)}
          placeholder="Send Request"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Past requests">
        <select value={s.showHistory ?? "true"} onChange={(e) => set("showHistory", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {showHistory && (
        <BuilderSettingRow label="Past requests title" fullWidth>
          <input
            type="text"
            value={s.historyTitle ?? "Your Recent Requests"}
            onChange={(e) => set("historyTitle", e.target.value)}
            placeholder="Your Recent Requests"
          />
        </BuilderSettingRow>
      )}
    </div>
  );
}
