import Image from "next/image";
import { type CSSProperties, type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import { getAnchoredModalStyle, type BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { BuilderCenteredModal } from "./builder-centered-modal";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderImageModuleSettings } from "./builder-image-module-settings";
import type {
  BackgroundSettings,
  BuilderPageRecord,
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
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
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
import { TractorNavCardPreview, TractorNavRuntime } from "@/components/builder-tractor-nav-module";
import { BuilderTractorNavModuleSettings } from "./builder-tractor-nav-module-settings";
import { BuilderModuleTriggerSettings } from "./builder-module-trigger-settings";
import { BuilderBreadcrumbModuleSettings, parseBreadcrumbItems } from "./builder-breadcrumb-module-settings";
import { BuilderBlogPostListModuleSettings } from "./builder-blog-post-list-module-settings";
import { BuilderBlogPostCardModuleSettings } from "./builder-blog-post-card-module-settings";
import { BuilderBlogAuthorBioModuleSettings, parseSocialLinks } from "./builder-blog-author-bio-module-settings";
import { BuilderBlogTocModuleSettings, parseTocItems } from "./builder-blog-toc-module-settings";
import { BuilderBlogNewsletterSubscribeModuleSettings } from "./builder-blog-newsletter-subscribe-module-settings";
import { BuilderBlogRelatedPostsModuleSettings, parseRelatedPosts } from "./builder-blog-related-posts-module-settings";
import { BuilderBlogCategoryFilterModuleSettings, parseFilterCategories } from "./builder-blog-category-filter-module-settings";
import { BuilderBlogPostModuleSettings } from "./builder-blog-post-module-settings";
import { BuilderBlogTagCloudModuleSettings, parseCloudTags } from "./builder-blog-tag-cloud-module-settings";
import { BuilderBlogPostTagsModuleSettings } from "./builder-blog-post-tags-module-settings";
import { BuilderBlogPostCreateModuleSettings } from "./builder-blog-post-create-module-settings";
import { BuilderBlogPostManagerModuleSettings } from "./builder-blog-post-manager-module-settings";
import { BuilderBlogCategoryManagerModuleSettings } from "./builder-blog-category-manager-module-settings";
import { BuilderMessagingTopicListModuleSettings } from "./builder-messaging-topic-list-module-settings";
import { BuilderMessagingTagListModuleSettings } from "./builder-messaging-tag-list-module-settings";
import { BuilderCrmContactsTableModuleSettings } from "./builder-crm-contacts-table-module-settings";
import { BuilderAdminTeamUsersModuleSettings } from "./builder-admin-team-users-module-settings";
import { BuilderAdminModulesModuleSettings } from "./builder-admin-modules-module-settings";
import { BuilderAdminLoginModuleSettings } from "./builder-admin-login-module-settings";
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
  pages?: BuilderPageRecord[];
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
  themeColors?: Array<{ label: string; hex: string }>;
  themeStyle?: CSSProperties;
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

function renderCrmFormPreview(settings: Record<string, string>) {
  return (
    <div className="builder-contact-form">
      <div className="builder-contact-form-fields">
        <label className="builder-contact-form-field">
          <span className="builder-contact-form-input-preview">Email</span>
        </label>
        <label className="builder-contact-form-field">
          <span className="builder-contact-form-input-preview">Name</span>
        </label>
      </div>
      {settings.crmFormId ? null : (
        <div className="builder-contact-form-stub">Select a CRM form in module settings.</div>
      )}
      <span className="builder-contact-form-submit builder-contact-form-submit-preview">Submit</span>
    </div>
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

  if (module.type === "crm-form") {
    return renderCrmFormPreview(module.settings);
  }

  if (module.type === "crm-contacts-table") {
    const s = module.settings;
    const showTitle = s.showTitle !== "false";
    const title = s.tableTitle || "Contacts";
    const showSearch = s.showSearch !== "false";
    const showAdd = s.showAddButton !== "false";
    const addLabel = s.addButtonLabel || "Add Contact";
    const previewRows = [
      { email: "alice@example.com", name: "Alice Johnson", company: "Acme Co." },
      { email: "bob@example.com", name: "Bob Smith", company: "Globex" },
      { email: "carol@example.com", name: "Carol White", company: "Initech" },
    ];
    const thStyle: React.CSSProperties = { background: "#e8f2fb", color: "#18324a", fontWeight: 700, fontSize: 11, padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #c9dcea" };
    const tdStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 11, color: "#18324a", borderBottom: "1px solid #edf2f7", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
    const actionBtnStyle: React.CSSProperties = { fontSize: 10, padding: "2px 6px", border: "1px solid #c9dcea", borderRadius: 4, background: "#fff", color: "#18324a", cursor: "default", marginRight: 3 };
    const dangerBtnStyle: React.CSSProperties = { ...actionBtnStyle, borderColor: "#e8c0c0", color: "#8f1f1f" };
    return (
      <div className="builder-module-preview-copy">
        {showTitle && (
          <div style={{ fontWeight: 700, fontSize: 15, color: "#18324a", marginBottom: 8 }}>{title}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          {showSearch && (
            <div style={{ flex: 1, height: 28, border: "1px solid #c9dcea", borderRadius: 6, background: "#fff", display: "flex", alignItems: "center", padding: "0 8px" }}>
              <span style={{ color: "#9ab0c4", fontSize: 11 }}>Search contacts…</span>
            </div>
          )}
          {showAdd && (
            <div style={{ height: 28, padding: "0 10px", border: "1px solid #c9dcea", borderRadius: 6, background: "#f0f7ff", display: "flex", alignItems: "center", fontSize: 11, color: "#0b4f8f", fontWeight: 600, whiteSpace: "nowrap" }}>
              + {addLabel}
            </div>
          )}
        </div>
        <div style={{ border: "1px solid #c9dcea", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Company</th>
                <th style={{ ...thStyle, width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.email}>
                  <td style={tdStyle}>{row.email}</td>
                  <td style={tdStyle}>{row.name}</td>
                  <td style={tdStyle}>{row.company}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {s.showViewButton !== "false" && <span style={actionBtnStyle}>View</span>}
                    {s.showEditButton !== "false" && <span style={actionBtnStyle}>Edit</span>}
                    {s.showDeleteButton !== "false" && <span style={dangerBtnStyle}>Delete</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: "#9ab0c4", textAlign: "right" }}>3 contacts · Page 1 of 1</div>
      </div>
    );
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
    const tableBgStyle = getBuilderBackgroundStyle(getModuleBackgroundSettings(module.settings)) ?? { background: "transparent" };
    const tableMaxWidth = module.settings.tableMaxWidth ? Math.min(2000, Math.max(0, Number.parseInt(module.settings.tableMaxWidth, 10) || 0)) : undefined;

    return (
      <div className="builder-module-preview-table-wrap" style={tableMaxWidth ? { maxWidth: `${tableMaxWidth}px` } : {}}>
        <table
          className="builder-module-preview-table"
          style={{
            borderCollapse: "collapse",
            width: "100%",
            border: `${borderW}px solid ${borderC}`,
            ...tableBgStyle
          }}
        >
          {td.headers.length > 0 && module.settings.showColumnHeads !== "false" && (
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
    const padding = Number.parseInt(module.settings.socialPadding || "0", 10);
    const globalBg = module.settings.socialIconBgColor || "";
    const borderWidth = Number.parseInt(module.settings.socialBorderWidth || "0", 10);
    const borderColor = module.settings.socialBorderColor || "#000000";
    const borderRadius = Number.parseInt(module.settings.socialBorderRadius || "0", 10);
    const shadowX = Number.parseInt(module.settings.socialShadowX || "0", 10);
    const shadowY = Number.parseInt(module.settings.socialShadowY || "0", 10);
    const shadowBlur = Number.parseInt(module.settings.socialShadowBlur || "0", 10);
    const shadowSpread = Number.parseInt(module.settings.socialShadowSpread || "0", 10);
    const shadowColor = module.settings.socialShadowColor || "#000000";
    const hasShadow = shadowX !== 0 || shadowY !== 0 || shadowBlur !== 0 || shadowSpread !== 0;

    const iconStyle = {
      borderRadius: `${borderRadius}%`,
      ...(borderWidth > 0 ? { border: `${borderWidth}px solid ${borderColor}` } : {}),
      ...(hasShadow ? { boxShadow: `${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowSpread}px ${shadowColor}` } : {})
    };

    return (
      <div
        className="builder-module-preview-social"
        style={{ gap: `${gap}px`, ...(padding > 0 ? { padding: `${padding}px` } : {}) }}
      >
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
                  background: globalBg || item.backgroundColor,
                  ...iconStyle
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

  if (module.type === "tractor-nav") {
    return <TractorNavCardPreview settings={module.settings} />;
  }

  if (module.type === "breadcrumb") {
    const items = parseBreadcrumbItems(module.settings);
    const sep = module.settings.separator || "›";
    const fontSize = parseInt(module.settings.fontSize ?? "14", 10) || 14;
    const color = module.settings.color || "#587592";
    const activeColor = module.settings.activeColor || "#18324a";
    const isBold = module.settings.bold === "true";
    const alignment = (module.settings.alignment ?? "left") as "left" | "center" | "right";
    return (
      <div className="builder-module-preview-copy" style={{ textAlign: alignment }}>
        <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4, fontSize, fontWeight: isBold ? 700 : 400 }}>
          {items.length === 0 ? (
            <span style={{ color: "#aaa", fontStyle: "italic" }}>No items yet</span>
          ) : items.map((item, i) => {
            const isLast = i === items.length - 1;
            return (
              <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: isLast ? activeColor : color, fontWeight: isLast ? 600 : undefined }}>
                  {item.label || `Item ${i + 1}`}
                </span>
                {!isLast && <span style={{ color, opacity: 0.5 }}>{sep}</span>}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  if (module.type === "blog-post-list") {
    const s = module.settings;
    const isGrid = (s.layout ?? "grid") === "grid";
    const cols = Math.min(3, Math.max(1, parseInt(s.columns ?? "3", 10) || 3));
    const gap = parseInt(s.cardGap ?? "24", 10) || 24;
    const radius = parseInt(s.cardBorderRadius ?? "12", 10) || 12;
    const showImage = s.showFeaturedImage !== "false";
    const showExcerpt = s.showExcerpt !== "false";
    const showAuthor = s.showAuthor !== "false";
    const showDate = s.showDate !== "false";
    const showCategories = s.showCategories !== "false";
    const showReadMore = s.showReadMore !== "false";
    const readMoreLabel = s.readMoreLabel || "Read More";
    const cardStyle = s.cardStyle ?? "default";
    const previewCount = isGrid ? cols : 2;
    const cardBorder = cardStyle === "bordered" ? "1px solid #d4e3ef" : "none";
    const cardShadow = cardStyle === "shadow" ? "0 2px 12px rgba(9,16,24,0.10)" : "none";
    const ratioMap: Record<string, number> = { "16:9": 56.25, "4:3": 75, "3:2": 66.67, "1:1": 100 };
    const paddingTop = `${ratioMap[s.imageAspectRatio ?? "16:9"] ?? 56.25}%`;

    return (
      <div className="builder-module-preview-copy">
        <div
          style={{
            display: isGrid ? "grid" : "flex",
            gridTemplateColumns: isGrid ? `repeat(${cols}, 1fr)` : undefined,
            flexDirection: isGrid ? undefined : "column",
            gap,
          }}
        >
          {Array.from({ length: previewCount }).map((_, i) => (
            <div
              key={i}
              style={{
                border: cardBorder,
                borderRadius: radius,
                boxShadow: cardShadow,
                overflow: "hidden",
                background: "#fff",
                display: isGrid ? "flex" : "flex",
                flexDirection: isGrid ? "column" : "row",
                gap: isGrid ? 0 : 12,
              }}
            >
              {showImage ? (
                <div
                  style={{
                    position: "relative",
                    flex: isGrid ? undefined : "0 0 120px",
                    width: isGrid ? "100%" : 120,
                    paddingTop: isGrid ? paddingTop : undefined,
                    height: isGrid ? undefined : 80,
                    background: "#d4e3ef",
                    borderRadius: isGrid ? 0 : radius,
                  }}
                >
                  <span style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "#8ba9be", fontSize: 11
                  }}>
                    Image
                  </span>
                </div>
              ) : null}
              <div style={{ padding: isGrid ? "12px 14px 14px" : "4px 0", flex: 1 }}>
                {showCategories ? (
                  <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                    <span style={{ background: "#e8f6fc", color: "#587592", fontSize: 10, borderRadius: 4, padding: "2px 6px" }}>Category</span>
                  </div>
                ) : null}
                <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 4, lineHeight: 1.3 }}>
                  Post title {i + 1}
                </div>
                {showDate || showAuthor ? (
                  <div style={{ color: "#8ba9be", fontSize: 11, marginBottom: showExcerpt ? 6 : 8 }}>
                    {showDate ? "Jun 20, 2026" : ""}
                    {showDate && showAuthor ? " · " : ""}
                    {showAuthor ? "Author Name" : ""}
                  </div>
                ) : null}
                {showExcerpt ? (
                  <div style={{ color: "#587592", fontSize: 12, lineHeight: 1.5, marginBottom: showReadMore ? 8 : 0 }}>
                    A short excerpt from this post appears here to give readers a preview.
                  </div>
                ) : null}
                {showReadMore ? (
                  <div style={{ fontSize: 12, color: "#0f4f8f", fontWeight: 600 }}>{readMoreLabel} →</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="builder-module-editor-copy" style={{ marginTop: 8 }}>
          {isGrid ? `${cols}-column grid` : "List layout"} · {s.postsPerPage ?? "9"} per page
          {s.filterCategory ? ` · Category: ${s.filterCategory}` : ""}
        </div>
      </div>
    );
  }

  if (module.type === "blog-post-card") {
    const s = module.settings;
    const isHorizontal = (s.cardLayout ?? "vertical") === "horizontal";
    const showImage = s.showFeaturedImage !== "false";
    const showExcerpt = s.showExcerpt !== "false";
    const showAuthor = s.showAuthor !== "false";
    const showDate = s.showDate !== "false";
    const showCategories = s.showCategories !== "false";
    const showReadMore = s.showReadMore !== "false";
    const radius = parseInt(s.cardBorderRadius ?? "12", 10) || 12;
    const cardStyle = s.cardStyle ?? "default";
    const cardBorder = cardStyle === "bordered" ? "1px solid #d4e3ef" : "none";
    const cardShadow = cardStyle === "shadow" ? "0 2px 12px rgba(9,16,24,0.10)" : "none";
    const ratioMap: Record<string, number> = { "16:9": 56.25, "4:3": 75, "3:2": 66.67, "1:1": 100 };
    const paddingTop = `${ratioMap[s.imageAspectRatio ?? "16:9"] ?? 56.25}%`;
    const categories = (s.categories ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    const title = s.title || "Post title";
    const excerpt = s.excerpt || "A short excerpt from this post appears here to give readers a preview of what to expect.";
    const author = s.author || "Author Name";
    const date = s.date || "Jun 20, 2026";
    const readMoreLabel = s.readMoreLabel || "Read More";

    return (
      <div className="builder-module-preview-copy">
        <div
          style={{
            border: cardBorder,
            borderRadius: radius,
            boxShadow: cardShadow,
            overflow: "hidden",
            background: "#fff",
            display: "flex",
            flexDirection: isHorizontal ? "row" : "column",
            gap: isHorizontal ? 0 : 0,
            maxWidth: isHorizontal ? "100%" : 480,
          }}
        >
          {showImage ? (
            isHorizontal ? (
              <div style={{ flex: "0 0 180px", position: "relative", background: s.imageUrl ? undefined : "#d4e3ef", minHeight: 120, overflow: "hidden" }}>
                {s.imageUrl ? (
                  <img src={s.imageUrl} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8ba9be", fontSize: 11 }}>Image</span>
                )}
              </div>
            ) : (
              <div style={{ position: "relative", width: "100%", paddingTop, background: s.imageUrl ? undefined : "#d4e3ef", overflow: "hidden" }}>
                {s.imageUrl ? (
                  <img src={s.imageUrl} alt={title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8ba9be", fontSize: 11 }}>Image</span>
                )}
              </div>
            )
          ) : null}

          <div style={{ padding: "12px 16px 14px", flex: 1 }}>
            {showCategories && categories.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {categories.map((cat) => (
                  <span key={cat} style={{ background: "#e8f6fc", color: "#587592", fontSize: 10, borderRadius: 4, padding: "2px 6px" }}>{cat}</span>
                ))}
              </div>
            ) : null}

            <div style={{ fontWeight: 700, fontSize: 15, color: "#18324a", marginBottom: 4, lineHeight: 1.3 }}>{title}</div>

            {(showDate || showAuthor) ? (
              <div style={{ color: "#8ba9be", fontSize: 11, marginBottom: showExcerpt ? 6 : 8 }}>
                {showDate ? date : ""}
                {showDate && showAuthor ? " · " : ""}
                {showAuthor ? author : ""}
              </div>
            ) : null}

            {showExcerpt ? (
              <div style={{ color: "#587592", fontSize: 12, lineHeight: 1.5, marginBottom: showReadMore ? 10 : 0 }}>{excerpt}</div>
            ) : null}

            {showReadMore ? (
              <div style={{ fontSize: 12, color: "#0f4f8f", fontWeight: 600 }}>{readMoreLabel} →</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (module.type === "blog-author-bio") {
    const s = module.settings;
    const isVertical = (s.layout ?? "horizontal") === "vertical";
    const avatarSize = Math.max(40, parseInt(s.avatarSize ?? "80", 10) || 80);
    const avatarShape = s.avatarShape ?? "circle";
    const borderRadius = avatarShape === "circle" ? "50%" : avatarShape === "rounded" ? "12px" : "4px";
    const name = s.name || "Author Name";
    const title = s.title || "";
    const bio = s.bio || "A short bio about the author appears here.";
    const links = parseSocialLinks(s);

    const avatar = (
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: isVertical ? "center" : undefined }}>
        {s.avatarUrl ? (
          <img
            src={s.avatarUrl}
            alt={name}
            style={{ width: avatarSize, height: avatarSize, borderRadius, objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{ width: avatarSize, height: avatarSize, borderRadius, background: "#d4e3ef", display: "flex", alignItems: "center", justifyContent: "center", color: "#8ba9be", fontSize: 11 }}>
            Photo
          </div>
        )}
      </div>
    );

    const content = (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#18324a", lineHeight: 1.3 }}>{name}</div>
        {title ? <div style={{ fontSize: 12, color: "#587592", marginBottom: 4 }}>{title}</div> : null}
        <div style={{ fontSize: 12, color: "#587592", lineHeight: 1.5, marginTop: 4 }}>{bio}</div>
        {links.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {links.map((l) => (
              <span key={l.id} style={{ fontSize: 11, color: "#0f4f8f", fontWeight: 600 }}>{l.platform}</span>
            ))}
          </div>
        ) : null}
      </div>
    );

    return (
      <div className="builder-module-preview-copy">
        <div style={{
          display: "flex",
          flexDirection: isVertical ? "column" : "row",
          alignItems: isVertical ? "center" : "flex-start",
          gap: 16,
          textAlign: isVertical ? "center" : "left",
        }}>
          {avatar}
          {content}
        </div>
      </div>
    );
  }

  if (module.type === "blog-toc") {
    const s = module.settings;
    const items = parseTocItems(s);
    const showTitle = s.showTitle !== "false";
    const title = s.title || "In This Article";
    const tocStyle = s.style ?? "default";
    const indentSubs = s.indentSubheadings !== "false";
    const fontSize = parseInt(s.fontSize ?? "14", 10) || 14;
    const titleFontSize = parseInt(s.titleFontSize ?? "16", 10) || 16;
    const color = s.color || "#0f4f8f";
    const titleColor = s.titleColor || "#18324a";
    let h2Counter = 0;

    return (
      <div className="builder-module-preview-copy">
        {showTitle ? (
          <div style={{ fontWeight: 700, fontSize: titleFontSize, color: titleColor, marginBottom: 8, lineHeight: 1.3 }}>
            {title}
          </div>
        ) : null}
        {items.length === 0 ? (
          <div style={{ color: "#aaa", fontStyle: "italic", fontSize }}>No headings yet — add H2 / H3 entries below</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {items.map((item, i) => {
              if (item.depth === 1) h2Counter++;
              const isH3 = item.depth === 2;
              const label = item.label || `Heading ${i + 1}`;
              let prefix = "";
              if (tocStyle === "numbered" && item.depth === 1) prefix = `${h2Counter}. `;
              const dotStyle = tocStyle === "dotted" ? "· " : "";

              return (
                <div
                  key={item.id}
                  style={{
                    marginLeft: isH3 && indentSubs ? 16 : 0,
                    fontSize: isH3 ? fontSize - 1 : fontSize,
                    color,
                    opacity: isH3 ? 0.8 : 1,
                    lineHeight: 1.5,
                  }}
                >
                  {dotStyle}{prefix}{label}
                </div>
              );
            })}
          </div>
        )}
        <div className="builder-module-editor-copy" style={{ marginTop: 8 }}>
          {items.length} heading{items.length !== 1 ? "s" : ""} · {tocStyle} style
        </div>
      </div>
    );
  }

  if (module.type === "blog-newsletter-subscribe") {
    const s = module.settings;
    const isInline = s.layout === "inline";
    const accent = s.accentColor || "#0f4f8f";
    const bg = s.bgColor || "#eaf4ff";
    const headline = s.headline || "Stay in the loop";
    const description = s.description || "Get new posts delivered to your inbox.";
    const hasCrmForm = Boolean(s.crmFormId);

    return (
      <div className="builder-module-preview-copy">
        <div style={{ background: bg, borderRadius: 12, padding: "20px 24px" }}>
          {s.showImage === "true" && s.imageUrl ? (
            <img src={s.imageUrl} alt="" style={{ height: 40, marginBottom: 10, display: "block" }} />
          ) : null}
          <div style={{ fontWeight: 700, fontSize: 17, color: "#18324a", marginBottom: 4 }}>{headline}</div>
          <div style={{ fontSize: 13, color: "#587592", marginBottom: 14, lineHeight: 1.5 }}>{description}</div>
          {isInline ? (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, height: 36, background: "#fff", border: "1px solid #c6d8e8", borderRadius: 6, padding: "0 10px", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#aab" }}>Email address</span>
              </div>
              <div style={{ height: 36, padding: "0 16px", background: accent, borderRadius: 6, display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>Subscribe</span>
              </div>
            </div>
          ) : (
            <>
              <div style={{ height: 36, background: "#fff", border: "1px solid #c6d8e8", borderRadius: 6, padding: "0 10px", display: "flex", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#aab" }}>Email address</span>
              </div>
              <div style={{ height: 36, background: accent, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>Subscribe</span>
              </div>
            </>
          )}
          {!hasCrmForm ? (
            <div className="builder-contact-form-stub" style={{ marginTop: 10 }}>
              No CRM form linked — paste a Form ID in settings.
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (module.type === "blog-related-posts") {
    const s = module.settings;
    const isManual = s.matchBy === "manual";
    const isGrid = (s.layout ?? "grid") === "grid";
    const cols = Math.min(4, Math.max(2, parseInt(s.columns ?? "3", 10) || 3));
    const gap = parseInt(s.cardGap ?? "20", 10) || 20;
    const radius = parseInt(s.cardBorderRadius ?? "12", 10) || 12;
    const cardStyle = s.cardStyle ?? "default";
    const cardBorder = cardStyle === "bordered" ? "1px solid #d4e3ef" : "none";
    const cardShadow = cardStyle === "shadow" ? "0 2px 12px rgba(9,16,24,0.10)" : "none";
    const showImage = s.showFeaturedImage !== "false";
    const showDate = s.showDate !== "false";
    const showCategories = s.showCategories !== "false";
    const showTitle = s.showTitle !== "false";
    const title = s.title || "You Might Also Like";
    const ratioMap: Record<string, number> = { "16:9": 56.25, "4:3": 75, "3:2": 66.67, "1:1": 100 };
    const paddingTop = `${ratioMap[s.imageAspectRatio ?? "16:9"] ?? 56.25}%`;
    const manualPosts = parseRelatedPosts(s);
    const count = parseInt(s.count ?? "3", 10) || 3;
    const previewCount = isManual ? Math.min(manualPosts.length || cols, cols) : Math.min(count, cols);

    return (
      <div className="builder-module-preview-copy">
        {showTitle ? (
          <div style={{ fontWeight: 700, fontSize: 16, color: "#18324a", marginBottom: 14 }}>{title}</div>
        ) : null}
        {previewCount === 0 ? (
          <div style={{ color: "#aaa", fontStyle: "italic", fontSize: 13 }}>
            {isManual ? "No posts added yet" : `${count} posts matched by ${s.matchBy ?? "categories"}`}
          </div>
        ) : (
          <div style={{
            display: isGrid ? "grid" : "flex",
            gridTemplateColumns: isGrid ? `repeat(${cols}, 1fr)` : undefined,
            flexDirection: isGrid ? undefined : "column",
            gap,
          }}>
            {Array.from({ length: previewCount }).map((_, i) => {
              const post = isManual ? manualPosts[i] : null;
              const postTitle = post?.title || `Related Post ${i + 1}`;
              const postDate = post?.date || "Jun 20, 2026";
              const postCats = post?.categories ? post.categories.split(",").map((c) => c.trim()).filter(Boolean) : ["Category"];

              return (
                <div key={i} style={{ border: cardBorder, borderRadius: radius, boxShadow: cardShadow, overflow: "hidden", background: "#fff" }}>
                  {showImage ? (
                    <div style={{ position: "relative", width: "100%", paddingTop, background: post?.imageUrl ? undefined : "#d4e3ef", overflow: "hidden" }}>
                      {post?.imageUrl ? (
                        <img src={post.imageUrl} alt={postTitle} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8ba9be", fontSize: 11 }}>Image</span>
                      )}
                    </div>
                  ) : null}
                  <div style={{ padding: "10px 12px 12px" }}>
                    {showCategories ? (
                      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                        {postCats.slice(0, 2).map((cat) => (
                          <span key={cat} style={{ background: "#e8f6fc", color: "#587592", fontSize: 10, borderRadius: 4, padding: "1px 5px" }}>{cat}</span>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#18324a", lineHeight: 1.3, marginBottom: 4 }}>{postTitle}</div>
                    {showDate ? <div style={{ color: "#8ba9be", fontSize: 11 }}>{postDate}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!isManual ? (
          <div className="builder-module-editor-copy" style={{ marginTop: 8 }}>
            {count} posts · matched by {s.matchBy ?? "categories"}
          </div>
        ) : null}
      </div>
    );
  }

  if (module.type === "blog-category-filter") {
    const s = module.settings;
    const layout = s.layout ?? "pills";
    const allLabel = s.allLabel || "All";
    const showAll = s.showAll !== "false";
    const activeColor = s.activeColor ?? "#0f4f8f";
    const activeBg = s.activeBg ?? "#e8f6fc";
    const inactiveColor = s.inactiveColor ?? "#587592";
    const inactiveBg = s.inactiveBg ?? "#f0f4f8";
    const borderRadius = parseInt(s.borderRadius ?? "20", 10) || 20;
    const fontSize = parseInt(s.fontSize ?? "13", 10) || 13;
    const gap = parseInt(s.gap ?? "8", 10) || 8;
    const alignment = s.alignment ?? "left";
    const justifyMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };
    const categories = parseFilterCategories(s);

    const pills = [
      ...(showAll ? [{ id: "__all__", label: allLabel, slug: "" }] : []),
      ...categories
    ];

    if (layout === "dropdown") {
      return (
        <div className="builder-module-preview-copy" style={{ textAlign: alignment as "left" | "center" | "right" }}>
          <select
            disabled
            style={{
              fontSize,
              padding: "6px 12px",
              borderRadius: borderRadius / 2,
              border: "1px solid #c9d8e6",
              color: inactiveColor,
              background: inactiveBg,
              minWidth: 160,
            }}
          >
            {pills.map((p) => <option key={p.id}>{p.label}</option>)}
            {pills.length === 0 ? <option>All</option> : null}
          </select>
        </div>
      );
    }

    if (layout === "list") {
      return (
        <div className="builder-module-preview-copy">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "inline-flex", flexDirection: "column", gap, alignItems: alignment === "center" ? "center" : alignment === "right" ? "flex-end" : "flex-start", width: "100%" }}>
            {(pills.length > 0 ? pills : [{ id: "__all__", label: "All", slug: "" }, { id: "ph1", label: "Category", slug: "category" }]).map((p, i) => (
              <li key={p.id} style={{ fontSize, color: i === 0 ? activeColor : inactiveColor, fontWeight: i === 0 ? 600 : 400, cursor: "default" }}>
                {p.label}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    // pills (default)
    return (
      <div className="builder-module-preview-copy">
        <div style={{ display: "flex", flexWrap: "wrap", gap, justifyContent: justifyMap[alignment] ?? "flex-start" }}>
          {(pills.length > 0 ? pills : [{ id: "__all__", label: "All", slug: "" }, { id: "ph1", label: "Category", slug: "category" }]).map((p, i) => (
            <span
              key={p.id}
              style={{
                fontSize,
                padding: "4px 12px",
                borderRadius,
                background: i === 0 ? activeBg : inactiveBg,
                color: i === 0 ? activeColor : inactiveColor,
                fontWeight: i === 0 ? 600 : 400,
                border: `1px solid ${i === 0 ? activeColor + "33" : inactiveBg}`,
                cursor: "default",
              }}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (module.type === "blog-post") {
    const s = module.settings;
    const title = s.title || "Untitled Post";
    const showFeaturedImage = s.showFeaturedImage !== "false";
    const showAuthor = s.showAuthor !== "false";
    const showDate = s.showDate !== "false";
    const showCategories = s.showCategories !== "false";
    const showExcerpt = s.showExcerpt !== "false";
    const cats = (s.categories ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    const statusColors: Record<string, string> = { draft: "#8ba9be", published: "#1d8a4e", archived: "#a06040" };
    const status = s.status ?? "draft";

    return (
      <div className="builder-module-preview-copy" style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* Status chip */}
        <div style={{ marginBottom: 10 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: statusColors[status] ?? "#8ba9be",
            background: (statusColors[status] ?? "#8ba9be") + "18",
            borderRadius: 4,
            padding: "2px 7px",
          }}>
            {status}
          </span>
        </div>

        {/* Featured image */}
        {showFeaturedImage ? (
          <div style={{ width: "100%", paddingTop: "52%", position: "relative", borderRadius: 8, overflow: "hidden", background: s.featuredImageUrl ? undefined : "#d4e3ef", marginBottom: 16 }}>
            {s.featuredImageUrl ? (
              <img src={s.featuredImageUrl} alt={title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8ba9be", fontSize: 12 }}>Featured Image</span>
            )}
          </div>
        ) : null}

        {/* Categories */}
        {showCategories && cats.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {cats.map((cat) => (
              <span key={cat} style={{ fontSize: 11, background: "#e8f6fc", color: "#0f4f8f", borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>
                {cat}
              </span>
            ))}
          </div>
        ) : null}

        {/* Title */}
        <div style={{ fontSize: 22, fontWeight: 800, color: "#18324a", lineHeight: 1.25, marginBottom: 10 }}>{title}</div>

        {/* Byline */}
        {showAuthor || showDate ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#c9d8e6", flexShrink: 0 }} />
            <div>
              {showAuthor && s.author ? (
                <div style={{ fontSize: 12, fontWeight: 600, color: "#18324a" }}>{s.author}</div>
              ) : null}
              {showDate && s.publishDate ? (
                <div style={{ fontSize: 11, color: "#8ba9be" }}>{s.publishDate}</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Excerpt */}
        {showExcerpt && s.excerpt ? (
          <div style={{ fontSize: 13, color: "#587592", lineHeight: 1.5, marginBottom: 12, borderLeft: "3px solid #c9d8e6", paddingLeft: 10, fontStyle: "italic" }}>
            {s.excerpt}
          </div>
        ) : null}

        {/* Body preview */}
        {s.body ? (
          <div
            className="builder-module-preview-paragraph"
            style={{ fontSize: 13, lineHeight: 1.6, color: "#2c4a62", WebkitLineClamp: 6, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" }}
            dangerouslySetInnerHTML={{ __html: formatRichTextContent(s.body) }}
          />
        ) : (
          <div style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>No body content yet — open the Content tab to start writing.</div>
        )}
      </div>
    );
  }

  if (module.type === "blog-tag-cloud") {
    const s = module.settings;
    const layout = s.layout ?? "cloud";
    const inactiveColor = s.inactiveColor ?? "#587592";
    const inactiveBg = s.inactiveBg ?? "#f0f4f8";
    const activeColor = s.activeColor ?? "#0f4f8f";
    const minFont = parseInt(s.minFontSize ?? "12", 10) || 12;
    const maxFont = parseInt(s.maxFontSize ?? "22", 10) || 22;
    const gap = parseInt(s.gap ?? "8", 10) || 8;
    const showCounts = s.showCounts === "true";
    const justifyMap: Record<string, string> = { left: "flex-start", center: "center" };
    const tags = parseCloudTags(s);
    const placeholders = tags.length === 0
      ? [{ id: "p1", label: "react", slug: "react", count: 24 }, { id: "p2", label: "typescript", slug: "typescript", count: 18 }, { id: "p3", label: "design", slug: "design", count: 12 }, { id: "p4", label: "tutorial", slug: "tutorial", count: 8 }]
      : tags;
    const maxCount = Math.max(...placeholders.map((t) => t.count ?? 1), 1);

    function tagFontSize(count: number | undefined) {
      if (layout !== "cloud") return minFont;
      const pct = (count ?? 1) / maxCount;
      return Math.round(minFont + pct * (maxFont - minFont));
    }

    if (layout === "list") {
      return (
        <div className="builder-module-preview-copy">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap }}>
            {placeholders.map((tag, i) => (
              <li key={tag.id} style={{ fontSize: minFont, color: i === 0 ? activeColor : inactiveColor, fontWeight: i === 0 ? 600 : 400 }}>
                {tag.label}{showCounts ? <span style={{ marginLeft: 4, opacity: 0.6 }}>({tag.count ?? 1})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div className="builder-module-preview-copy">
        <div style={{ display: "flex", flexWrap: "wrap", gap, justifyContent: justifyMap[s.alignment ?? "left"] ?? "flex-start", alignItems: "baseline" }}>
          {placeholders.map((tag, i) => {
            const fs = tagFontSize(tag.count);
            return (
              <span
                key={tag.id}
                style={{
                  fontSize: fs,
                  padding: layout === "cloud" ? `${Math.round(fs * 0.2)}px ${Math.round(fs * 0.55)}px` : "3px 10px",
                  borderRadius: layout === "cloud" ? 4 : 20,
                  background: i === 0 ? activeColor + "18" : inactiveBg,
                  color: i === 0 ? activeColor : inactiveColor,
                  fontWeight: i === 0 ? 600 : 400,
                  cursor: "default",
                }}
              >
                {tag.label}{showCounts ? <span style={{ marginLeft: 3, opacity: 0.6, fontSize: fs * 0.8 }}>({tag.count ?? 1})</span> : null}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  if (module.type === "blog-post-tags") {
    const s = module.settings;
    const tags = (s.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const layout = s.layout ?? "pills";
    const showPrefix = s.showPrefix !== "false";
    const prefix = s.prefix || "Tags:";
    const color = s.color ?? "#587592";
    const bgColor = s.bgColor ?? "#f0f4f8";
    const borderRadius = parseInt(s.borderRadius ?? "4", 10) || 4;
    const fontSize = parseInt(s.fontSize ?? "12", 10) || 12;
    const gap = parseInt(s.gap ?? "6", 10) || 6;
    const displayTags = tags.length > 0 ? tags : ["react", "typescript", "tutorial"];

    if (layout === "inline") {
      return (
        <div className="builder-module-preview-copy" style={{ fontSize, color, lineHeight: 1.6 }}>
          {showPrefix ? <span style={{ fontWeight: 600, marginRight: 4 }}>{prefix}</span> : null}
          {displayTags.join(" · ")}
        </div>
      );
    }

    return (
      <div className="builder-module-preview-copy" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap }}>
        {showPrefix ? <span style={{ fontSize, fontWeight: 600, color, marginRight: 2 }}>{prefix}</span> : null}
        {displayTags.map((tag) => (
          <span
            key={tag}
            style={{ fontSize, padding: "2px 8px", borderRadius, background: bgColor, color, cursor: "default" }}
          >
            {tag}
          </span>
        ))}
      </div>
    );
  }

  if (module.type === "blog-post-create") {
    const s = module.settings;
    const accent = s.accentColor ?? "#0f4f8f";
    const showFormTitle = s.showFormTitle !== "false";
    const formTitle = s.formTitle || "Create New Post";
    const submitLabel = s.submitLabel || "Publish Post";
    const draftLabel = s.draftLabel || "Save as Draft";
    const showSlug = s.showSlug !== "false";
    const showFeaturedImage = s.showFeaturedImage !== "false";
    const showExcerpt = s.showExcerpt !== "false";
    const showAuthorField = s.showAuthorField === "true";
    const showCategories = s.showCategories !== "false";
    const showTags = s.showTags !== "false";
    const showSeoFields = s.showSeoFields === "true";

    const fieldStyle: React.CSSProperties = {
      display: "block",
      width: "100%",
      padding: "6px 10px",
      border: "1px solid #c9d8e6",
      borderRadius: 4,
      fontSize: 12,
      color: "#18324a",
      background: "#fff",
      boxSizing: "border-box",
    };
    const labelStyle: React.CSSProperties = {
      display: "block",
      fontSize: 11,
      fontWeight: 600,
      color: "#587592",
      marginBottom: 3,
    };
    const fieldWrap: React.CSSProperties = { marginBottom: 10 };

    return (
      <div className="builder-module-preview-copy" style={{ background: "#f8fafc", border: "1px solid #dde8f0", borderRadius: 8, padding: 16 }}>
        {showFormTitle ? (
          <div style={{ fontSize: 16, fontWeight: 700, color: "#18324a", marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #e4ecf2" }}>
            {formTitle}
          </div>
        ) : null}

        {/* Title — always shown */}
        <div style={fieldWrap}>
          <span style={labelStyle}>Title <span style={{ color: "#c0392b" }}>*</span></span>
          <div style={{ ...fieldStyle, height: 28, background: "#fff" }} />
        </div>

        {showSlug ? (
          <div style={fieldWrap}>
            <span style={labelStyle}>Slug</span>
            <div style={{ ...fieldStyle, height: 28, background: "#f8fafc", color: "#8ba9be", fontSize: 11, lineHeight: "28px", paddingLeft: 10 }}>
              auto-generated from title
            </div>
          </div>
        ) : null}

        {showAuthorField ? (
          <div style={fieldWrap}>
            <span style={labelStyle}>Author</span>
            <div style={{ ...fieldStyle, height: 28 }} />
          </div>
        ) : null}

        {showFeaturedImage ? (
          <div style={fieldWrap}>
            <span style={labelStyle}>Featured Image</span>
            <div style={{ border: "1px dashed #c9d8e6", borderRadius: 4, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: "#8ba9be", fontSize: 11 }}>
              Click to upload or paste URL
            </div>
          </div>
        ) : null}

        {showExcerpt ? (
          <div style={fieldWrap}>
            <span style={labelStyle}>Excerpt</span>
            <div style={{ ...fieldStyle, height: 44 }} />
          </div>
        ) : null}

        {/* Body — always shown */}
        <div style={fieldWrap}>
          <span style={labelStyle}>Body <span style={{ color: "#c0392b" }}>*</span></span>
          <div style={{ border: "1px solid #c9d8e6", borderRadius: 4, background: "#fff", overflow: "hidden" }}>
            <div style={{ padding: "5px 8px", borderBottom: "1px solid #e4ecf2", display: "flex", gap: 6 }}>
              {["B", "I", "U", "¶", "⌘"].map((icon) => (
                <span key={icon} style={{ fontSize: 10, fontWeight: 700, color: "#8ba9be", cursor: "default", padding: "1px 3px" }}>{icon}</span>
              ))}
            </div>
            <div style={{ height: 60, padding: 8 }} />
          </div>
        </div>

        {showCategories ? (
          <div style={fieldWrap}>
            <span style={labelStyle}>Categories</span>
            <div style={{ ...fieldStyle, height: 28, display: "flex", alignItems: "center", color: "#8ba9be", fontSize: 11 }}>
              Select categories…
            </div>
          </div>
        ) : null}

        {showTags ? (
          <div style={fieldWrap}>
            <span style={labelStyle}>Tags</span>
            <div style={{ ...fieldStyle, height: 28, display: "flex", alignItems: "center", color: "#8ba9be", fontSize: 11 }}>
              Add tags, comma-separated…
            </div>
          </div>
        ) : null}

        {showSeoFields ? (
          <div style={{ ...fieldWrap, paddingTop: 8, borderTop: "1px solid #e4ecf2" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8ba9be", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>SEO</div>
            <div style={{ ...fieldWrap }}>
              <span style={labelStyle}>SEO Title</span>
              <div style={{ ...fieldStyle, height: 28 }} />
            </div>
            <div>
              <span style={labelStyle}>SEO Description</span>
              <div style={{ ...fieldStyle, height: 44 }} />
            </div>
          </div>
        ) : null}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <div style={{ padding: "6px 14px", border: `1px solid ${accent}44`, borderRadius: 4, color: accent, fontSize: 12, fontWeight: 600, background: "#fff", cursor: "default" }}>
            {draftLabel}
          </div>
          <div style={{ padding: "6px 14px", borderRadius: 4, background: accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "default" }}>
            {submitLabel}
          </div>
        </div>
      </div>
    );
  }

  if (module.type === "blog-post-manager") {
    const accent = module.settings.accentColor ?? "#0f4f8f";
    const rows = [
      { title: "Introducing Starcaster", status: "published", date: "Jun 23, 2026" },
      { title: "How to Build a Blog", status: "draft", date: "Jun 22, 2026" },
      { title: "Tips & Tricks", status: "draft", date: "Jun 20, 2026" },
    ];
    const statusColor = (s: string) => s === "published" ? "#16a34a" : "#6b7280";
    const statusBg   = (s: string) => s === "published" ? "#f0fdf4" : "#f3f4f6";
    return (
      <div className="builder-module-preview-copy" style={{ background: "#fff", border: "1px solid #dde8f0", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "0 12px", padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e4ecf2", fontSize: 10, fontWeight: 700, color: "#587592", textTransform: "uppercase" }}>
          <span>Title</span><span>Status</span><span>Date</span><span>Actions</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "0 12px", padding: "8px 12px", borderBottom: i < rows.length - 1 ? "1px solid #f0f4f8" : undefined, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#18324a", fontWeight: 500 }}>{row.title}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: statusColor(row.status), background: statusBg(row.status), borderRadius: 4, padding: "2px 6px" }}>{row.status}</span>
            <span style={{ fontSize: 11, color: "#8ba9be" }}>{row.date}</span>
            <span style={{ display: "flex", gap: 6 }}>
              <span style={{ fontSize: 13, color: accent, cursor: "default" }}>✎</span>
              <span style={{ fontSize: 13, color: "#c0392b", cursor: "default" }}>✕</span>
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (module.type === "blog-category-manager") {
    const accent = module.settings.accentColor ?? "#0f4f8f";
    const rows = [
      { name: "Technology", slug: "technology", color: "#3b82f6", description: "Tech news and tutorials" },
      { name: "Sports",     slug: "sports",     color: "#16a34a", description: "Game recaps and analysis" },
      { name: "Finance",    slug: "finance",    color: "#d97706", description: "Markets and investing" },
    ];
    return (
      <div className="builder-module-preview-copy" style={{ background: "#fff", border: "1px solid #dde8f0", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "16px 1fr auto auto auto", gap: "0 10px", padding: "7px 12px", background: "#f8fafc", borderBottom: "1px solid #e4ecf2", fontSize: 10, fontWeight: 700, color: "#587592", textTransform: "uppercase", alignItems: "center" }}>
          <span></span><span>Name</span><span>Slug</span><span>Description</span><span>Actions</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "16px 1fr auto auto auto", gap: "0 10px", padding: "7px 12px", borderBottom: i < rows.length - 1 ? "1px solid #f0f4f8" : undefined, alignItems: "center" }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: row.color, display: "inline-block" }} />
            <span style={{ fontSize: 12, color: "#18324a", fontWeight: 600 }}>{row.name}</span>
            <span style={{ fontSize: 10, color: "#8ba9be" }}>{row.slug}</span>
            <span style={{ fontSize: 10, color: "#8ba9be" }}>{row.description}</span>
            <span style={{ display: "flex", gap: 5 }}>
              <span style={{ fontSize: 12, color: accent, cursor: "default" }}>✎</span>
              <span style={{ fontSize: 12, color: "#c0392b", cursor: "default" }}>✕</span>
            </span>
          </div>
        ))}
        <div style={{ padding: "8px 12px", borderTop: "1px solid #e4ecf2" }}>
          <span style={{ fontSize: 11, color: accent, fontWeight: 600, cursor: "default" }}>+ Add Category</span>
        </div>
      </div>
    );
  }

  if (module.type === "messaging-topic-list") {
    const s = module.settings;
    const layout = s.layout ?? "pills";
    const activeColor = s.activeColor ?? "#0f4f8f";
    const activeBg = s.activeBg ?? activeColor;
    const inactiveColor = s.inactiveColor ?? "#587592";
    const inactiveBg = s.inactiveBg ?? "#f0f4f8";
    const borderRadius = parseInt(s.borderRadius ?? "20", 10) || 20;
    const fontSize = parseInt(s.fontSize ?? "13", 10) || 13;
    const gap = parseInt(s.gap ?? "8", 10) || 8;
    const allLabel = s.allLabel || "All Topics";
    const showAll = s.showAll !== "false";
    const sampleTopics = ["Technology", "Finance", "Health", "Sports"];
    const pills = showAll ? [allLabel, ...sampleTopics] : sampleTopics;
    if (layout === "dropdown") {
      return (
        <div className="builder-module-preview-copy">
          <select disabled style={{ fontSize, padding: "6px 12px", borderRadius: borderRadius / 2, border: "1px solid #c9d8e6", color: inactiveColor, background: inactiveBg, minWidth: 160 }}>
            {pills.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      );
    }
    if (layout === "list") {
      return (
        <div className="builder-module-preview-copy" style={{ display: "flex", flexDirection: "column", gap: gap / 2 }}>
          {pills.map((p, i) => (
            <span key={p} style={{ fontSize, color: i === 0 ? activeBg : inactiveColor, fontWeight: i === 0 ? 600 : 400, cursor: "default" }}>{p}</span>
          ))}
        </div>
      );
    }
    return (
      <div className="builder-module-preview-copy" style={{ display: "flex", flexWrap: "wrap", gap }}>
        {pills.map((p, i) => (
          <span key={p} style={{ fontSize, padding: "3px 10px", borderRadius, background: i === 0 ? activeBg : inactiveBg, color: i === 0 ? "#fff" : inactiveColor, fontWeight: i === 0 ? 600 : 400, cursor: "default" }}>{p}</span>
        ))}
      </div>
    );
  }

  if (module.type === "messaging-tag-list") {
    const s = module.settings;
    const layout = s.layout ?? "cloud";
    const inactiveColor = s.inactiveColor ?? "#587592";
    const inactiveBg = s.inactiveBg ?? "#f0f4f8";
    const gap = parseInt(s.gap ?? "8", 10) || 8;
    const minFs = parseInt(s.minFontSize ?? "12", 10) || 12;
    const maxFs = parseInt(s.maxFontSize ?? "22", 10) || 22;
    const sampleTags = [
      { t: "AI", w: 1 }, { t: "Marketing", w: 0.7 }, { t: "Strategy", w: 0.9 },
      { t: "Growth", w: 0.6 }, { t: "Content", w: 0.8 }, { t: "SEO", w: 0.5 },
    ];
    if (layout === "list") {
      return (
        <div className="builder-module-preview-copy" style={{ display: "flex", flexDirection: "column", gap: gap / 2 }}>
          {sampleTags.map(({ t }) => (
            <span key={t} style={{ fontSize: minFs, color: inactiveColor, cursor: "default" }}># {t}</span>
          ))}
        </div>
      );
    }
    return (
      <div className="builder-module-preview-copy" style={{ display: "flex", flexWrap: "wrap", gap }}>
        {sampleTags.map(({ t, w }) => {
          const fs = Math.round(minFs + (maxFs - minFs) * w);
          return (
            <span key={t} style={{ fontSize: fs, padding: layout === "pills" ? "2px 8px" : undefined, borderRadius: layout === "pills" ? 12 : undefined, background: layout === "pills" ? inactiveBg : undefined, color: inactiveColor, cursor: "default" }}>{t}</span>
          );
        })}
      </div>
    );
  }

  if (module.type === "admin-team-users") {
    const showTitle  = module.settings.showTitle !== "false";
    const title      = module.settings.tableTitle || "Team Members";
    const showAdd    = module.settings.showAddButton !== "false";
    const previewRows = [
      { email: "alice@example.com", role: "admin" },
      { email: "bob@example.com",   role: "editor" },
    ];
    const thStyle: React.CSSProperties = { background: "#e8f2fb", color: "#18324a", fontWeight: 700, fontSize: 11, padding: "5px 10px", textAlign: "left", borderBottom: "1px solid #c9dcea" };
    const tdStyle: React.CSSProperties = { padding: "5px 10px", fontSize: 11, color: "#18324a", borderBottom: "1px solid #edf2f7" };
    return (
      <div className="builder-module-preview-copy">
        {showTitle && <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 8 }}>{title}</div>}
        <div style={{ border: "1px solid #c9dcea", borderRadius: 8, overflow: "hidden", marginBottom: showAdd ? 8 : 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
                <th style={{ ...thStyle, width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.email}>
                  <td style={tdStyle}>{row.email}</td>
                  <td style={tdStyle}><span style={{ fontSize: 10, background: "#f0f4f8", padding: "1px 6px", borderRadius: 3, textTransform: "capitalize" }}>{row.role}</span></td>
                  <td style={tdStyle}><span style={{ fontSize: 10, color: "#587592", cursor: "default" }}>Edit · Remove</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showAdd && <div style={{ fontSize: 11, color: "#0b4f8f", fontWeight: 600, cursor: "default" }}>+ Add Team Member</div>}
      </div>
    );
  }

  if (module.type === "admin-modules") {
    const showTitle = module.settings.showTitle !== "false";
    const title     = module.settings.tableTitle || "Premium Modules";
    const modules   = [
      { label: "CRM", enabled: true },
      { label: "Blog", enabled: false },
    ];
    return (
      <div className="builder-module-preview-copy">
        {showTitle && <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 8 }}>{title}</div>}
        <div style={{ display: "grid", gap: 6 }}>
          {modules.map((m) => (
            <div key={m.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", border: "1px solid #c9dcea", borderRadius: 7, background: m.enabled ? "rgba(15,79,143,0.04)" : "#fff" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#18324a" }}>{m.label}</span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 10px", borderRadius: 4, background: m.enabled ? "#0f4f8f" : "#f0f4f8", color: m.enabled ? "#fff" : "#8ba9be", cursor: "default" }}>
                {m.enabled ? "Enabled" : "Enable"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (module.type === "admin-login") {
    const title      = module.settings.formTitle || "Admin Sign In";
    const btnText    = module.settings.buttonText || "Sign In";
    const showForgot = module.settings.showForgotPassword !== "false";
    const inputStyle: React.CSSProperties = { width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid #c9dcea", borderRadius: 6, boxSizing: "border-box", marginTop: 3, background: "#fafcff" };
    const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#18324a", display: "block", marginTop: 10 };
    return (
      <div className="builder-module-preview-copy" style={{ maxWidth: 340, border: "1px solid #dde8f0", borderRadius: 10, padding: "22px 20px", background: "#fff" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#18324a", marginBottom: 14 }}>{title}</div>
        <label style={labelStyle}>Email address</label>
        <input type="email" disabled placeholder="you@example.com" style={inputStyle} />
        <label style={labelStyle}>Password</label>
        <input type="password" disabled placeholder="••••••••" style={inputStyle} />
        <div style={{ marginTop: 14, padding: "8px 0", background: "#0f4f8f", color: "#fff", borderRadius: 6, textAlign: "center", fontSize: 12, fontWeight: 700, cursor: "default" }}>{btnText}</div>
        {showForgot && <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "#587592", textDecoration: "underline", cursor: "default" }}>Forgot your password?</div>}
      </div>
    );
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
  parentId?: string;
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
        href: String(raw.href || ""),
        ...(raw.parentId ? { parentId: String(raw.parentId) } : {})
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
  anchor
}: {
  onSelect: (item: ModulePaletteItem) => void;
  onClose: () => void;
  anchor: BuilderModalAnchor;
}) {
  const [group, setGroup] = useState<ModulePaletteGroup | null>(null);
  const groups = modulePaletteGroups.filter((g) => g.value !== "table" && g.value !== "contact-form" && g.value !== "crm-form");
  const items = group ? modulePaletteItems.filter((item) => item.group === group) : [];
  // Keep the popup on-screen even when the cell sits at the far edge of the
  // workspace (matches the .builder-table-inline-palette CSS box: 260×340).
  const style = getAnchoredModalStyle(anchor, { width: 260, height: 340, align: "start", gap: 4 });

  return (
    <div
      className="builder-table-inline-palette"
      onClick={(e) => e.stopPropagation()}
      style={style}
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
  pages = [],
  onUpdate
}: {
  cellKey: string;
  modules: BuilderTemplateModule[];
  pages?: BuilderPageRecord[];
  onUpdate: (cellKey: string, modules: BuilderTemplateModule[]) => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [paletteAnchor, setPaletteAnchor] = useState<BuilderModalAnchor>({ x: 0, y: 0 });
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

  function updateCellModule(id: string, updater: (current: BuilderTemplateModule) => BuilderTemplateModule) {
    onUpdate(cellKey, modules.map((m) => (m.id === id ? updater(m) : m)));
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
          {renderCompactCellModulePreview(mod)}
          {editingId === mod.id && (
            <BuilderCenteredModal title={mod.name || mod.type} onClose={() => setEditingId(null)}>
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

              {(mod.type === "text" || mod.type === "heading") && (
                <BuilderSettingRow label="Alignment" fullWidth>
                  <BuilderAlignmentIconGroup
                    value={getModuleAlignment(mod.settings)}
                    onChange={(alignment) => updateModuleSettings(mod.id, { alignment })}
                  />
                </BuilderSettingRow>
              )}

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
                    <BuilderImagePickerField
                      value={mod.settings.url ?? ""}
                      onChange={(url) => updateModuleSettings(mod.id, { url })}
                    />
                  </label>
                  <BuilderSettingRow label="Alignment" fullWidth>
                    <BuilderAlignmentIconGroup
                      value={getModuleAlignment(mod.settings)}
                      onChange={(alignment) => updateModuleSettings(mod.id, { alignment })}
                    />
                  </BuilderSettingRow>
                  <label className="field">
                    <span>Link</span>
                    <div className="builder-image-link-row">
                      {pages.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) updateModuleSettings(mod.id, { linkUrl: e.target.value });
                          }}
                        >
                          <option value="">— Page —</option>
                          {pages.map((p) => (
                            <option key={p.id} value={`/${p.slug}`}>{p.name}</option>
                          ))}
                        </select>
                      )}
                      <input
                        type="text"
                        value={mod.settings.linkUrl ?? ""}
                        onChange={(e) => updateModuleSettings(mod.id, { linkUrl: normalizeBuilderAssetUrl(e.target.value) })}
                        placeholder="/path-or-url"
                      />
                    </div>
                  </label>
                  <label className="field builder-checkbox-field">
                    <span>New Tab</span>
                    <input
                      type="checkbox"
                      checked={mod.settings.newTab === "true"}
                      onChange={(e) => updateModuleSettings(mod.id, { newTab: e.target.checked ? "true" : "false" })}
                    />
                  </label>
                  <BuilderImageModuleSettings module={mod} onUpdateModule={(updater) => updateCellModule(mod.id, updater)} />
                </>
              )}
            </div>
            </BuilderCenteredModal>
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
              setPaletteAnchor({ x: rect.left, y: rect.bottom });
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
            anchor={paletteAnchor}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Table module editor ---------- */

function TableModuleEditor({
  module,
  pages = [],
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  pages?: BuilderPageRecord[];
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
        <div className="builder-table-border-row">
          <BuilderInlineNumberSelect
            label="Border"
            value={module.settings.borderWidth ?? "1"}
            min={0}
            max={6}
            fallback="1"
            onChange={(value) => updateSetting("borderWidth", value)}
          />
          <label className="builder-table-color-field"><span>Color</span><input type="color" value={module.settings.borderColor ?? "#cccccc"} onChange={(e) => updateSetting("borderColor", e.target.value)} /></label>
        </div>
        <BuilderInlineNumberSelect
          label="Padding"
          value={module.settings.cellPadding ?? "8"}
          min={2}
          max={24}
          fallback="8"
          onChange={(value) => updateSetting("cellPadding", value)}
        />
        <label className="field builder-checkbox-field">
          <span>Column heads</span>
          <input
            type="checkbox"
            checked={module.settings.showColumnHeads !== "false"}
            onChange={(e) => updateSetting("showColumnHeads", e.target.checked ? "true" : "false")}
          />
        </label>
        <BuilderSettingRow label="Max Width (px)" fullWidth>
          <input
            type="number"
            min={0}
            max={2000}
            value={module.settings.tableMaxWidth ?? ""}
            placeholder="Full width"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") { updateSetting("tableMaxWidth", ""); return; }
              const n = Math.min(2000, Math.max(0, Number.parseInt(raw, 10) || 0));
              updateSetting("tableMaxWidth", String(n));
            }}
          />
        </BuilderSettingRow>
      </div>
      <div className="builder-table-structure-actions">
        <div className="builder-table-structure-row">
          <span>Columns: {colCount}</span>
          <button type="button" className="secondary-button" onClick={addColumn} disabled={colCount >= 10}>+ Col</button>
          <button type="button" className="secondary-button" onClick={removeColumn} disabled={colCount <= 1}>− Col</button>
        </div>
        <div className="builder-table-structure-row">
          <span>Rows: {td.rowCount}</span>
          <button type="button" className="secondary-button" onClick={addRow} disabled={td.rowCount >= 100}>+ Row</button>
          <button type="button" className="secondary-button" onClick={removeRow} disabled={td.rowCount <= 1}>− Row</button>
        </div>
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
                    <TableCellModules cellKey={`${ri}-${ci}`} modules={td.cells[`${ri}-${ci}`] || []} pages={pages} onUpdate={updateCellModules} />
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
              <label className="field builder-slider-item-grid-full"><span>Image URL</span><BuilderImagePickerField value={item.imageUrl} onChange={(url) => updateItem(item.id, { imageUrl: url })} /></label>
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

function parseNavPadding(navPadding: string): { v: number; h: number } {
  const parts = (navPadding || "").trim().split(/\s+/);
  const v = parseInt(parts[0]) || 8;
  const h = parts.length > 1 ? parseInt(parts[1]) || 12 : v;
  return { v, h };
}

function NavColorField({
  label,
  value,
  defaultColor,
  onChange
}: {
  label: string;
  value: string;
  defaultColor: string;
  onChange: (v: string) => void;
}) {
  const isSet = !!value;
  return (
    <BuilderSettingRow label={label} fullWidth>
      <div className="builder-nav-color-field">
        <input
          type="color"
          value={isSet ? value : defaultColor}
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet ? (
          <button type="button" className="builder-nav-color-clear" onClick={() => onChange("")} title="Reset to default">✕</button>
        ) : (
          <span className="builder-nav-color-hint">default</span>
        )}
      </div>
    </BuilderSettingRow>
  );
}

function NavModuleEditor({
  module,
  onUpdateModule,
  onUpdateModuleBackground
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (bg: BackgroundSettings) => BackgroundSettings) => void;
}) {
  const [styleCollapsed, setStyleCollapsed] = useState(false);
  const [linksCollapsed, setLinksCollapsed] = useState(false);
  const items = parseNavItems(module.settings);
  const { v: padV, h: padH } = parseNavPadding(module.settings.navPadding ?? "");

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
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }
  function removeItem(id: string) { persist(items.filter((item) => item.id !== id)); }
  function addItem() {
    persist([...items, { id: `nav-${Date.now()}-${items.length + 1}`, label: "", href: "" }]);
  }
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }
  function updatePadding(v: number, h: number) {
    updateSetting("navPadding", `${v}px ${h}px`);
  }

  return (
    <>
      <div className="builder-cell-panel">
        <BuilderCellPanelHeader
          title="Style"
          isCollapsed={styleCollapsed}
          onToggle={() => setStyleCollapsed((c) => !c)}
        />
        {!styleCollapsed && (
          <div className="builder-nav-style-grid">
            <div className="builder-nav-four-row">
              <BuilderInlineNumberSelect
                label="Font"
                value={module.settings.navFontSize ?? "16"}
                min={10} max={48} fallback="16"
                onChange={(v) => updateSetting("navFontSize", v)}
              />
              <BuilderInlineNumberSelect
                label="Radius"
                value={module.settings.navBorderRadius ?? "0"}
                min={0} max={48} fallback="0"
                onChange={(v) => updateSetting("navBorderRadius", v)}
              />
              <BuilderInlineNumberSelect
                label="Pad V"
                value={String(padV)}
                min={0} max={40} fallback="8"
                onChange={(v) => updatePadding(Number(v), padH)}
              />
              <BuilderInlineNumberSelect
                label="Pad H"
                value={String(padH)}
                min={0} max={60} fallback="12"
                onChange={(v) => updatePadding(padV, Number(v))}
              />
              <BuilderInlineNumberSelect
                label="Margin V"
                value={module.settings.navMarginV ?? "0"}
                min={0} max={80} fallback="0"
                onChange={(v) => updateSetting("navMarginV", v)}
              />
            </div>
            <BuilderSettingRow label="Bold" fullWidth>
              <input type="checkbox" checked={module.settings.navBold === "true"} onChange={(e) => updateSetting("navBold", e.target.checked ? "true" : "false")} />
            </BuilderSettingRow>
            <BuilderSettingRow label="Alignment" fullWidth>
              <select
                value={module.settings.navAlignment ?? "center"}
                onChange={(e) => updateSetting("navAlignment", e.target.value)}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </BuilderSettingRow>
            <div className="builder-nav-dir-levels-row">
              <BuilderSettingRow label="Direction" fullWidth>
                <select
                  value={module.settings.navDirection ?? "horizontal"}
                  onChange={(e) => updateSetting("navDirection", e.target.value)}
                >
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Levels" fullWidth>
                <select
                  value={module.settings.navLevels ?? "2"}
                  onChange={(e) => updateSetting("navLevels", e.target.value)}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </BuilderSettingRow>
            </div>
            <NavColorField label="Text" value={module.settings.navColor ?? ""} defaultColor="#163a5e" onChange={(v) => updateSetting("navColor", v)} />
            <NavColorField label="Hover text" value={module.settings.navHoverColor ?? ""} defaultColor="#0a8fc4" onChange={(v) => updateSetting("navHoverColor", v)} />
            <NavColorField label="Hover bg" value={module.settings.navHoverBackground ?? ""} defaultColor="#d0f0fb" onChange={(v) => updateSetting("navHoverBackground", v)} />
            <BuilderBackgroundControls
              label="Background"
              background={getModuleBackgroundSettings(module.settings)}
              onChange={onUpdateModuleBackground}
            />
          </div>
        )}
      </div>

      <div className="builder-cell-panel">
        <BuilderCellPanelHeader
          title="Links"
          isCollapsed={linksCollapsed}
          onToggle={() => setLinksCollapsed((c) => !c)}
        />
        {!linksCollapsed && (
          <>
            <div className="builder-nav-items">
              {items.map((item, index) => {
                const isParent = items.some((i) => i.parentId === item.id);
                const topLevelItems = items.filter((i) => !i.parentId && i.id !== item.id);
                return (
                  <div key={item.id} className="builder-nav-item-row">
                    <div className="builder-nav-item-fields">
                      <select
                        className="builder-nav-item-parent-select"
                        value={item.parentId ?? ""}
                        disabled={isParent}
                        title={isParent ? "This item has sub-items and cannot itself be a sub-item" : undefined}
                        onChange={(e) => updateItem(item.id, { parentId: e.target.value || undefined })}
                      >
                        <option value="">Top level</option>
                        {topLevelItems.map((parent) => (
                          <option key={parent.id} value={parent.id}>{parent.label || `Link ${items.indexOf(parent) + 1}`}</option>
                        ))}
                      </select>
                      <input type="text" className="builder-nav-item-label" value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} placeholder={`Link ${index + 1}`} />
                      <input type="text" className="builder-nav-item-href" value={item.href} onChange={(e) => updateItem(item.id, { href: e.target.value })} placeholder="/path-or-url" />
                    </div>
                    <div className="builder-nav-item-actions">
                      <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, -1)} title="Move up">↑</button>
                      <button type="button" className="builder-icon-button" onClick={() => moveItem(item.id, 1)} title="Move down">↓</button>
                      <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeItem(item.id)} title="Remove">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" className="secondary-button" onClick={addItem}>+ Add Link</button>
          </>
        )}
      </div>
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

function ModuleEditorWrapper({
  isPopped,
  title,
  onClose,
  children
}: {
  isPopped: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (isPopped) {
    return (
      <BuilderCenteredModal title={title} onClose={onClose} maxWidth={680}>
        <div className="builder-module-editor">{children}</div>
      </BuilderCenteredModal>
    );
  }
  return <div className="builder-module-editor">{children}</div>;
}

function CrmFormModuleSettings({ crmFormId, onChange }: { crmFormId: string; onChange: (id: string) => void }) {
  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const projectId = (window as unknown as { App?: { projectContext?: { getSessionProjectId?: () => string } } })?.App?.projectContext?.getSessionProjectId?.() ?? '';
    const headers: Record<string, string> = {};
    if (projectId) headers['X-Project-ID'] = projectId;
    fetch("/api/crm/forms", { headers })
      .then((r) => r.json())
      .then((d) => {
        const list = d?.forms ?? d?.data ?? [];
        setForms(Array.isArray(list) ? list : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="builder-contact-form-settings">
      <label className="field">
        <span>CRM Form</span>
        {loading ? (
          <select disabled><option>Loading forms…</option></select>
        ) : forms.length === 0 ? (
          <div className="builder-module-runtime-note" style={{ marginTop: 0 }}>
            <p>No CRM forms found. Create one in <strong>Builder › CRM › Forms</strong>.</p>
          </div>
        ) : (
          <select value={crmFormId} onChange={(e) => onChange(e.target.value)}>
            <option value="">— Select a form —</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>{f.name || f.id}</option>
            ))}
          </select>
        )}
      </label>
    </div>
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
  pages = [],
  products = [],
  hideHeaderActions = false,
  isEmailTemplate = false,
  moduleClassOverride,
  onModuleDragStart,
  themeColors,
  themeStyle
}: BuilderModuleCardProps) {
    const [isPopped, setIsPopped] = useState(false);
    const moduleHeaderRef = useRef<HTMLDivElement | null>(null);
    const moduleMountedRef = useRef(false);

    useEffect(() => {
      if (!moduleMountedRef.current) { moduleMountedRef.current = true; return; }
      if (!isExpanded || !moduleHeaderRef.current) return;
      const el = moduleHeaderRef.current;
      document.querySelectorAll("[data-builder-focus]").forEach((n) => n.removeAttribute("data-builder-focus"));
      el.setAttribute("data-builder-focus", "true");
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return () => { el.removeAttribute("data-builder-focus"); };
    }, [isExpanded]);

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
    const isTractorNavModule  = module.type === "tractor-nav";
    const isSocialModule = module.type === "social";
    const isPollCategoryListModule = module.type === "poll-category-list";
    const isBreadcrumbModule = module.type === "breadcrumb";
    const isBlogPostListModule = module.type === "blog-post-list";
    const isBlogPostCardModule = module.type === "blog-post-card";
    const isBlogAuthorBioModule = module.type === "blog-author-bio";
    const isBlogTocModule = module.type === "blog-toc";
    const isBlogNewsletterModule = module.type === "blog-newsletter-subscribe";
    const isBlogRelatedPostsModule = module.type === "blog-related-posts";
    const isBlogCategoryFilterModule = module.type === "blog-category-filter";
    const isBlogPostModule = module.type === "blog-post";
    const isBlogTagCloudModule = module.type === "blog-tag-cloud";
    const isBlogPostTagsModule = module.type === "blog-post-tags";
    const isBlogPostCreateModule = module.type === "blog-post-create";
    const isBlogPostManagerModule = module.type === "blog-post-manager";
    const isBlogCategoryManagerModule = module.type === "blog-category-manager";
    const isMessagingTopicListModule = module.type === "messaging-topic-list";
    const isMessagingTagListModule = module.type === "messaging-tag-list";
    const isCrmContactsTableModule = module.type === "crm-contacts-table";
    const isAdminTeamUsersModule = module.type === "admin-team-users";
    const isAdminModulesModule = module.type === "admin-modules";
    const isAdminLoginModule = module.type === "admin-login";
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
      <div aria-expanded={isExpanded} className="builder-module-header" ref={moduleHeaderRef}>
        <div className="builder-module-title">
          <div className="builder-module-title-text">
            <strong>{module.name || module.type}</strong>
            <span>{module.type}</span>
          </div>
          {module.savedModuleId ? (
            <button
              aria-label={module.canonicalLocked ? "Unlock: allow push updates from canonical" : "Lock: block push updates from canonical"}
              className={`builder-canonical-badge${module.canonicalLocked ? " builder-canonical-badge-locked" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onUpdateModule((m) => ({ ...m, canonicalLocked: !m.canonicalLocked }));
              }}
              title={module.canonicalLocked ? "Custom (push updates blocked) — click to re-link" : "Linked to canonical — click to lock"}
              type="button"
            >
              {module.canonicalLocked ? "Custom" : "Linked"}
            </button>
          ) : null}
        </div>
        {hideHeaderActions ? (
          <div className="builder-section-actions">
            <button aria-label={isExpanded ? "Collapse module" : "Expand module"} className="builder-icon-button" onClick={onToggleExpanded} title={isExpanded ? "Collapse module" : "Expand module"} type="button"><BuilderCollapseIcon expanded={isExpanded} /></button>
          </div>
        ) : (
          <div className="builder-section-actions">
            <button aria-label={isExpanded ? "Collapse module" : "Expand module"} className="builder-icon-button" onClick={onToggleExpanded} title={isExpanded ? "Collapse module" : "Expand module"} type="button"><BuilderCollapseIcon expanded={isExpanded} /></button>
            <button aria-label="Open editor in popup" className={`builder-icon-button${isPopped ? " builder-icon-button-active" : ""}`} onClick={() => setIsPopped((p) => !p)} title="Open editor in popup" type="button">⤢</button>
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

      {(isExpanded || isPopped) ? (
        <ModuleEditorWrapper isPopped={isPopped} title={module.name || module.type} onClose={() => setIsPopped(false)}>
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
            ) : isTractorNavModule ? (
              <BuilderTractorNavModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBreadcrumbModule ? (
              <BuilderBreadcrumbModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostListModule ? (
              <BuilderBlogPostListModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostCardModule ? (
              <BuilderBlogPostCardModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogAuthorBioModule ? (
              <BuilderBlogAuthorBioModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogTocModule ? (
              <BuilderBlogTocModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogNewsletterModule ? (
              <BuilderBlogNewsletterSubscribeModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogRelatedPostsModule ? (
              <BuilderBlogRelatedPostsModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogCategoryFilterModule ? (
              <BuilderBlogCategoryFilterModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostModule ? (
              <BuilderBlogPostModuleSettings module={module} onUpdateModule={onUpdateModule} richTextGallery={richTextGalleryProps} />
            ) : isBlogTagCloudModule ? (
              <BuilderBlogTagCloudModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostTagsModule ? (
              <BuilderBlogPostTagsModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostCreateModule ? (
              <BuilderBlogPostCreateModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostManagerModule ? (
              <BuilderBlogPostManagerModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogCategoryManagerModule ? (
              <BuilderBlogCategoryManagerModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isMessagingTopicListModule ? (
              <BuilderMessagingTopicListModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isMessagingTagListModule ? (
              <BuilderMessagingTagListModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isCrmContactsTableModule ? (
              <BuilderCrmContactsTableModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminTeamUsersModule ? (
              <BuilderAdminTeamUsersModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminModulesModule ? (
              <BuilderAdminModulesModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminLoginModule ? (
              <BuilderAdminLoginModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isSocialModule ? (
              <BuilderSocialModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
                onOpenGallery={onOpenSocialIconGallery}
                themeColors={themeColors}
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
                {/* Speech bubble uses its own flat fill color (BuilderSpeechBubbleModuleSettings);
                    the standard modal's gradient/image/style modes are no-ops on a bubble. */}
                {module.type !== "speech-bubble" ? (
                  <BuilderBackgroundControls
                    label="Background"
                    background={getModuleBackgroundSettings(module.settings)}
                    horizontal
                    onChange={onUpdateModuleBackground}
                  />
                ) : null}
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

          {(isStandardImage || isVideoModule) && (
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

          {module.type === "crm-form" && (
            <CrmFormModuleSettings
              crmFormId={module.settings.crmFormId ?? ""}
              onChange={(id) =>
                onUpdateModule((current) => ({
                  ...current,
                  settings: { ...current.settings, crmFormId: id }
                }))
              }
            />
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

          {(isStandardImage || isVideoModule) ? (
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
            <BuilderImageModuleSettings module={module} onUpdateModule={onUpdateModule} />
          ) : null}

          {module.type === "heading" ? (
            <BuilderHeadingModuleSettings module={module} onUpdateModule={onUpdateModule} />
          ) : null}

          {module.type === "table" && <TableModuleEditor module={module} pages={pages} onUpdateModule={onUpdateModule} />}
          {module.type === "slider" && <SliderModuleEditor module={module} onUpdateModule={onUpdateModule} />}
          {module.type === "navigation" && <NavModuleEditor module={module} onUpdateModule={onUpdateModule} onUpdateModuleBackground={onUpdateModuleBackground} />}
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
          module.type !== "crm-form" &&
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
                  themeColors={themeColors}
                  themeStyle={themeStyle}
                  {...richTextGalleryProps}
                />
              ) : (
                <textarea className="builder-textarea" value={module.text} onChange={(event) => onUpdateModule((current) => ({ ...current, text: event.target.value }))} placeholder="Enter content" />
              )}
            </label>
          ) : null}
          </>
          )}
        </ModuleEditorWrapper>
      ) : null}
    </div>
  );
}
