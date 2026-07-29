/**
 * Column sorting for the gallery List view.
 *
 * Lives here rather than in the modal so the media-library hook can apply the
 * same order to the WHOLE matching set before it pages — sorting only the
 * loaded page would hide, say, the newest uploads behind the page boundary.
 */

import type { AdminMediaItem } from './admin-media-shared';

export type GalleryMediaListSortKey =
  | 'name'
  | 'fileName'
  | 'category'
  | 'type'
  | 'dimensions'
  | 'createdAt';

export type GalleryMediaListSort = { key: GalleryMediaListSortKey; dir: 'asc' | 'desc' };

export function galleryMediaFileName(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  const segment = clean.split('/').pop() ?? clean;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function listSortValue(item: AdminMediaItem, key: GalleryMediaListSortKey): string | number {
  switch (key) {
    case 'fileName':
      return galleryMediaFileName(item.path).toLowerCase();
    case 'category':
      return (item.mediaCategory ?? '').toLowerCase();
    case 'type':
      return (item.mediaType || item.kind).toLowerCase();
    case 'dimensions':
      return (item.imageWidth ?? 0) * (item.imageHeight ?? 0);
    case 'createdAt':
      return item.createdAt ?? '';
    default:
      return item.name.toLowerCase();
  }
}

export function compareGalleryMediaListItems(
  a: AdminMediaItem,
  b: AdminMediaItem,
  sort: GalleryMediaListSort
): number {
  const av = listSortValue(a, sort.key);
  const bv = listSortValue(b, sort.key);
  let result: number;
  if (typeof av === 'number' && typeof bv === 'number') {
    result = av - bv;
  } else {
    result = String(av).localeCompare(String(bv));
  }
  return sort.dir === 'asc' ? result : -result;
}

export function sortGalleryMediaList(
  items: AdminMediaItem[],
  sort: GalleryMediaListSort | null | undefined
): AdminMediaItem[] {
  if (!sort) return items;
  return [...items].sort((a, b) => compareGalleryMediaListItems(a, b, sort));
}
