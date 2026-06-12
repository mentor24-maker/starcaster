import Image from "next/image";
import { type CSSProperties, type DragEvent, useRef, useState } from "react";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import type {
  BackgroundSettings,
  BuilderProductRecord,
  BuilderTemplateModule,
  BuilderTemplateModuleType
} from "@/lib/builder-template";
import {
  createEmptyModule,
  getBuilderBackgroundStyle,
  normalizeBuilderAssetUrl,
  formatRichTextContent
} from "@/lib/builder-template";
import { resolveBuilderDrillDownSurfaceBackground } from "@/lib/builder-drill-down-surface";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { normalizeSocialIconBackgroundColor } from "@/lib/social-icon-background";
import { sanitizeEmbedHtml } from "@/lib/sanitize-html";
import {
  HEADLINE_ROTATOR_DEFAULT_FONT_SIZE,
  HEADLINE_ROTATOR_MAX_Y_PERCENT,
  getHeadlineRotatorSkyPosition,
  parseHeadlineRotatorItemsForEditor,
  serializeHeadlineRotatorEntries,
  type HeadlineRotatorEntry
} from "@/lib/headline-rotator";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import {
  DEFAULT_SHARE_TEMPLATE,
  SOCIAL_SHARE_PLATFORMS,
  SocialShareBar,
  getSocialSharePlatformEnabled,
  type SocialSharePlatformId
} from "@/components/social-share-module";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { MerchModuleEditor } from "./builder-merch-module-editor";
import { BuilderCodeEmbed } from "./builder-code-embed";
import { BuilderFloatingImageModuleSettings } from "./builder-floating-image-module-settings";
import { BuilderSpeechBubbleModuleSettings } from "./builder-speech-bubble-module-settings";
import { BuilderReminderModuleSettings } from "./builder-reminder-module-settings";
import { parseReminderRecordsFromModule } from "@/lib/builder-reminder-module";
import { SpeechBubblePreview } from "./speech-bubble-preview";
import { getConfettiTrigger } from "@/lib/confetti-effect";
import { getModuleTrigger } from "@/lib/module-trigger";
import {
  builderModuleShowsTriggerSettings
} from "@/lib/module-class-triggers";
import { BuilderConfettiRuntime } from "@/components/builder-confetti-runtime";
import { BuilderConfettiModuleSettings } from "./builder-confetti-module-settings";
import { BuilderModuleTriggerSettings } from "./builder-module-trigger-settings";
import { BuilderCurrentPollModuleSettings } from "./builder-current-poll-module-settings";
import { BuilderSocialModuleSettings } from "./builder-social-module-settings";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import { BuilderImagePreview } from "./builder-image-preview";
import { modulePaletteGroups, modulePaletteItems } from "./builder-types";
import type { ModulePaletteGroup, ModulePaletteItem } from "./builder-types";
import {
  getAlignmentClass,
  getHeadingModuleStyle,
  getModuleAlignment,
  getModuleBackgroundSettings,
  isPollCategoryListPanelTransparent,
  getModuleMarginStyle,
  getModuleOuterSpacingStyle,
  getVerticalMarginStyle,
  getButtonModuleStyle,
  getVideoEmbedSource,
  isVideoMedia
} from "./builder-utils";
import { BuilderButtonDesignSettings } from "./builder-button-design-settings";
import { BuilderHeadingModuleSettings } from "./builder-heading-module-settings";
import { BuilderPlayerPortalSettings } from "./builder-player-portal-settings";
import { getPlayerPortalAuthSettings, PlayerPortalAuthForm } from "@/components/player-portal-auth-form";
import { BuilderSettingRow } from "./builder-setting-row";
import { PollCategoryListPreview } from "./poll-category-list-preview";
import {
  normalizePollCategoryListFlow,
  normalizePollCategoryListSort,
  POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE,
  POLL_CATEGORY_LIST_DEFAULT_ITEM_GAP,
  POLL_CATEGORY_LIST_DEFAULT_TITLE,
  type PollCategoryListFlow,
  type PollCategoryListSort
} from "@/lib/poll-category-list";
import {
  BuilderInlineNumberSelect,
  BuilderInlineNumberSelectRow,
  BuilderNumberSelectControl
} from "./builder-inline-number-select";

type BuilderModuleCardProps = {
  module: BuilderTemplateModule;
  products?: BuilderProductRecord[];
  sectionId: string;
  editorDevice: "browser" | "mobile";
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (bg: BackgroundSettings) => BackgroundSettings) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onOpenGallery: () => void;
  onOpenRichTextGallery?: (anchor?: BuilderModalAnchor) => void;
  onUploadRichTextGalleryImage?: (file: File) => Promise<string | null>;
  onOpenButtonBackgroundGallery?: () => void;
  onOpenSocialIconGallery: (itemId: string) => void;
  onUploadMedia: (file: File | null) => void;
  onUploadButtonBackgroundMedia?: (file: File | null) => void;
  onClone: () => void;
  onSaveModule?: () => void;
  hideHeaderActions?: boolean;
  isEmailTemplate?: boolean;
  moduleClassOverride?: string;
  onModuleDragStart?: (event: DragEvent<HTMLDivElement>) => void;
};

type ContactFormField = {
  id: string;
  label: string;
  type: "text" | "email" | "tel";
};

function getContactFormMode(settings: Record<string, string>): "squeeze" | "standard" | "custom" {
  return settings.formMode === "standard" || settings.formMode === "custom"
    ? settings.formMode
    : "squeeze";
}

function getContactFormFields(mode: "squeeze" | "standard" | "custom"): ContactFormField[] {
  const standardFields: ContactFormField[] = [
    { id: "firstName", label: "First name", type: "text" },
    { id: "lastName", label: "Last name", type: "text" },
    { id: "email", label: "Email", type: "email" },
    { id: "phone", label: "Phone", type: "tel" }
  ];

  if (mode === "squeeze") {
    return [standardFields[0], standardFields[2]];
  }

  return standardFields;
}

function renderContactFormPreview(settings: Record<string, string>, interactive = false) {
  const mode = getContactFormMode(settings);
  const fields = getContactFormFields(mode);
  const Tag = interactive ? "form" : "div";

  return (
    <Tag className="builder-contact-form" onSubmit={interactive ? (event) => event.preventDefault() : undefined}>
      <div className="builder-contact-form-fields">
        {fields.map((field) => (
          <label className="builder-contact-form-field" key={field.id}>
            <span>{field.label}</span>
            {interactive ? (
              <input type={field.type} placeholder={field.label} />
            ) : (
              <span className="builder-contact-form-input-preview">{field.label}</span>
            )}
          </label>
        ))}
      </div>
      {mode === "custom" ? (
        <div className="builder-contact-form-stub">Custom form builder coming soon. Standard fields are shown for now.</div>
      ) : null}
      {interactive ? (
        <button className="builder-contact-form-submit" type="submit">
          Submit
        </button>
      ) : (
        <span className="builder-contact-form-submit builder-contact-form-submit-preview">
          Submit
        </span>
      )}
    </Tag>
  );
}

function renderMerchProductCard(settings: Record<string, string>) {
  const productName = settings.productName || "Merch product";
  const imageUrl = normalizeBuilderAssetUrl(settings.imageUrl);
  const productUrl = normalizeBuilderAssetUrl(settings.productUrl);
  const buttonLabel = settings.buttonLabel || "Buy on Redbubble";

  return (
    <div className="product-card">
      {imageUrl ? (
        <img src={imageUrl} alt={productName} suppressHydrationWarning />
      ) : (
        <div className="builder-module-preview-placeholder">Fetch a product URL</div>
      )}
      <h3>{productName}</h3>
      {productUrl ? (
        <a href={productUrl} target="_blank" rel="noopener noreferrer">
          {buttonLabel}
        </a>
      ) : null}
    </div>
  );
}

function renderModulePreview(module: BuilderTemplateModule) {
  const variant = module.settings.variant ?? "";

  if (module.type === "heading") {
    const Tag = (module.settings.level || "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

    return (
      <div className="builder-module-preview-copy">
        <Tag
          className={`builder-module-preview-heading builder-module-preview-heading-${variant || "default"}`}
          style={getHeadingModuleStyle(module.settings)}
        >
          {module.text || "Heading"}
        </Tag>
      </div>
    );
  }

  if (module.type === "quote") {
    return (
      <blockquote className={`builder-module-preview-quote builder-module-preview-quote-${variant || "default"}`}>
        {module.text || "Quote"}
      </blockquote>
    );
  }

  if (module.type === "speech-bubble") {
    return <SpeechBubblePreview classNamePrefix="builder-module-preview" module={module} />;
  }

  if (module.type === "reminder") {
    const recordCount = parseReminderRecordsFromModule(module).length;
    return (
      <div className="builder-module-preview-reminder">
        <p>
          <strong>Reminders</strong> — {recordCount} configured; live overlays when visitor criteria match (not in the
          column layout).
        </p>
      </div>
    );
  }

  if (module.type === "poll-category-list") {
    return (
      <div className="builder-module-preview-copy">
        <PollCategoryListPreview className="builder-module-preview-poll-category-list" module={module} />
      </div>
    );
  }

  if (module.type === "headline-rotator") {
    const items = parseHeadlineItems(module.settings);
    const fontSize =
      Number.parseInt(module.settings.fontSize ?? HEADLINE_ROTATOR_DEFAULT_FONT_SIZE, 10) ||
      Number.parseInt(HEADLINE_ROTATOR_DEFAULT_FONT_SIZE, 10);
    const color = module.settings.color || "#18324a";
    const isBold = module.settings.bold !== "false";
    const horizontal = getModuleAlignment(module.settings);
    const verticalAlignment =
      (module.settings.verticalAlignment as "top" | "center" | "bottom") || "center";
    const minHeight = Math.max(Number.parseInt(module.settings.minHeight ?? "0", 10) || 0, 0);
    const justify =
      verticalAlignment === "top" ? "flex-start" : verticalAlignment === "bottom" ? "flex-end" : "center";
    const first = items[0]?.label || "Headline Rotator";

    return (
      <div className="builder-module-preview-copy">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: justify,
            minHeight: minHeight ? `${minHeight}px` : undefined,
            textAlign: horizontal,
            color,
            fontSize: `${fontSize}px`,
            fontWeight: isBold ? 700 : 400,
            textShadow: getHeadingModuleStyle(module.settings).textShadow
          }}
        >
          {first}
        </div>
        <div className="builder-module-editor-copy">
          {items.length > 0 ? `${items.length} headline${items.length === 1 ? "" : "s"}` : "No headlines yet"}
        </div>
      </div>
    );
  }

  if (module.type === "button") {
    const s = module.settings;
    const sizeClass = `builder-preview-button-${s.buttonSize ?? "medium"}`;
    const btnStyle = getButtonModuleStyle(s);
    return (
      <div className="builder-module-preview-copy">
        <span
          className={`builder-preview-button builder-preview-button-styled builder-preview-button-${variant || "default"} ${sizeClass}`}
          style={btnStyle}
        >
          {module.text || "Button"}
        </span>
      </div>
    );
  }

  if (module.type === "code") {
    return (
      <div className="builder-code-module-preview">
        <div className="builder-code-module-preview-label">
          {module.settings.label || module.name || "Code snippet"}
        </div>
        {module.text ? (
          <BuilderCodeEmbed
            html={sanitizeEmbedHtml(module.text)}
            className="builder-code-module-render"
            requireActivation={false}
          />
        ) : (
          <div className="builder-module-preview-placeholder">Add embed code or HTML</div>
        )}
      </div>
    );
  }

  if (module.type === "merch") {
    return renderMerchProductCard(module.settings);
  }

  if (module.type === "contact-form") {
    return renderContactFormPreview(module.settings);
  }

  if (module.type === "player-portal") {
    return (
      <PlayerPortalAuthForm
        settings={getPlayerPortalAuthSettings(module.settings)}
        heading={module.text}
        previewMode
      />
    );
  }

  if (module.type === "video" || (module.type === "image" && module.settings.variant === "video")) {
    const embed = getVideoEmbedSource(module.settings.url);
    const title = module.settings.videoName || module.name || module.text || "Video";
    const opensInNewTab = module.settings.newTab !== "false";

    return (
      <figure className="builder-preview-video-card builder-module-preview-video-card">
        <div className="builder-preview-video-frame">
          {embed?.kind === "iframe" ? (
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              src={embed.src}
              title={title}
            />
          ) : embed?.kind === "video" ? (
            <video className="builder-preview-video" controls preload="metadata" src={embed.src} />
          ) : (
            <div className="builder-module-preview-placeholder">Add a video embed URL</div>
          )}
          {embed ? (
            <a
              aria-label={`Open ${title} in a new tab`}
              className="builder-preview-video-link"
              href={embed.href}
              rel={opensInNewTab ? "noopener noreferrer" : undefined}
              target={opensInNewTab ? "_blank" : undefined}
            />
          ) : null}
        </div>
        {title ? (
          <figcaption className="builder-preview-video-caption">
            <strong>{title}</strong>
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (module.type === "image" || module.type === "floating-image") {
    return (
      <BuilderImagePreview
        module={module}
        variant={variant}
        imageClassName="builder-preview-image builder-module-preview-image"
        placeholder={
          module.type === "floating-image" ? "Choose a floating image" : "Choose an image or video"
        }
      />
    );
  }
  if (module.type === "table") {
    const td = parseTableData(module.settings);
    const borderW = Number.parseInt(module.settings.borderWidth || "1", 10);
    const borderC = module.settings.borderColor || "#cccccc";
    const cellPad = Number.parseInt(module.settings.cellPadding || "8", 10);
    const bgColor = module.settings.backgroundColor || "#ffffff";

    return (
      <div className="builder-module-preview-table-wrap">
        <table
          className="builder-module-preview-table"
          style={{
            borderCollapse: "collapse",
            width: "100%",
            border: `${borderW}px solid ${borderC}`,
            background: bgColor
          }}
        >
          {td.headers.length > 0 && (
            <thead>
              <tr>
                {td.headers.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      border: `${borderW}px solid ${borderC}`,
                      padding: `${cellPad}px`,
                      textAlign: "left",
                      fontWeight: 600
                    }}
                  >
                    {h || "\u00A0"}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {Array.from({ length: td.rowCount }, (_, ri) => (
              <tr key={ri}>
                {td.headers.map((_, ci) => {
                  const cellMods = td.cells[`${ri}-${ci}`] || [];
                  return (
                    <td
                      key={ci}
                      style={{
                        border: `${borderW}px solid ${borderC}`,
                        padding: `${cellPad}px`,
                        verticalAlign: "top"
                      }}
                    >
                      {cellMods.length > 0
                        ? cellMods.map((m) => (
                            <div key={m.id} className="builder-table-cell-module-label">
                              {m.name || m.type}
                            </div>
                          ))
                        : "\u00A0"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (module.type === "slider") {
    const items = parseSliderItems(module.settings);
    const gap = Number.parseInt(module.settings.sliderGap || "16", 10);
    const cardWidth = Number.parseInt(module.settings.sliderCardWidth || "280", 10);

    return (
      <div className="builder-module-preview-slider" style={{ gap: `${gap}px` }}>
        {items.length > 0 ? (
          items.map((item) => (
            <article
              key={item.id}
              className="builder-module-preview-slider-card"
              style={{ minWidth: `${cardWidth}px` }}
            >
              {item.imageUrl ? (
                <div className="builder-module-preview-slider-image">
                  <Image
                    alt={item.title || "Slider item"}
                    fill
                    sizes="220px"
                    src={item.imageUrl}
                    unoptimized
                  />
                </div>
              ) : null}
              <div className="builder-module-preview-slider-copy">
                <strong>{item.title || "Slide title"}</strong>
                <p>{item.body || "Slide body"}</p>
              </div>
            </article>
          ))
        ) : (
          <div className="builder-module-preview-placeholder">Add slider items</div>
        )}
      </div>
    );
  }

  if (module.type === "social") {
    const items = parseSocialItems(module.settings);
    const gap = Number.parseInt(module.settings.socialGap || "14", 10);
    const iconSize = Number.parseInt(module.settings.socialIconSize || "44", 10);
    const showLabels = module.settings.socialShowLabels !== "false";

    return (
      <div className="builder-module-preview-social" style={{ gap: `${gap}px` }}>
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} className="builder-module-preview-social-entry">
              <a
                className="builder-module-preview-social-item"
                href={item.href || "#"}
                rel="noopener noreferrer"
                target="_blank"
                aria-label={item.label || "Social link"}
                style={{
                  width: `${iconSize}px`,
                  height: `${iconSize}px`,
                  background: item.backgroundColor
                }}
              >
                {item.iconUrl ? (
                  <Image alt={item.label || "Social icon"} fill sizes={`${iconSize}px`} src={item.iconUrl} unoptimized />
                ) : (
                  <span className="builder-module-preview-social-fallback">{item.label.slice(0, 1) || "@"}</span>
                )}
              </a>
              {showLabels ? <span className="builder-module-preview-social-label">{item.label || "Social"}</span> : null}
            </div>
          ))
        ) : (
          <div className="builder-module-preview-placeholder">Add social icons</div>
        )}
      </div>
    );
  }

  if (module.type === "previous-results") {
    return (
      <article className="panel result-panel builder-module-preview-poll">
        <div className="panel-label">Previous Results</div>
        <h2>Live result bars from the previous community poll.</h2>
        <div className="result-list">
          <div className="result-row">
            <div className="result-meta">
              <span>Option A</span>
              <span>124 · 62%</span>
            </div>
            <div className="result-bar">
              <div className="result-bar-fill" style={{ width: "62%" }} />
            </div>
          </div>
          <div className="result-row">
            <div className="result-meta">
              <span>Option B</span>
              <span>76 · 38%</span>
            </div>
            <div className="result-bar">
              <div className="result-bar-fill" style={{ width: "38%" }} />
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (module.type === "current-poll") {
    return (
      <article className="panel action-panel builder-module-preview-poll">
        <div className="panel-label">Current Question</div>
        <h2>Live current poll prompt with answer choices.</h2>
        <div className="option-list">
          <div className="option-button">Option One</div>
          <div className="option-button">Option Two</div>
        </div>
        <p className="panel-copy">
          This module uses the real live poll and vote flow in page preview and on the live site.
        </p>
      </article>
    );
  }

  if (module.type === "social-share") {
    return (
      <SocialShareBar
        preview
        settings={module.settings}
        poll={{
          id: "preview-poll",
          question: module.settings.shareFallbackQuestion || "Would you rather be right alone or wrong with everyone?",
          options: []
        }}
      />
    );
  }

  if (module.type === "confetti") {
    return <BuilderConfettiRuntime preview settings={module.settings} />;
  }

  return (
    <div
      className={`builder-module-preview-paragraph builder-module-preview-text-${variant || "default"}`}
      dangerouslySetInnerHTML={{ __html: formatRichTextContent(module.text) || "<p>Text block</p>" }}
    />
  );
}

type ParsedTableData = {
  headers: string[];
  cells: Record<string, BuilderTemplateModule[]>;
  rowCount: number;
};

type SliderItem = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  linkUrl: string;
};

type SocialItem = {
  id: string;
  label: string;
  href: string;
  iconUrl: string;
  backgroundColor: string;
};

type NavItem = {
  id: string;
  label: string;
  href: string;
};

type HeadlineItem = HeadlineRotatorEntry;

function parseHeadlineItems(settings: Record<string, string>): HeadlineItem[] {
  return parseHeadlineRotatorItemsForEditor(settings.headlines ?? "", settings.color || "#18324a");
}

function serializeHeadlineItems(items: HeadlineItem[]) {
  return serializeHeadlineRotatorEntries(items);
}

function parseNavItems(settings: Record<string, string>): NavItem[] {
  try {
    const items = JSON.parse(settings.navItems || "[]");
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: String(raw.id || `nav-${index + 1}`),
        label: String(raw.label || ""),
        href: String(raw.href || "")
      };
    });
  } catch {
    return [];
  }
}

function serializeNavItems(items: NavItem[]) {
  return JSON.stringify(items);
}

function renderCompactCellModulePreview(module: BuilderTemplateModule) {
  return <div className="builder-table-cell-module-preview">{renderModulePreview(module)}</div>;
}

function parseSliderItems(settings: Record<string, string>): SliderItem[] {
  try {
    const items = JSON.parse(settings.sliderItems || "[]");
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: String(raw.id || `slide-${index + 1}`),
        title: String(raw.title || ""),
        body: String(raw.body || ""),
        imageUrl: normalizeBuilderAssetUrl(raw.imageUrl),
        linkUrl: String(raw.linkUrl || "")
      };
    });
  } catch {
    return [];
  }
}

function serializeSliderItems(items: SliderItem[]) {
  return JSON.stringify(items);
}

function parseSocialItems(settings: Record<string, string>): SocialItem[] {
  try {
    const items = JSON.parse(settings.socialItems || "[]");
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: String(raw.id || `social-${index + 1}`),
        label: String(raw.label || ""),
        href: String(raw.href || ""),
        iconUrl: normalizeBuilderAssetUrl(raw.iconUrl),
        backgroundColor: normalizeSocialIconBackgroundColor(raw.backgroundColor)
      };
    });
  } catch {
    return [];
  }
}

function parseTableData(settings: Record<string, string>): ParsedTableData {
  try {
    const data = JSON.parse(settings.tableData || "{}");
    const headers: string[] = Array.isArray(data.headers) ? data.headers : [];

    if (data.cells && typeof data.rowCount === "number") {
      const cells: Record<string, BuilderTemplateModule[]> = {};
      for (const [key, mods] of Object.entries(data.cells)) {
        cells[key] = Array.isArray(mods) ? (mods as BuilderTemplateModule[]) : [];
      }
      return { headers, cells, rowCount: data.rowCount };
    }

    if (Array.isArray(data.rows)) {
      const cells: Record<string, BuilderTemplateModule[]> = {};
      for (let ri = 0; ri < data.rows.length; ri++) {
        const row = data.rows[ri];
        if (!Array.isArray(row)) continue;
        for (let ci = 0; ci < row.length; ci++) {
          const text = String(row[ci] || "");
          if (text) {
            const mod = createEmptyModule("text", "");
            mod.text = text;
            mod.name = "Text";
            cells[`${ri}-${ci}`] = [mod];
          }
        }
      }
      return { headers, cells, rowCount: data.rows.length };
    }

    return { headers, cells: {}, rowCount: Math.max(Number(data.rowCount) || 0, 1) };
  } catch {
    return { headers: [], cells: {}, rowCount: 1 };
  }
}

function serializeTableData(td: ParsedTableData): string {
  return JSON.stringify({ headers: td.headers, cells: td.cells, rowCount: td.rowCount });
}

function cloneTableCellModule(module: BuilderTemplateModule, suffix: string): BuilderTemplateModule {
  return {
    ...module,
    id: `${module.type}-${Date.now()}-${suffix}`,
    settings: { ...module.settings }
  };
}

/* ---------- Inline palette for table cells ---------- */

function TableCellInlinePalette({
  onSelect,
  onClose,
  position
}: {
  onSelect: (item: ModulePaletteItem) => void;
  onClose: () => void;
  position: { top: number; left: number };
}) {
  const [group, setGroup] = useState<ModulePaletteGroup | null>(null);
  const groups = modulePaletteGroups.filter((g) => g.value !== "table" && g.value !== "contact-form");
  const items = group ? modulePaletteItems.filter((item) => item.group === group) : [];

  return (
    <div
      className="builder-table-inline-palette"
      onClick={(e) => e.stopPropagation()}
      style={{ top: position.top, left: position.left }}
    >
      <div className="builder-table-palette-header">
        <strong>{group ? "Choose a module" : "Choose a group"}</strong>
        <button type="button" className="builder-icon-button" onClick={onClose}>✕</button>
      </div>
      {group ? (
        <>
          <div className="builder-table-palette-tabs">
            {groups.map((g) => (
              <button
                key={g.value}
                type="button"
                className={`builder-table-palette-tab ${group === g.value ? "is-active" : ""}`}
                onClick={() => setGroup(g.value)}
              >
                {g.icon} {g.label}
              </button>
            ))}
          </div>
          <div className="builder-table-palette-items">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="builder-table-palette-item"
                onClick={() => onSelect(item)}
              >
                <span className="builder-module-item-icon">{item.icon}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="builder-table-palette-groups">
          {groups.map((g) => (
            <button
              key={g.value}
              type="button"
              className="builder-table-palette-group-btn"
              onClick={() => setGroup(g.value)}
            >
              <span className="builder-module-group-card-icon">{g.icon}</span>
              <strong>{g.label}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Table cell module list ---------- */

function TableCellModules({
  cellKey,
  modules,
  onUpdate
}: {
  cellKey: string;
  modules: BuilderTemplateModule[];
  onUpdate: (cellKey: string, modules: BuilderTemplateModule[]) => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [palettePos, setPalettePos] = useState({ top: 0, left: 0 });
  const addBtnRef = useRef<HTMLButtonElement | null>(null);

  function addModule(item: ModulePaletteItem) {
    const mod = createEmptyModule(item.type, "");
    const newMod = { ...mod, name: item.name, text: item.text, settings: { ...mod.settings, ...item.settings } };
    onUpdate(cellKey, [...modules, newMod]);
    setPaletteOpen(false);
  }

  function removeModule(id: string) {
    onUpdate(cellKey, modules.filter((m) => m.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function moveModule(id: string, direction: -1 | 1) {
    const index = modules.findIndex((m) => m.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= modules.length) return;
    const nextModules = [...modules];
    const [moved] = nextModules.splice(index, 1);
    nextModules.splice(targetIndex, 0, moved);
    onUpdate(cellKey, nextModules);
  }

  function updateModuleField(id: string, field: string, value: string) {
    onUpdate(cellKey, modules.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  }

  function updateModuleSettings(id: string, updates: Record<string, string>) {
    onUpdate(
      cellKey,
      modules.map((m) =>
        m.id === id ? { ...m, settings: { ...m.settings, ...updates } } : m
      )
    );
  }

  return (
    <div className="builder-table-cell-modules" onClick={(e) => e.stopPropagation()}>
      {modules.map((mod) => (
        <div key={mod.id} className="builder-table-cell-module">
          <div className="builder-table-cell-module-header">
            <button
              aria-expanded={editingId === mod.id}
              type="button"
              className="builder-table-cell-module-toggle"
              onClick={() => setEditingId(editingId === mod.id ? null : mod.id)}
            >
              <span className="builder-table-cell-module-label">{mod.name || mod.type}</span>
              <span className="builder-collapse-chevron"><BuilderCollapseIcon expanded={editingId === mod.id} /></span>
            </button>
            <button type="button" className="builder-icon-button" onClick={() => moveModule(mod.id, -1)} title="Move up">↑</button>
            <button type="button" className="builder-icon-button" onClick={() => moveModule(mod.id, 1)} title="Move down">↓</button>
            <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeModule(mod.id)} title="Remove">✕</button>
          </div>
          {editingId !== mod.id ? renderCompactCellModulePreview(mod) : null}
          {editingId === mod.id && (
            <div className="builder-table-cell-module-editor">
              <label className="field">
                <span>Module label</span>
                <input type="text" value={mod.name} onChange={(e) => updateModuleField(mod.id, "name", e.target.value)} placeholder="Optional internal label" />
              </label>

              {mod.type === "heading" ? (
                <BuilderHeadingModuleSettings
                  compact
                  module={mod}
                  onUpdateModule={(updater) => {
                    onUpdate(cellKey, modules.map((item) => (item.id === mod.id ? updater(item) : item)));
                  }}
                />
              ) : null}

              {mod.type === "text" && (
                <label className="field">
                  <span>Content</span>
                  <BuilderRichTextEditor value={mod.text} onChange={(value) => updateModuleField(mod.id, "text", value)} />
                </label>
              )}

              {mod.type === "quote" && (
                <label className="field">
                  <span>Content</span>
                  <textarea className="builder-textarea" value={mod.text} onChange={(e) => updateModuleField(mod.id, "text", e.target.value)} placeholder="Enter content" rows={2} />
                </label>
              )}

              {mod.type === "button" && (
                <div className="builder-table-cell-button-settings">
                  <BuilderSettingRow label="Button label" fullWidth>
                    <input
                      type="text"
                      value={mod.text}
                      onChange={(e) => updateModuleField(mod.id, "text", e.target.value)}
                      placeholder="Button text"
                    />
                  </BuilderSettingRow>
                  <BuilderSettingRow label="Link" fullWidth>
                    <input
                      type="text"
                      value={mod.settings.href ?? ""}
                      onChange={(e) => updateModuleSettings(mod.id, { href: e.target.value })}
                      placeholder="/path-or-url"
                    />
                  </BuilderSettingRow>
                  <BuilderSettingRow label="Button color">
                    <input
                      type="color"
                      value={mod.settings.buttonColor ?? "#214c71"}
                      onChange={(e) => updateModuleSettings(mod.id, { buttonColor: e.target.value })}
                    />
                  </BuilderSettingRow>
                  <BuilderSettingRow label="Text color">
                    <input
                      type="color"
                      value={mod.settings.textColor ?? "#ffffff"}
                      onChange={(e) => updateModuleSettings(mod.id, { textColor: e.target.value })}
                    />
                  </BuilderSettingRow>
                </div>
              )}

              {mod.type === "image" && (
                <>
                  <label className="field">
                    <span>Media URL</span>
                    <input type="text" value={mod.settings.url ?? ""} onChange={(e) => updateModuleSettings(mod.id, { url: normalizeBuilderAssetUrl(e.target.value) })} placeholder="https://..." />
                  </label>
                  <div className="builder-table-cell-module-inline-grid">
                    <label className="field">
                      <span>Alt text</span>
                      <input type="text" value={mod.settings.alt ?? ""} onChange={(e) => updateModuleSettings(mod.id, { alt: e.target.value })} placeholder="Image description" />
                    </label>
                    <label className="field">
                      <span>Size</span>
                      <select value={mod.settings.size ?? "100"} onChange={(e) => updateModuleSettings(mod.id, { size: e.target.value })}>
                        <option value="10">10%</option>
                        <option value="15">15%</option>
                        <option value="25">25%</option>
                        <option value="33">33%</option>
                        <option value="50">50%</option>
                        <option value="66">66%</option>
                        <option value="75">75%</option>
                        <option value="100">100%</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Border color</span>
                      <input type="color" value={mod.settings.borderColor ?? "#0f4f8f"} onChange={(e) => updateModuleSettings(mod.id, { borderColor: e.target.value })} />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="builder-table-cell-add-wrap">
        <button
          ref={(el) => { addBtnRef.current = el; }}
          type="button"
          className="builder-table-cell-add"
          onClick={(e) => {
            e.stopPropagation();
            if (!paletteOpen && addBtnRef.current) {
              const rect = addBtnRef.current.getBoundingClientRect();
              setPalettePos({ top: rect.bottom + 4, left: rect.left });
            }
            setPaletteOpen(!paletteOpen);
          }}
          title="Add module to this cell"
        >
          ⊕
        </button>
        {paletteOpen && (
          <TableCellInlinePalette
            onSelect={addModule}
            onClose={() => setPaletteOpen(false)}
            position={palettePos}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Table module editor ---------- */

function TableModuleEditor({
  module,
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  const td = parseTableData(module.settings);
  const colCount = td.headers.length;

  function persist(newTd: ParsedTableData) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, tableData: serializeTableData(newTd) } }));
  }

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  function addColumn() {
    if (colCount >= 10) return;
    persist({ ...td, headers: [...td.headers, `Column ${colCount + 1}`] });
  }

  function removeColumn() {
    if (colCount <= 1) return;
    const newCells = { ...td.cells };
    for (let r = 0; r < td.rowCount; r++) delete newCells[`${r}-${colCount - 1}`];
    persist({ headers: td.headers.slice(0, -1), cells: newCells, rowCount: td.rowCount });
  }

  function addRow() {
    if (td.rowCount >= 100) return;
    persist({ ...td, rowCount: td.rowCount + 1 });
  }

  function cloneRow(rowIndex: number) {
    if (td.rowCount >= 100) return;

    const nextCells: ParsedTableData["cells"] = {};

    for (const [key, modules] of Object.entries(td.cells)) {
      const [rawRow, rawCol] = key.split("-");
      const sourceRow = Number.parseInt(rawRow, 10);

      if (!Number.isFinite(sourceRow)) {
        nextCells[key] = modules;
        continue;
      }

      if (sourceRow <= rowIndex) {
        nextCells[key] = modules;
      } else {
        nextCells[`${sourceRow + 1}-${rawCol}`] = modules;
      }
    }

    for (let col = 0; col < colCount; col++) {
      const sourceModules = td.cells[`${rowIndex}-${col}`] || [];
      nextCells[`${rowIndex + 1}-${col}`] = sourceModules.map((mod, moduleIndex) =>
        cloneTableCellModule(mod, `${rowIndex + 1}-${col}-${moduleIndex}`)
      );
    }

    persist({ ...td, cells: nextCells, rowCount: td.rowCount + 1 });
  }

  function removeRow() {
    if (td.rowCount <= 1) return;
    const newCells = { ...td.cells };
    for (let c = 0; c < colCount; c++) delete newCells[`${td.rowCount - 1}-${c}`];
    persist({ ...td, cells: newCells, rowCount: td.rowCount - 1 });
  }

  function updateHeader(index: number, value: string) {
    const newHeaders = [...td.headers];
    newHeaders[index] = value;
    persist({ ...td, headers: newHeaders });
  }

  function updateCellModules(cellKey: string, modules: BuilderTemplateModule[]) {
    persist({ ...td, cells: { ...td.cells, [cellKey]: modules } });
  }

  return (
    <>
      <div className="builder-table-design-grid">
        <BuilderInlineNumberSelectRow>
          <BuilderInlineNumberSelect
            label="Border width"
            value={module.settings.borderWidth ?? "1"}
            min={0}
            max={6}
            fallback="1"
            onChange={(value) => updateSetting("borderWidth", value)}
          />
          <BuilderInlineNumberSelect
            label="Cell padding"
            value={module.settings.cellPadding ?? "8"}
            min={2}
            max={24}
            fallback="8"
            onChange={(value) => updateSetting("cellPadding", value)}
          />
        </BuilderInlineNumberSelectRow>
        <label className="field"><span>Border color</span><input type="color" value={module.settings.borderColor ?? "#cccccc"} onChange={(e) => updateSetting("borderColor", e.target.value)} /></label>
        <label className="field"><span>Background</span><input type="color" value={module.settings.backgroundColor ?? "#ffffff"} onChange={(e) => updateSetting("backgroundColor", e.target.value)} /></label>
      </div>
      <div className="builder-table-structure-actions">
        <span>Columns: {colCount}</span>
        <button type="button" className="secondary-button" onClick={addColumn} disabled={colCount >= 10}>+ Col</button>
        <button type="button" className="secondary-button" onClick={removeColumn} disabled={colCount <= 1}>− Col</button>
        <span>Rows: {td.rowCount}</span>
        <button type="button" className="secondary-button" onClick={addRow} disabled={td.rowCount >= 100}>+ Row</button>
        <button type="button" className="secondary-button" onClick={removeRow} disabled={td.rowCount <= 1}>− Row</button>
      </div>
      <div className="builder-table-editor-scroll">
        <table className="builder-table-editor builder-table-editor-modules">
          <thead>
            <tr>
              <th className="builder-table-row-action-heading">Row</th>
              {td.headers.map((h, i) => (
                <th key={i}>
                  <input type="text" value={h} onChange={(e) => updateHeader(i, e.target.value)} placeholder={`Header ${i + 1}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: td.rowCount }, (_, ri) => (
              <tr key={ri}>
                <td className="builder-table-row-actions">
                  <button type="button" className="builder-icon-button" onClick={() => cloneRow(ri)} disabled={td.rowCount >= 100} title="Clone row">
                    ⧉
                  </button>
                </td>
                {td.headers.map((_, ci) => (
                  <td key={ci} className="builder-table-editor-cell">
                    <TableCellModules cellKey={`${ri}-${ci}`} modules={td.cells[`${ri}-${ci}`] || []} onUpdate={updateCellModules} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SliderModuleEditor({
  module,
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  const items = parseSliderItems(module.settings);

  function persist(nextItems: SliderItem[]) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, sliderItems: serializeSliderItems(nextItems) } }));
  }

  function updateItem(id: string, updates: Partial<SliderItem>) {
    persist(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const nextItems = [...items];
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(target, 0, moved);
    persist(nextItems);
  }

  function removeItem(id: string) { persist(items.filter((item) => item.id !== id)); }

  function addItem() {
    persist([...items, { id: `slide-${Date.now()}-${items.length + 1}`, title: "", body: "", imageUrl: "", linkUrl: "" }]);
  }

  return (
    <>
      <div className="builder-slider-design-grid">
        <BuilderInlineNumberSelectRow>
          <BuilderInlineNumberSelect
            label="Card width"
            value={module.settings.sliderCardWidth ?? "280"}
            min={180}
            max={420}
            step={10}
            fallback="280"
            onChange={(value) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, sliderCardWidth: value } }))
            }
          />
          <BuilderInlineNumberSelect
            label="Gap"
            value={module.settings.sliderGap ?? "16"}
            min={8}
            max={40}
            step={2}
            fallback="16"
            onChange={(value) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, sliderGap: value } }))
            }
          />
        </BuilderInlineNumberSelectRow>
      </div>
      <div className="builder-slider-items">
        {items.map((item, index) => (
          <div key={item.id} className="builder-slider-item-card">
            <div className="builder-slider-item-header">
              <strong>{item.title || `Slide ${index + 1}`}</strong>
              <div className="builder-section-actions">
                <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} title="Move up">↑</button>
                <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} title="Move down">↓</button>
                <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} title="Delete slide">✕</button>
              </div>
            </div>
            <div className="builder-slider-item-grid">
              <label className="field"><span>Title</span><input type="text" value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} /></label>
              <label className="field"><span>Link</span><input type="text" value={item.linkUrl} onChange={(e) => updateItem(item.id, { linkUrl: e.target.value })} placeholder="/path-or-url" /></label>
              <label className="field builder-slider-item-grid-full"><span>Image URL</span><input type="text" value={item.imageUrl} onChange={(e) => updateItem(item.id, { imageUrl: normalizeBuilderAssetUrl(e.target.value) })} placeholder="https://..." /></label>
              <label className="field builder-slider-item-grid-full"><span>Description</span><textarea className="builder-textarea" rows={3} value={item.body} onChange={(e) => updateItem(item.id, { body: e.target.value })} placeholder="Add copy for this slide" /></label>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="secondary-button" onClick={addItem}>Add Slide</button>
    </>
  );
}

function SocialShareModuleEditor({
  module,
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  function platformSettingKey(platformId: SocialSharePlatformId, suffix: string) {
    return `share${platformId}${suffix}`;
  }

  function getPlatformColor(platformId: SocialSharePlatformId, fallback: string) {
    const color = module.settings[platformSettingKey(platformId, "Color")];
    return color?.startsWith("#") ? color : fallback;
  }

  return (
    <>
      <div className="builder-slider-design-grid">
        <label className="field">
          <span>Share label</span>
          <input
            type="text"
            value={module.settings.shareLabel ?? "Share this poll"}
            onChange={(event) => updateSetting("shareLabel", event.target.value)}
          />
        </label>
        <label className="field">
          <span>URL override</span>
          <input
            type="text"
            value={module.settings.shareUrl ?? ""}
            onChange={(event) => updateSetting("shareUrl", event.target.value)}
            placeholder="Leave blank to use current page URL"
          />
        </label>
        <label className="field">
          <span>Fallback question</span>
          <input
            type="text"
            value={module.settings.shareFallbackQuestion ?? ""}
            onChange={(event) => updateSetting("shareFallbackQuestion", event.target.value)}
            placeholder="Used only when no current poll is available"
          />
        </label>
        <label className="field">
          <span>Hashtags</span>
          <input
            type="text"
            value={module.settings.shareHashtags ?? ""}
            onChange={(event) => updateSetting("shareHashtags", event.target.value)}
            placeholder="Normie,WYR"
          />
        </label>
        <label className="field">
          <span>X via</span>
          <input
            type="text"
            value={module.settings.shareVia ?? ""}
            onChange={(event) => updateSetting("shareVia", event.target.value)}
            placeholder="Normie765714"
          />
        </label>
        <BuilderInlineNumberSelectRow>
          <BuilderInlineNumberSelect
            label="Label font size"
            value={module.settings.shareLabelSize ?? "14"}
            min={8}
            max={64}
            fallback="14"
            onChange={(value) => updateSetting("shareLabelSize", value)}
          />
          <BuilderInlineNumberSelect
            label="Icon size"
            value={module.settings.shareIconSize ?? "36"}
            min={20}
            max={120}
            step={2}
            fallback="36"
            onChange={(value) => updateSetting("shareIconSize", value)}
          />
        </BuilderInlineNumberSelectRow>
        <label className="field">
          <span>Icon background</span>
          <input
            type="color"
            value={module.settings.shareIconBackground?.startsWith("#") ? module.settings.shareIconBackground : "#ffffff"}
            onChange={(event) => updateSetting("shareIconBackground", event.target.value)}
          />
        </label>
        <BuilderInlineNumberSelectRow>
          <BuilderInlineNumberSelect
            label="Glyph size"
            value={module.settings.shareGlyphSize ?? "20"}
            min={10}
            max={96}
            fallback="20"
            onChange={(value) => updateSetting("shareGlyphSize", value)}
          />
          <BuilderInlineNumberSelect
            label="Icon gap"
            value={module.settings.shareIconGap ?? "12"}
            min={0}
            max={64}
            fallback="12"
            onChange={(value) => updateSetting("shareIconGap", value)}
          />
        </BuilderInlineNumberSelectRow>
      </div>
      <label className="field">
        <span>Default post template</span>
        <textarea
          className="builder-textarea"
          rows={3}
          value={module.settings.shareTemplate ?? DEFAULT_SHARE_TEMPLATE}
          onChange={(event) => updateSetting("shareTemplate", event.target.value)}
          placeholder={DEFAULT_SHARE_TEMPLATE}
        />
      </label>
      <div className="builder-slider-items">
        {SOCIAL_SHARE_PLATFORMS.map((platform) => (
          <div className="builder-slider-item-card" key={platform.id}>
            <div className="builder-slider-item-header">
              <strong>{platform.label}</strong>
              <label className="field builder-checkbox-field">
                <span>Show</span>
                <input
                  type="checkbox"
                  checked={getSocialSharePlatformEnabled(module.settings, platform.id)}
                  onChange={(event) =>
                    updateSetting(platformSettingKey(platform.id, "Enabled"), event.target.checked ? "true" : "false")
                  }
                />
              </label>
            </div>
            <div className="builder-slider-item-grid">
              <label className="field">
                <span>Button color</span>
                <input
                  type="color"
                  value={getPlatformColor(platform.id, platform.color)}
                  onChange={(event) => updateSetting(platformSettingKey(platform.id, "Color"), event.target.value)}
                />
              </label>
              {platform.id === "instagram" ? (
                <label className="field builder-slider-item-grid-full">
                  <span>Instagram URL</span>
                  <input
                    type="text"
                    value={module.settings[platformSettingKey(platform.id, "Url")] ?? ""}
                    onChange={(event) => updateSetting(platformSettingKey(platform.id, "Url"), event.target.value)}
                    placeholder="https://www.instagram.com/your-profile"
                  />
                </label>
              ) : null}
              {platform.supportsText ? (
                <label className="field builder-slider-item-grid-full">
                  <span>Post template</span>
                  <textarea
                    className="builder-textarea"
                    rows={3}
                    value={module.settings[platformSettingKey(platform.id, "Template")] ?? ""}
                    onChange={(event) => updateSetting(platformSettingKey(platform.id, "Template"), event.target.value)}
                    placeholder="Leave blank to use the default template"
                  />
                </label>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function NavModuleEditor({
  module,
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  const items = parseNavItems(module.settings);

  function persist(nextItems: NavItem[]) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, navItems: serializeNavItems(nextItems) } }));
  }

  function updateItem(id: string, updates: Partial<NavItem>) {
    persist(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const nextItems = [...items];
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(target, 0, moved);
    persist(nextItems);
  }

  function removeItem(id: string) { persist(items.filter((item) => item.id !== id)); }

  function addItem() {
    persist([...items, { id: `nav-${Date.now()}-${items.length + 1}`, label: "", href: "" }]);
  }

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  return (
    <>
      <div className="builder-slider-design-grid">
        <label className="field"><span>Font size (px)</span><input type="number" min="10" max="48" value={module.settings.navFontSize ?? "16"} onChange={(e) => updateSetting("navFontSize", e.target.value)} /></label>
        <label className="field builder-checkbox-field"><span>Bold</span><input type="checkbox" checked={module.settings.navBold === "true"} onChange={(e) => updateSetting("navBold", e.target.checked ? "true" : "false")} /></label>
        <label className="field"><span>Border radius (px)</span><input type="number" min="0" max="48" value={module.settings.navBorderRadius ?? "0"} onChange={(e) => updateSetting("navBorderRadius", e.target.value)} /></label>
        <label className="field"><span>Padding</span><input type="text" value={module.settings.navPadding ?? "8px 12px"} onChange={(e) => updateSetting("navPadding", e.target.value)} placeholder="8px 12px" /></label>
        <label className="field"><span>Text color</span><input type="text" value={module.settings.navColor ?? ""} onChange={(e) => updateSetting("navColor", e.target.value)} placeholder="#ffffff" /></label>
        <label className="field"><span>Hover text color</span><input type="text" value={module.settings.navHoverColor ?? ""} onChange={(e) => updateSetting("navHoverColor", e.target.value)} placeholder="#ffffff" /></label>
        <label className="field"><span>Hover background</span><input type="text" value={module.settings.navHoverBackground ?? ""} onChange={(e) => updateSetting("navHoverBackground", e.target.value)} placeholder="#e8f8ff" /></label>
      </div>
      <div className="builder-slider-items">
        {items.map((item, index) => (
          <div key={item.id} className="builder-slider-item-card">
            <div className="builder-slider-item-header">
              <strong>{item.label || `Link ${index + 1}`}</strong>
              <div className="builder-section-actions">
                <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} title="Move up">↑</button>
                <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} title="Move down">↓</button>
                <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} title="Delete link">✕</button>
              </div>
            </div>
            <div className="builder-slider-item-grid">
              <label className="field"><span>Label</span><input type="text" value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} /></label>
              <label className="field"><span>Link</span><input type="text" value={item.href} onChange={(e) => updateItem(item.id, { href: e.target.value })} placeholder="/path-or-url" /></label>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="secondary-button" onClick={addItem}>Add Nav Item</button>
    </>
  );
}

function PollCategoryListModuleEditor({
  module,
  onUpdateModule,
  onUpdateModuleBackground
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
}) {
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  const sort = normalizePollCategoryListSort(module.settings.categorySort);
  const listFlow = normalizePollCategoryListFlow(module.settings.categoryListFlow);

  return (
    <>
      <div className="builder-poll-category-list-module-chrome">
        <BuilderBackgroundControls
          label="Background"
          background={getModuleBackgroundSettings(module.settings)}
          horizontal
          onChange={onUpdateModuleBackground}
        />
        {!isPollCategoryListPanelTransparent(module.settings) ? (
          <BuilderSettingRow label="Panel Border" fullWidth>
            <input
              type="color"
              value={
                module.settings.panelBorderColor?.startsWith("#")
                  ? module.settings.panelBorderColor
                  : "#c6e8f5"
              }
              onChange={(event) => updateSetting("panelBorderColor", event.target.value)}
            />
          </BuilderSettingRow>
        ) : null}
      </div>
      <BuilderSettingRow label="Headline" fullWidth>
        <input
          type="text"
          value={module.settings.listTitle ?? POLL_CATEGORY_LIST_DEFAULT_TITLE}
          onChange={(event) => updateSetting("listTitle", event.target.value)}
        />
      </BuilderSettingRow>
      <BuilderSettingRow label="Sort" fullWidth>
        <select
          value={sort}
          onChange={(event) => updateSetting("categorySort", event.target.value as PollCategoryListSort)}
        >
          <option value="alphabetical">Alphabetical</option>
          <option value="canonical">Canonical</option>
        </select>
      </BuilderSettingRow>
      <BuilderSettingRow label="Default Layout" fullWidth>
        <select
          value={listFlow}
          onChange={(event) => updateSetting("categoryListFlow", event.target.value as PollCategoryListFlow)}
        >
          <option value="rows">By Row</option>
          <option value="columns">By Column</option>
        </select>
      </BuilderSettingRow>
      <BuilderSettingRow label="Font Size">
        <input
          type="number"
          min={10}
          max={120}
          value={module.settings.fontSize ?? POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE}
          onChange={(event) => updateSetting("fontSize", event.target.value)}
        />
      </BuilderSettingRow>
      <BuilderSettingRow label="Color">
        <input
          type="text"
          value={module.settings.color ?? "#18324a"}
          onChange={(event) => updateSetting("color", event.target.value)}
          placeholder="#18324a"
        />
      </BuilderSettingRow>
      <BuilderSettingRow label="Bold">
        <input
          type="checkbox"
          checked={module.settings.bold !== "false"}
          onChange={(event) => updateSetting("bold", event.target.checked ? "true" : "false")}
        />
      </BuilderSettingRow>
      <BuilderSettingRow label="Alignment" fullWidth>
        <BuilderAlignmentIconGroup
          value={getModuleAlignment(module.settings)}
          onChange={(value) => updateSetting("alignment", value)}
        />
      </BuilderSettingRow>
      <BuilderSettingRow label="Item Gap">
        <input
          type="number"
          min={0}
          max={48}
          value={module.settings.itemGap ?? POLL_CATEGORY_LIST_DEFAULT_ITEM_GAP}
          onChange={(event) => updateSetting("itemGap", event.target.value)}
        />
      </BuilderSettingRow>
      <p className="builder-module-editor-copy">
        Lists seeded categories plus every category used on polls (same set as the Polls Manager filter). Each link
        opens the home page with that category filter.
      </p>
    </>
  );
}

function HeadlineRotatorModuleEditor({
  module,
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  const items = parseHeadlineItems(module.settings);

  function persist(nextItems: HeadlineItem[]) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, headlines: serializeHeadlineItems(nextItems) } }));
  }

  function updateItem(id: string, updates: Partial<HeadlineItem>) {
    persist(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const nextItems = [...items];
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(target, 0, moved);
    persist(nextItems);
  }

  function removeItem(id: string) { persist(items.filter((item) => item.id !== id)); }

  function addItem() {
    const position = getHeadlineRotatorSkyPosition(items.length);
    persist([
      ...items,
      {
        id: `headline-${Date.now()}-${items.length + 1}`,
        label: "",
        href: "",
        xAxis: position.xAxis,
        yAxis: position.yAxis,
        color: module.settings.color || "#18324a",
        overlap: "400"
      }
    ]);
  }

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  return (
    <>
      <div className="builder-slider-design-grid">
        <label className="field"><span>Font size (px)</span><input type="number" min="10" max="120" value={module.settings.fontSize ?? HEADLINE_ROTATOR_DEFAULT_FONT_SIZE} onChange={(e) => updateSetting("fontSize", e.target.value)} /></label>
        <label className="field"><span>Color</span><input type="text" value={module.settings.color ?? "#18324a"} onChange={(e) => updateSetting("color", e.target.value)} placeholder="#18324a" /></label>
        <label className="field builder-checkbox-field"><span>Bold</span><input type="checkbox" checked={module.settings.bold !== "false"} onChange={(e) => updateSetting("bold", e.target.checked ? "true" : "false")} /></label>
        <label className="field"><span>Vertical alignment</span><select value={module.settings.verticalAlignment ?? "center"} onChange={(e) => updateSetting("verticalAlignment", e.target.value)}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
        <label className="field"><span>Min height (px)</span><input type="number" min="0" max="1200" step="4" value={module.settings.minHeight ?? "480"} onChange={(e) => updateSetting("minHeight", e.target.value)} /></label>
        <label className="field"><span>Fade duration (ms)</span><input type="number" min="0" max="5000" step="50" value={module.settings.fadeDuration ?? "800"} onChange={(e) => updateSetting("fadeDuration", e.target.value)} /></label>
        <label className="field"><span>Display speed (ms)</span><input type="number" min="500" max="20000" step="100" value={module.settings.displaySpeed ?? "3000"} onChange={(e) => updateSetting("displaySpeed", e.target.value)} /></label>
        <label className="field"><span>Drop shadow</span><select value={module.settings.dropShadow ?? "false"} onChange={(e) => updateSetting("dropShadow", e.target.value)}><option value="false">Off</option><option value="true">On</option></select></label>
        <label className="field"><span>Shadow color</span><input type="color" value={module.settings.dropShadowColor?.startsWith("#") ? module.settings.dropShadowColor : "#000000"} onChange={(e) => updateSetting("dropShadowColor", e.target.value)} /></label>
        <label className="field"><span>Shadow X</span><input type="number" min="-20" max="20" step="1" value={module.settings.dropShadowX ?? "3"} onChange={(e) => updateSetting("dropShadowX", e.target.value)} /></label>
        <label className="field"><span>Shadow Y</span><input type="number" min="-20" max="20" step="1" value={module.settings.dropShadowY ?? "3"} onChange={(e) => updateSetting("dropShadowY", e.target.value)} /></label>
        <label className="field"><span>Shadow blur</span><input type="number" min="0" max="30" step="1" value={module.settings.dropShadowBlur ?? "2"} onChange={(e) => updateSetting("dropShadowBlur", e.target.value)} /></label>
      </div>
      <div className="builder-headline-table-wrap">
        <table className="builder-headline-table">
          <thead>
            <tr>
              <th>Headline</th>
              <th>Link</th>
              <th>X-axis</th>
              <th>Y-axis</th>
              <th>Color</th>
              <th>Overlap (ms)</th>
              <th>Order</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td>
                  <input
                    aria-label={`Headline ${index + 1}`}
                    type="text"
                    value={item.label}
                    onChange={(e) => updateItem(item.id, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Headline ${index + 1} link`}
                    type="text"
                    value={item.href}
                    onChange={(e) => updateItem(item.id, { href: e.target.value })}
                    placeholder="/path-or-url"
                  />
                </td>
                <td>
                  <input
                    aria-label={`Headline ${index + 1} x-axis`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    title="Horizontal position (0 = left, 100 = right)"
                    value={item.xAxis}
                    onChange={(e) => updateItem(item.id, { xAxis: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Headline ${index + 1} y-axis`}
                    type="number"
                    min="0"
                    max={String(HEADLINE_ROTATOR_MAX_Y_PERCENT)}
                    step="1"
                    title={`Vertical position in the sky band (0 = top, ${HEADLINE_ROTATOR_MAX_Y_PERCENT} = just above horizon)`}
                    value={item.yAxis}
                    onChange={(e) => updateItem(item.id, { yAxis: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Headline ${index + 1} color`}
                    type="color"
                    value={item.color.startsWith("#") ? item.color : module.settings.color || "#18324a"}
                    onChange={(e) => updateItem(item.id, { color: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Headline ${index + 1} overlap`}
                    type="number"
                    min="0"
                    max="10000"
                    step="50"
                    title="Milliseconds the next headline fades in before the current one finishes (e.g. 400 with 800ms fade)"
                    value={item.overlap}
                    onChange={(e) => updateItem(item.id, { overlap: e.target.value })}
                  />
                </td>
                <td>
                  <div className="builder-headline-table-actions">
                    <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} title="Move up">↑</button>
                    <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} title="Move down">↓</button>
                    <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} title="Delete headline">✕</button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={7}>No headlines yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <button type="button" className="secondary-button" onClick={addItem}>Add Headline</button>
    </>
  );
}

export function BuilderModuleCard({
  module,
  sectionId,
  editorDevice,
  isExpanded,
  onToggleExpanded,
  onUpdateModule,
  onUpdateModuleBackground,
  onMoveUp,
  onMoveDown,
  onRemove,
  onOpenGallery,
  onOpenRichTextGallery,
  onUploadRichTextGalleryImage,
  onOpenButtonBackgroundGallery,
  onOpenSocialIconGallery,
  onUploadMedia,
  onUploadButtonBackgroundMedia,
  onClone,
  onSaveModule,
  products = [],
  hideHeaderActions = false,
  isEmailTemplate = false,
  moduleClassOverride,
  onModuleDragStart
}: BuilderModuleCardProps) {
    const richTextGalleryProps: RichTextGalleryBinding = {
      onOpenGallery: onOpenRichTextGallery,
      onUploadGalleryImage: onUploadRichTextGalleryImage
    };
    const moduleAlignment = getModuleAlignment(module.settings);
    const mobileAlignment = module.settings.mobileAlignment ?? "";
    const isVideoModule = module.type === "video" || (module.type === "image" && module.settings.variant === "video");
    const isStandardImage = module.type === "image" && !isVideoModule;
    const isFloatingImage = module.type === "floating-image";
    const isReminderModule = module.type === "reminder";
    const isHeadingModule = module.type === "heading";
    const isCurrentPollModule = module.type === "current-poll";
    const isConfettiModule = module.type === "confetti";
    const isSocialModule = module.type === "social";
    const isPollCategoryListModule = module.type === "poll-category-list";
    const isPollRuntimeModule = isCurrentPollModule || module.type === "previous-results";
    const showModuleTriggerSettings = builderModuleShowsTriggerSettings(module, moduleClassOverride);
  return (
    <div
      className={`builder-module-card ${getAlignmentClass(moduleAlignment)}`}
      style={{
        ...(module.type !== "button" && !isPollCategoryListModule
          ? resolveBuilderDrillDownSurfaceBackground(getModuleBackgroundSettings(module.settings), "module")
          : {}),
        ...(isHeadingModule
          ? getModuleMarginStyle(module.settings)
          : module.type === "button"
            ? getModuleOuterSpacingStyle(module.settings)
            : isFloatingImage || isReminderModule
              ? {}
              : getVerticalMarginStyle(module.settings.verticalMargin))
      }}
    >
      {onModuleDragStart ? (
        <div
          aria-label="Drag module"
          className="builder-module-drag-handle"
          draggable
          onDragStart={onModuleDragStart}
          title="Drag Module"
        >
          ⋮⋮
        </div>
      ) : null}
      <div aria-expanded={isExpanded} className="builder-module-header">
        <div className="builder-module-title">
          <div className="builder-module-title-text">
            <strong>{module.name || module.type}</strong>
            <span>{module.type}</span>
          </div>
        </div>
        {hideHeaderActions ? (
          <div className="builder-section-actions">
            <button aria-label={isExpanded ? "Collapse module" : "Expand module"} className="builder-icon-button" onClick={onToggleExpanded} title={isExpanded ? "Collapse module" : "Expand module"} type="button"><BuilderCollapseIcon expanded={isExpanded} /></button>
          </div>
        ) : (
          <div className="builder-section-actions">
            <button aria-label={isExpanded ? "Collapse module" : "Expand module"} className="builder-icon-button" onClick={onToggleExpanded} title={isExpanded ? "Collapse module" : "Expand module"} type="button"><BuilderCollapseIcon expanded={isExpanded} /></button>
            <button aria-label="Move module up" className="builder-icon-button" onClick={onMoveUp} title="Move module up" type="button">↑</button>
            <button aria-label="Move module down" className="builder-icon-button" onClick={onMoveDown} title="Move module down" type="button">↓</button>
            <button
              aria-label="Clone module"
              className="builder-icon-button"
              onClick={onClone}
              title="Clone module"
              type="button"
            >
              ⧉
            </button>
            {onSaveModule ? (
              <button
                aria-label="Save module"
                className="builder-icon-button"
                onClick={onSaveModule}
                title="Save Module"
                type="button"
              >
                💾
              </button>
            ) : null}
            <button aria-label="Delete module" className="builder-icon-button builder-icon-button-danger" onClick={onRemove} title="Delete module" type="button">✕</button>
          </div>
        )}
      </div>

      {!isExpanded ? (
        <div
          className="builder-module-preview-button"
          role="button"
          tabIndex={0}
          onClick={onToggleExpanded}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpanded();
            }
          }}
        >
          {renderModulePreview(module)}
        </div>
      ) : null}

      {isExpanded ? (
        <div className="builder-module-editor">
          <BuilderSettingRow label="Label" fullWidth>
            <input
              type="text"
              value={module.name}
              onChange={(event) => onUpdateModule((current) => ({ ...current, name: event.target.value }))}
              placeholder="Optional internal label"
            />
          </BuilderSettingRow>

          {editorDevice === "mobile" ? (
            <div
              className={
                module.type === "heading"
                  ? "builder-heading-module-settings"
                  : "builder-module-settings-row builder-module-settings-row-mobile"
              }
            >
              <BuilderSettingRow label="Hide Module on Mobile">
                <input
                  type="checkbox"
                  checked={module.settings.mobileHidden === "true"}
                  onChange={(event) =>
                    onUpdateModule((current) => ({
                      ...current,
                      settings: { ...current.settings, mobileHidden: event.target.checked ? "true" : "false" }
                    }))
                  }
                />
              </BuilderSettingRow>
              <BuilderSettingRow label="Mobile Alignment">
                <select
                  value={mobileAlignment}
                  onChange={(event) =>
                    onUpdateModule((current) => ({
                      ...current,
                      settings: { ...current.settings, mobileAlignment: event.target.value }
                    }))
                  }
                >
                  <option value="">Use browser setting</option>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </BuilderSettingRow>
              {(module.type === "heading" ||
                module.type === "headline-rotator" ||
                module.type === "poll-category-list") ? (
                <BuilderSettingRow label="Mobile Font Size">
                  <input
                    type="number"
                    min="10"
                    max="120"
                    step="1"
                    value={module.settings.mobileFontSize ?? ""}
                    onChange={(event) =>
                      onUpdateModule((current) => ({
                        ...current,
                        settings: { ...current.settings, mobileFontSize: event.target.value }
                      }))
                    }
                    placeholder="Auto"
                  />
                </BuilderSettingRow>
              ) : null}
              <div className="builder-mobile-context-note">
                Mobile overrides are kept separate from browser settings.
              </div>
            </div>
          ) : (
          <>
          {showModuleTriggerSettings ? (
            <BuilderModuleTriggerSettings module={module} onUpdateModule={onUpdateModule} />
          ) : null}
          {module.type !== "button" ? (
            isCurrentPollModule ? (
              <BuilderCurrentPollModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
              />
            ) : isConfettiModule ? (
              <BuilderConfettiModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isSocialModule ? (
              <BuilderSocialModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
                onOpenGallery={onOpenSocialIconGallery}
              />
            ) : module.type === "heading" ? (
              <div className="builder-heading-module-chrome">
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                />
                <BuilderSettingRow label="Alignment" fullWidth>
                  <BuilderAlignmentIconGroup
                    value={moduleAlignment}
                    onChange={(alignment) =>
                      onUpdateModule((current) => ({
                        ...current,
                        settings: { ...current.settings, alignment }
                      }))
                    }
                  />
                </BuilderSettingRow>
              </div>
            ) : isPollCategoryListModule ? null : isReminderModule ? null : isFloatingImage ? (
              <div className="builder-floating-image-module-chrome">
                <BuilderBackgroundControls
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  label="Background"
                  onChange={onUpdateModuleBackground}
                />
              </div>
            ) : (
              <div className="builder-module-chrome">
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                />
                <BuilderSettingRow label="Alignment" fullWidth>
                  <BuilderAlignmentIconGroup
                    value={moduleAlignment}
                    onChange={(alignment) =>
                      onUpdateModule((current) => ({
                        ...current,
                        settings: { ...current.settings, alignment }
                      }))
                    }
                  />
                </BuilderSettingRow>
                <BuilderSettingRow label="Vertical Margin" fullWidth>
                  <BuilderNumberSelectControl
                    fallback="0"
                    max={160}
                    min={0}
                    value={module.settings.verticalMargin ?? "0"}
                    onChange={(verticalMargin) =>
                      onUpdateModule((current) => ({
                        ...current,
                        settings: { ...current.settings, verticalMargin }
                      }))
                    }
                  />
                </BuilderSettingRow>
              </div>
            )
          ) : null}

          {isStandardImage ? (
            <BuilderModuleOffsetFields
              horizontalOffset={module.settings.horizontalOffset ?? "0"}
              verticalOffset={module.settings.verticalOffset ?? "0"}
              onHorizontalOffsetChange={(horizontalOffset) =>
                onUpdateModule((current) => ({
                  ...current,
                  settings: { ...current.settings, horizontalOffset }
                }))
              }
              onVerticalOffsetChange={(verticalOffset) =>
                onUpdateModule((current) => ({
                  ...current,
                  settings: { ...current.settings, verticalOffset }
                }))
              }
            />
          ) : null}

          {(isStandardImage || module.type === "video") && (
            <label className="field">
              <span>{isVideoModule ? "Video embed URL" : "URL"}</span>
              <input
                type="text"
                value={module.settings.url ?? ""}
                onChange={(event) =>
                  onUpdateModule((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      url: normalizeBuilderAssetUrl(event.target.value)
                    }
                  }))
                }
                placeholder={
                  isVideoModule
                    ? "YouTube, Vimeo, embed URL, or uploaded video"
                    : "https://..."
                }
              />
            </label>
          )}

          {isStandardImage ? (
            <label className="field">
              <span>Link</span>
              <input
                type="text"
                value={module.settings.linkUrl ?? ""}
                onChange={(event) =>
                  onUpdateModule((current) => ({
                    ...current,
                    settings: { ...current.settings, linkUrl: normalizeBuilderAssetUrl(event.target.value) }
                  }))
                }
                placeholder="/path-or-url"
              />
            </label>
          ) : null}

          {(isVideoModule || isStandardImage) ? (
            <label className="field builder-checkbox-field">
              <span>New Tab</span>
              <input
                type="checkbox"
                checked={isVideoModule ? module.settings.newTab !== "false" : module.settings.newTab === "true"}
                onChange={(event) =>
                  onUpdateModule((current) => ({
                    ...current,
                    settings: { ...current.settings, newTab: event.target.checked ? "true" : "false" }
                  }))
                }
              />
            </label>
          ) : null}

          {module.type === "button" ? (
            <BuilderButtonDesignSettings
              isEmailTemplate={isEmailTemplate}
              module={module}
              onUpdateModule={onUpdateModule}
              onOpenButtonBackgroundGallery={onOpenButtonBackgroundGallery}
              onUploadButtonBackgroundMedia={onUploadButtonBackgroundMedia}
            />
          ) : null}

          {module.type === "contact-form" && (
            <div className="builder-contact-form-settings">
              <label className="field">
                <span>Form type</span>
                <select
                  value={getContactFormMode(module.settings)}
                  onChange={(event) =>
                    onUpdateModule((current) => ({
                      ...current,
                      settings: { ...current.settings, formMode: event.target.value }
                    }))
                  }
                >
                  <option value="squeeze">Squeeze</option>
                  <option value="standard">Standard</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {getContactFormMode(module.settings) === "custom" ? (
                <div className="builder-module-runtime-note">
                  <strong>Custom form builder stub</strong>
                  <p>Custom starts from the standard form. Field adding and advanced form types will be wired in next.</p>
                </div>
              ) : null}
            </div>
          )}

          {module.type === "player-portal" ? (
            <BuilderPlayerPortalSettings module={module} onUpdateModule={onUpdateModule} />
          ) : null}

          {isVideoModule ? (
            <div className="builder-video-controls-grid">
              <label className="field">
                <span>Video name</span>
                <input
                  type="text"
                  value={module.settings.videoName ?? module.name ?? ""}
                  onChange={(event) => onUpdateModule((current) => ({ ...current, settings: { ...current.settings, videoName: event.target.value } }))}
                  placeholder="Video title"
                />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea
                  className="builder-textarea"
                  value={module.settings.videoDescription ?? ""}
                  onChange={(event) => onUpdateModule((current) => ({ ...current, settings: { ...current.settings, videoDescription: event.target.value } }))}
                  placeholder="Short description"
                />
              </label>
            </div>
          ) : null}

          {(isStandardImage || module.type === "video") ? (
            <div className="builder-media-actions">
              <button className="secondary-button builder-gallery-button" onClick={onOpenGallery} type="button">Choose From Gallery</button>
              <label className="secondary-button builder-gallery-button builder-upload-button">
                <span>Upload To Gallery</span>
                <input className="builder-upload-input" type="file" accept="image/*,video/*" onChange={(event) => { onUploadMedia(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
              </label>
            </div>
          ) : null}

          {isFloatingImage ? (
            <BuilderFloatingImageModuleSettings
              module={module}
              onOpenGallery={onOpenGallery}
              onUploadMedia={onUploadMedia}
              onUpdateModule={onUpdateModule}
            />
          ) : null}

          {module.type === "speech-bubble" ? (
            <BuilderSpeechBubbleModuleSettings
              module={module}
              onUpdateModule={onUpdateModule}
              richTextGallery={richTextGalleryProps}
            />
          ) : null}

          {module.type === "reminder" ? (
            <BuilderReminderModuleSettings
              module={module}
              onUpdateModule={onUpdateModule}
              richTextGallery={richTextGalleryProps}
            />
          ) : null}

          {isStandardImage ? (
            <>
              <label className="field">
                <span>Alt text</span>
                <input type="text" value={module.settings.alt ?? ""} onChange={(event) => onUpdateModule((current) => ({ ...current, settings: { ...current.settings, alt: event.target.value } }))} placeholder="Image description" />
              </label>
              <div className="builder-image-controls-grid">
                <label className="field">
                  <span>Size</span>
                  <select value={module.settings.size ?? "100"} onChange={(event) => onUpdateModule((current) => ({ ...current, settings: { ...current.settings, size: event.target.value } }))}>
                    <option value="10">10%</option>
                    <option value="15">15%</option>
                    <option value="25">25%</option>
                    <option value="33">33%</option>
                    <option value="50">50%</option>
                    <option value="66">66%</option>
                    <option value="75">75%</option>
                    <option value="100">100%</option>
                  </select>
                </label>
                <BuilderInlineNumberSelectRow>
                  <BuilderInlineNumberSelect
                    label="Border thickness"
                    value={module.settings.borderThickness ?? "0"}
                    min={0}
                    max={24}
                    fallback="0"
                    onChange={(borderThickness) =>
                      onUpdateModule((current) => ({ ...current, settings: { ...current.settings, borderThickness } }))
                    }
                  />
                  <BuilderInlineNumberSelect
                    label="Border radius"
                    value={module.settings.borderRadius ?? "18"}
                    min={0}
                    max={80}
                    fallback="18"
                    onChange={(borderRadius) =>
                      onUpdateModule((current) => ({ ...current, settings: { ...current.settings, borderRadius } }))
                    }
                  />
                </BuilderInlineNumberSelectRow>
                <label className="field"><span>Border color</span><input type="color" value={module.settings.borderColor ?? "#0f4f8f"} onChange={(event) => onUpdateModule((current) => ({ ...current, settings: { ...current.settings, borderColor: event.target.value } }))} /></label>
                <label className="field">
                  <span>Effect</span>
                  <select value={module.settings.effect ?? "none"} onChange={(event) => onUpdateModule((current) => ({ ...current, settings: { ...current.settings, effect: event.target.value } }))}>
                    <option value="none">None</option>
                    <option value="bounce">Bounce</option>
                    <option value="fast-bounce">Fast Bounce</option>
                    <option value="big-bounce">Big Bounce</option>
                    <option value="spin">Spin</option>
                    <option value="cruise">Cruise</option>
                    <option value="tumbleweed">Tumbleweed</option>
                  </select>
                </label>
              </div>
            </>
          ) : null}

          {module.type === "heading" ? (
            <BuilderHeadingModuleSettings module={module} onUpdateModule={onUpdateModule} />
          ) : null}

          {module.type === "table" && <TableModuleEditor module={module} onUpdateModule={onUpdateModule} />}
          {module.type === "slider" && <SliderModuleEditor module={module} onUpdateModule={onUpdateModule} />}
          {module.type === "navigation" && <NavModuleEditor module={module} onUpdateModule={onUpdateModule} />}
          {module.type === "headline-rotator" && <HeadlineRotatorModuleEditor module={module} onUpdateModule={onUpdateModule} />}
          {module.type === "poll-category-list" && (
            <PollCategoryListModuleEditor
              module={module}
              onUpdateModule={onUpdateModule}
              onUpdateModuleBackground={onUpdateModuleBackground}
            />
          )}
          {module.type === "social-share" && <SocialShareModuleEditor module={module} onUpdateModule={onUpdateModule} />}

          {module.type === "merch" ? (
            <MerchModuleEditor module={module} products={products} onUpdateModule={onUpdateModule} />
          ) : null}


          {module.type === "code" ? (
            <div className="builder-code-editor-grid">
              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={module.settings.label ?? ""}
                  onChange={(event) =>
                    onUpdateModule((current) => ({
                      ...current,
                      settings: { ...current.settings, label: event.target.value }
                    }))
                  }
                  placeholder="Optional internal label"
                />
              </label>
              <label className="field builder-code-editor-field">
                <span>Embed code / snippet</span>
                <textarea
                  className="builder-textarea builder-code-textarea"
                  value={module.text}
                  onChange={(event) => onUpdateModule((current) => ({ ...current, text: event.target.value }))}
                  placeholder="<iframe ...></iframe>"
                  spellCheck={false}
                />
              </label>
            </div>
          ) : null}

          {(module.type === "previous-results" || module.type === "current-poll" || module.type === "social-share") && (
            <div className="builder-module-runtime-note">
              <strong>Live poll module</strong>
              <p>This module uses the current poll data from the live poll runtime. Use page preview or a live page to test the real behavior.</p>
            </div>
          )}

          {module.type === "confetti" ? (
            <div className="builder-module-runtime-note">
              <strong>Special effect</strong>
              <p>
                {getConfettiTrigger(module.settings) === "game"
                  ? "Game trigger: no on-page button. Use page preview to test, then wire the game layer to fireConfettiFromModuleSettings with these settings."
                  : "Use page preview or a live page to test the confetti burst. Adjust particle settings in the fields above."}
              </p>
            </div>
          ) : null}

          {module.type === "speech-bubble" ? (
            <div className="builder-module-runtime-note">
              <strong>Speech bubble</strong>
              <p>
                {getModuleTrigger(module.settings) === "game"
                  ? "Game trigger: overlay on the live site at page load and when portal game events fire (logged-in milestones)."
                  : getModuleTrigger(module.settings) === "on-load"
                    ? "Page load trigger: overlay when this page loads on the live site."
                    : "Use page preview or a live page to test this speech bubble overlay."}
              </p>
            </div>
          ) : null}

          {module.type === "floating-image" ? (
            <div className="builder-module-runtime-note">
              <strong>Floating image</strong>
              <p>
                {getModuleTrigger(module.settings) === "game"
                  ? "Game trigger: the image and translucent backdrop render in the full-screen overlay layer (not in the page row). Z-index on the module stacks above that backdrop."
                  : getModuleTrigger(module.settings) === "on-load"
                    ? "Page load trigger: fires in the overlay layer when this page loads on the live site."
                    : "Decorative overlays stay in the page row. Use Test Floating Image in page preview for game-style triggers."}
              </p>
            </div>
          ) : null}

          {module.type === "reminder" ? (
            <div className="builder-module-runtime-note">
              <strong>Reminders</strong>
              <p>
                One module per page holds every reminder. Records sort by question number (poll order or polls-taken count).
                Overlays appear on the live site and in page preview when criteria match. Dismisses on the visitor&apos;s
                next click.
              </p>
            </div>
          ) : null}

          {module.type !== "image" &&
          module.type !== "floating-image" &&
          module.type !== "contact-form" &&
          module.type !== "player-portal" &&
          module.type !== "table" &&
          module.type !== "slider" &&
          module.type !== "social" &&
          module.type !== "navigation" &&
          module.type !== "headline-rotator" &&
          module.type !== "poll-category-list" &&
          module.type !== "social-share" &&
          module.type !== "merch" &&
          module.type !== "code" &&
          module.type !== "previous-results" &&
          module.type !== "current-poll" &&
          module.type !== "confetti" &&
          module.type !== "speech-bubble" &&
          module.type !== "reminder" &&
          module.type !== "button" &&
          module.type !== "heading" ? (
            <label className="field">
              <span>Content</span>
              {module.type === "text" ? (
                <BuilderRichTextEditor
                  value={module.text}
                  onChange={(value) => onUpdateModule((current) => ({ ...current, text: value }))}
                  {...richTextGalleryProps}
                />
              ) : (
                <textarea className="builder-textarea" value={module.text} onChange={(event) => onUpdateModule((current) => ({ ...current, text: event.target.value }))} placeholder="Enter content" />
              )}
            </label>
          ) : null}
          </>
          )}
        </div>
      ) : null}
    </div>
  );
}
