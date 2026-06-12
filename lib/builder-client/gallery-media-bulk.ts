import { readAdminJson } from "@/lib/admin-fetch";
import type { AdminMediaItem } from "@/lib/admin-media-shared";
import { galleryBadgeFlagForMediaType } from "@/lib/gallery-media-badge-type";
import type { GalleryMediaAspect } from "@/lib/gallery-media-aspect";
import { galleryFiltersToQueryParams, type GalleryMediaFilters } from "@/lib/gallery-media-filters";
import {
  buildGalleryMediaSearchParams,
  GALLERY_MEDIA_PAGE_SIZE_MAX
} from "@/lib/gallery-media-query-params";

export type GalleryMediaBulkTargets = {
  mediaCategory: string;
  mediaType: string;
  aspect: "" | GalleryMediaAspect;
};

export const EMPTY_GALLERY_MEDIA_BULK_TARGETS: GalleryMediaBulkTargets = {
  mediaCategory: "",
  mediaType: "",
  aspect: ""
};

export function hasGalleryBulkMetadataTargets(targets: GalleryMediaBulkTargets): boolean {
  return targets.mediaCategory.length > 0 || targets.mediaType.length > 0 || targets.aspect.length > 0;
}

export function buildGalleryBulkMetadataPatch(targets: GalleryMediaBulkTargets): {
  media_category?: string;
  media_type?: string;
  aspect?: GalleryMediaAspect;
  badge?: boolean;
} {
  const patch: {
    media_category?: string;
    media_type?: string;
    aspect?: GalleryMediaAspect;
    badge?: boolean;
  } = {};

  if (targets.mediaCategory) {
    patch.media_category = targets.mediaCategory;
  }

  if (targets.mediaType) {
    patch.media_type = targets.mediaType;
    const badgeFromType = galleryBadgeFlagForMediaType(targets.mediaType);

    if (badgeFromType !== undefined) {
      patch.badge = badgeFromType;
    }
  }

  if (targets.aspect) {
    patch.aspect = targets.aspect;
  }

  return patch;
}

export async function fetchAllGalleryMediaMatching(
  listFilters: GalleryMediaFilters
): Promise<AdminMediaItem[]> {
  const collected: AdminMediaItem[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const query = galleryFiltersToQueryParams(listFilters, {
      offset,
      limit: GALLERY_MEDIA_PAGE_SIZE_MAX
    });
    const search = buildGalleryMediaSearchParams(query);
    const response = await fetch(`/api/admin/media?${search.toString()}`, { cache: "no-store" });
    const data = await readAdminJson<{
      media?: AdminMediaItem[];
      total?: number;
      error?: string;
    }>(response, "Failed to load gallery media for bulk edit.");

    if (!response.ok) {
      throw new Error(data.error ?? "Failed to load gallery media for bulk edit.");
    }

    const page = data.media ?? [];
    total = data.total ?? page.length;
    collected.push(...page);
    offset += page.length;

    if (page.length === 0) {
      break;
    }
  }

  return collected;
}

export async function bulkUpdateGalleryMediaMetadata(
  storageNames: string[],
  patch: {
    media_category?: string;
    media_type?: string;
    aspect?: GalleryMediaAspect;
    badge?: boolean;
  }
): Promise<{ updated: number }> {
  const response = await fetch("/api/admin/media/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storageNames, ...patch })
  });
  const data = await readAdminJson<{ error?: string; updated?: number }>(
    response,
    "Failed to bulk update gallery media."
  );

  if (!response.ok) {
    throw new Error(data.error ?? "Failed to bulk update gallery media.");
  }

  return { updated: data.updated ?? storageNames.length };
}

export async function bulkDeleteGalleryMedia(storageNames: string[]): Promise<{ deleted: number }> {
  const response = await fetch("/api/admin/media/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storageNames })
  });
  const data = await readAdminJson<{ error?: string; deleted?: number; warning?: string }>(
    response,
    "Failed to delete gallery media."
  );

  if (!response.ok) {
    throw new Error(data.error ?? "Failed to delete gallery media.");
  }

  if (data.warning) {
    throw new Error(data.warning);
  }

  return { deleted: data.deleted ?? storageNames.length };
}
