import { useCallback, useState } from "react";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { readAdminJson } from "@/lib/admin-fetch";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { BuilderGalleryModal } from "./builder-gallery-modal";

type BuilderImagePickerFieldProps = {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  buttonLabel?: string;
  /** When false, gallery modal is select-only (no upload). Defaults to true. */
  allowUpload?: boolean;
};

/**
 * Image input paired with the standard "Choose From Gallery" picker, for use
 * anywhere an image is selected. It owns its own {@link BuilderGalleryModal}
 * (self-contained: loads its own media and portals to a `.builder-react-root`
 * wrapper), so it works at any nesting depth — including deep editors like
 * table-cell modules — without threading gallery state up to the editor root.
 *
 * Uploads go through {@link builderAdminFetch} → project-scoped `/api/assets`
 * (X-Project-ID), matching the gallery list the modal displays.
 *
 * Render inside the caller's own `<label>` / setting-row so the surrounding
 * field label and layout stay consistent with the call site.
 */
export function BuilderImagePickerField({
  value,
  onChange,
  placeholder = "https://...",
  buttonLabel = "Choose From Gallery",
  allowUpload = true
}: BuilderImagePickerFieldProps) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const uploadGalleryImage = useCallback(async (file: File | null) => {
    if (!file || !allowUpload) {
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      window.alert("Please choose an image file.");
      return;
    }

    setIsUploading(true);

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

      onChange(normalizeBuilderAssetUrl(data.media.path));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to upload image.");
    } finally {
      setIsUploading(false);
    }
  }, [allowUpload, onChange]);

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
          isUploading={isUploading}
          onSelectImage={(path) => {
            onChange(normalizeBuilderAssetUrl(path));
            setIsGalleryOpen(false);
          }}
          onClose={() => setIsGalleryOpen(false)}
          onUploadImage={allowUpload ? uploadGalleryImage : undefined}
        />
      ) : null}
    </>
  );
}
