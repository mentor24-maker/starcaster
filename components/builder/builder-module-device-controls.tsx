"use client";

import type { ReactNode } from "react";
import type { BuilderTemplateModule, BuilderStyleDevice } from "@/lib/builder-template";
import { BUILDER_DEVICE_LABELS } from "@/lib/builder-device-overrides";
import {
  BUILDER_MODULE_DEVICE_SETTING_NAMES,
  isModuleHiddenOnDevice,
  listModuleDeviceKeys,
  listModuleDeviceOverrideKeys,
  resetModuleDeviceOverride,
  resolveModuleDeviceValues,
  resolveModuleSettingsForDevice,
  setModuleHiddenOnDevice,
  writeModuleDeviceEdit
} from "@/lib/builder-module-device-overrides";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderModuleSpacingFields } from "./builder-spacing-fields";

/**
 * A module's Tablet or Phone panel — the SAME shape the row editor uses for
 * its own device mode (`builder-section-controls.tsx`), so an operator who
 * has learned one has learned both: a banner naming the screen, a chip per
 * setting this screen changes with a reset beside it, then only the settings
 * a device may hold.
 *
 * Every control here reads the module as this screen sees it and writes
 * through `writeModuleDeviceEdit`, which keeps only what differs — so the
 * controls themselves do not know devices exist, and a value put back to what
 * it inherits stops being an override rather than being pinned.
 *
 * The banner is editor-only by construction: this component is mounted by the
 * module CARD, which never renders on a published page (landmine 16).
 */
export function BuilderModuleDeviceControls({
  module,
  device,
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  device: BuilderStyleDevice;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  const type = String(module.type);
  const keys = listModuleDeviceKeys(type);
  const overrideKeys = listModuleDeviceOverrideKeys(module.settings, device);
  const resolved = resolveModuleSettingsForDevice(module.settings, type, device);
  const values = resolveModuleDeviceValues(module.settings, type, device);
  const label = BUILDER_DEVICE_LABELS[device];
  const parent = device === "phone" ? "Tablet" : "Desktop";
  const plural = device === "phone" ? "phones" : "tablets";

  const writeSettings = (updater: (current: Record<string, string>) => Record<string, string>) =>
    onUpdateModule((current) => ({
      ...current,
      settings: writeModuleDeviceEdit(current.settings, current.type, device, updater)
    }));
  const writeDirect = (updater: (current: Record<string, string>) => Record<string, string>) =>
    onUpdateModule((current) => ({ ...current, settings: updater(current.settings) }));

  /** A dot beside a label whose setting this device changed. */
  const mark = (text: string, key: string): ReactNode =>
    overrideKeys.includes(key) ? (
      <span className="is-device-override" title={`${text} is set just for ${label}`}>
        {text}
      </span>
    ) : (
      text
    );

  return (
    <div className="builder-module-chrome builder-module-device-panel is-device-mode">
      <div className="builder-device-banner" role="status">
        <strong>{label}</strong>
        {overrideKeys.length === 0 ? (
          <span>
            {" "}— every setting follows {device === "phone" ? "Tablet and Desktop" : "Desktop"}. Change one here to
            set it just for {plural}.
          </span>
        ) : (
          <>
            <span>
              {" "}— {overrideKeys.length} setting{overrideKeys.length === 1 ? "" : "s"} set just for {plural}:
            </span>
            {overrideKeys.map((key) => (
              <span className="builder-device-override-chip" key={key}>
                {BUILDER_MODULE_DEVICE_SETTING_NAMES[key] ?? key}
                <button
                  type="button"
                  title={`Put ${BUILDER_MODULE_DEVICE_SETTING_NAMES[key] ?? key} back to following ${parent}`}
                  onClick={() =>
                    writeDirect((current) => resetModuleDeviceOverride(current, device, key))
                  }
                >
                  reset
                </button>
              </span>
            ))}
            <button
              type="button"
              className="builder-device-reset-all"
              onClick={() => writeDirect((current) => resetModuleDeviceOverride(current, device))}
            >
              Reset all
            </button>
          </>
        )}
        <div className="builder-device-banner-note">
          Content, colours and background are the same on every screen.
        </div>
      </div>

      <BuilderModuleFieldStrip>
        <BuilderModuleField label={mark("Alignment", "alignment")} width="align">
          <BuilderAlignmentIconGroup
            value={values.alignment as "left" | "center" | "right"}
            onChange={(alignment) => writeSettings((current) => ({ ...current, alignment }))}
          />
        </BuilderModuleField>
        <BuilderModuleSpacingFields
          box="margin"
          max={160}
          onChange={(next) => writeSettings((current) => ({ ...current, ...next }))}
          settings={resolved}
        />
        <BuilderModuleField label={mark("H Offset", "horizontalOffset")} width="num">
          <input
            type="number"
            min={-500}
            max={500}
            step={1}
            title="Positive moves right; negative moves left."
            value={values.horizontalOffset}
            onChange={(event) =>
              writeSettings((current) => ({ ...current, horizontalOffset: event.target.value }))
            }
          />
        </BuilderModuleField>
        <BuilderModuleField label={mark("V Offset", "verticalOffset")} width="num">
          <input
            type="number"
            min={-500}
            max={500}
            step={1}
            title="Positive moves up; negative moves down."
            value={values.verticalOffset}
            onChange={(event) =>
              writeSettings((current) => ({ ...current, verticalOffset: event.target.value }))
            }
          />
        </BuilderModuleField>
        {keys.includes("size") ? (
          <BuilderModuleField label={mark("Width", "size")} width="select-sm">
            <select
              value={values.size}
              onChange={(event) => writeSettings((current) => ({ ...current, size: event.target.value }))}
            >
              {["25", "33", "50", "66", "75", "90", "100"].map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </select>
          </BuilderModuleField>
        ) : null}
        {keys.includes("fontSize") ? (
          <BuilderModuleField label={mark("Font Size", "fontSize")} width="num">
            {/* The same plain number box the desktop Size field uses, rather
                than a dropdown: a font size is typed, not picked from a list,
                and 10–120 in a select is 111 options (W8). */}
            <input
              type="number"
              min={10}
              max={120}
              step={1}
              value={values.fontSize}
              onChange={(event) => writeSettings((current) => ({ ...current, fontSize: event.target.value }))}
            />
          </BuilderModuleField>
        ) : null}
        <BuilderModuleField label={mark(`Hide on ${label}`, "hidden")} width="check">
          <input
            type="checkbox"
            checked={isModuleHiddenOnDevice(module.settings, type, device)}
            title={`Leaves this module out on ${
              device === "phone" ? "phones" : "tablets and phones"
            }. It still shows on larger screens.`}
            onChange={(event) =>
              writeDirect((current) => setModuleHiddenOnDevice(current, type, device, event.target.checked))
            }
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>
    </div>
  );
}
