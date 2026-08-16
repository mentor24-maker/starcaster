import type { ReactNode } from "react";
import type { ModulePaletteGroup } from "./builder-types";

/**
 * Line icons for the module-library category cards.
 *
 * The palette used single characters ("H", "CF", "P?", "≡") which stop
 * working as a navigation aid the moment there are more than a dozen
 * categories — several were already ambiguous, and the operator expects
 * dozens of categories over hundreds of modules. These are drawn in the
 * repo's established icon house style (see src/css/CLAUDE.md "Pods"):
 * Lucide-style strokes on a 24×24 grid, `currentColor`, no fills, so they
 * inherit the card's colour and stay crisp at any size.
 *
 * A group with no entry here falls back to its `icon` string from
 * `modulePaletteGroups`, so adding a category never breaks the palette —
 * it just looks plainer until an icon is drawn for it.
 */

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false
};

function Icon({ children }: { children: ReactNode }) {
  return <svg {...SVG_PROPS}>{children}</svg>;
}

export const MODULE_GROUP_ICONS: Partial<Record<ModulePaletteGroup, ReactNode>> = {
  // Menu bar with a highlighted active item.
  navigation: (
    <Icon>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h3M11 10h3M16 10h2" />
      <path d="M6 14h5" />
    </Icon>
  ),
  // A capital H, the universal heading mark.
  heading: (
    <Icon>
      <path d="M6 4v16M18 4v16M6 12h12" />
    </Icon>
  ),
  // Text lines cycling under a rotation arrow.
  "headline-rotator": (
    <Icon>
      <path d="M4 8h11M4 13h8" />
      <path d="M20 5v5h-5" />
      <path d="M20 10a7 7 0 0 1-11.6 5.3" />
    </Icon>
  ),
  // Paragraph rules.
  text: (
    <Icon>
      <path d="M4 6h16M4 10h16M4 14h12M4 18h8" />
    </Icon>
  ),
  // Angle brackets.
  code: (
    <Icon>
      <path d="M8.5 8 4 12l4.5 4M15.5 8 20 12l-4.5 4" />
      <path d="M13.5 5.5 10.5 18.5" />
    </Icon>
  ),
  // Shopping bag.
  merch: (
    <Icon>
      <path d="M5 7h14l-1 13H6L5 7Z" />
      <path d="M9 10V6a3 3 0 0 1 6 0v4" />
    </Icon>
  ),
  // Framed picture with a horizon and sun.
  image: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5-5-6 8" />
    </Icon>
  ),
  // A picture lifted off the page, its original outline dashed behind it.
  "floating-image": (
    <Icon>
      <path d="M4 16V7a2 2 0 0 1 2-2h9" strokeDasharray="3 2.5" />
      <rect x="8" y="9" width="12" height="10" rx="2" />
      <path d="M20 16l-3.5-3.5L12 17" />
    </Icon>
  ),
  // Play badge.
  video: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M11 9.5v5l4-2.5-4-2.5Z" />
    </Icon>
  ),
  // Opening and closing quote marks.
  quote: (
    <Icon>
      <path d="M9 7c-2.5 0-4 1.8-4 4.2 0 1.9 1.3 3.3 3 3.3 1.5 0 2.6-1 2.6-2.4 0-1.3-.9-2.3-2.2-2.3-.3 0-.6 0-.8.1C7.9 8.6 8.4 7.9 9 7Z" />
      <path d="M18 7c-2.5 0-4 1.8-4 4.2 0 1.9 1.3 3.3 3 3.3 1.5 0 2.6-1 2.6-2.4 0-1.3-.9-2.3-2.2-2.3-.3 0-.6 0-.8.1.3-1.3.8-2 1.4-2.9Z" />
    </Icon>
  ),
  // Rounded bubble with a tail.
  "speech-bubble": (
    <Icon>
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-.9 0-1.8-.1-2.6-.35L5 20.5l1.2-3A6.1 6.1 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
    </Icon>
  ),
  // Bell.
  reminder: (
    <Icon>
      <path d="M18 9a6 6 0 0 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
      <path d="M10.5 19a1.8 1.8 0 0 0 3 0" />
    </Icon>
  ),
  // A button with a pointer on it.
  button: (
    <Icon>
      <rect x="2.5" y="6.5" width="19" height="8.5" rx="4.25" />
      <path d="M13 14l2.6 6 1.4-3.2 3.2-1L13 14Z" />
    </Icon>
  ),
  // Form fields with a submit button.
  "contact-form": (
    <Icon>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M7 8.5h10M7 12h10" />
      <rect x="7" y="15" width="6" height="2.5" rx="1.25" />
    </Icon>
  ),
  // A contact record: person on a card.
  "crm-form": (
    <Icon>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.5 16c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4" />
      <path d="M15.5 10h3.5M15.5 13.5h3.5" />
    </Icon>
  ),
  // Sign-in: a door with an arrow going through it.
  "player-portal": (
    <Icon>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l4 4-4 4" />
      <path d="M14 12H4" />
    </Icon>
  ),
  // Past results: a chart with a history arrow.
  "previous-results": (
    <Icon>
      <path d="M4 20V10M9 20V6M14 20v-7M19 20V9" />
      <path d="M3.5 4.5 6 7l2.5-2.5" />
    </Icon>
  ),
  // Live poll: bars with a tick.
  "current-poll": (
    <Icon>
      <path d="M5 20V12M10 20V5M15 20v-6" />
      <path d="M17.5 8.5 19 10l3-3.5" />
      <path d="M20 13v7" />
    </Icon>
  ),
  // Category list.
  "poll-category-list": (
    <Icon>
      <circle cx="5" cy="7" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="5" cy="17" r="1.2" />
      <path d="M9.5 7h10M9.5 12h10M9.5 17h6" />
    </Icon>
  ),
  // Share: nodes joined by lines.
  "social-share": (
    <Icon>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M15.8 6.8 8.2 10.7M8.2 13.3l7.6 3.9" />
    </Icon>
  ),
  // At-sign.
  social: (
    <Icon>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 8.5v4.8c0 1.5.9 2.4 2.2 2.4 1.6 0 2.6-1.4 2.6-3.6A8.4 8.4 0 1 0 15 19.6" />
    </Icon>
  ),
  // Grid with a header row.
  table: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9.5h18M9.5 9.5V19M15 9.5V19" />
    </Icon>
  ),
  // A framed item with more waiting either side and dots beneath — true of
  // both formats, which is the point of the merged module.
  carousel: (
    <Icon>
      <rect x="7" y="6" width="10" height="11" rx="2" />
      <path d="M3.5 9v5M20.5 9v5" />
      <path d="M9 20h6" />
    </Icon>
  ),
  // A row of tiles — the module itself.
  "feature-cards": (
    <Icon>
      <rect x="2.5" y="6" width="5.5" height="12" rx="1.5" />
      <rect x="9.25" y="6" width="5.5" height="12" rx="1.5" />
      <rect x="16" y="6" width="5.5" height="12" rx="1.5" />
      <path d="M4 14.5h2.5M10.75 14.5h2.5M17.5 14.5h2.5" />
    </Icon>
  ),
  // Chevron trail.
  breadcrumb: (
    <Icon>
      <path d="M3 12h3.5M9 9l3 3-3 3M14.5 12H18" />
      <path d="M20 9l1.5 3-1.5 3" />
    </Icon>
  ),
  // Pen over a page.
  blog: (
    <Icon>
      <path d="M19 4.5 21 6.5 11.5 16l-3 1 1-3L19 4.5Z" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </Icon>
  ),
  // Sparkles.
  "special-effects": (
    <Icon>
      <path d="M12 3.5 13.6 8 18 9.5 13.6 11 12 15.5 10.4 11 6 9.5 10.4 8 12 3.5Z" />
      <path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
      <path d="M5.5 14l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4L3.6 16l1.4-.5.5-1.4Z" />
    </Icon>
  ),
  // Gear.
  admin: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </Icon>
  )
};

export function getModuleGroupIcon(group: ModulePaletteGroup): ReactNode | null {
  return MODULE_GROUP_ICONS[group] ?? null;
}
