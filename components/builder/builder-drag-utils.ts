const builderFormInteractionSelector = [
  "input",
  "textarea",
  "select",
  "option",
  "button",
  "label",
  "a",
  "[contenteditable='true']",
  ".ProseMirror",
  ".builder-rich-text-shell",
  ".builder-rich-text-content",
  ".builder-rich-text-toolbar",
  ".builder-rich-text-code-view",
  ".builder-setting-row",
  ".builder-module-editor",
  ".builder-module-preview-button",
  ".builder-button-background-popup",
  ".builder-contact-form-field"
].join(", ");

export function isBuilderFormInteractionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest(builderFormInteractionSelector));
}

export function cancelBuilderDragIfFormField(event: { target: EventTarget | null; preventDefault: () => void }) {
  if (!isBuilderFormInteractionTarget(event.target)) {
    return false;
  }

  event.preventDefault();
  return true;
}
