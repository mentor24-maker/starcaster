"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";
import type { BuilderCellModuleRecord } from "@/lib/builder-template";
import {
  getSavedModulePaletteIcon,
  getSavedModulePaletteLabel,
  getSavedModulesForPaletteGroup,
  getStarterModulesForPaletteGroup,
  isSavedModuleOnlyPaletteGroup
} from "@/lib/builder-saved-module-palette";
import type { ModulePaletteGroup, ModulePaletteItem } from "./builder-types";
import { modulePaletteGroups } from "./builder-types";

export type ModulePaletteAnchor = {
  x: number;
  y: number;
};

type BuilderModulePaletteModalProps = {
  activeGroup: ModulePaletteGroup | null;
  anchor?: ModulePaletteAnchor | null;
  cellModules?: BuilderCellModuleRecord[];
  onSelectGroup: (group: ModulePaletteGroup) => void;
  onSelectItem: (item: ModulePaletteItem) => void;
  onSelectSavedModule?: (cellModuleId: string) => void;
  onClose: () => void;
};

const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_PADDING_PX = 16;

const MODULE_PALETTE_WIDTH_PX = 1200;
const MODULE_PALETTE_HEIGHT_PX = 800;
const MODULE_PALETTE_AZ_SORT_STORAGE_KEY = "normie-module-palette-sort-az";

type ModulePaletteGroupEntry = (typeof modulePaletteGroups)[number];

function sortModulePaletteGroups(groups: ModulePaletteGroupEntry[], sortAz: boolean): ModulePaletteGroupEntry[] {
  if (!sortAz) {
    return groups;
  }

  return [...groups].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
}

function readAzSortPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.sessionStorage.getItem(MODULE_PALETTE_AZ_SORT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getAnchoredModulePaletteStyle(anchor: ModulePaletteAnchor): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const modalWidth = Math.min(MODULE_PALETTE_WIDTH_PX, viewportWidth - VIEWPORT_EDGE_PADDING_PX * 2);
  const halfWidth = modalWidth / 2;
  const left = Math.min(
    Math.max(anchor.x, VIEWPORT_EDGE_PADDING_PX + halfWidth),
    viewportWidth - VIEWPORT_EDGE_PADDING_PX - halfWidth
  );
  const spaceAboveAnchor = Math.max(anchor.y - ANCHOR_GAP_PX - 24, 220);
  const modalHeight = Math.min(MODULE_PALETTE_HEIGHT_PX, spaceAboveAnchor, viewportHeight - 32);

  return {
    position: "fixed",
    left,
    bottom: viewportHeight - anchor.y + ANCHOR_GAP_PX,
    transform: "translateX(-50%)",
    width: modalWidth,
    height: modalHeight,
    maxHeight: modalHeight
  };
}

export function BuilderModulePaletteModal({
  activeGroup,
  anchor = null,
  cellModules = [],
  onSelectGroup,
  onSelectItem,
  onSelectSavedModule,
  onClose
}: BuilderModulePaletteModalProps) {
  const [mounted, setMounted] = useState(false);
  const [sortCategoriesAz, setSortCategoriesAz] = useState(false);
  const displayGroups = useMemo(
    () => sortModulePaletteGroups(modulePaletteGroups, sortCategoriesAz),
    [sortCategoriesAz]
  );
  const starterModules = activeGroup ? getStarterModulesForPaletteGroup(activeGroup) : [];
  const savedModulesForGroup = activeGroup ? getSavedModulesForPaletteGroup(cellModules, activeGroup) : [];
  const classOnlyGroup = activeGroup ? isSavedModuleOnlyPaletteGroup(activeGroup) : false;
  const isAnchored = anchor != null;
  const anchoredModalStyle = isAnchored && mounted ? getAnchoredModulePaletteStyle(anchor) : undefined;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setSortCategoriesAz(readAzSortPreference());
  }, []);

  function toggleSortCategoriesAz() {
    setSortCategoriesAz((current) => {
      const next = !current;

      try {
        window.sessionStorage.setItem(MODULE_PALETTE_AZ_SORT_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore private browsing storage errors.
      }

      return next;
    });
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
        className={`builder-gallery-modal builder-module-palette-modal${isAnchored ? " is-anchored" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Module library"
        style={anchoredModalStyle}
      >
        <div className="builder-gallery-header">
          <div>
            <div className="panel-label">Module Library</div>
            {activeGroup ? (
              <p className="page-copy admin-copy">
                {classOnlyGroup
                  ? "Choose a saved module from the Special Effects class in your repository."
                  : "Pick a starter module or insert a saved module with the same class."}
              </p>
            ) : null}
          </div>
          <div className="builder-gallery-header-actions">
            <button
              aria-label={sortCategoriesAz ? "Use default category order" : "Sort categories A to Z"}
              aria-pressed={sortCategoriesAz}
              className={`secondary-button builder-module-palette-az-sort${sortCategoriesAz ? " is-active" : ""}`}
              onClick={toggleSortCategoriesAz}
              title={sortCategoriesAz ? "Default Order" : "Sort A–Z"}
              type="button"
            >
              A–Z
            </button>
            <button className="secondary-button" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>

        {activeGroup ? (
          <>
            <div className="builder-module-group-tabs">
              {displayGroups.map((group) => (
                <button
                  className={`builder-module-group-tab ${activeGroup === group.value ? "is-active" : ""}`}
                  key={group.value}
                  onClick={() => onSelectGroup(group.value)}
                  type="button"
                >
                  <span className="builder-module-group-icon">{group.icon}</span>
                  <span>{group.label}</span>
                </button>
              ))}
            </div>
            {starterModules.length > 0 ? (
              <div className="builder-module-palette-section">
                <div className="builder-module-palette-section-label">Starter Modules</div>
                <div className="builder-module-item-grid">
                  {starterModules.map((item) => (
                    <button
                      className="builder-module-item-card"
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      type="button"
                    >
                      <span className="builder-module-item-icon">{item.icon}</span>
                      <strong>{item.label}</strong>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {savedModulesForGroup.length > 0 ? (
              <div className="builder-module-palette-section">
                {!classOnlyGroup ? (
                  <div className="builder-module-palette-section-label">Saved Modules</div>
                ) : null}
                <div className="builder-module-item-grid">
                  {savedModulesForGroup.map((cellModule) => {
                    const savedModule = cellModule.modules[0];

                    if (!savedModule) {
                      return null;
                    }

                    return (
                      <button
                        className="builder-module-item-card builder-module-item-card-saved"
                        key={cellModule.id}
                        onClick={() => onSelectSavedModule?.(cellModule.id)}
                        type="button"
                      >
                        <span className="builder-module-item-icon">{getSavedModulePaletteIcon(savedModule)}</span>
                        <strong>{getSavedModulePaletteLabel(cellModule)}</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : classOnlyGroup ? (
              <p className="panel-copy builder-module-palette-empty">
                No saved modules with Module class Special Effects yet. Create one in the Modules workspace, assign
                that class, then return here.
              </p>
            ) : null}
          </>
        ) : (
          <div className="builder-module-group-grid">
            {displayGroups.map((group) => (
              <button
                className="builder-module-group-card"
                key={group.value}
                onClick={() => onSelectGroup(group.value)}
                type="button"
              >
                <span className="builder-module-group-card-icon">{group.icon}</span>
                <strong>{group.label}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
    </BuilderBodyPortal>
  );
}
