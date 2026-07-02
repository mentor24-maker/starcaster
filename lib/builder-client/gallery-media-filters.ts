import type { GalleryMediaAspect } from "@/lib/gallery-media-aspect";
import type { GalleryMediaKindFilter, GalleryMediaSort } from "@/lib/gallery-media-query-params";
import type { GalleryMediaQueryParams } from "@/lib/gallery-media-query-params";
import { GALLERY_MEDIA_PAGE_SIZE_DEFAULT } from "@/lib/gallery-media-query-params";

export type GalleryMediaFilterNegation = {
  filename: boolean;
  extension: boolean;
  kind: boolean;
  mediaCategory: boolean;
  mediaType: boolean;
  topic: boolean;
  aspect: boolean;
};

export const DEFAULT_GALLERY_MEDIA_FILTER_NEGATION: GalleryMediaFilterNegation = {
  filename: false,
  extension: false,
  kind: false,
  mediaCategory: false,
  mediaType: false,
  topic: false,
  aspect: false
};

export type GalleryMediaFilters = {
  filename: string;
  extension: string;
  kind: GalleryMediaKindFilter;
  mediaCategory: string;
  mediaType: string;
  topic: string;
  aspect: "" | GalleryMediaAspect;
  requirePoll: boolean;
  sort: GalleryMediaSort;
  not: GalleryMediaFilterNegation;
};

export const DEFAULT_GALLERY_MEDIA_FILTERS: GalleryMediaFilters = {
  filename: "",
  extension: "",
  kind: "",
  mediaCategory: "",
  mediaType: "",
  topic: "",
  aspect: "",
  requirePoll: false,
  sort: "name_asc",
  not: DEFAULT_GALLERY_MEDIA_FILTER_NEGATION
};

function filterValueActive(filters: GalleryMediaFilters, key: keyof GalleryMediaFilterNegation): boolean {
  switch (key) {
    case "filename":
      return filters.filename.trim().length > 0;
    case "extension":
      return filters.extension.length > 0;
    case "kind":
      return filters.kind.length > 0;
    case "mediaCategory":
      return filters.mediaCategory.length > 0;
    case "mediaType":
      return filters.mediaType.length > 0;
    case "topic":
      return filters.topic.length > 0;
    case "aspect":
      return filters.aspect.length > 0;
    default:
      return false;
  }
}

export function hasActiveGalleryMediaFilters(filters: GalleryMediaFilters): boolean {
  return (
    filters.filename.trim().length > 0 ||
    filters.extension.length > 0 ||
    filters.kind.length > 0 ||
    filters.mediaCategory.length > 0 ||
    filters.mediaType.length > 0 ||
    filters.topic.length > 0 ||
    filters.aspect.length > 0 ||
    filters.requirePoll ||
    filters.sort !== DEFAULT_GALLERY_MEDIA_FILTERS.sort ||
    (Object.keys(filters.not) as (keyof GalleryMediaFilterNegation)[]).some(
      (key) => filters.not[key] && filterValueActive(filters, key)
    )
  );
}

export function galleryFiltersToQueryParams(
  filters: GalleryMediaFilters,
  options?: { offset?: number; limit?: number; filename?: string }
): GalleryMediaQueryParams {
  return {
    filename: options?.filename ?? filters.filename,
    extension: filters.extension,
    kind: filters.kind,
    mediaCategory: filters.mediaCategory,
    mediaType: filters.mediaType,
    aspect: filters.aspect,
    hasPoll: filters.requirePoll ? "yes" : "",
    sort: filters.sort,
    notFilename: filters.not.filename,
    notExtension: filters.not.extension,
    notKind: filters.not.kind,
    notMediaCategory: filters.not.mediaCategory,
    notMediaType: filters.not.mediaType,
    notAspect: filters.not.aspect,
    badge: "",
    limit: options?.limit ?? GALLERY_MEDIA_PAGE_SIZE_DEFAULT,
    offset: options?.offset ?? 0,
    sync: false,
    indexed: true
  };
}
