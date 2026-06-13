"use client";

import { useEffect, useState } from "react";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";
import type { BuilderModuleEditorFocus } from "@/components/builder/builder-module-repository-list";

const DEBUG_STORAGE_KEY = "builderSaveDebug";

export function isBuilderSaveDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (window.localStorage.getItem(DEBUG_STORAGE_KEY) === "1") {
      return true;
    }
  } catch {
    return false;
  }

  return new URLSearchParams(window.location.search).get("builderSaveDebug") === "1";
}

type BuilderSaveDebugPanelProps = {
  builderMode: string;
  floatingActionCount: number;
  floatingActionLabel: string;
  pageEditorFocused: boolean;
  repositorySaveActive: boolean;
  repositorySaveFocus: BuilderModuleEditorFocus | null;
  repositorySaveRefFocus: BuilderModuleEditorFocus | null;
  selectedPageId: string;
  selectedTemplateId: string;
  templateEditorFocused: boolean;
};

export function BuilderSaveDebugPanel({
  builderMode,
  floatingActionCount,
  floatingActionLabel,
  pageEditorFocused,
  repositorySaveActive,
  repositorySaveFocus,
  repositorySaveRefFocus,
  selectedPageId,
  selectedTemplateId,
  templateEditorFocused
}: BuilderSaveDebugPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [anchorInfo, setAnchorInfo] = useState("—");

  useEffect(() => {
    setEnabled(isBuilderSaveDebugEnabled());
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function readAnchor() {
      const section = document.querySelector(".builder-editor-section");
      const shell = document.querySelector(".admin-page .admin-shell");
      const target = section ?? shell;

      if (!target) {
        setAnchorInfo("no anchor found");
        return;
      }

      const rect = target.getBoundingClientRect();
      const label = section ? ".builder-editor-section" : ".admin-shell";
      setAnchorInfo(`${label} · ${Math.round(rect.width)}×${Math.round(rect.height)} · right ${Math.round(rect.right)}px`);
    }

    readAnchor();
    window.addEventListener("resize", readAnchor);

    return () => {
      window.removeEventListener("resize", readAnchor);
    };
  }, [enabled, floatingActionCount]);

  if (!enabled || typeof document === "undefined") {
    return null;
  }

  const stateFocusKind = repositorySaveFocus?.kind ?? "(none)";
  const refFocusKind = repositorySaveRefFocus?.kind ?? "(none)";

  return (
    <BuilderBodyPortal>
    <aside aria-label="Builder save diagnostics" className="builder-save-debug-panel">
      <strong>Builder Save Debug</strong>
      <p className="builder-save-debug-hint">
        Enable with <code>?builderSaveDebug=1</code> or{" "}
        <code>localStorage.setItem(&apos;builderSaveDebug&apos;, &apos;1&apos;)</code> then reload. Focus Ref
        updates when the parent re-renders (payload-only sync may lag until the next edit).
      </p>
      <dl>
        <div>
          <dt>Mode</dt>
          <dd>{builderMode}</dd>
        </div>
        <div>
          <dt>Repository Editor Open</dt>
          <dd>{repositorySaveActive ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Focus State Kind</dt>
          <dd>{stateFocusKind}</dd>
        </div>
        <div>
          <dt>Focus Ref Kind</dt>
          <dd>{refFocusKind}</dd>
        </div>
        <div>
          <dt>Page Editor Focused</dt>
          <dd>{pageEditorFocused ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Template Editor Focused</dt>
          <dd>{templateEditorFocused ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Selected Page Id</dt>
          <dd>{selectedPageId || "(empty)"}</dd>
        </div>
        <div>
          <dt>Selected Template Id</dt>
          <dd>{selectedTemplateId || "(empty)"}</dd>
        </div>
        <div>
          <dt>Floating Actions</dt>
          <dd>
            {floatingActionCount} ({floatingActionLabel || "—"})
          </dd>
        </div>
        <div>
          <dt>Rail Mounted</dt>
          <dd>{floatingActionCount > 0 ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Save Anchor</dt>
          <dd>{anchorInfo}</dd>
        </div>
      </dl>
    </aside>
    </BuilderBodyPortal>
  );
}
