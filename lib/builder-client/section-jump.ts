import { useEffect } from "react";

/**
 * Jumping to a named section of a page (task SC-852).
 *
 * A section with an anchor name renders it as its `id`, so an ordinary link to
 * `/about#team` already works in the browser's own way. Two things it does not
 * do on a page drawn in the browser, which every published StarCaster page is:
 *
 * 1. **Arriving with a `#name` in the address.** The browser looks for the
 *    named element once, as the document loads — before the page's sections
 *    exist — finds nothing, and stays at the top. `useJumpToAddressSection`
 *    looks again once they are on screen.
 * 2. **A link to a section of the page you are already on** should glide there
 *    without reloading. `sectionJumpTarget` decides whether a clicked link is
 *    one; the caller then scrolls and records the new address itself.
 */

/** The decoded "#name" of an address, without the "#"; "" when it has none. */
function decodedHash(hash: string): string {
  const raw = hash.replace(/^#/, "");
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** A path compared the way a visitor would: "/" and "" alike, no trailing slash. */
function samePath(a: string, b: string): boolean {
  const clean = (path: string) => (path.replace(/\/+$/, "") || "/");
  return clean(a) === clean(b);
}

/**
 * The section a clicked link points at, when it points at THIS page — the
 * anchor name to scroll to — or "" when the link goes somewhere else, opens a
 * new tab, or names no section. Pure, so it is tested without a browser.
 */
export function sectionJumpTarget(
  href: string,
  current: { href: string; pathname: string; search: string },
  target = ""
): string {
  const text = String(href || "").trim();
  if (!text || !text.includes("#")) return "";
  if (target && target !== "_self") return "";
  let url: URL;
  try {
    url = new URL(text, current.href);
  } catch {
    return "";
  }
  const here = new URL(current.href);
  if (url.origin !== here.origin) return "";
  if (!samePath(url.pathname, current.pathname)) return "";
  if (url.search !== current.search) return "";
  return decodedHash(url.hash);
}

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Handle a click on a link to a section of the page already showing: glide to
 * it and put its `#name` in the address, without reloading. Returns true when
 * it handled the click. A name no element on the page carries is left to the
 * browser, which is exactly what it did before this existed.
 */
export function handleSectionJumpClick(event: {
  target: EventTarget | null;
  defaultPrevented: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault: () => void;
}): boolean {
  if (event.defaultPrevented) return false;
  if ((event.button ?? 0) !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (!(event.target instanceof Element)) return false;
  const anchor = event.target.closest("a[href]");
  if (!anchor) return false;
  const name = sectionJumpTarget(anchor.getAttribute("href") || "", window.location, anchor.getAttribute("target") || "");
  if (!name) return false;
  const element = document.getElementById(name);
  if (!element) return false;
  event.preventDefault();
  element.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  if (window.location.hash !== `#${encodeURIComponent(name)}` && window.location.hash !== `#${name}`) {
    window.history.pushState(window.history.state, "", `#${encodeURIComponent(name)}`);
  }
  return true;
}

/**
 * Once the page's sections are on screen, scroll to the section the address
 * names (`/about#team`). `ready` is whatever changes when the sections do; it
 * runs once per distinct address, so a visitor who has scrolled away is not
 * pulled back by a later re-render.
 */
export function useJumpToAddressSection(enabled: boolean, ready: unknown) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const name = decodedHash(window.location.hash);
    if (!name) return;
    const key = `${window.location.pathname}${window.location.search}#${name}`;
    const marked = window as unknown as { __builderSectionJumped?: string };
    if (marked.__builderSectionJumped === key) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(name);
      if (!element) return;
      marked.__builderSectionJumped = key;
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, ready]);
}
