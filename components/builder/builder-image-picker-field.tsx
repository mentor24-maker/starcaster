import { useState } from "react";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderGalleryModal } from "./builder-gallery-modal";

type BuilderImagePickerFieldProps = {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  buttonLabel?: string;
};

/**
 * Image input paired with the standard "Choose From Gallery" picker, for use
 * anywhere an image is selected. It owns its own {@link BuilderGalleryModal}
 * (self-contained: loads its own media and portals to a `.builder-react-root`
 * wrapper), so it works at any nesting depth — including deep editors like
 * table-cell modules — without threading gallery state up to the editor root.
 *
 * Render inside the caller's own `<label>` / setting-row so the surrounding
 * field label and layout stay consistent with the call site.
 */
export function BuilderImagePickerField({
  value,
  onChange,
  placeholder = "https://...",
  buttonLabel = "Choose From Gallery"
}: BuilderImagePickerFieldProps) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(normalizeBuilderAssetUrl(event.target.value))}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="secondary-button builder-gallery-button builder-image-picker-field-button"
        onClick={() => setIsGalleryOpen(true)}
      >
        {buttonLabel}
      </button>
      {isGalleryOpen ? (
        <BuilderGalleryModal
          isUploading={false}
          onSelectImage={(path) => {
            onChange(normalizeBuilderAssetUrl(path));
            setIsGalleryOpen(false);
          }}
          onClose={() => setIsGalleryOpen(false)}
        />
      ) : null}
    </>
  );
}
