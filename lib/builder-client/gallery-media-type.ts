/** Asset usage labels for gallery files (distinct from image/video file kind). */

export const GALLERY_MEDIA_BADGE_TYPE = "Badge";

export const GALLERY_MEDIA_TYPES = [
  "WYR Poster",
  "Logo",
  "Icon",
  "Banner",
  "Background",
  GALLERY_MEDIA_BADGE_TYPE,
  "Social",
  "Illustration",
  "Photo",
  "Other"
] as const;

export type GalleryMediaType = (typeof GALLERY_MEDIA_TYPES)[number];

export function isGalleryMediaType(value: string): value is GalleryMediaType {
  return (GALLERY_MEDIA_TYPES as readonly string[]).includes(value);
}

export function normalizeGalleryMediaType(value: unknown): string {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized === "Badge Symbol" || normalized.toLowerCase() === "badge symbol") {
    return GALLERY_MEDIA_BADGE_TYPE;
  }

  if (isGalleryMediaType(normalized)) {
    return normalized;
  }

  const match = GALLERY_MEDIA_TYPES.find(
    (option) => option.toLowerCase() === normalized.toLowerCase()
  );

  return match ?? "";
}
