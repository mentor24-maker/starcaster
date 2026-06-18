"use client";

import { useMemo } from "react";
import type { AdminMediaItem } from "@/lib/admin-media-shared";

type Props = {
  allMedia: AdminMediaItem[];
  selectedTop: string;
  selectedSub: string;
  onSelectTop: (slug: string) => void;
  onSelectSub: (slug: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
};

function categoryLabel(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseCategory(mediaCategory: string | undefined): [string, string] {
  const parts = (mediaCategory ?? "").split(" / ").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}

export function CommunityAssetNav({
  allMedia,
  selectedTop,
  selectedSub,
  onSelectTop,
  onSelectSub,
  searchValue,
  onSearchChange,
}: Props) {
  const topCats = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of allMedia) {
      const [top] = parseCategory(item.mediaCategory);
      if (top && !seen.has(top)) {
        seen.add(top);
        result.push(top);
      }
    }
    return result.sort();
  }, [allMedia]);

  const subCats = useMemo(() => {
    if (!selectedTop) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of allMedia) {
      const [top, sub] = parseCategory(item.mediaCategory);
      if (top === selectedTop && sub && !seen.has(sub)) {
        seen.add(sub);
        result.push(sub);
      }
    }
    return result.sort();
  }, [allMedia, selectedTop]);

  return (
    <div className="community-asset-nav">
      <div className="community-asset-nav-row" role="group" aria-label="Asset category">
        <button
          className={`community-asset-nav-pill${!selectedTop ? " is-active" : ""}`}
          onClick={() => onSelectTop("")}
          type="button"
        >
          All
        </button>
        {topCats.map((slug) => (
          <button
            key={slug}
            className={`community-asset-nav-pill${selectedTop === slug ? " is-active" : ""}`}
            onClick={() => onSelectTop(slug)}
            type="button"
          >
            {categoryLabel(slug)}
          </button>
        ))}
      </div>

      {subCats.length > 0 && (
        <div className="community-asset-nav-row community-asset-nav-row-sub" role="group" aria-label="Asset subcategory">
          <button
            className={`community-asset-nav-pill community-asset-nav-pill-sub${!selectedSub ? " is-active" : ""}`}
            onClick={() => onSelectSub("")}
            type="button"
          >
            All {categoryLabel(selectedTop)}
          </button>
          {subCats.map((slug) => (
            <button
              key={slug}
              className={`community-asset-nav-pill community-asset-nav-pill-sub${selectedSub === slug ? " is-active" : ""}`}
              onClick={() => onSelectSub(slug)}
              type="button"
            >
              {categoryLabel(slug)}
            </button>
          ))}
        </div>
      )}

      <div className="community-asset-nav-search-row">
        <input
          className="community-asset-nav-search"
          type="search"
          placeholder="Search assets…"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
