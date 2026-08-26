import Image from "next/image";
import { type CSSProperties, type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { BuilderCenteredModal } from "./builder-centered-modal";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderImageModuleSettings } from "./builder-image-module-settings";
import { BuilderFeatureCardsModuleSettings } from "./builder-feature-cards-module-settings";
import { BuilderProgramListModuleSettings } from "./builder-program-list-module-settings";
import { parsePrograms, formatSessionHours } from "@/lib/builder-program-list";
import {
  BuilderCarouselModuleSettings,
  parseBuilderCarouselItems,
  resolveCarouselFormat
} from "./builder-carousel-module-settings";
import { getCarouselImageFrameStyle } from "@/lib/builder-carousel-image-frame";
import {
  createBuilderCardItem,
  parseBuilderCardItems,
  serializeBuilderCardItems,
  type BuilderCardItem
} from "@/lib/builder-card-items";
import { BuilderNavigationModuleSettings } from "./builder-navigation-module-settings";
import type {
  BackgroundSettings,
  BuilderPageRecord,
  BuilderProductRecord,
  BuilderTemplateModule,
  BuilderTemplateModuleType
} from "@/lib/builder-template";
import {
  getBuilderBackgroundStyle,
  isPlainTextVariant,
  normalizeBuilderAssetUrl,
  formatHeadingContent,
  formatPlainTextContent,
  formatRichTextContent,
  normalizeSignedOffsetValue
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
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
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
import { BuilderBlogCardManagerModuleSettings } from "./builder-blog-card-manager-module-settings";
import { BuilderBlogSearchModuleSettings } from "./builder-blog-search-module-settings";
import { BuilderBlogSearchResultsModuleSettings } from "./builder-blog-search-results-module-settings";
import { BuilderSiteSearchModuleSettings } from "./builder-site-search-module-settings";
import { BuilderSiteSearchResultsModuleSettings } from "./builder-site-search-results-module-settings";
import { BuilderMessagingTopicListModuleSettings } from "./builder-messaging-topic-list-module-settings";
import { BuilderMessagingTagListModuleSettings } from "./builder-messaging-tag-list-module-settings";
import { BuilderCrmContactsTableModuleSettings } from "./builder-crm-contacts-table-module-settings";
import { BuilderTableModuleSettings } from "./builder-table-module-settings";
import { PLAIN_TEXT_PLACEHOLDER } from "./builder-types";
import { parseTableData } from "@/lib/builder-table-data";
import { BuilderCrmFormModuleSettings } from "./builder-crm-form-module-settings";
import { BuilderAdminTeamUsersModuleSettings } from "./builder-admin-team-users-module-settings";
import { BuilderAdminModulesModuleSettings } from "./builder-admin-modules-module-settings";
import { BuilderAdminLoginModuleSettings } from "./builder-admin-login-module-settings";
import { BuilderAdminNavLinkModuleSettings } from "./builder-admin-nav-link-module-settings";
import { BuilderBugReportModuleSettings } from "./builder-bug-report-module-settings";
import { BuilderAdminSiteSettingsModuleSettings } from "./builder-admin-site-settings-module-settings";
import { BuilderAdminSupportFormModuleSettings } from "./builder-admin-support-form-module-settings";
import { BuilderCurrentPollModuleSettings } from "./builder-current-poll-module-settings";
import { BuilderSocialModuleSettings } from "./builder-social-module-settings";
import { BuilderImagePreview } from "./builder-image-preview";
import {
  getAlignmentClass,
  getHeadingModuleStyle,
  getModuleAlignment,
  getModuleBackgroundSettings,
  isPollCategoryListPanelTransparent,
  getModuleOuterSpacingStyle,
  getTableWrapStyle,
  getPlainTextModuleStyle,
  getTextModuleFrameStyle,
  getTextModuleRhythmStyle,
  getTextModuleWidthStyle,
  getButtonModuleStyle,
  getVideoEmbedSource,
  isVideoMedia
} from "./builder-utils";
import { BuilderModuleSpacingFields } from "./builder-spacing-fields";
import { BuilderButtonModuleSettings } from "./builder-button-module-settings";
import { BuilderHeadingModuleSettings } from "./builder-heading-module-settings";
import { BuilderSimpleTextModuleSettings } from "./builder-simple-text-module-settings";
import { BuilderTextModuleSettings } from "./builder-text-module-settings";
import {
  BuilderThemeColorField,
  BuilderThemeColorFieldWithDefault,
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";
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
  BuilderInlineNumberSelectRow
} from "./builder-inline-number-select";
import { imageProps } from "@/lib/image-renditions";

/** Cards sit two or three across the content column. */
const CARD_SIZES = "(max-width: 700px) 100vw, 400px";

// Simple Text gets a bare typing box rather than the rich-text toolbar: the
// editor can only produce paragraph blocks, which is the one thing this module
// exists to avoid. The placeholder shows what the box accepts.

/**
 * Editors laid out as two equal columns — settings left, the item list right.
 *
 * These need the module chrome (Label, Background, Alignment, the four
 * margins) to fall into the LEFT column rather than span the panel, so the
 * item list can start at row 1 level with the Label field. The chrome is
 * rendered here, not by the settings component, so the grid lives on
 * `.builder-module-editor--<type>` and this set is what names the members.
 * Adding a module to the shape means adding it here and to the matching CSS
 * selector list in `_builder-react-overrides.css`.
 */
const TWO_COLUMN_EDITOR_TYPES = new Set(["feature-cards", "carousel", "program-list", "social"]);

/**
 * The two nudge controls, named and ordered like `MODULE_MARGIN_SIDES` so a
 * strip that carries both reads as one list.
 *
 * The hint is a `title` rather than a line of text under the box: the same
 * words `BuilderModuleOffsetFields` prints, but a chrome strip is one label
 * track and one control track, and a caption in the control cell widens that
 * track for every row above it.
 */
const MODULE_NUDGE_SIDES = [
  // "H Offset" / "V Offset" rather than the words spelled out (2026-08-25).
  // They sit directly under `V Margin` and `H Margin`, which have taught that
  // convention since 8/15, and a label never wraps — it is shortened instead
  // (components/CLAUDE.md). Spelled out, "Horizontal Offset" was the longest
  // label in the chrome by 60px, so it alone set the label track for the
  // whole column and pushed every chrome control 60px right of the settings
  // column below it. The hint keeps the direction unambiguous on hover.
  { key: "horizontalOffset", label: "H Offset", hint: "Positive moves right; negative moves left." },
  { key: "verticalOffset", label: "V Offset", hint: "Positive moves up; negative moves down." }
] as const;

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
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
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
          dangerouslySetInnerHTML={{ __html: formatHeadingContent(module.text) || "Heading" }}
          style={getHeadingModuleStyle(module.settings)}
        />
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
      { email: "alice@example.com", firstName: "Alice", lastName: "Johnson", phone: "555-0100" },
      { email: "bob@example.com", firstName: "Bob", lastName: "Smith", phone: "555-0101" },
      { email: "carol@example.com", firstName: "Carol", lastName: "White", phone: "555-0102" },
    ];
    return (
      <div className="builder-module-preview-copy builder-admin-data-table-module">
        {showTitle && <div className="builder-admin-data-table-title">{title}</div>}
        <div className="builder-admin-data-table-wrap">
          <table className="builder-admin-data-table">
            <thead>
              <tr className="builder-admin-data-table-filter-row table-filter-row">
                <th>
                  {showSearch && (
                    <div className="builder-admin-data-table-filter-input" aria-hidden="true" style={{ color: "#9ab0c4" }}>Email</div>
                  )}
                </th>
                <th>
                  {showSearch && (
                    <div className="builder-admin-data-table-filter-input" aria-hidden="true" style={{ color: "#9ab0c4" }}>First Name</div>
                  )}
                </th>
                <th>
                  {showSearch && (
                    <div className="builder-admin-data-table-filter-input" aria-hidden="true" style={{ color: "#9ab0c4" }}>Last Name</div>
                  )}
                </th>
                <th>
                  {showSearch && (
                    <div className="builder-admin-data-table-filter-input" aria-hidden="true" style={{ color: "#9ab0c4" }}>Phone</div>
                  )}
                </th>
                <th />
                <th className="builder-admin-data-table-actions-col actions-col">
                  {showAdd && (
                    <button type="button" className="btn tiny-btn" disabled aria-hidden="true" style={{ cursor: "default" }}>
                      {addLabel}
                    </button>
                  )}
                </th>
              </tr>
              <tr className="builder-admin-data-table-header-row">
                <th>Email</th>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Phone</th>
                <th>Added</th>
                <th className="builder-admin-data-table-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.email}>
                  <td className="builder-admin-data-table-cell">{row.email}</td>
                  <td className="builder-admin-data-table-cell">{row.firstName}</td>
                  <td className="builder-admin-data-table-cell">{row.lastName}</td>
                  <td className="builder-admin-data-table-cell">{row.phone}</td>
                  <td className="builder-admin-data-table-cell builder-admin-data-table-date">Jan 1, 2026</td>
                  <td className="builder-admin-data-table-actions">
                    <div className="table-actions-row" role="group">
                      {s.showViewButton !== "false" && <span className="builder-admin-icon-btn" aria-hidden="true" />}
                      {s.showEditButton !== "false" && <span className="builder-admin-icon-btn" aria-hidden="true" />}
                      {s.showDeleteButton !== "false" && <span className="builder-admin-icon-btn builder-admin-icon-btn-danger" aria-hidden="true" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="builder-admin-data-table-count">3 contacts</div>
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

    return (
      <div className="builder-module-preview-table-wrap" style={getTableWrapStyle(module.settings)}>
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

  if (module.type === "carousel") {
    // The canvas card is a glance, not the page: one format shows its first
    // picture with a count, the other shows the shelf. Both read from the same
    // `items`, which is the point of the merge.
    const items = parseBuilderCarouselItems(module.settings);
    const isCards = resolveCarouselFormat(module.settings) === "cards";
    // The same frame the page draws, so the glance does not quietly disagree
    // with what the operator just set two feet to the right of it.
    const imageFrame = getCarouselImageFrameStyle(module.settings);

    if (items.length === 0) {
      return (
        <span className="builder-module-preview-empty">
          {isCards ? "Add cards in the editor" : "Add slides in the editor"}
        </span>
      );
    }

    if (isCards) {
      const gap = Number.parseInt(module.settings.gap || "16", 10);
      const cardWidth = Number.parseInt(module.settings.cardWidth || "280", 10);
      return (
        <div className="builder-module-preview-carousel-cards" style={{ gap: `${gap}px` }}>
          {items.map((item) => (
            <article
              key={item.id}
              className="builder-module-preview-carousel-card"
              style={{ minWidth: `${cardWidth}px` }}
            >
              {item.imageUrl ? (
                <img
                  {...imageProps(item.imageUrl, { sizes: "220px" })}
                  alt={item.imageAlt || item.title || ""}
                  loading="lazy"
                  style={imageFrame}
                />
              ) : null}
              <div className="builder-module-preview-carousel-card-copy">
                <strong>{item.title || "Card title"}</strong>
                <p>{item.body || "Card body"}</p>
              </div>
            </article>
          ))}
        </div>
      );
    }

    const first = items[0];
    return (
      <div className="builder-module-preview-carousel">
        <img
          {...imageProps(first.imageUrl)}
          alt={first.imageAlt || ""}
          loading="lazy"
          style={imageFrame}
        />
        {items.length > 1 ? (
          <span className="builder-module-preview-carousel-count">{items.length} slides</span>
        ) : null}
      </div>
    );
  }

  if (module.type === "program-list") {
    const programs = parsePrograms(module.settings.programs);

    if (programs.length === 0) {
      return <span className="builder-module-preview-empty">Add programs in the editor</span>;
    }

    // The canvas card is a glance, not the page. It names the programs and
    // how often each runs, which is what an operator scanning a long page
    // needs to tell one Programs module from another.
    return (
      <div className="builder-module-preview-programs">
        {programs.slice(0, 6).map((program) => (
          <div key={program.id} className="builder-module-preview-program">
            <strong>{program.title}</strong>
            {program.sessions.length > 0 ? (
              <span>
                {program.sessions.length === 1
                  ? `${program.sessions[0].day} ${formatSessionHours(program.sessions[0])}`.trim()
                  : `${program.sessions.length} sessions`}
              </span>
            ) : null}
          </div>
        ))}
        {programs.length > 6 ? (
          <div className="builder-module-preview-program">
            <span>{`+${programs.length - 6} more`}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (module.type === "feature-cards") {
    const cards = parseBuilderCardItems(module.settings.cards, "card");
    const columns = Math.min(6, Math.max(1, Number.parseInt(module.settings.cardColumns || "3", 10) || 3));

    if (cards.length === 0) {
      return <span className="builder-module-preview-empty">Add cards in the editor</span>;
    }

    return (
      <div
        className="builder-module-preview-feature-cards"
        style={{ gridTemplateColumns: `repeat(${Math.min(columns, cards.length)}, minmax(0, 1fr))` }}
      >
        {cards.slice(0, 6).map((card) => (
          <article key={card.id} className="builder-module-preview-feature-card">
            {card.imageUrl ? <img {...imageProps(card.imageUrl, { sizes: CARD_SIZES })} alt={card.imageAlt || ""} loading="lazy" /> : null}
            <strong>{card.title || "Untitled card"}</strong>
          </article>
        ))}
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

  if (module.type === "blog-search") {
    const s = module.settings;
    const accent = s.accentColor || "#0f4f8f";
    const radius = parseInt(s.borderRadius ?? "8", 10) || 8;
    const placeholder = s.placeholder || "Search posts…";
    const buttonLabel = s.buttonLabel || "Search";

    return (
      <div className="builder-module-preview-copy">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, height: 38, background: "#fff", border: "1px solid #c6d8e8", borderRadius: radius, padding: "0 12px", display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#aab" }}>{placeholder}</span>
          </div>
          <div style={{ height: 38, padding: "0 16px", background: accent, borderRadius: radius, display: "flex", alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{buttonLabel}</span>
          </div>
        </div>
      </div>
    );
  }

  if (module.type === "blog-search-results") {
    const thumbW = parseInt(module.settings.thumbWidth ?? "120", 10) || 120;
    const rows = [
      { title: "Getting Started with Starcaster", excerpt: "A walkthrough of the core concepts and first steps." },
      { title: "Building Your First Blog", excerpt: "How to set up categories, posts, and a live feed." },
      { title: "Advanced Module Settings", excerpt: "Deep dive into layouts, themes, and responsive design." },
    ];
    return (
      <div className="builder-module-preview-copy">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", borderBottom: i < rows.length - 1 ? "1px solid #e8eef4" : "none", paddingBottom: i < rows.length - 1 ? 12 : 0 }}>
              <div style={{ width: thumbW, flexShrink: 0, aspectRatio: "16/9", background: "#d4e3ef", borderRadius: 6 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#18324a", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
                <div style={{ fontSize: 12, color: "#587592", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{row.excerpt}</div>
              </div>
              <div style={{ flexShrink: 0, fontSize: 11, color: "#8aa", whiteSpace: "nowrap", paddingTop: 2 }}>Jun 29, 2026</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (module.type === "site-search") {
    const s = module.settings;
    const num = (raw: string | undefined, fallback: number) => {
      const parsed = parseInt(String(raw ?? ""), 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const accent = s.accentColor || "#0f4f8f";
    const radius = num(s.borderRadius, 8);
    const placeholder = s.placeholder || "Search this site…";
    const buttonLabel = s.buttonLabel || "Search";
    const showButton = (s.showButton ?? "true") !== "false";
    const showLabel = s.showLabel === "true";
    const labelText = s.labelText || "Search";
    const labelInline = s.labelPosition === "inline";
    // The card mirrors the real settings so the canvas is not quietly lying
    // about what the page will show — the whole point of a preview.
    const fieldWidth = num(s.fieldWidth, 0);
    const height = Math.min(96, Math.max(24, num(s.fieldHeight, 40))) - 2;
    const btnBorderWidth = num(s.buttonBorderWidth, 0);
    const label = showLabel ? (
      <span
        style={{
          fontSize: num(s.labelFontSize, 13),
          fontWeight: s.labelBold === "true" ? 700 : 400,
          color: s.labelColor || "#18324a",
          whiteSpace: "nowrap"
        }}
      >
        {labelText}
      </span>
    ) : null;

    return (
      <div className="builder-module-preview-copy">
        {showLabel && !labelInline ? <div style={{ marginBottom: 6 }}>{label}</div> : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {showLabel && labelInline ? label : null}
          <div
            style={{
              flex: fieldWidth > 0 ? `0 0 ${fieldWidth}px` : 1,
              maxWidth: "100%",
              height,
              background: "#fff",
              border: "1px solid #c6d8e8",
              borderRadius: radius,
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
              overflow: "hidden"
            }}
          >
            <span style={{ fontSize: 13, color: "#aab", whiteSpace: "nowrap" }}>{placeholder}</span>
          </div>
          {showButton ? (
            <div
              style={{
                height,
                padding: "0 16px",
                background: accent,
                border: btnBorderWidth
                  ? `${btnBorderWidth}px ${s.buttonBorderStyle || "solid"} ${s.buttonBorderColor || "#000000"}`
                  : "none",
                borderRadius: radius,
                display: "flex",
                alignItems: "center",
                flexShrink: 0
              }}
            >
              <span
                style={{
                  fontSize: num(s.buttonFontSize, 13),
                  color: s.buttonTextColor || "#fff",
                  fontWeight: s.buttonBold === "false" ? 400 : 600,
                  whiteSpace: "nowrap"
                }}
              >
                {buttonLabel}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (module.type === "site-search-results") {
    const accent = module.settings.accentColor || "#0f4f8f";
    // Static sample — the real list comes from the live pages at render time.
    const rows = [
      { title: "Pricing", before: "Plans start at $19 a month, and every plan includes ", hit: "support", after: " from a real person." },
      { title: "Contact Us", before: "Our ", hit: "support", after: " team answers within one business day." },
      { title: "FAQ", before: "How do I reach ", hit: "support", after: " outside office hours?" }
    ];
    return (
      <div className="builder-module-preview-copy">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid #e8eef4" : "none", paddingBottom: i < rows.length - 1 ? 12 : 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: accent, marginBottom: 3 }}>{row.title}</div>
              <div style={{ fontSize: 12, color: "#587592", lineHeight: 1.4 }}>
                {row.before}
                <mark style={{ background: "#fff3b0", color: "#18324a" }}>{row.hit}</mark>
                {row.after}
              </div>
            </div>
          ))}
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
    const activeColor = s.activeColor || "#0f4f8f";
    const activeBg = s.activeBg || "#e8f6fc";
    const inactiveColor = s.inactiveColor || "#587592";
    const inactiveBg = s.inactiveBg || "#f0f4f8";
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
    const inactiveColor = s.inactiveColor || "#587592";
    const inactiveBg = s.inactiveBg || "#f0f4f8";
    const activeColor = s.activeColor || "#0f4f8f";
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
    const color = s.color || "#587592";
    const bgColor = s.bgColor || "#f0f4f8";
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
    const accent = s.accentColor || "#0f4f8f";
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
    const accent = module.settings.accentColor || "#0f4f8f";
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
    const accent = module.settings.accentColor || "#0f4f8f";
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
    const activeColor = s.activeColor || "#0f4f8f";
    const activeBg = s.activeBg ?? activeColor;
    const inactiveColor = s.inactiveColor || "#587592";
    const inactiveBg = s.inactiveBg || "#f0f4f8";
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
    const inactiveColor = s.inactiveColor || "#587592";
    const inactiveBg = s.inactiveBg || "#f0f4f8";
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
    const addLabel   = module.settings.addButtonLabel || "Add Team Member";
    const previewRows = [
      { email: "alice@example.com", role: "admin" },
      { email: "bob@example.com",   role: "editor" },
    ];
    return (
      <div className="builder-module-preview-copy builder-admin-data-table-module">
        {showTitle && <div className="builder-admin-data-table-title">{title}</div>}
        <div className="builder-admin-data-table-wrap">
          <table className="builder-admin-data-table">
            <thead>
              <tr className="builder-admin-data-table-filter-row table-filter-row">
                <th />
                <th />
                <th />
                <th className="builder-admin-data-table-actions-col actions-col">
                  {showAdd && (
                    <button type="button" className="btn tiny-btn" disabled aria-hidden="true" style={{ cursor: "default" }}>
                      {addLabel}
                    </button>
                  )}
                </th>
              </tr>
              <tr className="builder-admin-data-table-header-row">
                <th>Email</th>
                <th>Role</th>
                <th>Added</th>
                <th className="builder-admin-data-table-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.email}>
                  <td className="builder-admin-data-table-cell">{row.email}</td>
                  <td className="builder-admin-data-table-cell">
                    <span className="builder-admin-data-table-role-badge">{row.role}</span>
                  </td>
                  <td className="builder-admin-data-table-cell builder-admin-data-table-date">Jan 1, 2026</td>
                  <td className="builder-admin-data-table-actions">
                    <div className="table-actions-row" role="group">
                      <span className="builder-admin-icon-btn" aria-hidden="true" />
                      <span className="builder-admin-icon-btn builder-admin-icon-btn-danger" aria-hidden="true" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="builder-admin-data-table-count">2 team members</div>
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

  if (module.type === "admin-site-settings") {
    const showTitle = module.settings.showTitle !== "false";
    const title     = module.settings.panelTitle || "Site Settings";
    return (
      <div className="builder-module-preview-copy">
        {showTitle && <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 8 }}>{title}</div>}
        <div style={{ maxWidth: 380, padding: "12px 14px", border: "1px solid #c9dcea", borderRadius: 7, background: "#fff" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#18324a" }}>Contact Alert Email</div>
          <div style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 7px" }}>
            Where we email you when someone submits a contact form.
          </div>
          <input type="email" disabled placeholder="you@example.com" style={{ width: "100%", padding: "6px 9px", fontSize: 12, border: "1px solid #c9dcea", borderRadius: 6, boxSizing: "border-box", background: "#fafcff" }} />
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#0f4f8f", textDecoration: "underline" }}>
            + Add Recipient
          </div>
        </div>
        <div style={{ marginTop: 10, display: "inline-block", padding: "6px 14px", background: "#0f4f8f", color: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "default" }}>
          Save Settings
        </div>
      </div>
    );
  }

  if (module.type === "admin-support-form") {
    const showTitle      = module.settings.showTitle !== "false";
    const title          = module.settings.formTitle || "Request Support";
    const buttonText     = module.settings.buttonText || "Send Request";
    const showScreenshot = module.settings.showScreenshot !== "false";
    const showHistory    = module.settings.showHistory !== "false";
    const historyTitle   = module.settings.historyTitle || "Your Recent Requests";
    const showContact    = module.settings.showContact !== "false";
    const contactHeading = module.settings.contactHeading ?? "Need a hand with your website?";
    const twoColumn      = (module.settings.layout ?? "two-column") !== "stacked";
    const fieldStyle = {
      width: "100%", padding: "6px 9px", fontSize: 12, border: "1px solid #c9dcea",
      borderRadius: 6, boxSizing: "border-box" as const, background: "#fafcff",
    };
    return (
      <div className="builder-module-preview-copy">
        {showContact && (
          <div style={{ marginBottom: 12, maxWidth: 380 }}>
            {contactHeading ? (
              <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 4 }}>{contactHeading}</div>
            ) : null}
            <div style={{ fontSize: 11, color: "#8ba9be" }}>
              Email and phone come from Settings &rsaquo; Projects &rsaquo; Edit.
            </div>
          </div>
        )}
        <div style={twoColumn
          ? { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", alignItems: "start" }
          : undefined}
        >
          <div>
        {showTitle && <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 8 }}>{title}</div>}
        <div style={{ maxWidth: 380, padding: "12px 14px", border: "1px solid #c9dcea", borderRadius: 7, background: "#fff", display: "grid", gap: 9 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#18324a", marginBottom: 3 }}>Priority</div>
            <select disabled style={fieldStyle}><option>Normal</option></select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#18324a", marginBottom: 3 }}>Issue title</div>
            <input type="text" disabled placeholder="Short summary of the problem" style={fieldStyle} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#18324a", marginBottom: 3 }}>Issue description</div>
            <textarea disabled rows={3} placeholder="What happened, and what were you doing?" style={{ ...fieldStyle, resize: "none" }} />
          </div>
          {showScreenshot && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#18324a", marginBottom: 3 }}>Screenshot</div>
              <div style={{ ...fieldStyle, color: "#8ba9be", borderStyle: "dashed" }}>Choose an image…</div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 10, display: "inline-block", padding: "6px 14px", background: "#0f4f8f", color: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "default" }}>
          {buttonText}
        </div>
          </div>
        {showHistory && (
          <div style={{ marginTop: twoColumn ? 0 : 14, maxWidth: 380 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#18324a", marginBottom: 6 }}>{historyTitle}</div>
            <div style={{ fontSize: 11, color: "#8ba9be", border: "1px solid #e3edf5", borderRadius: 6, padding: "8px 10px" }}>
              Past requests appear here on the live page.
            </div>
          </div>
        )}
        </div>
      </div>
    );
  }

  if (module.type === "bug-report") {
    const label = module.settings.labelText || "";
    const who = module.settings.visibility === "staff" ? "staff only" : module.settings.visibility === "clients" ? "signed-in clients" : "everyone";
    return (
      <div className="builder-module-preview-copy" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 999,
            background: module.settings.iconBlock === "false" ? "transparent" : module.settings.blockColor || "#0f4f8f",
            color: module.settings.iconColor || "#fff",
            fontSize: 12,
            fontWeight: 600
          }}
        >
          🐞{label ? ` ${label}` : ""}
        </span>
        <span style={{ fontSize: 12, color: "#5c6a72" }}>
          floats {module.settings.corner === "bottom-left" ? "bottom left" : "bottom right"} · visible to {who}
        </span>
      </div>
    );
  }

  if (module.type === "admin-nav-link") {
    const linkText = module.settings.linkText || "Admin";
    return (
      <div className="builder-module-preview-copy" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 6,
            background: "#0f4f8f",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: "default"
          }}
        >
          {linkText}
        </span>
        <span style={{ fontSize: 11, color: "#587592" }}>Visible only when the admin cookie is set</span>
      </div>
    );
  }

  const isPlainText = module.type === "text" && isPlainTextVariant(module.settings);

  return (
    <div
      className={`builder-module-preview-paragraph builder-module-preview-text-${variant || "default"}`}
      style={{
        ...getTextModuleWidthStyle(module.settings),
        ...(isPlainText ? getPlainTextModuleStyle(module.settings) : {}),
        ...getTextModuleRhythmStyle(module.settings),
        ...getTextModuleFrameStyle(module.settings)
      }}
      dangerouslySetInnerHTML={{
        __html: isPlainText
          ? formatPlainTextContent(module.text) || "Simple text"
          : formatRichTextContent(module.text) || "<p>Text block</p>"
      }}
    />
  );
}

/** Shared with the Feature Cards module — see lib/builder-client/builder-card-items.ts */
type SocialItem = {
  id: string;
  label: string;
  href: string;
  iconUrl: string;
  backgroundColor: string;
};

type HeadlineItem = HeadlineRotatorEntry;

function parseHeadlineItems(settings: Record<string, string>): HeadlineItem[] {
  return parseHeadlineRotatorItemsForEditor(settings.headlines ?? "", settings.color || "#18324a");
}

function serializeHeadlineItems(items: HeadlineItem[]) {
  return serializeHeadlineRotatorEntries(items);
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

function SocialShareModuleEditor({
  module,
  themeColors = [],
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  themeColors?: BuilderThemePalette;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) {
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  function platformSettingKey(platformId: SocialSharePlatformId, suffix: string) {
    return `share${platformId}${suffix}`;
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
            placeholder="Starcaster,WYR"
          />
        </label>
        <label className="field">
          <span>X via</span>
          <input
            type="text"
            value={module.settings.shareVia ?? ""}
            onChange={(event) => updateSetting("shareVia", event.target.value)}
            placeholder="Starcaster"
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
          <BuilderThemeColorField
            dialogLabel="Share icon background"
            fallback="#ffffff"
            themeColors={themeColors}
            value={module.settings.shareIconBackground?.startsWith("#") ? module.settings.shareIconBackground : "#ffffff"}
            onChange={(shareIconBackground) => updateSetting("shareIconBackground", shareIconBackground)}
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
                <div className="builder-nav-color-field">
                  <BuilderThemeColorField
                    dialogLabel={`${platform.label} button color`}
                    fallback={platform.color}
                    themeColors={themeColors}
                    value={
                      module.settings[platformSettingKey(platform.id, "Color")]?.startsWith("#")
                        ? module.settings[platformSettingKey(platform.id, "Color")]
                        : platform.color
                    }
                    onChange={(color) => updateSetting(platformSettingKey(platform.id, "Color"), color)}
                  />
                  {module.settings[platformSettingKey(platform.id, "Color")] ? (
                    <button
                      className="builder-nav-color-clear"
                      onClick={() => updateSetting(platformSettingKey(platform.id, "Color"), "")}
                      title="Reset to default"
                      type="button"
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="builder-nav-color-hint">default</span>
                  )}
                </div>
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

function PollCategoryListModuleEditor({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  themeColors?: Array<{ label: string; hex: string }>;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
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
          themeBackgroundColor={themeBackgroundColor}
          themeColors={themeColors}
          themePrimaryColor={themePrimaryColor}
        />
        {!isPollCategoryListPanelTransparent(module.settings) ? (
          <BuilderThemeColorSettingRow
            fallback="#c6e8f5"
            fullWidth
            label="Panel Border"
            themeColors={themeColors}
            value={
              module.settings.panelBorderColor?.startsWith("#")
                ? module.settings.panelBorderColor
                : "#c6e8f5"
            }
            onChange={(panelBorderColor) => updateSetting("panelBorderColor", panelBorderColor)}
          />
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
      <BuilderThemeColorSettingRow
        fallback="#18324a"
        label="Color"
        themeColors={themeColors}
        value={module.settings.color || "#18324a"}
        onChange={(color) => updateSetting("color", color)}
      />
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
  themeColors = [],
  onUpdateModule
}: {
  module: BuilderTemplateModule;
  themeColors?: BuilderThemePalette;
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
        <label className="field">
          <span>Color</span>
          <BuilderThemeColorField
            dialogLabel="Headline rotator color"
            fallback="#18324a"
            themeColors={themeColors}
            value={module.settings.color || "#18324a"}
            onChange={(color) => updateSetting("color", color)}
          />
        </label>
        <label className="field builder-checkbox-field"><span>Bold</span><input type="checkbox" checked={module.settings.bold !== "false"} onChange={(e) => updateSetting("bold", e.target.checked ? "true" : "false")} /></label>
        <label className="field"><span>Vertical alignment</span><select value={module.settings.verticalAlignment ?? "center"} onChange={(e) => updateSetting("verticalAlignment", e.target.value)}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
        <label className="field"><span>Min height (px)</span><input type="number" min="0" max="1200" step="4" value={module.settings.minHeight ?? "480"} onChange={(e) => updateSetting("minHeight", e.target.value)} /></label>
        <label className="field"><span>Fade duration (ms)</span><input type="number" min="0" max="5000" step="50" value={module.settings.fadeDuration ?? "800"} onChange={(e) => updateSetting("fadeDuration", e.target.value)} /></label>
        <label className="field"><span>Display speed (ms)</span><input type="number" min="500" max="20000" step="100" value={module.settings.displaySpeed ?? "3000"} onChange={(e) => updateSetting("displaySpeed", e.target.value)} /></label>
        {/* C3: boolean reads as on/off, matching the Bold checkbox above —
            same "true"/"false" stored values the select wrote. */}
        <label className="field builder-checkbox-field"><span>Drop shadow</span><input type="checkbox" checked={(module.settings.dropShadow ?? "false") === "true"} onChange={(e) => updateSetting("dropShadow", e.target.checked ? "true" : "false")} /></label>
        <label className="field">
          <span>Shadow color</span>
          <BuilderThemeColorField
            dialogLabel="Headline shadow color"
            fallback="#000000"
            themeColors={themeColors}
            value={module.settings.dropShadowColor?.startsWith("#") ? module.settings.dropShadowColor : "#000000"}
            onChange={(dropShadowColor) => updateSetting("dropShadowColor", dropShadowColor)}
          />
        </label>
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
                  <BuilderThemeColorField
                    dialogLabel={`Headline ${index + 1} color`}
                    fallback={module.settings.color || "#18324a"}
                    themeColors={themeColors}
                    value={item.color.startsWith("#") ? item.color : module.settings.color || "#18324a"}
                    onChange={(color) => updateItem(item.id, { color })}
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

/**
 * THE LATTICE IS NOW UNIVERSAL (master rule W0; rollout 2026-08-13).
 *
 * Every module settings panel gets it. The gate that used to live here — a
 * set holding "table", then "table" and "heading" — existed only so the rule
 * could be settled on one panel before it reached the other 52, which the
 * operator asked for on 8/12 and signed off on 8/13 ("the Eyebrow module …
 * can now be considered a model for how these forms should look").
 *
 * Nothing replaces it: a per-module opt-out would be the per-field width
 * override in a bigger coat, and W0 exists to stop exactly that. If a panel
 * fights the lattice, fix the panel — that is what the heading conversion
 * did (PR #169) and what this rollout did for the rest.
 */

function ModuleEditorWrapper({
  isPopped,
  moduleType,
  title,
  onClose,
  children
}: {
  isPopped: boolean;
  /**
   * Stamped on the editor as a modifier class so a panel can lay out its own
   * chrome. Only Feature Cards uses it today: its editor is two columns, and
   * the Label / Background / Margins rows are the editor's children rather
   * than the panel's, so the panel alone cannot place them. A type hook is
   * the smallest thing that lets CSS reach them — the alternative was moving
   * the chrome into every settings component.
   */
  moduleType: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const className = `builder-module-editor is-lattice builder-module-editor--${moduleType}`;

  // No width cap: popping a module out is how the operator escapes a narrow
  // column, so the editor takes the room its panel needs (D7).
  if (isPopped) {
    return (
      <BuilderCenteredModal title={title} onClose={onClose}>
        <div className={className}>{children}</div>
      </BuilderCenteredModal>
    );
  }
  return <div className={className}>{children}</div>;
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
  themeColors = [],
  themeStyle,
  themeBackgroundColor,
  themePrimaryColor
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
    const isCarouselModule = module.type === "carousel";
    const isFloatingImage = module.type === "floating-image";
    const isReminderModule = module.type === "reminder";
    const isTableModule = module.type === "table";
    const isHeadingModule = module.type === "heading";
    const isCurrentPollModule = module.type === "current-poll";
    const isConfettiModule = module.type === "confetti";
    const isNavigationModule = module.type === "navigation";
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
    const isBlogCardManagerModule = module.type === "blog-card-manager";
    const isBlogSearchModule = module.type === "blog-search";
    const isBlogSearchResultsModule = module.type === "blog-search-results";
    const isSiteSearchModule = module.type === "site-search";
    const isSiteSearchResultsModule = module.type === "site-search-results";
    const isMessagingTopicListModule = module.type === "messaging-topic-list";
    const isMessagingTagListModule = module.type === "messaging-tag-list";
    const isCrmContactsTableModule = module.type === "crm-contacts-table";
    const isCrmFormModule = module.type === "crm-form";
    const isAdminTeamUsersModule = module.type === "admin-team-users";
    const isAdminModulesModule = module.type === "admin-modules";
    const isAdminLoginModule = module.type === "admin-login";
    const isAdminNavLinkModule = module.type === "admin-nav-link";
    const isBugReportModule = module.type === "bug-report";
    const isAdminSiteSettingsModule = module.type === "admin-site-settings";
    const isAdminSupportFormModule = module.type === "admin-support-form";
    const isPollRuntimeModule = isCurrentPollModule || module.type === "previous-results";
    // The rich-text editor left the shared chrome on 2026-08-15: its
    // Background / Alignment / margins / Width now live on the D8 axes in
    // BuilderTextModuleSettings (E6 — never a second copy). The Simple Text
    // variant stays on the chrome, so this flag is variant-aware on purpose.
    const isRichTextModule = module.type === "text" && !isPlainTextVariant(module.settings);
    const showModuleTriggerSettings = builderModuleShowsTriggerSettings(module, moduleClassOverride);

    /**
     * Modules that lost the universal chrome (Background / Alignment / H+V
     * Margin) — master rules C7/S2, audit fix F13.
     *
     * The chrome is the ELSE branch of the ~30-way settings-editor ternary
     * below, so the day a module got its own settings component it silently
     * stopped offering background, alignment and margins — while the
     * renderer kept honouring those settings for it
     * (`getModuleOuterSpacingStyle` + `getBuilderBackgroundStyle` in
     * builder-template-preview.tsx). Settings that exist, work, and are
     * unreachable. These modules render the same chrome the else branch
     * does, after their own editor.
     *
     * Deliberately NOT here: current-poll / social / crm-form / navigation
     * (their own editors offer background + margins), heading /
     * floating-image (own chrome blocks), button / table /
     * poll-category-list / reminder (bespoke or opted out), tractor-nav /
     * confetti (fixed-position overlays where wrapper margins are
     * meaningless).
     *
     * Navigation moved out of the else branch on 2026-08-11 (E6): its
     * Structure axis now carries Background and its Placement axis carries
     * alignment and the H+V margin pair, so the shared chrome underneath was
     * a second copy of all three — and the operator had two Alignment
     * controls doing different things.
     */
    const needsRestoredChrome =
      isBreadcrumbModule ||
      isBlogPostListModule ||
      isBlogPostCardModule ||
      isBlogAuthorBioModule ||
      isBlogTocModule ||
      isBlogNewsletterModule ||
      isBlogRelatedPostsModule ||
      isBlogCategoryFilterModule ||
      isBlogPostModule ||
      isBlogTagCloudModule ||
      isBlogPostTagsModule ||
      isBlogPostCreateModule ||
      isBlogPostManagerModule ||
      isBlogCategoryManagerModule ||
      isBlogCardManagerModule ||
      isBlogSearchModule ||
      isBlogSearchResultsModule ||
      isMessagingTopicListModule ||
      isMessagingTagListModule ||
      isCrmContactsTableModule ||
      isAdminTeamUsersModule ||
      isAdminModulesModule ||
      isAdminLoginModule ||
      isAdminNavLinkModule ||
      isAdminSiteSettingsModule ||
      isAdminSupportFormModule;

    /**
     * The module's internal name. Rendered in ONE of two places and never
     * both: inside the chrome strip when this module has chrome, and on its
     * own strip above the panel when it does not — see `showsSharedChrome`.
     *
     * Hoisted out of the JSX on 2026-08-25 (ticket 86bbjt1aq). It used to be
     * a strip of its own ABOVE the chrome, which made it a second grid with
     * its own label track: the operator's screenshot of the image panel that
     * day showed three label tracks stacked above the axes — Label's at one
     * x, Background's at another, and the Alignment/margin strip's at a
     * third. Two of the three were `display: contents` members of grids that
     * simply were not the same grid (W0).
     */
    const moduleLabelField = (
      <BuilderModuleField label="Label" width="text-md">
        <input
          type="text"
          value={module.name}
          onChange={(event) => onUpdateModule((current) => ({ ...current, name: event.target.value }))}
          // W0: the field is the standard width, so the placeholder is
          // written to fit it. This used to run the other way round —
          // the copy set the width and the row went its own length.
          placeholder="Internal label"
        />
      </BuilderModuleField>
    );

    /**
     * Social and Blog Post List name the module inside their own editors, so
     * a second box here would be two controls for one setting (E6).
     */
    const showsLabelField = module.type !== "social" && module.type !== "blog-post-list";

    const sharedModuleChrome = (
      <div className="builder-module-chrome">
        {/* ONE strip, and therefore one grid: every chrome row — the label,
            the background, the alignment, the margins, the nudge — measures
            against the same two tracks. Background used to sit outside this
            strip as a sibling of it, so the chrome laid itself out as two
            ragged sub-columns: the background block at the panel's left edge
            and the whole margin stack floating to its right. That is what
            `.builder-module-editor--feature-cards .builder-module-chrome`
            was already stacking around for its own two-column editor; this
            fixes the cause rather than the two panels that noticed. */}
        <BuilderModuleFieldStrip>
          {showsLabelField ? moduleLabelField : null}
          {/* Speech bubble uses its own flat fill color (BuilderSpeechBubbleModuleSettings);
              the standard modal's gradient/image/style modes are no-ops on a bubble. */}
          {module.type !== "speech-bubble" ? (
            <BuilderBackgroundControls
              label="Background"
              background={getModuleBackgroundSettings(module.settings)}
              horizontal
              onChange={onUpdateModuleBackground}
              themeBackgroundColor={themeBackgroundColor}
              themeColors={themeColors}
              themePrimaryColor={themePrimaryColor}
            />
          ) : null}
          <BuilderModuleField label="Alignment" width="align">
            <BuilderAlignmentIconGroup
              value={moduleAlignment}
              onChange={(alignment) =>
                onUpdateModule((current) => ({
                  ...current,
                  settings: { ...current.settings, alignment }
                }))
              }
            />
          </BuilderModuleField>
          {/* One row per axis, splitting into its two sides on the row's own
              toggle (E4b) — the same component `marginFields()` gives the
              generated panels, so the set reads identically on hand-written
              and generated ones. Each side reads the legacy
              vertical/horizontal pair when its own key is unset, which is
              what keeps a page that has not been re-saved showing the numbers
              it is actually rendering. */}
          <BuilderModuleSpacingFields
            box="margin"
            max={160}
            onChange={(values) =>
              onUpdateModule((current) => ({
                ...current,
                settings: { ...current.settings, ...values }
              }))
            }
            settings={module.settings}
          />
          {/* The nudge, in the strip rather than beside it (operator,
              2026-08-12: "Add Vertical and Horizontal Offset to the left
              column"). `BuilderModuleOffsetFields` — what the image module
              uses — is its own grid, so dropped into a two-column editor its
              labels and inputs started at their own x-positions, a stagger
              W0 exists to stop and `check_panels` could not see because that
              block sits outside every measured group. Inside the strip the
              two fields are `display: contents` like every other chrome
              field, so they share the one label track by construction.

              Last on the strip by D9: a nudge is the finest adjustment here,
              after the margins that move the whole module.

              The image module joined the Carousel here on 2026-08-16. It had
              kept the standalone `BuilderModuleOffsetFields` block on the
              grounds that its editor was "one full-width column, where a
              captioned row costs nothing" — but the editor has been three axis
              columns since D8, so the block was two rows measuring their own
              label track above three that measured another, which is the
              stagger the operator saw. */}
          {isCarouselModule || isStandardImage
            ? MODULE_NUDGE_SIDES.map(({ key, label, hint }) => (
                <BuilderModuleField key={key} label={label} width="num">
                  <input
                    type="number"
                    min={-500}
                    max={500}
                    step={1}
                    title={hint}
                    value={module.settings[key] ?? "0"}
                    onChange={(event) =>
                      onUpdateModule((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          [key]: normalizeSignedOffsetValue(event.target.value, "0")
                        }
                      }))
                    }
                  />
                </BuilderModuleField>
              ))
            : null}
          {module.type === "text" ? (
            <BuilderModuleField label="Width" width="select-sm">
              <select
                value={module.settings.size ?? "100"}
                onChange={(event) =>
                  onUpdateModule((current) => ({
                    ...current,
                    settings: { ...current.settings, size: event.target.value }
                  }))
                }
              >
                <option value="25">25%</option>
                <option value="33">33%</option>
                <option value="50">50%</option>
                <option value="66">66%</option>
                <option value="75">75%</option>
                <option value="90">90%</option>
                <option value="100">100%</option>
              </select>
            </BuilderModuleField>
          ) : null}
        </BuilderModuleFieldStrip>
      </div>
    );
    /**
     * The module's own settings editor, chosen once. It is the shared
     * chrome for every module that never grew an editor of its own — and
     * naming it here is what lets the Label row above know whether that
     * chrome is going to render, so the two can never both put a Label on
     * the panel (E6) and the chrome-less modules never lose theirs.
     *
     * Hoisted out of the JSX 2026-08-25 (ticket 86bbjt1aq). The identity
     * test below is the point of the hoist: the alternative was restating
     * the forty conditions of the ternary as a boolean, which is a second
     * copy of a list that grows every time a module gets an editor.
     */
    const moduleSettingsEditor =
      module.type !== "button" ? (
            isCurrentPollModule ? (
              <BuilderCurrentPollModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
                themeBackgroundColor={themeBackgroundColor}
                themeColors={themeColors}
                themePrimaryColor={themePrimaryColor}
              />
            ) : isConfettiModule ? (
              <BuilderConfettiModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isTractorNavModule ? (
              <BuilderTractorNavModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBreadcrumbModule ? (
              <BuilderBreadcrumbModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogPostListModule ? (
              <BuilderBlogPostListModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogPostCardModule ? (
              <BuilderBlogPostCardModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogAuthorBioModule ? (
              <BuilderBlogAuthorBioModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogTocModule ? (
              <BuilderBlogTocModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogNewsletterModule ? (
              <BuilderBlogNewsletterSubscribeModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogRelatedPostsModule ? (
              <BuilderBlogRelatedPostsModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogCategoryFilterModule ? (
              <BuilderBlogCategoryFilterModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogPostModule ? (
              <BuilderBlogPostModuleSettings module={module} onUpdateModule={onUpdateModule} richTextGallery={richTextGalleryProps} />
            ) : isBlogTagCloudModule ? (
              <BuilderBlogTagCloudModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogPostTagsModule ? (
              <BuilderBlogPostTagsModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogPostCreateModule ? (
              <BuilderBlogPostCreateModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogPostManagerModule ? (
              <BuilderBlogPostManagerModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogCategoryManagerModule ? (
              <BuilderBlogCategoryManagerModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogCardManagerModule ? (
              <BuilderBlogCardManagerModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBlogSearchModule ? (
              <BuilderBlogSearchModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isBlogSearchResultsModule ? (
              <BuilderBlogSearchResultsModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isSiteSearchModule ? (
              <BuilderSiteSearchModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isSiteSearchResultsModule ? (
              <BuilderSiteSearchResultsModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isMessagingTopicListModule ? (
              <BuilderMessagingTopicListModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isMessagingTagListModule ? (
              <BuilderMessagingTagListModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
            ) : isCrmContactsTableModule ? (
              <BuilderCrmContactsTableModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isCrmFormModule ? (
              <BuilderCrmFormModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
                themeBackgroundColor={themeBackgroundColor}
                themeColors={themeColors}
                themePrimaryColor={themePrimaryColor}
              />
            ) : isAdminTeamUsersModule ? (
              <BuilderAdminTeamUsersModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminModulesModule ? (
              <BuilderAdminModulesModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminLoginModule ? (
              <BuilderAdminLoginModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isBugReportModule ? (
              <BuilderBugReportModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminNavLinkModule ? (
              <BuilderAdminNavLinkModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminSiteSettingsModule ? (
              <BuilderAdminSiteSettingsModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isAdminSupportFormModule ? (
              <BuilderAdminSupportFormModuleSettings module={module} onUpdateModule={onUpdateModule} />
            ) : isSocialModule ? (
              <BuilderSocialModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
                onOpenGallery={onOpenSocialIconGallery}
                themeBackgroundColor={themeBackgroundColor}
                themeColors={themeColors}
                themePrimaryColor={themePrimaryColor}
              />
            ) : module.type === "heading" ? (
              <div className="builder-heading-module-chrome">
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                  themeBackgroundColor={themeBackgroundColor}
                  themeColors={themeColors}
                  themePrimaryColor={themePrimaryColor}
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
            ) : isRichTextModule ? (
              <BuilderTextModuleSettings
                module={module}
                onUpdateModule={onUpdateModule}
                onUpdateModuleBackground={onUpdateModuleBackground}
                themeBackgroundColor={themeBackgroundColor}
                themeColors={themeColors}
                themePrimaryColor={themePrimaryColor}
              />
            ) : isNavigationModule ? null : isPollCategoryListModule ? null : isReminderModule ? null : isCrmFormModule ? null : isTableModule ? null : isFloatingImage ? (
              <div className="builder-floating-image-module-chrome">
                <BuilderBackgroundControls
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  label="Background"
                  onChange={onUpdateModuleBackground}
                  themeBackgroundColor={themeBackgroundColor}
                  themeColors={themeColors}
                  themePrimaryColor={themePrimaryColor}
                />
              </div>
            ) : (
              sharedModuleChrome
            )
      ) : null;

    /**
     * Whether the shared chrome is on the panel — inline as this module's
     * whole editor, or restored underneath one that swallowed it (F13).
     * Never in the mobile pane, which renders its own overrides instead.
     */
    const showsSharedChrome =
      editorDevice !== "mobile" &&
      (moduleSettingsEditor === sharedModuleChrome || needsRestoredChrome);

  return (
    <div
      className={`builder-module-card ${getAlignmentClass(moduleAlignment)}`}
      style={{
        /*
         * Text is excluded with Button because its fill now belongs to the
         * frame INSIDE the card (getTextModuleFrameStyle, 2026-08-15).
         * Tinting the card as well would paint the same colour twice at two
         * different sizes and tell the operator the fill spans the card when
         * on the page it stops at the border. The card keeps the neutral
         * surface; the preview inside shows what the page will show.
         */
        ...(module.type !== "button" && module.type !== "text" && !isPollCategoryListModule
          ? resolveBuilderDrillDownSurfaceBackground(getModuleBackgroundSettings(module.settings), "module")
          : {}),
        // One reader for every type (W7). A floating image and a reminder are
        // positioned overlays, so a wrapper margin has nothing to push.
        ...(isFloatingImage || isReminderModule ? {} : getModuleOuterSpacingStyle(module.settings))
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
          {/*
            The pop-out sits on the LEFT, with the drag handle and the name,
            rather than at the end of the action cluster (operator,
            2026-08-15, with a screenshot of six side-by-side cells to show
            why). A module in a narrow cell is clipped at its right edge, and
            the action cluster goes with it — so the one control that ESCAPES
            the narrow cell was the one the narrow cell hid. The left edge is
            the only part of a module card that is always on screen.
          */}
          {hideHeaderActions ? null : (
            <button
              aria-label="Open editor in popup"
              className={`builder-icon-button builder-module-popout${isPopped ? " builder-icon-button-active" : ""}`}
              onClick={() => setIsPopped((p) => !p)}
              title="Open editor in popup"
              type="button"
            >
              ⤢
            </button>
          )}
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
        <ModuleEditorWrapper
          isPopped={isPopped}
          moduleType={module.type}
          title={module.name || module.type}
          onClose={() => setIsPopped(false)}
        >
          {/* A two-column editor runs its chrome down the left column beside
              the item list, so that column needs a name at the top of it.
              Every other module keeps the chrome full-width and has no
              columns to label. Slideshow joined 2026-08-12, which is why this
              is a set rather than the `=== "feature-cards"` it started as —
              the second module to want it should not have to find this line
              by reading the whole file. */}
          {TWO_COLUMN_EDITOR_TYPES.has(module.type) ? (
            <div className="builder-cards-panel-heading">Settings</div>
          ) : null}
          {/* Only when this module has no chrome to put it in. A module WITH
              chrome renders the same field as the chrome strip's first row,
              so it shares that grid's tracks instead of measuring its own.
              Content-sized, not full-panel — this row tops every module, so
              master rule W1 applies here with maximum leverage. */}
          {showsLabelField && !showsSharedChrome ? (
            <BuilderModuleFieldStrip>{moduleLabelField}</BuilderModuleFieldStrip>
          ) : null}

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
          {moduleSettingsEditor}

          {/* F13: the chrome the settings-editor ternary above swallowed —
              rendered here for modules whose renderer honours background and
              margins but whose own editor never offered them. */}
          {needsRestoredChrome ? sharedModuleChrome : null}

          {/* The image module's offsets moved into the chrome strip above (see
              MODULE_NUDGE_SIDES); its URL, Link, New Tab and gallery buttons
              moved into its own schema panel, where they share the Content
              column's label track instead of each hand-rolled block measuring
              its own. What is left below belongs to the video module. */}
          {isVideoModule && (
            <label className="field">
              <span>Video embed URL</span>
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
                placeholder="YouTube, Vimeo, embed URL, or uploaded video"
              />
            </label>
          )}

          {isVideoModule ? (
            <label className="field builder-checkbox-field">
              <span>New Tab</span>
              <input
                type="checkbox"
                checked={module.settings.newTab !== "false"}
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
            <BuilderButtonModuleSettings
              isEmailTemplate={isEmailTemplate}
              module={module}
              themeColors={themeColors}
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

          {isVideoModule ? (
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
              themeColors={themeColors}
              onOpenGallery={onOpenGallery}
              onUploadMedia={onUploadMedia}
              onUpdateModule={onUpdateModule}
            />
          ) : null}

          {module.type === "speech-bubble" ? (
            <BuilderSpeechBubbleModuleSettings
              module={module}
              themeColors={themeColors}
              onUpdateModule={onUpdateModule}
              richTextGallery={richTextGalleryProps}
            />
          ) : null}

          {module.type === "reminder" ? (
            <BuilderReminderModuleSettings
              module={module}
              themeColors={themeColors}
              onUpdateModule={onUpdateModule}
              richTextGallery={richTextGalleryProps}
            />
          ) : null}

          {isStandardImage ? (
            <BuilderImageModuleSettings
              includeMedia
              module={module}
              themeColors={themeColors}
              onOpenGallery={onOpenGallery}
              onUpdateModule={onUpdateModule}
              onUploadMedia={onUploadMedia}
            />
          ) : null}

          {module.type === "heading" ? (
            <BuilderHeadingModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
          ) : null}

          {module.type === "text" && isPlainTextVariant(module.settings) ? (
            <BuilderSimpleTextModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
          ) : null}

          {module.type === "table" && (
            <BuilderTableModuleSettings
              module={module}
              onUpdateModule={onUpdateModule}
              onUpdateModuleBackground={onUpdateModuleBackground}
              pages={pages}
              renderCellPreview={renderModulePreview}
              themeBackgroundColor={themeBackgroundColor}
              themeColors={themeColors}
              themePrimaryColor={themePrimaryColor}
            />
          )}
          {module.type === "carousel" && (
            <BuilderCarouselModuleSettings
              module={module}
              themeColors={themeColors}
              onUpdateModule={onUpdateModule}
            />
          )}
          {module.type === "feature-cards" && (
            <BuilderFeatureCardsModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
          )}
          {module.type === "program-list" && (
            <BuilderProgramListModuleSettings module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
          )}
          {module.type === "navigation" && (
            <BuilderNavigationModuleSettings
              module={module}
              onUpdateModule={onUpdateModule}
              onUpdateModuleBackground={onUpdateModuleBackground}
              themeBackgroundColor={themeBackgroundColor}
              themeColors={themeColors}
              themePrimaryColor={themePrimaryColor}
            />
          )}
          {module.type === "headline-rotator" && (
            <HeadlineRotatorModuleEditor module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
          )}
          {module.type === "poll-category-list" && (
            <PollCategoryListModuleEditor
              module={module}
              onUpdateModule={onUpdateModule}
              onUpdateModuleBackground={onUpdateModuleBackground}
              themeBackgroundColor={themeBackgroundColor}
              themeColors={themeColors}
              themePrimaryColor={themePrimaryColor}
            />
          )}
          {module.type === "social-share" && (
            <SocialShareModuleEditor module={module} themeColors={themeColors} onUpdateModule={onUpdateModule} />
          )}

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
          module.type !== "bug-report" &&
          module.type !== "player-portal" &&
          module.type !== "table" &&
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
          module.type !== "heading" &&
          module.type !== "blog-post-list" &&
          /* Nothing reads `module.text` on a carousel — `CarouselPreview`
             renders from `settings.items` alone — so this was an empty box
             sitting under the Settings column with no effect on anything
             (doctrine E7). Excluding it does not touch stored text; it just
             stops offering a control that never did anything. */
          module.type !== "carousel" &&
          module.type !== "admin-nav-link" ? (
            <label className="field">
              <span>Content</span>
              {module.type === "text" && !isPlainTextVariant(module.settings) ? (
                <BuilderRichTextEditor
                  value={module.text}
                  onChange={(value) => onUpdateModule((current) => ({ ...current, text: value }))}
                  themeColors={themeColors}
                  themeStyle={themeStyle}
                  {...richTextGalleryProps}
                />
              ) : (
                <textarea
                  className="builder-textarea"
                  value={module.text}
                  onChange={(event) => onUpdateModule((current) => ({ ...current, text: event.target.value }))}
                  placeholder={module.type === "text" ? PLAIN_TEXT_PLACEHOLDER : "Enter content"}
                />
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
