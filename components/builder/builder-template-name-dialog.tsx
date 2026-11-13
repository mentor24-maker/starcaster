"use client";

/**
 * Builder › Pages › Save as Template: "What do you want to call it?"
 *
 * Until task SC-803 (2026-11-13) pressing Save as Template named the new
 * template "<page name> Template" without saying so. This asks first, with
 * that name pre-filled and selected so it can simply be typed over.
 *
 * Drawn on the same centred-modal pattern as the other builder dialogs (the
 * `builder-centered-modal` banner and body), but with its own Save and
 * Cancel: `BuilderCenteredModal`'s one "Done" button would have to mean
 * "cancel" here, which is the opposite of what Done reads as.
 *
 * Escape and a click on the dimmed backdrop both cancel — nothing is created
 * until Save is pressed, so a slip costs nothing.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";
import { BLANK_TEMPLATE_NAME_MESSAGE, cleanTemplateName } from "@/lib/builder-template-name";

type BuilderTemplateNameDialogProps = {
  /** Pre-filled name, normally "<page name> Template". */
  initialName: string;
  isSaving: boolean;
  /** Called with the trimmed, non-blank name. */
  onSave: (name: string) => void;
  onCancel: () => void;
};

export function BuilderTemplateNameDialog({ initialName, isSaving, onSave, onCancel }: BuilderTemplateNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    const cleaned = cleanTemplateName(name);
    if (!cleaned) {
      setProblem(BLANK_TEMPLATE_NAME_MESSAGE);
      inputRef.current?.focus();
      return;
    }
    onSave(cleaned);
  }

  return (
    <BuilderBodyPortal>
      <div className="builder-gallery-overlay" onClick={onCancel} role="presentation">
        <div
          aria-labelledby="builder-template-name-dialog-title"
          aria-modal="true"
          className="builder-gallery-modal builder-centered-modal builder-template-name-dialog"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          style={{ width: "min(520px, calc(100vw - 48px))" }}
        >
          <div className="builder-gallery-header builder-centered-modal-banner">
            <div>
              <h3 id="builder-template-name-dialog-title">Save as Template</h3>
            </div>
          </div>
          <form className="builder-gallery-body builder-template-name-dialog-body" onSubmit={handleSubmit}>
            <label className="field">
              <span>Template name</span>
              <input
                ref={inputRef}
                onChange={(event) => {
                  setName(event.target.value);
                  if (problem) setProblem(null);
                }}
                placeholder="Name the new template"
                type="text"
                value={name}
              />
            </label>
            {problem ? (
              <p className="notice error builder-template-name-dialog-problem" role="alert">
                {problem}
              </p>
            ) : null}
            <div className="builder-template-name-dialog-actions">
              <button className="btn" onClick={onCancel} type="button">
                Cancel
              </button>
              <button className="btn btn-save" disabled={isSaving} type="submit">
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </BuilderBodyPortal>
  );
}
