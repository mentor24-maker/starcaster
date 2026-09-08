import { describe, expect, it } from "vitest";
import {
  embedIframeSources,
  embedKind,
  embedLooksFocusStealing,
  embedRequiresActivation,
  embedShieldAriaLabel,
  embedShieldLabel,
  normalizeEmbedActivationMode
} from "./builder-code-embed-activation";

const MAP = '<iframe src="https://www.google.com/maps/embed?pb=!1m18" width="600" height="450"></iframe>';
const CHART =
  '<iframe id="dexscreener-embed" src="https://dexscreener.com/solana/abc?embed=1" style="border:0"></iframe>';
const VIDEO = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>';
const CALENDLY = '<iframe src="https://calendly.com/alphire/intro"></iframe>';

describe("embedIframeSources", () => {
  it("reads src and the deferred copy the shield parks it in", () => {
    expect(embedIframeSources(MAP)).toEqual(["https://www.google.com/maps/embed?pb=!1m18"]);
    expect(embedIframeSources('<iframe data-deferred-src="https://dexscreener.com/x"></iframe>')).toEqual([
      "https://dexscreener.com/x"
    ]);
  });

  it("finds every iframe in a multi-embed snippet, and nothing in plain markup", () => {
    expect(embedIframeSources(`${MAP}\n${CHART}`)).toHaveLength(2);
    expect(embedIframeSources("<div><p>Hours: 8am to 8pm</p></div>")).toEqual([]);
    expect(embedIframeSources("")).toEqual([]);
  });
});

describe("normalizeEmbedActivationMode", () => {
  it("reads an absent, blank or unknown value as auto — never as click", () => {
    for (const value of [undefined, null, "", "   ", "yes", 7, {}]) {
      expect(normalizeEmbedActivationMode(value)).toBe("auto");
    }
  });

  it("keeps the three real modes, case and padding tolerant", () => {
    expect(normalizeEmbedActivationMode("auto")).toBe("auto");
    expect(normalizeEmbedActivationMode(" Click ")).toBe("click");
    expect(normalizeEmbedActivationMode("IMMEDIATE")).toBe("immediate");
  });
});

describe("embedRequiresActivation", () => {
  it("auto: a map, a video and a Calendly load on first paint", () => {
    for (const html of [MAP, VIDEO, CALENDLY, "<p>no iframe here</p>", ""]) {
      expect(embedRequiresActivation(html, "auto")).toBe(false);
      expect(embedRequiresActivation(html, undefined)).toBe(false);
    }
  });

  it("auto: a focus-stealing chart widget still waits for a click", () => {
    expect(embedRequiresActivation(CHART, "auto")).toBe(true);
    // A page built before the setting existed stores nothing at all.
    expect(embedRequiresActivation(CHART, undefined)).toBe(true);
    expect(embedLooksFocusStealing(CHART)).toBe(true);
    expect(embedLooksFocusStealing(MAP)).toBe(false);
  });

  it("auto: one chart among other embeds shields the whole snippet", () => {
    expect(embedRequiresActivation(`${MAP}${CHART}`, "auto")).toBe(true);
  });

  it("click and immediate override the detection in both directions", () => {
    expect(embedRequiresActivation(MAP, "click")).toBe(true);
    expect(embedRequiresActivation(CHART, "immediate")).toBe(false);
  });
});

describe("the shield's label", () => {
  it("never calls a map a chart", () => {
    expect(embedKind(MAP)).toBe("map");
    expect(embedShieldLabel(MAP)).toBe("Load map");
    expect(embedShieldAriaLabel(MAP)).toBe("Load interactive map");
  });

  it("names a video and falls back to a generic embed", () => {
    expect(embedShieldLabel(VIDEO)).toBe("Load video");
    expect(embedShieldLabel(CALENDLY)).toBe("Load embed");
    expect(embedShieldAriaLabel(CALENDLY)).toBe("Load this embed");
  });

  it("still says chart for the widget the shield was written for", () => {
    expect(embedKind(CHART)).toBe("chart");
    expect(embedShieldLabel(CHART)).toBe("Load chart");
  });
});
