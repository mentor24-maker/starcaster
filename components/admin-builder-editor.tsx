"use client";

import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminMediaItem } from "@/lib/admin-media";
import {
  BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
  BUILDER_PREVIEW_STORAGE_KEY,
  createDefaultBackgroundSettings,
  createDefaultTheme,
  createEmptyModule,
  createEmptySection,
  getLayoutColumns,
  getLayoutGridTemplate,
  normalizeBuilderAssetUrl,
  type BackgroundSettings,
  type BuilderCellModuleRecord,
  type BuilderPageRecord,
  type BuilderPageSnapshotSummary,
  type BuilderProductRecord,
  type BuilderSavedSectionRecord,
  type BuilderTemplateKind,
  type BuilderTemplateLayout,
  type BuilderTemplateModule,
  type BuilderTemplateRecord,
  type BuilderTemplateSection,
  type BuilderTheme,
  type BuilderThemeSummary
} from "@/lib/builder-template";
import { getDefaultEmailTemplateName, type BuilderEmailFunction } from "@/lib/builder-email-template";
import { inferModuleClassFromBuilderModules, resolveModuleClassForBuilderModule } from "@/lib/module-class-triggers";

import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { appendRichTextImageToHtml } from "@/lib/rich-text-image";
import type { GalleryTarget, ModulePaletteGroup, ModulePaletteItem } from "./builder/builder-types";
import { layoutOptions } from "./builder/builder-types";
import {
  buildClonedPageCreatePayload,
  createDraftFromTemplate,
  createDraftFromPage,
  getModuleBackgroundSettings,
  getThemeRootVars
} from "./builder/builder-utils";
import { BuilderTemplateList } from "./builder/builder-template-list";
import { BuilderPageList } from "./builder/builder-page-list";
import { BuilderBulkCreate, type BulkCreateResult, type AcquireRunSummary, type ExtractionPreviewItem } from "./builder/builder-bulk-create";
import {
  BuilderModuleRepositoryList,
  type BuilderModuleEditorFocus,
  type CreatedModuleSource
} from "./builder/builder-module-repository-list";
import { BuilderCollapseIcon } from "./builder/builder-collapse-icon";
import {
  BuilderFloatingSaveRail,
  type BuilderFloatingSaveAction
} from "./builder/builder-floating-save-rail";
import { BuilderSaveDebugPanel } from "./builder/builder-save-debug-panel";
import { BuilderSectionCard } from "./builder/builder-section-card";
import { BuilderGalleryModal } from "./builder/builder-gallery-modal";
import {
  BuilderModulePaletteModal,
  type ModulePaletteAnchor
} from "./builder/builder-module-palette-modal";
import { AdminLegacyRemindersImportPanel } from "@/components/admin-legacy-reminders-import-panel";

type AdminApiPayload = {
  error?: string;
};

async function readAdminJson<T extends AdminApiPayload>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      `${fallbackMessage} ${response.url || "Request"} returned ${response.status} ${response.statusText || "non-JSON"}: ${preview || "No response body."}`
    );
  }

  const data = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(data.error ?? fallbackMessage);
  }

  return data;
}

type AdminBuilderEditorProps = {
  /** Mode to open in when the editor is mounted to edit a specific record (page/template). */
  initialMode?: "templates" | "modules" | "pages";
  /** Id of the page (initialMode "pages") or template (initialMode "templates") to preselect on mount. */
  initialRecordId?: string;
  /** When true, open Page Details immediately (used when the editor is mounted to create a new page). */
  autoNewPage?: boolean;
};

export function AdminBuilderEditor({ initialMode, initialRecordId, autoNewPage }: AdminBuilderEditorProps = {}) {
  const [builderMode, setBuilderMode] = useState<"templates" | "modules" | "pages">(initialMode ?? "templates");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pageTemplates, setPageTemplates] = useState<BuilderTemplateRecord[]>([]);
  const [acquireRuns, setAcquireRuns] = useState<AcquireRunSummary[]>([]);
  const [builderThemes, setBuilderThemes] = useState<BuilderThemeSummary[]>([]);
  const [pageThemeId, setPageThemeId] = useState("");
  const [pages, setPages] = useState<BuilderPageRecord[]>([]);
  const [cellModules, setCellModules] = useState<BuilderCellModuleRecord[]>([]);
  const [savedSections, setSavedSections] = useState<BuilderSavedSectionRecord[]>([]);
  const [products, setProducts] = useState<BuilderProductRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [pageSlug, setPageSlug] = useState("");
  const [pageTemplateId, setPageTemplateId] = useState("");
  const [pageIsPrivate, setPageIsPrivate] = useState(false);
  const [draft, setDraft] = useState(createDraftFromTemplate(null));
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<string[]>([]);
  const [expandedModuleIds, setExpandedModuleIds] = useState<string[]>([]);
  const [pageEditorFocused, setPageEditorFocused] = useState(false);
  const [templateEditorFocused, setTemplateEditorFocused] = useState(false);
  const [repositorySaveFocus, setRepositorySaveFocus] = useState<BuilderModuleEditorFocus | null>(null);
  const [repositorySaveActive, setRepositorySaveActive] = useState(false);
  const repositorySaveRef = useRef<BuilderModuleEditorFocus | null>(null);
  const hydratedPageSelectionRef = useRef("");
  const hydratedTemplateSelectionRef = useRef("");
  const [galleryMedia, setGalleryMedia] = useState<AdminMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dragOverWorkspace, setDragOverWorkspace] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isModulePaletteOpen, setIsModulePaletteOpen] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState<GalleryTarget | null>(null);
  const [galleryAnchor, setGalleryAnchor] = useState<BuilderModalAnchor | null>(null);
  const [modulePaletteTarget, setModulePaletteTarget] = useState<{ sectionId: string; column: string } | null>(null);
  const [modulePaletteAnchor, setModulePaletteAnchor] = useState<ModulePaletteAnchor | null>(null);
  const [activeModuleGroup, setActiveModuleGroup] = useState<ModulePaletteGroup | null>(null);
  const [collapsedBuilderPanels, setCollapsedBuilderPanels] = useState({
    rowConfigurations: true,
    // Reveal the workspace immediately when we mount to edit a specific record;
    // otherwise the page's sections stay hidden behind a collapsed panel.
    workspace: !initialRecordId
  });
  const appliedInitialSelectionRef = useRef(false);
  const [savedSectionSelectKey, setSavedSectionSelectKey] = useState(0);
  const [insertCanonical, setInsertCanonical] = useState(true);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [snapshots, setSnapshots] = useState<BuilderPageSnapshotSummary[]>([]);
  const [activeArchive, setActiveArchive] = useState<{ id: string; label: string; createdAt: string; pages: BuilderPageRecord[] } | null>(null);
  const [isSnapshoting, setIsSnapshoting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // --- Derived values ---

  const pageLayoutTemplates = useMemo(
    () => pageTemplates.filter((template) => template.templateKind !== "email"),
    [pageTemplates]
  );
  const isEmailTemplateDraft = builderMode === "templates" && draft.templateKind === "email";

  // Palette swatches for the RTE toolbar: use the active theme's palette colors.
  // Falls back to the first available theme so swatches always appear when a single theme
  // is loaded (theme_id column may not be persisted yet if migration hasn't run).
  const activeTheme = pageThemeId
    ? builderThemes.find((t) => t.id === pageThemeId) ?? builderThemes[0] ?? null
    : builderThemes[0] ?? null;
  const rteThemeColors = [
    { label: "Primary", hex: activeTheme?.primaryColor ?? "" },
    { label: "Secondary", hex: activeTheme?.secondaryColor ?? "" },
    { label: "Background", hex: activeTheme?.backgroundColor ?? "" },
    { label: "Accent", hex: activeTheme?.accentColor ?? "" },
    { label: "Body text", hex: draft.theme.typography.colors.text },
    { label: "Headings", hex: draft.theme.typography.colors.heading },
    { label: "Link", hex: draft.theme.typography.colors.link },
  ].filter((c) => Boolean(c.hex));

  // --- Data loading ---

  async function loadPageTemplates() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await builderAdminFetch("/api/admin/page-templates", { cache: "no-store" });
      const data = await readAdminJson<{ pageTemplates?: BuilderTemplateRecord[]; error?: string }>(response, "Failed to load page templates.");
      const templates = data.pageTemplates ?? [];
      setPageTemplates(templates);
      if (selectedTemplateId && !templates.some((t) => t.id === selectedTemplateId)) {
        setSelectedTemplateId(templates[0]?.id ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load page templates.");
      setPageTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAcquireRuns() {
    try {
      const response = await builderAdminFetch("/api/admin/acquire-runs", { cache: "no-store" });
      const data = await readAdminJson<{ runs?: AcquireRunSummary[]; error?: string }>(response, "Failed to load crawl runs.");
      setAcquireRuns(data.runs ?? []);
    } catch {
      setAcquireRuns([]);
    }
  }

  async function loadDevelopThemes() {
    try {
      const response = await builderAdminFetch("/api/admin/themes", { cache: "no-store" });
      const data = await readAdminJson<{ themes?: BuilderThemeSummary[]; error?: string }>(response, "Failed to load themes.");
      setBuilderThemes(data.themes ?? []);
    } catch {
      setBuilderThemes([]);
    }
  }

  async function loadPages() {
    try {
      const response = await builderAdminFetch("/api/admin/pages", { cache: "no-store" });
      const data = await readAdminJson<{ pages?: BuilderPageRecord[]; error?: string }>(response, "Failed to load pages.");
      const nextPages = data.pages ?? [];
      setPages(nextPages);
      if (!nextPages.some((p) => p.id === selectedPageId)) setSelectedPageId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pages.");
      setPages([]);
    }
  }

  async function loadSnapshots() {
    try {
      const response = await builderAdminFetch("/api/admin/page-snapshots", { cache: "no-store" });
      const data = await readAdminJson<{ snapshots?: BuilderPageSnapshotSummary[]; error?: string }>(response, "Failed to load snapshots.");
      setSnapshots(data.snapshots ?? []);
    } catch {
      setSnapshots([]);
    }
  }

  async function archivePages(pageIds: string[]) {
    if (!pageIds.length) return;
    setIsSnapshoting(true);
    try {
      const selectedPages = pages.filter((p) => pageIds.includes(p.id));
      const label = new Date().toLocaleString();
      const response = await builderAdminFetch("/api/admin/page-snapshots", {
        method: "POST",
        body: JSON.stringify({ label, pages: selectedPages }),
      });
      await readAdminJson<{ snapshot?: BuilderPageSnapshotSummary; error?: string }>(response, "Failed to archive pages.");
      await loadSnapshots();
      setMessage(`Archived ${selectedPages.length} page(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive pages.");
    } finally {
      setIsSnapshoting(false);
    }
  }

  async function loadArchive(snapshotId: string) {
    try {
      const response = await builderAdminFetch(`/api/admin/page-snapshots/${snapshotId}`, { cache: "no-store" });
      const data = await readAdminJson<{ id?: string; label?: string; createdAt?: string; pages?: BuilderPageRecord[]; error?: string }>(response, "Failed to load archive.");
      setActiveArchive({
        id: String(data.id ?? snapshotId),
        label: String(data.label ?? ""),
        createdAt: String(data.createdAt ?? ""),
        pages: Array.isArray(data.pages) ? data.pages : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load archive.");
    }
  }

  async function restoreArchive(snapshotId: string) {
    if (!window.confirm("Restore this archive? Current page content will be overwritten.")) return;
    setIsRestoring(true);
    try {
      const response = await builderAdminFetch(`/api/admin/page-snapshots/${snapshotId}/restore`, { method: "POST" });
      const data = await readAdminJson<{ restored?: number; failed?: number; error?: string }>(response, "Failed to restore archive.");
      await loadPages();
      setMessage(`Restored ${data.restored ?? 0} page(s)${data.failed ? `, ${data.failed} failed` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore archive.");
    } finally {
      setIsRestoring(false);
    }
  }

  async function deleteSnapshot(snapshotId: string) {
    try {
      const response = await builderAdminFetch(`/api/admin/page-snapshots/${snapshotId}`, { method: "DELETE" });
      await readAdminJson<{ snapshot?: BuilderPageSnapshotSummary; error?: string }>(response, "Failed to delete archive.");
      setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
      setActiveArchive((prev) => (prev?.id === snapshotId ? null : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete archive.");
    }
  }

  async function loadCellModules() {
    try {
      const response = await builderAdminFetch("/api/admin/cell-modules", { cache: "no-store" });
      const data = await readAdminJson<{ cellModules?: BuilderCellModuleRecord[]; error?: string }>(response, "Failed to load saved cell modules.");
      setCellModules(data.cellModules ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load saved cell modules.";
      if (!message.includes("builder_cell_modules")) {
        setError(message);
      }
      setCellModules([]);
    }
  }

  async function loadSavedSections() {
    try {
      const response = await builderAdminFetch("/api/admin/saved-sections", { cache: "no-store" });
      const data = await readAdminJson<{ savedSections?: BuilderSavedSectionRecord[]; error?: string }>(response, "Failed to load saved sections.");
      setSavedSections(data.savedSections ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load saved sections.";
      if (!message.includes("builder_saved_sections")) {
        setError(message);
      }
      setSavedSections([]);
    }
  }

  async function loadProducts() {
    try {
      const response = await builderAdminFetch("/api/admin/products", { cache: "no-store" });
      const data = await readAdminJson<{ products?: BuilderProductRecord[]; error?: string }>(response, "Failed to load products.");
      setProducts(data.products ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load products.";
      if (!message.includes("products")) {
        setError(message);
      }
      setProducts([]);
    }
  }

  useEffect(() => { void loadPageTemplates(); void loadPages(); void loadCellModules(); void loadSavedSections(); void loadProducts(); void loadAcquireRuns(); void loadDevelopThemes(); void loadSnapshots(); }, []);

  // When the linked theme finishes loading, refresh the page's typography from the latest
  // theme data so changes made in the Themes editor (link underline, fonts, etc.) are
  // reflected without the user having to manually re-apply the theme.
  useEffect(() => {
    if (!pageThemeId || builderThemes.length === 0) return;
    const found = builderThemes.find((t) => t.id === pageThemeId);
    if (found?.typography) {
      setDraft((c) => ({ ...c, theme: { ...c.theme, typography: found.typography! } }));
    }
  }, [pageThemeId, builderThemes]);

  useEffect(() => {
    const handler = () => setShowBulkCreate(true);
    window.addEventListener("builder:openBulkCreate", handler);
    return () => window.removeEventListener("builder:openBulkCreate", handler);
  }, []);

  useEffect(() => {
    async function loadMediaLibrary() {
      try {
        const response = await builderAdminFetch("/api/admin/media", { cache: "no-store" });
        const data = await readAdminJson<{ media?: AdminMediaItem[]; error?: string }>(response, "Failed to load media gallery.");
        setGalleryMedia(data.media ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load media gallery.");
      }
    }
    void loadMediaLibrary();
  }, []);

  useEffect(() => {
    if (builderMode !== "templates") {
      return;
    }

    if (!selectedTemplateId) {
      return;
    }

    const template = pageTemplates.find((template) => template.id === selectedTemplateId) ?? null;

    if (!template) {
      return;
    }

    if (hydratedTemplateSelectionRef.current === selectedTemplateId) {
      return;
    }

    hydratedTemplateSelectionRef.current = selectedTemplateId;
    setDraft(createDraftFromTemplate(template));
    setCollapsedSectionIds(template.layoutSections.map((section) => section.id));
  }, [builderMode, selectedTemplateId, pageTemplates]);

  useEffect(() => {
    if (builderMode !== "pages") {
      return;
    }

    const selectionKey = selectedPageId || "__new__";
    const page = selectedPageId ? pages.find((entry) => entry.id === selectedPageId) ?? null : null;

    if (selectedPageId && !page) {
      return;
    }

    if (hydratedPageSelectionRef.current === selectionKey) {
      return;
    }

    hydratedPageSelectionRef.current = selectionKey;
    setDraft(createDraftFromPage(page));
    setPageSlug(page?.slug ?? "");
    setPageTemplateId(page?.templateId ?? "");
    setPageThemeId(page?.themeId ?? "");
    setPageIsPrivate(page?.isPrivate ?? false);
    setCollapsedSectionIds(page?.layoutSections.map((section) => section.id) ?? []);
  }, [builderMode, selectedPageId, pages]);

  // When mounted to edit a specific record (e.g. the legacy "Edit Page" action
  // mounts this island with a record), preselect it once its list has loaded so
  // the editor opens on that page/template instead of the empty default view.
  useEffect(() => {
    if (appliedInitialSelectionRef.current || !initialRecordId) {
      return;
    }

    if (initialMode === "pages") {
      const match = pages.find((entry) => String(entry.id) === String(initialRecordId));
      if (!match) return;
      appliedInitialSelectionRef.current = true;
      setSelectedPageId(match.id);
      return;
    }

    if (initialMode === "templates") {
      const match = pageTemplates.find((entry) => String(entry.id) === String(initialRecordId));
      if (!match) return;
      appliedInitialSelectionRef.current = true;
      setSelectedTemplateId(match.id);
    }
  }, [initialMode, initialRecordId, pages, pageTemplates]);

  useEffect(() => {
    if (builderMode !== "pages") {
      setPageEditorFocused(false);
    }

    if (builderMode !== "templates") {
      setTemplateEditorFocused(false);
    }

    if (builderMode !== "modules") {
      setRepositorySaveFocus(null);
      setRepositorySaveActive(false);
      repositorySaveRef.current = null;
    }
  }, [builderMode]);

  useEffect(() => {
    if (builderMode === "pages" && selectedPageId) {
      setPageEditorFocused(true);
    }
  }, [builderMode, selectedPageId]);

  useEffect(() => {
    if (builderMode === "templates" && selectedTemplateId) {
      setTemplateEditorFocused(true);
    }
  }, [builderMode, selectedTemplateId]);

  useEffect(() => {
    setCollapsedSectionIds((c) => c.filter((id) => draft.layoutSections.some((s) => s.id === id)));
  }, [draft.layoutSections]);

  useEffect(() => {
    setExpandedModuleIds((c) =>
      c.filter((id) => draft.layoutSections.some((s) => s.modules.some((m) => m.id === id)))
    );
  }, [draft.layoutSections]);

  // --- Draft mutations ---

  function setDraftName(name: string) {
    setDraft((c) => ({ ...c, name }));
  }

  function setTemplateKind(templateKind: BuilderTemplateKind) {
    setDraft((c) => {
      const emailFunction = templateKind === "email" ? c.emailFunction || "signup_confirmation" : "";
      const nextName =
        templateKind === "email" && !c.name.trim()
          ? getDefaultEmailTemplateName(emailFunction)
          : c.name;

      return {
        ...c,
        templateKind,
        emailFunction,
        name: nextName
      };
    });
  }

  function setEmailFunction(emailFunction: BuilderEmailFunction | "") {
    setDraft((c) => ({
      ...c,
      emailFunction,
      name:
        c.templateKind === "email" && !c.name.trim()
          ? getDefaultEmailTemplateName(emailFunction)
          : c.name
    }));
  }

  function toggleBuilderPanel(panel: keyof typeof collapsedBuilderPanels) {
    setCollapsedBuilderPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function updatePageBackground(updater: (bg: BackgroundSettings) => BackgroundSettings) {
    setDraft((c) => ({ ...c, pageBackground: updater(c.pageBackground) }));
  }

  function updateTheme(updater: (theme: BuilderTheme) => BuilderTheme) {
    setDraft((c) => ({ ...c, theme: updater(c.theme) }));
  }

  function updateSection(sectionId: string, updater: (s: BuilderTemplateSection) => BuilderTemplateSection) {
    setDraft((c) => ({
      ...c,
      layoutSections: c.layoutSections.map((s) => (s.id === sectionId ? updater(s) : s))
    }));
  }

  function updateCellBackground(sectionId: string, column: string, updater: (bg: BackgroundSettings) => BackgroundSettings) {
    updateSection(sectionId, (s) => ({
      ...s,
      cellBackgrounds: { ...s.cellBackgrounds, [column]: updater(s.cellBackgrounds[column] ?? createDefaultBackgroundSettings()) }
    }));
  }

  function updateCellPadding(sectionId: string, column: string, value: string) {
    updateSection(sectionId, (s) => ({
      ...s,
      cellPadding: { ...s.cellPadding, [column]: value }
    }));
  }

  function updateCellBorderWidth(sectionId: string, column: string, value: string) {
    updateSection(sectionId, (s) => ({
      ...s,
      cellBorderWidth: { ...s.cellBorderWidth, [column]: value }
    }));
  }

  function updateCellBorderColor(sectionId: string, column: string, value: string) {
    updateSection(sectionId, (s) => ({
      ...s,
      cellBorderColor: { ...s.cellBorderColor, [column]: value }
    }));
  }

  function updateCellBorderRadius(sectionId: string, column: string, value: string) {
    updateSection(sectionId, (s) => ({
      ...s,
      cellBorderRadius: { ...s.cellBorderRadius, [column]: value }
    }));
  }

  function updateModule(sectionId: string, moduleId: string, updater: (m: BuilderTemplateModule) => BuilderTemplateModule) {
    updateSection(sectionId, (s) => ({
      ...s,
      modules: s.modules.map((m) => (m.id === moduleId ? updater(m) : m))
    }));
  }

  function updateModuleBackground(sectionId: string, moduleId: string, updater: (bg: BackgroundSettings) => BackgroundSettings) {
    updateModule(sectionId, moduleId, (current) => {
      const next = updater(getModuleBackgroundSettings(current.settings));
      const isClear = next.mode === "none";

      return {
        ...current,
        settings: {
          ...current.settings,
          backgroundMode: next.mode,
          backgroundColor: isClear ? "" : next.color,
          backgroundColor2: isClear ? "" : next.color2,
          backgroundImageUrl: isClear ? "" : next.imageUrl,
          backgroundStyleKey: isClear ? "" : next.styleKey
        }
      };
    });
  }

  function addSection(layout: BuilderTemplateLayout) {
    const newSection = createEmptySection(layout);
    setDraft((c) => ({ ...c, layoutSections: [...c.layoutSections, newSection] }));
    setCollapsedSectionIds((c) => [...c, newSection.id]);
  }

  function removeSection(sectionId: string) {
    setDraft((c) => ({ ...c, layoutSections: c.layoutSections.filter((s) => s.id !== sectionId) }));
  }

  function cloneSection(sectionId: string) {
    setDraft((c) => {
      const idx = c.layoutSections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return c;
      const source = c.layoutSections[idx];
      const cloned = {
        ...source,
        id: crypto.randomUUID(),
        modules: source.modules.map((m) => ({ ...m, id: crypto.randomUUID() }))
      };
      const arr = [...c.layoutSections];
      arr.splice(idx + 1, 0, cloned);
      return { ...c, layoutSections: arr };
    });
  }

  function cloneSavedSection(source: BuilderTemplateSection): BuilderTemplateSection {
    return {
      ...source,
      id: crypto.randomUUID(),
      modules: source.modules.map((module) => ({
        ...module,
        id: crypto.randomUUID(),
        settings: { ...module.settings }
      }))
    };
  }

  function insertSavedSection(savedSectionId: string) {
    if (!savedSectionId) return;

    const savedSection = savedSections.find((candidate) => candidate.id === savedSectionId);
    if (!savedSection) return;

    let section: BuilderTemplateSection;
    if (insertCanonical) {
      // Keep master's module IDs so we can detect local drift later.
      section = {
        ...savedSection.section,
        id: crypto.randomUUID(),
        savedSectionId: savedSection.id,
        canonical: true,
        background: { ...savedSection.section.background },
        modules: savedSection.section.modules.map((m) => ({ ...m, settings: { ...m.settings } }))
      };
    } else {
      section = { ...cloneSavedSection(savedSection.section), savedSectionId: savedSection.id, canonical: false };
    }

    setDraft((current) => ({ ...current, layoutSections: [...current.layoutSections, section] }));
    setCollapsedSectionIds((current) => [...current, section.id]);
    setMessage(`Inserted saved section "${savedSection.name}"${insertCanonical ? " (canonical)" : ""}.`);
    setError(null);
    setSavedSectionSelectKey((current) => current + 1);
  }

  function handleSavedSectionSelect(event: ChangeEvent<HTMLSelectElement>) {
    insertSavedSection(event.target.value);
  }

  async function saveSection(sectionId: string) {
    const section = draft.layoutSections.find((candidate) => candidate.id === sectionId);

    if (!section) {
      return;
    }

    const fallbackName = section.title || `${draft.name || "Untitled"} section`;
    const name = window.prompt("Name this saved section", fallbackName)?.trim();

    if (!name) {
      return;
    }

    try {
      const response = await builderAdminFetch("/api/admin/saved-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          section
        })
      });
      const data = await readAdminJson<{ savedSection?: BuilderSavedSectionRecord; error?: string }>(response, "Failed to save section.");

      if (!data.savedSection) {
        throw new Error(data.error ?? "Failed to save section.");
      }

      setSavedSections((current) => [data.savedSection!, ...current]);
      setMessage(`Saved "${data.savedSection.name}" to the section repository.`);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save section.");
    }
  }

  function getSectionContent(section: BuilderTemplateSection) {
    const { id, savedSectionId, canonical, ...content } = section as BuilderTemplateSection & { savedSectionId?: string; canonical?: boolean };
    return content;
  }

  async function handleToggleSectionCanonical(sectionId: string, checked: boolean) {
    const section = draft.layoutSections.find((s) => s.id === sectionId);
    if (!section) return;

    if (!checked) {
      updateSection(sectionId, (s) => ({ ...s, canonical: false }));
      return;
    }

    const savedSectionId = (section as BuilderTemplateSection & { savedSectionId?: string }).savedSectionId;
    if (!savedSectionId) return;

    const master = savedSections.find((ss) => ss.id === savedSectionId);
    if (!master) {
      alert("The original saved section was deleted. Cannot relink.");
      updateSection(sectionId, (s) => ({ ...s, canonical: false, savedSectionId: undefined } as BuilderTemplateSection));
      return;
    }

    const localJson = JSON.stringify(getSectionContent(section));
    const masterJson = JSON.stringify(getSectionContent(master.section));

    if (localJson === masterJson) {
      updateSection(sectionId, (s) => ({ ...s, canonical: true }));
      return;
    }

    const saveAsNew = window.confirm(
      `This section has local changes.\n\nClick OK to save your local changes as a new saved section, then revert to canonical.\nClick Cancel to discard local changes and revert to canonical.`
    );

    if (saveAsNew) {
      const name = window.prompt("Name for the new saved section:", section.title || `${master.name} (copy)`)?.trim();
      if (!name) return;

      try {
        const response = await builderAdminFetch("/api/admin/saved-sections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, section: getSectionContent(section) })
        });
        const data = await readAdminJson<{ savedSection?: BuilderSavedSectionRecord; error?: string }>(response, "Failed to save section.");
        if (data.savedSection) {
          setSavedSections((current) => [data.savedSection!, ...current]);
        }
      } catch {
        setError("Could not save local changes as new section.");
        return;
      }
    }

    // Revert this instance to the master and mark canonical.
    const reverted = {
      ...master.section,
      id: section.id,
      savedSectionId,
      canonical: true,
      background: { ...master.section.background },
      modules: master.section.modules.map((m) => ({ ...m, settings: { ...m.settings } }))
    };
    updateSection(sectionId, () => reverted);
    setMessage(saveAsNew ? `Saved local changes and relinked to canonical.` : `Local changes discarded. Relinked to canonical.`);
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    setDraft((c) => {
      const idx = c.layoutSections.findIndex((s) => s.id === sectionId);
      const next = idx + direction;
      if (idx < 0 || next < 0 || next >= c.layoutSections.length) return c;
      const arr = [...c.layoutSections];
      const [item] = arr.splice(idx, 1);
      arr.splice(next, 0, item);
      return { ...c, layoutSections: arr };
    });
  }

  function toggleSectionCollapsed(sectionId: string) {
    setCollapsedSectionIds((c) =>
      c.includes(sectionId) ? c.filter((id) => id !== sectionId) : [...c, sectionId]
    );
  }

  function addModuleFromPalette(sectionId: string, column: string, item: ModulePaletteItem) {
    const mod = createEmptyModule(item.type, column);
    updateSection(sectionId, (s) => ({
      ...s,
      modules: [...s.modules, { ...mod, name: item.name, text: item.text, settings: { ...mod.settings, ...item.settings } }]
    }));
  }

  function cloneModulesForColumn(modules: BuilderTemplateModule[], column: string, savedModuleId?: string) {
    return modules.map((module, index) => ({
      ...module,
      id: `${module.type}-${Date.now()}-${index}`,
      column,
      settings: { ...module.settings },
      ...(savedModuleId ? { savedModuleId } : {})
    }));
  }

  function promptForModuleClass(fallbackClass = "") {
    const moduleClass = window.prompt("Module class (Navigation, Headings, etc.)", fallbackClass)?.trim();
    return moduleClass ?? null;
  }

  async function saveCellModules(sectionId: string, column: string) {
    const section = draft.layoutSections.find((candidate) => candidate.id === sectionId);
    const modules = section?.modules.filter((module) => module.column === column) ?? [];

    if (modules.length === 0) {
      setError("Cell has no modules to save.");
      return;
    }

    const fallbackName = `${draft.name || "Untitled"} ${column} cell`;
    const name = window.prompt("Name this saved cell module set", fallbackName)?.trim();

    if (!name) {
      return;
    }

    const moduleClass = promptForModuleClass("Layout");
    if (moduleClass === null) {
      return;
    }

    try {
      const response = await builderAdminFetch("/api/admin/cell-modules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          moduleClass,
          modules
        })
      });
      const data = await readAdminJson<{ cellModule?: BuilderCellModuleRecord; error?: string }>(response, "Failed to save cell module.");

      if (!data.cellModule) {
        throw new Error(data.error ?? "Failed to save cell module.");
      }

      setCellModules((current) => [data.cellModule!, ...current]);
      setMessage(`Saved "${data.cellModule.name}" to the module repository.`);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save cell module.");
    }
  }

  function insertCellModule(sectionId: string, column: string, cellModuleId: string) {
    if (!cellModuleId) {
      return;
    }

    const saved = cellModules.find((candidate) => candidate.id === cellModuleId && candidate.modules.length !== 1);

    if (!saved) {
      return;
    }

    updateSection(sectionId, (section) => ({
      ...section,
      modules: [...section.modules, ...cloneModulesForColumn(saved.modules, column, saved.id)]
    }));
    setMessage(`Inserted "${saved.name}" into the ${column} cell.`);
    setError(null);
  }

  function insertSavedModule(sectionId: string, column: string, cellModuleId: string) {
    if (!cellModuleId) {
      return;
    }

    const saved = cellModules.find((candidate) => candidate.id === cellModuleId && candidate.modules.length === 1);

    if (!saved) {
      return;
    }

    updateSection(sectionId, (section) => ({
      ...section,
      modules: [...section.modules, ...cloneModulesForColumn(saved.modules, column, saved.id)]
    }));
    setMessage(`Inserted module "${saved.name}" into the ${column} cell.`);
    setError(null);
  }

  function moveModule(sectionId: string, moduleId: string, direction: -1 | 1) {
    updateSection(sectionId, (s) => {
      const idx = s.modules.findIndex((m) => m.id === moduleId);
      const next = idx + direction;
      if (idx < 0 || next < 0 || next >= s.modules.length) return s;
      const arr = [...s.modules];
      const [item] = arr.splice(idx, 1);
      arr.splice(next, 0, item);
      return { ...s, modules: arr };
    });
  }

  function dropModule(
    moduleId: string,
    sourceSectionId: string,
    targetSectionId: string,
    targetColumn: string,
    targetBeforeModuleId?: string
  ) {
    setDraft((current) => {
      const sourceSection = current.layoutSections.find((section) => section.id === sourceSectionId);
      const targetSection = current.layoutSections.find((section) => section.id === targetSectionId);

      if (!sourceSection || !targetSection) return current;

      const sourceModule = sourceSection.modules.find((module) => module.id === moduleId);
      if (!sourceModule) return current;

      const movedModule: BuilderTemplateModule = { ...sourceModule, column: targetColumn };

      return {
        ...current,
        layoutSections: current.layoutSections.map((section) => {
          if (section.id !== sourceSectionId && section.id !== targetSectionId) return section;

          if (sourceSectionId === targetSectionId && section.id === sourceSectionId) {
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
            const nextModules = [...remaining];
            nextModules.splice(insertAt, 0, movedModule);
            return { ...section, modules: nextModules };
          }

          if (section.id === sourceSectionId) {
            return { ...section, modules: section.modules.filter((module) => module.id !== moduleId) };
          }

          const insertAt = targetBeforeModuleId
            ? Math.max(section.modules.findIndex((module) => module.id === targetBeforeModuleId), 0)
            : (() => {
                const lastIndexInColumn = Math.max(
                  ...section.modules.map((module, index) => (module.column === targetColumn ? index : -1)).filter((index) => index >= 0),
                  -1
                );
                return lastIndexInColumn >= 0 ? lastIndexInColumn + 1 : section.modules.length;
              })();

          const nextModules = [...section.modules];
          nextModules.splice(insertAt, 0, movedModule);
          return { ...section, modules: nextModules };
        })
      };
    });
  }

  function cloneModule(sectionId: string, moduleId: string) {
    updateSection(sectionId, (s) => {
      const index = s.modules.findIndex((m) => m.id === moduleId);
      if (index < 0) return s;
      const original = s.modules[index];
      const clone = {
        ...original,
        id: `${original.type}-${Date.now()}`,
        name: original.name ? `${original.name} (copy)` : "",
        settings: { ...original.settings }
      };
      const nextModules = [...s.modules];
      nextModules.splice(index + 1, 0, clone);
      return { ...s, modules: nextModules };
    });
  }

  async function saveModule(sectionId: string, moduleId: string) {
    const section = draft.layoutSections.find((s) => s.id === sectionId);
    const builderModule = section?.modules.find((m) => m.id === moduleId);
    if (!builderModule) return;

    const fallbackName = builderModule.name || builderModule.type;
    const name = window.prompt("Name this saved module", fallbackName)?.trim();
    if (!name) return;

    const moduleClass = promptForModuleClass(resolveModuleClassForBuilderModule(builderModule));
    if (moduleClass === null) return;

    try {
      const response = await builderAdminFetch("/api/admin/cell-modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, moduleClass, modules: [builderModule] })
      });
      const data = await readAdminJson<{ cellModule?: BuilderCellModuleRecord; error?: string }>(response, "Failed to save module.");
      if (!data.cellModule) throw new Error(data.error ?? "Failed to save module.");
      setCellModules((current) => [data.cellModule!, ...current]);
      setMessage(`Saved "${data.cellModule.name}" to the module repository.`);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save module.");
    }
  }

  function removeModule(sectionId: string, moduleId: string) {
    setExpandedModuleIds((c) => c.filter((id) => id !== moduleId));
    updateSection(sectionId, (s) => ({ ...s, modules: s.modules.filter((m) => m.id !== moduleId) }));
  }

  async function saveSavedModule(cellModuleId: string, name: string, moduleClass: string, modules: BuilderTemplateModule[], isPrivate: boolean) {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(`/api/admin/cell-modules/${cellModuleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, moduleClass, modules, isPrivate })
      });
      const data = await readAdminJson<{ cellModule?: BuilderCellModuleRecord; error?: string }>(response, "Failed to save saved module.");

      if (!data.cellModule) {
        throw new Error(data.error ?? "Failed to save saved module.");
      }

      setCellModules((current) =>
        current.map((cellModule) => (cellModule.id === data.cellModule!.id ? data.cellModule! : cellModule))
      );
      setMessage(`Saved module "${data.cellModule.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save saved module.");
    } finally {
      setIsSaving(false);
    }
  }

  function cloneSavedModules(modules: BuilderTemplateModule[]) {
    const timestamp = Date.now();
    return modules.map((module, index) => ({
      ...module,
      id: `${module.type}-${timestamp}-${index}`,
      settings: { ...module.settings }
    }));
  }

  async function cloneSavedModule(cellModuleId: string) {
    const source = cellModules.find((cellModule) => cellModule.id === cellModuleId);
    if (!source || source.modules.length === 0) {
      return;
    }

    const baseName = source.name?.trim() || "Untitled saved module";
    await createSavedModule(`${baseName} (copy)`, source.moduleClass?.trim() ?? "", cloneSavedModules(source.modules));
  }

  async function cloneCreatedModule(module: BuilderTemplateModule, moduleLabel: string) {
    const baseName = moduleLabel.trim() || module.name?.trim() || module.type;

    await createSavedModule(
      `${baseName} (copy)`,
      inferModuleClassFromBuilderModules([module]),
      cloneSavedModules([module])
    );
  }

  async function createSavedModule(name: string, moduleClass: string, modules: BuilderTemplateModule[]) {
    const trimmedName = name.trim();

    if (!trimmedName || modules.length === 0) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch("/api/admin/cell-modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, moduleClass: moduleClass.trim(), modules })
      });
      const data = await readAdminJson<{ cellModule?: BuilderCellModuleRecord; error?: string }>(response, "Failed to save module.");

      if (!data.cellModule) {
        throw new Error(data.error ?? "Failed to save module.");
      }

      setCellModules((current) => [data.cellModule!, ...current]);
      setMessage(`Saved "${data.cellModule.name}" to the module repository.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save module.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSavedModule(cellModuleId: string, currentName: string) {
    if (!window.confirm(`Delete saved module "${currentName}"? This cannot be undone.`)) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(`/api/admin/cell-modules/${cellModuleId}`, { method: "DELETE" });
      await readAdminJson<{ error?: string }>(response, "Failed to delete saved module.");

      setCellModules((current) => current.filter((cellModule) => cellModule.id !== cellModuleId));
      setMessage(`Deleted saved module "${currentName}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete saved module.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveSavedSection(sectionId: string, name: string, section: BuilderTemplateSection, isPrivate: boolean) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Saved section name is required.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(`/api/admin/saved-sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, section, isPrivate })
      });
      const data = await readAdminJson<{ savedSection?: BuilderSavedSectionRecord; error?: string }>(response, "Failed to save saved section.");

      if (!data.savedSection) {
        throw new Error(data.error ?? "Failed to save saved section.");
      }

      setSavedSections((current) =>
        current.map((section) => (section.id === data.savedSection!.id ? data.savedSection! : section))
      );
      setMessage(`Saved section "${data.savedSection.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save saved section.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSavedSection(sectionId: string, currentName: string) {
    if (!window.confirm(`Delete saved section "${currentName}"? This cannot be undone.`)) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(`/api/admin/saved-sections/${sectionId}`, { method: "DELETE" });
      await readAdminJson<{ error?: string }>(response, "Failed to delete saved section.");

      setSavedSections((current) => current.filter((section) => section.id !== sectionId));
      setMessage(`Deleted saved section "${currentName}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete saved section.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveProduct(product: Partial<BuilderProductRecord> & { id?: string }) {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(product.id ? `/api/admin/products/${product.id}` : "/api/admin/products", {
        method: product.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: product.name,
          productType: product.productType,
          productUrl: product.productUrl,
          imageUrl: product.imageUrl
        })
      });
      const data = await readAdminJson<{ product?: BuilderProductRecord; error?: string }>(response, "Failed to save product.");

      if (!data.product) {
        throw new Error(data.error ?? "Failed to save product.");
      }

      setProducts((current) =>
        product.id
          ? current.map((candidate) => (candidate.id === data.product!.id ? data.product! : candidate))
          : [data.product!, ...current]
      );
      setMessage(`Saved product "${data.product.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save product.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteProduct(productId: string, currentName: string) {
    if (!window.confirm(`Delete product "${currentName}"? This cannot be undone.`)) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(`/api/admin/products/${productId}`, { method: "DELETE" });
      await readAdminJson<{ error?: string }>(response, "Failed to delete product.");

      setProducts((current) => current.filter((product) => product.id !== productId));
      setMessage(`Deleted product "${currentName}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete product.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveCreatedModule(source: CreatedModuleSource, nextModule: BuilderTemplateModule) {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (source.kind === "template") {
        const template = pageTemplates.find((candidate) => candidate.id === source.sourceId);

        if (!template) {
          throw new Error("Could not find the source template for this module.");
        }

        const layoutSections = template.layoutSections.map((section) =>
          section.id === source.sectionId
            ? {
                ...section,
                modules: section.modules.map((module) => (module.id === source.moduleId ? nextModule : module))
              }
            : section
        );
        const response = await builderAdminFetch(`/api/admin/page-templates/${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: template.name,
            pageBackground: template.pageBackground,
            layoutSections
          })
        });
        const data = await readAdminJson<{ pageTemplate?: BuilderTemplateRecord; error?: string }>(response, "Failed to save module.");

        if (!data.pageTemplate) {
          throw new Error(data.error ?? "Failed to save module.");
        }

        setPageTemplates((current) =>
          current.map((candidate) => (candidate.id === data.pageTemplate!.id ? data.pageTemplate! : candidate))
        );
      } else {
        const page = pages.find((candidate) => candidate.id === source.sourceId);

        if (!page) {
          throw new Error("Could not find the source page for this module.");
        }

        const layoutSections = page.layoutSections.map((section) =>
          section.id === source.sectionId
            ? {
                ...section,
                modules: section.modules.map((module) => (module.id === source.moduleId ? nextModule : module))
              }
            : section
        );
        const response = await builderAdminFetch(`/api/admin/pages/${page.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: page.name,
            slug: page.slug,
            templateId: page.templateId,
            isPublished: page.isPublished,
            pageBackground: page.pageBackground,
            layoutSections
          })
        });
        const data = await readAdminJson<{ page?: BuilderPageRecord; error?: string }>(response, "Failed to save module.");

        if (!data.page) {
          throw new Error(data.error ?? "Failed to save module.");
        }

        setPages((current) => current.map((candidate) => (candidate.id === data.page!.id ? data.page! : candidate)));
      }

      setMessage("Module updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save module.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCreatedModule(source: CreatedModuleSource, moduleName: string) {
    if (!window.confirm(`Delete module "${moduleName}" from its source? This cannot be undone.`)) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (source.kind === "template") {
        const template = pageTemplates.find((candidate) => candidate.id === source.sourceId);

        if (!template) {
          throw new Error("Could not find the source template for this module.");
        }

        const layoutSections = template.layoutSections.map((section) =>
          section.id === source.sectionId
            ? { ...section, modules: section.modules.filter((module) => module.id !== source.moduleId) }
            : section
        );
        const response = await builderAdminFetch(`/api/admin/page-templates/${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: template.name,
            pageBackground: template.pageBackground,
            layoutSections
          })
        });
        const data = await readAdminJson<{ pageTemplate?: BuilderTemplateRecord; error?: string }>(response, "Failed to delete module.");

        if (!data.pageTemplate) {
          throw new Error(data.error ?? "Failed to delete module.");
        }

        setPageTemplates((current) =>
          current.map((candidate) => (candidate.id === data.pageTemplate!.id ? data.pageTemplate! : candidate))
        );
      } else {
        const page = pages.find((candidate) => candidate.id === source.sourceId);

        if (!page) {
          throw new Error("Could not find the source page for this module.");
        }

        const layoutSections = page.layoutSections.map((section) =>
          section.id === source.sectionId
            ? { ...section, modules: section.modules.filter((module) => module.id !== source.moduleId) }
            : section
        );
        const response = await builderAdminFetch(`/api/admin/pages/${page.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: page.name,
            slug: page.slug,
            templateId: page.templateId,
            isPublished: page.isPublished,
            pageBackground: page.pageBackground,
            layoutSections
          })
        });
        const data = await readAdminJson<{ page?: BuilderPageRecord; error?: string }>(response, "Failed to delete module.");

        if (!data.page) {
          throw new Error(data.error ?? "Failed to delete module.");
        }

        setPages((current) => current.map((candidate) => (candidate.id === data.page!.id ? data.page! : candidate)));
      }

      setMessage(`Deleted module "${moduleName}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete module.");
    } finally {
      setIsSaving(false);
    }
  }

  function toggleModuleExpanded(moduleId: string) {
    setExpandedModuleIds((c) =>
      c.includes(moduleId) ? c.filter((id) => id !== moduleId) : [...c, moduleId]
    );
  }

  // --- Template / page helpers ---

  function startNewTemplate() {
    hydratedTemplateSelectionRef.current = "";
    setSelectedTemplateId("");
    setDraft(createDraftFromTemplate(null));
    setMessage(null);
    setError(null);
  }

  function startNewPage() {
    hydratedPageSelectionRef.current = "";
    setSelectedPageId("");
    setPageSlug("");
    setPageTemplateId("");
    setPageThemeId("");
    setDraft(createDraftFromPage(null));
    setMessage(null);
    setError(null);
  }

  function applyThemeToPage(themeId: string) {
    setPageThemeId(themeId);
    if (!themeId) return;
    const found = builderThemes.find((t) => t.id === themeId);
    if (found?.typography) {
      setDraft((c) => ({ ...c, theme: { ...c.theme, typography: found.typography! } }));
    }
  }

  function applyTemplateToPage(templateId: string) {
    setPageTemplateId(templateId);
    const template = pageLayoutTemplates.find((t) => t.id === templateId) ?? null;
    if (!template) { setDraft(createDraftFromPage(null)); return; }
    // Stub templates (empty layoutSections) only tag the page; they don't clear the layout.
    if (!template.layoutSections.length) return;
    setDraft((c) => ({ id: selectedPageId, name: c.name || template.name, templateKind: "modular", emailFunction: "", pageBackground: template.pageBackground, theme: template.theme, layoutSections: template.layoutSections }));
  }

  async function makeTemplateFromPage() {
    if (!draft.name.trim()) { setError("Page title is required before making a template."); return; }

    const templateName = `${draft.name.trim()} Template`;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch("/api/admin/page-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          pageBackground: draft.pageBackground,
          theme: draft.theme,
          layoutSections: draft.layoutSections
        })
      });
      const data = await readAdminJson<{ pageTemplate?: BuilderTemplateRecord; error?: string }>(response, "Failed to create template from page.");

      if (!data.pageTemplate) {
        throw new Error(data.error ?? "Failed to create template from page.");
      }

      await loadPageTemplates();
      setSelectedTemplateId(data.pageTemplate.id);
      setBuilderMode("templates");
      setMessage(`Created template "${data.pageTemplate.name}" from this page.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template from page.");
    } finally {
      setIsSaving(false);
    }
  }

  // --- Gallery / palette ---

  function openGallery(sectionId: string, moduleId: string) {
    setGalleryTarget({ kind: "module", sectionId, moduleId });
    setIsGalleryOpen(true);
  }

  function openRichTextGallery(sectionId: string, moduleId: string, anchor?: BuilderModalAnchor) {
    setGalleryAnchor(anchor ?? null);
    setGalleryTarget({ kind: "rich-text", sectionId, moduleId });
    setIsGalleryOpen(true);
  }

  function openButtonBackgroundGallery(sectionId: string, moduleId: string) {
    setGalleryTarget({ kind: "button-background", sectionId, moduleId });
    setIsGalleryOpen(true);
  }

  function openSocialIconGallery(sectionId: string, moduleId: string, itemId: string) {
    setGalleryTarget({ kind: "social-icon", sectionId, moduleId, itemId });
    setIsGalleryOpen(true);
  }

  function openSectionBackgroundGallery(sectionId: string) {
    setGalleryTarget({ kind: "section-background", sectionId });
    setIsGalleryOpen(true);
  }

  function openModulePalette(sectionId: string, column: string, anchor?: ModulePaletteAnchor) {
    setModulePaletteTarget({ sectionId, column });
    setModulePaletteAnchor(anchor ?? null);
    setActiveModuleGroup(null);
    setIsModulePaletteOpen(true);
  }

  function closeGallery() {
    setIsGalleryOpen(false);
    setGalleryTarget(null);
    setGalleryAnchor(null);
  }
  function closeModulePalette() {
    setIsModulePaletteOpen(false);
    setModulePaletteTarget(null);
    setModulePaletteAnchor(null);
    setActiveModuleGroup(null);
  }

  function selectGalleryImage(imagePath: string) {
    if (!galleryTarget) return;
    if (galleryTarget.kind === "rich-text") {
      updateModule(galleryTarget.sectionId, galleryTarget.moduleId, (module) => ({
        ...module,
        text: appendRichTextImageToHtml(module.text, normalizeBuilderAssetUrl(imagePath))
      }));
      closeGallery();
      return;
    }
    if (galleryTarget.kind === "module") {
      updateModule(galleryTarget.sectionId, galleryTarget.moduleId, (c) => ({
        ...c, settings: { ...c.settings, url: normalizeBuilderAssetUrl(imagePath) }
      }));
    } else if (galleryTarget.kind === "button-background") {
      updateModule(galleryTarget.sectionId, galleryTarget.moduleId, (c) => ({
        ...c,
        settings: {
          ...c.settings,
          buttonBackgroundMode: "image",
          buttonBackgroundImageUrl: normalizeBuilderAssetUrl(imagePath)
        }
      }));
    } else if (galleryTarget.kind === "social-icon") {
      updateModule(galleryTarget.sectionId, galleryTarget.moduleId, (current) => {
        let items: Array<Record<string, unknown>> = [];

        try {
          const parsed = JSON.parse(current.settings.socialItems || "[]");
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }

        return {
          ...current,
          settings: {
            ...current.settings,
            socialItems: JSON.stringify(
              items.map((item, index) => {
                const id = String(item.id || `social-${index + 1}`);
                return id === galleryTarget.itemId
                  ? { ...item, id, iconUrl: normalizeBuilderAssetUrl(imagePath) }
                  : { ...item, id };
              })
            )
          }
        };
      });
    } else {
      updateSection(galleryTarget.sectionId, (c) => ({
        ...c, background: { ...c.background, mode: "image", imageUrl: normalizeBuilderAssetUrl(imagePath) }
      }));
    }
    closeGallery();
  }

  // --- Media upload ---

  async function uploadMedia(onSuccess: (media: AdminMediaItem) => void, file: File | null) {
    if (!file) return;
    setIsUploadingMedia(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await builderAdminFetch("/api/admin/media", { method: "POST", body: formData });
      const data = await readAdminJson<{ media?: AdminMediaItem; error?: string }>(response, "Failed to upload media.");
      if (!data.media) throw new Error(data.error ?? "Failed to upload media.");
      const uploaded = data.media;
      setGalleryMedia((c) => [...c.filter((i) => i.path !== uploaded.path), uploaded].sort((a, b) => a.name.localeCompare(b.name)));
      onSuccess(uploaded);
      setMessage(`Uploaded ${uploaded.name} to gallery.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload media.");
    } finally {
      setIsUploadingMedia(false);
    }
  }

  async function uploadRichTextGalleryImage(file: File): Promise<string | null> {
    if (!file) {
      return null;
    }

    setIsUploadingMedia(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await builderAdminFetch("/api/admin/media", { method: "POST", body: formData });
      const data = await readAdminJson<{ media?: AdminMediaItem; error?: string }>(response, "Failed to upload media.");
      if (!data.media) {
        throw new Error(data.error ?? "Failed to upload media.");
      }

      const uploaded = data.media;
      setGalleryMedia((current) =>
        [...current.filter((item) => item.path !== uploaded.path), uploaded].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      setMessage(`Uploaded ${uploaded.name} to gallery.`);
      return normalizeBuilderAssetUrl(uploaded.path);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload media.");
      return null;
    } finally {
      setIsUploadingMedia(false);
    }
  }

  function uploadMediaForModule(sectionId: string, moduleId: string, file: File | null) {
    void uploadMedia((m) => {
      updateModule(sectionId, moduleId, (c) => ({ ...c, settings: { ...c.settings, url: normalizeBuilderAssetUrl(m.path) } }));
    }, file);
  }

  function uploadButtonBackgroundMedia(sectionId: string, moduleId: string, file: File | null) {
    void uploadMedia((m) => {
      updateModule(sectionId, moduleId, (c) => ({
        ...c,
        settings: {
          ...c.settings,
          buttonBackgroundMode: "image",
          buttonBackgroundImageUrl: normalizeBuilderAssetUrl(m.path)
        }
      }));
    }, file);
  }

  function uploadMediaForSectionBackground(sectionId: string, file: File | null) {
    void uploadMedia((m) => {
      updateSection(sectionId, (c) => ({ ...c, background: { ...c.background, mode: "image", imageUrl: normalizeBuilderAssetUrl(m.path) } }));
    }, file);
  }

  // --- CRUD ---

  async function saveTemplate() {
    const resolvedName =
      draft.name.trim() ||
      (draft.templateKind === "email" ? getDefaultEmailTemplateName(draft.emailFunction) : "");

    if (!resolvedName) {
      setError("Template name is required.");
      return;
    }

    if (draft.templateKind === "email" && !draft.emailFunction) {
      setError("Select a Function for email templates.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch(draft.id ? `/api/admin/page-templates/${draft.id}` : "/api/admin/page-templates", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: resolvedName,
          templateKind: draft.templateKind,
          emailFunction: draft.emailFunction,
          pageBackground: draft.pageBackground,
          theme: draft.theme,
          layoutSections: draft.layoutSections
        })
      });
      const data = await readAdminJson<{ pageTemplate?: BuilderTemplateRecord; error?: string }>(response, "Failed to save template.");
      setMessage(draft.id ? "Page template updated." : "Page template created.");
      if (data.pageTemplate?.id) {
        setSelectedTemplateId(data.pageTemplate.id);
      }
      await loadPageTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save template.");
    } finally {
      setIsSaving(false);
    }
  }

  async function savePage() {
    if (!draft.name.trim()) { setError("Page title is required."); return; }
    // An empty slug is the root/home page (the DB unique index excludes empty
    // slugs). Allow saving an existing root page without a slug; only require
    // one when creating a new page so we don't silently mint duplicate roots.
    if (!selectedPageId && !pageSlug.trim()) { setError("Page slug is required."); return; }
    if (!pageTemplateId) { setError("Select a template before saving a page."); return; }
    setIsSaving(true); setError(null); setMessage(null);
    try {
      const response = await builderAdminFetch(selectedPageId ? `/api/admin/pages/${selectedPageId}` : "/api/admin/pages", {
        method: selectedPageId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, slug: pageSlug, templateId: pageTemplateId, themeId: pageThemeId || undefined, isPrivate: pageIsPrivate, pageBackground: draft.pageBackground, theme: draft.theme, layoutSections: draft.layoutSections })
      });
      const data = await readAdminJson<{ page?: BuilderPageRecord; error?: string }>(response, "Failed to save page.");
      setMessage(selectedPageId ? "Page updated." : "Page created.");
      await loadPages();
      if (data.page?.id) setSelectedPageId(data.page.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save page.");
    } finally { setIsSaving(false); }
  }

  async function bulkCreatePages(
    templateId: string,
    items: Array<{ name: string; slug: string }>,
    themeId?: string,
  ): Promise<BulkCreateResult[]> {
    const template = pageLayoutTemplates.find((t) => t.id === templateId) ?? null;
    const selectedTheme = themeId ? builderThemes.find((t) => t.id === themeId) : null;
    const effectiveTheme = selectedTheme?.typography
      ? { ...(template?.theme ?? createDefaultTheme()), typography: selectedTheme.typography }
      : (template?.theme ?? createDefaultTheme());
    const results = await Promise.all(
      items.map(async (item): Promise<BulkCreateResult> => {
        try {
          const response = await builderAdminFetch("/api/admin/pages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: item.name,
              slug: item.slug,
              templateId,
              themeId: themeId || undefined,
              templateKind: "modular",
              pageBackground: template?.pageBackground ?? createDefaultBackgroundSettings(),
              theme: effectiveTheme,
              layoutSections: template?.layoutSections ?? []
            })
          });
          const data = await readAdminJson<{ page?: BuilderPageRecord; error?: string }>(response, "Failed to create page.");
          return { name: item.name, slug: item.slug, page: data.page };
        } catch (e) {
          return { name: item.name, slug: item.slug, error: e instanceof Error ? e.message : "Failed to create page." };
        }
      })
    );
    await loadPages();
    return results;
  }

  async function bulkCreateWithModel(
    templateId: string,
    items: Array<{ name: string; slug: string }>,
    contentModelId: string,
    runId: string,
    themeId?: string,
  ): Promise<BulkCreateResult[]> {
    const response = await builderAdminFetch("/api/admin/pages/bulk-create-with-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, items, contentModelId, runId, themeId: themeId || undefined }),
    });
    const data = await readAdminJson<{ results?: BulkCreateResult[]; error?: string }>(response, "Failed to bulk create pages with content model.");
    const results: BulkCreateResult[] = (data.results ?? []).map((r: BulkCreateResult) => ({
      name: r.name,
      slug: r.slug,
      page: r.page,
      error: r.error,
    }));
    await loadPages();
    return results;
  }

  async function previewExtraction(
    contentModelId: string,
    runId: string,
    items: Array<{ name: string; slug: string }>,
  ): Promise<ExtractionPreviewItem[]> {
    const response = await builderAdminFetch(
      `/api/admin/acquire-runs/${runId}/extraction-preview`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentModelId, items }) },
    );
    const data = await readAdminJson<{ preview?: ExtractionPreviewItem[]; error?: string }>(response, "Failed to preview extraction.");
    return data.preview ?? [];
  }

  async function deleteTemplateById(templateId: string, templateName: string) {
    if (!templateId) { setDraft(createDraftFromTemplate(null)); return; }
    if (!window.confirm(`Delete template "${templateName}"? This cannot be undone.`)) return;
    setError(null); setMessage(null);
    try {
      const response = await builderAdminFetch(`/api/admin/page-templates/${templateId}`, { method: "DELETE" });
      await readAdminJson<{ error?: string }>(response, "Failed to delete template.");
      setMessage("Page template deleted.");
      if (selectedTemplateId === templateId) { setSelectedTemplateId(""); setDraft(createDraftFromTemplate(null)); }
      await loadPageTemplates();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to delete template."); }
  }

  async function populateFromAcquire() {
    if (!window.confirm("Populate Builder pages with content from the latest web crawl?\n\nThis adds a Paragraph section to each page whose name exactly matches a crawled page title. Existing sections are not changed.")) return;
    setError(null); setMessage(null); setIsSaving(true);
    try {
      const response = await builderAdminFetch("/api/admin/pages/populate-from-acquire", { method: "POST" });
      const data = await readAdminJson<{ populated?: Array<{name: string; slug: string; chars: number}>; skipped?: Array<{name: string; reason: string}>; sourceUrl?: string; error?: string }>(response, "Failed to populate pages.");
      const n = data.populated?.length ?? 0;
      const s = (data.skipped ?? []).filter((x) => x.reason === "no_match").length;
      setMessage(`Populated ${n} page${n !== 1 ? "s" : ""} from ${data.sourceUrl ?? "crawl"}. ${s} page${s !== 1 ? "s" : ""} had no matching crawled content.`);
      await loadPages();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to populate pages."); }
    finally { setIsSaving(false); }
  }

  async function deletePageById(pageId: string, pageName: string) {
    if (!pageId) { startNewPage(); return; }
    if (!window.confirm(`Delete page "${pageName}"? This cannot be undone.`)) return;
    setError(null); setMessage(null);
    try {
      const response = await builderAdminFetch(`/api/admin/pages/${pageId}`, { method: "DELETE" });
      await readAdminJson<{ error?: string }>(response, "Failed to delete page.");
      setMessage("Page deleted.");
      if (selectedPageId === pageId) startNewPage();
      await loadPages();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to delete page."); }
  }

  async function deletePagesByIds(pageIds: string[]) {
    if (pageIds.length === 0) return;
    const n = pageIds.length;
    if (!window.confirm(`Delete ${n} page${n !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setError(null); setMessage(null); setIsSaving(true);
    let failed = 0;
    for (const id of pageIds) {
      try {
        const response = await builderAdminFetch(`/api/admin/pages/${id}`, { method: "DELETE" });
        await readAdminJson<{ error?: string }>(response, "Failed to delete page.");
        if (selectedPageId === id) startNewPage();
      } catch { failed++; }
    }
    setIsSaving(false);
    if (failed > 0) setError(`${failed} page${failed !== 1 ? "s" : ""} could not be deleted.`);
    else setMessage(`${n} page${n !== 1 ? "s" : ""} deleted.`);
    await loadPages();
  }

  async function clonePageById(pageId: string) {
    const source = pages.find((page) => page.id === pageId);

    if (!source) {
      setError("Page not found.");
      return;
    }

    const payload = buildClonedPageCreatePayload(source, pages);

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await builderAdminFetch("/api/admin/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await readAdminJson<{ page?: BuilderPageRecord; error?: string }>(response, "Failed to clone page.");

      if (!data.page?.id) {
        throw new Error(data.error ?? "Failed to clone page.");
      }

      hydratedPageSelectionRef.current = "";
      setSelectedPageId(data.page.id);
      setMessage(`Cloned page "${payload.name}".`);
      await loadPages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clone page.");
    } finally {
      setIsSaving(false);
    }
  }

  // --- Preview ---

  function openPreviewPage() {
    window.localStorage.setItem(BUILDER_PREVIEW_STORAGE_KEY, JSON.stringify({ name: draft.name, pageBackground: draft.pageBackground, theme: draft.theme, layoutSections: draft.layoutSections }));
    window.localStorage.setItem(
      BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
      isEmailTemplateDraft ? "email" : previewDevice
    );
    window.open(`${window.location.origin}/builder-preview.html`, "_blank");
  }

  function openTemplatePreview(template: BuilderTemplateRecord) {
    window.localStorage.setItem(BUILDER_PREVIEW_STORAGE_KEY, JSON.stringify({ name: template.name, pageBackground: template.pageBackground, theme: template.theme, layoutSections: template.layoutSections }));
    window.localStorage.setItem(
      BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
      template.templateKind === "email" ? "email" : previewDevice
    );
    window.open(`${window.location.origin}/builder-preview.html`, "_blank");
  }

  function openPagePreview(slug: string) {
    // StarCaster has no public page-render route yet; show the stored preview.
    const page = pages.find((entry) => entry.slug === slug) ?? pages.find((entry) => String(entry.id) === slug);
    if (!page) return;
    window.localStorage.setItem(
      BUILDER_PREVIEW_STORAGE_KEY,
      JSON.stringify({ name: page.name, pageBackground: page.pageBackground, theme: page.theme, layoutSections: page.layoutSections })
    );
    window.localStorage.setItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY, previewDevice);
    window.open(`${window.location.origin}/builder-preview.html`, "_blank");
  }

  // --- Drag & drop ---

  function handleLayoutDragStart(layout: BuilderTemplateLayout, event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", layout);
  }

  function handleWorkspaceDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const layout = event.dataTransfer.getData("text/plain") as BuilderTemplateLayout;
    if (layout) addSection(layout);
    setDragOverWorkspace(false);
  }

  function renderLayoutTile(layout: { value: BuilderTemplateLayout; label: string }) {
    const columns = getLayoutColumns(layout.value);
    const gridTemplateColumns = getLayoutGridTemplate(layout.value);
    return (
      <button className="builder-layout-tile" draggable key={layout.value} onClick={() => addSection(layout.value)} onDragStart={(event) => handleLayoutDragStart(layout.value, event)} type="button">
        <span className={`builder-layout-icon builder-layout-icon-${columns.length}`} style={{ gridTemplateColumns }}>
          {columns.map((column) => (<span className="builder-layout-bar" key={column} />))}
        </span>
        <span className="builder-layout-label">{layout.label}</span>
      </button>
    );
  }

  const handleModuleEditorFocusChange = useCallback(
    (focus: BuilderModuleEditorFocus | null, syncOnly = false) => {
      repositorySaveRef.current = focus;

      if (!syncOnly) {
        setRepositorySaveFocus(focus);
      }
    },
    []
  );

  const handleRepositoryEditingActiveChange = useCallback((active: boolean) => {
    setRepositorySaveActive(active);

    if (!active) {
      repositorySaveRef.current = null;
      setRepositorySaveFocus(null);
    }
  }, []);

  const floatingSaveActions: BuilderFloatingSaveAction[] = (() => {
    if (builderMode === "pages" && (pageEditorFocused || Boolean(selectedPageId))) {
      return [
        {
          label: "Save Page",
          savingLabel: "Saving...",
          onSave: () => void savePage()
        }
      ];
    }

    if (builderMode === "templates" && (templateEditorFocused || Boolean(selectedTemplateId))) {
      return [
        {
          label: "Save Template",
          savingLabel: "Saving...",
          onSave: () => void saveTemplate()
        }
      ];
    }

    if (builderMode === "modules" && repositorySaveActive) {
      const activeFocus = repositorySaveRef.current ?? repositorySaveFocus;

      if (activeFocus?.kind === "section") {
        return [
          {
            label: "Save Section",
            savingLabel: "Saving...",
            onSave: () => {
              const focus = repositorySaveRef.current;

              if (!focus || focus.kind !== "section") {
                return;
              }

              void saveSavedSection(focus.sectionId, focus.name, focus.section, focus.isPrivate ?? false);
            }
          }
        ];
      }

      return [
        {
          label: "Save Module",
          savingLabel: "Saving...",
          onSave: () => {
            const focus = repositorySaveRef.current;

            if (!focus) {
              return;
            }

            if (focus.kind === "created") {
              void saveCreatedModule(focus.source, focus.module);
              return;
            }

            if (focus.kind === "saved") {
              void saveSavedModule(focus.cellModuleId, focus.name, focus.moduleClass, focus.modules, focus.isPrivate ?? false);
            }
          }
        }
      ];
    }

    return [];
  })();

  // --- Render ---

  return (
    <section
      className={`admin-section builder-editor-section${builderMode === "modules" ? " builder-editor-section-modules" : ""}`}
    >
      <div className="builder-editor-layout">
        <div className="builder-editor-layout-main">
      <div className="admin-toolbar">
        <h2 className="admin-section-heading">Page Builder</h2>
        <div className="admin-actions builder-header-actions">
          <button className={builderMode === "templates" ? "submit-button" : "secondary-button"} onClick={() => setBuilderMode("templates")} type="button">Templates</button>
          <button className={builderMode === "modules" ? "submit-button" : "secondary-button"} onClick={() => setBuilderMode("modules")} type="button">Modules</button>
          <button className={builderMode === "pages" ? "submit-button" : "secondary-button"} onClick={() => setBuilderMode("pages")} type="button">Pages</button>
        </div>
      </div>

      {message ? <div className="notice success admin-notice">{message}</div> : null}
      {error ? <div className="notice error admin-notice">{error}</div> : null}

      {builderMode === "pages" ? (
        <AdminLegacyRemindersImportPanel
          pageSlug={pageSlug}
          selectedPageId={selectedPageId}
          onPageImported={(page) => {
            setPages((current) => {
              const index = current.findIndex((entry) => entry.id === page.id);

              if (index < 0) {
                return [...current, page];
              }

              const next = [...current];
              next[index] = page;
              return next;
            });

            if (selectedPageId === page.id) {
              setDraft((current) => ({
                ...current,
                name: page.name,
                pageBackground: page.pageBackground,
                layoutSections: page.layoutSections
              }));
              setPageSlug(page.slug);
              setPageTemplateId(page.templateId ?? "");
            }

            setMessage("Legacy reminders imported into the home page layout. Review the Reminders module, then Save Page.");
            setError(null);
          }}
        />
      ) : null}

      {builderMode === "templates" ? (
        <BuilderTemplateList
          templates={pageTemplates}
          selectedTemplateId={selectedTemplateId}
          draftName={draft.name}
          templateKind={draft.templateKind}
          emailFunction={draft.emailFunction}
          pageBackground={draft.pageBackground}
          theme={draft.theme}
          previewDevice={previewDevice}
          isSaving={isSaving}
          onSelectTemplate={setSelectedTemplateId}
          onPreviewTemplate={openTemplatePreview}
          onDeleteTemplate={(id, name) => void deleteTemplateById(id, name)}
          onSetDraftName={setDraftName}
          onSetTemplateKind={setTemplateKind}
          onSetEmailFunction={setEmailFunction}
          onUpdatePageBackground={updatePageBackground}
          onUpdateTheme={updateTheme}
          onSetPreviewDevice={setPreviewDevice}
          onPreviewDraft={openPreviewPage}
          onNewTemplate={startNewTemplate}
          onTemplateEditorFocus={setTemplateEditorFocused}
        />
      ) : builderMode === "modules" ? (
        <BuilderModuleRepositoryList
          cellModules={cellModules}
          pages={pages}
          products={products}
          galleryMedia={galleryMedia}
          isUploadingMedia={isUploadingMedia}
          savedSections={savedSections}
          templates={pageTemplates}
          isSaving={isSaving}
          onDeleteCreatedModule={(source, name) => void deleteCreatedModule(source, name)}
          onDeleteSavedModule={(id, name) => void deleteSavedModule(id, name)}
          onDeleteSavedSection={(id, name) => void deleteSavedSection(id, name)}
          onCloneCreatedModule={(module, moduleLabel) => void cloneCreatedModule(module, moduleLabel)}
          onCloneSavedModule={(id) => void cloneSavedModule(id)}
          onCreateSavedModule={(name, moduleClass, modules) => void createSavedModule(name, moduleClass, modules)}
          onSaveCreatedModule={(source, module) => void saveCreatedModule(source, module)}
          onSaveSavedModule={(id, name, moduleClass, modules, isPrivate) => void saveSavedModule(id, name, moduleClass, modules, isPrivate)}
          onSaveSavedSection={(id, name, section, isPrivate) => void saveSavedSection(id, name, section, isPrivate)}
          onModuleEditorFocusChange={handleModuleEditorFocusChange}
          onRepositoryEditingActiveChange={handleRepositoryEditingActiveChange}
        />
      ) : showBulkCreate ? (
        <BuilderBulkCreate
          templates={pageLayoutTemplates}
          savedSections={savedSections}
          acquireRuns={acquireRuns}
          themes={builderThemes}
          onBack={() => setShowBulkCreate(false)}
          onRefreshRuns={() => void loadAcquireRuns()}
          onBulkCreatePages={(templateId, items, themeId) => bulkCreatePages(templateId, items, themeId)}
          onBulkCreateWithModel={(templateId, items, modelId, runId, themeId) => bulkCreateWithModel(templateId, items, modelId, runId, themeId)}
          onPreviewExtraction={(modelId, runId, items) => previewExtraction(modelId, runId, items)}
          onEditPage={(pageId) => { setShowBulkCreate(false); setSelectedPageId(pageId); }}
        />
      ) : (
        <BuilderPageList
          pages={pages}
          templates={pageLayoutTemplates}
          themes={builderThemes}
          selectedPageId={selectedPageId}
          draftName={draft.name}
          pageBackground={draft.pageBackground}
          theme={draft.theme}
          pageSlug={pageSlug}
          pageTemplateId={pageTemplateId}
          pageThemeId={pageThemeId}
          isSaving={isSaving}
          onSelectPage={setSelectedPageId}
          onPreviewPage={openPagePreview}
          onClonePage={(id) => void clonePageById(id)}
          onDeletePage={(id, name) => void deletePageById(id, name)}
          onDeletePages={(ids) => void deletePagesByIds(ids)}
          onSetDraftName={setDraftName}
          onUpdatePageBackground={updatePageBackground}
          onUpdateTheme={updateTheme}
          onSetPageSlug={setPageSlug}
          onApplyTemplate={applyTemplateToPage}
          onApplyTheme={applyThemeToPage}
          onNewPage={startNewPage}
          onBulkCreate={() => setShowBulkCreate(true)}

          onPreviewDraft={openPreviewPage}
          onMakeTemplate={() => void makeTemplateFromPage()}
          onPageEditorFocus={setPageEditorFocused}
          onSavePage={() => void savePage()}
          pageIsPrivate={pageIsPrivate}
          onSetPageIsPrivate={setPageIsPrivate}
          autoNewPage={autoNewPage}
          snapshots={snapshots}
          activeArchive={activeArchive}
          isSnapshoting={isSnapshoting}
          isRestoring={isRestoring}
          onArchivePages={(ids) => void archivePages(ids)}
          onLoadArchive={(id) => void loadArchive(id)}
          onRestoreArchive={(id) => void restoreArchive(id)}
          onDeleteSnapshot={(id) => void deleteSnapshot(id)}
        />
      )}

      {builderMode !== "modules" ? (
        <>
          <div className="builder-toolbar-shell builder-workspace-shell">
            <button
              aria-expanded={!collapsedBuilderPanels.workspace}
              className="builder-panel-toggle"
              onClick={() => toggleBuilderPanel("workspace")}
              type="button"
            >
              <span className="panel-label">Workspace</span>
              <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsedBuilderPanels.workspace} /></span>
            </button>
            {!collapsedBuilderPanels.workspace ? (
              <div className="builder-workspace-pods">
                    <div className="builder-layout-toolbar">
                      {layoutOptions.map((layout) => renderLayoutTile(layout))}
                      <div className="builder-saved-section-group">
                        <label className="field builder-cell-repository-select">
                          <strong>Saved Section</strong>
                          <select
                            key={savedSectionSelectKey}
                            defaultValue=""
                            onChange={handleSavedSectionSelect}
                          >
                            <option disabled value="">
                              — select —
                            </option>
                            {savedSections.map((savedSection) => (
                              <option key={savedSection.id} value={savedSection.id}>
                                {savedSection.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="builder-canonical-insert-label">
                          <input
                            type="checkbox"
                            checked={insertCanonical}
                            onChange={(e) => setInsertCanonical(e.target.checked)}
                          />
                          <strong>Canonical</strong>
                        </label>
                      </div>
                    </div>
                    <div
                      className={`builder-main builder-workspace ${isEmailTemplateDraft ? "builder-email-workspace" : ""} ${dragOverWorkspace ? "is-drag-over" : ""}`}
                      onDragOver={(event) => { event.preventDefault(); setDragOverWorkspace(true); }}
                      onDragLeave={() => setDragOverWorkspace(false)}
                      onDrop={handleWorkspaceDrop}
                    >
                {isEmailTemplateDraft ? (
                  <div className="builder-email-workspace-pod">
                    {draft.layoutSections.length === 0 ? (
                      <div className="builder-workspace-empty">
                        <div className="builder-workspace-empty-title">Drop a row onto the email pod</div>
                        <div className="builder-workspace-empty-copy">Email templates render inside a 600px-wide pod. Add rows and modules the same way as page templates.</div>
                      </div>
                    ) : (
                      <div className="builder-sections">
                        {draft.layoutSections.map((section, sectionIndex) => {
                          const sectionAny = section as BuilderTemplateSection & { savedSectionId?: string; canonical?: boolean };
                          const canonicalSourceName = sectionAny.savedSectionId
                            ? savedSections.find((ss) => ss.id === sectionAny.savedSectionId)?.name
                            : undefined;
                          return (
                          <BuilderSectionCard
                            isEmailTemplate
                            key={section.id}
                            section={section}
                            sectionIndex={sectionIndex}
                            editorDevice="browser"
                            isCollapsed={collapsedSectionIds.includes(section.id)}
                            expandedModuleIds={expandedModuleIds}
                            canonicalSourceName={canonicalSourceName}
                            themeColors={rteThemeColors}
                            themeStyle={getThemeRootVars(draft.theme)}
                            themeBackgroundColor={activeTheme?.backgroundColor}
                            themePrimaryColor={activeTheme?.primaryColor}
                            onToggleCanonical={(checked) => void handleToggleSectionCanonical(section.id, checked)}
                            onToggleCollapsed={() => toggleSectionCollapsed(section.id)}
                            onMoveUp={() => moveSection(section.id, -1)}
                            onMoveDown={() => moveSection(section.id, 1)}
                            onRemove={() => removeSection(section.id)}
                            onUpdateSection={(updater) => updateSection(section.id, updater)}
                            onCloneSection={() => cloneSection(section.id)}
                            onSaveSection={() => void saveSection(section.id)}
                            onUpdateCellBackground={(col, updater) => updateCellBackground(section.id, col, updater)}
                            onUpdateCellPadding={(col, value) => updateCellPadding(section.id, col, value)}
                            onUpdateCellBorderWidth={(col, value) => updateCellBorderWidth(section.id, col, value)}
                            onUpdateCellBorderColor={(col, value) => updateCellBorderColor(section.id, col, value)}
                            onUpdateCellBorderRadius={(col, value) => updateCellBorderRadius(section.id, col, value)}
                            onToggleModuleExpanded={toggleModuleExpanded}
                            onUpdateModule={(moduleId, updater) => updateModule(section.id, moduleId, updater)}
                            onUpdateModuleBackground={(moduleId, updater) => updateModuleBackground(section.id, moduleId, updater)}
                            onMoveModule={(moduleId, dir) => moveModule(section.id, moduleId, dir)}
                            onDropModule={dropModule}
                            onRemoveModule={(moduleId) => removeModule(section.id, moduleId)}
                            onCloneModule={(sectionId, moduleId) => cloneModule(sectionId, moduleId)}
                            onSaveModule={(moduleId) => void saveModule(section.id, moduleId)}
                            cellModules={cellModules}
                            pages={pages}
                            products={products}
                            onSaveCellModules={(col) => void saveCellModules(section.id, col)}
                            onInsertCellModule={(col, cellModuleId) => insertCellModule(section.id, col, cellModuleId)}
                            onInsertSavedModule={(col, cellModuleId) => insertSavedModule(section.id, col, cellModuleId)}
                            onOpenGallery={(moduleId) => openGallery(section.id, moduleId)}
                            onOpenRichTextGallery={(moduleId, anchor) =>
                              openRichTextGallery(section.id, moduleId, anchor)
                            }
                            onUploadRichTextGalleryImage={uploadRichTextGalleryImage}
                            onOpenButtonBackgroundGallery={(moduleId) => openButtonBackgroundGallery(section.id, moduleId)}
                            onOpenSocialIconGallery={(moduleId, itemId) => openSocialIconGallery(section.id, moduleId, itemId)}
                            onUploadMediaForModule={(moduleId, file) => uploadMediaForModule(section.id, moduleId, file)}
                            onUploadButtonBackgroundMedia={(moduleId, file) =>
                              uploadButtonBackgroundMedia(section.id, moduleId, file)
                            }
                            onOpenSectionBackgroundGallery={() => openSectionBackgroundGallery(section.id)}
                            onUploadSectionBackgroundMedia={(file) => uploadMediaForSectionBackground(section.id, file)}
                            onOpenModulePalette={(col, anchor) => openModulePalette(section.id, col, anchor)}
                          />
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : draft.layoutSections.length === 0 ? (
                  <div className="builder-workspace-empty">
                    <div className="builder-workspace-empty-title">Drop a row onto the workspace</div>
                    <div className="builder-workspace-empty-copy">Click a row layout above, or drag one onto the workspace.</div>
                  </div>
                ) : (
                  <div className="builder-sections">
                    {draft.layoutSections.map((section, sectionIndex) => {
                      const sectionAny = section as BuilderTemplateSection & { savedSectionId?: string; canonical?: boolean };
                      const canonicalSourceName = sectionAny.savedSectionId
                        ? savedSections.find((ss) => ss.id === sectionAny.savedSectionId)?.name
                        : undefined;
                      return (
                      <BuilderSectionCard
                        isEmailTemplate={isEmailTemplateDraft}
                        key={section.id}
                        section={section}
                        sectionIndex={sectionIndex}
                        editorDevice={previewDevice === "mobile" ? "mobile" : "browser"}
                        isCollapsed={collapsedSectionIds.includes(section.id)}
                        expandedModuleIds={expandedModuleIds}
                        canonicalSourceName={canonicalSourceName}
                        themeColors={rteThemeColors}
                        themeStyle={getThemeRootVars(draft.theme)}
                        themeBackgroundColor={activeTheme?.backgroundColor}
                        themePrimaryColor={activeTheme?.primaryColor}
                        onToggleCanonical={(checked) => void handleToggleSectionCanonical(section.id, checked)}
                        onToggleCollapsed={() => toggleSectionCollapsed(section.id)}
                        onMoveUp={() => moveSection(section.id, -1)}
                        onMoveDown={() => moveSection(section.id, 1)}
                        onRemove={() => removeSection(section.id)}
                        onUpdateSection={(updater) => updateSection(section.id, updater)}
                        onCloneSection={() => cloneSection(section.id)}
                        onSaveSection={() => void saveSection(section.id)}
                        onUpdateCellBackground={(col, updater) => updateCellBackground(section.id, col, updater)}
                        onUpdateCellPadding={(col, value) => updateCellPadding(section.id, col, value)}
                        onUpdateCellBorderWidth={(col, value) => updateCellBorderWidth(section.id, col, value)}
                        onUpdateCellBorderColor={(col, value) => updateCellBorderColor(section.id, col, value)}
                        onUpdateCellBorderRadius={(col, value) => updateCellBorderRadius(section.id, col, value)}
                        onToggleModuleExpanded={toggleModuleExpanded}
                        onUpdateModule={(moduleId, updater) => updateModule(section.id, moduleId, updater)}
                        onUpdateModuleBackground={(moduleId, updater) => updateModuleBackground(section.id, moduleId, updater)}
                        onMoveModule={(moduleId, dir) => moveModule(section.id, moduleId, dir)}
                        onDropModule={dropModule}
                        onRemoveModule={(moduleId) => removeModule(section.id, moduleId)}
                        onCloneModule={(sectionId, moduleId) => cloneModule(sectionId, moduleId)}
                        onSaveModule={(moduleId) => void saveModule(section.id, moduleId)}
                        cellModules={cellModules}
                        pages={pages}
                        products={products}
                        onSaveCellModules={(col) => void saveCellModules(section.id, col)}
                        onInsertCellModule={(col, cellModuleId) => insertCellModule(section.id, col, cellModuleId)}
                        onInsertSavedModule={(col, cellModuleId) => insertSavedModule(section.id, col, cellModuleId)}
                        onOpenGallery={(moduleId) => openGallery(section.id, moduleId)}
                        onOpenRichTextGallery={(moduleId, anchor) =>
                          openRichTextGallery(section.id, moduleId, anchor)
                        }
                        onUploadRichTextGalleryImage={uploadRichTextGalleryImage}
                        onOpenButtonBackgroundGallery={(moduleId) => openButtonBackgroundGallery(section.id, moduleId)}
                        onOpenSocialIconGallery={(moduleId, itemId) => openSocialIconGallery(section.id, moduleId, itemId)}
                        onUploadMediaForModule={(moduleId, file) => uploadMediaForModule(section.id, moduleId, file)}
                        onUploadButtonBackgroundMedia={(moduleId, file) =>
                          uploadButtonBackgroundMedia(section.id, moduleId, file)
                        }
                        onOpenSectionBackgroundGallery={() => openSectionBackgroundGallery(section.id)}
                        onUploadSectionBackgroundMedia={(file) => uploadMediaForSectionBackground(section.id, file)}
                        onOpenModulePalette={(col, anchor) => openModulePalette(section.id, col, anchor)}
                      />
                      );
                    })}
                  </div>
                )}
                    </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {builderMode !== "modules" && draft.id ? (
        <div className="builder-footer-actions">
          <button className="danger-button" onClick={() => void (builderMode === "templates" ? deleteTemplateById(draft.id, draft.name) : deletePageById(selectedPageId, draft.name))} type="button">
            {builderMode === "templates" ? "Delete Template" : "Delete Page"}
          </button>
        </div>
      ) : null}

      {isGalleryOpen ? (
        <BuilderGalleryModal
          anchor={galleryTarget?.kind === "rich-text" ? galleryAnchor : null}
          isUploading={isUploadingMedia}
          onSelectImage={selectGalleryImage}
          onClose={closeGallery}
        />
      ) : null}

      {isModulePaletteOpen ? (
        <BuilderModulePaletteModal
          activeGroup={activeModuleGroup}
          anchor={modulePaletteAnchor}
          cellModules={cellModules}
          onSelectGroup={setActiveModuleGroup}
          onSelectItem={(item) => {
            if (!modulePaletteTarget) return;
            addModuleFromPalette(modulePaletteTarget.sectionId, modulePaletteTarget.column, item);
            closeModulePalette();
          }}
          onSelectSavedModule={(cellModuleId) => {
            if (!modulePaletteTarget) return;
            insertSavedModule(modulePaletteTarget.sectionId, modulePaletteTarget.column, cellModuleId);
            closeModulePalette();
          }}
          onClose={closeModulePalette}
        />
      ) : null}
        </div>
      </div>
      {floatingSaveActions.length > 0 ? (
        <BuilderFloatingSaveRail actions={floatingSaveActions} isSaving={isSaving} />
      ) : null}
      <BuilderSaveDebugPanel
        builderMode={builderMode}
        floatingActionCount={floatingSaveActions.length}
        floatingActionLabel={floatingSaveActions[0]?.label ?? ""}
        pageEditorFocused={pageEditorFocused}
        repositorySaveActive={repositorySaveActive}
        repositorySaveFocus={repositorySaveFocus}
        repositorySaveRefFocus={repositorySaveRef.current}
        selectedPageId={selectedPageId}
        selectedTemplateId={selectedTemplateId}
        templateEditorFocused={templateEditorFocused}
      />
    </section>
  );
}
