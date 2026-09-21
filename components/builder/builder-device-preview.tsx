"use client";

import { useEffect, useRef, useState } from "react";
import {
  BUILDER_DEVICE_LABELS,
  type BuilderEditorStyleDevice
} from "@/lib/builder-device-overrides";
import { BuilderBodyPortal } from "./builder-body-portal";
import { DeviceIcon } from "./builder-device-switch";

/**
 * Preview → Phone / Tablet / Desktop (task 86bc3yyn0).
 *
 * Page Details' Preview used to open one tab whose screen depended on a
 * Desktop/Mobile switch in the page list that was easy to miss. Now the screen
 * is chosen at the moment of clicking. Desktop still opens a tab; Phone and
 * Tablet open a pop-up over the editor.
 *
 * The pop-up is an IFRAME that really is the device's width, not the preview
 * page's phone/tablet frame. A frame is a narrow box in a wide window, so no
 * media query inside it can match and it only approximates a phone through
 * mirror CSS. An iframe 390px wide IS a 390px viewport and gets the real phone
 * rules — the ones a visitor's phone gets. The Delray headline that split
 * mid-word (86bc3xrhz) only showed at real phone width, which is the whole
 * reason this exists.
 */

export type BuilderPreviewFrameDevice = Exclude<BuilderEditorStyleDevice, "desktop">;

/**
 * The real CSS sizes of the two devices. `scripts/ui/render-contracts.mjs`
 * reads these numbers out of this file, so the check and the pop-up can never
 * measure different phones.
 */
export const PREVIEW_DEVICE_FRAMES: Record<BuilderPreviewFrameDevice, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 }
};

/**
 * The preview page with its own top strip hidden and its device forced to
 * desktop — the iframe's width is the device, so a frame inside it would be a
 * phone inside a phone.
 */
export const BUILDER_PREVIEW_EMBED_PATH = "/builder-preview.html?embed=1";

/** Room the pop-up's header and margins take, so the scaled device fits under it. */
const MODAL_CHROME_HEIGHT = 120;
const MODAL_CHROME_WIDTH = 64;

/**
 * Shrink the device to fit a browser window smaller than it, never enlarge it.
 * The iframe keeps its real width either way — only its picture is scaled —
 * so the phone rules still apply on a short laptop screen.
 */
export function previewFrameScale(
  frame: { width: number; height: number },
  available: { width: number; height: number }
): number {
  const scale = Math.min(1, available.width / frame.width, available.height / frame.height);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

const MENU_ORDER: BuilderEditorStyleDevice[] = ["phone", "tablet", "desktop"];

export function BuilderPreviewDeviceMenu({
  onChoose,
  className = "submit-button builder-panel-heading-button"
}: {
  onChoose: (device: BuilderEditorStyleDevice) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="builder-preview-device-menu-wrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={className}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Preview
      </button>
      {open ? (
        <span className="builder-preview-device-menu" role="menu" aria-label="Preview on">
          {MENU_ORDER.map((device) => (
            <button
              key={device}
              className="builder-preview-device-menu-item"
              onClick={() => {
                setOpen(false);
                onChoose(device);
              }}
              role="menuitem"
              type="button"
            >
              <span className="builder-preview-device-menu-icon"><DeviceIcon device={device} /></span>
              {BUILDER_DEVICE_LABELS[device]}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function measureAvailable() {
  if (typeof window === "undefined") return { width: 1440, height: 900 };
  return {
    width: window.innerWidth - MODAL_CHROME_WIDTH,
    height: window.innerHeight - MODAL_CHROME_HEIGHT
  };
}

export function BuilderPreviewDeviceModal({
  device,
  onClose,
  onOpenInNewTab
}: {
  device: BuilderPreviewFrameDevice;
  onClose: () => void;
  onOpenInNewTab: () => void;
}) {
  const frame = PREVIEW_DEVICE_FRAMES[device];
  const label = BUILDER_DEVICE_LABELS[device];
  const [available, setAvailable] = useState(measureAvailable);
  const scale = previewFrameScale(frame, available);
  // The latest onClose, so the key listener inside the iframe (attached once,
  // on load) never calls a stale one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onResize = () => setAvailable(measureAvailable());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <BuilderBodyPortal>
      <div className="builder-preview-device-backdrop" onClick={onClose} role="presentation">
        <div
          aria-label={`${label} preview`}
          aria-modal="true"
          className="builder-preview-device-modal"
          data-preview-device={device}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="builder-preview-device-modal-header">
            <span className="builder-preview-device-modal-title">
              <DeviceIcon device={device} />
              {label} preview · {frame.width}px
              {scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""}
            </span>
            <span className="builder-preview-device-modal-actions">
              <button className="btn btn-ghost" onClick={onOpenInNewTab} type="button">
                Open in New Tab
              </button>
              <button
                aria-label="Close preview"
                className="btn tiny-btn icon-btn"
                onClick={onClose}
                title="Close preview"
                type="button"
              >
                ×
              </button>
            </span>
          </div>
          <div
            className="builder-preview-device-stage"
            style={{ width: frame.width * scale, height: frame.height * scale }}
          >
            <iframe
              className="builder-preview-device-iframe"
              onLoad={(event) => {
                // Keys typed while the pointer is in the preview go to the
                // iframe's own document, so Escape has to be heard there too.
                // Same site, so this is allowed.
                try {
                  event.currentTarget.contentWindow?.addEventListener("keydown", (keyEvent) => {
                    if (keyEvent.key === "Escape") onCloseRef.current();
                  });
                } catch {
                  // A cross-origin frame cannot be listened to; the X and the
                  // backdrop still close it.
                }
              }}
              src={BUILDER_PREVIEW_EMBED_PATH}
              style={{
                width: frame.width,
                height: frame.height,
                transform: scale < 1 ? `scale(${scale})` : undefined
              }}
              title={`${label} preview`}
            />
          </div>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
