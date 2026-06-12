"use client";

import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { Extension } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import { prepareRichTextHtmlForEditor, prepareRichTextHtmlForStorage } from "@/lib/builder-template";
import { readAdminJson } from "@/lib/admin-fetch";
import {
  appendRichTextImageToHtml,
  RICH_TEXT_IMAGE_CLASS,
  resolveRichTextImageSrc
} from "@/lib/rich-text-image";
import { RichTextEmojiPicker } from "@/components/builder/rich-text-emoji-picker";
import {
  RichTextAlignCenterIcon,
  RichTextAlignLeftIcon,
  RichTextAlignRightIcon,
  RichTextBlockquoteIcon,
  RichTextBulletListIcon,
  RichTextClearIcon,
  RichTextCodeIcon,
  RichTextImageIcon,
  RichTextLinkIcon,
  RichTextOrderedListIcon,
  RichTextOutlineIcon,
  RichTextShadowIcon
} from "@/components/builder/rich-text-toolbar-icons";

type BuilderRichTextEditorProps = RichTextGalleryBinding & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  enableEmojiPicker?: boolean;
};

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

const BlockStyle = Extension.create({
  name: "blockStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}
          },
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {}
          },
          color: {
            default: null,
            parseHTML: (element) => element.style.color || null,
            renderHTML: (attributes) =>
              attributes.color ? { style: `color: ${attributes.color}` } : {}
          }
        }
      }
    ];
  }
});

const TextShadowStyle = Extension.create({
  name: "textShadowStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          textShadow: {
            default: null,
            parseHTML: (element) => element.style.textShadow || null,
            renderHTML: (attributes) =>
              attributes.textShadow ? { style: `text-shadow: ${attributes.textShadow}` } : {}
          }
        }
      }
    ];
  }
});

const TextOutlineStyle = Extension.create({
  name: "textOutlineStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          textOutline: {
            default: null,
            parseHTML: (element) =>
              element.style.getPropertyValue("-webkit-text-stroke") ||
              element.style.webkitTextStroke ||
              null,
            renderHTML: (attributes) =>
              attributes.textOutline
                ? { style: `-webkit-text-stroke: ${attributes.textOutline}` }
                : {}
          }
        }
      }
    ];
  }
});

const LineHeightStyle = Extension.create({
  name: "lineHeightStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {}
          }
        }
      }
    ];
  }
});

export function BuilderRichTextEditor({
  value,
  onChange,
  placeholder = "Enter content",
  enableEmojiPicker = false,
  onOpenGallery,
  galleryImagePath,
  onGalleryImageConsumed,
  onUploadGalleryImage
}: BuilderRichTextEditorProps) {
  const fontSizeOptions = [
    "14",
    "16",
    "18",
    "20",
    "24",
    "28",
    "32",
    "36",
    "40",
    "44",
    "48",
    "52",
    "56",
    "60",
    "64"
  ];
  const lineHeightOptions = ["1.2", "1.4", "1.6", "1.8", "2"];
  const [activeFontSize, setActiveFontSize] = useState("16");
  const [activeLineHeight, setActiveLineHeight] = useState("default");
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const lastEmittedStorageRef = useRef(prepareRichTextHtmlForStorage(prepareRichTextHtmlForEditor(value) || ""));
  const skipValueSyncRef = useRef(false);
  const [isCodeView, setIsCodeView] = useState(false);
  const [codeViewValue, setCodeViewValue] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        },
        link: false
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" }
      }),
      TextStyle,
      FontSizeStyle,
      BlockStyle,
      TextShadowStyle,
      TextOutlineStyle,
      LineHeightStyle,
      Color,
      Underline,
      Image.configure({
        inline: false,
        HTMLAttributes: { class: RICH_TEXT_IMAGE_CLASS }
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"]
      })
    ],
    content: prepareRichTextHtmlForEditor(value) || "<p></p>",
    onUpdate: ({ editor: currentEditor }) => {
      const storageHtml = prepareRichTextHtmlForStorage(currentEditor.getHTML());
      lastEmittedStorageRef.current = storageHtml;
      onChange(storageHtml);
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (skipValueSyncRef.current) {
      if (value === lastEmittedStorageRef.current) {
        skipValueSyncRef.current = false;
      }

      return;
    }

    const storageFromEditor = prepareRichTextHtmlForStorage(editor.getHTML());

    if (value === lastEmittedStorageRef.current) {
      return;
    }

    if (storageFromEditor === lastEmittedStorageRef.current) {
      return;
    }

    const normalizedValue = prepareRichTextHtmlForEditor(value) || "<p></p>";

    if (editor.getHTML() !== normalizedValue) {
      editor.commands.setContent(normalizedValue, { emitUpdate: false });
    }

    lastEmittedStorageRef.current = value;
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !galleryImagePath) {
      return;
    }

    const nextText = appendRichTextImageToHtml(
      prepareRichTextHtmlForStorage(editor.getHTML()),
      galleryImagePath
    );

    if (!nextText) {
      onGalleryImageConsumed?.();
      return;
    }

    const normalizedValue = prepareRichTextHtmlForEditor(nextText) || "<p></p>";
    editor.commands.setContent(normalizedValue, { emitUpdate: true });
    lastEmittedStorageRef.current = nextText;
    skipValueSyncRef.current = true;
    onGalleryImageConsumed?.();
  }, [editor, galleryImagePath, onGalleryImageConsumed]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const syncFontSize = () => {
      const blockAttributes = editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph");
      const nextFontSize = String(
        editor.getAttributes("textStyle").fontSize || blockAttributes.fontSize || "16px"
      ).replace("px", "");
      setActiveFontSize(fontSizeOptions.includes(nextFontSize) ? nextFontSize : "16");
      const nextLineHeight = String(editor.getAttributes("textStyle").lineHeight || blockAttributes.lineHeight || "");
      setActiveLineHeight(lineHeightOptions.includes(nextLineHeight) ? nextLineHeight : "default");
      lastSelectionRef.current = {
        from: editor.state.selection.from,
        to: editor.state.selection.to
      };
    };

    syncFontSize();
    editor.on("selectionUpdate", syncFontSize);
    editor.on("transaction", syncFontSize);

    return () => {
      editor.off("selectionUpdate", syncFontSize);
      editor.off("transaction", syncFontSize);
    };
  }, [editor]);

  const hasTextAlign = typeof (editor?.commands as { setTextAlign?: unknown } | undefined)?.setTextAlign === "function";
  const hasTextColor = typeof (editor?.commands as { setColor?: unknown } | undefined)?.setColor === "function";
  const hasTextShadow = String(editor?.getAttributes("textStyle").textShadow || "").length > 0;
  const hasTextOutline = String(editor?.getAttributes("textStyle").textOutline || "").length > 0;

  function chainWithSelection() {
    if (!editor) {
      return null;
    }

    const chain = editor.chain().focus();
    const selection = lastSelectionRef.current;

    if (selection) {
      return chain.setTextSelection(selection);
    }

    return chain;
  }

  function applyFontSize(nextSize: string) {
    const chain = chainWithSelection();

    if (!chain) {
      return;
    }

    setActiveFontSize(nextSize);

    if (nextSize === "16") {
      chain.setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
      return;
    }

    chain.setMark("textStyle", { fontSize: `${nextSize}px` }).run();
  }

  function applyLineHeight(nextValue: string) {
    const chain = chainWithSelection();

    if (!chain) {
      return;
    }

    setActiveLineHeight(nextValue || "default");

    if (!nextValue || nextValue === "default") {
      chain.setMark("textStyle", { lineHeight: null }).removeEmptyTextStyle().run();
      return;
    }

    chain.setMark("textStyle", { lineHeight: nextValue }).run();
  }

  function formatHTML(html: string): string {
    let indent = 0;
    return html
      .replace(/></g, ">\n<")
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (/^<\//.test(trimmed)) indent = Math.max(0, indent - 1);
        const result = "  ".repeat(indent) + trimmed;
        if (/^<[^/!][^>]*[^/]>$/.test(trimmed) && !/^<(br|hr|img|input|link|meta)/.test(trimmed)) indent++;
        return result;
      })
      .join("\n");
  }

  function toggleCodeView() {
    if (!editor) {
      return;
    }

    if (!isCodeView) {
      setCodeViewValue(formatHTML(editor.getHTML()));
      setIsCodeView(true);
    } else {
      editor.commands.setContent(prepareRichTextHtmlForStorage(codeViewValue), { emitUpdate: true });
      setIsCodeView(false);
    }
  }
  
  function toggleTextShadow() {
    if (!editor) {
      return;
    }

    if (hasTextShadow) {
      editor.chain().focus().setMark("textStyle", { textShadow: null }).removeEmptyTextStyle().run();
      return;
    }

    editor
      .chain()
      .focus()
      .setMark("textStyle", { textShadow: "0 2px 10px rgba(9, 16, 24, 0.18)" })
      .run();
  }

  function toggleTextOutline() {
    if (!editor) {
      return;
    }

    if (hasTextOutline) {
      editor.chain().focus().setMark("textStyle", { textOutline: null }).removeEmptyTextStyle().run();
      return;
    }

    editor
      .chain()
      .focus()
      .setMark("textStyle", { textOutline: "1px rgba(9, 16, 24, 0.45)" })
      .run();
  }

  function setLink() {
    if (!editor) {
      return;
    }

    const previousUrl = editor.getAttributes("link").href as string | undefined;
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

  function insertImageSrc(src: string) {
    if (!editor) {
      return;
    }

    const resolved = resolveRichTextImageSrc(src, "editor");

    if (!resolved) {
      return;
    }

    editor.chain().focus().setImage({ src: resolved, alt: "" }).run();
  }

  function insertEmoji(emoji: string) {
    const chain = chainWithSelection();

    if (!chain) {
      return;
    }

    chain.insertContent(emoji).run();
  }

  function getGalleryAnchor(): BuilderModalAnchor | undefined {
    const rect = shellRef.current?.getBoundingClientRect();

    if (!rect) {
      return undefined;
    }

    return {
      x: rect.left + rect.width / 2,
      y: rect.top
    };
  }

  function openImagePicker() {
    if (onOpenGallery) {
      onOpenGallery(getGalleryAnchor());
      return;
    }

    imageInputRef.current?.click();
  }

  async function handleImageFileSelected(file: File | null) {
    if (!file || !editor) {
      return;
    }

    if (onUploadGalleryImage) {
      try {
        setIsUploadingImage(true);
        const path = await onUploadGalleryImage(file);

        if (path) {
          insertImageSrc(path);
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Failed to upload image.");
      } finally {
        setIsUploadingImage(false);
        if (imageInputRef.current) {
          imageInputRef.current.value = "";
        }
      }

      return;
    }

    setIsUploadingImage(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await builderAdminFetch("/api/admin/media", { method: "POST", body: formData });
      const data = await readAdminJson<{ media?: { path?: string }; error?: string }>(
        response,
        "Failed to upload image."
      );

      if (!data.media?.path) {
        throw new Error(data.error ?? "Failed to upload image.");
      }

      insertImageSrc(data.media.path);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to upload image.");
    } finally {
      setIsUploadingImage(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  }

  if (!editor) {
    return (
      <div className="builder-rich-text-shell">
        <div className="builder-rich-text-loading">{placeholder}</div>
      </div>
    );
  }

  return (
    <div className="builder-rich-text-shell" ref={shellRef}>
      <div className="builder-rich-text-toolbar">
        <button
          className={!editor.isActive("heading") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().setParagraph().run()}
          title="Paragraph"
          type="button"
        >
          P
        </button>
        {([1, 2, 3] as const).map((level) => (
          <button
            key={level}
            className={editor.isActive("heading", { level }) ? "is-active" : undefined}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
            title={`Heading ${level}`}
            type="button"
          >
            {`H${level}`}
          </button>
        ))}
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
        {enableEmojiPicker ? (
          <RichTextEmojiPicker disabled={isCodeView} onSelect={insertEmoji} />
        ) : null}
        <button
          className={editor.isActive("image") ? "is-active" : undefined}
          disabled={isUploadingImage}
          onClick={openImagePicker}
          ref={imageButtonRef}
          title="Image"
          type="button"
        >
          <RichTextImageIcon />
        </button>
        <input
          accept="image/*"
          className="builder-rich-text-image-input"
          onChange={(event) => void handleImageFileSelected(event.target.files?.[0] ?? null)}
          ref={imageInputRef}
          type="file"
        />
        <button
          className={hasTextShadow ? "is-active" : undefined}
          onClick={toggleTextShadow}
          title="Drop shadow"
          type="button"
        >
          <RichTextShadowIcon />
        </button>
        <button
          className={hasTextOutline ? "is-active" : undefined}
          onClick={toggleTextOutline}
          title="Outline"
          type="button"
        >
          <RichTextOutlineIcon />
        </button>
        <button
          className={hasTextAlign && editor.isActive({ textAlign: "left" }) ? "is-active" : undefined}
          disabled={!hasTextAlign}
          onClick={() =>
            hasTextAlign
              ? (editor.commands as { setTextAlign: (value: "left" | "center" | "right" | "justify") => boolean }).setTextAlign("left")
              : undefined
          }
          title="Align left"
          type="button"
        >
          <RichTextAlignLeftIcon />
        </button>
        <button
          className={hasTextAlign && editor.isActive({ textAlign: "center" }) ? "is-active" : undefined}
          disabled={!hasTextAlign}
          onClick={() =>
            hasTextAlign
              ? (editor.commands as { setTextAlign: (value: "left" | "center" | "right" | "justify") => boolean }).setTextAlign("center")
              : undefined
          }
          title="Align center"
          type="button"
        >
          <RichTextAlignCenterIcon />
        </button>
        <button
          className={hasTextAlign && editor.isActive({ textAlign: "right" }) ? "is-active" : undefined}
          disabled={!hasTextAlign}
          onClick={() =>
            hasTextAlign
              ? (editor.commands as { setTextAlign: (value: "left" | "center" | "right" | "justify") => boolean }).setTextAlign("right")
              : undefined
          }
          title="Align right"
          type="button"
        >
          <RichTextAlignRightIcon />
        </button>
        <button
          className={isCodeView ? "is-active" : undefined}
          onClick={toggleCodeView}
          title="Code view"
          type="button"
        >
          <RichTextCodeIcon />
        </button>
        <label className="builder-rich-text-color" title="Text color">
          <select
            aria-label="Font size"
            className="builder-rich-text-select"
            onChange={(event) => applyFontSize(event.target.value)}
            value={activeFontSize}
          >
            {fontSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label className="builder-rich-text-color" title="Line height">
          <select
            aria-label="Line height"
            className="builder-rich-text-select"
            onChange={(event) => applyLineHeight(event.target.value)}
            value={activeLineHeight}
          >
            <option value="default">LH</option>
            {lineHeightOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="builder-rich-text-color" title="Text color">
          <span>A</span>
          <input
            aria-label="Text color"
            disabled={!hasTextColor}
            onChange={(event) =>
              hasTextColor
                ? chainWithSelection()?.setColor(event.target.value).run()
                : undefined
            }
            type="color"
            value={String(editor.getAttributes("textStyle").color || "#18324a")}
          />
        </label>
        <button
          className={editor.isActive("bulletList") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
          type="button"
        >
          <RichTextBulletListIcon />
        </button>
        <button
          className={editor.isActive("orderedList") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
          type="button"
        >
          <RichTextOrderedListIcon />
        </button>
        <button
          className={editor.isActive("blockquote") ? "is-active" : undefined}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Block quote"
          type="button"
        >
          <RichTextBlockquoteIcon />
        </button>
        <button
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().setParagraph().run()}
          title="Clear formatting"
          type="button"
        >
          <RichTextClearIcon />
        </button>
      </div>

      {isCodeView ? (
        <textarea
          className="builder-rich-text-code-view"
          value={codeViewValue}
          onChange={(e) => setCodeViewValue(e.target.value)}
        />
      ) : (
        <EditorContent className="builder-rich-text-content" editor={editor} />
      )}
      </div>
  );
}
