"use client";

import { useEffect, useMemo, useState } from "react";
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
  onSelectGroup: (group: ModulePaletteGroup | null) => void;
  onSelectItem: (item: ModulePaletteItem) => void;
  onSelectSavedModule?: (cellModuleId: string) => void;
  onClose: () => void;
};

const MODULE_PALETTE_AZ_SORT_STORAGE_KEY = "starcaster-module-palette-sort-az";
const MODULE_PALETTE_POP_SORT_STORAGE_KEY = "starcaster-module-palette-sort-pop";

const GROUP_POPULARITY_ORDER: ModulePaletteGroup[] = [
  "heading",
  "text",
  "image",
  "button",
  "code",
  "navigation",
  "video",
  "quote",
  "social",
  "contact-form",
  "crm-form",
  "social-share",
  "slider",
  "speech-bubble",
  "headline-rotator",
  "reminder",
  "table",
  "merch",
  "poll-category-list",
  "previous-results",
  "current-poll",
  "floating-image",
  "special-effects"
];

type ModulePaletteGroupEntry = (typeof modulePaletteGroups)[number];

function sortModulePaletteGroups(
  groups: ModulePaletteGroupEntry[],
  sortAz: boolean,
  sortPopularity: boolean
): ModulePaletteGroupEntry[] {
  if (sortAz) {
    return [...groups].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }
  if (sortPopularity) {
    return [...groups].sort((left, right) => {
      const li = GROUP_POPULARITY_ORDER.indexOf(left.value as ModulePaletteGroup);
      const ri = GROUP_POPULARITY_ORDER.indexOf(right.value as ModulePaletteGroup);
      return (li === -1 ? 999 : li) - (ri === -1 ? 999 : ri);
    });
  }
  return groups;
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

function readPopularitySortPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.sessionStorage.getItem(MODULE_PALETTE_POP_SORT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function BuilderModulePaletteModal({
  activeGroup,
  cellModules = [],
  onSelectGroup,
  onSelectItem,
  onSelectSavedModule,
  onClose
}: BuilderModulePaletteModalProps) {
  const [mounted, setMounted] = useState(false);
  const [sortCategoriesAz, setSortCategoriesAz] = useState(false);
  const [sortCategoriesPopularity, setSortCategoriesPopularity] = useState(false);
  const displayGroups = useMemo(
    () => sortModulePaletteGroups(modulePaletteGroups, sortCategoriesAz, sortCategoriesPopularity),
    [sortCategoriesAz, sortCategoriesPopularity]
  );
  const starterModules = activeGroup ? getStarterModulesForPaletteGroup(activeGroup) : [];
  const savedModulesForGroup = activeGroup ? getSavedModulesForPaletteGroup(cellModules, activeGroup) : [];
  const classOnlyGroup = activeGroup ? isSavedModuleOnlyPaletteGroup(activeGroup) : false;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setSortCategoriesAz(readAzSortPreference());
    setSortCategoriesPopularity(readPopularitySortPreference());
  }, []);

  function toggleSortCategoriesAz() {
    setSortCategoriesAz((current) => {
      const next = !current;
      if (next) setSortCategoriesPopularity(false);
      try {
        window.sessionStorage.setItem(MODULE_PALETTE_AZ_SORT_STORAGE_KEY, next ? "1" : "0");
        if (next) window.sessionStorage.setItem(MODULE_PALETTE_POP_SORT_STORAGE_KEY, "0");
      } catch {
        // Ignore private browsing storage errors.
      }
      return next;
    });
  }

  function toggleSortCategoriesPopularity() {
    setSortCategoriesPopularity((current) => {
      const next = !current;
      if (next) setSortCategoriesAz(false);
      try {
        window.sessionStorage.setItem(MODULE_PALETTE_POP_SORT_STORAGE_KEY, next ? "1" : "0");
        if (next) window.sessionStorage.setItem(MODULE_PALETTE_AZ_SORT_STORAGE_KEY, "0");
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
      className="builder-gallery-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="builder-gallery-modal builder-module-palette-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Module library"
      >
        <div className="builder-gallery-header">
          <div>
            <div className="panel-label">Module Library</div>
            {activeGroup ? (
              <nav aria-label="Module navigation" className="builder-module-palette-breadcrumb">
                <button
                  className="builder-module-palette-breadcrumb-link"
                  onClick={() => onSelectGroup(null)}
                  type="button"
                >
                  Module Categories
                </button>
                <span aria-hidden="true" className="builder-module-palette-breadcrumb-sep">›</span>
                <strong className="builder-module-palette-breadcrumb-current">
                  {modulePaletteGroups.find((g) => g.value === activeGroup)?.label ?? activeGroup}
                </strong>
              </nav>
            ) : null}
          </div>
          <div className="builder-gallery-header-actions">
            <button
              aria-label={sortCategoriesPopularity ? "Use default category order" : "Sort by popularity"}
              aria-pressed={sortCategoriesPopularity}
              className={`builder-icon-button builder-module-palette-sort-icon${sortCategoriesPopularity ? " builder-icon-button-active" : ""}`}
              onClick={toggleSortCategoriesPopularity}
              title={sortCategoriesPopularity ? "Default order" : "Sort by popularity"}
              type="button"
            >
              <span className="builder-palette-sort-stars" aria-hidden="true">
                <span className="builder-palette-sort-star-big">★</span>
                <span className="builder-palette-sort-star-small">★</span>
              </span>
            </button>
            <button
              aria-label={sortCategoriesAz ? "Use default category order" : "Sort categories A to Z"}
              aria-pressed={sortCategoriesAz}
              className={`builder-icon-button builder-module-palette-sort-icon${sortCategoriesAz ? " builder-icon-button-active" : ""}`}
              onClick={toggleSortCategoriesAz}
              title={sortCategoriesAz ? "Default order" : "Sort A–Z"}
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
