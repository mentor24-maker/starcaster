/**
 * Keeping a rich-text editor and its stored value honest with each other.
 *
 * Both Builder editors — the block editor (`builder-rich-text-editor`) and the
 * heading's inline one (`builder-inline-rich-text-editor`) — hold a
 * ProseMirror document that has to track a `value` prop owned by the page.
 * Two things must both be true, and they pull in opposite directions:
 *
 *   - the operator's own keystrokes must NOT round-trip back into the document,
 *     because replacing the document moves the caret to the end of it;
 *   - a change that came from ANYWHERE ELSE — undo, a preset, a module the
 *     settings panel just switched to, a value that arrived after mount — MUST
 *     reach the document, or the editor shows something the draft does not say.
 *
 * Task 86bbq2y78 (reported 2026-08-29): a paragraph reading "Wut?" was in the
 * draft row of the Delray home page — verified in the database — and the
 * Builder showed the module with no text at all.
 */

/** The slice of a tiptap editor these helpers need. Structural on purpose. */
type SyncableEditor = {
  getHTML: () => string;
  chain: () => {
    setMeta: (key: string, value: unknown) => {
      setContent: (html: string, options?: Record<string, unknown>) => { run: () => boolean };
    };
  };
};

/**
 * Should the incoming `value` be written into the editor's document?
 *
 * The question is asked of the DOCUMENT, never of a remembered "last emitted"
 * string, and that is the whole fix. The guard this replaces read
 *
 *     if (storageFromEditor === lastEmitted) return;
 *
 * which skips the write exactly when the editor still holds what it last sent
 * out — the state it is in every moment the operator is not mid-keystroke. So
 * an outside change was dropped whenever the editor was idle, which is to say
 * almost always. An editor that mounted while the value was empty then stayed
 * empty no matter what the draft held.
 *
 * Comparing the document to the value instead answers the real question:
 * "is the editor already showing this?" While typing it is (the parent's value
 * IS what the editor just emitted), so the caret is left alone. When something
 * else changed the value it is not, so the document is updated.
 *
 * @param editorStorageHtml the editor's document, normalized the same way the
 *   value is stored — the caller normalizes, because the two editors store
 *   headings and blocks differently.
 * @param value the stored value the editor is supposed to be showing.
 */
export function shouldWriteValueIntoEditor(editorStorageHtml: string, value: string) {
  return editorStorageHtml !== value;
}

/**
 * Replace the document without putting the replacement in the undo stack.
 *
 * `setContent(html, { emitUpdate: false })` suppresses the `onUpdate` callback
 * but still records an undoable transaction, so one Ctrl+Z reverted the
 * programmatic replace AND fired `onUpdate` with the document from BEFORE it.
 * In the heading editor that document was empty, `headingHtmlFromEditor`
 * turned it into `""`, and the empty string was saved over the heading's text.
 * That is how the site-header master's "Blog" heading was emptied on
 * 2026-08-29 while every other module in the same section kept its text — the
 * heading is the only one there whose text is edited through a ProseMirror
 * document rather than a plain `<input>`.
 *
 * A sync is not an edit, so it does not belong in the operator's undo history
 * at all. `setMeta("addToHistory", false)` has to be chained BEFORE
 * `setContent`; passing `addToHistory` inside `setContent`'s options object
 * does nothing (measured against @tiptap/core 3.26 — the undo still reverts
 * it). `scripts`-free proof lives in
 * `components/builder-editor-undo-history.test.ts`.
 */
export function setEditorContentWithoutHistory(editor: SyncableEditor, html: string) {
  editor.chain().setMeta("addToHistory", false).setContent(html, { emitUpdate: false }).run();
}
