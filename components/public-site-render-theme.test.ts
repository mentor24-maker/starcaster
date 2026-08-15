import { describe, expect, it } from "vitest";
import { pickPageRenderTheme } from "./BuilderPublicSitePage";

/**
 * The public site's half of live theme resolution (2026-08-15).
 *
 * `resolveRenderTheme` decides what to do with a live record; this decides
 * WHETHER this page has one. The distinction is the whole risk in the change:
 * the server attaches a `themeShell` to every page, falling back to the
 * project's FIRST theme for pages that name none, so handing it over
 * unconditionally would restyle pages that were never themed.
 */

const STORED = { typography: { scale: { baseSize: 16, ratio: 0, baseLineHeight: 1.8 } } };
const SHELL = {
  typography: { scale: { baseSize: 16, ratio: 0, baseLineHeight: 1.3 } }
} as unknown as Parameters<typeof pickPageRenderTheme>[0]["themeShell"];

const page = (over: Record<string, unknown> = {}) =>
  ({ theme: STORED, ...over }) as Parameters<typeof pickPageRenderTheme>[0];

describe("pickPageRenderTheme", () => {
  it("takes the live theme for a page that names one", () => {
    const theme = pickPageRenderTheme(page({ themeId: "dtheme_1", themeShell: SHELL }));

    expect(theme.typography.scale.baseLineHeight).toBe(1.3);
  });

  it("ignores the shell for a page that names no theme", () => {
    // The server still sends one — the project's first theme — and it must not
    // reach an unthemed page.
    expect(
      pickPageRenderTheme(page({ themeId: "", themeShell: SHELL })).typography.scale.baseLineHeight
    ).toBe(1.8);
    expect(
      pickPageRenderTheme(page({ themeShell: SHELL })).typography.scale.baseLineHeight
    ).toBe(1.8);
  });

  it("treats a whitespace themeId as no theme", () => {
    expect(
      pickPageRenderTheme(page({ themeId: "   ", themeShell: SHELL })).typography.scale.baseLineHeight
    ).toBe(1.8);
  });

  it("keeps the page's own values when the server sent no shell at all", () => {
    expect(
      pickPageRenderTheme(page({ themeId: "dtheme_1", themeShell: null })).typography.scale.baseLineHeight
    ).toBe(1.8);
  });
});
