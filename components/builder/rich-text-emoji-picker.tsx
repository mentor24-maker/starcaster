"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RICH_TEXT_EMOJI_GROUPS } from "@/lib/rich-text-emoji";
import { RichTextEmojiIcon } from "@/components/builder/rich-text-toolbar-icons";

type RichTextEmojiPickerProps = {
  disabled?: boolean;
  onSelect: (emoji: string) => void;
};

export function RichTextEmojiPicker({ disabled = false, onSelect }: RichTextEmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  function handleSelect(emoji: string) {
    onSelect(emoji);
    setIsOpen(false);
  }

  return (
    <div className="builder-rich-text-emoji-picker" ref={rootRef}>
      <button
        aria-controls={isOpen ? panelId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Insert emoji"
        className={isOpen ? "is-active" : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        title="Emoji"
        type="button"
      >
        <RichTextEmojiIcon />
      </button>

      {isOpen ? (
        <div className="builder-rich-text-emoji-panel" id={panelId} role="dialog" aria-label="Emoji picker">
          {RICH_TEXT_EMOJI_GROUPS.map((group) => (
            <div className="builder-rich-text-emoji-group" key={group.id}>
              <p className="builder-rich-text-emoji-group-label">{group.label}</p>
              <div className="builder-rich-text-emoji-grid">
                {group.emojis.map((emoji) => (
                  <button
                    key={`${group.id}-${emoji}`}
                    className="builder-rich-text-emoji-button"
                    onClick={() => handleSelect(emoji)}
                    title={`Insert ${emoji}`}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
