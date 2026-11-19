// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeBuilderDocument, normalizePageOptions, serializeBuilderDocument } from "@/lib/builder-template";
import { SiteBackToTop, backToTopShouldShow } from "./site-back-to-top";

/**
 * The page-level "Back to top" button (task SC-864). Where it appears on a
 * real scrolled page is measured in a browser by the render contract
 * `back-to-top-appears-after-a-screen-and-returns-to-the-top`; this holds the
 * parts jsdom can: off renders nothing, on renders a real, labelled link, and
 * the show/hide rule.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function draw(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe("SiteBackToTop", () => {
  it("renders nothing at all when the page has it off", () => {
    const el = draw(<SiteBackToTop enabled={false} accentColor="#ff0000" />);
    expect(el.innerHTML).toBe("");
  });

  it("renders a real link to #top that a screen reader announces as Back to top", () => {
    const el = draw(<SiteBackToTop enabled accentColor="#4d8f1f" />);
    const link = el.querySelector("a.site-back-to-top") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("#top");
    expect(link.getAttribute("aria-label")).toBe("Back to top");
    // The theme accent reaches the button.
    expect(link.style.getPropertyValue("--site-back-to-top-bg")).toBe("#4d8f1f");
    // At the top of the page (jsdom scrollY is 0) it is not shown.
    expect(link.classList.contains("is-visible")).toBe(false);
  });

  it("shows once the window has scrolled past one screen, and pressing it scrolls to the top", () => {
    const el = draw(<SiteBackToTop enabled />);
    const link = el.querySelector("a.site-back-to-top") as HTMLAnchorElement;
    Object.defineProperty(window, "scrollY", { configurable: true, value: window.innerHeight + 50 });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(link.classList.contains("is-visible")).toBe(true);

    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    act(() => { link.click(); });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });
});

describe("backToTopShouldShow", () => {
  it("is hidden until the reader is MORE than one screen down", () => {
    expect(backToTopShouldShow(0, 800)).toBe(false);
    expect(backToTopShouldShow(800, 800)).toBe(false);
    expect(backToTopShouldShow(801, 800)).toBe(true);
    expect(backToTopShouldShow(NaN, 800)).toBe(false);
    expect(backToTopShouldShow(900, 0)).toBe(false);
  });
});

describe("pageOptions in the layout document", () => {
  it("keeps only switches that are ON, and nothing when none is", () => {
    expect(normalizePageOptions({ backToTop: true })).toEqual({ backToTop: true });
    expect(normalizePageOptions({ backToTop: false })).toBeNull();
    expect(normalizePageOptions({ backToTop: "true" })).toBeNull();
    expect(normalizePageOptions(null)).toBeNull();
    expect(normalizePageOptions([])).toBeNull();
  });

  it("round-trips through serialize and normalize, and is absent when off", () => {
    const on = serializeBuilderDocument({ layoutSections: [], pageOptions: { backToTop: true } });
    expect(on.pageOptions).toEqual({ backToTop: true });
    expect(normalizeBuilderDocument(on).pageOptions).toEqual({ backToTop: true });

    const off = serializeBuilderDocument({ layoutSections: [] });
    expect("pageOptions" in off).toBe(false);
    expect("pageOptions" in normalizeBuilderDocument(off)).toBe(false);
  });
});
