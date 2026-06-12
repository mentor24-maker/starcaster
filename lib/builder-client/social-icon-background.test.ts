import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOCIAL_ICON_BACKGROUND,
  normalizeSocialIconBackgroundColor
} from "./social-icon-background";

describe("normalizeSocialIconBackgroundColor", () => {
  it("returns the default for empty values", () => {
    expect(normalizeSocialIconBackgroundColor("")).toBe(DEFAULT_SOCIAL_ICON_BACKGROUND);
    expect(normalizeSocialIconBackgroundColor(undefined)).toBe(DEFAULT_SOCIAL_ICON_BACKGROUND);
  });

  it("converts legacy rgba defaults to hex", () => {
    expect(normalizeSocialIconBackgroundColor("rgba(255, 255, 255, 0.94)")).toBe("#ffffff");
    expect(normalizeSocialIconBackgroundColor("rgba(255,255,255,0.94)")).toBe("#ffffff");
  });

  it("converts rgb and rgba values to hex", () => {
    expect(normalizeSocialIconBackgroundColor("rgb(15, 79, 143)")).toBe("#0f4f8f");
    expect(normalizeSocialIconBackgroundColor("rgba(15, 79, 143, 0.5)")).toBe("#0f4f8f");
  });

  it("normalizes hex values", () => {
    expect(normalizeSocialIconBackgroundColor("#FFF")).toBe("#ffffff");
    expect(normalizeSocialIconBackgroundColor("#0F4F8F")).toBe("#0f4f8f");
  });
});
