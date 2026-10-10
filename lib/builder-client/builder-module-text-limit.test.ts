import { describe, expect, it } from "vitest";
import {
  BUILDER_MODULE_TEXT_MAX_LENGTH,
  describeModuleTextOverflow,
  normalizeBuilderDocument,
  normalizeBuilderModules
} from "@/lib/builder-template";

// Task 86bcg88kp: a Paragraph module kept only its first 10,000 characters —
// safeText's default — on every read and write, so Dane's manifesto published
// ending mid-sentence at 9,999 characters with nothing warning anyone.

function article(length: number) {
  const paragraph = "<p>I also have a highly fertile imagination, and it does not stop at ten thousand.</p>";
  return paragraph.repeat(Math.ceil(length / paragraph.length)).slice(0, length);
}

describe("module text limit", () => {
  it("is pinned well above the old 10,000 cut", () => {
    // If this number has to drop, the editor warning and
    // lib/builder/migrate-from-legacy.js move with it.
    expect(BUILDER_MODULE_TEXT_MAX_LENGTH).toBe(200000);
  });

  it("keeps all 30,000 characters of a Paragraph module", () => {
    const text = article(30000);
    const [module] = normalizeBuilderModules([{ id: "m1", type: "text", column: "main", text }]);
    expect(module.text.length).toBe(30000);
    expect(module.text).toBe(text);
  });

  it("keeps a long Paragraph through a whole-document normalize (the save path)", () => {
    const text = article(30000);
    const doc = normalizeBuilderDocument({
      sections: [{ id: "s1", layout: "single", modules: [{ id: "m1", type: "text", column: "main", text }] }]
    });
    expect(doc.layoutSections[0].modules[0].text).toBe(text);
  });

  it("still bounds text past the limit", () => {
    const [module] = normalizeBuilderModules([
      { id: "m1", type: "text", column: "main", text: article(BUILDER_MODULE_TEXT_MAX_LENGTH + 500) }
    ]);
    expect(module.text.length).toBe(BUILDER_MODULE_TEXT_MAX_LENGTH);
  });

  it("says nothing while the text fits", () => {
    expect(describeModuleTextOverflow(article(30000))).toBeNull();
    expect(describeModuleTextOverflow(article(BUILDER_MODULE_TEXT_MAX_LENGTH))).toBeNull();
    expect(describeModuleTextOverflow(undefined)).toBeNull();
  });

  it("names the length, the limit and how much would be cut once past it", () => {
    const message = describeModuleTextOverflow(article(BUILDER_MODULE_TEXT_MAX_LENGTH + 1234));
    expect(message).toContain("201,234 characters");
    expect(message).toContain("first 200,000");
    expect(message).toContain("last 1,234 will be cut off");
  });
});
