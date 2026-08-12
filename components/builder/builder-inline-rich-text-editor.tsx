"use client";

import { Extension } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { headingHtmlFromEditor, prepareHeadingHtmlForEditor } from "@/lib/builder-template";
import {
  RichTextClearIcon,
  RichTextCodeIcon,
  RichTextLinkIcon
} from "@/components/builder/rich-text-toolbar-icons";

type ThemeColorSwatch = { label: string; hex: string };

type BuilderInlineRichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  themeColors?: ThemeColorSwatch[];
  /** Sizes offered per-word. The module's own Size field still sets the whole heading. */
  fontSizeOptions?: string[];
};

/**
 * Per-word font size, stored as an inline `style` on a `<span>` — the same
 * shape the paragraph editor uses, so one heading can hold a 120px word next
 * to a 48px one.
 */
const FontSizeStyle = Extension.create({
  name: "fontSizeStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}
          }
        }
      }
    ];
  }
});

/**
 * Enter means "second line of this heading", not "second paragraph" — a
 * heading is one element and cannot contain two. Without this the editor
 * would build paragraphs the storage step has to flatten back into `<br />`
 * anyway, and the operator would see a gap that never reaches the page.
 */
const EnterIsLineBreak = Extension.create({
  name: "enterIsLineBreak",
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.setHardBreak()
    };
  }
});

/**
 * The heading module's content editor: inline formatting only.
 *
 * The heading used to be a plain text box, which meant a heading was one
 * colour and one size all the way through — there was no way to make a single
 * word green. This is deliberately NOT the paragraph editor: no headings
 * inside the heading, no lists, no images, no block quotes, because none of
 * them can legally sit inside an `<h1>`. What is left is bold / italic /
 * underline, per-word size and colour, links, and the HTML view for anyone
 * who would rather type the markup.
 */
export function BuilderInlineRichTextEditor({
  value,
  onChange,
  placeholder = "Enter heading",
  themeColors,
  fontSizeOptions = ["24", "32", "40", "48", "56", "64", "72", "88", "104", "120", "140", "160"]
}: BuilderInlineRichTextEditorProps) {
  const [activeFontSize, setActiveFontSize] = useState("");
  const [isCodeView, setIsCodeView] = useState(false);
  const [codeViewValue, setCodeViewValue] = useState("");
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const lastEmittedRef = useRef(headingHtmlFromEditor(prepareHeadingHtmlForEditor(value)));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        trailingNode: false
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" }
      }),
      TextStyle,
      FontSizeStyle,
      Color,
      EnterIsLineBreak
    ],
    content: prepareHeadingHtmlForEditor(value),
    onUpdate: ({ editor: currentEditor }) => {
      const next = headingHtmlFromEditor(currentEditor.getHTML());
      lastEmittedRef.current = next;
      onChange(next);
    }
  });

  // Outside edits (undo, switching to another module, a preset that rewrites
  // the text) must reach the editor; the operator's own keystrokes must not
  // round-trip back through it and move the cursor.
  useEffect(() => {
    if (!editor) {
      return;
    }

    if (value === lastEmittedRef.current) {
      return;
    }

    const nextContent = prepareHeadingHtmlForEditor(value);

    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }

    lastEmittedRef.current = value;
  }, [editor, value]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const syncToolbar = () => {
      const nextFontSize = String(editor.getAttributes("textStyle").fontSize || "").replace("px", "");
      setActiveFontSize(fontSizeOptions.includes(nextFontSize) ? nextFontSize : "");
      lastSelectionRef.current = {
        from: editor.state.selection.from,
        to: editor.state.selection.to
      };
    };

    syncToolbar();
    editor.on("selectionUpdate", syncToolbar);
    editor.on("transaction", syncToolbar);

    return () => {
      editor.off("selectionUpdate", syncToolbar);
      editor.off("transaction", syncToolbar);
    };
  }, [editor]);

  function chainWithSelection() {
    if (!editor) {
      return null;
    }

    const chain = editor.chain().focus();
    const selection = lastSelectionRef.current;

    return selection ? chain.setTextSelection(selection) : chain;
  }

  function applyFontSize(nextSize: string) {
    const chain = chainWithSelection();

    if (!chain) {
      return;
    }

    setActiveFontSize(nextSize);

    if (!nextSize) {
      chain.setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
      return;
    }

    chain.setMark("textStyle", { fontSize: `${nextSize}px` }).run();
  }

  function setLink() {
    const previousUrl = editor?.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl || "https://");

    if (url === null) {
      return;
    }

    const chain = chainWithSelection();

    if (!chain) {
      return;
    }

    if (url === "") {
      chain.extendMarkRange("link").unsetLink().run();
      return;
    }

    chain.extendMarkRange("link").setLink({ href: url }).run();
  }

  function toggleCodeView() {
    if (!editor) {
      return;
    }

    if (!isCodeView) {
      setCodeViewValue(headingHtmlFromEditor(editor.getHTML()));
      setIsCodeView(true);
      return;
    }

    editor.commands.setContent(prepareHeadingHtmlForEditor(codeViewValue), { emitUpdate: false });
    setIsCodeView(false);
  }

  if (!editor) {
    return (
      <div className="builder-rich-text-shell builder-inline-rich-text-shell">
        <div className="builder-rich-text-loading">{placeholder}</div>
      </div>
    );
  }

  return (
    <div className="builder-rich-text-shell builder-inline-rich-text-shell">
      <div className="builder-rich-text-toolbar">
        <button
          className={editor.isActive("bold") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
          type="button"
        >
          <strong>B</strong>
        </button>
        <button
          className={editor.isActive("italic") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
          type="button"
        >
          <em>I</em>
        </button>
        <button
          className={editor.isActive("underline") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
          type="button"
        >
          <span className="builder-rich-text-icon-underline">U</span>
        </button>
        <button
          className={editor.isActive("link") ? "is-active" : undefined}
          onClick={setLink}
          title="Link"
          type="button"
        >
          <RichTextLinkIcon />
        </button>
        <label className="builder-rich-text-color" title="Size of the selected words">
          <select
            aria-label="Selected text size"
            className="builder-rich-text-select"
            onChange={(event) => applyFontSize(event.target.value)}
            value={activeFontSize}
          >
            <option value="">Size</option>
            {fontSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label className="builder-rich-text-color" title="Color of the selected words">
          <span>A</span>
          <input
            aria-label="Selected text color"
            onChange={(event) => chainWithSelection()?.setColor(event.target.value).run()}
            type="color"
            value={String(editor.getAttributes("textStyle").color || "#18324a")}
          />
        </label>
        {themeColors?.map(({ label, hex }) => (
          <button
            key={label}
            className="builder-rich-text-theme-swatch"
            onClick={() => chainWithSelection()?.setColor(hex).run()}
            style={{ background: hex }}
            title={label}
            type="button"
          />
        ))}
        <button
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
          title="Clear formatting"
          type="button"
        >
          <RichTextClearIcon />
        </button>
        <button
          className={isCodeView ? "is-active" : undefined}
          onClick={toggleCodeView}
          title="Edit the HTML"
          type="button"
        >
          <RichTextCodeIcon />
        </button>
      </div>

      {isCodeView ? (
        <textarea
          className="builder-rich-text-code-view builder-inline-rich-text-code-view"
          // The textarea keeps exactly what was typed; storage gets the
          // sanitized reading of it (Standard 9). Half-typed markup simply
          // has not arrived yet — it reappears as soon as the tag closes.
          onChange={(event) => {
            const nextValue = event.target.value;
            setCodeViewValue(nextValue);
            const storageHtml = headingHtmlFromEditor(nextValue);
            lastEmittedRef.current = storageHtml;
            onChange(storageHtml);
          }}
          spellCheck={false}
          value={codeViewValue}
        />
      ) : (
        <EditorContent className="builder-rich-text-content builder-inline-rich-text-content" editor={editor} />
      )}
    </div>
  );
}
