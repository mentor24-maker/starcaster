import type { GalleryMediaAspect } from "@/lib/gallery-media-aspect";

export type AdminMediaKind = "image" | "video";

export type AdminMediaItem = {
  name: string;
  path: string;
  directory: "images" | "gallery";
  kind: AdminMediaKind;
  extension: string;
  storageName?: string;
  badge?: boolean;
  mediaCategory?: string;
  mediaType?: string;
  topic?: string;
  aspect?: GalleryMediaAspect;
  createdAt?: string;
};

export const GALLERY_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;
export const GALLERY_VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".ogg"] as const;
export const GALLERY_FILTER_EXTENSIONS = [
  ...GALLERY_IMAGE_EXTENSIONS,
  ...GALLERY_VIDEO_EXTENSIONS
] as const;

const imageExtensions = new Set<string>(GALLERY_IMAGE_EXTENSIONS);
const videoExtensions = new Set<string>(GALLERY_VIDEO_EXTENSIONS);

export function getMediaKind(extension: string): AdminMediaKind | null {
  const normalized = extension.toLowerCase();
  if (imageExtensions.has(normalized)) return "image";
  if (videoExtensions.has(normalized)) return "video";
  return null;
}
