/**
 * Gallery media library hook, backed by GET /api/assets (project-scoped via
 * App.api) with filtering/sorting applied client-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GALLERY_MEDIA_FILTERS,
  type GalleryMediaFilters
} from '../gallery-media-filters';
import type { AdminMediaItem, AdminMediaKind } from '../admin-media-shared';
import { getMediaKind } from '../admin-media-shared';
import { normalizeGalleryMediaAspect } from '../gallery-media-aspect';
import { starcasterApi, unwrapEnvelope } from './starcaster-app';
import { registerGalleryMediaThumbnail } from './gallery-media-thumbnail';

const PAGE_SIZE = 60;

export type GalleryMediaSource = 'project' | 'community';

type StarcasterAsset = {
  id?: number;
  assetName?: string;
  assetType?: string;
  category?: string;
  topic?: string;
  aspect?: string;
  location?: string;
  thumbnailUrl?: string;
  createdAt?: string;
};

function extensionFromLocation(location: string): string {
  const clean = location.split(/[?#]/)[0] ?? '';
  const match = clean.match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function assetKind(asset: StarcasterAsset, extension: string): AdminMediaKind | null {
  const type = String(asset.assetType ?? '').toLowerCase();
  if (type.includes('video')) return 'video';
  if (type.includes('image') || type.includes('photo')) return 'image';
  return getMediaKind(extension);
}

export function assetToAdminMediaItem(asset: StarcasterAsset): AdminMediaItem | null {
  const location = String(asset.location ?? '').trim();
  if (!location) return null;
  const extension = extensionFromLocation(location);
  const kind = assetKind(asset, extension);
  if (!kind) return null;
  if (asset.thumbnailUrl) registerGalleryMediaThumbnail(location, asset.thumbnailUrl);
  return {
    name: String(asset.assetName ?? '').trim() || location.split('/').pop() || location,
    path: location,
    directory: 'gallery',
    kind,
    extension,
    mediaCategory: String(asset.category ?? '').trim() || undefined,
    mediaType: String(asset.assetType ?? '').trim() || undefined,
    topic: String(asset.topic ?? '').trim() || undefined,
    aspect: asset.aspect ? normalizeGalleryMediaAspect(asset.aspect) : undefined,
    createdAt: asset.createdAt || undefined
  };
}

function matchesFilters(item: AdminMediaItem, filters: GalleryMediaFilters, filename: string): boolean {
  const checks: Array<{ negated: boolean; active: boolean; matches: boolean }> = [
    {
      negated: filters.not.filename,
      active: filename.trim().length > 0,
      matches: item.name.toLowerCase().includes(filename.trim().toLowerCase())
    },
    {
      negated: filters.not.extension,
      active: filters.extension.length > 0,
      matches: item.extension === filters.extension
    },
    {
      negated: filters.not.kind,
      active: filters.kind.length > 0,
      matches: item.kind === filters.kind
    },
    {
      negated: filters.not.mediaCategory,
      active: filters.mediaCategory.length > 0,
      matches: (item.mediaCategory ?? '').toLowerCase() === filters.mediaCategory.toLowerCase()
    },
    {
      negated: filters.not.mediaType,
      active: filters.mediaType.length > 0,
      matches: (item.mediaType ?? '').toLowerCase() === filters.mediaType.toLowerCase()
    },
    {
      negated: filters.not.topic,
      active: filters.topic.length > 0,
      matches: (item.topic ?? '').toLowerCase() === filters.topic.toLowerCase()
    },
    {
      negated: filters.not.aspect,
      active: filters.aspect.length > 0,
      matches: (item.aspect ?? '') === filters.aspect
    }
  ];

  return checks.every(({ negated, active, matches }) => {
    if (!active) return true;
    return negated ? !matches : matches;
  });
}

function sortItems(items: AdminMediaItem[], sort: GalleryMediaFilters['sort']): AdminMediaItem[] {
  const sorted = [...items];
  switch (sort) {
    case 'name_desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'newest':
      sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      break;
    case 'oldest':
      sorted.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      break;
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

export function useGalleryMediaLibrary(options?: {
  enabled?: boolean;
  syncOnFirstLoad?: boolean;
  listQueryFilters?: GalleryMediaFilters | null;
  source?: GalleryMediaSource;
}) {
  const enabled = options?.enabled ?? true;
  const source = options?.source ?? 'project';
  const [media, setMedia] = useState<AdminMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GalleryMediaFilters>(DEFAULT_GALLERY_MEDIA_FILTERS);
  const [debouncedFilename, setDebouncedFilename] = useState('');
  const mediaRef = useRef<AdminMediaItem[]>([]);
  const allItemsRef = useRef<AdminMediaItem[] | null>(null);

  mediaRef.current = media;

  const loadMedia = useCallback(
    async (loadOptions?: { sync?: boolean; append?: boolean }) => {
      if (!enabled) return;

      setIsLoading(true);
      setLoadError(null);

      try {
        if (!allItemsRef.current || loadOptions?.sync) {
          const body = await starcasterApi(source === 'community' ? '/api/community-assets' : '/api/assets');
          const assets = unwrapEnvelope<StarcasterAsset[]>(body, 'assets') ?? [];
          allItemsRef.current = assets
            .map(assetToAdminMediaItem)
            .filter((item): item is AdminMediaItem => Boolean(item));
        }

        const querySource = options?.listQueryFilters ?? filters;
        const activeFilename = options?.listQueryFilters ? querySource.filename : debouncedFilename;
        const matching = sortItems(
          allItemsRef.current.filter((item) => matchesFilters(item, { ...querySource, not: querySource.not }, activeFilename)),
          querySource.sort
        );

        const offset = loadOptions?.append ? mediaRef.current.length : 0;
        const page = source === 'community' ? matching : matching.slice(0, offset + PAGE_SIZE);
        setMedia(page);
        setTotal(matching.length);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load media library.');
        if (!loadOptions?.append) {
          setMedia([]);
          setTotal(0);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [debouncedFilename, enabled, filters, options?.listQueryFilters, source]
  );

  useEffect(() => {
    allItemsRef.current = null;
    setMedia([]);
    setTotal(0);
  }, [source]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedFilename(filters.filename);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [filters.filename]);

  useEffect(() => {
    if (!enabled) return;
    void loadMedia();
  }, [enabled, loadMedia]);

  function clearFilters() {
    setFilters(DEFAULT_GALLERY_MEDIA_FILTERS);
    setDebouncedFilename('');
  }

  const rangeStart = total === 0 ? 0 : 1;
  const rangeEnd = media.length;
  const canLoadMore = media.length < total;

  return {
    media,
    total,
    isLoading,
    filters,
    debouncedFilename,
    setFilters,
    loadMedia,
    clearFilters,
    rangeStart,
    rangeEnd,
    canLoadMore,
    loadError
  };
}
