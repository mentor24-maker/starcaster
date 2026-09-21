// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILDER_PREVIEW_EMBED_PATH,
  BuilderPreviewDeviceMenu,
  BuilderPreviewDeviceModal,
  PREVIEW_DEVICE_FRAMES,
  previewFrameScale
} from "./builder-device-preview";

/**
 * Preview → Phone / Tablet / Desktop (86bc3yyn0). What the browser check
 * (`check:render`, contract `preview-embed-phone-width-gets-phone-rules`)
 * cannot see from builder-preview.html is the editor half: that the menu
 * offers the three screens, and that the pop-up's iframe really is the
 * device's width and loads the embed page. Those are proved here.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

function mount(node: JSX.Element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("nothing to click");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pressEscape(target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("Preview device menu", () => {
  it("offers Phone, Tablet and Desktop, in that order, only after Preview is clicked", () => {
    const onChoose = vi.fn();
    mount(<BuilderPreviewDeviceMenu onChoose={onChoose} />);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    click(document.querySelector("button[aria-haspopup='menu']"));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());
    expect(items).toEqual(["Phone", "Tablet", "Desktop"]);
  });

  it("hands the chosen screen to the editor and closes", () => {
    const onChoose = vi.fn();
    mount(<BuilderPreviewDeviceMenu onChoose={onChoose} />);
    click(document.querySelector("button[aria-haspopup='menu']"));
    const phone = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes("Phone"));
    click(phone);
    expect(onChoose).toHaveBeenCalledWith("phone");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on Escape without choosing", () => {
    const onChoose = vi.fn();
    mount(<BuilderPreviewDeviceMenu onChoose={onChoose} />);
    click(document.querySelector("button[aria-haspopup='menu']"));
    pressEscape();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("Preview device pop-up", () => {
  it("puts the page in an iframe that IS the phone's width, on the embed page", () => {
    mount(<BuilderPreviewDeviceModal device="phone" onClose={() => {}} onOpenInNewTab={() => {}} />);
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("src")).toBe(BUILDER_PREVIEW_EMBED_PATH);
    expect(BUILDER_PREVIEW_EMBED_PATH).toContain("embed=1");
    // The layout width, never the scaled one — scaling is only a picture.
    expect(frame.style.width).toBe(`${PREVIEW_DEVICE_FRAMES.phone.width}px`);
    expect(PREVIEW_DEVICE_FRAMES.phone.width).toBe(390);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Phone preview");
  });

  it("uses the tablet's width for Tablet", () => {
    mount(<BuilderPreviewDeviceModal device="tablet" onClose={() => {}} onOpenInNewTab={() => {}} />);
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.style.width).toBe(`${PREVIEW_DEVICE_FRAMES.tablet.width}px`);
    expect(PREVIEW_DEVICE_FRAMES.tablet.width).toBe(820);
  });

  it("closes with the X, with Escape, and with a backdrop click — but not a click inside", () => {
    const onClose = vi.fn();
    mount(<BuilderPreviewDeviceModal device="phone" onClose={onClose} onOpenInNewTab={() => {}} />);

    click(document.querySelector('[role="dialog"]'));
    expect(onClose).not.toHaveBeenCalled();

    click(document.querySelector('button[aria-label="Close preview"]'));
    expect(onClose).toHaveBeenCalledTimes(1);

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);

    click(document.querySelector(".builder-preview-device-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("offers Open in New Tab", () => {
    const onOpenInNewTab = vi.fn();
    mount(<BuilderPreviewDeviceModal device="tablet" onClose={() => {}} onOpenInNewTab={onOpenInNewTab} />);
    const button = [...document.querySelectorAll("button")].find((el) => el.textContent === "Open in New Tab");
    click(button);
    expect(onOpenInNewTab).toHaveBeenCalledTimes(1);
  });
});

describe("previewFrameScale", () => {
  it("never enlarges a device on a big screen", () => {
    expect(previewFrameScale({ width: 390, height: 844 }, { width: 2000, height: 2000 })).toBe(1);
  });

  it("shrinks to the shorter of the two limits on a small screen", () => {
    expect(previewFrameScale({ width: 820, height: 1180 }, { width: 2000, height: 590 })).toBe(0.5);
    expect(previewFrameScale({ width: 820, height: 1180 }, { width: 410, height: 5000 })).toBe(0.5);
  });

  it("falls back to full size on a nonsense measurement rather than vanishing", () => {
    expect(previewFrameScale({ width: 390, height: 844 }, { width: -10, height: 500 })).toBe(1);
  });
});
