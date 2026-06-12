import { GALLERY_MEDIA_BADGE_TYPE } from "@/lib/gallery-media-type";

export { GALLERY_MEDIA_BADGE_TYPE };

const LEGACY_GALLERY_MEDIA_BADGE_TYPE = "Badge Symbol";

export function isGalleryBadgeMediaType(mediaType: string | undefined): boolean {
  const normalized = mediaType?.trim();

  return normalized === GALLERY_MEDIA_BADGE_TYPE || normalized === LEGACY_GALLERY_MEDIA_BADGE_TYPE;
}

/** When media type is set, derive the badge flag used by reward symbol pickers. */
export function galleryBadgeFlagForMediaType(mediaType: string): boolean | undefined {
  const normalized = mediaType.trim();

  if (!normalized) {
    return undefined;
  }

  return isGalleryBadgeMediaType(normalized);
}

export function isGalleryBadgeMediaItem(item: {
  badge?: boolean;
  mediaType?: string;
}): boolean {
  return Boolean(item.badge) || isGalleryBadgeMediaType(item.mediaType);
}
