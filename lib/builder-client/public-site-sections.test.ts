import { describe, expect, it } from "vitest";
import {
  PRIVATE_ONLY_MODULE_TYPES,
  filterPublicSections,
  isPrivateOnlyModuleType,
} from "@/lib/public-site-sections";

const section = (types: string[], extra: Record<string, unknown> = {}) => ({
  id: "s1",
  title: "Row",
  ...extra,
  modules: types.map((type, i) => ({ id: `m${i}`, type })),
});

describe("filterPublicSections — one filter for the preview and the live site", () => {
  it("drops every private-only module and keeps the rest, in order", () => {
    const out = filterPublicSections([
      section(["text", "blog-post-create", "image", "blog-post-manager", "blog-category-manager", "nav"]),
    ]);
    expect(out[0].modules.map((m) => m.type)).toEqual(["text", "image", "nav"]);
  });

  it("keeps the section's other fields and leaves the input untouched", () => {
    const input = [section(["blog-post-create", "text"], { widthMode: "full" })];
    const out = filterPublicSections(input);
    expect(out[0].widthMode).toBe("full");
    expect(out[0].modules).toHaveLength(1);
    expect(input[0].modules).toHaveLength(2);
    expect(out).not.toBe(input);
  });

  it("tolerates a section with no modules array", () => {
    const out = filterPublicSections([{ id: "x" } as { id: string; modules?: { type: string }[] }]);
    expect(out[0].modules).toEqual([]);
  });

  it("names exactly the admin-only surfaces", () => {
    expect([...PRIVATE_ONLY_MODULE_TYPES].sort()).toEqual([
      "blog-category-manager",
      "blog-post-create",
      "blog-post-manager",
      "event-manager",
    ]);
    expect(isPrivateOnlyModuleType("blog-post-create")).toBe(true);
    expect(isPrivateOnlyModuleType("text")).toBe(false);
  });
});
