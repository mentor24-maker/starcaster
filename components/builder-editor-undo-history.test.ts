// @vitest-environment jsdom
/**
 * A sync is not an edit, so it must not sit in the operator's undo stack.
 *
 * `setContent(html, { emitUpdate: false })` suppresses the onUpdate callback
 * but STILL records an undoable transaction. One Ctrl+Z then reverted the
 * programmatic replace and fired onUpdate carrying the document from before
 * it — empty, in the heading editor — which `headingHtmlFromEditor` turns into
 * "" and the page saves over the heading's text.
 *
 * That is how the Delray site-header master's "Blog" heading was emptied on
 * 2026-08-29 (task 86bbq2y78) while every other module in the same section
 * kept its text: the heading is the only one there whose text is edited
 * through a ProseMirror document rather than a plain <input>.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { setEditorContentWithoutHistory } from "@/lib/editor-content-sync";

function mountEditor(updates: string[]) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ heading: false })],
    content: "<p></p>",
    onUpdate: ({ editor }) => updates.push(editor.getHTML())
  });
}

describe("syncing a value into a tiptap editor", () => {
  it("survives an undo instead of being reverted to the empty document", () => {
    const updates: string[] = [];
    const editor = mountEditor(updates);

    setEditorContentWithoutHistory(editor, "<p>Blog</p>");
    expect(editor.getHTML()).toBe("<p>Blog</p>");
    expect(updates).toEqual([]);

    editor.commands.undo();

    expect(editor.getHTML()).toBe("<p>Blog</p>");
    expect(updates).toEqual([]);

    editor.destroy();
  });

  it("still lets the operator undo their OWN typing", () => {
    const updates: string[] = [];
    const editor = mountEditor(updates);

    setEditorContentWithoutHistory(editor, "<p>Blog</p>");
    editor.commands.insertContent(" and more");
    expect(editor.getHTML()).toContain("and more");

    editor.commands.undo();

    // Their edit is undone; the synced document underneath it is not.
    expect(editor.getHTML()).toBe("<p>Blog</p>");

    editor.destroy();
  });

  it("shows why the option form of addToHistory is not enough", () => {
    // Passing addToHistory inside setContent's options object does nothing —
    // measured against @tiptap/core 3.26. Chaining setMeta first is required,
    // and this test fails if a future edit "simplifies" it back.
    const updates: string[] = [];
    const editor = mountEditor(updates);

    (editor.commands as unknown as {
      setContent: (html: string, options: Record<string, unknown>) => boolean;
    }).setContent("<p>Blog</p>", { emitUpdate: false, addToHistory: false });

    editor.commands.undo();

    expect(editor.getHTML()).toBe("<p></p>");
    expect(updates).toEqual(["<p></p>"]);

    editor.destroy();
  });
});
