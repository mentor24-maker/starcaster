"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (m: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

function update(
  onUpdateModule: Props["onUpdateModule"],
  patch: Record<string, string>
) {
  onUpdateModule((m) => ({ ...m, settings: { ...m.settings, ...patch } }));
}

export function BuilderZoomNavModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;
  const sizingMode = s.sizingMode || "linear";

  function set(patch: Record<string, string>) {
    update(onUpdateModule, patch);
  }

  return (
    <div className="builder-zoom-nav-module-settings">

      <BuilderSettingRow label="Color" fullWidth>
        <input type="color" value={s.color || "#0000ff"}
          onChange={(e) => set({ color: e.target.value })} />
      </BuilderSettingRow>

      <BuilderSettingRow label="Center Dot Size" fullWidth>
        <input type="number" min={2} max={100} step={1}
          value={s.dotSize || "10"}
          onChange={(e) => set({ dotSize: e.target.value })} />
        <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted, #888)" }}>px</span>
      </BuilderSettingRow>

      <BuilderSettingRow label="Dot Hover Color" fullWidth>
        <input type="color" value={s.dotHoverColor || "#ffffff"}
          onChange={(e) => set({ dotHoverColor: e.target.value })} />
      </BuilderSettingRow>

      <BuilderSettingRow label="Dot Link" fullWidth>
        <input type="url" placeholder="https://…"
          value={s.dotUrl || ""}
          onChange={(e) => set({ dotUrl: e.target.value })}
          style={{ width: "100%" }} />
      </BuilderSettingRow>

      <BuilderSettingRow label="New Tab" fullWidth>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox"
            checked={s.dotNewTab === "true"}
            onChange={(e) => set({ dotNewTab: e.target.checked ? "true" : "false" })} />
          Open in new tab
        </label>
      </BuilderSettingRow>

      <BuilderSettingRow label="Ring Count" fullWidth>
        <input type="number" min={1} max={30} step={1}
          value={s.ringCount || "10"}
          onChange={(e) => set({ ringCount: e.target.value })} />
      </BuilderSettingRow>

      <BuilderSettingRow label="Sizing Mode" fullWidth>
        <select value={sizingMode} onChange={(e) => set({ sizingMode: e.target.value })}>
          <option value="linear">Linear</option>
          <option value="geometric">Power Curve</option>
        </select>
      </BuilderSettingRow>

      {sizingMode === "linear" ? (
        <BuilderSettingRow label="Ring Step" fullWidth>
          <input type="number" min={2} max={200} step={1}
            value={s.ringStep || "10"}
            onChange={(e) => set({ ringStep: e.target.value })} />
          <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted, #888)" }}>px</span>
        </BuilderSettingRow>
      ) : (
        <>
          <BuilderSettingRow label="Outer Diameter" fullWidth>
            <input type="number" min={50} max={1400} step={10}
              value={s.outerSize || "600"}
              onChange={(e) => set({ outerSize: e.target.value })} />
            <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted, #888)" }}>px</span>
          </BuilderSettingRow>
          <BuilderSettingRow label="Curve (1–5)" fullWidth>
            <input type="range" min={1} max={5} step={0.1}
              value={s.curve || "2"}
              onChange={(e) => set({ curve: e.target.value })} />
            <span style={{ marginLeft: 8, fontSize: 12, minWidth: 28 }}>{parseFloat(s.curve || "2").toFixed(1)}</span>
          </BuilderSettingRow>
        </>
      )}

      <BuilderSettingRow label="Inner Opacity" fullWidth>
        <input type="range" min={0} max={100} step={1}
          value={s.innerOpacity || "90"}
          onChange={(e) => set({ innerOpacity: e.target.value })} />
        <span style={{ marginLeft: 8, fontSize: 12, minWidth: 36 }}>{s.innerOpacity || "90"}%</span>
      </BuilderSettingRow>

      <BuilderSettingRow label="Opacity Step" fullWidth>
        <input type="number" min={0} max={50} step={1}
          value={s.opacityStep || "10"}
          onChange={(e) => set({ opacityStep: e.target.value })} />
        <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted, #888)" }}>% / ring</span>
      </BuilderSettingRow>

      <BuilderSettingRow label="Transition" fullWidth>
        <input type="range" min={0} max={500} step={10}
          value={s.transition || "0"}
          onChange={(e) => set({ transition: e.target.value })} />
        <span style={{ marginLeft: 8, fontSize: 12, minWidth: 36 }}>{s.transition || "0"}ms</span>
      </BuilderSettingRow>

      <BuilderSettingRow label="Position X" fullWidth>
        <input type="number" step={1}
          value={s.posX || "0"}
          onChange={(e) => set({ posX: e.target.value })} />
        <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted, #888)" }}>px from center</span>
      </BuilderSettingRow>

      <BuilderSettingRow label="Position Y" fullWidth>
        <input type="number" step={1}
          value={s.posY || "0"}
          onChange={(e) => set({ posY: e.target.value })} />
        <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted, #888)" }}>px from center</span>
      </BuilderSettingRow>

      <BuilderSettingRow label="Z-Index" fullWidth>
        <input type="number" step={1}
          value={s.zIndex || "-9999"}
          onChange={(e) => set({ zIndex: e.target.value })} />
      </BuilderSettingRow>

    </div>
  );
}
