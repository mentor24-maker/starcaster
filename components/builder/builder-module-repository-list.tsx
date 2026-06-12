import type { AdminMediaItem } from "@/lib/admin-media";
import type {
  BackgroundSettings,
  BuilderCellModuleRecord,
  BuilderPageRecord,
  BuilderProductRecord,
  BuilderSavedSectionRecord,
  BuilderTemplateRecord,
  BuilderTemplateModule,
  BuilderTemplateSection
} from "@/lib/builder-template";
import { repositoryEditingSessionKeyFromFocus } from "@/lib/builder-repository-save-session";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createDefaultBackgroundSettings, createEmptyModule, normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { BuilderGalleryModal } from "./builder-gallery-modal";
import { BuilderModuleCard } from "./builder-module-card";
import { BuilderModulePaletteModal, type ModulePaletteAnchor } from "./builder-module-palette-modal";
import { BuilderSectionCard } from "./builder-section-card";
import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { appendRichTextImageToHtml } from "@/lib/rich-text-image";
import { formatTemplateTimestamp } from "./builder-utils";
import { layoutOptions, modulePaletteGroups, modulePaletteItems } from "./builder-types";
import {
  BUILDER_MODULE_CLASS_OPTIONS,
  getBuilderModuleClassOptions,
  inferModuleClassFromBuilderModules,
  resolveModuleClassForBuilderModule,
  resolveSavedModuleClass
} from "@/lib/module-class-triggers";
import type { ModulePaletteGroup, ModulePaletteItem } from "./builder-types";

function getModuleClassOptions(currentValue: string) {
  return getBuilderModuleClassOptions(currentValue);
}

type BuilderModuleRepositoryListProps = {
  cellModules: BuilderCellModuleRecord[];
  pages: BuilderPageRecord[];
  products: BuilderProductRecord[];
  galleryMedia: AdminMediaItem[];
  isUploadingMedia: boolean;
  savedSections: BuilderSavedSectionRecord[];
  templates: BuilderTemplateRecord[];
  isSaving: boolean;
  onSaveCreatedModule: (source: CreatedModuleSource, module: BuilderTemplateModule) => void;
  onCloneCreatedModule: (module: BuilderTemplateModule, moduleLabel: string) => void;
  onDeleteCreatedModule: (source: CreatedModuleSource, moduleName: string) => void;
  onSaveSavedModule: (cellModuleId: string, name: string, moduleClass: string, modules: BuilderTemplateModule[]) => void;
  onCreateSavedModule: (name: string, moduleClass: string, modules: BuilderTemplateModule[]) => void;
  onCloneSavedModule: (cellModuleId: string) => void;
  onDeleteSavedModule: (cellModuleId: string, currentName: string) => void;
  onSaveSavedSection: (sectionId: string, name: string, section: BuilderTemplateSection) => void;
  onDeleteSavedSection: (sectionId: string, currentName: string) => void;
  onModuleEditorFocusChange: (focus: BuilderModuleEditorFocus | null, syncOnly?: boolean) => void;
  onRepositoryEditingActiveChange: (active: boolean) => void;
};

export type CreatedModuleSource = {
  kind: "template" | "page";
  sourceId: string;
  sectionId: string;
  moduleId: string;
};

export type BuilderModuleEditorFocus =
  | {
      kind: "created";
      source: CreatedModuleSource;
      module: BuilderTemplateModule;
    }
  | {
      kind: "saved";
      cellModuleId: string;
      name: string;
      moduleClass: string;
      modules: BuilderTemplateModule[];
    }
  | {
      kind: "section";
      sectionId: string;
      name: string;
      section: BuilderTemplateSection;
    };

type CreatedModuleRecord = CreatedModuleSource & {
  id: string;
  module: BuilderTemplateModule;
  sourceName: string;
  sectionTitle: string;
  updatedAt: string;
};

function getModuleSummary(cellModule: BuilderCellModuleRecord) {
  if (cellModule.modules.length === 1) {
    return cellModule.modules[0]?.type || "module";
  }

  return `${cellModule.modules.length} modules`;
}

function getInferredModuleClass(modules: BuilderTemplateModule[]) {
  return inferModuleClassFromBuilderModules(modules);
}

function getDisplayModuleClassForModule(module: BuilderTemplateModule) {
  return resolveModuleClassForBuilderModule(module) || "Unclassified";
}

function getDisplayModuleClass(cellModule: BuilderCellModuleRecord) {
  return resolveSavedModuleClass(cellModule.moduleClass, cellModule.modules) || "Unclassified";
}

function stripRichTextPreview(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const MODULE_TYPE_LABELS = new Map(modulePaletteGroups.map((group) => [group.value, group.label]));

function formatBuilderModuleTypeLabel(type: string): string {
  const normalized = type.trim().toLowerCase();

  if (MODULE_TYPE_LABELS.has(normalized as ModulePaletteGroup)) {
    return MODULE_TYPE_LABELS.get(normalized as ModulePaletteGroup) ?? type;
  }

  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSectionTitle(sectionTitle: string): string {
  const trimmed = sectionTitle.trim();

  if (!trimmed) {
    return "Untitled Section";
  }

  return layoutOptions.find((option) => option.value === trimmed)?.label ?? trimmed;
}

function CrudTruncateCell({ text, title }: { text: string; title?: string }) {
  const resolvedTitle = title ?? text;

  return (
    <span className="builder-crud-truncate" title={resolvedTitle}>
      {text}
    </span>
  );
}

function getModuleLabel(module: BuilderTemplateModule) {
  const name = module.name?.trim();

  if (name) {
    return name;
  }

  const settingsLabel = module.settings.label?.trim();

  if (settingsLabel) {
    return settingsLabel;
  }

  const textPreview = stripRichTextPreview(module.text || "");

  if (textPreview) {
    return textPreview;
  }

  return formatBuilderModuleTypeLabel(module.type);
}

function getCreatedModuleSourceLabel(item: CreatedModuleRecord) {
  const kindLabel = item.kind === "template" ? "Template" : "Page";
  const sourceName = item.sourceName?.trim() || "Untitled";

  return `${kindLabel}: ${sourceName}`;
}

type CreatedModuleFilters = {
  module: string;
  type: string;
  section: string;
  className: string;
  updated: string;
};

const EMPTY_CREATED_MODULE_FILTERS: CreatedModuleFilters = {
  module: "",
  type: "",
  section: "",
  className: "",
  updated: ""
};

function getCreatedModuleFilterOptions(items: CreatedModuleRecord[]) {
  const types = new Set<string>();
  const sections = new Set<string>();

  for (const item of items) {
    types.add(formatBuilderModuleTypeLabel(item.module.type));
    sections.add(formatSectionTitle(item.sectionTitle));
  }

  return {
    types: [...types].sort((a, b) => a.localeCompare(b)),
    classes: BUILDER_MODULE_CLASS_OPTIONS,
    sections: [...sections].sort((a, b) => a.localeCompare(b))
  };
}

function matchesCreatedModuleFilters(item: CreatedModuleRecord, filters: CreatedModuleFilters) {
  const moduleLabel = getModuleLabel(item.module);
  const moduleTypeLabel = formatBuilderModuleTypeLabel(item.module.type);
  const sectionLabel = formatSectionTitle(item.sectionTitle);
  const moduleClassLabel = getDisplayModuleClassForModule(item.module);
  const moduleQuery = filters.module.trim().toLowerCase();
  const updatedQuery = filters.updated.trim().toLowerCase();
  const updatedLabel = formatTemplateTimestamp(item.updatedAt).toLowerCase();

  if (moduleQuery && !moduleLabel.toLowerCase().includes(moduleQuery)) {
    return false;
  }

  if (filters.type && moduleTypeLabel !== filters.type) {
    return false;
  }

  if (filters.section && sectionLabel !== filters.section) {
    return false;
  }

  if (filters.className && moduleClassLabel !== filters.className) {
    return false;
  }

  if (updatedQuery && !updatedLabel.includes(updatedQuery) && !item.updatedAt.toLowerCase().includes(updatedQuery)) {
    return false;
  }

  return true;
}

type CreatedModuleSortKey = "module" | "type" | "section" | "moduleClass" | "updated";
type SortDirection = "asc" | "desc";

function getCreatedModuleRowValues(item: CreatedModuleRecord) {
  return {
    module: getModuleLabel(item.module),
    type: formatBuilderModuleTypeLabel(item.module.type),
    section: formatSectionTitle(item.sectionTitle),
    moduleClass: getDisplayModuleClassForModule(item.module)
  };
}

function compareCreatedModuleRecords(
  left: CreatedModuleRecord,
  right: CreatedModuleRecord,
  sortKey: CreatedModuleSortKey,
  sortDirection: SortDirection
) {
  if (sortKey === "updated") {
    const result = left.updatedAt.localeCompare(right.updatedAt);

    return sortDirection === "asc" ? result : -result;
  }

  const leftValue = getCreatedModuleRowValues(left)[sortKey];
  const rightValue = getCreatedModuleRowValues(right)[sortKey];
  const result = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });

  return sortDirection === "asc" ? result : -result;
}

function BuilderCrudSortButton({
  activeSortKey,
  label,
  onSort,
  sortDirection,
  sortKey
}: {
  activeSortKey: string;
  label: string;
  onSort: (key: string) => void;
  sortDirection: SortDirection;
  sortKey: string;
}) {
  const isActive = activeSortKey === sortKey;
  const indicator = isActive ? (sortDirection === "asc" ? "▲" : "▼") : "↕";

  return (
    <button
      aria-label={`Sort by ${label}`}
      className={`admin-table-sort-button${isActive ? " is-active" : ""}`}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="admin-table-sort-indicator">
        {indicator}
      </span>
    </button>
  );
}

function getCreatedModules(templates: BuilderTemplateRecord[], pages: BuilderPageRecord[]): CreatedModuleRecord[] {
  const templateModules = templates.flatMap((template) =>
    template.layoutSections.flatMap((section) =>
      section.modules.map((module) => ({
        id: `template:${template.id}:${section.id}:${module.id}`,
        kind: "template" as const,
        sourceId: template.id,
        sectionId: section.id,
        moduleId: module.id,
        module,
        sourceName: template.name,
        sectionTitle: section.title || section.layout,
        updatedAt: template.updatedAt
      }))
    )
  );
  const pageModules = pages.flatMap((page) =>
    page.layoutSections.flatMap((section) =>
      section.modules.map((module) => ({
        id: `page:${page.id}:${section.id}:${module.id}`,
        kind: "page" as const,
        sourceId: page.id,
        sectionId: section.id,
        moduleId: module.id,
        module,
        sourceName: page.name,
        sectionTitle: section.title || section.layout,
        updatedAt: page.updatedAt
      }))
    )
  );

  return [...templateModules, ...pageModules];
}

type RepositoryFilters = {
  name: string;
  className: string;
  contents: string;
  id: string;
  updated: string;
};

const EMPTY_REPOSITORY_FILTERS: RepositoryFilters = {
  name: "",
  className: "",
  contents: "",
  id: "",
  updated: ""
};

type RepositorySortKey = "name" | "moduleClass" | "contents" | "id" | "updated";

function getRepositoryFilterOptions(items: BuilderCellModuleRecord[]) {
  const classes = new Set<string>();

  for (const item of items) {
    classes.add(getDisplayModuleClass(item));
  }

  return { classes: [...classes].sort((a, b) => a.localeCompare(b)) };
}

function matchesRepositoryFilters(item: BuilderCellModuleRecord, filters: RepositoryFilters) {
  const name = item.name || "Untitled saved module";
  const moduleClass = getDisplayModuleClass(item);
  const contents = getModuleSummary(item);
  const updated = formatTemplateTimestamp(item.updatedAt);
  const nameQuery = filters.name.trim().toLowerCase();
  const contentsQuery = filters.contents.trim().toLowerCase();
  const idQuery = filters.id.trim().toLowerCase();
  const updatedQuery = filters.updated.trim().toLowerCase();

  if (nameQuery && !name.toLowerCase().includes(nameQuery)) {
    return false;
  }

  if (filters.className && moduleClass !== filters.className) {
    return false;
  }

  if (contentsQuery && !contents.toLowerCase().includes(contentsQuery)) {
    return false;
  }

  if (idQuery && !item.id.toLowerCase().includes(idQuery)) {
    return false;
  }

  if (updatedQuery && !updated.toLowerCase().includes(updatedQuery) && !item.updatedAt.toLowerCase().includes(updatedQuery)) {
    return false;
  }

  return true;
}

function compareRepositoryRecords(
  left: BuilderCellModuleRecord,
  right: BuilderCellModuleRecord,
  sortKey: RepositorySortKey,
  sortDirection: SortDirection
) {
  let result = 0;

  if (sortKey === "updated") {
    result = left.updatedAt.localeCompare(right.updatedAt);
  } else {
    const leftValue =
      sortKey === "name"
        ? left.name || "Untitled saved module"
        : sortKey === "moduleClass"
          ? getDisplayModuleClass(left)
          : sortKey === "contents"
            ? getModuleSummary(left)
            : left.id;
    const rightValue =
      sortKey === "name"
        ? right.name || "Untitled saved module"
        : sortKey === "moduleClass"
          ? getDisplayModuleClass(right)
          : sortKey === "contents"
            ? getModuleSummary(right)
            : right.id;

    result = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base", numeric: true });
  }

  return sortDirection === "asc" ? result : -result;
}

type SavedSectionFilters = {
  name: string;
  layout: string;
  modules: string;
  id: string;
  updated: string;
};

const EMPTY_SAVED_SECTION_FILTERS: SavedSectionFilters = {
  name: "",
  layout: "",
  modules: "",
  id: "",
  updated: ""
};

type SavedSectionSortKey = "name" | "layout" | "modules" | "id" | "updated";

function getSavedSectionFilterOptions(items: BuilderSavedSectionRecord[]) {
  const layouts = new Set<string>();

  for (const item of items) {
    layouts.add(item.section.layout);
  }

  return { layouts: [...layouts].sort((a, b) => a.localeCompare(b)) };
}

function matchesSavedSectionFilters(item: BuilderSavedSectionRecord, filters: SavedSectionFilters) {
  const name = item.name || "Untitled saved section";
  const layout = item.section.layout;
  const modules = item.section.modules.length;
  const updated = formatTemplateTimestamp(item.updatedAt);
  const nameQuery = filters.name.trim().toLowerCase();
  const modulesQuery = filters.modules.trim().toLowerCase();
  const idQuery = filters.id.trim().toLowerCase();
  const updatedQuery = filters.updated.trim().toLowerCase();

  if (nameQuery && !name.toLowerCase().includes(nameQuery)) {
    return false;
  }

  if (filters.layout && layout !== filters.layout) {
    return false;
  }

  if (modulesQuery && !String(modules).includes(modulesQuery)) {
    return false;
  }

  if (idQuery && !item.id.toLowerCase().includes(idQuery)) {
    return false;
  }

  if (updatedQuery && !updated.toLowerCase().includes(updatedQuery) && !item.updatedAt.toLowerCase().includes(updatedQuery)) {
    return false;
  }

  return true;
}

function compareSavedSections(
  left: BuilderSavedSectionRecord,
  right: BuilderSavedSectionRecord,
  sortKey: SavedSectionSortKey,
  sortDirection: SortDirection
) {
  let result = 0;

  if (sortKey === "modules") {
    result = left.section.modules.length - right.section.modules.length;
  } else if (sortKey === "updated") {
    result = left.updatedAt.localeCompare(right.updatedAt);
  } else {
    const leftValue =
      sortKey === "name" ? left.name || "Untitled saved section" : sortKey === "layout" ? left.section.layout : left.id;
    const rightValue =
      sortKey === "name" ? right.name || "Untitled saved section" : sortKey === "layout" ? right.section.layout : right.id;

    result = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base", numeric: true });
  }

  return sortDirection === "asc" ? result : -result;
}

function CreatedModulesTable({
  emptyLabel,
  items,
  products,
  isSaving,
  isCollapsed,
  editingCreatedId,
  editingCreatedModule,
  editingCreatedExpanded,
  onToggle,
  onStartEditing,
  onCancelEditing,
  onToggleEditingCreatedExpanded,
  onUpdateEditingCreatedModule,
  onUpdateEditingCreatedModuleBackground,
  onOpenEditingCreatedModuleGallery,
  onOpenEditingCreatedRichTextGallery,
  onOpenEditingCreatedSocialIconGallery,
  onSaveCreatedModule,
  onCloneCreatedModule,
  onDeleteCreatedModule
}: {
  emptyLabel: string;
  items: CreatedModuleRecord[];
  products: BuilderProductRecord[];
  isSaving: boolean;
  isCollapsed: boolean;
  editingCreatedId: string;
  editingCreatedModule: BuilderTemplateModule | null;
  editingCreatedExpanded: boolean;
  onToggle: () => void;
  onStartEditing: (item: CreatedModuleRecord) => void;
  onCancelEditing: () => void;
  onToggleEditingCreatedExpanded: () => void;
  onUpdateEditingCreatedModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateEditingCreatedModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onOpenEditingCreatedModuleGallery: () => void;
  onOpenEditingCreatedRichTextGallery: (anchor?: BuilderModalAnchor) => void;
  onOpenEditingCreatedSocialIconGallery: (itemId: string) => void;
  onSaveCreatedModule: BuilderModuleRepositoryListProps["onSaveCreatedModule"];
  onCloneCreatedModule: BuilderModuleRepositoryListProps["onCloneCreatedModule"];
  onDeleteCreatedModule: BuilderModuleRepositoryListProps["onDeleteCreatedModule"];
}) {
  const [filters, setFilters] = useState<CreatedModuleFilters>(EMPTY_CREATED_MODULE_FILTERS);
  const [sortKey, setSortKey] = useState<CreatedModuleSortKey>("module");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const filterOptions = useMemo(() => getCreatedModuleFilterOptions(items), [items]);
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => matchesCreatedModuleFilters(item, filters));

    return [...filtered].sort((left, right) => compareCreatedModuleRecords(left, right, sortKey, sortDirection));
  }, [filters, items, sortDirection, sortKey]);

  function updateFilter<K extends keyof CreatedModuleFilters>(key: K, value: CreatedModuleFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(nextKey: string) {
    const typedKey = nextKey as CreatedModuleSortKey;

    if (sortKey === typedKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(typedKey);
    setSortDirection("asc");
  }

  return (
    <div className="builder-toolbar-shell">
      <div className="builder-panel-toggle-row">
        <button
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand All Created Modules" : "Collapse All Created Modules"}
          className="builder-panel-toggle"
          onClick={onToggle}
          title={isCollapsed ? "Expand All Created Modules" : "Collapse All Created Modules"}
          type="button"
        >
          <span className="panel-label">All Created Modules</span>
          <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!isCollapsed} /></span>
        </button>
      </div>
      {!isCollapsed ? (
        <>
          <p className="panel-copy admin-copy builder-modules-crud-intro">
            Modules appear here after you add them to a page or template in the Pages workspace. New types such as
            Speech Bubble live in Pages → Module Library.
          </p>
          <div className="table-shell builder-templates-shell builder-modules-crud-shell">
            <table className="polls-table builder-templates-table builder-modules-crud-table">
            <colgroup>
              <col className="builder-crud-col-module" />
              <col className="builder-crud-col-type" />
              <col className="builder-crud-col-section" />
              <col className="builder-crud-col-class" />
              <col className="builder-crud-col-updated" />
              <col className="builder-crud-col-actions" />
            </colgroup>
            <thead>
              <tr className="builder-crud-filter-row">
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Module</span>
                    <input
                      className="builder-crud-filter-input"
                      placeholder="Search"
                      type="search"
                      value={filters.module}
                      onChange={(event) => updateFilter("module", event.target.value)}
                    />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Type</span>
                    <select
                      className="builder-crud-filter-select"
                      value={filters.type}
                      onChange={(event) => updateFilter("type", event.target.value)}
                    >
                      <option value="">All</option>
                      {filterOptions.types.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Section</span>
                    <select
                      className="builder-crud-filter-select"
                      value={filters.section}
                      onChange={(event) => updateFilter("section", event.target.value)}
                    >
                      <option value="">All</option>
                      {filterOptions.sections.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Class</span>
                    <select
                      className="builder-crud-filter-select"
                      value={filters.className}
                      onChange={(event) => updateFilter("className", event.target.value)}
                    >
                      <option value="">All</option>
                      {filterOptions.classes.map((moduleClass) => (
                        <option key={moduleClass} value={moduleClass}>
                          {moduleClass}
                        </option>
                      ))}
                    </select>
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Updated</span>
                    <input
                      className="builder-crud-filter-input"
                      placeholder="Search"
                      type="search"
                      value={filters.updated}
                      onChange={(event) => updateFilter("updated", event.target.value)}
                    />
                  </label>
                </th>
                <th className="crud-actions-cell" scope="col" />
              </tr>
              <tr>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Module"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="module"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Type"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="type"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Section"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="section"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Class"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="moduleClass"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Updated"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="updated"
                  />
                </th>
                <th className="crud-actions-cell" scope="col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const moduleLabel = getModuleLabel(item.module);
                const moduleTypeLabel = formatBuilderModuleTypeLabel(item.module.type);
                const sectionLabel = formatSectionTitle(item.sectionTitle);
                const moduleClassLabel = getDisplayModuleClassForModule(item.module);
                const updatedLabel = formatTemplateTimestamp(item.updatedAt);

                return (
                <Fragment key={item.id}>
                  <tr>
                    <td className="builder-crud-cell-module">
                      <strong className="builder-crud-truncate" title={moduleLabel}>
                        {moduleLabel}
                      </strong>
                    </td>
                    <td>
                      <CrudTruncateCell text={moduleTypeLabel} title={moduleTypeLabel} />
                    </td>
                    <td>
                      <CrudTruncateCell text={sectionLabel} title={sectionLabel} />
                    </td>
                    <td>
                      <CrudTruncateCell text={moduleClassLabel} title={moduleClassLabel} />
                    </td>
                    <td className="builder-crud-cell-updated">
                      <CrudTruncateCell text={updatedLabel} title={updatedLabel} />
                    </td>
                    <td className="crud-actions-cell">
                      <div className="builder-template-actions">
                        <button
                          aria-label="Edit created module"
                          className="polls-icon-button polls-icon-button-edit"
                          disabled={isSaving}
                          onClick={() => onStartEditing(item)}
                          title="Edit"
                          type="button"
                        >
                          ✎
                        </button>
                        <button
                          aria-label="Clone created module"
                          className="polls-icon-button polls-icon-button-view"
                          disabled={isSaving}
                          onClick={() => onCloneCreatedModule(item.module, moduleLabel)}
                          title="Clone"
                          type="button"
                        >
                          ⧉
                        </button>
                        <button
                          aria-label="Delete created module"
                          className="polls-icon-button polls-icon-button-danger"
                          disabled={isSaving}
                          onClick={() => onDeleteCreatedModule(item, moduleLabel)}
                          title="Delete"
                          type="button"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingCreatedId === item.id && editingCreatedModule ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="builder-saved-module-editor">
                          <div className="builder-meta-grid">
                            <div>
                              <strong>{getCreatedModuleSourceLabel(item)}</strong>
                              <p className="builder-module-editor-copy">
                                Editing the live module in {sectionLabel}.
                              </p>
                            </div>
                            <div className="builder-meta-actions">
                              <button
                                className="submit-button admin-blog-add-button"
                                disabled={isSaving || !editingCreatedModule}
                                onClick={() => {
                                  if (!editingCreatedModule) {
                                    return;
                                  }

                                  void onSaveCreatedModule(
                                    {
                                      kind: item.kind,
                                      sourceId: item.sourceId,
                                      sectionId: item.sectionId,
                                      moduleId: item.moduleId
                                    },
                                    editingCreatedModule
                                  );
                                }}
                                type="button"
                              >
                                {isSaving ? "Saving..." : "Save Module"}
                              </button>
                              <button className="secondary-button" onClick={onCancelEditing} type="button">
                                Cancel
                              </button>
                            </div>
                          </div>
                          <div className="builder-saved-module-column-pod">
                            <BuilderModuleCard
                              editorDevice="browser"
                              hideHeaderActions
                              isExpanded={editingCreatedExpanded}
                              module={editingCreatedModule}
                              products={products}
                              onClone={() => undefined}
                              onMoveDown={() => undefined}
                              onMoveUp={() => undefined}
                              onOpenGallery={onOpenEditingCreatedModuleGallery}
                              onOpenRichTextGallery={onOpenEditingCreatedRichTextGallery}
                              onOpenSocialIconGallery={onOpenEditingCreatedSocialIconGallery}
                              onRemove={() => undefined}
                              onToggleExpanded={onToggleEditingCreatedExpanded}
                              onUpdateModule={onUpdateEditingCreatedModule}
                              onUpdateModuleBackground={onUpdateEditingCreatedModuleBackground}
                              onUploadMedia={() => undefined}
                              sectionId="created-module-editor"
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
                );
              })}
              {visibleItems.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    {items.length === 0 ? emptyLabel : "No modules match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </>
      ) : null}
    </div>
  );
}

function RepositoryTable({
  emptyLabel,
  items,
  products,
  isSaving,
  title,
  isCollapsed,
  editingId,
  editingName,
  editingModuleClass,
  editingExpandedModuleIds,
  editingModules,
  onToggle,
  onToggleEditingModuleExpanded,
  onStartEditing,
  onCancelEditing,
  onSetEditingName,
  onSetEditingModuleClass,
  onUpdateEditingModule,
  onUpdateEditingModuleBackground,
  onOpenEditingModuleGallery,
  onOpenEditingRichTextGallery,
  onOpenEditingSocialIconGallery,
  onSaveSavedModule,
  onCloneSavedModule,
  onDeleteSavedModule
}: {
  emptyLabel: string;
  items: BuilderCellModuleRecord[];
  products: BuilderProductRecord[];
  isSaving: boolean;
  title: string;
  isCollapsed: boolean;
  editingId: string;
  editingName: string;
  editingModuleClass: string;
  editingExpandedModuleIds: string[];
  editingModules: BuilderTemplateModule[];
  onToggle: () => void;
  onToggleEditingModuleExpanded: (moduleId: string) => void;
  onStartEditing: (item: BuilderCellModuleRecord) => void;
  onCancelEditing: () => void;
  onSetEditingName: (name: string) => void;
  onSetEditingModuleClass: (moduleClass: string) => void;
  onUpdateEditingModule: (moduleId: string, updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateEditingModuleBackground: (moduleId: string, updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onOpenEditingModuleGallery: (moduleId: string) => void;
  onOpenEditingRichTextGallery: (moduleId: string, anchor?: BuilderModalAnchor) => void;
  onOpenEditingSocialIconGallery: (moduleId: string, itemId: string) => void;
  onSaveSavedModule: BuilderModuleRepositoryListProps["onSaveSavedModule"];
  onCloneSavedModule: BuilderModuleRepositoryListProps["onCloneSavedModule"];
  onDeleteSavedModule: BuilderModuleRepositoryListProps["onDeleteSavedModule"];
}) {
  const [filters, setFilters] = useState<RepositoryFilters>(EMPTY_REPOSITORY_FILTERS);
  const [sortKey, setSortKey] = useState<RepositorySortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const filterOptions = useMemo(() => getRepositoryFilterOptions(items), [items]);
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => matchesRepositoryFilters(item, filters));

    return [...filtered].sort((left, right) => compareRepositoryRecords(left, right, sortKey, sortDirection));
  }, [filters, items, sortDirection, sortKey]);

  function updateFilter<K extends keyof RepositoryFilters>(key: K, value: RepositoryFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(nextKey: string) {
    const typedKey = nextKey as RepositorySortKey;

    if (sortKey === typedKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(typedKey);
    setSortDirection("asc");
  }

  return (
    <div className="builder-toolbar-shell">
      <div className="builder-panel-toggle-row">
        <button
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
          className="builder-panel-toggle"
          onClick={onToggle}
          title={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
          type="button"
        >
          <span className="panel-label">{title}</span>
          <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!isCollapsed} /></span>
        </button>
      </div>
      {!isCollapsed ? (
        <div className="table-shell builder-templates-shell">
          <table className="polls-table builder-templates-table">
            <thead>
              <tr className="builder-crud-filter-row">
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Name</span>
                    <input
                      className="builder-crud-filter-input"
                      placeholder="Search"
                      type="search"
                      value={filters.name}
                      onChange={(event) => updateFilter("name", event.target.value)}
                    />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Class</span>
                    <select
                      className="builder-crud-filter-select"
                      value={filters.className}
                      onChange={(event) => updateFilter("className", event.target.value)}
                    >
                      <option value="">All</option>
                      {filterOptions.classes.map((moduleClass) => (
                        <option key={moduleClass} value={moduleClass}>
                          {moduleClass}
                        </option>
                      ))}
                    </select>
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Contents</span>
                    <input
                      className="builder-crud-filter-input"
                      placeholder="Search"
                      type="search"
                      value={filters.contents}
                      onChange={(event) => updateFilter("contents", event.target.value)}
                    />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter ID</span>
                    <input
                      className="builder-crud-filter-input"
                      placeholder="Search"
                      type="search"
                      value={filters.id}
                      onChange={(event) => updateFilter("id", event.target.value)}
                    />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Updated</span>
                    <input
                      className="builder-crud-filter-input"
                      placeholder="Search"
                      type="search"
                      value={filters.updated}
                      onChange={(event) => updateFilter("updated", event.target.value)}
                    />
                  </label>
                </th>
                <th className="crud-actions-cell" scope="col" />
              </tr>
              <tr>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Name"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="name"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Class"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="moduleClass"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Contents"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="contents"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="ID"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="id"
                  />
                </th>
                <th scope="col">
                  <BuilderCrudSortButton
                    activeSortKey={sortKey}
                    label="Updated"
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortKey="updated"
                  />
                </th>
                <th className="crud-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <Fragment key={item.id}>
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name || "Untitled saved module"}</strong>
                    </td>
                    <td>{getDisplayModuleClass(item)}</td>
                    <td>{getModuleSummary(item)}</td>
                    <td className="template-id-cell">
                      <code>{item.id}</code>
                    </td>
                    <td>{formatTemplateTimestamp(item.updatedAt)}</td>
                    <td className="crud-actions-cell">
                      <div className="builder-template-actions">
                        <button
                          aria-label="Edit saved module"
                          className="polls-icon-button polls-icon-button-edit"
                          disabled={isSaving}
                          onClick={() => onStartEditing(item)}
                          title="Edit"
                          type="button"
                        >
                          ✎
                        </button>
                        <button
                          aria-label="Clone"
                          className="polls-icon-button polls-icon-button-view"
                          disabled={isSaving}
                          onClick={() => onCloneSavedModule(item.id)}
                          title="Clone"
                          type="button"
                        >
                          ⧉
                        </button>
                        <button
                          aria-label="Delete saved module"
                          className="polls-icon-button polls-icon-button-danger"
                          disabled={isSaving}
                          onClick={() => onDeleteSavedModule(item.id, item.name)}
                          title="Delete"
                          type="button"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === item.id ? (
                    <tr key={`${item.id}-editor`}>
                      <td colSpan={6}>
                        <div className="builder-saved-module-editor">
                          <div className="builder-meta-grid">
                            <label className="field">
                              <span>Saved module name</span>
                              <input
                                type="text"
                                value={editingName}
                                onChange={(event) => onSetEditingName(event.target.value)}
                              />
                            </label>
                            <label className="field">
                              <span>Module class</span>
                              <select
                                value={editingModuleClass}
                                onChange={(event) => onSetEditingModuleClass(event.target.value)}
                              >
                                {getModuleClassOptions(editingModuleClass).map((moduleClass) => (
                                  <option key={moduleClass} value={moduleClass}>
                                    {moduleClass}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="builder-meta-actions">
                              <button
                                className="submit-button admin-blog-add-button"
                                disabled={isSaving || !editingId}
                                onClick={() => {
                                  void onSaveSavedModule(
                                    editingId,
                                    editingName,
                                    editingModuleClass,
                                    editingModules
                                  );
                                }}
                                type="button"
                              >
                                {isSaving ? "Saving..." : "Save Module"}
                              </button>
                              <button className="secondary-button" onClick={onCancelEditing} type="button">
                                Cancel
                              </button>
                            </div>
                          </div>
                          <div className="builder-saved-module-column-pod builder-saved-module-editor-stack">
                            {editingModules.map((module) => (
                              <BuilderModuleCard
                                editorDevice="browser"
                                hideHeaderActions
                                isExpanded={editingExpandedModuleIds.includes(module.id)}
                                key={module.id}
                                module={module}
                                moduleClassOverride={editingModuleClass}
                                products={products}
                                onClone={() => undefined}
                                onMoveDown={() => undefined}
                                onMoveUp={() => undefined}
                                onOpenGallery={() => onOpenEditingModuleGallery(module.id)}
                                onOpenRichTextGallery={(anchor) => onOpenEditingRichTextGallery(module.id, anchor)}
                                onOpenSocialIconGallery={(itemId) => onOpenEditingSocialIconGallery(module.id, itemId)}
                                onRemove={() => undefined}
                                onToggleExpanded={() => onToggleEditingModuleExpanded(module.id)}
                                onUpdateModule={(updater) => onUpdateEditingModule(module.id, updater)}
                                onUpdateModuleBackground={(updater) => onUpdateEditingModuleBackground(module.id, updater)}
                                onUploadMedia={() => undefined}
                                sectionId="saved-module-editor"
                              />
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {visibleItems.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    {items.length === 0 ? emptyLabel : "No saved records match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function SavedSectionsTable({
  savedSections,
  cellModules,
  products,
  isSaving,
  isCollapsed,
  editingSectionId,
  editingSectionName,
  editingSection,
  editingSectionCollapsed,
  editingSectionExpandedModuleIds,
  onToggle,
  onStartEditingSection,
  onDeleteSavedSection,
  onSetEditingSectionName,
  onSaveSavedSection,
  onCancelEditingSection,
  onCloneEditingSectionModule,
  onDropEditingSectionModule,
  onInsertEditingSectionCellModule,
  onMoveEditingSectionModule,
  onOpenEditingSectionModuleGallery,
  onOpenEditingSectionRichTextGallery,
  onOpenEditingSectionBackgroundGallery,
  onOpenEditingSectionSocialIconGallery,
  onOpenEditingSectionModulePalette,
  onRemoveEditingSectionModule,
  onSaveEditingSectionCellModules,
  onSaveEditingSectionModule,
  onToggleEditingSectionCollapsed,
  onToggleEditingSectionModuleExpanded,
  onUpdateEditingSectionCellBackground,
  onUpdateEditingSectionCellRecord,
  onUpdateEditingSectionModule,
  onUpdateEditingSectionModuleBackground,
  onUpdateEditingSection
}: {
  savedSections: BuilderSavedSectionRecord[];
  cellModules: BuilderCellModuleRecord[];
  products: BuilderProductRecord[];
  isSaving: boolean;
  isCollapsed: boolean;
  editingSectionId: string;
  editingSectionName: string;
  editingSection: BuilderTemplateSection | null;
  editingSectionCollapsed: boolean;
  editingSectionExpandedModuleIds: string[];
  onToggle: () => void;
  onStartEditingSection: (section: BuilderSavedSectionRecord) => void;
  onDeleteSavedSection: (sectionId: string, currentName: string) => void;
  onSetEditingSectionName: (name: string) => void;
  onSaveSavedSection: (sectionId: string, name: string, section: BuilderTemplateSection) => void;
  onCancelEditingSection: () => void;
  onCloneEditingSectionModule: (moduleId: string) => void;
  onDropEditingSectionModule: (
    moduleId: string,
    sourceSectionId: string,
    targetSectionId: string,
    targetColumn: string,
    targetBeforeModuleId?: string
  ) => void;
  onInsertEditingSectionCellModule: (column: string, cellModuleId: string, moduleCount: 1 | "many") => void;
  onMoveEditingSectionModule: (moduleId: string, direction: -1 | 1) => void;
  onOpenEditingSectionModuleGallery: (moduleId: string) => void;
  onOpenEditingSectionRichTextGallery: (moduleId: string, anchor?: BuilderModalAnchor) => void;
  onOpenEditingSectionBackgroundGallery: () => void;
  onOpenEditingSectionSocialIconGallery: (moduleId: string, itemId: string) => void;
  onOpenEditingSectionModulePalette: (column: string, anchor?: ModulePaletteAnchor) => void;
  onRemoveEditingSectionModule: (moduleId: string) => void;
  onSaveEditingSectionCellModules: (column: string) => void;
  onSaveEditingSectionModule: (moduleId: string) => void;
  onToggleEditingSectionCollapsed: () => void;
  onToggleEditingSectionModuleExpanded: (moduleId: string) => void;
  onUpdateEditingSectionCellBackground: (column: string, updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onUpdateEditingSectionCellRecord: (key: keyof BuilderTemplateSection, column: string, value: string) => void;
  onUpdateEditingSectionModule: (moduleId: string, updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateEditingSectionModuleBackground: (
    moduleId: string,
    updater: (background: BackgroundSettings) => BackgroundSettings
  ) => void;
  onUpdateEditingSection: (updater: (section: BuilderTemplateSection) => BuilderTemplateSection) => void;
}) {
  const [filters, setFilters] = useState<SavedSectionFilters>(EMPTY_SAVED_SECTION_FILTERS);
  const [sortKey, setSortKey] = useState<SavedSectionSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const filterOptions = useMemo(() => getSavedSectionFilterOptions(savedSections), [savedSections]);
  const visibleSections = useMemo(() => {
    const filtered = savedSections.filter((section) => matchesSavedSectionFilters(section, filters));
    return [...filtered].sort((left, right) => compareSavedSections(left, right, sortKey, sortDirection));
  }, [filters, savedSections, sortDirection, sortKey]);

  function updateFilter<K extends keyof SavedSectionFilters>(key: K, value: SavedSectionFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(nextKey: string) {
    const typedKey = nextKey as SavedSectionSortKey;

    if (sortKey === typedKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(typedKey);
    setSortDirection("asc");
  }

  return (
    <div className="builder-toolbar-shell">
      <div className="builder-panel-toggle-row">
        <button
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand Saved Sections" : "Collapse Saved Sections"}
          className="builder-panel-toggle"
          onClick={onToggle}
          title={isCollapsed ? "Expand Saved Sections" : "Collapse Saved Sections"}
          type="button"
        >
          <span className="panel-label">Saved Sections</span>
          <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!isCollapsed} /></span>
        </button>
      </div>
      {!isCollapsed ? (
        <div className="table-shell builder-templates-shell">
          <table className="polls-table builder-templates-table">
            <thead>
              <tr className="builder-crud-filter-row">
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Name</span>
                    <input className="builder-crud-filter-input" placeholder="Search" type="search" value={filters.name} onChange={(event) => updateFilter("name", event.target.value)} />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Layout</span>
                    <select className="builder-crud-filter-select" value={filters.layout} onChange={(event) => updateFilter("layout", event.target.value)}>
                      <option value="">All</option>
                      {filterOptions.layouts.map((layout) => (
                        <option key={layout} value={layout}>{layout}</option>
                      ))}
                    </select>
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Modules</span>
                    <input className="builder-crud-filter-input" placeholder="Search" type="search" value={filters.modules} onChange={(event) => updateFilter("modules", event.target.value)} />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter ID</span>
                    <input className="builder-crud-filter-input" placeholder="Search" type="search" value={filters.id} onChange={(event) => updateFilter("id", event.target.value)} />
                  </label>
                </th>
                <th scope="col">
                  <label className="builder-crud-filter-field">
                    <span className="builder-crud-filter-label">Filter Updated</span>
                    <input className="builder-crud-filter-input" placeholder="Search" type="search" value={filters.updated} onChange={(event) => updateFilter("updated", event.target.value)} />
                  </label>
                </th>
                <th className="crud-actions-cell" scope="col" />
              </tr>
              <tr>
                <th scope="col"><BuilderCrudSortButton activeSortKey={sortKey} label="Name" onSort={handleSort} sortDirection={sortDirection} sortKey="name" /></th>
                <th scope="col"><BuilderCrudSortButton activeSortKey={sortKey} label="Layout" onSort={handleSort} sortDirection={sortDirection} sortKey="layout" /></th>
                <th scope="col"><BuilderCrudSortButton activeSortKey={sortKey} label="Modules" onSort={handleSort} sortDirection={sortDirection} sortKey="modules" /></th>
                <th scope="col"><BuilderCrudSortButton activeSortKey={sortKey} label="ID" onSort={handleSort} sortDirection={sortDirection} sortKey="id" /></th>
                <th scope="col"><BuilderCrudSortButton activeSortKey={sortKey} label="Updated" onSort={handleSort} sortDirection={sortDirection} sortKey="updated" /></th>
                <th className="crud-actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleSections.map((section) => (
                <Fragment key={section.id}>
                  <tr>
                    <td><strong>{section.name || "Untitled saved section"}</strong></td>
                    <td>{section.section.layout}</td>
                    <td>{section.section.modules.length}</td>
                    <td className="template-id-cell"><code>{section.id}</code></td>
                    <td>{formatTemplateTimestamp(section.updatedAt)}</td>
                    <td className="crud-actions-cell">
                      <div className="builder-template-actions">
                        <button aria-label="Edit saved section" className="polls-icon-button polls-icon-button-edit" disabled={isSaving} onClick={() => onStartEditingSection(section)} title="Edit section" type="button">✎</button>
                        <button aria-label="Delete saved section" className="polls-icon-button polls-icon-button-danger" disabled={isSaving} onClick={() => onDeleteSavedSection(section.id, section.name)} title="Delete" type="button">🗑</button>
                      </div>
                    </td>
                  </tr>
                  {editingSectionId === section.id && editingSection ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="builder-saved-module-editor">
                          <div className="builder-meta-grid">
                            <label className="field">
                              <span>Saved section name</span>
                              <input type="text" value={editingSectionName} onChange={(event) => onSetEditingSectionName(event.target.value)} />
                            </label>
                            <div className="builder-meta-actions">
                              <button className="submit-button admin-blog-add-button" disabled={isSaving || !editingSection} onClick={() => void onSaveSavedSection(editingSectionId, editingSectionName, editingSection)} type="button">
                                {isSaving ? "Saving..." : "Save Section"}
                              </button>
                              <button className="secondary-button" onClick={onCancelEditingSection} type="button">Cancel</button>
                            </div>
                          </div>
                          <div className="builder-rows-pod">
                            <BuilderSectionCard
                            cellModules={cellModules}
                            editorDevice="browser"
                            expandedModuleIds={editingSectionExpandedModuleIds}
                            isCollapsed={editingSectionCollapsed}
                            key={editingSection.id}
                            products={products}
                            section={editingSection}
                            sectionIndex={0}
                            onCloneModule={(_, moduleId) => onCloneEditingSectionModule(moduleId)}
                            onSaveModule={onSaveEditingSectionModule}
                            onCloneSection={() => undefined}
                            onDropModule={onDropEditingSectionModule}
                            onInsertCellModule={(column, cellModuleId) => onInsertEditingSectionCellModule(column, cellModuleId, "many")}
                            onInsertSavedModule={(column, cellModuleId) => onInsertEditingSectionCellModule(column, cellModuleId, 1)}
                            onMoveDown={() => undefined}
                            onMoveModule={onMoveEditingSectionModule}
                            onMoveUp={() => undefined}
                            onOpenGallery={onOpenEditingSectionModuleGallery}
                            onOpenRichTextGallery={onOpenEditingSectionRichTextGallery}
                            onOpenButtonBackgroundGallery={() => undefined}
                            onOpenModulePalette={onOpenEditingSectionModulePalette}
                            onOpenSectionBackgroundGallery={onOpenEditingSectionBackgroundGallery}
                            onOpenSocialIconGallery={onOpenEditingSectionSocialIconGallery}
                            onRemove={() => undefined}
                            onRemoveModule={onRemoveEditingSectionModule}
                            onSaveCellModules={onSaveEditingSectionCellModules}
                            onSaveSection={() => onSaveSavedSection(section.id, editingSectionName, editingSection)}
                            onToggleCollapsed={onToggleEditingSectionCollapsed}
                            onToggleModuleExpanded={onToggleEditingSectionModuleExpanded}
                            onUpdateCellBackground={onUpdateEditingSectionCellBackground}
                            onUpdateCellBorderColor={(column, value) => onUpdateEditingSectionCellRecord("cellBorderColor", column, value)}
                            onUpdateCellBorderRadius={(column, value) => onUpdateEditingSectionCellRecord("cellBorderRadius", column, value)}
                            onUpdateCellBorderWidth={(column, value) => onUpdateEditingSectionCellRecord("cellBorderWidth", column, value)}
                            onUpdateCellPadding={(column, value) => onUpdateEditingSectionCellRecord("cellPadding", column, value)}
                            onUpdateModule={onUpdateEditingSectionModule}
                            onUpdateModuleBackground={onUpdateEditingSectionModuleBackground}
                            onUpdateSection={onUpdateEditingSection}
                            onUploadMediaForModule={() => undefined}
                            onUploadButtonBackgroundMedia={() => undefined}
                            onUploadSectionBackgroundMedia={() => undefined}
                          />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {visibleSections.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    {savedSections.length === 0 ? "No saved sections found." : "No saved sections match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function BuilderModuleRepositoryList({
  cellModules,
  pages,
  products,
  galleryMedia,
  isUploadingMedia,
  savedSections,
  templates,
  isSaving,
  onSaveCreatedModule,
  onCloneCreatedModule,
  onDeleteCreatedModule,
  onSaveSavedModule,
  onCreateSavedModule,
  onCloneSavedModule,
  onDeleteSavedModule,
  onSaveSavedSection,
  onDeleteSavedSection,
  onModuleEditorFocusChange,
  onRepositoryEditingActiveChange
}: BuilderModuleRepositoryListProps) {
  const [collapsedPanels, setCollapsedPanels] = useState({
    createdModules: true,
    modules: true,
    cells: true,
    sections: true
  });
  const [editingCreatedId, setEditingCreatedId] = useState("");
  const [editingCreatedModule, setEditingCreatedModule] = useState<BuilderTemplateModule | null>(null);
  const [editingCreatedExpanded, setEditingCreatedExpanded] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingModuleClass, setEditingModuleClass] = useState("");
  const [editingModules, setEditingModules] = useState<BuilderTemplateModule[]>([]);
  const [editingExpandedModuleIds, setEditingExpandedModuleIds] = useState<string[]>([]);
  const [editingSectionId, setEditingSectionId] = useState("");
  const [editingSectionName, setEditingSectionName] = useState("");
  const [editingSection, setEditingSection] = useState<BuilderTemplateSection | null>(null);
  const [editingSectionCollapsed, setEditingSectionCollapsed] = useState(false);
  const [editingSectionExpandedModuleIds, setEditingSectionExpandedModuleIds] = useState<string[]>([]);
  const [editingSectionGalleryTarget, setEditingSectionGalleryTarget] = useState<
    | { kind: "section-background" }
    | { kind: "module"; moduleId: string }
    | { kind: "rich-text"; moduleId: string }
    | { kind: "social-icon"; moduleId: string; itemId: string }
    | null
  >(null);
  const [editingSectionPaletteColumn, setEditingSectionPaletteColumn] = useState("");
  const [editingSectionPaletteAnchor, setEditingSectionPaletteAnchor] = useState<ModulePaletteAnchor | null>(null);
  const [activeModuleGroup, setActiveModuleGroup] = useState<ModulePaletteGroup | null>(null);
  const [editingGalleryTarget, setEditingGalleryTarget] = useState<
    | { kind: "created-module" }
    | { kind: "created-rich-text" }
    | { kind: "created-social-icon"; itemId: string }
    | { kind: "module"; moduleId: string }
    | { kind: "rich-text"; moduleId: string }
    | { kind: "social-icon"; moduleId: string; itemId: string }
    | null
  >(null);
  const [editingGalleryAnchor, setEditingGalleryAnchor] = useState<BuilderModalAnchor | null>(null);
  const savedModules = cellModules.filter((cellModule) => cellModule.modules.length === 1);
  const savedCells = cellModules.filter((cellModule) => cellModule.modules.length !== 1);
  const createdModules = useMemo(() => getCreatedModules(templates, pages), [pages, templates]);

  function buildCreatedModuleFocus(): BuilderModuleEditorFocus | null {
    if (!editingCreatedId || !editingCreatedModule) {
      return null;
    }

    const source = createdModules.find((item) => item.id === editingCreatedId);

    if (!source) {
      return null;
    }

    return {
      kind: "created",
      source: {
        kind: source.kind,
        sourceId: source.sourceId,
        sectionId: source.sectionId,
        moduleId: source.moduleId
      },
      module: editingCreatedModule
    };
  }

  function buildSavedModuleFocus(): BuilderModuleEditorFocus | null {
    if (!editingId) {
      return null;
    }

    return {
      kind: "saved",
      cellModuleId: editingId,
      name: editingName,
      moduleClass: editingModuleClass,
      modules: editingModules
    };
  }

  function buildSectionFocus(): BuilderModuleEditorFocus | null {
    if (!editingSectionId || !editingSection) {
      return null;
    }

    return {
      kind: "section",
      sectionId: editingSectionId,
      name: editingSectionName,
      section: editingSection
    };
  }

  const lastPublishedEditingSessionKeyRef = useRef("");

  function publishRepositorySaveFocus(focus: BuilderModuleEditorFocus | null) {
    lastPublishedEditingSessionKeyRef.current = focus
      ? repositoryEditingSessionKeyFromFocus(focus)
      : "";

    onModuleEditorFocusChange(focus, false);
  }

  function syncRepositorySaveFocus() {
    const focus =
      buildSectionFocus() ?? buildCreatedModuleFocus() ?? buildSavedModuleFocus();

    if (!focus) {
      return;
    }

    onModuleEditorFocusChange(focus, true);
  }

  const editingSessionKey = useMemo(() => {
    const focus =
      buildSectionFocus() ?? buildCreatedModuleFocus() ?? buildSavedModuleFocus();

    return focus ? repositoryEditingSessionKeyFromFocus(focus) : "";
  }, [
    createdModules,
    editingCreatedId,
    editingCreatedModule,
    editingId,
    editingModuleClass,
    editingModules,
    editingName,
    editingSection,
    editingSectionId,
    editingSectionName
  ]);

  const repositoryEditorOpen = Boolean(editingCreatedId || editingId || editingSectionId);

  useEffect(() => {
    onRepositoryEditingActiveChange(repositoryEditorOpen);
  }, [onRepositoryEditingActiveChange, repositoryEditorOpen]);

  useEffect(() => {
    if (!editingSessionKey) {
      if (lastPublishedEditingSessionKeyRef.current) {
        publishRepositorySaveFocus(null);
      }
      return;
    }

    const focus =
      buildSectionFocus() ?? buildCreatedModuleFocus() ?? buildSavedModuleFocus();

    if (!focus) {
      return;
    }

    if (lastPublishedEditingSessionKeyRef.current === editingSessionKey) {
      syncRepositorySaveFocus();
      return;
    }

    lastPublishedEditingSessionKeyRef.current = editingSessionKey;
    publishRepositorySaveFocus(focus);
  }, [
    createdModules,
    editingCreatedId,
    editingCreatedModule,
    editingId,
    editingModuleClass,
    editingModules,
    editingName,
    editingSection,
    editingSectionId,
    editingSectionName,
    editingSessionKey,
    onModuleEditorFocusChange
  ]);

  function resetSavedModuleAndCellEditing() {
    setEditingId("");
    setEditingName("");
    setEditingModuleClass("");
    setEditingModules([]);
    setEditingExpandedModuleIds([]);
  }

  function resetCreatedModuleEditing() {
    setEditingCreatedId("");
    setEditingCreatedModule(null);
    setEditingCreatedExpanded(false);
  }

  function resetSectionEditing() {
    setEditingSectionId("");
    setEditingSectionName("");
    setEditingSection(null);
    setEditingSectionCollapsed(false);
    setEditingSectionExpandedModuleIds([]);
    setEditingSectionGalleryTarget(null);
    setEditingSectionPaletteColumn("");
    setEditingSectionPaletteAnchor(null);
  }

  function cloneSectionForEditing(section: BuilderTemplateSection): BuilderTemplateSection {
    return {
      ...section,
      background: { ...section.background },
      cellBackgrounds: Object.fromEntries(
        Object.entries(section.cellBackgrounds ?? {}).map(([key, background]) => [key, { ...background }])
      ),
      cellPadding: { ...section.cellPadding },
      cellVerticalMargin: { ...section.cellVerticalMargin },
      cellMobileHidden: { ...section.cellMobileHidden },
      cellDesktopHidden: { ...section.cellDesktopHidden },
      cellBorderWidth: { ...section.cellBorderWidth },
      cellBorderColor: { ...section.cellBorderColor },
      cellBorderRadius: { ...section.cellBorderRadius },
      cellBorderStyle: { ...section.cellBorderStyle },
      cellShadow: { ...section.cellShadow },
      cellOpacity: { ...section.cellOpacity },
      cellHAlign: { ...section.cellHAlign },
      cellVAlign: { ...section.cellVAlign },
      modules: section.modules.map((module) => ({ ...module, settings: { ...module.settings } }))
    };
  }

  function togglePanel(panel: keyof typeof collapsedPanels) {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function toggleEditingModuleExpanded(moduleId: string) {
    setEditingExpandedModuleIds((current) =>
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId]
    );
  }

  function startEditing(item: BuilderCellModuleRecord) {
    resetCreatedModuleEditing();
    resetSectionEditing();

    const modules = item.modules.map((module) => ({ ...module, settings: { ...module.settings } }));
    const expandedIds = modules.length > 0 ? [modules[0].id] : [];

    setEditingId(item.id);
    setEditingName(item.name);
    setEditingModuleClass(getDisplayModuleClass(item));
    setEditingModules(modules);
    setEditingExpandedModuleIds(expandedIds);
    publishRepositorySaveFocus({
      kind: "saved",
      cellModuleId: item.id,
      name: item.name,
      moduleClass: getDisplayModuleClass(item),
      modules
    });
  }

  function startEditingCreatedModule(item: CreatedModuleRecord) {
    resetSavedModuleAndCellEditing();
    resetSectionEditing();

    setEditingCreatedId(item.id);
    setEditingCreatedModule({ ...item.module, settings: { ...item.module.settings } });
    setEditingCreatedExpanded(true);
    publishRepositorySaveFocus({
      kind: "created",
      source: {
        kind: item.kind,
        sourceId: item.sourceId,
        sectionId: item.sectionId,
        moduleId: item.moduleId
      },
      module: { ...item.module, settings: { ...item.module.settings } }
    });
  }

  function cancelEditingCreatedModule() {
    resetCreatedModuleEditing();
    publishRepositorySaveFocus(null);
  }

  function cancelEditing() {
    resetSavedModuleAndCellEditing();
    publishRepositorySaveFocus(null);
  }

  function startEditingSection(sectionRecord: BuilderSavedSectionRecord) {
    resetCreatedModuleEditing();
    resetSavedModuleAndCellEditing();

    const section = cloneSectionForEditing(sectionRecord.section);

    setEditingSectionId(sectionRecord.id);
    setEditingSectionName(sectionRecord.name);
    setEditingSection(section);
    setEditingSectionCollapsed(false);
    setEditingSectionExpandedModuleIds([]);
    publishRepositorySaveFocus({
      kind: "section",
      sectionId: sectionRecord.id,
      name: sectionRecord.name,
      section
    });
  }

  function cancelEditingSection() {
    resetSectionEditing();
    publishRepositorySaveFocus(null);
    setEditingSectionPaletteColumn("");
    setActiveModuleGroup(null);
  }

  function updateEditingModule(moduleId: string, updater: (current: BuilderTemplateModule) => BuilderTemplateModule) {
    setEditingModules((current) => current.map((module) => (module.id === moduleId ? updater(module) : module)));
  }

  function updateEditingCreatedModule(updater: (current: BuilderTemplateModule) => BuilderTemplateModule) {
    setEditingCreatedModule((current) => (current ? updater(current) : current));
  }

  function selectEditingGalleryImage(imagePath: string) {
    if (!editingGalleryTarget) return;

    if (editingGalleryTarget.kind === "created-rich-text") {
      updateEditingCreatedModule((module) => ({
        ...module,
        text: appendRichTextImageToHtml(module.text, normalizeBuilderAssetUrl(imagePath))
      }));
      setEditingGalleryTarget(null);
      setEditingGalleryAnchor(null);
      return;
    }

    if (editingGalleryTarget.kind === "rich-text") {
      updateEditingModule(editingGalleryTarget.moduleId, (module) => ({
        ...module,
        text: appendRichTextImageToHtml(module.text, normalizeBuilderAssetUrl(imagePath))
      }));
      setEditingGalleryTarget(null);
      setEditingGalleryAnchor(null);
      return;
    }

    if (editingGalleryTarget.kind === "created-module") {
      updateEditingCreatedModule((module) => ({
        ...module,
        settings: { ...module.settings, url: normalizeBuilderAssetUrl(imagePath) }
      }));
    } else if (editingGalleryTarget.kind === "created-social-icon") {
      updateEditingCreatedModule((module) => {
        let items: Array<Record<string, unknown>> = [];

        try {
          const parsed = JSON.parse(module.settings.socialItems || "[]");
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }

        return {
          ...module,
          settings: {
            ...module.settings,
            socialItems: JSON.stringify(
              items.map((item, index) => {
                const id = String(item.id || `social-${index + 1}`);
                return id === editingGalleryTarget.itemId
                  ? { ...item, id, iconUrl: normalizeBuilderAssetUrl(imagePath) }
                  : { ...item, id };
              })
            )
          }
        };
      });
    } else if (editingGalleryTarget.kind === "module") {
      updateEditingModule(editingGalleryTarget.moduleId, (module) => ({
        ...module,
        settings: { ...module.settings, url: normalizeBuilderAssetUrl(imagePath) }
      }));
    } else {
      updateEditingModule(editingGalleryTarget.moduleId, (module) => {
        let items: Array<Record<string, unknown>> = [];

        try {
          const parsed = JSON.parse(module.settings.socialItems || "[]");
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }

        return {
          ...module,
          settings: {
            ...module.settings,
            socialItems: JSON.stringify(
              items.map((item, index) => {
                const id = String(item.id || `social-${index + 1}`);
                return id === editingGalleryTarget.itemId
                  ? { ...item, id, iconUrl: normalizeBuilderAssetUrl(imagePath) }
                  : { ...item, id };
              })
            )
          }
        };
      });
    }

    setEditingGalleryTarget(null);
  }

  function updateEditingModuleBackground(
    moduleId: string,
    updater: (background: BackgroundSettings) => BackgroundSettings
  ) {
    updateEditingModule(moduleId, (module) => {
      const background = {
        mode: (module.settings.backgroundMode as BackgroundSettings["mode"]) || "none",
        color: module.settings.backgroundColor || "#ffffff",
        color2: module.settings.backgroundColor2 || "#eaf4ff",
        imageUrl: module.settings.backgroundImageUrl || "",
        styleKey: module.settings.backgroundStyleKey === "blue-yellow-circles" ? "blue-yellow-circles" : ""
      } satisfies BackgroundSettings;
      const next = updater(background);

      return {
        ...module,
        settings: {
          ...module.settings,
          backgroundMode: next.mode,
          backgroundColor: next.color,
          backgroundColor2: next.color2,
          backgroundImageUrl: next.imageUrl,
          backgroundStyleKey: next.styleKey
        }
      };
    });
  }

  function updateEditingCreatedModuleBackground(updater: (background: BackgroundSettings) => BackgroundSettings) {
    updateEditingCreatedModule((module) => {
      const background = {
        mode: (module.settings.backgroundMode as BackgroundSettings["mode"]) || "none",
        color: module.settings.backgroundColor || "#ffffff",
        color2: module.settings.backgroundColor2 || "#eaf4ff",
        imageUrl: module.settings.backgroundImageUrl || "",
        styleKey: module.settings.backgroundStyleKey === "blue-yellow-circles" ? "blue-yellow-circles" : ""
      } satisfies BackgroundSettings;
      const next = updater(background);

      return {
        ...module,
        settings: {
          ...module.settings,
          backgroundMode: next.mode,
          backgroundColor: next.color,
          backgroundColor2: next.color2,
          backgroundImageUrl: next.imageUrl,
          backgroundStyleKey: next.styleKey
        }
      };
    });
  }

  function updateEditingSection(updater: (section: BuilderTemplateSection) => BuilderTemplateSection) {
    setEditingSection((current) => (current ? updater(current) : current));
  }

  function updateEditingSectionModule(
    moduleId: string,
    updater: (current: BuilderTemplateModule) => BuilderTemplateModule
  ) {
    updateEditingSection((section) => ({
      ...section,
      modules: section.modules.map((module) => (module.id === moduleId ? updater(module) : module))
    }));
  }

  function updateEditingSectionModuleBackground(
    moduleId: string,
    updater: (background: BackgroundSettings) => BackgroundSettings
  ) {
    updateEditingSectionModule(moduleId, (module) => {
      const background = {
        mode: (module.settings.backgroundMode as BackgroundSettings["mode"]) || "none",
        color: module.settings.backgroundColor || "#ffffff",
        color2: module.settings.backgroundColor2 || "#eaf4ff",
        imageUrl: module.settings.backgroundImageUrl || "",
        styleKey: module.settings.backgroundStyleKey === "blue-yellow-circles" ? "blue-yellow-circles" : ""
      } satisfies BackgroundSettings;
      const next = updater(background);

      return {
        ...module,
        settings: {
          ...module.settings,
          backgroundMode: next.mode,
          backgroundColor: next.color,
          backgroundColor2: next.color2,
          backgroundImageUrl: next.imageUrl,
          backgroundStyleKey: next.styleKey
        }
      };
    });
  }

  function toggleEditingSectionModuleExpanded(moduleId: string) {
    setEditingSectionExpandedModuleIds((current) =>
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId]
    );
  }

  function updateEditingSectionCellBackground(
    column: string,
    updater: (background: BackgroundSettings) => BackgroundSettings
  ) {
    updateEditingSection((section) => ({
      ...section,
      cellBackgrounds: {
        ...section.cellBackgrounds,
        [column]: updater(section.cellBackgrounds[column] ?? createDefaultBackgroundSettings())
      }
    }));
  }

  function updateEditingSectionCellRecord(key: keyof BuilderTemplateSection, column: string, value: string) {
    updateEditingSection((section) => ({
      ...section,
      [key]: {
        ...((section[key] as Record<string, string>) ?? {}),
        [column]: value
      }
    }));
  }

  function cloneModulesForColumn(modules: BuilderTemplateModule[], column: string) {
    return modules.map((module, index) => ({
      ...module,
      id: `${module.type}-${Date.now()}-${index}`,
      column,
      settings: { ...module.settings }
    }));
  }

  function insertEditingSectionCellModule(column: string, cellModuleId: string, moduleCount: 1 | "many") {
    if (!cellModuleId) return;
    const saved = cellModules.find((candidate) =>
      candidate.id === cellModuleId && (moduleCount === 1 ? candidate.modules.length === 1 : candidate.modules.length !== 1)
    );

    if (!saved) return;

    updateEditingSection((section) => ({
      ...section,
      modules: [...section.modules, ...cloneModulesForColumn(saved.modules, column)]
    }));
  }

  function addEditingSectionModuleFromPalette(column: string, item: ModulePaletteItem) {
    const builderModule = createEmptyModule(item.type, column);

    updateEditingSection((section) => ({
      ...section,
      modules: [
        ...section.modules,
        {
          ...builderModule,
          name: item.name,
          text: item.text,
          settings: { ...builderModule.settings, ...item.settings }
        }
      ]
    }));
    setEditingSectionPaletteColumn("");
    setActiveModuleGroup(null);
  }

  function saveEditingSectionCellModules(column: string) {
    if (!editingSection) return;

    const modules = editingSection.modules.filter((module) => module.column === column);
    if (modules.length === 0) return;

    const fallbackName = `${editingSectionName || editingSection.title || "Saved section"} ${column} cell`;
    const name = window.prompt("Name this saved cell module set", fallbackName)?.trim();
    if (!name) return;

    const moduleClass = window.prompt("Module class (Navigation, Headings, etc.)", "Layout")?.trim();
    if (moduleClass === undefined) return;

    onCreateSavedModule(name, moduleClass, modules);
  }

  function saveEditingSectionModule(moduleId: string) {
    if (!editingSection) {
      return;
    }

    const builderModule = editingSection.modules.find((module) => module.id === moduleId);
    if (!builderModule) {
      return;
    }

    const fallbackName = builderModule.name || builderModule.type;
    const name = window.prompt("Name this saved module", fallbackName)?.trim();
    if (!name) {
      return;
    }

    const moduleClass = window
      .prompt(
        "Module class (Navigation, Headings, etc.)",
        resolveModuleClassForBuilderModule(builderModule) || inferModuleClassFromBuilderModules([builderModule])
      )
      ?.trim();

    if (moduleClass === undefined) {
      return;
    }

    onCreateSavedModule(name, moduleClass, [builderModule]);
  }

  function moveEditingSectionModule(moduleId: string, direction: -1 | 1) {
    updateEditingSection((section) => {
      const index = section.modules.findIndex((module) => module.id === moduleId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= section.modules.length) return section;
      const modules = [...section.modules];
      const [moved] = modules.splice(index, 1);
      modules.splice(target, 0, moved);
      return { ...section, modules };
    });
  }

  function dropEditingSectionModule(
    moduleId: string,
    _sourceSectionId: string,
    _targetSectionId: string,
    targetColumn: string,
    targetBeforeModuleId?: string
  ) {
    updateEditingSection((section) => {
      const sourceModule = section.modules.find((module) => module.id === moduleId);
      if (!sourceModule) return section;
      const movedModule = { ...sourceModule, column: targetColumn };
      const remaining = section.modules.filter((module) => module.id !== moduleId);
      const insertAt = targetBeforeModuleId
        ? Math.max(remaining.findIndex((module) => module.id === targetBeforeModuleId), 0)
        : (() => {
            const lastIndexInColumn = Math.max(
              ...remaining.map((module, index) => (module.column === targetColumn ? index : -1)).filter((index) => index >= 0),
              -1
            );
            return lastIndexInColumn >= 0 ? lastIndexInColumn + 1 : remaining.length;
          })();
      const modules = [...remaining];
      modules.splice(insertAt, 0, movedModule);
      return { ...section, modules };
    });
  }

  function removeEditingSectionModule(moduleId: string) {
    setEditingSectionExpandedModuleIds((current) => current.filter((id) => id !== moduleId));
    updateEditingSection((section) => ({
      ...section,
      modules: section.modules.filter((module) => module.id !== moduleId)
    }));
  }

  function cloneEditingSectionModule(moduleId: string) {
    updateEditingSection((section) => {
      const index = section.modules.findIndex((module) => module.id === moduleId);
      if (index < 0) return section;
      const clone = {
        ...section.modules[index],
        id: `${section.modules[index].type}-${Date.now()}`,
        name: section.modules[index].name ? `${section.modules[index].name} (copy)` : "",
        settings: { ...section.modules[index].settings }
      };
      const modules = [...section.modules];
      modules.splice(index + 1, 0, clone);
      return { ...section, modules };
    });
  }

  function selectEditingSectionGalleryImage(imagePath: string) {
    if (!editingSectionGalleryTarget) return;

    if (editingSectionGalleryTarget.kind === "rich-text") {
      updateEditingSectionModule(editingSectionGalleryTarget.moduleId, (module) => ({
        ...module,
        text: appendRichTextImageToHtml(module.text, normalizeBuilderAssetUrl(imagePath))
      }));
      setEditingSectionGalleryTarget(null);
      setEditingGalleryAnchor(null);
      return;
    }

    if (editingSectionGalleryTarget.kind === "section-background") {
      updateEditingSection((section) => ({
        ...section,
        background: { ...section.background, imageUrl: normalizeBuilderAssetUrl(imagePath), mode: "image" }
      }));
    } else if (editingSectionGalleryTarget.kind === "module") {
      updateEditingSectionModule(editingSectionGalleryTarget.moduleId, (module) => ({
        ...module,
        settings: { ...module.settings, url: normalizeBuilderAssetUrl(imagePath) }
      }));
    } else {
      updateEditingSectionModule(editingSectionGalleryTarget.moduleId, (module) => {
        let items: Array<Record<string, unknown>> = [];

        try {
          const parsed = JSON.parse(module.settings.socialItems || "[]");
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }

        return {
          ...module,
          settings: {
            ...module.settings,
            socialItems: JSON.stringify(
              items.map((item, index) => {
                const id = String(item.id || `social-${index + 1}`);
                return id === editingSectionGalleryTarget.itemId
                  ? { ...item, id, iconUrl: normalizeBuilderAssetUrl(imagePath) }
                  : { ...item, id };
              })
            )
          }
        };
      });
    }

    setEditingSectionGalleryTarget(null);
  }

  return (
    <>
      <datalist id="builder-module-class-options">
        {BUILDER_MODULE_CLASS_OPTIONS.map((moduleClass) => (
          <option key={moduleClass} value={moduleClass} />
        ))}
      </datalist>
      <div className="builder-modules-repository">
      <CreatedModulesTable
        emptyLabel="No modules on pages or templates yet. Add one from Pages → Module Library (for example Speech Bubble)."
        editingCreatedExpanded={editingCreatedExpanded}
        editingCreatedId={editingCreatedId}
        editingCreatedModule={editingCreatedModule}
        isCollapsed={collapsedPanels.createdModules}
        isSaving={isSaving}
        items={createdModules}
        products={products}
        onCancelEditing={cancelEditingCreatedModule}
        onCloneCreatedModule={onCloneCreatedModule}
        onDeleteCreatedModule={onDeleteCreatedModule}
        onOpenEditingCreatedModuleGallery={() => setEditingGalleryTarget({ kind: "created-module" })}
        onOpenEditingCreatedRichTextGallery={(anchor) => {
          setEditingGalleryAnchor(anchor ?? null);
          setEditingGalleryTarget({ kind: "created-rich-text" });
        }}
        onOpenEditingCreatedSocialIconGallery={(itemId) => setEditingGalleryTarget({ kind: "created-social-icon", itemId })}
        onSaveCreatedModule={onSaveCreatedModule}
        onStartEditing={startEditingCreatedModule}
        onToggle={() => togglePanel("createdModules")}
        onToggleEditingCreatedExpanded={() => setEditingCreatedExpanded((current) => !current)}
        onUpdateEditingCreatedModule={updateEditingCreatedModule}
        onUpdateEditingCreatedModuleBackground={updateEditingCreatedModuleBackground}
      />
      <RepositoryTable
        emptyLabel="No saved modules found."
        isCollapsed={collapsedPanels.modules}
        isSaving={isSaving}
        items={savedModules}
        products={products}
        editingId={editingId}
        editingName={editingName}
        editingModuleClass={editingModuleClass}
        editingExpandedModuleIds={editingExpandedModuleIds}
        editingModules={editingModules}
        onDeleteSavedModule={onDeleteSavedModule}
        onCloneSavedModule={onCloneSavedModule}
        onCancelEditing={cancelEditing}
        onSaveSavedModule={onSaveSavedModule}
        onSetEditingName={setEditingName}
        onSetEditingModuleClass={setEditingModuleClass}
        onStartEditing={startEditing}
        onToggle={() => togglePanel("modules")}
        onToggleEditingModuleExpanded={toggleEditingModuleExpanded}
        onOpenEditingModuleGallery={(moduleId) => setEditingGalleryTarget({ kind: "module", moduleId })}
        onOpenEditingRichTextGallery={(moduleId, anchor) => {
          setEditingGalleryAnchor(anchor ?? null);
          setEditingGalleryTarget({ kind: "rich-text", moduleId });
        }}
        onOpenEditingSocialIconGallery={(moduleId, itemId) =>
          setEditingGalleryTarget({ kind: "social-icon", moduleId, itemId })
        }
        onUpdateEditingModule={updateEditingModule}
        onUpdateEditingModuleBackground={updateEditingModuleBackground}
        title="Saved Modules"
      />
      <RepositoryTable
        emptyLabel="No saved cells found."
        isCollapsed={collapsedPanels.cells}
        isSaving={isSaving}
        items={savedCells}
        products={products}
        editingId={editingId}
        editingName={editingName}
        editingModuleClass={editingModuleClass}
        editingExpandedModuleIds={editingExpandedModuleIds}
        editingModules={editingModules}
        onDeleteSavedModule={onDeleteSavedModule}
        onCloneSavedModule={onCloneSavedModule}
        onCancelEditing={cancelEditing}
        onSaveSavedModule={onSaveSavedModule}
        onSetEditingName={setEditingName}
        onSetEditingModuleClass={setEditingModuleClass}
        onStartEditing={startEditing}
        onToggle={() => togglePanel("cells")}
        onToggleEditingModuleExpanded={toggleEditingModuleExpanded}
        onOpenEditingModuleGallery={(moduleId) => setEditingGalleryTarget({ kind: "module", moduleId })}
        onOpenEditingRichTextGallery={(moduleId, anchor) => {
          setEditingGalleryAnchor(anchor ?? null);
          setEditingGalleryTarget({ kind: "rich-text", moduleId });
        }}
        onOpenEditingSocialIconGallery={(moduleId, itemId) =>
          setEditingGalleryTarget({ kind: "social-icon", moduleId, itemId })
        }
        onUpdateEditingModule={updateEditingModule}
        onUpdateEditingModuleBackground={updateEditingModuleBackground}
        title="Saved Cells"
      />
      <SavedSectionsTable
        cellModules={cellModules}
        editingSection={editingSection}
        editingSectionCollapsed={editingSectionCollapsed}
        editingSectionExpandedModuleIds={editingSectionExpandedModuleIds}
        editingSectionId={editingSectionId}
        editingSectionName={editingSectionName}
        isCollapsed={collapsedPanels.sections}
        isSaving={isSaving}
        products={products}
        savedSections={savedSections}
        onCancelEditingSection={cancelEditingSection}
        onCloneEditingSectionModule={cloneEditingSectionModule}
        onDeleteSavedSection={onDeleteSavedSection}
        onDropEditingSectionModule={dropEditingSectionModule}
        onInsertEditingSectionCellModule={insertEditingSectionCellModule}
        onMoveEditingSectionModule={moveEditingSectionModule}
        onOpenEditingSectionBackgroundGallery={() => setEditingSectionGalleryTarget({ kind: "section-background" })}
        onOpenEditingSectionModuleGallery={(moduleId) => setEditingSectionGalleryTarget({ kind: "module", moduleId })}
        onOpenEditingSectionRichTextGallery={(moduleId, anchor) => {
          setEditingGalleryAnchor(anchor ?? null);
          setEditingSectionGalleryTarget({ kind: "rich-text", moduleId });
        }}
        onOpenEditingSectionModulePalette={(column, anchor) => {
          setEditingSectionPaletteColumn(column);
          setEditingSectionPaletteAnchor(anchor ?? null);
        }}
        onOpenEditingSectionSocialIconGallery={(moduleId, itemId) =>
          setEditingSectionGalleryTarget({ kind: "social-icon", moduleId, itemId })
        }
        onRemoveEditingSectionModule={removeEditingSectionModule}
        onSaveEditingSectionCellModules={saveEditingSectionCellModules}
        onSaveEditingSectionModule={saveEditingSectionModule}
        onSaveSavedSection={onSaveSavedSection}
        onSetEditingSectionName={setEditingSectionName}
        onStartEditingSection={startEditingSection}
        onToggle={() => togglePanel("sections")}
        onToggleEditingSectionCollapsed={() => setEditingSectionCollapsed((current) => !current)}
        onToggleEditingSectionModuleExpanded={toggleEditingSectionModuleExpanded}
        onUpdateEditingSection={updateEditingSection}
        onUpdateEditingSectionCellBackground={updateEditingSectionCellBackground}
        onUpdateEditingSectionCellRecord={updateEditingSectionCellRecord}
        onUpdateEditingSectionModule={updateEditingSectionModule}
        onUpdateEditingSectionModuleBackground={updateEditingSectionModuleBackground}
      />
      </div>
      {editingGalleryTarget ? (
        <BuilderGalleryModal
          anchor={
            editingGalleryTarget.kind === "rich-text" || editingGalleryTarget.kind === "created-rich-text"
              ? editingGalleryAnchor
              : null
          }
          isUploading={isUploadingMedia}
          onSelectImage={selectEditingGalleryImage}
          onClose={() => {
            setEditingGalleryTarget(null);
            setEditingGalleryAnchor(null);
          }}
        />
      ) : null}
      {editingSectionGalleryTarget ? (
        <BuilderGalleryModal
          anchor={editingSectionGalleryTarget.kind === "rich-text" ? editingGalleryAnchor : null}
          isUploading={isUploadingMedia}
          onSelectImage={selectEditingSectionGalleryImage}
          onClose={() => {
            setEditingSectionGalleryTarget(null);
            setEditingGalleryAnchor(null);
          }}
        />
      ) : null}
      {editingSectionPaletteColumn ? (
        <BuilderModulePaletteModal
          activeGroup={activeModuleGroup}
          anchor={editingSectionPaletteAnchor}
          cellModules={cellModules}
          onClose={() => {
            setEditingSectionPaletteColumn("");
            setEditingSectionPaletteAnchor(null);
            setActiveModuleGroup(null);
          }}
          onSelectItem={(item) => addEditingSectionModuleFromPalette(editingSectionPaletteColumn, item)}
          onSelectSavedModule={(cellModuleId) => {
            insertEditingSectionCellModule(editingSectionPaletteColumn, cellModuleId, 1);
            setEditingSectionPaletteColumn("");
            setActiveModuleGroup(null);
          }}
          onSelectGroup={setActiveModuleGroup}
        />
      ) : null}
    </>
  );
}
