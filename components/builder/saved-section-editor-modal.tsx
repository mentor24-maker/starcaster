import { useState } from "react";
import {
  createDefaultBackgroundSettings,
  createEmptyModule,
  normalizeBuilderAssetUrl,
  type BackgroundSettings,
  type BuilderCellModuleRecord,
  type BuilderTemplateModule,
  type BuilderTemplateSection,
} from "@/lib/builder-template";
import { appendRichTextImageToHtml } from "@/lib/rich-text-image";
import { appApi } from "@/lib/adapters/starcaster-app";
import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import type { GalleryTarget, ModulePaletteGroup, ModulePaletteItem } from "./builder-types";
import { BuilderBodyPortal } from "./builder-body-portal";
import { BuilderFloatingSaveRail } from "./builder-floating-save-rail";
import { BuilderSectionCard } from "./builder-section-card";
import { BuilderGalleryModal } from "./builder-gallery-modal";
import { BuilderModulePaletteModal } from "./builder-module-palette-modal";

type Props = {
  savedSectionId: string;
  savedSectionName: string;
  initialSection: BuilderTemplateSection;
  cellModules: BuilderCellModuleRecord[];
  onClose: () => void;
  onSaved: () => void;
};

export function SavedSectionEditorModal({
  savedSectionId,
  savedSectionName,
  initialSection,
  cellModules,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<BuilderTemplateSection>(initialSection);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedModuleIds, setExpandedModuleIds] = useState<string[]>([]);

  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState<GalleryTarget | null>(null);
  const [galleryAnchor, setGalleryAnchor] = useState<BuilderModalAnchor | null>(null);

  const [isModulePaletteOpen, setIsModulePaletteOpen] = useState(false);
  const [modulePaletteColumn, setModulePaletteColumn] = useState("main");
  const [modulePaletteAnchor, setModulePaletteAnchor] = useState<{ x: number; y: number } | null>(null);
  const [activeModuleGroup, setActiveModuleGroup] = useState<ModulePaletteGroup | null>(null);

  const [localName, setLocalName] = useState(savedSectionName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Section updaters ---

  function updateSection(updater: (s: BuilderTemplateSection) => BuilderTemplateSection) {
    setDraft((s) => {
      const updated = updater(s);
      if (updated.title !== s.title) {
        setLocalName(updated.title ?? "");
      }
      return updated;
    });
  }

  function updateCellBackground(column: string, updater: (bg: BackgroundSettings) => BackgroundSettings) {
    updateSection((s) => ({
      ...s,
      cellBackgrounds: {
        ...s.cellBackgrounds,
        [column]: updater(s.cellBackgrounds?.[column] ?? createDefaultBackgroundSettings()),
      },
    }));
  }

  function updateCellPadding(column: string, value: string) {
    updateSection((s) => ({ ...s, cellPadding: { ...s.cellPadding, [column]: value } }));
  }

  function updateCellBorderWidth(column: string, value: string) {
    updateSection((s) => ({ ...s, cellBorderWidth: { ...s.cellBorderWidth, [column]: value } }));
  }

  function updateCellBorderColor(column: string, value: string) {
    updateSection((s) => ({ ...s, cellBorderColor: { ...s.cellBorderColor, [column]: value } }));
  }

  function updateCellBorderRadius(column: string, value: string) {
    updateSection((s) => ({ ...s, cellBorderRadius: { ...s.cellBorderRadius, [column]: value } }));
  }

  // --- Module updaters ---

  function updateModule(moduleId: string, updater: (m: BuilderTemplateModule) => BuilderTemplateModule) {
    updateSection((s) => ({ ...s, modules: s.modules.map((m) => (m.id === moduleId ? updater(m) : m)) }));
  }

  function updateModuleBackground(moduleId: string, updater: (bg: BackgroundSettings) => BackgroundSettings) {
    updateModule(moduleId, (current) => {
      const next = updater({
        mode: (current.settings?.backgroundMode as BackgroundSettings["mode"]) ?? "none",
        color: current.settings?.backgroundColor ?? "",
        color2: current.settings?.backgroundColor2 ?? "",
        imageUrl: current.settings?.backgroundImageUrl ?? "",
        styleKey: current.settings?.backgroundStyleKey ?? "",
      });
      const isClear = next.mode === "none";
      return {
        ...current,
        settings: {
          ...current.settings,
          backgroundMode: next.mode,
          backgroundColor: isClear ? "" : next.color,
          backgroundColor2: isClear ? "" : next.color2,
          backgroundImageUrl: isClear ? "" : next.imageUrl,
          backgroundStyleKey: isClear ? "" : next.styleKey,
        },
      };
    });
  }

  function moveModule(moduleId: string, direction: -1 | 1) {
    updateSection((s) => {
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
    _sourceSectionId: string,
    _targetSectionId: string,
    targetColumn: string,
    targetBeforeModuleId?: string
  ) {
    updateSection((s) => {
      const sourceModule = s.modules.find((m) => m.id === moduleId);
      if (!sourceModule) return s;
      const movedModule: BuilderTemplateModule = { ...sourceModule, column: targetColumn };
      const remaining = s.modules.filter((m) => m.id !== moduleId);
      const insertAt = targetBeforeModuleId
        ? Math.max(remaining.findIndex((m) => m.id === targetBeforeModuleId), 0)
        : remaining.length;
      const nextModules = [...remaining];
      nextModules.splice(insertAt, 0, movedModule);
      return { ...s, modules: nextModules };
    });
  }

  function removeModule(moduleId: string) {
    setExpandedModuleIds((c) => c.filter((id) => id !== moduleId));
    updateSection((s) => ({ ...s, modules: s.modules.filter((m) => m.id !== moduleId) }));
  }

  function cloneModule(_sectionId: string, moduleId: string) {
    updateSection((s) => {
      const index = s.modules.findIndex((m) => m.id === moduleId);
      if (index < 0) return s;
      const original = s.modules[index];
      const clone: BuilderTemplateModule = {
        ...original,
        id: `${original.type}-${Date.now()}`,
        name: original.name ? `${original.name} (copy)` : "",
        settings: { ...original.settings },
      };
      const arr = [...s.modules];
      arr.splice(index + 1, 0, clone);
      return { ...s, modules: arr };
    });
  }

  function cloneModulesForColumn(modules: BuilderTemplateModule[], column: string): BuilderTemplateModule[] {
    return modules.map((module, index) => ({
      ...module,
      id: `${module.type}-${Date.now()}-${index}`,
      column,
      settings: { ...module.settings },
    }));
  }

  function insertCellModule(_column: string, cellModuleId: string) {
    const saved = cellModules.find((c) => c.id === cellModuleId && c.modules.length !== 1);
    if (!saved) return;
    updateSection((s) => ({ ...s, modules: [...s.modules, ...cloneModulesForColumn(saved.modules, _column)] }));
  }

  function insertSavedModule(_column: string, cellModuleId: string) {
    const saved = cellModules.find((c) => c.id === cellModuleId && c.modules.length === 1);
    if (!saved) return;
    updateSection((s) => ({ ...s, modules: [...s.modules, ...cloneModulesForColumn(saved.modules, _column)] }));
  }

  // --- Gallery ---

  function openGallery(moduleId: string) {
    setGalleryTarget({ kind: "module", sectionId: draft.id, moduleId });
    setGalleryAnchor(null);
    setIsGalleryOpen(true);
  }

  function openRichTextGallery(moduleId: string, anchor?: BuilderModalAnchor) {
    setGalleryTarget({ kind: "rich-text", sectionId: draft.id, moduleId });
    setGalleryAnchor(anchor ?? null);
    setIsGalleryOpen(true);
  }

  function openButtonBackgroundGallery(moduleId: string) {
    setGalleryTarget({ kind: "button-background", sectionId: draft.id, moduleId });
    setGalleryAnchor(null);
    setIsGalleryOpen(true);
  }

  function openSocialIconGallery(moduleId: string, itemId: string) {
    setGalleryTarget({ kind: "social-icon", sectionId: draft.id, moduleId, itemId });
    setGalleryAnchor(null);
    setIsGalleryOpen(true);
  }

  function openSectionBackgroundGallery() {
    setGalleryTarget({ kind: "section-background", sectionId: draft.id });
    setGalleryAnchor(null);
    setIsGalleryOpen(true);
  }

  function closeGallery() {
    setIsGalleryOpen(false);
    setGalleryTarget(null);
    setGalleryAnchor(null);
  }

  function selectGalleryImage(imagePath: string) {
    if (!galleryTarget) return;
    const url = normalizeBuilderAssetUrl(imagePath);

    if (galleryTarget.kind === "rich-text") {
      updateModule(galleryTarget.moduleId, (m) => ({ ...m, text: appendRichTextImageToHtml(m.text, url) }));
    } else if (galleryTarget.kind === "module") {
      updateModule(galleryTarget.moduleId, (m) => ({ ...m, settings: { ...m.settings, url } }));
    } else if (galleryTarget.kind === "button-background") {
      updateModule(galleryTarget.moduleId, (m) => ({
        ...m,
        settings: { ...m.settings, buttonBackgroundMode: "image", buttonBackgroundImageUrl: url },
      }));
    } else if (galleryTarget.kind === "social-icon") {
      const { moduleId, itemId } = galleryTarget;
      updateModule(moduleId, (current) => {
        let items: Array<Record<string, unknown>> = [];
        try {
          const parsed = JSON.parse(current.settings?.socialItems ?? "[]");
          items = Array.isArray(parsed) ? parsed : [];
        } catch { items = []; }
        return {
          ...current,
          settings: {
            ...current.settings,
            socialItems: JSON.stringify(
              items.map((item, index) => {
                const id = String(item.id ?? `social-${index + 1}`);
                return id === itemId ? { ...item, id, iconUrl: url } : { ...item, id };
              })
            ),
          },
        };
      });
    } else if (galleryTarget.kind === "section-background") {
      updateSection((s) => ({
        ...s,
        background: { ...(s.background ?? createDefaultBackgroundSettings()), mode: "image", imageUrl: url },
      }));
    }

    closeGallery();
  }

  // --- Module palette ---

  function openModulePalette(column: string, anchor?: { x: number; y: number }) {
    setModulePaletteColumn(column);
    setModulePaletteAnchor(anchor ?? null);
    setIsModulePaletteOpen(true);
  }

  function closeModulePalette() {
    setIsModulePaletteOpen(false);
    setActiveModuleGroup(null);
  }

  function addModuleFromPalette(column: string, item: ModulePaletteItem) {
    const mod = createEmptyModule(item.type, column);
    updateSection((s) => ({
      ...s,
      modules: [...s.modules, { ...mod, name: item.name, text: item.text, settings: { ...mod.settings, ...item.settings } }],
    }));
  }

  // --- Save ---

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await appApi(`/api/develop/saved-sections/${savedSectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: localName || savedSectionName, section: draft }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save section.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <BuilderBodyPortal>
      <div className="saved-section-editor-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="saved-section-editor-dialog">
          <div className="saved-section-editor-header">
            <h2 className="saved-section-editor-title">Edit: {localName || savedSectionName}</h2>
            {error && <span className="saved-section-editor-error">{error}</span>}
          </div>
          <div className="saved-section-editor-body">
            <div className="builder-workspace">
              <BuilderSectionCard
                section={draft}
                sectionIndex={0}
                editorDevice="browser"
                isCollapsed={isCollapsed}
                expandedModuleIds={expandedModuleIds}
                cellModules={cellModules}
                products={[]}
                pages={[]}
                onToggleCollapsed={() => setIsCollapsed((c) => !c)}
                onMoveUp={() => {}}
                onMoveDown={() => {}}
                onRemove={() => {}}
                onCloneSection={() => {}}
                onSaveSection={() => {}}
                onToggleCanonical={() => {}}
                onUpdateSection={(updater) => updateSection(updater)}
                onUpdateCellBackground={(col, updater) => updateCellBackground(col, updater)}
                onUpdateCellPadding={(col, val) => updateCellPadding(col, val)}
                onUpdateCellBorderWidth={(col, val) => updateCellBorderWidth(col, val)}
                onUpdateCellBorderColor={(col, val) => updateCellBorderColor(col, val)}
                onUpdateCellBorderRadius={(col, val) => updateCellBorderRadius(col, val)}
                onToggleModuleExpanded={(id) =>
                  setExpandedModuleIds((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id])
                }
                onUpdateModule={(moduleId, updater) => updateModule(moduleId, updater)}
                onUpdateModuleBackground={(moduleId, updater) => updateModuleBackground(moduleId, updater)}
                onMoveModule={(moduleId, dir) => moveModule(moduleId, dir)}
                onDropModule={(moduleId, src, tgt, col, before) => dropModule(moduleId, src, tgt, col, before)}
                onRemoveModule={(moduleId) => removeModule(moduleId)}
                onCloneModule={(sectionId, moduleId) => cloneModule(sectionId, moduleId)}
                onSaveModule={() => {}}
                onSaveCellModules={() => {}}
                onInsertCellModule={(col, id) => insertCellModule(col, id)}
                onInsertSavedModule={(col, id) => insertSavedModule(col, id)}
                onOpenGallery={(moduleId) => openGallery(moduleId)}
                onOpenRichTextGallery={(moduleId, anchor) => openRichTextGallery(moduleId, anchor)}
                onUploadRichTextGalleryImage={async () => null}
                onOpenButtonBackgroundGallery={(moduleId) => openButtonBackgroundGallery(moduleId)}
                onOpenSocialIconGallery={(moduleId, itemId) => openSocialIconGallery(moduleId, itemId)}
                onUploadMediaForModule={() => {}}
                onUploadButtonBackgroundMedia={() => {}}
                onOpenSectionBackgroundGallery={() => openSectionBackgroundGallery()}
                onUploadSectionBackgroundMedia={() => {}}
                onOpenModulePalette={(col, anchor) => openModulePalette(col, anchor)}
              />
            </div>
          </div>
        </div>
      </div>

      <BuilderFloatingSaveRail
        actions={[{ label: "Save Section", savingLabel: "Saving…", onSave: () => void handleSave() }]}
        isSaving={isSaving}
      />

      {isGalleryOpen && (
        <BuilderGalleryModal
          anchor={galleryTarget?.kind === "rich-text" ? galleryAnchor : null}
          isUploading={false}
          onSelectImage={selectGalleryImage}
          onClose={closeGallery}
        />
      )}

      {isModulePaletteOpen && (
        <BuilderModulePaletteModal
          activeGroup={activeModuleGroup}
          anchor={modulePaletteAnchor}
          cellModules={cellModules}
          onSelectGroup={setActiveModuleGroup}
          onSelectItem={(item: ModulePaletteItem) => {
            addModuleFromPalette(modulePaletteColumn, item);
            closeModulePalette();
          }}
          onSelectSavedModule={(cellModuleId) => {
            insertSavedModule(modulePaletteColumn, cellModuleId);
            closeModulePalette();
          }}
          onClose={closeModulePalette}
        />
      )}
    </BuilderBodyPortal>
  );
}
