"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { sortPollCategoryNames } from "@/lib/load-poll-category-catalog";
import {
  buildPollCategoryListEntries,
  normalizePollCategoryListFlow,
  normalizePollCategoryListSort,
  orderPollCategoryListForGrid,
  POLL_CATEGORY_LIST_COLUMN_COUNT,
  POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE,
  POLL_CATEGORY_LIST_DEFAULT_ITEM_GAP,
  POLL_CATEGORY_LIST_DEFAULT_TITLE,
  type PollCategoryListFlow
} from "@/lib/poll-category-list";
import { usePollCategoryCatalog } from "@/lib/use-poll-category-catalog";
import {
  getHeadingModuleStyle,
  getModuleAlignment,
  getPollCategoryListPanelStyle,
  isPollCategoryListPanelTransparent
} from "@/components/builder/builder-utils";

function usePollCategoryListColumnCount(): number {
  const [columnCount, setColumnCount] = useState(POLL_CATEGORY_LIST_COLUMN_COUNT);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");

    function syncColumnCount() {
      setColumnCount(media.matches ? 2 : POLL_CATEGORY_LIST_COLUMN_COUNT);
    }

    syncColumnCount();
    media.addEventListener("change", syncColumnCount);

    return () => media.removeEventListener("change", syncColumnCount);
  }, []);

  return columnCount;
}

export function PollCategoryListPreview({
  module,
  className = "builder-preview-poll-category-list"
}: {
  module: BuilderTemplateModule;
  className?: string;
}) {
  const categoryPickerListId = useId();
  const { catalog, isLoading, error } = usePollCategoryCatalog();
  const columnCount = usePollCategoryListColumnCount();
  const sort = normalizePollCategoryListSort(module.settings.categorySort);
  const defaultFlow = normalizePollCategoryListFlow(module.settings.categoryListFlow);
  const [flow, setFlow] = useState<PollCategoryListFlow>(defaultFlow);
  const [categoryFilter, setCategoryFilter] = useState("");
  const isTransparentPanel = isPollCategoryListPanelTransparent(module.settings);

  useEffect(() => {
    setFlow(defaultFlow);
  }, [defaultFlow]);

  const categoryNames = useMemo(
    () => sortPollCategoryNames(catalog.map((category) => category.name)),
    [catalog]
  );

  const sortedEntries = useMemo(
    () => (catalog.length > 0 ? buildPollCategoryListEntries(catalog, sort) : []),
    [catalog, sort]
  );

  const gridEntries = useMemo(
    () => orderPollCategoryListForGrid(sortedEntries, flow, columnCount),
    [sortedEntries, flow, columnCount]
  );

  const visibleEntries = useMemo(() => {
    const needle = categoryFilter.trim();
    if (!needle) {
      return gridEntries;
    }

    return gridEntries.filter((entry) => entry.name === needle);
  }, [categoryFilter, gridEntries]);

  const fontSize =
    Number.parseInt(module.settings.fontSize ?? POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE, 10) ||
    Number.parseInt(POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE, 10);
  const itemGap =
    Number.parseInt(module.settings.itemGap ?? POLL_CATEGORY_LIST_DEFAULT_ITEM_GAP, 10) ||
    Number.parseInt(POLL_CATEGORY_LIST_DEFAULT_ITEM_GAP, 10);
  const isBold = module.settings.bold !== "false";
  const textAlign = getModuleAlignment(module.settings);
  const headingStyle = getHeadingModuleStyle(module.settings);
  const panelTitle = module.settings.listTitle?.trim() || POLL_CATEGORY_LIST_DEFAULT_TITLE;

  const listStyle: CSSProperties = {
    color: module.settings.color || "#18324a",
    fontSize: `${fontSize}px`,
    fontWeight: isBold ? 700 : 400,
    textAlign,
    textShadow: headingStyle.textShadow,
    gap: `${Math.max(itemGap, 0)}px`
  };

  const panelStyle = getPollCategoryListPanelStyle(module.settings);

  return (
    <nav
      className={`${className}${isTransparentPanel ? ` ${className}--transparent` : ""}`}
      aria-label="Poll categories"
      style={panelStyle}
    >
      <header className={`${className}-header`}>
        <h2 className={`${className}-title`}>{panelTitle}</h2>
        <div className={`${className}-toolbar`}>
          <div className={`${className}-flow-toggle`} role="group" aria-label="Category sort direction">
            <button
              type="button"
              className={`secondary-button ${className}-flow-button${flow === "rows" ? ` ${className}-flow-button-active` : ""}`}
              aria-pressed={flow === "rows"}
              onClick={() => setFlow("rows")}
            >
              By Row
            </button>
            <button
              type="button"
              className={`secondary-button ${className}-flow-button${flow === "columns" ? ` ${className}-flow-button-active` : ""}`}
              aria-pressed={flow === "columns"}
              onClick={() => setFlow("columns")}
            >
              By Column
            </button>
          </div>
          <label className={`${className}-picker`}>
            <span className="sr-only">Jump to category</span>
            <input
              aria-label="Jump to category"
              className={`${className}-picker-input`}
              list={categoryPickerListId}
              onChange={(event) => setCategoryFilter(event.target.value)}
              placeholder="All categories"
              type="text"
              value={categoryFilter}
            />
            <datalist id={categoryPickerListId}>
              {categoryNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
        </div>
      </header>

      {isLoading ? (
        <p className={`${className}-status`}>Loading categories…</p>
      ) : null}
      {error ? (
        <p className={`${className}-status ${className}-error`} role="alert">
          {error}
        </p>
      ) : null}
      {!isLoading && !error && visibleEntries.length > 0 ? (
        <ul className={`${className}-items`} style={listStyle}>
          {visibleEntries.map((entry) => (
            <li key={entry.slug}>
              <Link href={entry.href}>{entry.name}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!isLoading && !error && categoryFilter.trim() && visibleEntries.length === 0 ? (
        <p className={`${className}-status`}>No category matches that filter.</p>
      ) : null}
    </nav>
  );
}
