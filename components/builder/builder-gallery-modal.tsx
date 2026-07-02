"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";
import { CommunityAssetNav } from "@/components/builder/community-asset-nav";
import { GalleryMediaFilterBar } from "@/components/gallery-media-filter-bar";
import { getRichTextGalleryModalStyle, type BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { buildGalleryMediaCategoryOptions } from "@/lib/gallery-media-category";
import { buildGalleryMediaTopicOptions } from "@/lib/gallery-media-topic";
import { getGalleryMediaThumbnailUrl } from "@/lib/gallery-media-thumbnail";
import { useGalleryMediaLibrary, type GalleryMediaSource } from "@/lib/use-gallery-media-library";

type BuilderGalleryModalProps = {
  anchor?: BuilderModalAnchor | null;
  isUploading: boolean;
  onSelectImage: (imagePath: string) => void;
  onClose: () => void;
  onUploadImage?: (file: File | null) => void | Promise<void>;
};

function parseMediaCategory(mediaCategory: string | undefined): [string, string] {
  const parts = (mediaCategory ?? "").split(" / ").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
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
  const [communityTopCat, setCommunityTopCat] = useState("");
  const [communitySubCat, setCommunitySubCat] = useState("");
  const isAnchored = anchor != null;
  const anchoredModalStyle = isAnchored && mounted ? getRichTextGalleryModalStyle() : undefined;

  const {
    media,
    total,
    isLoading,
    filters,
    setFilters,
    loadMedia,
    clearFilters,
    rangeStart,
    rangeEnd,
    canLoadMore
  } = useGalleryMediaLibrary({ source: mediaSource, syncOnFirstLoad: false });

  const categoryOptions = useMemo(
    () => buildGalleryMediaCategoryOptions(media.map((item) => item.mediaCategory ?? "")),
    [media]
  );

  const topicOptions = useMemo(
    () => buildGalleryMediaTopicOptions(media.map((item) => item.topic ?? "")),
    [media]
  );

  // Reset community nav when switching sources
  useEffect(() => {
    setCommunityTopCat("");
    setCommunitySubCat("");
  }, [mediaSource]);

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

  if (!mounted) {
    return null;
  }

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
          <div className={`builder-gallery-grid${mediaSource === "community" ? " community-asset-grid" : ""}`}>
            {displayMedia.map((image) => (
              <button
                className="builder-gallery-card"
                key={image.path}
                title={mediaSource === "community" ? image.name : undefined}
                onClick={() => onSelectImage(image.path)}
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
    </div>
    </BuilderBodyPortal>
  );
}
