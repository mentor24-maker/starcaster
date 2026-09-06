import { describe, expect, it } from "vitest";
import { shouldWriteValueIntoEditor } from "./editor-content-sync";

describe("shouldWriteValueIntoEditor", () => {
  it("leaves the document alone while the operator types", () => {
    // The parent's value IS what the editor just emitted, so the caret must
    // not be disturbed.
    expect(shouldWriteValueIntoEditor("<p>Wut?</p>", "<p>Wut?</p>")).toBe(false);
  });

  it("writes a value that arrives after the editor mounted empty", () => {
    // Task 86bbq2y78: the draft row held "<h1>Wut?</h1>" and the Builder
    // showed the module with no text. An empty document and a non-empty
    // value must always resolve in favour of the value.
    expect(shouldWriteValueIntoEditor("", '<h1 style="text-align: center;"><strong>Wut?</strong></h1>')).toBe(true);
  });

  it("writes an outside change even though the editor holds its last emission", () => {
    // This is the case the replaced guard got wrong: the editor is idle,
    // holding exactly what it last sent out, and something else — undo, a
    // preset, switching module — moved the value.
    expect(shouldWriteValueIntoEditor("<p>typed earlier</p>", "<p>changed elsewhere</p>")).toBe(true);
  });

  it("writes an emptying that really did come from outside", () => {
    expect(shouldWriteValueIntoEditor("<p>Blog</p>", "")).toBe(true);
  });
});
