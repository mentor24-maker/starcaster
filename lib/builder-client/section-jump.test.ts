// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSectionJumpClick, sectionJumpTarget } from "./section-jump";

/**
 * Jumping to a named section of the page already showing (task SC-852).
 * `sectionJumpTarget` is the decision; `handleSectionJumpClick` the act.
 */
const here = { href: "https://baysidepartners.com/", pathname: "/", search: "" };

describe("which clicked links are a jump within this page", () => {
  it("a link to a section of this page names the section", () => {
    expect(sectionJumpTarget("/#about-us", here)).toBe("about-us");
    expect(sectionJumpTarget("#services", here)).toBe("services");
    expect(sectionJumpTarget("https://baysidepartners.com/#contact-us", here)).toBe("contact-us");
  });

  it("a link to another page, another site, a new tab or no section is not one", () => {
    expect(sectionJumpTarget("/about#team", here)).toBe("");
    expect(sectionJumpTarget("https://example.com/#x", here)).toBe("");
    expect(sectionJumpTarget("/#x", here, "_blank")).toBe("");
    expect(sectionJumpTarget("/", here)).toBe("");
    expect(sectionJumpTarget("#", here)).toBe("");
    expect(sectionJumpTarget("/?q=1#x", here)).toBe("");
  });

  it("treats a trailing slash as the same page", () => {
    expect(sectionJumpTarget("/about/#team", { href: "https://a.test/about", pathname: "/about", search: "" })).toBe("team");
  });
});

describe("clicking one", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  function click(link: HTMLAnchorElement, extra: Partial<MouseEvent> = {}) {
    const preventDefault = vi.fn();
    const handled = handleSectionJumpClick({ target: link, defaultPrevented: false, button: 0, preventDefault, ...extra });
    return { handled, preventDefault };
  }

  it("scrolls to the section and puts its name in the address, without loading anything", () => {
    document.body.innerHTML = '<a id="link" href="/#contact-us">Contact</a><section id="contact-us"></section>';
    const section = document.getElementById("contact-us")!;
    const scrolled = vi.fn();
    section.scrollIntoView = scrolled;
    const { handled, preventDefault } = click(document.getElementById("link") as HTMLAnchorElement);
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(window.location.hash).toBe("#contact-us");
  });

  it("leaves a name no section carries to the browser, as before", () => {
    document.body.innerHTML = '<a id="link" href="/#nowhere">X</a>';
    const { handled, preventDefault } = click(document.getElementById("link") as HTMLAnchorElement);
    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("leaves a ctrl/cmd-click (open in a new tab) alone", () => {
    document.body.innerHTML = '<a id="link" href="/#s">X</a><section id="s"></section>';
    expect(click(document.getElementById("link") as HTMLAnchorElement, { metaKey: true }).handled).toBe(false);
  });
});
