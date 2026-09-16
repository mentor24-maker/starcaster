"use client";

import {
  BUILDER_DEVICE_LABELS,
  type BuilderEditorStyleDevice
} from "@/lib/builder-device-overrides";

/**
 * Phone / Tablet / Desktop — the three small icons at the right of a Styles
 * bar (Dane's screenshot, 2026-09-15). Desktop is the default; choosing a
 * device swaps the panel under the bar to that device's settings.
 *
 * Shared on purpose: rows use it now, and cells and modules mount this same
 * component in the next slices, so the control is one thing to learn.
 */
const DEVICE_ORDER: BuilderEditorStyleDevice[] = ["phone", "tablet", "desktop"];

function DeviceIcon({ device }: { device: BuilderEditorStyleDevice }) {
  if (device === "phone") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="15">
        <rect x="4" y="1" width="8" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="7" y1="12.5" x2="9" y2="12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (device === "tablet") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="15">
        <rect x="2" y="1" width="12" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="7" y1="12.5" x2="9" y2="12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 16" width="19" height="15">
      <rect x="1" y="1.5" width="18" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7" y1="14.5" x2="13" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BuilderDeviceSwitch({
  value,
  onChange,
  changedDevices = []
}: {
  value: BuilderEditorStyleDevice;
  onChange: (device: BuilderEditorStyleDevice) => void;
  /** Devices that carry settings of their own, so the icon can say so. */
  changedDevices?: BuilderEditorStyleDevice[];
}) {
  return (
    <span className="builder-device-switch" role="group" aria-label="Edit styles for">
      {DEVICE_ORDER.map((device) => {
        const label = BUILDER_DEVICE_LABELS[device];
        const changed = changedDevices.includes(device);
        return (
          <button
            key={device}
            type="button"
            className={`builder-device-switch-button${value === device ? " is-active" : ""}${changed ? " has-overrides" : ""}`}
            aria-pressed={value === device}
            title={
              device === "desktop"
                ? "Desktop styles (every screen, unless a device changes them)"
                : `${label} styles${changed ? " — this row has settings of its own here" : ""}`
            }
            onClick={() => onChange(device)}
          >
            <DeviceIcon device={device} />
            <span className="builder-device-switch-label">{label}</span>
          </button>
        );
      })}
    </span>
  );
}
