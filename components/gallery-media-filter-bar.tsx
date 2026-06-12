"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { GalleryPollAssociateMenu } from "@/components/gallery-poll-associate-menu";
import { GALLERY_FILTER_EXTENSIONS } from "@/lib/admin-media-shared";
import {
  GALLERY_MEDIA_ASPECTS,
  galleryMediaAspectLabel,
  type GalleryMediaAspect
} from "@/lib/gallery-media-aspect";
import type { GalleryMediaBulkTargets } from "@/lib/gallery-media-bulk";
import {
  hasActiveGalleryMediaFilters,
  type GalleryMediaFilterNegation,
  type GalleryMediaFilters
} from "@/lib/gallery-media-filters";
import { GALLERY_MEDIA_TYPES } from "@/lib/gallery-media-type";
import {
  GALLERY_MEDIA_SORT_OPTIONS,
  type GalleryMediaKindFilter,
  type GalleryMediaSort
} from "@/lib/gallery-media-query-params";

type GalleryMediaFilterBarProps = {
  filters: GalleryMediaFilters;
  categoryOptions: string[];
  onChange: (updater: (current: GalleryMediaFilters) => GalleryMediaFilters) => void;
  onClear: () => void;
  bulkEditActive?: boolean;
  bulkTargets?: GalleryMediaBulkTargets;
  onBulkTargetsChange?: (updater: (current: GalleryMediaBulkTargets) => GalleryMediaBulkTargets) => void;
  checkAllChecked?: boolean;
  checkAllIndeterminate?: boolean;
  onCheckAllChange?: (checked: boolean) => void;
  checkAllDisabled?: boolean;
  selectedCount?: number;
  onBulkEdit?: () => void;
  onBulkDelete?: () => void;
  onBulkAssociateToggle?: () => void;
  onBulkAssociated?: (message: string) => void;
  onBulkAssociateError?: (message: string) => void;
  bulkAssociateOpen?: boolean;
  bulkAssociateDisabled?: boolean;
  bulkAssociateWrapRef?: RefObject<HTMLDivElement>;
  selectedStorageNamesInOrder?: string[];
  bulkEditDisabled?: boolean;
  bulkDeleteDisabled?: boolean;
  isBulkEditing?: boolean;
  isBulkDeleting?: boolean;
  showFiltersHeading?: boolean;
};

type FilterNotKey = keyof GalleryMediaFilterNegation;

function GalleryFilterLabelRow({
  label,
  notKey,
  filters,
  bulkEditActive,
  showNot,
  onChange
}: {
  label: string;
  notKey?: FilterNotKey;
  filters: GalleryMediaFilters;
  bulkEditActive: boolean;
  showNot: boolean;
  onChange: (updater: (current: GalleryMediaFilters) => GalleryMediaFilters) => void;
}) {
  const notActive = notKey ? filters.not[notKey] : false;
  const notDisabled = bulkEditActive;

  return (
    <span className="admin-gallery-filter-label-row">
      <span className="admin-gallery-filter-label">{label}</span>
      {showNot && notKey ? (
        <label className="admin-gallery-filter-not">
          <span>NOT:</span>
          <input
            aria-label={`Exclude ${label} filter matches`}
            checked={notActive}
            disabled={notDisabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                not: { ...current.not, [notKey]: event.target.checked }
              }))
            }
            type="checkbox"
          />
        </label>
      ) : null}
    </span>
  );
}

function GalleryFilterField({
  label,
  notKey,
  filters,
  bulkEditActive,
  showNot,
  onChange,
  className = "",
  children
}: {
  label: string;
  notKey?: FilterNotKey;
  filters: GalleryMediaFilters;
  bulkEditActive: boolean;
  showNot: boolean;
  onChange: (updater: (current: GalleryMediaFilters) => GalleryMediaFilters) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`admin-gallery-filter-field admin-gallery-filter-field-stacked${className}`}>
      <GalleryFilterLabelRow
        bulkEditActive={bulkEditActive}
        filters={filters}
        label={label}
        notKey={notKey}
        onChange={onChange}
        showNot={showNot}
      />
      {children}
    </label>
  );
}

export function GalleryMediaFilterBar({
  filters,
  categoryOptions,
  onChange,
  onClear,
  bulkEditActive = false,
  bulkTargets,
  onBulkTargetsChange,
  checkAllChecked = false,
  checkAllIndeterminate = false,
  onCheckAllChange,
  checkAllDisabled = false,
  selectedCount = 0,
  onBulkEdit,
  onBulkDelete,
  onBulkAssociateToggle,
  onBulkAssociated,
  onBulkAssociateError,
  bulkAssociateOpen = false,
  bulkAssociateDisabled = false,
  bulkAssociateWrapRef,
  selectedStorageNamesInOrder = [],
  bulkEditDisabled = false,
  bulkDeleteDisabled = false,
  isBulkEditing = false,
  isBulkDeleting = false,
  showFiltersHeading = false
}: GalleryMediaFilterBarProps) {
  const activeFilters = hasActiveGalleryMediaFilters(filters);
  const showBulkControls = onCheckAllChange != null && onBulkEdit != null;
  const checkAllRef = useRef<HTMLInputElement>(null);
  const showFilterActions = showBulkControls;

  useEffect(() => {
    if (checkAllRef.current) {
      checkAllRef.current.indeterminate = checkAllIndeterminate;
    }
  }, [checkAllChecked, checkAllIndeterminate]);

  const metadataCategory = bulkEditActive && bulkTargets ? bulkTargets.mediaCategory : filters.mediaCategory;
  const metadataType = bulkEditActive && bulkTargets ? bulkTargets.mediaType : filters.mediaType;
  const metadataAspect = bulkEditActive && bulkTargets ? bulkTargets.aspect : filters.aspect;
  const metadataEmptyLabel = bulkEditActive ? "—" : "All";

  function updateMetadataCategory(value: string) {
    if (bulkEditActive && bulkTargets && onBulkTargetsChange) {
      onBulkTargetsChange((current) => ({ ...current, mediaCategory: value }));
      return;
    }

    onChange((current) => ({ ...current, mediaCategory: value }));
  }

  function updateMetadataType(value: string) {
    if (bulkEditActive && bulkTargets && onBulkTargetsChange) {
      onBulkTargetsChange((current) => ({ ...current, mediaType: value }));
      return;
    }

    onChange((current) => ({ ...current, mediaType: value }));
  }

  function updateMetadataAspect(value: string) {
    const aspect = value as GalleryMediaAspect | "";

    if (bulkEditActive && bulkTargets && onBulkTargetsChange) {
      onBulkTargetsChange((current) => ({ ...current, aspect }));
      return;
    }

    onChange((current) => ({ ...current, aspect }));
  }

  return (
    <div
      className={`admin-gallery-filters-module${bulkEditActive ? " is-bulk-edit" : ""}${showBulkControls ? " has-bulk-controls" : ""}${showFilterActions ? " has-filter-actions" : ""}`}
    >
      {showFiltersHeading ? <h3 className="admin-gallery-filters-heading">Filters</h3> : null}
      <div
        className={`admin-gallery-filter-bar${showBulkControls ? " has-bulk-controls" : ""}${showFilterActions ? " has-filter-actions" : ""}`}
      >
      <div className="admin-gallery-filter-selection-column">
        <label className="admin-gallery-filter-poll-toggle admin-gallery-filter-field-stacked admin-gallery-filter-checkbox-field">
          <span className="admin-gallery-filter-label admin-gallery-filter-poll-label">Poll</span>
          <span className="admin-gallery-filter-checkbox-wrap">
            <input
              aria-label="Show only gallery files linked to a poll"
              checked={filters.requirePoll}
              disabled={bulkEditActive}
              onChange={(event) =>
                onChange((current) => ({ ...current, requirePoll: event.target.checked }))
              }
              type="checkbox"
            />
          </span>
        </label>
        {showBulkControls ? (
          <label className="admin-gallery-filter-check-all admin-gallery-filter-field-stacked">
            <span className="admin-gallery-filter-label admin-gallery-filter-check-all-label">
              <span className="admin-gallery-filter-check-all-label-line">Check</span>
              <span className="admin-gallery-filter-check-all-label-line">All</span>
            </span>
            <span className="admin-gallery-filter-check-all-control">
              <input
                ref={checkAllRef}
                aria-label="Check all filtered media"
                checked={checkAllChecked}
                disabled={checkAllDisabled}
                onChange={(event) => onCheckAllChange(event.target.checked)}
                type="checkbox"
              />
            </span>
          </label>
        ) : null}
      </div>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        filters={filters}
        label="Name"
        notKey="filename"
        onChange={onChange}
        showNot
      >
        <input
          type="search"
          value={filters.filename}
          disabled={bulkEditActive}
          onChange={(event) => onChange((current) => ({ ...current, filename: event.target.value }))}
          placeholder="Search"
        />
      </GalleryFilterField>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        filters={filters}
        label="Format"
        notKey="extension"
        onChange={onChange}
        showNot
      >
        <select
          value={filters.extension}
          disabled={bulkEditActive}
          onChange={(event) => onChange((current) => ({ ...current, extension: event.target.value }))}
        >
          <option value="">All</option>
          {GALLERY_FILTER_EXTENSIONS.map((extension) => (
            <option key={extension} value={extension}>
              {extension}
            </option>
          ))}
        </select>
      </GalleryFilterField>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        filters={filters}
        label="File"
        notKey="kind"
        onChange={onChange}
        showNot
      >
        <select
          value={filters.kind}
          disabled={bulkEditActive}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              kind: event.target.value as GalleryMediaKindFilter
            }))
          }
        >
          <option value="">All</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </GalleryFilterField>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        className={bulkEditActive ? " is-bulk-target" : ""}
        filters={filters}
        label="Category"
        notKey="mediaCategory"
        onChange={onChange}
        showNot={!bulkEditActive}
      >
        <select value={metadataCategory} onChange={(event) => updateMetadataCategory(event.target.value)}>
          <option value="">{metadataEmptyLabel}</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </GalleryFilterField>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        className={bulkEditActive ? " is-bulk-target" : ""}
        filters={filters}
        label="Type"
        notKey="mediaType"
        onChange={onChange}
        showNot={!bulkEditActive}
      >
        <select value={metadataType} onChange={(event) => updateMetadataType(event.target.value)}>
          <option value="">{metadataEmptyLabel}</option>
          {GALLERY_MEDIA_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </GalleryFilterField>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        className={bulkEditActive ? " is-bulk-target" : ""}
        filters={filters}
        label="Aspect"
        notKey="aspect"
        onChange={onChange}
        showNot={!bulkEditActive}
      >
        <select value={metadataAspect} onChange={(event) => updateMetadataAspect(event.target.value)}>
          <option value="">{metadataEmptyLabel}</option>
          {GALLERY_MEDIA_ASPECTS.map((aspect) => (
            <option key={aspect} value={aspect}>
              {galleryMediaAspectLabel(aspect)}
            </option>
          ))}
        </select>
      </GalleryFilterField>
      <GalleryFilterField
        bulkEditActive={bulkEditActive}
        filters={filters}
        label="Sort"
        onChange={onChange}
        showNot={false}
      >
        <select
          value={filters.sort}
          disabled={bulkEditActive}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              sort: event.target.value as GalleryMediaSort
            }))
          }
        >
          {GALLERY_MEDIA_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </GalleryFilterField>
      {showFilterActions ? (
        <div className="admin-gallery-filter-actions-column">
          {onBulkDelete ? (
            <div className="admin-gallery-filter-delete-slot">
              <button
                className="danger-button admin-gallery-filter-delete-button"
                disabled={bulkDeleteDisabled}
                onClick={onBulkDelete}
                title={
                  selectedCount > 0
                    ? `Delete ${selectedCount} selected file${selectedCount === 1 ? "" : "s"}`
                    : "Select files to delete"
                }
                type="button"
              >
                {isBulkDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          ) : null}
          <div className="admin-gallery-filter-clear-slot">
            <button className="secondary-button" onClick={onClear} type="button">
              Clear
            </button>
          </div>
          {onBulkAssociateToggle ? (
            <div
              className="admin-gallery-filter-associate-slot admin-gallery-popup-wrap"
              ref={bulkAssociateWrapRef}
            >
              <button
                className="secondary-button admin-gallery-action-button"
                disabled={bulkAssociateDisabled}
                onClick={onBulkAssociateToggle}
                title={
                  selectedCount > 0
                    ? `Associate ${selectedCount} selected file${selectedCount === 1 ? "" : "s"} with polls`
                    : "Select files to associate"
                }
                type="button"
              >
                Associate
              </button>
              {bulkAssociateOpen && onBulkAssociated && onBulkAssociateError ? (
                <GalleryPollAssociateMenu
                  onAssociated={onBulkAssociated}
                  onClose={onBulkAssociateToggle}
                  onError={onBulkAssociateError}
                  storageNames={selectedStorageNamesInOrder}
                />
              ) : null}
            </div>
          ) : null}
          <div className="admin-gallery-filter-edit-slot">
            <button
              className="submit-button admin-blog-add-button"
              disabled={bulkEditDisabled}
              onClick={onBulkEdit}
              title={
                bulkEditActive
                  ? selectedCount > 0
                    ? `Apply to ${selectedCount} selected file${selectedCount === 1 ? "" : "s"}`
                    : "Select files to edit"
                  : "Check files, set Category, Type, or Aspect, then Edit"
              }
              type="button"
            >
              {isBulkEditing ? "Editing..." : "Edit"}
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
