/**
 * Gallery media thumbnail registry. Starcaster assets carry an explicit
 * thumbnailUrl, so the media hook registers path → thumbnail mappings here as it loads.
 */

export const GALLERY_MEDIA_THUMB_SIZE = 180;

const thumbnailByPath = new Map<string, string>();

export function registerGalleryMediaThumbnail(path: string, thumbnailUrl: string): void {
  const key = path.trim();
  const value = thumbnailUrl.trim();
  if (key && value) thumbnailByPath.set(key, value);
}

export function getGalleryMediaThumbnailUrl(path: string, _size = GALLERY_MEDIA_THUMB_SIZE): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  return thumbnailByPath.get(trimmed) ?? trimmed;
}
