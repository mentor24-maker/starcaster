"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";
import { CommunityAssetNav } from "@/components/builder/community-asset-nav";
import { GalleryMediaFilterBar } from "@/components/gallery-media-filter-bar";
import { getRichTextGalleryModalStyle, type BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { buildGalleryMediaCategoryOptions } from "@/lib/gallery-media-category";
import { buildGalleryMediaTopicOptions } from "@/lib/gallery-media-topic";
import { getGalleryMediaThumbnailUrl } from "@/lib/gallery-media-thumbnail";
import { useGalleryMediaLibrary, type GalleryMediaSource } from "@/lib/use-gallery-media-library";
import type { AdminMediaItem } from "@/lib/admin-media-shared";

type BuilderGalleryModalProps = {
  anchor?: BuilderModalAnchor | null;
  isUploading: boolean;
  onSelectImage: (imagePath: string) => void;
  onClose: () => void;
  onUploadImage?: (file: File | null) => void | Promise<void>;
};

type GalleryViewMode = "grid" | "list";

type HoverPreview = { item: AdminMediaItem; rect: DOMRect };

const PREVIEW_WIDTH = 320;
const PREVIEW_MARGIN = 12;
const PREVIEW_EST_HEIGHT = 400;

function parseMediaCategory(mediaCategory: string | undefined): [string, string] {
  const parts = (mediaCategory ?? "").split(" / ").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}

function fileNameFromPath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  const segment = clean.split("/").pop() ?? clean;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function formatDimensions(width?: number, height?: number): string {
  if (width && height) {
    return `${width} × ${height}`;
  }
  return "—";
}

function previewPanelStyle(rect: DOMRect): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceRight = viewportWidth - rect.right;
  const left =
    spaceRight >= PREVIEW_WIDTH + PREVIEW_MARGIN
      ? rect.right + PREVIEW_MARGIN
      : Math.max(PREVIEW_MARGIN, rect.left - PREVIEW_WIDTH - PREVIEW_MARGIN);
  const top = Math.min(
    Math.max(PREVIEW_MARGIN, rect.top),
    Math.max(PREVIEW_MARGIN, viewportHeight - PREVIEW_EST_HEIGHT - PREVIEW_MARGIN)
  );
  return { left, top, width: PREVIEW_WIDTH };
}

export function BuilderGalleryModal({
  anchor = null,
  isUploading,
  onSelectImage,
  onClose,
  onUploadImage
}: BuilderGalleryModalProps) {
  const [mounted, setMounted] = useState(false);
  const [mediaSource, setMediaSource] = useState<GalleryMediaSource>("project");
  const [viewMode, setViewMode] = useState<GalleryViewMode>("grid");
  const [communityTopCat, setCommunityTopCat] = useState("");
  const [communitySubCat, setCommunitySubCat] = useState("");
  const [preview, setPreview] = useState<HoverPreview | null>(null);
  const [measuredDimensions, setMeasuredDimensions] = useState<{ width: number; height: number } | null>(null);
  const isAnchored = anchor != null;
  const anchoredModalStyle = isAnchored && mounted ? getRichTextGalleryModalStyle() : undefined;

  const {
    media,
    allMedia,
    total,
    isLoading,
    filters,
    setFilters,
    loadMedia,
    clearFilters,
    rangeEnd,
    canLoadMore
  } = useGalleryMediaLibrary({ source: mediaSource, syncOnFirstLoad: false });

  // Build dropdown options from the FULL asset set, not the currently paged/
  // filtered subset — otherwise categories only present in not-yet-loaded
  // images are missing from the dropdown until you happen to load them.
  const categoryOptions = useMemo(
    () => buildGalleryMediaCategoryOptions(allMedia.map((item) => item.mediaCategory ?? "")),
    [allMedia]
  );

  const topicOptions = useMemo(
    () => buildGalleryMediaTopicOptions(allMedia.map((item) => item.topic ?? "")),
    [allMedia]
  );

  // Reset community nav when switching sources
  useEffect(() => {
    setCommunityTopCat("");
    setCommunitySubCat("");
  }, [mediaSource]);

  // Clear any hover preview when the item under it can no longer be shown.
  useEffect(() => {
    setPreview(null);
  }, [mediaSource, viewMode]);

  // Reset the fallback measurement whenever the previewed item changes.
  const previewPath = preview?.item.path;
  useEffect(() => {
    setMeasuredDimensions(null);
  }, [previewPath]);

  // Filter community media by selected category/subcategory
  const displayMedia = useMemo(() => {
    if (mediaSource !== "community" || !communityTopCat) return media;
    return media.filter((item) => {
      const [top, sub] = parseMediaCategory(item.mediaCategory);
      if (top !== communityTopCat) return false;
      if (communitySubCat && sub !== communitySubCat) return false;
      return true;
    });
  }, [media, mediaSource, communityTopCat, communitySubCat]);

  const displayTotal = mediaSource === "community" ? displayMedia.length : total;
  const displayRangeStart = displayTotal === 0 ? 0 : 1;
  const displayRangeEnd = mediaSource === "community" ? displayMedia.length : rangeEnd;

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleCommunityTopCat(slug: string) {
    setCommunityTopCat(slug);
    setCommunitySubCat("");
  }

  async function handleUpload(file: File | null) {
    if (!file || !onUploadImage) {
      return;
    }

    await onUploadImage(file);
    await loadMedia();
  }

  function showPreview(item: AdminMediaItem, target: HTMLElement) {
    setPreview({ item, rect: target.getBoundingClientRect() });
  }

  function hidePreview() {
    setPreview(null);
  }

  if (!mounted) {
    return null;
  }

  const previewItem = preview?.item ?? null;
  const previewDimensions =
    previewItem?.imageWidth && previewItem?.imageHeight
      ? formatDimensions(previewItem.imageWidth, previewItem.imageHeight)
      : measuredDimensions
        ? formatDimensions(measuredDimensions.width, measuredDimensions.height)
        : "—";

  return (
    <BuilderBodyPortal>
    <div
      className={`builder-gallery-overlay${isAnchored ? " builder-gallery-overlay-anchored" : ""}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`builder-gallery-modal${isAnchored ? " builder-gallery-modal-rich-text is-anchored" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Media gallery"
        style={anchoredModalStyle}
      >
        <div className="builder-gallery-header">
          <div>
            <div className="panel-label">Media Gallery</div>
            <h3>Choose From Gallery</h3>
            <p className="page-copy admin-copy builder-gallery-modal-summary">
              {isLoading && media.length === 0
                ? "Loading media..."
                : displayTotal === 0
                  ? "No files match the current filters."
                  : `Showing ${displayRangeStart}–${displayRangeEnd} of ${displayTotal} file${displayTotal === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="builder-gallery-header-actions">
            <div className="builder-gallery-view-toggle" role="group" aria-label="Gallery layout">
              <button
                aria-pressed={viewMode === "grid"}
                className={viewMode === "grid" ? "is-active" : ""}
                onClick={() => setViewMode("grid")}
                type="button"
              >
                Gallery
              </button>
              <button
                aria-pressed={viewMode === "list"}
                className={viewMode === "list" ? "is-active" : ""}
                onClick={() => setViewMode("list")}
                type="button"
              >
                List
              </button>
            </div>
            <div className="builder-gallery-source-toggle" role="group" aria-label="Media source">
              <button
                aria-pressed={mediaSource === "project"}
                className={mediaSource === "project" ? "is-active" : ""}
                onClick={() => setMediaSource("project")}
                type="button"
              >
                Project Assets
              </button>
              <button
                aria-pressed={mediaSource === "community"}
                className={mediaSource === "community" ? "is-active" : ""}
                onClick={() => setMediaSource("community")}
                type="button"
              >
                Community Assets
              </button>
            </div>
            {onUploadImage && mediaSource === "project" ? (
              <label className="secondary-button builder-gallery-button builder-upload-button">
                <span>{isUploading ? "Uploading..." : "Add to Gallery"}</span>
                <input
                  accept="image/*,video/*"
                  className="builder-upload-input"
                  disabled={isUploading}
                  multiple
                  type="file"
                  onChange={(event) => {
                    const files = event.target.files;

                    if (!files || files.length === 0) {
                      return;
                    }

                    void (async () => {
                      for (const file of Array.from(files)) {
                        await handleUpload(file);
                      }
                      event.currentTarget.value = "";
                    })();
                  }}
                />
              </label>
            ) : null}
            <button className="secondary-button" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
        <div className="builder-gallery-body">
          {mediaSource === "community" ? (
            <CommunityAssetNav
              allMedia={media}
              selectedTop={communityTopCat}
              selectedSub={communitySubCat}
              onSelectTop={handleCommunityTopCat}
              onSelectSub={setCommunitySubCat}
              searchValue={filters.filename}
              onSearchChange={(value) => setFilters((current) => ({ ...current, filename: value }))}
            />
          ) : (
            <GalleryMediaFilterBar
              categoryOptions={categoryOptions}
              topicOptions={topicOptions}
              filters={filters}
              onChange={setFilters}
              onClear={clearFilters}
            />
          )}
          {viewMode === "list" ? (
            <div className="builder-gallery-table-wrap">
              <table className="builder-gallery-table">
                <thead>
                  <tr>
                    <th className="builder-gallery-table-thumb-col" scope="col">
                      Preview
                    </th>
                    <th scope="col">Title</th>
                    <th scope="col">File Name</th>
                    <th scope="col">Category</th>
                    <th scope="col">Type</th>
                    <th scope="col">Dimensions</th>
                    <th className="builder-gallery-table-select-col" scope="col">
                      Select
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayMedia.map((image) => (
                    <tr
                      key={image.path}
                      onMouseEnter={(event) => showPreview(image, event.currentTarget)}
                      onMouseLeave={hidePreview}
                    >
                      <td className="builder-gallery-table-thumb-col">
                        <span className="builder-gallery-table-thumb">
                          {image.kind === "image" ? (
                            <Image
                              alt={image.name}
                              fill
                              sizes="56px"
                              src={getGalleryMediaThumbnailUrl(image.path)}
                            />
                          ) : (
                            <span className="builder-gallery-table-video-tag">Video</span>
                          )}
                        </span>
                      </td>
                      <td>{image.name}</td>
                      <td className="builder-gallery-table-filename">{fileNameFromPath(image.path)}</td>
                      <td>{image.mediaCategory || "—"}</td>
                      <td>{image.mediaType || image.kind}</td>
                      <td>{formatDimensions(image.imageWidth, image.imageHeight)}</td>
                      <td className="builder-gallery-table-select-col">
                        <button
                          className="submit-button builder-gallery-table-select"
                          onClick={() => onSelectImage(image.path)}
                          type="button"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!isLoading && displayMedia.length === 0 ? (
                <div className="builder-gallery-empty">
                  {isUploading ? "Uploading..." : "No media found in the gallery."}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={`builder-gallery-grid${mediaSource === "community" ? " community-asset-grid" : ""}`}>
              {displayMedia.map((image) => (
                <button
                  className="builder-gallery-card"
                  key={image.path}
                  title={mediaSource === "community" ? image.name : undefined}
                  onClick={() => onSelectImage(image.path)}
                  onMouseEnter={(event) => showPreview(image, event.currentTarget)}
                  onMouseLeave={hidePreview}
                  type="button"
                >
                  <div className="builder-gallery-thumb">
                    {image.kind === "image" ? (
                      <Image
                        alt={image.name}
                        fill
                        sizes="180px"
                        src={getGalleryMediaThumbnailUrl(image.path)}
                      />
                    ) : (
                      <video className="builder-gallery-video" controls preload="metadata" src={image.path} />
                    )}
                  </div>
                  <span>{image.name}</span>
                  <small className="gallery-meta">
                    {image.directory} · {image.kind}
                  </small>
                </button>
              ))}
              {!isLoading && displayMedia.length === 0 ? (
                <div className="builder-gallery-empty">
                  {isUploading ? "Uploading..." : "No media found in the gallery."}
                </div>
              ) : null}
            </div>
          )}
          {canLoadMore ? (
            <div className="admin-gallery-load-more">
              <button
                className="secondary-button"
                disabled={isLoading}
                onClick={() => void loadMedia({ append: true })}
                type="button"
              >
                {isLoading ? "Loading..." : "Load More"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {preview && previewItem ? (
        <div className="builder-gallery-hovercard" style={previewPanelStyle(preview.rect)} role="presentation">
          <div className="builder-gallery-hovercard-media">
            {previewItem.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={previewItem.name}
                src={previewItem.path}
                onLoad={(event) => {
                  const el = event.currentTarget;
                  if ((!previewItem.imageWidth || !previewItem.imageHeight) && el.naturalWidth) {
                    setMeasuredDimensions({ width: el.naturalWidth, height: el.naturalHeight });
                  }
                }}
              />
            ) : (
              <video controls preload="metadata" src={previewItem.path} />
            )}
          </div>
          <dl className="builder-gallery-hovercard-meta">
            <div>
              <dt>Title</dt>
              <dd>{previewItem.name}</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd className="builder-gallery-hovercard-filename">{fileNameFromPath(previewItem.path)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{previewDimensions}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
    </BuilderBodyPortal>
  );
}
