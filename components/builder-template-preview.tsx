"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, type FormEvent, type MouseEvent, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  EMPTY_MEDIA_FILTERS,
  MEDIA_ASPECTS,
  mediaAssetMatchesFilters,
  mediaFiltersActive,
  mediaTagKey,
  mediaTagOptions,
  normalizeMediaTag,
  type MediaFilters
} from "@/lib/media-manager-filters";
import type { BuilderTemplateSection } from "@/lib/builder-template";
import {
  builderBackgroundParallaxActive,
  createDefaultBackgroundSettings,
  formatHeadingContent,
  formatPlainTextContent,
  formatRichTextContent,
  getBuilderBackgroundStyle,
  getBuilderRowOverlayScreenStyle,
  getLayoutColumns,
  groupJoinedSections,
  isPlainTextVariant,
  resolvePublicBuilderAssetUrl
} from "@/lib/builder-template";
import { imageProps } from "@/lib/image-renditions";
import { BuilderBackgroundLayer } from "@/components/builder/builder-background-layer";

/** Feature cards sit up to three across the content column. */
const FEATURE_CARD_SIZES = "(max-width: 700px) 100vw, 400px";
import { parseTableData } from "@/lib/builder-table-data";
import { parseBuilderCardItems, parseCardBody } from "@/lib/builder-card-items";
import { carouselSeamShift, carouselShortestDelta } from "@/lib/builder-carousel-loop";
import {
  getCarouselImageFrameStyle,
  getCarouselImageShadowGutter
} from "@/lib/builder-carousel-image-frame";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import { buildMegaColumns, type NavMegaColumn } from "@/lib/builder-nav-mega";
import { parsePrograms, formatSessionHours } from "@/lib/builder-program-list";
import {
  getNavMegaColumnCount,
  getNavModuleClassNames,
  getNavModuleStyle,
  isNavMegaMenu,
  showsNavDropdownArrow
} from "@/lib/builder-nav-style";
import { sanitizeEmbedHtml } from "@/lib/sanitize-html";
import {
  buildCrmFormRenderContext,
  crmFormStylesToRenderStyles,
  publicFormFields
} from "../lib/crmFormStyles.js";
import { resolveCrmFormStyleSnapshot } from "./builder/builder-crm-form-module-settings";
import { BugReportModule } from "./builder/builder-bug-report-module";
import {
  ADMIN_LOGIN_PATH,
  getAdminAuthHeaders,
  isAdminLogoutHref,
  isAdminNavCookieSet,
  readApiErrorMessage,
  redirectAfterAdminLogout,
  setAdminSessionToken,
} from "@/lib/public-admin-session";
import { resolveSessionProjectId, starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import type { CrmThemePalette } from "@/components/builder/builder-utils";
import {
  buildSiteSearchIndex,
  searchSite,
  type SiteSearchMatch,
  type SiteSearchPageInput,
  type SiteSearchResult
} from "@/lib/site-search";
import { normalizeSocialIconBackgroundColor } from "@/lib/social-icon-background";
import { BuilderConfettiRuntime } from "@/components/builder-confetti-runtime";
import { TractorNavRuntime } from "@/components/builder-tractor-nav-module";
import { BuilderPollModuleRuntime, BuilderSocialShareRuntime } from "@/components/builder-poll-runtime";
import { PollCategoryListPreview } from "@/components/builder/poll-category-list-preview";
import {
  HEADLINE_ROTATOR_DEFAULT_FONT_SIZE,
  computeHeadlineRotatorFadeInDelay,
  computeHeadlineRotatorTransitionMs,
  getHeadlineRotatorPositionStyle,
  parseHeadlineRotatorEntries,
  resolveHeadlineRotatorMinHeight,
  type HeadlineRotatorEntry
} from "@/lib/headline-rotator";
import {
  getAlignmentClass,
  getButtonModuleStyle,
  getHeadingModuleStyle,
  getBuilderThemeStyleVars,
  getBuilderThemePageMarginStyle,
  getThemeRootVars,
  type BuilderThemeStyles,
  getShellBackgroundLayers,
  type ThemeShellBackgroundSource,
  columnHasOnlySectionScopedOverlayModules,
  getOverlayFlowCollapsedColumnStyle,
  getOverlayFlowCollapsedModuleStyle,
  getOverlayFlowCollapsedSectionStyle,
  getSectionScopedOverlayColumnStyle,
  getSectionScopedOverlayModuleStyle,
  isOverlayImageModule,
  isSectionScopedOverlayDecor,
  resolveSectionScopedOverlaySectionZIndex,
  sectionHasOnlyPageOverlayImageModules,
  sectionHasOnlySectionScopedOverlayModules,
  getCellContentAlignmentStyle,
  getAdminDataTableThemeStyle,
  getCrmFormThemeContextStyle,
  getCrmThemePaletteVars,
  getModuleAlignment,
  getModuleBackgroundSettings,
  getTableWrapStyle,
  getSectionMarginStyle,
  getSectionColumnGapStyle,
  getSectionColumnPercent,
  getSectionGridTemplate,
  getSectionHorizontalMarginStyle,
  getSectionMinHeightStyle,
  getSectionOffsetStyle,
  getSectionPaddingStyle,
  getSectionWidthStyle,
  getModuleNudgeTransform,
  getModuleOuterSpacingStyle,
  getPlainTextModuleStyle,
  getTextModuleFrameStyle,
  getTextModuleRhythmStyle,
  getTextModuleWidthStyle,
  getVideoEmbedSource,
  isVideoMedia
} from "@/components/builder/builder-utils";
import { BuilderCodeEmbed } from "@/components/builder/builder-code-embed";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";
import { BuilderImagePickerField } from "@/components/builder/builder-image-picker-field";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import {
  eventOccursOn,
  formatEventWhen,
  isSameDay,
  isoToLocalInput,
  isUpcomingEvent,
  localInputToIso,
  monthGrid,
  normalizeEventStatus,
} from "@/lib/event-format";
import { BuilderImagePreview } from "@/components/builder/builder-image-preview";
import {
  BuilderFloatingImageRuntime,
  shouldFloatingImageUseOverlayHost
} from "@/components/builder-floating-image-runtime";
import { getModuleTrigger } from "@/lib/module-trigger";
import { GameModuleOverlayHosts } from "@/components/game-module-overlay-hosts";
import { useSitePlayerRegistration } from "@/components/use-site-player-registration";
import { BuilderSpeechBubbleRuntime } from "@/components/builder-speech-bubble-runtime";
import { BuilderReminderRuntime } from "@/components/builder-reminder-runtime";
import { SpeechBubblePreview } from "@/components/builder/speech-bubble-preview";
import { resolveEmailMergeTokensForPreview } from "@/lib/builder-email-template";
import { getPlayerPortalAuthSettings, PlayerPortalAuthForm } from "@/components/player-portal-auth-form";

type BuilderTemplatePreviewProps = {
  layoutSections: BuilderTemplateSection[];
  pageBackground: import("@/lib/builder-template").BackgroundSettings;
  /** Document-level theme; when omitted, content renders with the pre-theme baseline. */
  theme?: import("@/lib/builder-template").BuilderTheme;
  /** Builder theme palette for CRM form color tokens. */
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
  /** Saved theme container styles (margins, border, blur, contrast). */
  themeStyles?: BuilderThemeStyles;
  /** Linked saved theme — supplies default website shell background when page background is unset. */
  themeShellBackground?: ThemeShellBackgroundSource;
  showShell?: boolean;
  emailPreview?: boolean;
  /** When true (Builder /preview), speech bubbles with game/on-load triggers do not auto-fire. */
  previewMode?: boolean;
  /**
   * True only when this tree IS a published tenant page (BuilderPublicSitePage).
   * Modules that render differently on the live site read this instead of
   * sniffing the DOM for an ancestor class — a child cannot query for an
   * ancestor that is in its own not-yet-committed render pass.
   */
  liveSite?: boolean;
  /** Project ID for contact form submissions on live landing pages. */
  projectId?: string;
  /** When false, page margins are applied by an outer public-site wrapper instead. */
  applyThemePageMargins?: boolean;
  /** When true, shell background is rendered by BuilderViewportShellLayout (or similar). */
  suppressShellBackground?: boolean;
};

type ContactFormField = {
  id: string;
  label: string;
  type: "text" | "email" | "tel";
};

function normalizeNavPath(value: string) {
  const path = value.split("?")[0]?.split("#")[0] || "/";
  let normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  if (normalized && !normalized.startsWith("/") && !/^https?:/i.test(normalized) && !normalized.startsWith("mailto:")) {
    normalized = `/${normalized}`;
  }
  return normalized === "/home" ? "/" : normalized;
}

// The home item never takes the active highlight. Landing on "/" is the
// default state of the site rather than a place you navigated to, so lighting
// up Home reads as a stuck button; every other page still highlights.
// It also mops up bare "#" hrefs, which normalize to "/" and would otherwise
// all light up on the home page.
function isNavPathActive(href: string, activePath: string) {
  const normalized = normalizeNavPath(href || "#");
  if (normalized === "/") return false;
  return normalized === activePath;
}

function toPublicHref(href: string): string {
  const clean = href.trim();
  if (!clean || clean === "#" || /^https?:/i.test(clean) || clean.startsWith("mailto:")) return clean || "#";
  if (clean.startsWith("/")) return clean === "/home" ? "/" : clean;
  if (clean === "home") return "/";
  return `/${clean.replace(/^\/+/, "")}`;
}

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

function ContactFormPreview({ settings, projectId = "" }: { settings: Record<string, string>; projectId?: string }) {
  const mode = getContactFormMode(settings);
  const fields = getContactFormFields(mode);
  const [values, setValues] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitContactForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          formMode: mode,
          firstName: values.firstName ?? "",
          lastName: values.lastName ?? "",
          email: values.email ?? "",
          phone: values.phone ?? "",
          projectId,
          companyWebsite: honeypot
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, "Failed to submit the form."));
      }

      const success = data as { message?: string };
      setMessage(success.message ?? "Thanks. Your information has been saved.");
      setValues({});
      setHoneypot("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit the form.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="builder-contact-form" onSubmit={submitContactForm}>
      <input
        type="text"
        name="companyWebsite"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="builder-contact-honeypot"
        value={honeypot}
        onChange={(event) => setHoneypot(event.target.value)}
      />
      {message ? <div className="builder-contact-form-message">{message}</div> : null}
      {error ? <div className="builder-contact-form-error">{error}</div> : null}
      <div className="builder-contact-form-fields">
        {fields.map((field) => (
          <label className="builder-contact-form-field" key={field.id}>
            <span>{field.label}</span>
            <input
              type={field.type}
              placeholder={field.label}
              value={values[field.id] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
              required={field.id === "firstName" || field.id === "email"}
            />
          </label>
        ))}
      </div>
      {mode === "custom" ? (
        <div className="builder-contact-form-stub">Custom form builder coming soon. Standard fields are shown for now.</div>
      ) : null}
      <button className="builder-contact-form-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}

type CrmFormField = { key: string; label: string; type: string; required: boolean; options?: string[] };
type CrmFormStyles = Record<string, string | undefined>;
type CrmFormData = {
  id?: string;
  heading: string;
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
  accentColor?: string;
  styles?: CrmFormStyles;
  fields: CrmFormField[];
  crmConfigId: string;
};

function crmPreviewInputType(fieldType: string) {
  if (fieldType === "boolean") return "checkbox";
  if (fieldType === "textarea" || fieldType === "select") return fieldType;
  return fieldType || "text";
}

function CrmFormFieldControl({
  field,
  value,
  onChange
}: {
  field: CrmFormField;
  value: string;
  onChange: (key: string, nextValue: string) => void;
}) {
  const inputType = crmPreviewInputType(field.type);

  if (field.type === "textarea") {
    return (
      <textarea
        name={field.key}
        required={field.required}
        rows={4}
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
    );
  }

  if (field.type === "select") {
    const options = Array.isArray(field.options) && field.options.length ? field.options : ["Option one", "Option two"];
    return (
      <select
        name={field.key}
        required={field.required}
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        name={field.key}
        checked={value === "true"}
        onChange={(event) => onChange(field.key, event.target.checked ? "true" : "")}
      />
    );
  }

  return (
    <input
      type={inputType}
      name={field.key}
      required={field.required}
      value={value}
      onChange={(event) => onChange(field.key, event.target.value)}
    />
  );
}

function CrmFormPreview({
  settings,
  theme,
  themePalette,
  projectId = ""
}: {
  settings: Record<string, string>;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
  projectId?: string;
}) {
  const crmFormId = settings.crmFormId ?? "";
  const [form, setForm] = useState<CrmFormData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!crmFormId) return;
    fetch(`/api/crm/forms/${encodeURIComponent(crmFormId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const formData = d?.data ?? d?.form ?? null;
        setForm(formData && typeof formData === "object" && formData.id ? formData : null);
      })
      .catch(() => {});
  }, [crmFormId]);

  async function submitCrmForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/crm/contact-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email ?? "",
          data: Object.fromEntries(Object.entries(values).filter(([k]) => k !== "email")),
          crmConfigId: form?.crmConfigId ?? "",
          crm_form_id: crmFormId,
          projectId,
          _trap: honeypot
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, "Failed to submit the form."));
      }

      const success = data as { message?: string };
      setMessage(success.message ?? form?.successMessage ?? "Thank you!");
      setValues({});
      setHoneypot("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : form?.errorMessage ?? "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!crmFormId) {
    return <div className="builder-contact-form-stub">No CRM form selected. Set a Form ID in module settings.</div>;
  }

  if (!form) {
    return <div className="builder-contact-form-stub">Loading form…</div>;
  }

  const renderContext = buildCrmFormRenderContext(themePalette, theme?.typography);
  const themeContextStyle = getCrmFormThemeContextStyle(themePalette, theme);
  const styleSnapshot = resolveCrmFormStyleSnapshot(settings);
  const effectiveStyles = styleSnapshot ?? form.styles;
  const renderStyles = crmFormStylesToRenderStyles(effectiveStyles, form.accentColor, renderContext);
  const visibleFields = publicFormFields(form.fields ?? []);
  const labelStyle = {
    justifySelf: renderStyles.cssVars['--crm-form-label-justify'],
    textAlign: renderStyles.normalized.labelAlign as CSSProperties['textAlign'],
    alignSelf: 'start'
  } as CSSProperties;
  const shellStyle = {
    ...themeContextStyle,
    ...renderStyles.shell
  } as CSSProperties;
  const headingStyle = {
    ...themeContextStyle,
    ...renderStyles.heading
  } as CSSProperties;
  const formStyle = {
    ...themeContextStyle,
    ...renderStyles.form
  } as CSSProperties;
  const buttonStyle = {
    ...renderStyles.button
  } as CSSProperties;

  return (
    <div className="builder-crm-form-shell" style={shellStyle}>
      {form.heading ? (
        <div className="builder-contact-form-heading" style={headingStyle}>
          {form.heading}
        </div>
      ) : null}
      <form className="builder-contact-form builder-crm-form" onSubmit={submitCrmForm} style={formStyle}>
        <input type="text" name="_trap" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
        {message ? <div className="builder-contact-form-message">{message}</div> : null}
        {error ? <div className="builder-contact-form-error">{error}</div> : null}
        <div className="builder-contact-form-fields">
          {visibleFields.map((field) => (
            <label className="builder-contact-form-field" key={field.key}>
              <span style={labelStyle}>{field.label}</span>
              <CrmFormFieldControl
                field={field}
                value={values[field.key] ?? ""}
                onChange={(key, nextValue) => setValues((prev) => ({ ...prev, [key]: nextValue }))}
              />
            </label>
          ))}
        </div>
        <button className="builder-contact-form-submit" disabled={isSubmitting} style={buttonStyle} type="submit">
          {isSubmitting ? "Submitting…" : form.submitLabel || "Submit"}
        </button>
      </form>
    </div>
  );
}

// ── CRM Contacts Table ────────────────────────────────────────────────────────

function getCrmProjectHeaders(projectIdOverride?: string): Record<string, string> {
  const headers = starcasterScopedHeaders();
  if (projectIdOverride) headers["X-Project-ID"] = projectIdOverride;
  return headers;
}

type CrmContactsField = { key: string; label: string; type: string; required?: boolean };
type CrmContact = { id: string; email: string; data: Record<string, string>; createdAt?: string; source?: string };
type CrmConfigData = { id: string; name?: string; standardFields?: string[]; standard_fields?: string[]; customFields?: CrmContactsField[]; custom_fields?: CrmContactsField[] };

const STANDARD_CONTACT_FIELDS: CrmContactsField[] = [
  { key: "first_name", label: "First Name", type: "text" },
  { key: "last_name",  label: "Last Name",  type: "text" },
  { key: "phone",      label: "Phone",      type: "tel"  },
  { key: "company",    label: "Company",    type: "text" },
  { key: "job_title",  label: "Job Title",  type: "text" },
  { key: "city",       label: "City",       type: "text" },
  { key: "state",      label: "State",      type: "text" },
  { key: "zip",        label: "Zip",        type: "text" },
  { key: "country",    label: "Country",    type: "text" },
  { key: "website",    label: "Website",    type: "url"  },
  { key: "notes",      label: "Notes",      type: "textarea" },
  { key: "source",     label: "Source",     type: "text" },
  { key: "tags",       label: "Tags",       type: "text" },
];

function getContactFields(config: CrmConfigData | null): CrmContactsField[] {
  if (!config) return [{ key: "email", label: "Email", type: "email" }];
  const stdKeys = new Set<string>(
    Array.isArray(config.standardFields) ? config.standardFields
    : Array.isArray(config.standard_fields) ? config.standard_fields
    : []
  );
  const stdFields = STANDARD_CONTACT_FIELDS.filter((f) => stdKeys.has(f.key));
  const customFields = Array.isArray(config.customFields) ? config.customFields
    : Array.isArray(config.custom_fields) ? config.custom_fields
    : [];
  return [{ key: "email", label: "Email", type: "email" }, ...stdFields, ...customFields];
}

const CONTACTS_TABLE_COLUMNS: CrmContactsField[] = [
  { key: "email", label: "Email", type: "email" },
  { key: "first_name", label: "First Name", type: "text" },
  { key: "last_name", label: "Last Name", type: "text" },
  { key: "phone", label: "Phone", type: "tel" },
];

type AdminTableSortDirection = "asc" | "desc";

function getContactColumnValue(contact: CrmContact, key: string): string {
  if (key === "email") return contact.email ?? "";
  if (key === "createdAt") return contact.createdAt ?? "";
  return String(contact.data?.[key] ?? "");
}

function compareAdminTableValues(
  a: string,
  b: string,
  direction: AdminTableSortDirection,
  asDate = false
): number {
  const dir = direction === "asc" ? 1 : -1;
  if (asDate) {
    const at = Date.parse(a) || 0;
    const bt = Date.parse(b) || 0;
    return (at - bt) * dir;
  }
  return a.localeCompare(b, undefined, { sensitivity: "base" }) * dir;
}

function formatAdminSortableHeader(
  label: string,
  column: string,
  sortColumn: string,
  sortDirection: AdminTableSortDirection
): string {
  if (sortColumn !== column) return label;
  return `${label} ${sortDirection === "asc" ? "▲" : "▼"}`;
}

function AdminTableActionIcon({ name }: { name: "view" | "edit" | "delete" | "clone" }) {
  if (name === "view") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "clone") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function AdminTableIconButton({
  icon,
  label,
  onClick,
  href,
  linkTarget,
  danger = false,
  disabled = false,
}: {
  icon: "view" | "edit" | "delete" | "clone";
  label: string;
  onClick?: () => void;
  href?: string;
  linkTarget?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const className = `builder-admin-icon-btn${danger ? " builder-admin-icon-btn-danger" : ""}`;
  const glyph = (
    <span className="builder-admin-icon-btn-glyph">
      <AdminTableActionIcon name={icon} />
    </span>
  );
  if (href) {
    return (
      <a
        className={className}
        href={href}
        aria-label={label}
        title={label}
        target={linkTarget}
        rel={linkTarget === "_blank" ? "noopener noreferrer" : undefined}
      >
        {glyph}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {glyph}
    </button>
  );
}

function CrmContactsTablePreview({
  settings,
  projectId: projectIdProp = "",
  theme,
  themePalette,
}: {
  settings: Record<string, string>;
  projectId?: string;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const crmConfigId    = settings.crmConfigId ?? "";
  const tableTitle     = settings.tableTitle || "Contacts";
  const showTitle      = settings.showTitle !== "false";
  const rowsPerPage    = Math.max(1, parseInt(settings.rowsPerPage ?? "20", 10) || 20);
  const showSearch     = settings.showSearch !== "false";
  const showAddButton  = settings.showAddButton !== "false";
  const addButtonLabel = settings.addButtonLabel || "Add Contact";
  const showViewBtn    = settings.showViewButton !== "false";
  const showEditBtn    = settings.showEditButton !== "false";
  const showDeleteBtn  = settings.showDeleteButton !== "false";

  const [config, setConfig]         = useState<CrmConfigData | null>(null);
  const [contacts, setContacts]     = useState<CrmContact[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState("");
  const [filterEmail, setFilterEmail]         = useState("");
  const [filterFirstName, setFilterFirstName] = useState("");
  const [filterLastName, setFilterLastName]   = useState("");
  const [filterPhone, setFilterPhone]         = useState("");
  const [sortColumn, setSortColumn]           = useState("email");
  const [sortDirection, setSortDirection]     = useState<AdminTableSortDirection>("asc");
  const [page, setPage]             = useState(1);
  const [viewContact, setViewContact] = useState<CrmContact | null>(null);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);
  const [deleteContactTarget, setDeleteContactTarget] = useState<CrmContact | null>(null);
  const [editValues, setEditValues]   = useState<Record<string, string>>({});
  const [addMode, setAddMode]         = useState(false);
  const [addValues, setAddValues]     = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);
  const [deleting, setDeleting]       = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    const headers = getCrmProjectHeaders(projectIdProp);
    const configUrl = crmConfigId ? `/api/crm/configs/${encodeURIComponent(crmConfigId)}` : "/api/crm/configs";
    fetch(configUrl, { credentials: "include", headers })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(readApiErrorMessage(d, `Failed to load CRM (${r.status})`));
        }
        const cfg: CrmConfigData | null = crmConfigId
          ? (d?.config ?? d?.data ?? (d?.id ? d : null))
          : (d?.configs?.[0] ?? d?.data?.[0] ?? null);
        setConfig(cfg);
        if (!cfg) return;
        const contactsRes = await fetch(`/api/crm/contacts?configId=${encodeURIComponent(cfg.id)}`, {
          credentials: "include",
          headers,
        });
        const d2 = await contactsRes.json().catch(() => ({}));
        if (!contactsRes.ok) {
          throw new Error(readApiErrorMessage(d2, `Failed to load contacts (${contactsRes.status})`));
        }
        const list = d2?.contacts ?? d2?.data ?? [];
        setContacts(Array.isArray(list) ? list : []);
      })
      .catch((e: Error) => setLoadError(e.message || "Failed to load contacts."))
      .finally(() => setLoading(false));
  }, [crmConfigId, projectIdProp]);

  const fields = getContactFields(config);
  const tableCols = CONTACTS_TABLE_COLUMNS;
  const hasActions = showViewBtn || showEditBtn || showDeleteBtn;
  const hasActiveFilters = Boolean(filterEmail || filterFirstName || filterLastName || filterPhone);

  const filtered = contacts.filter((c) => {
    if (filterEmail) {
      const q = filterEmail.toLowerCase();
      if (!(c.email ?? "").toLowerCase().includes(q)) return false;
    }
    if (filterFirstName) {
      const q = filterFirstName.toLowerCase();
      if (!String(c.data?.first_name ?? "").toLowerCase().includes(q)) return false;
    }
    if (filterLastName) {
      const q = filterLastName.toLowerCase();
      if (!String(c.data?.last_name ?? "").toLowerCase().includes(q)) return false;
    }
    if (filterPhone) {
      const q = filterPhone.toLowerCase();
      if (!String(c.data?.phone ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const asDate = sortColumn === "createdAt";
    return compareAdminTableValues(
      getContactColumnValue(a, sortColumn),
      getContactColumnValue(b, sortColumn),
      sortDirection,
      asDate
    );
  });

  const totalPages   = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const safePage     = Math.min(page, totalPages);
  const pageContacts = sorted.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const showFilterBar = showSearch || hasActions;

  function toggleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  const scopedHeaders = () => getCrmProjectHeaders(projectIdProp);

  async function deleteContact(id: string) {
    const res = await fetch(`/api/crm/contacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: scopedHeaders(),
    });
    if (!res.ok) {
      alert("Failed to delete contact. Please try again.");
      return false;
    }
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (viewContact?.id === id) setViewContact(null);
    return true;
  }

  async function confirmDeleteContact() {
    if (!deleteContactTarget) return;
    setDeleting(true);
    try {
      const ok = await deleteContact(deleteContactTarget.id);
      if (ok) setDeleteContactTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(contact: CrmContact) {
    const vals: Record<string, string> = { email: contact.email ?? "" };
    fields.forEach((f) => { if (f.key !== "email") vals[f.key] = String(contact.data?.[f.key] ?? ""); });
    setEditValues(vals);
    setEditContact(contact);
  }

  async function saveEdit() {
    if (!editContact) return;
    setSaving(true);
    try {
      const email = (editValues.email ?? "").trim().toLowerCase();
      const data: Record<string, string> = {};
      fields.forEach((f) => { if (f.key !== "email") data[f.key] = editValues[f.key] ?? ""; });
      const res  = await fetch(`/api/crm/contacts/${encodeURIComponent(editContact.id)}`, {
        method:  "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...scopedHeaders() },
        body:    JSON.stringify({ email, data }),
      });
      const d       = await res.json();
      const updated = d?.contact ?? d?.data ?? { ...editContact, email, data };
      setContacts((prev) => prev.map((c) => (c.id === editContact.id ? updated : c)));
      setEditContact(null);
    } finally {
      setSaving(false);
    }
  }

  async function saveAdd() {
    if (!config) return;
    setSaving(true);
    try {
      const email = (addValues.email ?? "").trim().toLowerCase();
      const data: Record<string, string> = {};
      fields.forEach((f) => { if (f.key !== "email") data[f.key] = addValues[f.key] ?? ""; });
      const res  = await fetch("/api/crm/contacts", {
        method:  "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...scopedHeaders() },
        body:    JSON.stringify({ crmConfigId: config.id, email, data, source: "manual" }),
      });
      const d          = await res.json();
      const newContact = d?.contact ?? d?.data;
      if (newContact) setContacts((prev) => [newContact, ...prev]);
      setAddMode(false);
      setAddValues({});
    } finally {
      setSaving(false);
    }
  }

  if (loading)    return <div className="builder-contact-form-stub">Loading contacts…</div>;
  if (loadError)  return <div className="builder-contact-form-stub">{loadError}</div>;
  if (!config)    return <div className="builder-contact-form-stub">No CRM configured. Set one up in Builder › CRM, or select a config in module settings.</div>;

  return (
    <div
      className="builder-admin-data-table-module"
      style={getAdminDataTableThemeStyle(themePalette, theme)}
    >
      {showTitle && <h2 className="builder-admin-data-table-title">{tableTitle}</h2>}

      <div className="builder-admin-data-table-wrap">
        <table className="builder-admin-data-table">
          <thead>
            {showFilterBar && (
              <tr className="builder-admin-data-table-filter-row table-filter-row">
                {tableCols.map((f) => (
                  <th key={f.key}>
                    {showSearch && f.key === "email" && (
                      <input
                        className="builder-admin-data-table-filter-input"
                        type="search"
                        placeholder="Email"
                        value={filterEmail}
                        onChange={(e) => { setFilterEmail(e.target.value); setPage(1); }}
                      />
                    )}
                    {showSearch && f.key === "first_name" && (
                      <input
                        className="builder-admin-data-table-filter-input"
                        type="search"
                        placeholder="First Name"
                        value={filterFirstName}
                        onChange={(e) => { setFilterFirstName(e.target.value); setPage(1); }}
                      />
                    )}
                    {showSearch && f.key === "last_name" && (
                      <input
                        className="builder-admin-data-table-filter-input"
                        type="search"
                        placeholder="Last Name"
                        value={filterLastName}
                        onChange={(e) => { setFilterLastName(e.target.value); setPage(1); }}
                      />
                    )}
                    {showSearch && f.key === "phone" && (
                      <input
                        className="builder-admin-data-table-filter-input"
                        type="search"
                        placeholder="Phone"
                        value={filterPhone}
                        onChange={(e) => { setFilterPhone(e.target.value); setPage(1); }}
                      />
                    )}
                  </th>
                ))}
                <th />
                {hasActions && (
                  <th className="builder-admin-data-table-actions-col actions-col">
                    {showAddButton && (
                      <button
                        type="button"
                        className="btn tiny-btn"
                        onClick={() => { setAddValues({}); setAddMode(true); }}
                      >
                        {addButtonLabel}
                      </button>
                    )}
                  </th>
                )}
              </tr>
            )}
            <tr className="builder-admin-data-table-header-row">
              {tableCols.map((f) => (
                <th
                  key={f.key}
                  className="builder-admin-data-table-sortable"
                  onClick={() => toggleSort(f.key)}
                >
                  {formatAdminSortableHeader(f.label, f.key, sortColumn, sortDirection)}
                </th>
              ))}
              <th
                className="builder-admin-data-table-sortable"
                onClick={() => toggleSort("createdAt")}
              >
                {formatAdminSortableHeader("Added", "createdAt", sortColumn, sortDirection)}
              </th>
              {hasActions && <th className="builder-admin-data-table-actions-col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageContacts.length === 0 ? (
              <tr>
                <td colSpan={tableCols.length + 1 + (hasActions ? 1 : 0)} className="builder-admin-data-table-empty">
                  {hasActiveFilters ? "No contacts match your filters." : "No contacts yet."}
                </td>
              </tr>
            ) : pageContacts.map((c) => (
              <tr key={c.id}>
                {tableCols.map((f) => (
                  <td key={f.key} className="builder-admin-data-table-cell">
                    {f.key === "email" ? (c.email ?? "") : String(c.data?.[f.key] ?? "")}
                  </td>
                ))}
                <td className="builder-admin-data-table-cell builder-admin-data-table-date">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                </td>
                {hasActions && (
                  <td className="builder-admin-data-table-actions">
                    <div className="table-actions-row" role="group">
                      {showViewBtn && (
                        <AdminTableIconButton icon="view" label="View" onClick={() => setViewContact(c)} />
                      )}
                      {showEditBtn && (
                        <AdminTableIconButton icon="edit" label="Edit" onClick={() => openEdit(c)} />
                      )}
                      {showDeleteBtn && (
                        <AdminTableIconButton
                          icon="delete"
                          label="Delete"
                          danger
                          onClick={() => setDeleteContactTarget(c)}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="builder-admin-data-table-pagination">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span>Page {safePage} of {totalPages}</span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
      <div className="builder-admin-data-table-count">
        {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
      </div>

      {/* View modal */}
      {viewContact && (
        <BuilderBodyPortal>
        <div className="crm-contacts-modal-overlay" onClick={() => setViewContact(null)}>
          <div className="crm-contacts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="crm-contacts-modal-header">
              <strong>Contact Details</strong>
              <button type="button" className="crm-contacts-modal-close" onClick={() => setViewContact(null)}>✕</button>
            </div>
            <div className="crm-contacts-modal-body">
              {fields.map((f) => {
                const val = f.key === "email" ? (viewContact.email ?? "") : String(viewContact.data?.[f.key] ?? "");
                if (!val) return null;
                return (
                  <div key={f.key} className="crm-contacts-modal-row">
                    <span className="crm-contacts-modal-label">{f.label}</span>
                    <span className="crm-contacts-modal-value">{val}</span>
                  </div>
                );
              })}
              {viewContact.source && (
                <div className="crm-contacts-modal-row">
                  <span className="crm-contacts-modal-label">Source</span>
                  <span className="crm-contacts-modal-value">{viewContact.source}</span>
                </div>
              )}
              {viewContact.createdAt && (
                <div className="crm-contacts-modal-row">
                  <span className="crm-contacts-modal-label">Added</span>
                  <span className="crm-contacts-modal-value">{new Date(viewContact.createdAt).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="crm-contacts-modal-footer">
              <button type="button" className="crm-contacts-modal-btn" onClick={() => setViewContact(null)}>Close</button>
            </div>
          </div>
        </div>
        </BuilderBodyPortal>
      )}

      {/* Edit modal */}
      {editContact && (
        <BuilderBodyPortal>
        <div className="crm-contacts-modal-overlay" onClick={() => !saving && setEditContact(null)}>
          <div className="crm-contacts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="crm-contacts-modal-header">
              <strong>Edit Contact</strong>
              <button type="button" className="crm-contacts-modal-close" onClick={() => setEditContact(null)} disabled={saving}>✕</button>
            </div>
            <div className="crm-contacts-modal-body">
              {fields.map((f) => (
                <div key={f.key} className="crm-contacts-modal-row crm-contacts-modal-row-edit">
                  <label className="crm-contacts-modal-label">{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea
                      className="crm-contacts-modal-input"
                      rows={3}
                      value={editValues[f.key] ?? ""}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="crm-contacts-modal-input"
                      type={f.type || "text"}
                      value={editValues[f.key] ?? ""}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="crm-contacts-modal-footer">
              <button type="button" className="crm-contacts-modal-btn" onClick={() => setEditContact(null)} disabled={saving}>Cancel</button>
              <button type="button" className="crm-contacts-modal-btn crm-contacts-modal-btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
        </BuilderBodyPortal>
      )}

      {/* Add contact modal */}
      {addMode && (
        <BuilderBodyPortal>
        <div className="crm-contacts-modal-overlay" onClick={() => !saving && setAddMode(false)}>
          <div className="crm-contacts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="crm-contacts-modal-header">
              <strong>Add Contact</strong>
              <button type="button" className="crm-contacts-modal-close" onClick={() => setAddMode(false)} disabled={saving}>✕</button>
            </div>
            <div className="crm-contacts-modal-body">
              {fields.map((f) => (
                <div key={f.key} className="crm-contacts-modal-row crm-contacts-modal-row-edit">
                  <label className="crm-contacts-modal-label">{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea
                      className="crm-contacts-modal-input"
                      rows={3}
                      value={addValues[f.key] ?? ""}
                      onChange={(e) => setAddValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="crm-contacts-modal-input"
                      type={f.type || "text"}
                      value={addValues[f.key] ?? ""}
                      onChange={(e) => setAddValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="crm-contacts-modal-footer">
              <button type="button" className="crm-contacts-modal-btn" onClick={() => setAddMode(false)} disabled={saving}>Cancel</button>
              <button type="button" className="crm-contacts-modal-btn crm-contacts-modal-btn-primary" onClick={saveAdd} disabled={saving}>
                {saving ? "Adding…" : "Add Contact"}
              </button>
            </div>
          </div>
        </div>
        </BuilderBodyPortal>
      )}

      {/* Delete confirmation modal */}
      {deleteContactTarget && (
        <BuilderBodyPortal>
        <div className="crm-contacts-modal-overlay" onClick={() => !deleting && setDeleteContactTarget(null)}>
          <div className="crm-contacts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="crm-contacts-modal-header">
              <strong>Delete Contact</strong>
              <button type="button" className="crm-contacts-modal-close" onClick={() => setDeleteContactTarget(null)} disabled={deleting}>✕</button>
            </div>
            <div className="crm-contacts-modal-body">
              <p className="builder-admin-data-table-delete-copy">
                Delete <strong>{deleteContactTarget.email}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="crm-contacts-modal-footer">
              <button type="button" className="crm-contacts-modal-btn" onClick={() => setDeleteContactTarget(null)} disabled={deleting}>Cancel</button>
              <button type="button" className="crm-contacts-modal-btn crm-contacts-modal-btn-danger" onClick={confirmDeleteContact} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete Contact"}
              </button>
            </div>
          </div>
        </div>
        </BuilderBodyPortal>
      )}
    </div>
  );
}

function MerchProductCard({ settings }: { settings: Record<string, string> }) {
  const productName = settings.productName || "Merch product";
  const imageUrl = resolvePublicBuilderAssetUrl(settings.imageUrl);
  const productUrl = resolvePublicBuilderAssetUrl(settings.productUrl);
  const buttonLabel = settings.buttonLabel || "Buy on Redbubble";

  return (
    <div className="product-card">
      {imageUrl ? <img src={imageUrl} alt={productName} suppressHydrationWarning /> : null}
      <h3>{productName}</h3>
      {productUrl ? (
        <a href={productUrl} target="_blank" rel="noopener noreferrer">
          {buttonLabel}
        </a>
      ) : null}
    </div>
  );
}

export function BuilderTemplatePreview({
  layoutSections,
  pageBackground,
  theme,
  themePalette,
  themeStyles,
  themeShellBackground,
  showShell = true,
  emailPreview = false,
  previewMode = false,
  liveSite = false,
  projectId = "",
  applyThemePageMargins = true,
  suppressShellBackground = false
}: BuilderTemplatePreviewProps) {
  const shellBackground = suppressShellBackground
    ? {}
    : getShellBackgroundLayers(pageBackground, themeShellBackground);
  const hasResolvedShellBackground = !suppressShellBackground && Boolean(
    shellBackground.inlineBackground || shellBackground.backdrop
  );
  const themeMarginStyle = applyThemePageMargins ? getBuilderThemePageMarginStyle(themeStyles) : {};
  // Theme tokens go first so the page background (and any per-module inline
  // styles further down) still win where they overlap.
  const rootStyle = {
    ...getThemeRootVars(theme),
    ...getCrmThemePaletteVars(themePalette),
    ...getBuilderThemeStyleVars(themeStyles),
    ...(suppressShellBackground ? {} : shellBackground.inlineBackground),
  };
  const sitePlayerRegistered = useSitePlayerRegistration();

  function handleAdminLogoutLinkClick(event: MouseEvent<HTMLDivElement>) {
    if (emailPreview) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!isAdminLogoutHref(href)) return;
    event.preventDefault();
    event.stopPropagation();
    void redirectAfterAdminLogout(ADMIN_LOGIN_PATH);
  }

  /** Live and builder previews need the shell so overlay-flow rows stack above the game wash. */
  const shellClassName = !emailPreview
    ? `builder-preview-shell${themeStyles ? " has-builder-theme-styles" : ""}${hasResolvedShellBackground ? " has-resolved-shell-background" : ""}${shellBackground.backdrop ? " has-shell-background-backdrop" : ""}`
    : undefined;
  const contentClassName =
    applyThemePageMargins && themeStyles
      ? "builder-preview-shell-content has-builder-theme-margins"
      : undefined;
  const pageOverlaySections = layoutSections.filter(sectionHasOnlyPageOverlayImageModules);
  const mainSections = layoutSections.filter((section) => !sectionHasOnlyPageOverlayImageModules(section));

  /**
   * Alternating bands are what make a page read as designed rather than as one
   * wash of color, so sections that set no background of their own take turns
   * between the theme's `surface` and `band` roles.
   *
   * Only those sections: one with a background the operator chose keeps it, and
   * a navigation row is chrome rather than a band. The roles resolve through
   * `var(--lp-…, transparent)`, so a theme with no palette paints nothing at
   * all and every existing page renders exactly as it did.
   */
  const themeTreatments = themeStyles?.treatments || null;

  const sectionBandRoles = new Map<string, "surface" | "band" | "inverse">();
  let plainSectionIndex = 0;
  let lastPlainSectionId = "";
  for (const section of mainSections) {
    const hasOwnBackground = Boolean(section.background && section.background.mode !== "none");
    const isNavigationRow = section.modules.length > 0
      && section.modules.every((module) => module.type === "navigation");
    if (hasOwnBackground || isNavigationRow) continue;
    sectionBandRoles.set(section.id, plainSectionIndex % 2 === 0 ? "surface" : "band");
    plainSectionIndex += 1;
    lastPlainSectionId = section.id;
  }
  // The closing dark band big footers use — only when there is more than one
  // plain section, so a single-section page does not go entirely dark.
  if (themeTreatments?.footerInverse && lastPlainSectionId && plainSectionIndex > 1) {
    sectionBandRoles.set(lastPlainSectionId, "inverse");
  }

  // The theme's hero banner: the first plain section wears it as an image
  // background (the hero overlay then applies on top). The operator chose the
  // image; the theme decides how the top band wears it. A section that already
  // has its own background — including its own image — always wins.
  const themeHeroBannerUrl = String(themeStyles?.heroBanner?.url || "");
  let heroBannerSectionId = "";
  if (themeHeroBannerUrl) {
    for (const section of mainSections) {
      const isNavigationRow = section.modules.length > 0
        && section.modules.every((module) => module.type === "navigation");
      if (isNavigationRow) continue;
      if (!section.background || section.background.mode === "none") heroBannerSectionId = section.id;
      break;
    }
  }

  // A feature-cards section directly after an image section pulls up over the
  // hero's bottom edge (the blazefish overlap). Identified here because it
  // needs the previous section, which the section renderer cannot see.
  const overlapSectionIds = new Set<string>();
  if (themeTreatments?.cardOverlap) {
    for (let i = 1; i < mainSections.length; i += 1) {
      const previous = mainSections[i - 1];
      const current = mainSections[i];
      const previousIsImage = (previous.background?.mode === "image" && Boolean(previous.background?.imageUrl))
        || previous.id === heroBannerSectionId;
      const currentLeadsWithCards = current.modules.some((module) => module.type === "feature-cards")
        && (!current.background || current.background.mode === "none");
      if (previousIsImage && currentLeadsWithCards) overlapSectionIds.add(current.id);
    }
  }

  /**
   * Rows joined to the one above render inside a single wrapper that carries
   * the first row's background, which is how one image spans several rows.
   * Members drop their own background and stop bleeding edge to edge on their
   * own — the wrapper does both for the whole group — but keep every other
   * setting, so a joined row still has its own layout, width and margins.
   */
  const renderMainSection = (section: BuilderTemplateSection, joined: boolean) => (
    <BuilderSectionPreview
      bandRole={joined ? undefined : sectionBandRoles.get(section.id)}
      emailPreview={emailPreview}
      heroBannerUrl={section.id === heroBannerSectionId ? themeHeroBannerUrl : undefined}
      heroOverlay={themeTreatments?.heroOverlay}
      heroOverlayOpacity={themeTreatments?.heroOverlayOpacity}
      key={section.id}
      overlapsHero={overlapSectionIds.has(section.id)}
      previewMode={previewMode}
      liveSite={liveSite}
      // The overlay path below has always passed this; ordinary rows did not,
      // so a module in a normal row got projectId="" while the SAME module in
      // an overlay row got the real id. It has gone unnoticed because on a
      // custom domain the server resolves the project from the request host,
      // which covers the empty value — the gap only shows where the host binds
      // no project (previews, system hosts, local dev), and there the request
      // 400s. Found in review round 5 of the Bug Report module (PR #365),
      // where it fired `?projectId=` empty.
      projectId={projectId}
      section={
        joined
          ? { ...section, background: createDefaultBackgroundSettings(), widthMode: "contained" }
          : section
      }
      sitePlayerRegistered={sitePlayerRegistered}
      theme={theme}
      themePalette={themePalette}
    />
  );

  const mainSectionNodes = groupJoinedSections(mainSections).map((group) => {
    const [lead] = group;

    if (group.length === 1) {
      return renderMainSection(lead, false);
    }

    return (
      <div
        className={`builder-preview-joined-rows${
          lead.widthMode === "full-width" ? " builder-preview-section-full-width" : ""
        }`}
        key={`joined-${lead.id}`}
        style={getBuilderBackgroundStyle(lead.background)}
      >
        {group.map((section) => renderMainSection(section, true))}
      </div>
    );
  });

  return (
    <div
      className={
        shellClassName
          ? pageOverlaySections.length > 0
            ? `${shellClassName} builder-preview-shell-has-overlay`
            : shellClassName
          : undefined
      }
      onClickCapture={shellClassName ? handleAdminLogoutLinkClick : undefined}
      style={rootStyle}
    >
      {shellBackground.backdrop && !suppressShellBackground ? (
        <div
          aria-hidden
          className="builder-preview-shell-backdrop"
          style={{ ...shellBackground.backdrop.style, opacity: shellBackground.backdrop.opacity }}
        />
      ) : null}
      {pageOverlaySections.length > 0 ? (
        <div className="builder-preview-overlay-layer" aria-hidden={false}>
          {pageOverlaySections.map((section) => (
            <BuilderSectionPreview
              emailPreview={emailPreview}
              key={section.id}
              previewMode={previewMode}
              liveSite={liveSite}
              projectId={projectId}
              section={section}
              sitePlayerRegistered={sitePlayerRegistered}
              theme={theme}
              themePalette={themePalette}
            />
          ))}
        </div>
      ) : null}
      {contentClassName ? (
        <div className={contentClassName} style={themeMarginStyle}>
          {mainSectionNodes}
        </div>
      ) : (
        mainSectionNodes
      )}
      {shellClassName ? <GameModuleOverlayHosts /> : null}
      {shellClassName ? <BuilderReminderRuntime layoutSections={layoutSections} /> : null}
    </div>
  );
}

function BuilderSectionPreview({
  section,
  emailPreview = false,
  previewMode = false,
  liveSite = false,
  projectId = "",
  sitePlayerRegistered = false,
  theme,
  themePalette,
  bandRole,
  heroBannerUrl,
  heroOverlay,
  heroOverlayOpacity,
  overlapsHero = false
}: {
  section: BuilderTemplateSection;
  emailPreview?: boolean;
  previewMode?: boolean;
  liveSite?: boolean;
  projectId?: string;
  sitePlayerRegistered?: boolean;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
  /** Theme palette role this backgroundless section takes its band from. */
  bandRole?: "surface" | "band" | "inverse";
  /** The theme's hero banner image, when this is the section that wears it. */
  heroBannerUrl?: string;
  /** Treatment: tint laid over an image-background section (hex + opacity). */
  heroOverlay?: string;
  heroOverlayOpacity?: number;
  /** Treatment: this section pulls up over the previous image section. */
  overlapsHero?: boolean;
}) {
  const sectionStyle = getBuilderBackgroundStyle(section.background);
  // `transparent` and `inherit` are the no-palette answers, so a theme without
  // one leaves this section exactly as it renders today.
  const bandStyle: CSSProperties | undefined = bandRole
    ? {
        background: `var(--lp-${bandRole}, transparent)`,
        color: `var(--lp-${bandRole}-text, inherit)`,
        paddingTop: "var(--lp-band-padding, 0px)",
        paddingBottom: "var(--lp-band-padding, 0px)"
      }
    : undefined;

  // Hero treatment: a tint over an image background so text can sit on the
  // photo, with the inverse text color on top. Layered as a gradient IN FRONT
  // of the image, so the photo still reads through.
  const isImageSection = section.background?.mode === "image" && Boolean(section.background?.imageUrl);
  // A theme hero banner turns a plain section into an image section; it always
  // gets an overlay (defaulting to a dark neutral) because text sits on it.
  const bannerImage = !isImageSection && heroBannerUrl ? `url("${heroBannerUrl}")` : "";
  const heroImageSource = bannerImage || (isImageSection ? String(sectionStyle?.backgroundImage || "") : "");
  const heroTint = normalizeBuilderHexColor(heroOverlay || (bannerImage ? "#101820" : ""));
  /*
   * The tint as a COLOUR of its own, not only baked into the gradient below.
   *
   * A parallaxing image background paints the same photo a second time as a
   * positioned child, and an element's own background paints BENEATH its
   * positioned descendants — so that child covers this tint with the bare
   * photo while `--lp-inverse-text` keeps the text white. Measured in review
   * round 3 of #481: mean RGB [166, 11, 17] with parallax off and [44, 53, 63]
   * with it on, white text throughout. The layer has to carry what it covers,
   * so the colour is needed on its own to hand over.
   *
   * Painting the layer BEHIND the section's background instead is not an
   * option: a negative z-index child still paints above its parent's own
   * background whenever the parent forms a stacking context, and this section
   * forms one on several ordinary paths (an overlay slot, a navigation module,
   * a hero overlap). That is the same shape of silent, theme-dependent failure
   * as `background-attachment: fixed`, which this ticket rejected by name.
   */
  const heroTintColor: string | undefined =
    heroImageSource && heroTint
      ? (() => {
          const opacity = Math.min(0.75, Math.max(0, heroOverlayOpacity ?? 0.45));
          const [r, g, b] = [1, 3, 5].map((offset) => parseInt(heroTint.slice(offset, offset + 2), 16));
          return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        })()
      : undefined;
  const heroStyle: CSSProperties | undefined = heroTintColor
    ? {
        backgroundImage: `linear-gradient(${heroTintColor}, ${heroTintColor}), ${heroImageSource}`,
        ...(bannerImage
          ? {
              backgroundSize: "cover",
              backgroundPosition: "center",
              paddingTop: "72px",
              paddingBottom: "72px"
            }
          : {}),
        color: "var(--lp-inverse-text, #ffffff)"
      }
    : undefined;

  // Overlap treatment: ride up over the hero's bottom edge, above its tint.
  const overlapStyle: CSSProperties | undefined = overlapsHero
    ? { marginTop: "-56px", position: "relative", zIndex: 2 }
    : undefined;
  const columnKeys = getLayoutColumns(section.layout);
  const isNavigationSection = section.modules.length > 0 && section.modules.every((module) => module.type === "navigation");
  const hasNavigationModule = section.modules.some((module) => module.type === "navigation");
  const isPageOverlayFlowSection = sectionHasOnlyPageOverlayImageModules(section);
  const isSectionOverlaySlot = sectionHasOnlySectionScopedOverlayModules(section);
  const isOverlayLayoutCollapsed = isPageOverlayFlowSection || isSectionOverlaySlot;
  const hasPollModules = section.modules.some(
    (module) => module.type === "current-poll" || module.type === "previous-results"
  );
  const rowBorderWidth = Number(section.rowBorderWidth ?? "0");
  // His own column proportions when he has set a complete set, the Layout
  // preset otherwise. Both the grid and the token the mobile stylesheet reads
  // take the same answer, so they cannot disagree.
  const sectionGridTemplate = getSectionGridTemplate(section);
  /*
   * A video background is the one mode that is not CSS. `sectionStyle` above
   * has already painted its POSTER, so the row reads correctly before this
   * layer mounts, while it buffers, and in every state where the layer decides
   * not to play at all (reduce motion, phone width). The <video> simply covers
   * the still when it is allowed to run.
   *
   * Overlay slots are excluded on purpose: they are not really rows, and the
   * containment below would clip the very thing they exist to let overflow.
   */
  const sectionVideoBackground =
    !isOverlayLayoutCollapsed &&
    section.background?.mode === "video" &&
    Boolean(section.background?.videoUrl)
      ? section.background
      : null;
  /*
   * An IMAGE background needs a layer too, but only when it parallaxes.
   *
   * Everywhere else an image is a CSS background on this very element, which
   * is why the check is `builderBackgroundParallaxActive` and not "is this an
   * image": mounting a layer for every image section would give all of them
   * the containment below (`overflow: hidden`), and a row with an overlay
   * module deliberately spilling out of it would start being clipped. Off by
   * default means off, all the way down to the element count.
   */
  const sectionParallaxImageBackground =
    !isOverlayLayoutCollapsed &&
    section.background?.mode === "image" &&
    builderBackgroundParallaxActive(section.background)
      ? section.background
      : null;
  const sectionBackgroundLayer = sectionVideoBackground ?? sectionParallaxImageBackground;
  /*
   * THE TINT THE LAYER HAS TO CARRY, because it is about to cover it.
   *
   * The two guards mirror exactly where `heroStyle` is applied to the section
   * below: a navigation-only row and a collapsed overlay slot never wear the
   * tint, so their layer must not invent one.
   *
   * There is deliberately no "image only" guard, even though only the image
   * layer composites this today. It would be dead code: a video row cannot
   * carry a hero tint at all, because the theme's banner is only assigned to a
   * row that has no background of its own (`heroBannerSectionId` above) and a
   * video row has one. A guard that can never fire is worse than none — it
   * reads as protection and is not.
   */
  const sectionBackgroundLayerTint =
    sectionBackgroundLayer && !isNavigationSection && !isOverlayLayoutCollapsed
      ? heroTintColor
      : undefined;
  const sectionOverlayScreenStyle = isOverlayLayoutCollapsed
    ? undefined
    : getBuilderRowOverlayScreenStyle(section.overlayScreen);

  const gridStyle: CSSProperties = {
    // Band first: a section carrying its own background never gets one, so
    // this cannot overwrite an operator's choice.
    ...(isNavigationSection || isOverlayLayoutCollapsed ? {} : bandStyle),
    // A menu-only row used to throw its own background away, which is half of
    // the operator's "the style controls of the container have no effect"
    // (2026-08-11) — he set a header strip's color and nothing happened.
    // Honoured now: it is `undefined` until he picks one, so a row he never
    // touched still renders flush. The automatic treatments above and below
    // (band, hero tint, overlap) stay off — those are not his controls.
    ...(isOverlayLayoutCollapsed ? {} : sectionStyle),
    // Hero tint and overlap layer on top of the section's own background.
    ...(isNavigationSection || isOverlayLayoutCollapsed ? {} : heroStyle),
    ...(isNavigationSection || isOverlayLayoutCollapsed ? {} : overlapStyle),
    ...(isOverlayLayoutCollapsed ? {} : getSectionMarginStyle(section)),
    ...(isOverlayLayoutCollapsed ? {} : getSectionHorizontalMarginStyle(section)),
    // Navigation-only rows already render flush by design; overlay slots are
    // not really rows at all. Everything else honours the operator's number.
    ...(isOverlayLayoutCollapsed || isNavigationSection ? {} : getSectionPaddingStyle(section)),
    // A row with content sizes to that content. The 56px floor exists so an
    // EMPTY row is still big enough to drop a module onto, and keeping it on
    // filled rows was padding every contact strip out to nearly triple height.
    ...(section.modules.length > 0 ? { "--builder-section-min-height": "0px" } : {}),
    // ...unless the operator has asked for a taller band, which overrides both
    // the floor and the release above it.
    ...(isOverlayLayoutCollapsed ? {} : getSectionMinHeightStyle(section)),
    // Same reasoning: {} at the 100% default, so only a row he narrowed moves.
    ...(isOverlayLayoutCollapsed ? {} : getSectionWidthStyle(section)),
    // The operator's own nudge, after the layout styles it is nudging away
    // from. {} until he sets one, and it deliberately sits BEFORE the overlay
    // and navigation z-index rules below so those still win their stack.
    ...(isOverlayLayoutCollapsed ? {} : getSectionOffsetStyle(section)),
    ...getOverlayFlowCollapsedSectionStyle(isOverlayLayoutCollapsed),
    ...(isSectionOverlaySlot
      ? { position: "relative", zIndex: resolveSectionScopedOverlaySectionZIndex(section) }
      : hasNavigationModule
      ? { position: "relative", zIndex: 10 }
      : {}),
    ...(rowBorderWidth > 0 && !isOverlayLayoutCollapsed
      ? {
          border: `${rowBorderWidth}px ${section.rowBorderStyle ?? "solid"} ${section.rowBorderColor ?? "#000000"}`,
          borderRadius: `${section.rowBorderRadius ?? "0"}px`
        }
      : {}),
    // Containment for the video layer and the tint screen, both of which are
    // absolutely positioned children. Without `overflow: hidden` a blurred
    // video — which is scaled up so its soft rim falls outside — would spill
    // over the rows above and below it.
    ...(sectionBackgroundLayer || sectionOverlayScreenStyle
      ? { position: "relative", overflow: "hidden" }
      : {}),
    display: "grid",
    gridTemplateColumns: sectionGridTemplate,
    ...(isOverlayLayoutCollapsed ? { gap: 0 } : getSectionColumnGapStyle(section)),
    "--builder-layout-grid": sectionGridTemplate
  } as CSSProperties;

  return (
    <section
      className={`builder-preview-section builder-preview-section-layout-${section.layout || "single"} builder-preview-section-mobile-${section.mobileLayout || "stack"} ${
        isNavigationSection ? "builder-preview-section-navigation" : ""
      }${isPageOverlayFlowSection ? " builder-preview-section-overlay-flow" : ""}${
        isSectionOverlaySlot ? " builder-preview-section-overlay-slot" : ""
      }${hasPollModules ? " builder-preview-section-poll-row" : ""}${
        section.equalColumnHeights === "true" && !isOverlayLayoutCollapsed
          ? " builder-preview-section-equal-columns"
          : ""
      }${
        section.widthMode === "full-width" ? " builder-preview-section-full-width" : ""
      }${
        sectionBackgroundLayer || sectionOverlayScreenStyle
          ? " builder-preview-section-layered"
          : ""
      }`}
      style={gridStyle}
    >
      {sectionBackgroundLayer ? (
        <BuilderBackgroundLayer
          background={sectionBackgroundLayer}
          surface="section"
          tint={sectionBackgroundLayerTint}
        />
      ) : null}
      {sectionOverlayScreenStyle ? (
        <div className="builder-preview-row-overlay-screen" style={sectionOverlayScreenStyle} />
      ) : null}
      {columnKeys.map((columnKey) => {
        const columnModules = section.modules.filter((module) => module.column === columnKey);
        // What share of the row this column occupies, so an image inside it can
        // ask the browser for a file sized to the real slot rather than the page.
        const columnWidthPercent = getSectionColumnPercent(section, columnKey);
        const isNavigationColumn = columnModules.length > 0 && columnModules.every((module) => module.type === "navigation");
        const columnBackground = section.cellBackgrounds?.[columnKey];
        /*
         * Cell spacing, four sides, with both older generations read as
         * fallbacks: the vertical/horizontal pair that shipped 2026-08-11 and
         * the single all-sides `cellPadding` before it. Reading them here as
         * well as in the normalizer is what lets a page that has not been
         * re-saved render exactly as it did.
         *
         * The cast is because those older keys are off the type now — they
         * exist only in stored data, which is precisely why this reads them.
         */
        const legacyCell = section as unknown as Record<string, Record<string, string> | undefined>;
        const legacyPadding = section.cellPadding?.[columnKey] ?? "0";
        const cellSide = (record: Record<string, string> | undefined, pairKey: string, fallback: string) =>
          record?.[columnKey] ?? legacyCell[pairKey]?.[columnKey] ?? fallback;
        const paddingTop = cellSide(section.cellPaddingTop, "cellVerticalPadding", legacyPadding);
        const paddingBottom = cellSide(section.cellPaddingBottom, "cellVerticalPadding", legacyPadding);
        const paddingLeft = cellSide(section.cellPaddingLeft, "cellHorizontalPadding", legacyPadding);
        const paddingRight = cellSide(section.cellPaddingRight, "cellHorizontalPadding", legacyPadding);
        // `--builder-cell-padding` feeds one rule only, and that rule is
        // `margin-inline` — a full-bleed overlay slot reaching back out
        // sideways (_builder-react.css). So it takes a HORIZONTAL side;
        // handing it a vertical one would pull the slot out by the wrong
        // number the moment the sides differ.
        const padding = paddingLeft;
        const marginTop = cellSide(section.cellMarginTop, "cellVerticalMargin", "0");
        const marginBottom = cellSide(section.cellMarginBottom, "cellVerticalMargin", "0");
        const marginLeft = section.cellMarginLeft?.[columnKey] ?? "0";
        const marginRight = section.cellMarginRight?.[columnKey] ?? "0";
        const borderWidth = section.cellBorderWidth?.[columnKey] ?? "0";
        const borderColor = section.cellBorderColor?.[columnKey] ?? "transparent";
        const borderRadius = section.cellBorderRadius?.[columnKey] ?? "0";
        const isPageOverlayFlowColumn =
          columnModules.length > 0 &&
          columnModules.every((module) => isOverlayImageModule(module) && !isSectionScopedOverlayDecor(module));
        const isSectionOverlayColumn = columnHasOnlySectionScopedOverlayModules(columnModules);
        /*
         * The cell's own numbers, as one answer each, used BOTH by the inline
         * properties below and by the variables the narrow-screen rules read.
         *
         * Operator, 2026-08-12: a cell set to 4 rendered 12 below 560px,
         * because the generated stylesheet compacts every cell there with
         * `padding: 12px !important` — and an `!important` in a stylesheet
         * outranks an ordinary inline style, so the setting was never in the
         * argument. Publishing the values lets those rules honour them
         * instead of replacing them (see _builder-react-overrides.css).
         *
         * Deliberately NOT reusing `--builder-cell-padding`: that one carries
         * the LEFT side alone, for a `margin-inline` rule that reaches an
         * overlay slot back out sideways. It would be the wrong number here.
         */
        const effectiveCellPadding =
          isNavigationColumn || isPageOverlayFlowColumn || isSectionOverlayColumn
            ? "0px"
            : `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`;
        const effectiveCellRadius =
          isPageOverlayFlowColumn || isSectionOverlayColumn ? "0px" : `${borderRadius}px`;

        // Custom properties are not in the CSSProperties type, so they are
        // built once and cast rather than sprinkling casts through the block.
        const cellVariables = {
          "--builder-cell-padding-box": effectiveCellPadding,
          "--builder-cell-radius": effectiveCellRadius,
        } as CSSProperties;

        const columnStyle: CSSProperties = {
          // The cell's own fill, honoured on menu cells too — see the row
          // background above. `columnBackground` is falsy until the operator
          // sets one, so an untouched menu cell is unchanged.
          ...(!columnBackground ? {} : getBuilderBackgroundStyle(columnBackground)),
          ...(isPageOverlayFlowColumn || isSectionOverlayColumn
            ? {}
            : {
                marginTop: `${marginTop}px`,
                marginBottom: `${marginBottom}px`,
                marginLeft: `${marginLeft}px`,
                marginRight: `${marginRight}px`
              }),
          ...getOverlayFlowCollapsedColumnStyle(isPageOverlayFlowColumn),
          ...getSectionScopedOverlayColumnStyle(isSectionOverlayColumn),
          ...(Number(padding) > 0 && !isPageOverlayFlowColumn && !isSectionOverlayColumn
            ? { "--builder-cell-padding": `${padding}px` }
            : {}),
          ...cellVariables,
          // Cell padding stays off for menu cells, and this one is deliberate:
          // it used to default to 18px, so honouring it would have pushed
          // every live header down without anybody asking. The menu module
          // carries its own four padding sides now (Placement axis), which is
          // the control that should move a menu inside its cell.
          padding: effectiveCellPadding,
          border:
            isPageOverlayFlowColumn || isSectionOverlayColumn || Number(borderWidth) <= 0
              ? undefined
              : `${borderWidth}px solid ${borderColor}`,
          borderRadius: effectiveCellRadius,
          // {} at the left/top default, so only a cell he aligned moves.
          ...(isPageOverlayFlowColumn || isSectionOverlayColumn
            ? {}
            : getCellContentAlignmentStyle(
                section.cellHAlign?.[columnKey] ?? "left",
                section.cellVAlign?.[columnKey] ?? "top"
              )),
          position: "relative"
        };

        return (
          <div
            key={columnKey}
            className={`builder-preview-column ${
              section.cellMobileHidden?.[columnKey] === "true" ? "builder-preview-column-mobile-hidden" : ""
            } ${isNavigationColumn ? "builder-preview-column-navigation" : ""}${
              isPageOverlayFlowColumn ? " builder-preview-column-overlay-flow" : ""
            } ${isSectionOverlayColumn ? " builder-preview-column-overlay-slot" : ""}`}
            style={columnStyle}
          >
            {columnModules.map((module) => {
              const isPageOverlayFlowModule =
                isOverlayImageModule(module) && !isSectionScopedOverlayDecor(module);
              const isSectionOverlayModule = isSectionScopedOverlayDecor(module);
              const isCurrentPollModule = module.type === "current-poll";
              const isPollCategoryListModule = module.type === "poll-category-list";

              return (
                <div
                  key={module.id}
                  className={`builder-preview-module ${module.type !== "table" ? getAlignmentClass(getModuleAlignment(module.settings)) : ""} ${
                    module.settings.mobileHidden === "true" ? "builder-preview-module-mobile-hidden" : ""
                  } ${
                    module.settings.mobileAlignment ? `builder-preview-module-mobile-align-${module.settings.mobileAlignment}` : ""
                  } ${
                    module.settings.mobileFontSize ? "builder-preview-module-mobile-font-size" : ""
                  }${isPageOverlayFlowModule ? " builder-preview-module-overlay-flow" : ""}${
                    isSectionOverlayModule ? " builder-preview-module-overlay-slot" : ""
                  }${isCurrentPollModule ? " builder-preview-module-current-poll" : ""}`}
                  style={{
                    // Table paints its own background on the <table>, which is
                    // where Max Width constrains it. Painting it here too put
                    // the fill across the full column behind a narrow table.
                    // Text paints its own fill inside the frame, so the fill
                    // follows the Width, the Radius and the padding rather
                    // than spanning the column behind them
                    // (getTextModuleFrameStyle, operator 2026-08-15) — the
                    // same reason table and button opt out here.
                    ...(module.type === "navigation" ||
                    module.type === "table" ||
                    module.type === "text" ||
                    isPageOverlayFlowModule ||
                    isSectionOverlayModule ||
                    module.type === "button" ||
                    isCurrentPollModule ||
                    isPollCategoryListModule
                      ? {}
                      : getBuilderBackgroundStyle(getModuleBackgroundSettings(module.settings)) ?? {}),
                    ...(isPageOverlayFlowModule ||
                    isSectionOverlayModule ||
                    isCurrentPollModule ||
                    isPollCategoryListModule
                      ? {}
                      // One reader for every type since 2026-08-11: heading
                      // and button had their own because they were the only
                      // two with split sides. Now everything has four.
                      : getModuleOuterSpacingStyle(module.settings)),
                    ...getOverlayFlowCollapsedModuleStyle(isPageOverlayFlowModule),
                    ...getSectionScopedOverlayModuleStyle(isSectionOverlayModule),
                    "--builder-mobile-font-size": module.settings.mobileFontSize
                      ? `${module.settings.mobileFontSize}px`
                      : undefined
                  } as CSSProperties}
                >
                  <BuilderModulePreview
                    columnWidthPercent={columnWidthPercent}
                    emailPreview={emailPreview}
                    module={module}
                    overlayFlowDecor={isPageOverlayFlowModule || isSectionOverlayModule}
                    previewMode={previewMode}
                    liveSite={liveSite}
                    projectId={projectId}
                    sitePlayerRegistered={sitePlayerRegistered}
                    theme={theme}
                    themePalette={themePalette}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function BuilderModulePreview({
  module,
  columnWidthPercent = 100,
  emailPreview = false,
  overlayFlowDecor = false,
  previewMode = false,
  liveSite = false,
  projectId = "",
  sitePlayerRegistered = false,
  theme,
  themePalette
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
  /** This module's column as a percentage of the row — see getSectionColumnPercent. */
  columnWidthPercent?: number;
  emailPreview?: boolean;
  /** Floating image in a full-page overlay row — always visible on the live site. */
  overlayFlowDecor?: boolean;
  previewMode?: boolean;
  liveSite?: boolean;
  projectId?: string;
  sitePlayerRegistered?: boolean;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const variant = module.settings.variant ?? "";

  if (module.type === "navigation") {
    return <NavigationModulePreview module={module} previewMode={previewMode} />;
  }

  if (module.type === "heading") {
    const Tag = (module.settings.level || "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    // Inline markup, sanitized: a heading can carry a recolored or resized
    // word (see `formatHeadingContent`). A heading with no markup renders
    // exactly the escaped text it always did.
    return (
      <Tag
        className={`builder-preview-heading builder-preview-heading-${variant || "default"}`}
        dangerouslySetInnerHTML={{ __html: formatHeadingContent(module.text) }}
        style={getHeadingModuleStyle(module.settings)}
      />
    );
  }

  if (module.type === "headline-rotator") {
    return <HeadlineRotatorPreview module={module} />;
  }

  if (module.type === "carousel") {
    return <CarouselPreview module={module} />;
  }

  if (module.type === "program-list") {
    return <ProgramListModulePreview module={module} />;
  }

  if (module.type === "feature-cards") {
    return <FeatureCardsModulePreview module={module} previewMode={previewMode} />;
  }

  if (module.type === "poll-category-list") {
    return <PollCategoryListPreview module={module} />;
  }

  if (module.type === "text") {
    // Simple Text keeps every other text-module behaviour (alignment, width,
    // background) and changes only how the copy itself is turned into HTML —
    // plus the type overrides, which are its own since it has no type scale.
    const isPlainText = isPlainTextVariant(module.settings);
    const html = isPlainText
      ? formatPlainTextContent(module.text)
      : formatRichTextContent(module.text);

    return (
      <div
        className={`builder-preview-text builder-preview-text-${variant || "default"}`}
        style={{
          ...getTextModuleWidthStyle(module.settings),
          ...(isPlainText ? getPlainTextModuleStyle(module.settings) : {}),
          ...getTextModuleRhythmStyle(module.settings),
          ...getTextModuleFrameStyle(module.settings)
        }}
        dangerouslySetInnerHTML={{ __html: html || "" }}
      />
    );
  }

  if (module.type === "code") {
    return (
      <div className={`builder-preview-code builder-preview-code-${variant || "default"}`}>
        {module.settings.label ? (
          <div className="builder-preview-code-label">{module.settings.label}</div>
        ) : null}
        {module.text ? <BuilderCodeEmbed html={sanitizeEmbedHtml(module.text)} /> : null}
      </div>
    );
  }

  if (module.type === "merch") {
    return <MerchProductCard settings={module.settings} />;
  }

  if (module.type === "quote") {
    return (
      <blockquote className={`builder-preview-quote builder-preview-quote-${variant || "default"}`}>
        {module.text || ""}
      </blockquote>
    );
  }

  if (module.type === "speech-bubble") {
    if (emailPreview) {
      return <SpeechBubblePreview module={module} />;
    }

    return (
      <BuilderSpeechBubbleRuntime
        gamePlayContext="public"
        module={module}
        previewMode={previewMode}
        sitePlayerRegistered={sitePlayerRegistered}
      />
    );
  }

  if (module.type === "button") {
    const s = module.settings;
    const btnStyle = getButtonModuleStyle(s, { followThemePalette: !emailPreview });
    const href = emailPreview
      ? resolveEmailMergeTokensForPreview(module.settings.href || "#")
      : module.settings.href || "#";

    return (
      <Link
        className={`builder-preview-button builder-preview-button-styled builder-preview-button-${variant || "default"} builder-preview-button-${s.buttonSize ?? "medium"}`}
        href={href}
        style={btnStyle}
      >
        {module.text || ""}
      </Link>
    );
  }

  if (module.type === "contact-form") {
    return <ContactFormPreview projectId={projectId} settings={module.settings} />;
  }

  if (module.type === "crm-form") {
    return <CrmFormPreview settings={module.settings} theme={theme} themePalette={themePalette} projectId={projectId} />;
  }

  if (module.type === "crm-contacts-table") {
    return (
      <CrmContactsTablePreview
        settings={module.settings}
        projectId={projectId}
        theme={theme}
        themePalette={themePalette}
      />
    );
  }

  if (module.type === "player-portal") {
    return (
      <PlayerPortalAuthForm
        settings={getPlayerPortalAuthSettings(module.settings)}
        heading={module.text}
      />
    );
  }

  if (module.type === "video" || (module.type === "image" && module.settings.variant === "video")) {
    const embed = getVideoEmbedSource(module.settings.url);
    const title = module.settings.videoName || module.name || module.text || "Video";
    const opensInNewTab = module.settings.newTab !== "false";

    return (
      <figure className="builder-preview-video-card">
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
          ) : null}
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

  if (module.type === "floating-image") {
    if (emailPreview) {
      return (
        <BuilderImagePreview
          module={module}
          variant={variant}
          placeholder="Choose a floating image"
        />
      );
    }

    const trigger = getModuleTrigger(module.settings);
    const usesOverlayHost = shouldFloatingImageUseOverlayHost(trigger);
    const showInlineDecor = !usesOverlayHost || overlayFlowDecor;

    return (
      <>
        {showInlineDecor ? (
          <BuilderImagePreview
            module={module}
            sectionScopedDecor={isSectionScopedOverlayDecor(module)}
            variant={variant}
            placeholder="Choose a floating image"
          />
        ) : null}
        {usesOverlayHost ? (
          <BuilderFloatingImageRuntime
            gamePlayContext="public"
            module={module}
            overlayFlowDecor={overlayFlowDecor}
            previewMode={previewMode}
            sitePlayerRegistered={sitePlayerRegistered}
          />
        ) : null}
      </>
    );
  }

  if (module.type === "image") {
    return (
      <BuilderImagePreview
        module={module}
        variant={variant}
        placeholder="Choose an image"
        columnWidthPercent={columnWidthPercent}
      />
    );
  }

  if (module.type === "table") {
    return <TableModulePreview module={module} />;
  }

  if (module.type === "social") {
    return <SocialModulePreview module={module} />;
  }

  if (module.type === "previous-results" || module.type === "current-poll") {
    return (
      <Suspense fallback={null}>
        <BuilderPollModuleRuntime kind={module.type} settings={module.settings} />
      </Suspense>
    );
  }

  if (module.type === "social-share") {
    return (
      <Suspense fallback={null}>
        <BuilderSocialShareRuntime settings={module.settings} />
      </Suspense>
    );
  }

  if (module.type === "confetti") {
    return <BuilderConfettiRuntime preview settings={module.settings} />;
  }

  if (module.type === "tractor-nav") {
    return <TractorNavRuntime settings={module.settings} />;
  }

  if (module.type === "blog-post-list") {
    if (shouldRenderBlogPostManager(module.settings)) {
      return <BlogPostManagerPreview settings={resolveBlogPostManagerSettings(module.settings)} />;
    }
    return <BlogPostListPreview settings={module.settings} />;
  }
  if (module.type === "blog-post-create") {
    return <BlogPostCreatePreview settings={module.settings} />;
  }
  if (module.type === "blog-post-manager") {
    return <BlogPostManagerPreview settings={resolveBlogPostManagerSettings(module.settings)} />;
  }
  if (module.type === "event-detail") {
    return <EventDetailPreview settings={module.settings} theme={theme} themePalette={themePalette} />;
  }
  if (module.type === "event-calendar") {
    return <EventCalendarPreview settings={module.settings} theme={theme} themePalette={themePalette} />;
  }
  if (module.type === "media-manager") {
    return <MediaManagerPreview settings={module.settings} text={module.text} />;
  }

  if (module.type === "event-manager") {
    return <EventManagerPreview settings={module.settings} theme={theme} themePalette={themePalette} />;
  }
  if (module.type === "blog-category-manager") {
    return <BlogCategoryManagerPreview settings={module.settings} />;
  }
  if (module.type === "blog-card-manager") {
    return <BlogCardManagerPreview />;
  }
  if (module.type === "messaging-topic-list") {
    return <MessagingTopicListPreview settings={module.settings} />;
  }
  if (module.type === "messaging-tag-list") {
    return <MessagingTagListPreview settings={module.settings} />;
  }
  if (module.type === "blog-category-filter") {
    return <BlogCategoryFilterPreview settings={module.settings} />;
  }
  if (module.type === "blog-tag-cloud") {
    return <BlogTagCloudPreview settings={module.settings} />;
  }
  if (module.type === "blog-post-tags") {
    return <BlogPostTagsPreview settings={module.settings} />;
  }
  if (module.type === "blog-post") {
    return <BlogPostViewPreview settings={module.settings} />;
  }
  if (module.type === "blog-newsletter-subscribe") {
    return (
      <BlogNewsletterSubscribePreview
        settings={module.settings}
        theme={theme}
        themePalette={themePalette}
        projectId={projectId}
      />
    );
  }
  if (module.type === "blog-related-posts") {
    return <BlogRelatedPostsPreview settings={module.settings} />;
  }
  if (module.type === "blog-search") {
    return <BlogSearchPreview settings={module.settings} />;
  }
  if (module.type === "blog-search-results") {
    return <BlogSearchResultsPreview settings={module.settings} />;
  }
  if (module.type === "site-search") {
    return <SiteSearchPreview settings={module.settings} themePalette={themePalette} />;
  }
  if (module.type === "site-search-results") {
    return <SiteSearchResultsPreview settings={module.settings} themePalette={themePalette} projectId={projectId} />;
  }
  if (
    module.type === "blog-post-card" ||
    module.type === "blog-author-bio" ||
    module.type === "blog-toc"
  ) {
    return <BlogModulePlaceholder type={module.type} />;
  }

  if (module.type === "admin-team-users") {
    return (
      <AdminTeamUsersPreview
        settings={module.settings}
        projectId={projectId}
        theme={theme}
        themePalette={themePalette}
      />
    );
  }

  if (module.type === "admin-modules") {
    return <AdminModulesPreview settings={module.settings} projectId={projectId} />;
  }

  if (module.type === "admin-login") {
    return <AdminLoginPreview settings={module.settings} projectId={projectId} />;
  }

  if (module.type === "admin-site-settings") {
    return <AdminSiteSettingsPreview settings={module.settings} projectId={projectId} />;
  }

  if (module.type === "admin-support-form") {
    return <AdminSupportFormPreview settings={module.settings} projectId={projectId} />;
  }

  if (module.type === "admin-nav-link") {
    return <AdminNavLinkPreview settings={module.settings} />;
  }

  if (module.type === "bug-report") {
    return <BugReportModule settings={module.settings} previewMode={previewMode} liveSite={liveSite} projectId={projectId} />;
  }

  return null;
}

// ── Blog preview components ─────────────────────────────────────────────────

type BlogPostRecord = {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  author?: string;
  featuredImageUrl?: string;    // API returns camelCase from sanitize()
  featured_image_url?: string;  // keep for any legacy / direct-DB paths
  published_at?: string;
  categoryIds?: string[];
  tags?: string[];
};

type BlogCategory = { id: string; name: string; slug: string };

function currentSitePageSlug(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.replace(/^\//, "").replace(/\/$/, "").toLowerCase();
}

function isAdminBlogManagerPageSlug(slug = currentSitePageSlug()): boolean {
  return slug === "admin-blog-manager" || slug.endsWith("-blog-manager");
}

function shouldRenderBlogPostManager(settings: Record<string, string>): boolean {
  const layout = String(settings.layout || "").trim().toLowerCase();
  if (layout === "admin-manager") return true;
  return isAdminBlogManagerPageSlug();
}

const DEFAULT_BLOG_POST_VIEW_PATH = "/blog-post-view";

function defaultBlogPostViewPath(): string {
  return DEFAULT_BLOG_POST_VIEW_PATH;
}

function resolveBlogPostManagerSettings(settings: Record<string, string>): Record<string, string> {
  const resolved = { ...settings };
  if (!String(resolved.editPageUrl || "").trim()) {
    const autoEdit = blogManagerEditBaseUrl(resolved);
    if (autoEdit) resolved.editPageUrl = autoEdit;
  }

  if (!String(resolved.viewPageUrl || "").trim()) {
    const postPageUrl = String(resolved.postPageUrl || "").trim();
    resolved.viewPageUrl = postPageUrl || defaultBlogPostViewPath();
  }

  return resolved;
}

function BlogPostListPreview({ settings }: { settings: Record<string, string> }) {
  const [allPosts, setAllPosts] = useState<BlogPostRecord[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [cardTemplate, setCardTemplate] = useState<CardTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  // User filter state
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Module settings
  const layout = settings.layout || "grid";
  const cols = Math.max(1, parseInt(settings.columns || "3", 10) || 3);
  const postsPerPage = Math.max(1, parseInt(settings.postsPerPage || "9", 10) || 9);
  // postSlug names the post-view page (operator 6/28: the slug field
  // replaces the page-URL field). Legacy postPageUrl still wins when set
  // so no saved page changes behavior.
  const postSlug = (settings.postSlug || "").trim().replace(/^\/+/, "");
  const postPageUrl =
    (settings.postPageUrl || "").trim() || (postSlug ? `/${postSlug}` : defaultBlogPostViewPath());
  const listTitle = (settings.postTitle || "").trim();

  // Card template — migrate from API (supports both old elements[] and new rows[] format)
  const tpl = cardTemplate ? migrateTemplate(cardTemplate) : DEFAULT_CARD_TEMPLATE;
  const tplRows    = tpl.rows;
  const cardLayout = tpl.cardLayout;
  const cardStyle  = tpl.cardStyle;
  const cardRadius = tpl.cardBorderRadius;
  const accent     = tpl.accentColor;
  const tplAspect  = tpl.imageAspectRatio;
  const readMoreLabel = tpl.readMoreLabel;
  const cardGap = parseInt(settings.cardGap || "24", 10) || 24;

  // Filter bar visibility
  const showSearchBar = (settings.showSearch ?? "true") !== "false";
  const showCategoryFilter = (settings.showCategoryFilter ?? "true") !== "false";
  const showTagFilter = (settings.showTagFilter ?? "true") !== "false";
  const showAuthorFilter = (settings.showAuthorFilter ?? "true") !== "false";
  const showDateFilter = settings.showDateFilter === "true";
  const hasFilterBar = showSearchBar || showCategoryFilter || showTagFilter || showAuthorFilter || showDateFilter;

  useEffect(() => {
    const headers = getCrmProjectHeaders();
    Promise.all([
      fetch(`/api/blog/posts?status=published&limit=100`, { credentials: "include", headers })
        .then((r) => (r.ok ? r.json() : null)),
      fetch("/api/blog/categories", { credentials: "include", headers })
        .then((r) => (r.ok ? r.json() : null)),
      fetch("/api/blog/card-template", { credentials: "include", headers })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([pd, cd, td]) => {
        const fetchedPosts = Array.isArray(pd?.posts) ? (pd.posts as BlogPostRecord[]) : [];
        const fetchedCats = Array.isArray(cd?.categories) ? (cd.categories as BlogCategory[]) : [];
        setAllPosts(fetchedPosts);
        setCategories(fetchedCats);
        const tplData = td?.template ?? td;
        if (tplData && typeof tplData === "object") setCardTemplate(migrateTemplate(tplData));
        // Pre-seed filters from URL params
        const params = new URLSearchParams(window.location.search);
        const urlCatSlug = params.get("category") ?? "";
        if (urlCatSlug) {
          const match = fetchedCats.find((c) => c.slug === urlCatSlug);
          if (match) setCatFilter(match.id);
        }
        const urlTag = params.get("tag") ?? "";
        if (urlTag) setTagFilter(urlTag);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(
    () => [...new Set(allPosts.flatMap((p) => p.tags || []))].filter(Boolean).sort(),
    [allPosts]
  );
  const allAuthors = useMemo(
    () => [...new Set(allPosts.map((p) => p.author).filter((a): a is string => Boolean(a)))].sort(),
    [allPosts]
  );

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPosts.filter((post) => {
      if (q && !`${post.title} ${post.excerpt || ""}`.toLowerCase().includes(q)) return false;
      if (catFilter && !post.categoryIds?.includes(catFilter)) return false;
      if (tagFilter && !post.tags?.includes(tagFilter)) return false;
      if (authorFilter && post.author !== authorFilter) return false;
      if (dateFrom && (!post.published_at || new Date(post.published_at) < new Date(dateFrom))) return false;
      if (dateTo && (!post.published_at || new Date(post.published_at) > new Date(dateTo + "T23:59:59"))) return false;
      return true;
    });
  }, [allPosts, search, catFilter, tagFilter, authorFilter, dateFrom, dateTo]);

  const visiblePosts = filteredPosts.slice(0, postsPerPage);
  const hasActiveFilter = search || catFilter || tagFilter || authorFilter || dateFrom || dateTo;

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#888" }}>Loading posts…</div>;
  }

  const cardBorder: CSSProperties =
    cardStyle === "bordered"
      ? { border: `1px solid ${accent}40`, boxShadow: "none" }
      : cardStyle === "shadow"
      ? { border: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }
      : { border: "1px solid #e2e8f0", boxShadow: "none" };

  const gridStyle: CSSProperties =
    layout === "list"
      ? { display: "flex", flexDirection: "column", gap: `${cardGap}px` }
      : { display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: `${cardGap}px` };

  const aspectRatioMap: Record<string, string> = {
    "16:9": "16/9", "4:3": "4/3", "3:2": "3/2", "1:1": "1/1",
  };

  const inputStyle: CSSProperties = {
    padding: "0.5rem 0.75rem",
    border: "1px solid #cbd5e0",
    borderRadius: 6,
    fontSize: "0.875rem",
    background: "#fff",
    outline: "none",
  };

  return (
    <div>
      {listTitle ? <h2 style={{ margin: "0 0 1rem" }}>{listTitle}</h2> : null}
      {hasFilterBar ? (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "0.625rem",
          marginBottom: "1.75rem", alignItems: "center",
          padding: "0.875rem 1rem",
          background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0",
        }}>
          {showSearchBar ? (
            <input
              type="search"
              placeholder="Search posts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, flex: "1 1 180px", minWidth: 140 }}
            />
          ) : null}
          {showCategoryFilter && categories.length > 0 ? (
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : null}
          {showTagFilter && allTags.length > 0 ? (
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">All Tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : null}
          {showAuthorFilter && allAuthors.length > 0 ? (
            <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">All Authors</option>
              {allAuthors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          ) : null}
          {showDateFilter ? (
            <>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From" style={inputStyle} />
              <span style={{ fontSize: "0.75rem", color: "#718096" }}>–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To" style={inputStyle} />
            </>
          ) : null}
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={() => { setSearch(""); setCatFilter(""); setTagFilter(""); setAuthorFilter(""); setDateFrom(""); setDateTo(""); }}
              style={{ ...inputStyle, color: "#718096", cursor: "pointer", background: "#fff" }}
            >
              Clear
            </button>
          ) : null}
          {hasActiveFilter && filteredPosts.length !== allPosts.length ? (
            <span style={{ fontSize: "0.8125rem", color: "#718096", marginLeft: "auto" }}>
              {filteredPosts.length} result{filteredPosts.length !== 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      {visiblePosts.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#888", border: "1px dashed #ccc", borderRadius: 8 }}>
          {allPosts.length === 0
            ? "No published posts yet. Use the Create Post module to add your first post."
            : "No posts match your filters."}
        </div>
      ) : (
        <div style={gridStyle}>
          {visiblePosts.map((post) => {
            const sep = postPageUrl.includes("?") ? "&" : "?";
            const href = postPageUrl ? `${postPageUrl}${sep}post=${encodeURIComponent(post.slug)}` : "#";
            const postCats = categories.filter((c) => post.categoryIds?.includes(c.id));
            const dateStr = post.published_at
              ? new Date(post.published_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
              : "";
            const imageUrl = post.featuredImageUrl || post.featured_image_url;
            const isSideBySide = cardLayout === "side-by-side" || layout === "list";
            const hasFeaturedImageInRows = tplRows.some((r) => r.slots.includes("featured_image"));
            // Full-bleed pulls up over the card's TOP padding only when the
            // image is the first thing in the card. It used to do so
            // unconditionally, which slid the image up over whatever sat above it.
            const firstFilledSlot = tplRows.flatMap((r) => r.slots.slice(0, r.cols)).find(Boolean) ?? null;

            function renderEl(id: CardElementId): React.ReactNode {
              switch (id) {
                case "categories":
                  return postCats.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {postCats.map((c) => (
                        <span key={c.id} style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: accent }}>{c.name}</span>
                      ))}
                    </div>
                  ) : null;
                case "headline":
                  return (
                    <h3 style={{ margin: 0, fontSize: "1.0625rem", lineHeight: 1.3, color: "#1a202c", fontWeight: 700,
                      display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {post.title}
                    </h3>
                  );
                case "featured_image": {
                  if (isSideBySide || !imageUrl) return null;
                  const { frame, img } = featuredImageStyles(tpl, {
                    cardPaddingX: "1.25rem",
                    cardPaddingTop: "1.125rem",
                    topOfCard: firstFilledSlot === "featured_image",
                  });
                  return (
                    <div style={frame}>
                      <img alt={post.title} src={imageUrl} style={img} />
                    </div>
                  );
                }
                case "excerpt":
                  return post.excerpt ? (
                    <p style={{ margin: 0, fontSize: "0.875rem", color: "#4a5568", lineHeight: 1.5 }}>{post.excerpt}</p>
                  ) : null;
                case "author":
                  return post.author ? <span style={{ fontSize: "0.8125rem", color: "#718096" }}>{post.author}</span> : null;
                case "date":
                  return dateStr ? <span style={{ fontSize: "0.8125rem", color: "#a0aec0" }}>{dateStr}</span> : null;
                case "tags":
                  return post.tags?.length ? (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {post.tags.map((tag) => (
                        <span key={tag} style={{ fontSize: "0.65rem", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 3, padding: "1px 6px", color: "#64748b" }}>{tag}</span>
                      ))}
                    </div>
                  ) : null;
                case "read_more":
                  return <a href={href} style={{ color: accent, fontSize: "0.875rem", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>{readMoreLabel} →</a>;
                default:
                  return null;
              }
            }

            return (
              <article key={post.id} style={{ ...cardBorder, borderRadius: cardRadius, overflow: "hidden", background: "#fff", display: "flex", flexDirection: isSideBySide ? sideBySideDirection(tpl) : "column" }}>
                {isSideBySide && imageUrl && hasFeaturedImageInRows ? (
                  <div style={sideStripStyle(tpl)}>
                    <img alt={post.title} src={imageUrl} style={{ width: "100%", height: "100%", objectFit: tpl.imageCrop === "contain" ? "contain" : "cover", display: "block" }} />
                  </div>
                ) : null}
                {/* minWidth 0 is load-bearing: a flex item defaults to
                    min-width:auto, so the text column refuses to shrink below its
                    content and the card overflows sideways once the image strip is
                    wide. Reachable now that the strip's width is an operator control. */}
                <div style={{ padding: "1.125rem 1.25rem", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                  {tplRows.map((row) => {
                    const hasContent = row.slots.some((s) => s && !(isSideBySide && s === "featured_image"));
                    if (!hasContent) return null;
                    return (
                      <div key={row.id} style={row.cols > 1 ? { display: "grid", gridTemplateColumns: `repeat(${row.cols}, 1fr)`, gap: "0.5rem", alignItems: "center" } : {}}>
                        {row.slots.slice(0, row.cols).map((slot, si) => slot ? (
                          <div key={si}>{renderEl(slot)}</div>
                        ) : <div key={si} />)}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BlogPostCreatePreview({ settings }: { settings: Record<string, string> }) {
  const accent = settings.accentColor || "#0f4f8f";
  const showFormTitle = (settings.showFormTitle ?? "true") !== "false";
  const showSlug = (settings.showSlug ?? "true") !== "false";
  const showFeaturedImage = (settings.showFeaturedImage ?? "true") !== "false";
  const showExcerpt = (settings.showExcerpt ?? "true") !== "false";
  const showAuthorField = settings.showAuthorField === "true";
  const showCategories = (settings.showCategories ?? "true") !== "false";
  const showTags = (settings.showTags ?? "true") !== "false";
  const showSeoFields = settings.showSeoFields === "true";
  const submitLabel = settings.submitLabel || "Publish Post";
  const draftLabel = settings.draftLabel || "Save as Draft";
  const successMessage = settings.successMessage || "Post created successfully.";
  const redirectAfterCreate = settings.redirectAfterCreate || "";

  // Edit mode: ?id= in URL means we're editing an existing post
  const editId = new URLSearchParams(window.location.search).get("id") ?? "";
  const isEditMode = Boolean(editId);
  const formTitle = isEditMode
    ? "Edit Post"
    : (settings.formTitle || "Create New Post");

  const [values, setValues] = useState<Record<string, string>>({});
  const [loadingPost, setLoadingPost] = useState(isEditMode);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!editId) return;
    fetch(`/api/blog/posts/${encodeURIComponent(editId)}`, {
      credentials: "include",
      headers: getCrmProjectHeaders()
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.data ?? d?.post ?? null;
        if (p && typeof p === "object") {
          const post = p as Record<string, unknown>;
          setValues({
            title: String(post.title ?? ""),
            slug: String(post.slug ?? ""),
            author: String(post.author ?? ""),
            featuredImageUrl: String(post.featuredImageUrl ?? post.featured_image_url ?? ""),
            excerpt: String(post.excerpt ?? ""),
            body: String(post.body ?? ""),
            tags: Array.isArray(post.tags) ? (post.tags as string[]).join(", ") : String(post.tags ?? ""),
            seoTitle: String(post.seoTitle ?? post.seo_title ?? ""),
            seoDescription: String(post.seoDescription ?? post.seo_description ?? ""),
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPost(false));
  }, [editId]);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function submitPost(status: "published" | "draft") {
    if (!values.title?.trim()) {
      setErrorMsg("Title is required.");
      return;
    }
    setErrorMsg("");
    setStatusMsg("");
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        status,
        tags: values.tags
          ? values.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : []
      };
      const url = isEditMode ? `/api/blog/posts/${encodeURIComponent(editId)}` : "/api/blog/posts";
      const method = isEditMode ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as { error?: { message?: string } | string };
      if (!res.ok) {
        const errMsg =
          typeof data.error === "string"
            ? data.error
            : (data.error as { message?: string } | undefined)?.message || (isEditMode ? "Failed to update post." : "Failed to create post.");
        throw new Error(errMsg);
      }
      setStatusMsg(isEditMode ? "Post updated successfully." : successMessage);
      if (!isEditMode) setValues({});
      if (redirectAfterCreate) {
        setTimeout(() => { window.location.href = redirectAfterCreate; }, 1500);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingPost) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#888" }}>Loading post…</div>;
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: "0.875rem",
    boxSizing: "border-box"
  };
  const labelStyle: CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#374151"
  };
  const fieldStyle: CSSProperties = { marginBottom: "1rem" };

  return (
    <div
      className="builder-blog-post-create-form"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "1.5rem",
        background: "#fff",
        borderRadius: 8,
        border: "1px solid #e5e7eb"
      }}
    >
      {showFormTitle ? <h2 style={{ margin: "0 0 1.5rem", color: "#111827" }}>{formTitle}</h2> : null}

      {statusMsg ? (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 6,
            color: "#166534"
          }}
        >
          {statusMsg}
        </div>
      ) : null}
      {errorMsg ? (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            color: "#991b1b"
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
        <div style={{ flex: 2, minWidth: 0 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Title *</label>
            <input
              style={inputStyle}
              type="text"
              value={values.title || ""}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="Post title"
            />
          </div>

          {showSlug ? (
            <div style={fieldStyle}>
              <label style={labelStyle}>Slug</label>
              <input
                style={inputStyle}
                type="text"
                value={values.slug || ""}
                onChange={(e) => setField("slug", e.target.value)}
                placeholder="post-slug (auto-generated if blank)"
              />
            </div>
          ) : null}

          {showAuthorField ? (
            <div style={fieldStyle}>
              <label style={labelStyle}>Author</label>
              <input
                style={inputStyle}
                type="text"
                value={values.author || ""}
                onChange={(e) => setField("author", e.target.value)}
                placeholder="Author name"
              />
            </div>
          ) : null}

          {showFeaturedImage ? (
            <div style={fieldStyle}>
              <label style={labelStyle}>Featured Image</label>
              <BuilderImagePickerField
                value={values.featuredImageUrl || ""}
                onChange={(url) => setField("featuredImageUrl", url)}
                placeholder="https://…"
              />
            </div>
          ) : null}
        </div>

        {showFeaturedImage ? (
          <div style={{ flex: 1, minWidth: 0, paddingTop: "1.6rem" }}>
            {values.featuredImageUrl ? (
              <img
                alt="Featured image preview"
                src={values.featuredImageUrl}
                style={{
                  width: "100%",
                  aspectRatio: "16 / 9",
                  objectFit: "cover",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  display: "block"
                }}
              />
            ) : (
              <div style={{
                width: "100%",
                aspectRatio: "16 / 9",
                background: "#f3f4f6",
                borderRadius: 6,
                border: "1px dashed #d1d5db",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>No image</span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {showExcerpt ? (
        <div style={fieldStyle}>
          <label style={labelStyle}>Excerpt</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            value={values.excerpt || ""}
            onChange={(e) => setField("excerpt", e.target.value)}
            placeholder="Short summary of the post"
          />
        </div>
      ) : null}

      <div style={fieldStyle}>
        <label style={labelStyle}>Body</label>
        <BuilderRichTextEditor
          value={values.body || ""}
          onChange={(html) => setField("body", html)}
          placeholder="Post content…"
        />
      </div>

      {showCategories ? (
        <div style={fieldStyle}>
          <label style={labelStyle}>Categories (slugs, comma-separated)</label>
          <input
            style={inputStyle}
            type="text"
            value={values.categoryIds || ""}
            onChange={(e) => setField("categoryIds", e.target.value)}
            placeholder="news, announcements"
          />
        </div>
      ) : null}

      {showTags ? (
        <div style={fieldStyle}>
          <label style={labelStyle}>Tags (comma-separated)</label>
          <input
            style={inputStyle}
            type="text"
            value={values.tags || ""}
            onChange={(e) => setField("tags", e.target.value)}
            placeholder="react, tutorial, design"
          />
        </div>
      ) : null}

      {showSeoFields ? (
        <>
          <div style={fieldStyle}>
            <label style={labelStyle}>SEO Title</label>
            <input
              style={inputStyle}
              type="text"
              value={values.seoTitle || ""}
              onChange={(e) => setField("seoTitle", e.target.value)}
              placeholder="SEO title"
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>SEO Description</label>
            <textarea
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
              value={values.seoDescription || ""}
              onChange={(e) => setField("seoDescription", e.target.value)}
              placeholder="Meta description (≤ 160 chars)"
            />
          </div>
        </>
      ) : null}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button
          disabled={submitting}
          onClick={() => submitPost("draft")}
          style={{
            padding: "0.5rem 1.25rem",
            border: `2px solid ${accent}`,
            borderRadius: 6,
            background: "#fff",
            color: accent,
            fontWeight: 600,
            cursor: "pointer"
          }}
          type="button"
        >
          {draftLabel}
        </button>
        <button
          disabled={submitting}
          onClick={() => submitPost("published")}
          style={{
            padding: "0.5rem 1.25rem",
            border: "none",
            borderRadius: 6,
            background: accent,
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer"
          }}
          type="button"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function blogPostFeaturedImageUrl(post: Record<string, unknown>): string {
  return String(
    post.featured_image_url ||
    post.featuredImageUrl ||
    post.featured_image ||
    ""
  ).trim();
}

function blogManagerEditBaseUrl(settings: Record<string, string>): string {
  const fromSettings = String(settings.editPageUrl || "").trim();
  if (fromSettings) return fromSettings;
  if (typeof window === "undefined") return "";
  const pathname = window.location.pathname || "/";
  const params = new URLSearchParams(window.location.search);
  params.delete("id");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function buildBlogPostEditHref(baseUrl: string, postId: string): string {
  if (!baseUrl) return "";
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}id=${encodeURIComponent(postId)}`;
}

function blogManagerViewBaseUrl(settings: Record<string, string>): string {
  const fromSettings = String(settings.viewPageUrl || "").trim();
  if (fromSettings) return fromSettings;
  const postPageUrl = String(settings.postPageUrl || "").trim();
  if (postPageUrl) return postPageUrl;
  return defaultBlogPostViewPath();
}

function BlogPostManagerPreview({ settings }: { settings: Record<string, string> }) {
  const editBaseUrl = useMemo(() => blogManagerEditBaseUrl(settings), [settings.editPageUrl]);
  const viewBaseUrl = useMemo(() => blogManagerViewBaseUrl(settings), [settings.viewPageUrl, settings.postPageUrl]);
  const showStatus = (settings.showStatus ?? "true") !== "false";
  const showDate = (settings.showDate ?? "true") !== "false";
  const showDelete = (settings.showDelete ?? "true") !== "false";

  type PostRow = BlogPostRecord & {
    status?: string;
    created_at?: string;
    createdAt?: string;
    featuredImageUrl?: string;
  };
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  function loadPosts() {
    setLoading(true);
    fetch("/api/blog/posts?limit=50", {
      credentials: "include",
      headers: getCrmProjectHeaders()
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPosts(Array.isArray(d?.posts) ? (d.posts as PostRow[]) : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadPosts(); }, []);

  async function deletePost(id: string) {
    if (!window.confirm("Delete this post?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/blog/posts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: getCrmProjectHeaders()
      });
      if (res.ok) setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch {}
    setDeletingId(null);
  }

  async function clonePost(post: PostRow) {
    if (!window.confirm("Clone this post as a draft?")) return;
    setCloningId(post.id);
    try {
      const res = await fetch(`/api/blog/posts/${encodeURIComponent(post.id)}`, {
        credentials: "include",
        headers: getCrmProjectHeaders()
      });
      if (!res.ok) return;
      const data = (await res.json()) as { data?: Record<string, unknown>; post?: Record<string, unknown> };
      const source = data.data ?? data.post;
      if (!source || typeof source !== "object") return;
      const title = String(source.title || post.title || "Untitled");
      const createRes = await fetch("/api/blog/posts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify({
          title: `Copy of ${title}`,
          slug: "",
          status: "draft",
          author: String(source.author || ""),
          featuredImageUrl: String(source.featuredImageUrl || source.featured_image_url || ""),
          excerpt: String(source.excerpt || ""),
          body: String(source.body || ""),
          seoTitle: String(source.seoTitle || source.seo_title || ""),
          seoDescription: String(source.seoDescription || source.seo_description || ""),
          tags: Array.isArray(source.tags) ? source.tags : [],
          categoryIds: Array.isArray(source.categoryIds) ? source.categoryIds : [],
        })
      });
      if (createRes.ok) loadPosts();
    } catch {}
    setCloningId(null);
  }

  const statusColor = (s?: string) => s === "published" ? "#16a34a" : s === "archived" ? "#9ca3af" : "#d97706";
  const statusBg   = (s?: string) => s === "published" ? "#f0fdf4" : s === "archived" ? "#f9fafb" : "#fffbeb";

  const listHeading = (
    <h3 className="builder-admin-data-table-title">Published Blog Posts</h3>
  );

  if (loading) {
    return (
      <div className="builder-blog-post-manager-module builder-admin-data-table-module">
        {listHeading}
        <div className="builder-blog-post-manager-stub">Loading posts…</div>
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="builder-blog-post-manager-module builder-admin-data-table-module">
        {listHeading}
        <div className="builder-blog-post-manager-stub">
          No posts yet. Use the Create Post module to add your first post.
        </div>
      </div>
    );
  }

  return (
    <div className="builder-blog-post-manager-module builder-admin-data-table-module">
      {listHeading}
      <div className="builder-blog-post-manager-list">
        {posts.map((post) => {
          const editHref = buildBlogPostEditHref(editBaseUrl, post.id);
          const viewSep = viewBaseUrl.includes("?") ? "&" : "?";
          const viewHref = viewBaseUrl
            ? `${viewBaseUrl}${viewSep}post=${encodeURIComponent(post.slug)}`
            : undefined;
          const dateStr = post.published_at ?? post.created_at ?? post.createdAt ?? "";
          const displayDate = dateStr
            ? new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : "—";
          const imageUrl = blogPostFeaturedImageUrl(post as unknown as Record<string, unknown>);
          return (
            <div key={post.id} className="builder-blog-post-manager-item">
              <div className="builder-blog-post-manager-item-thumb">
                {imageUrl ? (
                  <img
                    alt=""
                    className="builder-blog-post-manager-thumb"
                    src={imageUrl}
                  />
                ) : (
                  <span aria-hidden="true" className="builder-blog-post-manager-thumb-placeholder" />
                )}
              </div>
              <div className="builder-blog-post-manager-item-body">
                <div className="builder-blog-post-manager-item-title">{post.title}</div>
                <div className="builder-blog-post-manager-item-meta">
                  {showStatus ? (
                    <span
                      className="builder-blog-post-manager-status"
                      style={{ color: statusColor(post.status), background: statusBg(post.status) }}
                    >
                      {post.status ?? "draft"}
                    </span>
                  ) : null}
                  {showDate ? (
                    <span className="builder-blog-post-manager-date">{displayDate}</span>
                  ) : null}
                </div>
              </div>
              <div className="builder-blog-post-manager-item-actions">
                <div className="table-actions-row" role="group">
                  <AdminTableIconButton
                    icon="view"
                    label="View"
                    href={viewHref}
                    linkTarget="_blank"
                    disabled={!viewHref}
                    onClick={!viewHref ? () => {} : undefined}
                  />
                  <AdminTableIconButton
                    icon="edit"
                    label="Edit"
                    href={editHref || undefined}
                    disabled={!editHref}
                    onClick={!editHref ? () => {} : undefined}
                  />
                  <AdminTableIconButton
                    icon="clone"
                    label="Clone"
                    disabled={cloningId === post.id}
                    onClick={() => clonePost(post)}
                  />
                  {showDelete ? (
                    <AdminTableIconButton
                      icon="delete"
                      label="Delete"
                      danger
                      disabled={deletingId === post.id}
                      onClick={() => deletePost(post.id)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function textToSlug(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function MessagingTopicListPreview({ settings }: { settings: Record<string, string> }) {
  const [topics, setTopics] = useState<Array<{ id: number; topic: string }>>([]);

  useEffect(() => {
    fetch("/api/messaging/topics", { credentials: "include", headers: getCrmProjectHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.topics)) setTopics(d.topics); })
      .catch(() => {});
  }, []);

  const layout = settings.layout || "pills";
  const showAll = settings.showAll !== "false";
  const allLabel = settings.allLabel || "All Topics";
  const activeColor = settings.activeColor || "#0f4f8f";
  const activeBg = settings.activeBg || activeColor;
  const inactiveColor = settings.inactiveColor || "#587592";
  const inactiveBg = settings.inactiveBg || "#f0f4f8";
  const borderRadius = parseInt(settings.borderRadius || "20", 10) || 20;
  const fontSize = parseInt(settings.fontSize || "13", 10) || 13;
  const gap = parseInt(settings.gap || "8", 10) || 8;
  const alignment = settings.alignment || "left";
  const targetPageUrl = (settings.targetPageUrl || "").trim();
  const filterParam = (settings.filterParam || "topic").trim();
  const justifyMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };

  const moduleBorderWidth = parseInt(settings.moduleBorderWidth || "0", 10) || 0;
  const moduleBorderColor = settings.moduleBorderColor || "#000000";
  const wrapperStyle: CSSProperties = moduleBorderWidth > 0
    ? { border: `${moduleBorderWidth}px solid ${moduleBorderColor}` }
    : {};

  const currentParam = new URLSearchParams(window.location.search).get(filterParam) ?? "";

  function makeHref(slug: string) {
    if (!targetPageUrl) return "#";
    const sep = targetPageUrl.includes("?") ? "&" : "?";
    return slug ? `${targetPageUrl}${sep}${filterParam}=${encodeURIComponent(slug)}` : targetPageUrl;
  }

  const items = [
    ...(showAll ? [{ id: 0, topic: allLabel, slug: "" }] : []),
    ...topics.map((t) => ({ id: t.id, topic: t.topic, slug: textToSlug(t.topic) })),
  ];

  if (items.length === 0) {
    return (
      <div style={{ padding: "0.75rem", color: "#94a3b8", fontSize: "0.875rem", fontStyle: "italic" }}>
        No topics found. Add topics in the Messaging section.
      </div>
    );
  }

  function renderContent() {
    if (layout === "dropdown") {
      return (
        <div style={{ textAlign: alignment as "left" | "center" | "right" }}>
          <select
            style={{ padding: "0.5rem 0.75rem", borderRadius: borderRadius / 2, border: "1px solid #d1d5db", fontSize, color: inactiveColor, background: inactiveBg, cursor: "pointer" }}
            onChange={(e) => { window.location.href = makeHref(e.target.value); }}
          >
            {items.map((item) => <option key={item.id} value={item.slug}>{item.topic}</option>)}
          </select>
        </div>
      );
    }

    if (layout === "list") {
      return (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: gap / 2 }}>
          {items.map((item) => {
            const isActive = item.slug === "" ? !currentParam : currentParam === item.slug;
            return (
              <li key={item.id}>
                <a href={makeHref(item.slug)} style={{ fontSize, color: isActive ? activeBg : inactiveColor, fontWeight: isActive ? 700 : 400, textDecoration: "none", display: "block", padding: "0.25rem 0" }}>
                  {item.topic}
                </a>
              </li>
            );
          })}
        </ul>
      );
    }

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap, justifyContent: justifyMap[alignment] || "flex-start" }}>
        {items.map((item) => {
          const isActive = item.slug === "" ? !currentParam : currentParam === item.slug;
          return (
            <a
              key={item.id}
              href={makeHref(item.slug)}
              style={{
                padding: `0.3rem ${borderRadius > 12 ? "0.85rem" : "0.65rem"}`,
                borderRadius,
                background: isActive ? activeBg : inactiveBg,
                color: isActive ? "#fff" : inactiveColor,
                fontSize,
                fontWeight: isActive ? 600 : 400,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              {item.topic}
            </a>
          );
        })}
      </div>
    );
  }

  return <div style={wrapperStyle}>{renderContent()}</div>;
}

function MessagingTagListPreview({ settings }: { settings: Record<string, string> }) {
  const [tags, setTags] = useState<Array<{ id: number; tag: string; importance?: number }>>([]);

  useEffect(() => {
    fetch("/api/messaging/tags", { credentials: "include", headers: getCrmProjectHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.tags)) setTags(d.tags); })
      .catch(() => {});
  }, []);

  const layout = settings.layout || "cloud";
  const activeColor = settings.activeColor || "#0f4f8f";
  const inactiveColor = settings.inactiveColor || "#587592";
  const inactiveBg = settings.inactiveBg || "#f0f4f8";
  const gap = parseInt(settings.gap || "8", 10) || 8;
  const minFs = parseInt(settings.minFontSize || "12", 10) || 12;
  const maxFs = parseInt(settings.maxFontSize || "22", 10) || 22;
  const alignment = settings.alignment || "left";
  const maxTags = parseInt(settings.maxTags || "0", 10) || 0;
  const targetPageUrl = (settings.targetPageUrl || "").trim();
  const filterParam = (settings.filterParam || "tag").trim();
  const destinationType = settings.destinationType || (targetPageUrl ? "custom" : "none");
  const justifyMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };

  const activeFilterParam = destinationType === "blog-search-results" ? "tag"
    : destinationType === "blog-post-list" ? "tag"
    : filterParam;
  const currentParam = new URLSearchParams(window.location.search).get(activeFilterParam) ?? "";

  function makeHref(slug: string) {
    const base = targetPageUrl || (destinationType === "blog-search-results" ? "/blog-search-results"
      : destinationType === "blog-post-list" ? "/blog" : "");
    if (!base || destinationType === "none") return "#";
    const cleanBase = base.split("?")[0];
    const encoded = encodeURIComponent(slug);
    if (destinationType === "blog-search-results" || cleanBase.includes("blog-search-results")) {
      return `${cleanBase}?search=${encoded}&tag=${encoded}`;
    }
    if (destinationType === "blog-post-list") {
      return `${cleanBase}?tag=${encoded}`;
    }
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${filterParam}=${encoded}`;
  }

  if (tags.length === 0) {
    return (
      <div style={{ padding: "0.75rem", color: "#94a3b8", fontSize: "0.875rem", fontStyle: "italic" }}>
        No tags found. Add tags in the Messaging section.
      </div>
    );
  }

  // Sort by importance desc (most important first); fall back to alphabetical within same importance.
  // When maxTags is set, this ensures the N most important tags are displayed.
  const sorted = maxTags > 0
    ? [...tags].sort((a, b) => ((b.importance ?? 0) - (a.importance ?? 0)) || a.tag.localeCompare(b.tag))
    : tags;
  // Assign a pseudo-weight (1–5) by alphabetic hash so the cloud looks varied
  const allWithWeight = sorted.map((t, i) => ({ ...t, slug: textToSlug(t.tag), weight: ((i * 7 + t.tag.length) % 5) + 1 }));
  const withWeight = maxTags > 0 ? allWithWeight.slice(0, maxTags) : allWithWeight;
  const maxWeight = 5;

  if (layout === "list") {
    return (
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: gap / 2 }}>
        {withWeight.map((t) => {
          const isActive = currentParam === t.slug;
          return (
            <li key={t.id}>
              <a href={makeHref(t.slug)} style={{ fontSize: minFs, color: isActive ? activeColor : inactiveColor, fontWeight: isActive ? 700 : 400, textDecoration: "none", display: "block", padding: "0.2rem 0" }}>
                # {t.tag}
              </a>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap, justifyContent: justifyMap[alignment] || "flex-start" }}>
      {withWeight.map((t) => {
        const isActive = currentParam === t.slug;
        const fs = Math.round(minFs + (maxFs - minFs) * (t.weight / maxWeight));
        return (
          <a
            key={t.id}
            href={makeHref(t.slug)}
            style={{
              fontSize: fs,
              color: isActive ? activeColor : inactiveColor,
              fontWeight: isActive ? 700 : 400,
              textDecoration: "none",
              ...(layout === "pills" ? { padding: "0.25rem 0.75rem", borderRadius: 999, background: inactiveBg } : {}),
            }}
          >
            {t.tag}
          </a>
        );
      })}
    </div>
  );
}

type CategoryFormValues = { name: string; slug: string; description: string; color: string; sortOrder: string };

// ── Blog Card Manager ─────────────────────────────────────────────────────────

type CardElementId = "categories" | "headline" | "featured_image" | "excerpt" | "author" | "date" | "tags" | "read_more";
type CardRow = { id: string; cols: 1 | 2 | 3; slots: (CardElementId | null)[] };
type CardTemplate = {
  cardLayout: string;
  imageAspectRatio: string;
  cardStyle: string;
  cardBorderRadius: number;
  readMoreLabel: string;
  accentColor: string;
  // Featured-image controls (2026-09-02, task 86bbt52fa). Mirrored in
  // lib/blogCardTemplateStore.js, which is the server's copy of this shape —
  // add a key in one and it must be added in the other, or the server's
  // mergeTemplate drops it on the next save.
  imageBorderWidth: number;
  imageBorderColor: string;
  imageBorderRadius: number;
  imageShadow: string;
  imageBleed: string;
  imageSide: string;
  imageSideWidth: number;
  imageHeight: number;
  imageCrop: string;
  rows: CardRow[];
};

const CARD_ELEMENT_LABELS: Record<CardElementId, string> = {
  categories:     "Categories",
  headline:       "Headline",
  featured_image: "Featured Image",
  excerpt:        "Excerpt",
  author:         "Author",
  date:           "Date",
  tags:           "Tags",
  read_more:      "Read More",
};

const ALL_CARD_ELEMENTS: CardElementId[] = ["categories", "headline", "featured_image", "excerpt", "author", "date", "tags", "read_more"];

const DEFAULT_CARD_TEMPLATE: CardTemplate = {
  cardLayout: "single",
  imageAspectRatio: "16:9",
  cardStyle: "default",
  cardBorderRadius: 12,
  readMoreLabel: "Read More",
  accentColor: "#0f4f8f",
  // These nine reproduce the rendering that used to be hard-coded into the
  // image element: no border, no shadow, full-bleed to the card edges, on the
  // left at 220px when side-by-side, aspect-ratio height, cover crop.
  imageBorderWidth: 0,
  imageBorderColor: "#e2e8f0",
  imageBorderRadius: 0,
  imageShadow: "none",
  imageBleed: "full",
  imageSide: "left",
  imageSideWidth: 220,
  imageHeight: 0,
  imageCrop: "cover",
  rows: [
    { id: "r1", cols: 1, slots: ["categories"] },
    { id: "r2", cols: 1, slots: ["headline"] },
    { id: "r3", cols: 1, slots: ["featured_image"] },
    { id: "r4", cols: 1, slots: ["excerpt"] },
    { id: "r5", cols: 3, slots: ["author", "date", "read_more"] },
  ],
};

const IMAGE_SHADOWS = ["none", "soft", "medium", "strong"];
const IMAGE_BLEEDS  = ["full", "inset"];
const IMAGE_SIDES   = ["left", "right", "top"];
const IMAGE_CROPS   = ["cover", "contain"];

const IMAGE_SHADOW_CSS: Record<string, string> = {
  none:   "none",
  soft:   "0 2px 8px rgba(0,0,0,0.10)",
  medium: "0 6px 18px rgba(0,0,0,0.16)",
  strong: "0 12px 32px rgba(0,0,0,0.24)",
};

const CARD_ASPECT_RATIOS: Record<string, string> = { "16:9": "16/9", "4:3": "4/3", "3:2": "3/2", "1:1": "1/1" };

function cardNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cardOneOf(value: unknown, allowed: string[], fallback: string): string {
  const v = String(value ?? "");
  return allowed.includes(v) ? v : fallback;
}

/**
 * The featured image's frame and photo styles, derived once from the card
 * template and used by BOTH the Card Manager's Live Preview and the published
 * post list. They are one function on purpose: an acceptance criterion of task
 * 86bbt52fa is that the two agree, and two copies of this arithmetic is exactly
 * how they would stop agreeing.
 *
 * `cardPadding` is the card's own horizontal padding, which differs between the
 * two surfaces (1.25rem live, 1.25rem preview) — full-bleed cancels it with a
 * negative margin, inset leaves it alone.
 */
function featuredImageStyles(
  tpl: CardTemplate,
  opts: { cardPaddingX: string; cardPaddingTop: string; topOfCard: boolean }
): { frame: CSSProperties; img: CSSProperties } {
  const bleed = tpl.imageBleed === "inset" ? false : true;
  const border = tpl.imageBorderWidth > 0
    ? `${tpl.imageBorderWidth}px solid ${tpl.imageBorderColor}`
    : undefined;

  const frame: CSSProperties = {
    overflow: "hidden",
    border,
    borderRadius: tpl.imageBorderRadius || undefined,
    boxShadow: IMAGE_SHADOW_CSS[tpl.imageShadow] === "none" ? undefined : IMAGE_SHADOW_CSS[tpl.imageShadow],
    // A fixed height wins over the aspect ratio when one is set; height 0 means
    // "no fixed height", which is how an untouched template keeps its 16:9.
    ...(tpl.imageHeight > 0
      ? { height: tpl.imageHeight }
      : { aspectRatio: CARD_ASPECT_RATIOS[tpl.imageAspectRatio] ?? "16/9" }),
  };

  if (bleed) {
    // Full-bleed: pull out past the card's padding on both sides, and up over
    // the top padding when the image is the card's first element.
    frame.width = `calc(100% + ${opts.cardPaddingX} + ${opts.cardPaddingX})`;
    frame.marginLeft = `-${opts.cardPaddingX}`;
    if (opts.topOfCard) frame.marginTop = `-${opts.cardPaddingTop}`;
  } else {
    frame.width = "100%";
  }

  const img: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: tpl.imageCrop === "contain" ? "contain" : "cover",
    display: "block",
  };

  return { frame, img };
}

/**
 * The side strip in Side-by-side layout. `imageSide: "top"` means the card
 * stacks instead — the caller reads that off `sideBySideDirection`.
 */
function sideBySideDirection(tpl: CardTemplate): "row" | "row-reverse" | "column" {
  if (tpl.imageSide === "top") return "column";
  return tpl.imageSide === "right" ? "row-reverse" : "row";
}

/**
 * The image strip in Side-by-side layout: a fixed-width column beside the text,
 * or a full-width band above it when the operator picks "top".
 */
function sideStripStyle(tpl: CardTemplate): CSSProperties {
  const shadow = IMAGE_SHADOW_CSS[tpl.imageShadow];
  const base: CSSProperties = {
    flexShrink: 0,
    overflow: "hidden",
    border: tpl.imageBorderWidth > 0 ? `${tpl.imageBorderWidth}px solid ${tpl.imageBorderColor}` : undefined,
    borderRadius: tpl.imageBorderRadius || undefined,
    boxShadow: shadow === "none" ? undefined : shadow,
    // Inset gives the strip breathing room inside the card; full-bleed keeps it
    // flush to the card edge, which is how it rendered before these controls.
    margin: tpl.imageBleed === "inset" ? "0.75rem" : undefined,
  };
  if (tpl.imageSide === "top") {
    return {
      ...base,
      width: "auto",
      ...(tpl.imageHeight > 0
        ? { height: tpl.imageHeight }
        : { aspectRatio: CARD_ASPECT_RATIOS[tpl.imageAspectRatio] ?? "16/9" }),
    };
  }
  return { ...base, width: tpl.imageSideWidth };
}

function migrateTemplate(raw: unknown): CardTemplate {
  if (!raw || typeof raw !== "object") return DEFAULT_CARD_TEMPLATE;
  const d = raw as Record<string, unknown>;
  let rows: CardRow[];
  if (Array.isArray(d.rows) && d.rows.length > 0) {
    rows = d.rows as CardRow[];
  } else if (Array.isArray(d.elements)) {
    // Backward compat: convert old elements[] to rows[]
    const metaIds: CardElementId[] = ["author", "date", "tags", "read_more"];
    const newRows: CardRow[] = [];
    const metaSlots: CardElementId[] = [];
    let n = 0;
    for (const el of d.elements as Array<{ id: CardElementId; enabled: boolean }>) {
      if (!el.enabled) continue;
      if (metaIds.includes(el.id)) { if (metaSlots.length < 3) metaSlots.push(el.id); }
      else newRows.push({ id: `r${++n}`, cols: 1, slots: [el.id] });
    }
    if (metaSlots.length) newRows.push({ id: "rmeta", cols: metaSlots.length as 1 | 2 | 3, slots: metaSlots });
    rows = newRows.length ? newRows : DEFAULT_CARD_TEMPLATE.rows;
  } else {
    rows = DEFAULT_CARD_TEMPLATE.rows;
  }
  return {
    cardLayout:       String(d.cardLayout       || DEFAULT_CARD_TEMPLATE.cardLayout),
    imageAspectRatio: String(d.imageAspectRatio || DEFAULT_CARD_TEMPLATE.imageAspectRatio),
    cardStyle:        String(d.cardStyle        || DEFAULT_CARD_TEMPLATE.cardStyle),
    cardBorderRadius: Number(d.cardBorderRadius ?? DEFAULT_CARD_TEMPLATE.cardBorderRadius),
    readMoreLabel:    String(d.readMoreLabel     || DEFAULT_CARD_TEMPLATE.readMoreLabel),
    accentColor:      String(d.accentColor       || DEFAULT_CARD_TEMPLATE.accentColor),
    imageBorderWidth:  cardNum(d.imageBorderWidth,  0, 16,  DEFAULT_CARD_TEMPLATE.imageBorderWidth),
    imageBorderColor:  String(d.imageBorderColor  || DEFAULT_CARD_TEMPLATE.imageBorderColor),
    imageBorderRadius: cardNum(d.imageBorderRadius, 0, 48,  DEFAULT_CARD_TEMPLATE.imageBorderRadius),
    imageShadow:       cardOneOf(d.imageShadow, IMAGE_SHADOWS, DEFAULT_CARD_TEMPLATE.imageShadow),
    imageBleed:        cardOneOf(d.imageBleed,  IMAGE_BLEEDS,  DEFAULT_CARD_TEMPLATE.imageBleed),
    imageSide:         cardOneOf(d.imageSide,   IMAGE_SIDES,   DEFAULT_CARD_TEMPLATE.imageSide),
    imageSideWidth:    cardNum(d.imageSideWidth,   80, 600, DEFAULT_CARD_TEMPLATE.imageSideWidth),
    imageHeight:       cardNum(d.imageHeight,       0, 800, DEFAULT_CARD_TEMPLATE.imageHeight),
    imageCrop:         cardOneOf(d.imageCrop,   IMAGE_CROPS,   DEFAULT_CARD_TEMPLATE.imageCrop),
    rows,
  };
}

function renderSampleElement(id: CardElementId, accentColor: string, readMoreLabel: string, tpl: CardTemplate, isSideBySide: boolean, isTopOfCard: boolean): React.ReactNode {
  const sampleImageUrl = "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=70";
  switch (id) {
    case "categories":
      return <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accentColor }}>Technology</span>;
    case "headline":
      return <span style={{ fontSize: "0.95rem", lineHeight: 1.3, color: "#1a202c", fontWeight: 700, display: "block" }}>Sample Blog Post Title</span>;
    case "featured_image": {
      if (isSideBySide) return null;
      const { frame, img } = featuredImageStyles(tpl, {
        cardPaddingX: "1.25rem",
        cardPaddingTop: "1rem",
        topOfCard: isTopOfCard,
      });
      return (
        <div style={frame}>
          <img alt="" src={sampleImageUrl} style={img} />
        </div>
      );
    }
    case "excerpt":
      return <span style={{ fontSize: "0.78rem", color: "#4a5568", lineHeight: 1.5, display: "block" }}>A brief excerpt giving readers a preview of the content inside this post.</span>;
    case "author":
      return <span style={{ fontSize: "0.72rem", color: "#718096" }}>Jane Smith</span>;
    case "date":
      return <span style={{ fontSize: "0.72rem", color: "#a0aec0" }}>Jun 15, 2026</span>;
    case "tags":
      return (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.62rem", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 3, padding: "1px 6px", color: "#64748b" }}>design</span>
          <span style={{ fontSize: "0.62rem", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 3, padding: "1px 6px", color: "#64748b" }}>ux</span>
        </div>
      );
    case "read_more":
      return <a href="#" style={{ color: accentColor, fontSize: "0.78rem", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>{readMoreLabel} →</a>;
    default:
      return null;
  }
}

function renderCardPreview(tpl: CardTemplate) {
  const { cardLayout, cardStyle, cardBorderRadius, readMoreLabel, accentColor, rows } = tpl;
  const cardBorder: CSSProperties =
    cardStyle === "bordered" ? { border: `1px solid ${accentColor}40`, boxShadow: "none" }
    : cardStyle === "shadow"  ? { border: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }
    : { border: "1px solid #e2e8f0", boxShadow: "none" };
  const isSideBySide = cardLayout === "side-by-side";
  const hasFeaturedImage = rows.some((r) => r.slots.includes("featured_image"));
  const firstFilledSlot = rows.flatMap((r) => r.slots.slice(0, r.cols)).find(Boolean) ?? null;
  const sampleImageUrl = "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=70";

  return (
    <article style={{ ...cardBorder, borderRadius: cardBorderRadius, overflow: "hidden", background: "#fff", display: "flex", flexDirection: isSideBySide ? sideBySideDirection(tpl) : "column", maxWidth: 340 }}>
      {isSideBySide && hasFeaturedImage ? (
        // The preview card is 340px wide against a full-width real one, so the
        // strip is shown at half its configured width — the proportion is what
        // the operator is judging here, not the pixel count.
        <div style={{ ...sideStripStyle(tpl), ...(tpl.imageSide === "top" ? {} : { width: Math.round(tpl.imageSideWidth / 2) }) }}>
          <img alt="" src={sampleImageUrl} style={{ width: "100%", height: "100%", objectFit: tpl.imageCrop === "contain" ? "contain" : "cover", display: "block" }} />
        </div>
      ) : null}
      <div style={{ padding: "1rem 1.25rem", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {rows.map((row) => {
          const filledSlots = row.slots.filter(Boolean);
          if (filledSlots.length === 0) return null;
          return (
            <div key={row.id} style={row.cols > 1 ? { display: "grid", gridTemplateColumns: `repeat(${row.cols}, 1fr)`, gap: "0.5rem", alignItems: "center" } : {}}>
              {row.slots.map((slot, si) => slot ? (
                <div key={si}>{renderSampleElement(slot, accentColor, readMoreLabel, tpl, isSideBySide, slot === firstFilledSlot)}</div>
              ) : <div key={si} />)}
            </div>
          );
        })}
      </div>
    </article>
  );
}

/**
 * Exported since 2026-09-02 (task 86bbt62dy) so the Builder's module card can
 * render the real designer where the operator opens the module. Until then it
 * rendered only through the public renderer, and the one page carrying this
 * module was unpublished — so the fifteen controls task 86bbt52fa added had no
 * route to them at all, while the module's own note claimed there was one.
 */
export function BlogCardManagerPreview() {
  const [tpl, setTpl] = useState<CardTemplate>(DEFAULT_CARD_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const jsonHeaders = { ...getCrmProjectHeaders(), "Content-Type": "application/json" };

  useEffect(() => {
    fetch("/api/blog/card-template", { credentials: "include", headers: getCrmProjectHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTpl(migrateTemplate(d.template ?? d)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setField<K extends keyof CardTemplate>(key: K, value: CardTemplate[K]) {
    setTpl((prev) => ({ ...prev, [key]: value }));
    setSavedMsg("");
  }

  function addRow() {
    setTpl((prev) => ({
      ...prev,
      rows: [...prev.rows, { id: `r${Date.now()}`, cols: 1, slots: [null] }],
    }));
    setSavedMsg("");
  }

  function removeRow(idx: number) {
    setTpl((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }));
    setSavedMsg("");
  }

  function moveRow(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    setTpl((prev) => {
      const rows = [...prev.rows];
      [rows[idx], rows[next]] = [rows[next], rows[idx]];
      return { ...prev, rows };
    });
    setSavedMsg("");
  }

  function setRowCols(idx: number, cols: 1 | 2 | 3) {
    setTpl((prev) => {
      const rows = prev.rows.map((row, i) => {
        if (i !== idx) return row;
        const slots = [...row.slots];
        while (slots.length < cols) slots.push(null);
        return { ...row, cols, slots: slots.slice(0, cols) };
      });
      return { ...prev, rows };
    });
    setSavedMsg("");
  }

  function setSlot(rowIdx: number, slotIdx: number, value: string) {
    setTpl((prev) => {
      const rows = prev.rows.map((row, i) => {
        if (i !== rowIdx) return row;
        const slots = [...row.slots] as (CardElementId | null)[];
        slots[slotIdx] = value ? (value as CardElementId) : null;
        return { ...row, slots };
      });
      return { ...prev, rows };
    });
    setSavedMsg("");
  }

  async function save() {
    setSaving(true);
    setSavedMsg("");
    try {
      const r = await fetch("/api/blog/card-template", { method: "PUT", credentials: "include", headers: jsonHeaders, body: JSON.stringify(tpl) });
      setSavedMsg(r.ok ? "Saved" : "Error saving");
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="builder-blog-card-manager-module"><div className="builder-blog-post-manager-stub">Loading card template…</div></div>;
  }

  const sel: CSSProperties = { padding: "4px 8px", border: "1px solid #cbd5e0", borderRadius: 5, fontSize: "0.8rem", background: "#fff", width: "100%" };
  // The image-position and image-width controls only do anything in
  // Side-by-side. They are disabled rather than hidden, so the operator can see
  // the setting exists and why it is not available (the title says which layout).
  const isSideBySide = tpl.cardLayout === "side-by-side";

  return (
    <div className="builder-blog-card-manager-module builder-admin-data-table-module">
      <h3 className="builder-admin-data-table-title">Blog Card Template Manager</h3>

      {/*
        Grouped to the Content / Structure / Frame axes every other module's
        settings use (2026-09-02, task 86bbt52fa). It was one undifferentiated
        strip of six controls; adding nine more image controls to that strip
        would have made it unreadable, and the operator could not find a control
        by reasoning about what kind of thing it was.
      */}
      <div className="bcm-controls-bar">

        <fieldset className="bcm-group">
          <legend className="bcm-group-title">Content</legend>
          <div className="bcm-group-controls">
            <div className="bcm-control">
              <span className="bcm-label">Read More</span>
              <input type="text" style={{ ...sel, width: 110 }} value={tpl.readMoreLabel} onChange={(e) => setField("readMoreLabel", e.target.value)} placeholder="Read More" />
            </div>
            <label className="bcm-control">
              <span className="bcm-label">Accent</span>
              <input type="color" className="builder-color-wheel-input builder-color-wheel-input-sm" title="Open the color picker" value={tpl.accentColor} onChange={(e) => setField("accentColor", e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="bcm-group">
          <legend className="bcm-group-title">Structure</legend>
          <div className="bcm-group-controls">
            <div className="bcm-control">
              <span className="bcm-label">Layout</span>
              <div className="bcm-btn-group">
                {(["single", "side-by-side"] as const).map((v) => (
                  <button key={v} type="button" className={`bcm-toggle-btn${tpl.cardLayout === v ? " is-on" : ""}`} onClick={() => setField("cardLayout", v)}>
                    {v === "single" ? "Single" : "Side-by-side"}
                  </button>
                ))}
              </div>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Image Position</span>
              <select style={sel} value={tpl.imageSide} onChange={(e) => setField("imageSide", e.target.value)} disabled={!isSideBySide}
                title={isSideBySide ? undefined : "Side-by-side layout only"}>
                <option value="left">Left of text</option>
                <option value="right">Right of text</option>
                <option value="top">Above text</option>
              </select>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Image Width</span>
              <div className="bcm-num-row">
                <input type="number" min={80} max={600} step={10} style={{ ...sel, width: 64 }}
                  value={tpl.imageSideWidth} disabled={!isSideBySide || tpl.imageSide === "top"}
                  title={isSideBySide && tpl.imageSide !== "top" ? undefined : "Side-by-side layout, image left or right"}
                  onChange={(e) => setField("imageSideWidth", parseInt(e.target.value, 10) || 220)} />
                <span className="bcm-unit">px</span>
              </div>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Image Edge</span>
              <select style={sel} value={tpl.imageBleed} onChange={(e) => setField("imageBleed", e.target.value)}>
                <option value="full">Full bleed</option>
                <option value="inset">Inset</option>
              </select>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Aspect</span>
              <select style={sel} value={tpl.imageAspectRatio} onChange={(e) => setField("imageAspectRatio", e.target.value)}
                disabled={tpl.imageHeight > 0} title={tpl.imageHeight > 0 ? "A fixed height is set, which overrides the aspect ratio" : undefined}>
                <option value="16:9">16:9</option>
                <option value="4:3">4:3</option>
                <option value="3:2">3:2</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Fixed Height</span>
              <div className="bcm-num-row">
                <input type="number" min={0} max={800} step={10} style={{ ...sel, width: 64 }}
                  value={tpl.imageHeight} title="0 keeps the aspect ratio above"
                  onChange={(e) => setField("imageHeight", parseInt(e.target.value, 10) || 0)} />
                <span className="bcm-unit">{tpl.imageHeight > 0 ? "px" : "auto"}</span>
              </div>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Crop</span>
              <select style={sel} value={tpl.imageCrop} onChange={(e) => setField("imageCrop", e.target.value)}>
                <option value="cover">Fill frame</option>
                <option value="contain">Fit whole photo</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="bcm-group">
          <legend className="bcm-group-title">Frame</legend>
          <div className="bcm-group-controls">
            <div className="bcm-control">
              <span className="bcm-label">Card Style</span>
              <select style={sel} value={tpl.cardStyle} onChange={(e) => setField("cardStyle", e.target.value)}>
                <option value="default">Default</option>
                <option value="bordered">Bordered</option>
                <option value="shadow">Shadow</option>
              </select>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Card Radius</span>
              <div className="bcm-num-row">
                <input type="number" min={0} max={32} step={2} style={{ ...sel, width: 56 }}
                  value={tpl.cardBorderRadius} onChange={(e) => setField("cardBorderRadius", parseInt(e.target.value, 10) || 0)} />
                <span className="bcm-unit">px</span>
              </div>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Image Border</span>
              <div className="bcm-num-row">
                <input type="number" min={0} max={16} step={1} style={{ ...sel, width: 56 }}
                  value={tpl.imageBorderWidth} onChange={(e) => setField("imageBorderWidth", parseInt(e.target.value, 10) || 0)} />
                <span className="bcm-unit">px</span>
              </div>
            </div>
            <label className="bcm-control">
              <span className="bcm-label">Border Color</span>
              <input type="color" className="builder-color-wheel-input builder-color-wheel-input-sm" title="Open the color picker"
                value={tpl.imageBorderColor} onChange={(e) => setField("imageBorderColor", e.target.value)} />
            </label>
            <div className="bcm-control">
              <span className="bcm-label">Image Radius</span>
              <div className="bcm-num-row">
                <input type="number" min={0} max={48} step={2} style={{ ...sel, width: 56 }}
                  value={tpl.imageBorderRadius} onChange={(e) => setField("imageBorderRadius", parseInt(e.target.value, 10) || 0)} />
                <span className="bcm-unit">px</span>
              </div>
            </div>
            <div className="bcm-control">
              <span className="bcm-label">Image Shadow</span>
              <select style={sel} value={tpl.imageShadow} onChange={(e) => setField("imageShadow", e.target.value)}>
                <option value="none">None</option>
                <option value="soft">Soft</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
              </select>
            </div>
          </div>
        </fieldset>

      </div>

      {/* ── Two-column: row editor + live preview ── */}
      <div className="bcm-body">

        <div className="bcm-rows-panel">
          <div className="bcm-panel-header">Card Rows</div>
          <div className="bcm-panel-hint">Each row is 1–3 equal-width columns. Assign an element to each slot.</div>

          <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {tpl.rows.map((row, idx) => (
              <li key={row.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "nowrap", gap: 6, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
                {/* ▲▼ */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button type="button" className="bcm-arrow-btn" disabled={idx === 0} onClick={() => moveRow(idx, -1)} aria-label="Move row up">▲</button>
                  <button type="button" className="bcm-arrow-btn" disabled={idx === tpl.rows.length - 1} onClick={() => moveRow(idx, 1)} aria-label="Move row down">▼</button>
                </div>
                {/* 1 2 3 col selector */}
                <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#64748b", whiteSpace: "nowrap", flexShrink: 0 }}>Cols:</span>
                <div className="bcm-btn-group" style={{ flexShrink: 0 }}>
                  {([1, 2, 3] as const).map((n) => (
                    <button key={n} type="button" className={`bcm-col-btn${row.cols === n ? " is-on" : ""}`} onClick={() => setRowCols(idx, n)}>{n}</button>
                  ))}
                </div>
                {/* Always 3 slot selects — disabled if beyond active col count */}
                {([0, 1, 2] as const).map((si) => {
                  const active = si < row.cols;
                  return (
                    <select
                      key={si}
                      style={{ flex: 1, minWidth: 0, padding: "3px 4px", border: "1px solid #cbd5e0", borderRadius: 4, fontSize: "0.76rem", background: active ? "#fff" : "#f1f5f9", color: active ? "#1a202c" : "#94a3b8", cursor: active ? "pointer" : "default" }}
                      value={row.slots[si] ?? ""}
                      disabled={!active}
                      onChange={(e) => setSlot(idx, si, e.target.value)}
                    >
                      <option value="">{active ? "(empty)" : "—"}</option>
                      {active && ALL_CARD_ELEMENTS.map((id) => (
                        <option key={id} value={id}>{CARD_ELEMENT_LABELS[id]}</option>
                      ))}
                    </select>
                  );
                })}
                {/* Trash */}
                <button type="button" className="bcm-delete-icon-btn" style={{ flexShrink: 0 }} onClick={() => removeRow(idx)} aria-label="Delete row">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                    <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                  </svg>
                </button>
              </li>
            ))}
          </ul>

          <button type="button" className="bcm-add-row-btn" onClick={addRow}>+ Add Row</button>
        </div>

        <div className="bcm-preview-panel">
          <div className="bcm-panel-header">Live Preview</div>
          <div className="bcm-preview-body">
            {renderCardPreview(tpl)}
          </div>
        </div>

      </div>

      {/* ── Save bar ── */}
      <div className="bcm-save-bar">
        <button type="button" className="bcm-save-btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Card Template"}
        </button>
        {savedMsg ? (
          <span className={`bcm-save-msg${savedMsg === "Saved" ? " is-ok" : " is-err"}`}>
            {savedMsg === "Saved" ? "✓ Saved" : savedMsg}
          </span>
        ) : null}
        <span className="bcm-save-note">Applies to all Post Feed modules on your site</span>
      </div>
    </div>
  );
}

/* ── Event Detail (public) ─────────────────────────────────────────────────
 *
 * One event's own page. It reads `?event=<slug>` from the URL — the same link
 * the calendar and the manager build — and asks
 * `/api/events/<slug>?by=slug`, which is public for a PUBLISHED event only:
 * routes/events.js 404s a draft to a visitor with no session.
 */

type DetailEvent = {
  id: string;
  title: string;
  slug: string;
  status: string;
  description: string;
  excerpt: string;
  imageUrl: string;
  imageAlt: string;
  url: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  timezone: string;
  locationName: string;
  locationAddress: string;
  locationUrl: string;
  organizerName: string;
  organizerContact: string;
  seoTitle: string;
  seoDescription: string;
};

/**
 * A contact as something to act on: an email becomes mailto:, a phone number
 * tel:, anything else stays plain text. Guessing wrong is worse than not
 * linking — a dead mailto: on a phone number is a link that goes nowhere.
 */
function organizerContactHref(contact: string): string | undefined {
  const text = contact.trim();
  if (!text) return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`;
  const digits = text.replace(/[\s().-]/g, "");
  if (/^\+?\d{7,15}$/.test(digits)) return `tel:${digits}`;
  return undefined;
}

function EventDetailPreview({
  settings,
  theme,
  themePalette,
}: {
  settings: Record<string, string>;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const accent = settings.accentColor || "#0f4f8f";
  const backLinkUrl = (settings.backLinkUrl || "").trim();
  const backLinkLabel = (settings.backLinkLabel || "").trim() || "Back to all events";
  const ctaLabel = (settings.ctaLabel || "").trim() || "Get Tickets";
  const showImage = (settings.showImage ?? "true") !== "false";
  const showLocation = (settings.showLocation ?? "true") !== "false";
  const showDescription = (settings.showDescription ?? "true") !== "false";
  const showOrganizer = (settings.showOrganizer ?? "true") !== "false";
  const notFoundMessage = (settings.notFoundMessage || "").trim()
    || "We could not find that event. It may have been removed.";

  const [slug, setSlug] = useState("");
  const [event, setEvent] = useState<DetailEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // The slug comes from the URL and can change under a single-page navigation,
  // so popstate is listened for rather than read once at mount.
  useEffect(() => {
    function syncSlugFromUrl() {
      setSlug(new URLSearchParams(window.location.search).get("event") ?? "");
    }
    syncSlugFromUrl();
    window.addEventListener("popstate", syncSlugFromUrl);
    return () => window.removeEventListener("popstate", syncSlugFromUrl);
  }, []);

  useEffect(() => {
    if (!slug) {
      setEvent(null);
      setNotFound(false);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/events/${encodeURIComponent(slug)}?by=slug`, {
      credentials: "include",
      headers: getCrmProjectHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const raw = d?.event ?? d?.data ?? null;
        if (!raw || typeof raw !== "object") { setEvent(null); setNotFound(true); return; }
        setEvent(raw as DetailEvent);
      })
      .catch(() => { if (live) { setEvent(null); setNotFound(true); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [slug]);

  /*
   * The event's own SEO fields, applied to the page that is showing it.
   *
   * Without this the SEO Title and SEO Description an operator fills in on
   * every event render nowhere at all — fields that look like they work and
   * do nothing (Standard 13). The previous title is restored on the way out,
   * so browsing away from an event does not leave its name in the tab.
   */
  useEffect(() => {
    if (!event) return;
    const previousTitle = document.title;
    const heading = event.seoTitle?.trim() || event.title?.trim();
    if (heading) document.title = heading;

    const description = event.seoDescription?.trim() || event.excerpt?.trim();
    let meta = document.querySelector('meta[name="description"]');
    const ownsMeta = !meta && Boolean(description);
    let previousDescription: string | null = null;
    if (description) {
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "description");
        document.head.appendChild(meta);
      } else {
        previousDescription = meta.getAttribute("content");
      }
      meta.setAttribute("content", description);
    }

    return () => {
      document.title = previousTitle;
      if (ownsMeta && meta?.parentNode) meta.parentNode.removeChild(meta);
      else if (meta && previousDescription !== null) meta.setAttribute("content", previousDescription);
    };
  }, [event]);

  const frameStyle = {
    ["--evt-accent" as string]: accent,
    ...getAdminDataTableThemeStyle(themePalette, theme),
  };

  const backLink = backLinkUrl ? (
    <a className="builder-event-detail-back" href={backLinkUrl}>← {backLinkLabel}</a>
  ) : null;

  // No slug at all: the page has been opened directly rather than through a
  // calendar link. Said plainly, because a blank panel here reads as broken.
  if (!slug) {
    return (
      <div className="builder-event-detail" style={frameStyle}>
        <p className="builder-event-detail-note">
          This page shows a single event. Open it from the calendar, or add
          <code> ?event=your-event-slug </code> to the address.
        </p>
        {backLink}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="builder-event-detail" style={frameStyle}>
        <p className="builder-event-detail-note">Loading event…</p>
      </div>
    );
  }

  if (notFound || !event) {
    return (
      <div className="builder-event-detail" style={frameStyle}>
        <p className="builder-event-detail-note">{notFoundMessage}</p>
        {backLink}
      </div>
    );
  }

  const cancelled = normalizeEventStatus(event.status) === "cancelled";
  const imageUrl = showImage ? resolvePublicBuilderAssetUrl(event.imageUrl) : "";
  const contactHref = organizerContactHref(event.organizerContact || "");
  const hasLocation = showLocation && Boolean(event.locationName || event.locationAddress);
  const descriptionHtml = showDescription ? formatRichTextContent(event.description) : "";

  return (
    <article className="builder-event-detail" style={frameStyle}>
      {backLink}

      {/*
        * The whole reason `cancelled` exists as a status rather than a delete:
        * an event people have already put in their diary keeps its page and
        * says, at the top, that it is off. Deleting it makes them turn up.
        */}
      {cancelled ? (
        <p className="builder-event-detail-cancelled" role="status">
          <strong>This event has been cancelled.</strong>
        </p>
      ) : null}

      <h1 className="builder-event-detail-title">{event.title || "Untitled event"}</h1>

      <p className="builder-event-detail-when">
        {formatEventWhen(event)}
        {event.timezone ? (
          <span className="builder-event-detail-timezone"> ({event.timezone.replace(/_/g, " ")})</span>
        ) : null}
      </p>

      {hasLocation ? (
        <p className="builder-event-detail-where">
          {event.locationUrl ? (
            <a href={event.locationUrl} target="_blank" rel="noopener noreferrer">
              {event.locationName || event.locationAddress}
            </a>
          ) : (
            <span>{event.locationName}</span>
          )}
          {event.locationName && event.locationAddress ? (
            <span className="builder-event-detail-address">{event.locationAddress}</span>
          ) : null}
        </p>
      ) : null}

      {imageUrl ? (
        <img
          className="builder-event-detail-image"
          src={imageUrl}
          alt={event.imageAlt || ""}
        />
      ) : null}

      {/* Sanitized by formatRichTextContent (Standard 9) — never raw. */}
      {descriptionHtml ? (
        <div
          className="builder-event-detail-body"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      ) : event.excerpt ? (
        <p className="builder-event-detail-body">{event.excerpt}</p>
      ) : null}

      {/* A cancelled event keeps its page, but never its "buy a ticket" button. */}
      {event.url && !cancelled ? (
        <p className="builder-event-detail-cta-row">
          <a
            className="builder-event-detail-cta"
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ctaLabel}
          </a>
        </p>
      ) : null}

      {showOrganizer && (event.organizerName || event.organizerContact) ? (
        <p className="builder-event-detail-organizer">
          {event.organizerName ? <span>Organised by {event.organizerName}</span> : null}
          {event.organizerContact ? (
            contactHref
              ? <a href={contactHref}>{event.organizerContact}</a>
              : <span>{event.organizerContact}</span>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

/* ── Event Calendar (public) ───────────────────────────────────────────────
 *
 * What a visitor sees. Three layouts over one fetch: a month grid, an
 * upcoming list, and a row of cards.
 *
 * It reads `/api/events?status=published`, which is public on a tenant site
 * (lib/projectAdminApiAuth.js) — deliberately the published-only opening,
 * so a draft is unreachable here even by asking for it.
 */

type CalendarEvent = {
  id: string;
  title: string;
  slug: string;
  status: string;
  excerpt: string;
  imageUrl: string;
  imageAlt: string;
  url: string;
  featured: boolean;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  locationName: string;
};

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function EventCalendarPreview({
  settings,
  theme,
  themePalette,
}: {
  settings: Record<string, string>;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const accent = settings.accentColor || "#0f4f8f";
  const layout = settings.layout || "month";
  const heading = (settings.calendarTitle || "").trim();
  const eventPageUrl = (settings.eventPageUrl || "").trim();
  const columns = Math.min(4, Math.max(1, parseInt(settings.columns || "3", 10) || 3));
  const limit = Math.min(50, Math.max(1, parseInt(settings.limit || "12", 10) || 12));
  const weekStartsOn: 0 | 1 = settings.weekStartsOn === "1" ? 1 : 0;
  const showPast = settings.showPast === "true";
  const showImages = (settings.showImages ?? "true") !== "false";
  const showLocation = (settings.showLocation ?? "true") !== "false";
  const showExcerpt = (settings.showExcerpt ?? "true") !== "false";
  const emptyMessage = (settings.emptyMessage || "").trim()
    || "No events scheduled just yet — check back soon.";

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // The month on view. Held in state so Prev/Next can move it; seeded to the
  // month we are actually in.
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    let live = true;
    fetch("/api/events?status=published&limit=200", {
      credentials: "include",
      headers: getCrmProjectHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const list = (d?.events ?? d?.data ?? []) as CalendarEvent[];
        if (!Array.isArray(list)) { setFailed(true); return; }
        setEvents(list);
      })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  /** A published event only. The API filters too; this is the belt to its braces. */
  const published = useMemo(
    () => events.filter((e) => normalizeEventStatus(e.status) === "published"),
    [events]
  );

  const listed = useMemo(() => {
    const now = new Date();
    const chosen = showPast ? published : published.filter((e) => isUpcomingEvent(e, now));
    return [...chosen]
      .sort((a, b) => {
        // Unscheduled events have nowhere to sit on a timeline, so they go
        // last rather than to 1970 — which is where a plain Date.parse of an
        // empty string would put them.
        if (!a.startsAt && !b.startsAt) return a.title.localeCompare(b.title);
        if (!a.startsAt) return 1;
        if (!b.startsAt) return -1;
        return Date.parse(a.startsAt) - Date.parse(b.startsAt);
      })
      .slice(0, limit);
  }, [published, showPast, limit]);

  function hrefFor(event: CalendarEvent): string | undefined {
    /*
     * The site's own event page wins, and the event's external link is the
     * FALLBACK — not the other way round.
     *
     * This was backwards when the calendar shipped (2/3) and only became
     * visible once the event page existed (3/3): nearly every real event has
     * a ticketing link, so preferring it sent every visitor straight off-site
     * and the event page — with the description, the location, the organiser
     * and its own Get Tickets button — was unreachable from the calendar it
     * belongs to.
     *
     * With no event page configured the external link is still better than a
     * dead title, so it stays as the fallback.
     */
    if (eventPageUrl && event.slug) {
      const sep = eventPageUrl.includes("?") ? "&" : "?";
      return `${eventPageUrl}${sep}event=${encodeURIComponent(event.slug)}`;
    }
    return event.url || undefined;
  }

  const Title = heading
    ? <h2 className="builder-event-calendar-heading">{heading}</h2>
    : null;

  if (loading) {
    return (
      <div className="builder-event-calendar" style={{ ["--evt-accent" as string]: accent, ...getAdminDataTableThemeStyle(themePalette, theme) }}>
        {Title}
        <p className="builder-event-calendar-empty">Loading events…</p>
      </div>
    );
  }

  // A failed fetch is NOT the same as an empty calendar and must not wear its
  // words: "no events scheduled" over a broken request tells a visitor
  // something false about the club.
  if (failed) {
    return (
      <div className="builder-event-calendar" style={{ ["--evt-accent" as string]: accent, ...getAdminDataTableThemeStyle(themePalette, theme) }}>
        {Title}
        <p className="builder-event-calendar-empty">Events are unavailable just now. Please try again shortly.</p>
      </div>
    );
  }

  /* ── Month grid ─────────────────────────────────────────────────────── */
  if (layout === "month") {
    const weeks = monthGrid(cursor.year, cursor.month, weekStartsOn);
    const monthName = new Date(cursor.year, cursor.month, 1)
      .toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const today = new Date();
    const dayNames = Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(i + weekStartsOn) % 7]);
    const step = (by: number) => setCursor((c) => {
      const d = new Date(c.year, c.month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

    return (
      <div className="builder-event-calendar builder-event-calendar--month" style={{ ["--evt-accent" as string]: accent, ...getAdminDataTableThemeStyle(themePalette, theme) }}>
        {Title}
        <div className="builder-event-calendar-nav">
          <button type="button" className="builder-event-calendar-nav-btn" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
          <span className="builder-event-calendar-month" aria-live="polite">{monthName}</span>
          <button type="button" className="builder-event-calendar-nav-btn" aria-label="Next month" onClick={() => step(1)}>›</button>
        </div>
        <div className="builder-event-calendar-grid" role="grid" aria-label={monthName}>
          {dayNames.map((name) => (
            // The short form is decoration; the full name is what a screen
            // reader should say, so the letter is hidden from it.
            <div key={name} className="builder-event-calendar-weekday" role="columnheader">
              <abbr title={name} aria-label={name}>
                <span aria-hidden="true">{name.slice(0, 3)}</span>
              </abbr>
            </div>
          ))}
          {weeks.flat().map((cell) => {
            const onThisDay = published.filter((e) => eventOccursOn(e, cell.date));
            const isToday = isSameDay(cell.date, today);
            return (
              <div
                key={cell.date.toISOString()}
                role="gridcell"
                className={[
                  "builder-event-calendar-day",
                  cell.inMonth ? "" : "builder-event-calendar-day--outside",
                  isToday ? "builder-event-calendar-day--today" : "",
                  onThisDay.length ? "builder-event-calendar-day--has-events" : "",
                ].filter(Boolean).join(" ")}
              >
                <span className="builder-event-calendar-daynum">{cell.date.getDate()}</span>
                {onThisDay.map((event) => {
                  const href = hrefFor(event);
                  const label = event.title || "Untitled event";
                  const body = (
                    <>
                      <span className="builder-event-calendar-chip-title">{label}</span>
                      {!event.allDay && event.startsAt ? (
                        <span className="builder-event-calendar-chip-time">
                          {new Date(event.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </span>
                      ) : null}
                    </>
                  );
                  return href ? (
                    <a key={event.id} className="builder-event-calendar-chip" href={href} title={label}>{body}</a>
                  ) : (
                    <span key={event.id} className="builder-event-calendar-chip" title={label}>{body}</span>
                  );
                })}
              </div>
            );
          })}
        </div>
        {published.length === 0 ? <p className="builder-event-calendar-empty">{emptyMessage}</p> : null}
      </div>
    );
  }

  /* ── List and cards ─────────────────────────────────────────────────── */
  if (!listed.length) {
    return (
      <div className="builder-event-calendar" style={{ ["--evt-accent" as string]: accent, ...getAdminDataTableThemeStyle(themePalette, theme) }}>
        {Title}
        <p className="builder-event-calendar-empty">{emptyMessage}</p>
      </div>
    );
  }

  const isCards = layout === "cards";

  return (
    <div
      className={`builder-event-calendar builder-event-calendar--${isCards ? "cards" : "list"}`}
      style={{
        ["--evt-accent" as string]: accent,
        ["--evt-columns" as string]: String(columns),
        ...getAdminDataTableThemeStyle(themePalette, theme),
      }}
    >
      {Title}
      <ul className="builder-event-calendar-items">
        {listed.map((event) => {
          const href = hrefFor(event);
          const label = event.title || "Untitled event";
          const start = event.startsAt ? new Date(event.startsAt) : null;
          const image = showImages && isCards ? resolvePublicBuilderAssetUrl(event.imageUrl) : "";
          const titleNode = href
            ? <a className="builder-event-calendar-item-title" href={href}>{label}</a>
            : <span className="builder-event-calendar-item-title">{label}</span>;
          return (
            <li key={event.id} className="builder-event-calendar-item">
              {image ? (
                <img
                  className="builder-event-calendar-item-image"
                  src={image}
                  alt={event.imageAlt || ""}
                  loading="lazy"
                />
              ) : null}
              <div className="builder-event-calendar-item-body">
                {start && !isCards ? (
                  <span className="builder-event-calendar-datechip" aria-hidden="true">
                    <span className="builder-event-calendar-datechip-month">
                      {start.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}
                    </span>
                    <span className="builder-event-calendar-datechip-day">{start.getDate()}</span>
                  </span>
                ) : null}
                <div className="builder-event-calendar-item-text">
                  {titleNode}
                  <p className="builder-event-calendar-item-when">{formatEventWhen(event)}</p>
                  {showLocation && event.locationName ? (
                    <p className="builder-event-calendar-item-where">{event.locationName}</p>
                  ) : null}
                  {showExcerpt && event.excerpt ? (
                    <p className="builder-event-calendar-item-excerpt">{event.excerpt}</p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Media Manager (admin) ─────────────────────────────────────────────────── */

/**
 * The Media Manager a TENANT admin uses, on their own site — e.g.
 * delraytennis.starcaster.pro/admin-media-manager. Not to be confused with the
 * Assets screen in the platform admin app, which is Dane's and never loads
 * here (that confusion is what tickets 1-3 of this series were built against).
 *
 * Runs on /api/assets with a project-admin session. Ticket 86bbrqnqu pinned
 * which asset endpoints a tenant admin may reach and which are refused — the
 * refused ones spend Alphire's money, quota or compute, and none of them are
 * used below.
 *
 * Every upload declares `source: "admin-media-manager"`, the column added in
 * 86bbrnz2v. That is what makes these files findable as Media Manager uploads
 * in the Builder's own gallery picker.
 */

const MEDIA_MANAGER_SOURCE = "admin-media-manager";

/** Mirrors GALLERY_IMAGE_EXTENSIONS / GALLERY_VIDEO_EXTENSIONS. */
const MEDIA_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.svg";
const MEDIA_VIDEO_ACCEPT = ".mp4,.mov,.m4v,.webm,.ogg";

/**
 * The base64 upload path tops out around 7MB. Anything larger goes through
 * Vercel Blob, which is also the only path for video.
 */
const MEDIA_DIRECT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;

type MediaAsset = {
  id: number;
  assetName: string;
  assetType: string;
  category?: string;
  aspect?: string;
  location: string;
  thumbnailUrl?: string;
  tags?: string[];
  size?: number;
  imageWidth?: number;
  imageHeight?: number;
  source?: string;
  createdAt?: string;
};

type MediaUploadProgress = { name: string; index: number; total: number };

type MediaTag = { id: number; tag: string };

type MediaCategory = { id: number; assetType: string; category: string };

function mediaIsVideo(asset: MediaAsset): boolean {
  if (String(asset.assetType || "").toLowerCase() === "video") return true;
  return /\.(mp4|mov|m4v|webm|ogg)(\?|#|$)/i.test(String(asset.location || ""));
}

function formatMediaSize(bytes?: number): string {
  const n = Number(bytes || 0);
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

let mediaBlobClientPromise: Promise<{ upload: (...args: unknown[]) => Promise<{ url: string }> }> | null = null;
function getMediaBlobClient() {
  // Loaded from a CDN at runtime rather than bundled — the same technique
  // public/js/assets.js uses, and what lets a tenant page upload video without
  // the builder bundle carrying the SDK.
  if (!mediaBlobClientPromise) {
    // The specifier is built at runtime so TypeScript does not try to resolve
    // a URL import at compile time, and esbuild leaves it as a dynamic import
    // for the browser to fetch.
    const cdn = "https://esm.sh/@vercel/blob/client?bundle";
    mediaBlobClientPromise = (new Function("u", "return import(u)")(cdn)) as Promise<{
      upload: (...args: unknown[]) => Promise<{ url: string }>;
    }>;
  }
  return mediaBlobClientPromise;
}

function MediaManagerPreview({
  settings,
  text
}: {
  settings: Record<string, string>;
  text?: string;
}) {
  const accent = settings.accentColor || "#0f4f8f";
  const kinds = String(settings.kinds || "all").toLowerCase();
  const showSize = (settings.showSize ?? "true") !== "false";
  const showDate = (settings.showDate ?? "true") !== "false";
  const showDelete = (settings.showDelete ?? "true") !== "false";
  const showTags = (settings.showTags ?? "true") !== "false";
  const showFilters = (settings.showFilters ?? "true") !== "false";

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploading, setUploading] = useState<MediaUploadProgress | null>(null);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectTags, setProjectTags] = useState<MediaTag[]>([]);
  const [projectCategories, setProjectCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState<MediaFilters>(EMPTY_MEDIA_FILTERS);
  const [tagTarget, setTagTarget] = useState<MediaAsset | null>(null);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The module card offers a generic Content box bound to module.text, and it
  // is a plain <textarea> for every type but "text" — so this is TEXT, never
  // HTML. Rendered through React's own escaping, with line breaks preserved by
  // CSS rather than by building markup out of the value.
  const description = String(text || "").trim();

  const acceptAttr =
    kinds === "images" ? MEDIA_IMAGE_ACCEPT
      : kinds === "videos" ? MEDIA_VIDEO_ACCEPT
        : `${MEDIA_IMAGE_ACCEPT},${MEDIA_VIDEO_ACCEPT}`;

  function loadAssets() {
    setLoading(true);
    setLoadError("");
    fetch("/api/assets", { credentials: "include", headers: getCrmProjectHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(readApiErrorMessage(d, `Failed to load media (${r.status})`));
        const list = (d?.assets ?? d?.data ?? []) as MediaAsset[];
        setAssets(Array.isArray(list) ? list : []);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load media."))
      .finally(() => setLoading(false));
  }

  function loadProjectTags() {
    fetch("/api/asset-tags", { credentials: "include", headers: getCrmProjectHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(readApiErrorMessage(d, "Failed to load tags"));
        const list = (d?.tags ?? d?.data ?? []) as MediaTag[];
        setProjectTags(Array.isArray(list) ? list : []);
      })
      // A tag list that will not load must not stop the grid rendering: the
      // media is the point, tagging is an extra. The modal reports it instead.
      .catch(() => setProjectTags([]));
  }

  function loadProjectCategories() {
    fetch("/api/asset-categories", { credentials: "include", headers: getCrmProjectHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(readApiErrorMessage(d, "Failed to load categories"));
        const list = (d?.categories ?? d?.data ?? []) as MediaCategory[];
        // The endpoint returns one entry per (assetType, category) pair, so the
        // same category arrives once per type it is used on. De-duplicated by
        // name here or the select lists "Logos" three times.
        const seen = new Map<string, string>();
        (Array.isArray(list) ? list : []).forEach((c) => {
          const name = String(c?.category || "").trim();
          if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
        });
        setProjectCategories([...seen.values()].sort((a, b) => a.localeCompare(b)));
      })
      // A category list that will not load must not stop the grid rendering.
      .catch(() => setProjectCategories([]));
  }

  useEffect(() => { loadAssets(); loadProjectTags(); loadProjectCategories(); }, []);

  function setFilter(key: keyof MediaFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function openTagEditor(asset: MediaAsset) {
    setTagTarget(asset);
    setTagDraft(Array.isArray(asset.tags) ? [...asset.tags] : []);
    setNewTag("");
    setErrorMsg("");
    loadProjectTags();
  }

  function toggleDraftTag(tag: string) {
    const key = mediaTagKey(tag);
    setTagDraft((prev) => (
      prev.some((t) => mediaTagKey(t) === key)
        ? prev.filter((t) => mediaTagKey(t) !== key)
        : [...prev, normalizeMediaTag(tag)]
    ));
  }

  /** Adds to the project registry AND applies to this file, in one action. */
  async function addNewTag() {
    const tag = normalizeMediaTag(newTag);
    if (!tag) return;
    setBusy(true);
    try {
      const res = await fetch("/api/asset-tags", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify({ tag })
      });
      const d = await res.json().catch(() => null);
      // 200 means it already existed, 201 means it is new. Both are success —
      // two admins typing "Courts" is normal use, not a conflict.
      if (!res.ok) throw new Error(readApiErrorMessage(d, "Failed to add tag."));
      const saved = (d?.tag ?? d?.data) as MediaTag | undefined;
      const name = normalizeMediaTag(saved?.tag || tag);
      setNewTag("");
      loadProjectTags();
      setTagDraft((prev) => (
        prev.some((t) => mediaTagKey(t) === mediaTagKey(name)) ? prev : [...prev, name]
      ));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to add tag.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTags() {
    if (!tagTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(String(tagTarget.id))}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify({ tags: tagDraft })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(readApiErrorMessage(d, "Failed to save tags."));
      }
      setTagTarget(null);
      setStatusMsg("Tags saved.");
      loadAssets();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save tags.");
    } finally {
      setBusy(false);
    }
  }

  // What the module is configured to hold at all. Separate from the operator's
  // filters below, so an empty grid can say WHICH of the two emptied it.
  const inScope = assets.filter((asset) => {
    if (kinds === "images") return !mediaIsVideo(asset);
    if (kinds === "videos") return mediaIsVideo(asset);
    return true;
  });

  const filtersOn = showFilters && mediaFiltersActive(filters);

  const visible = !filtersOn
    ? inScope
    : inScope.filter((asset) => mediaAssetMatchesFilters(asset, filters));

  async function uploadOne(file: File) {
    const isVideo = /^video\//i.test(file.type) || /\.(mp4|mov|m4v|webm|ogg)$/i.test(file.name);
    const assetType = isVideo ? "Video" : "Image";

    // Video, and anything past the base64 ceiling, goes through Blob. An
    // image small enough takes the direct path because it also generates a
    // thumbnail on the way in.
    if (isVideo || file.size > MEDIA_DIRECT_UPLOAD_MAX_BYTES) {
      const { upload } = await getMediaBlobClient();
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/assets/blob-upload",
        multipart: true,
        clientPayload: JSON.stringify({ fileName: file.name, assetType, assetName: file.name })
      });
      const res = await fetch("/api/assets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify({
          assetName: file.name,
          assetType,
          location: String(blob?.url || ""),
          size: Number(file.size || 0),
          source: MEDIA_MANAGER_SOURCE
        })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(readApiErrorMessage(d, `Failed to record ${file.name}.`));
      }
      return;
    }

    const res = await fetch("/api/assets/import-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        fileBase64: await fileToBase64(file),
        assetName: file.name,
        source: MEDIA_MANAGER_SOURCE
      })
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(readApiErrorMessage(d, `Failed to upload ${file.name}.`));
    }
  }

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setErrorMsg("");
    setStatusMsg("");
    const failures: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      // A video upload runs for minutes. Silence here is indistinguishable
      // from a hang, so every file announces itself before it starts.
      setUploading({ name: file.name, index, total: files.length });
      try {
        await uploadOne(file);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
    }
    setUploading(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const ok = files.length - failures.length;
    if (failures.length) {
      setErrorMsg(`${failures.length} of ${files.length} failed — ${failures[0]}`);
    }
    if (ok > 0) setStatusMsg(`${ok} file${ok === 1 ? "" : "s"} uploaded.`);
    loadAssets();
  }

  async function saveRename(asset: MediaAsset) {
    const next = renameValue.trim();
    if (!next || next === asset.assetName) { setRenameId(null); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(String(asset.id))}`, {
        // PATCH, not PUT. routes/assets.js handles PATCH and DELETE for this
        // path and nothing else, so a PUT falls through unmatched and the
        // rename silently does not happen.
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify({ assetName: next })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(readApiErrorMessage(d, "Failed to rename."));
      }
      setStatusMsg("Renamed.");
      setRenameId(null);
      loadAssets();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to rename.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(String(deleteTarget.id))}`, {
        method: "DELETE",
        credentials: "include",
        headers: getCrmProjectHeaders()
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(readApiErrorMessage(d, "Failed to delete."));
      }
      setDeleteTarget(null);
      setStatusMsg("Deleted.");
      loadAssets();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to delete.");
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="builder-media-manager" style={{ ["--builder-media-accent" as string]: accent }}>
      {description ? (
        <p className="builder-media-manager-description">{description}</p>
      ) : null}
      <div className="builder-media-manager-toolbar">
        <label className="builder-media-manager-upload">
          <input
            ref={fileInputRef}
            accept={acceptAttr}
            className="builder-media-manager-file-input"
            disabled={Boolean(uploading)}
            multiple
            onChange={(e) => { handleFiles(e.target.files); }}
            type="file"
          />
          <span className="builder-media-manager-upload-label">
            {uploading ? "Uploading…" : "Upload Files"}
          </span>
        </label>
        <span className="builder-media-manager-count">
          {loading
            ? "Loading…"
            : filtersOn
              // "0 files" while 40 sit behind a filter is the same lie as the
              // wrong empty state, in a smaller space.
              ? `${visible.length} of ${inScope.length} file${inScope.length === 1 ? "" : "s"}`
              : `${visible.length} file${visible.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {uploading ? (
        <div aria-live="polite" className="builder-media-manager-progress">
          Uploading {uploading.index + 1} of {uploading.total}: {uploading.name}
        </div>
      ) : null}

      {showFilters ? (
        <div className="builder-media-manager-filters">
          <label className="builder-media-manager-filter">
            <span className="builder-media-manager-filter-label">Name</span>
            <input
              className="builder-media-manager-filter-input"
              onChange={(e) => setFilter("name", e.target.value)}
              placeholder="Search filenames"
              type="search"
              value={filters.name}
            />
          </label>

          <label className="builder-media-manager-filter">
            <span className="builder-media-manager-filter-label">Aspect</span>
            <select
              className="builder-media-manager-filter-select"
              onChange={(e) => setFilter("aspect", e.target.value)}
              value={filters.aspect}
            >
              <option value="">All</option>
              {MEDIA_ASPECTS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>

          <label className="builder-media-manager-filter">
            <span className="builder-media-manager-filter-label">Tag</span>
            <select
              className="builder-media-manager-filter-select"
              onChange={(e) => setFilter("tag", e.target.value)}
              value={filters.tag}
            >
              <option value="">All</option>
              {mediaTagOptions(projectTags, assets).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          <label className="builder-media-manager-filter">
            <span className="builder-media-manager-filter-label">Category</span>
            <select
              className="builder-media-manager-filter-select"
              onChange={(e) => setFilter("category", e.target.value)}
              value={filters.category}
            >
              <option value="">All</option>
              {projectCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          {/* Only when there is something to clear — a permanently visible
              Clear reads as an action with no effect. */}
          {mediaFiltersActive(filters) ? (
            <button
              className="builder-media-manager-btn builder-media-manager-clear"
              onClick={() => setFilters(EMPTY_MEDIA_FILTERS)}
              type="button"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {statusMsg ? <div className="builder-media-manager-status">{statusMsg}</div> : null}
      {errorMsg ? <div className="builder-media-manager-error">{errorMsg}</div> : null}
      {loadError ? <div className="builder-media-manager-error">{loadError}</div> : null}

      {/* Two different emptinesses, and they must never be confused: nothing
          uploaded, versus everything hidden by a filter. */}
      {!loading && !visible.length && !loadError && !filtersOn ? (
        <p className="builder-media-manager-empty">
          No media yet. Use Upload Files to add images or video.
        </p>
      ) : null}

      {!loading && !visible.length && !loadError && filtersOn ? (
        <p className="builder-media-manager-empty">
          No files match these filters.{" "}
          <button
            className="builder-media-manager-clear-inline"
            onClick={() => setFilters(EMPTY_MEDIA_FILTERS)}
            type="button"
          >
            Clear filters
          </button>
        </p>
      ) : null}

      <div className="builder-media-manager-grid">
        {visible.map((asset) => (
          <figure className="builder-media-manager-card" key={asset.id}>
            <div className="builder-media-manager-thumb">
              {mediaIsVideo(asset) ? (
                <video className="builder-media-manager-media" preload="metadata" src={asset.location} />
              ) : (
                <img
                  alt={asset.assetName}
                  className="builder-media-manager-media"
                  loading="lazy"
                  src={asset.thumbnailUrl || asset.location}
                />
              )}
              {asset.source === MEDIA_MANAGER_SOURCE ? (
                <span className="builder-media-manager-badge" title="Uploaded here">Media Mgr</span>
              ) : null}
            </div>
            <figcaption className="builder-media-manager-caption">
              {renameId === asset.id ? (
                <input
                  autoFocus
                  className="builder-media-manager-rename"
                  disabled={busy}
                  onBlur={() => saveRename(asset)}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(asset);
                    if (e.key === "Escape") setRenameId(null);
                  }}
                  value={renameValue}
                />
              ) : (
                <button
                  className="builder-media-manager-name"
                  onClick={() => { setRenameId(asset.id); setRenameValue(asset.assetName); }}
                  title="Click to rename"
                  type="button"
                >
                  {asset.assetName}
                </button>
              )}
              <span className="builder-media-manager-meta">
                {showSize ? formatMediaSize(asset.size) : null}
                {showSize && showDate && asset.createdAt ? " · " : null}
                {showDate && asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : null}
                {showTags ? (
                  <button
                    aria-label={`Tag ${asset.assetName}`}
                    className="builder-media-manager-tag-btn"
                    onClick={() => openTagEditor(asset)}
                    title="Tags"
                    type="button"
                  >
                    {/* An outline tag glyph. Inline SVG rather than an emoji so
                        it inherits the accent colour and renders identically
                        on every platform. */}
                    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
                      <path
                        d="M1.5 7.1V2.4a.9.9 0 0 1 .9-.9h4.7c.24 0 .47.1.64.26l6.1 6.1a.9.9 0 0 1 0 1.28l-4.7 4.7a.9.9 0 0 1-1.28 0l-6.1-6.1a.9.9 0 0 1-.26-.64Z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                      <circle cx="4.6" cy="4.6" fill="currentColor" r="1" />
                    </svg>
                  </button>
                ) : null}
              </span>
              {showTags && Array.isArray(asset.tags) && asset.tags.length ? (
                <span className="builder-media-manager-tags">
                  {asset.tags.map((tag) => (
                    <span className="builder-media-manager-tag" key={tag}>{tag}</span>
                  ))}
                </span>
              ) : null}
              {showDelete ? (
                <button
                  className="builder-media-manager-delete"
                  disabled={busy}
                  onClick={() => setDeleteTarget(asset)}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>

      {tagTarget ? (
        <div
          aria-label={`Tags for ${tagTarget.assetName}`}
          aria-modal="true"
          className="builder-media-manager-tag-modal"
          onKeyDown={(e) => { if (e.key === "Escape") setTagTarget(null); }}
          role="dialog"
        >
          <div className="builder-media-manager-tag-modal-inner">
            <h3 className="builder-media-manager-tag-modal-title">
              Tags — {tagTarget.assetName}
            </h3>

            {projectTags.length ? (
              <div className="builder-media-manager-tag-choices">
                {projectTags.map((tag) => {
                  const on = tagDraft.some((t) => mediaTagKey(t) === mediaTagKey(tag.tag));
                  return (
                    <button
                      aria-pressed={on}
                      className="builder-media-manager-tag-choice"
                      disabled={busy}
                      key={tag.id}
                      onClick={() => toggleDraftTag(tag.tag)}
                      type="button"
                    >
                      {tag.tag}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="builder-media-manager-tag-empty">
                No tags yet. Add the first one below.
              </p>
            )}

            <div className="builder-media-manager-tag-add">
              <input
                aria-label="New tag"
                className="builder-media-manager-tag-input"
                disabled={busy}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  // Enter adds the tag rather than submitting anything — this
                  // modal is not inside a form on the public site.
                  if (e.key === "Enter") { e.preventDefault(); addNewTag(); }
                }}
                placeholder="Add a new tag"
                value={newTag}
              />
              <button
                className="builder-media-manager-tag-add-btn"
                disabled={busy || !normalizeMediaTag(newTag)}
                onClick={addNewTag}
                type="button"
              >
                Add
              </button>
            </div>

            {errorMsg ? <div className="builder-media-manager-error">{errorMsg}</div> : null}

            <div className="builder-media-manager-confirm-actions">
              <button
                className="builder-media-manager-btn builder-media-manager-btn-primary"
                disabled={busy}
                onClick={saveTags}
                type="button"
              >
                {busy ? "Saving…" : "Save Tags"}
              </button>
              <button
                className="builder-media-manager-btn"
                disabled={busy}
                onClick={() => setTagTarget(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="builder-media-manager-confirm">
          <p>Delete “{deleteTarget.assetName}”? This cannot be undone.</p>
          <div className="builder-media-manager-confirm-actions">
            <button
              className="builder-media-manager-btn builder-media-manager-btn-danger"
              disabled={busy}
              onClick={confirmDelete}
              type="button"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button
              className="builder-media-manager-btn"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Event Manager (admin) ─────────────────────────────────────────────────── */

type EventRecord = {
  id: string;
  title: string;
  slug: string;
  status: string;
  description: string;
  excerpt: string;
  imageUrl: string;
  imageAlt: string;
  url: string;
  featured: boolean;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  timezone: string;
  locationName: string;
  locationAddress: string;
  locationUrl: string;
  organizerName: string;
  organizerContact: string;
  seoTitle: string;
  seoDescription: string;
};

type EventFormValues = Record<string, string>;

const EVENT_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  // Cancelled rather than deleted, on purpose: an event people already put in
  // their diary must keep its page and say it is off, not vanish and leave
  // them turning up.
  { value: "cancelled", label: "Cancelled" },
];

const EMPTY_EVENT_FORM: EventFormValues = {
  title: "", slug: "", status: "draft",
  startsAt: "", endsAt: "", allDay: "false", timezone: "",
  locationName: "", locationAddress: "", locationUrl: "",
  imageUrl: "", imageAlt: "", url: "",
  excerpt: "", description: "",
  organizerName: "", organizerContact: "",
  seoTitle: "", seoDescription: "",
  featured: "false",
};

/** The viewer's own zone, offered as the default for a new event. */
function localTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function eventStatusClass(status: string): string {
  return `builder-event-manager-status builder-event-manager-status-${normalizeEventStatus(status)}`;
}

function EventManagerPreview({
  settings,
  theme,
  themePalette,
}: {
  settings: Record<string, string>;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const accent = settings.accentColor || "#0f4f8f";
  const viewBaseUrl = String(settings.viewPageUrl || "").trim();
  const showStatus = (settings.showStatus ?? "true") !== "false";
  const showDate = (settings.showDate ?? "true") !== "false";
  const showLocation = (settings.showLocation ?? "true") !== "false";
  const showDelete = (settings.showDelete ?? "true") !== "false";

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EventRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  function loadEvents() {
    setLoading(true);
    setLoadError("");
    fetch("/api/events?limit=200", { credentials: "include", headers: getCrmProjectHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(readApiErrorMessage(d, `Failed to load events (${r.status})`));
        const list = (d?.events ?? d?.data ?? []) as EventRecord[];
        setEvents(Array.isArray(list) ? list : []);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load events."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadEvents(); }, []);

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function closeForm() {
    setFormOpen(false);
    setEditId(null);
    setForm(EMPTY_EVENT_FORM);
    setErrorMsg("");
  }

  function startCreate() {
    setEditId(null);
    setForm({ ...EMPTY_EVENT_FORM, timezone: localTimeZoneName() });
    setErrorMsg("");
    setStatusMsg("");
    setFormOpen(true);
  }

  function startEdit(event: EventRecord) {
    const allDay = Boolean(event.allDay);
    setEditId(event.id);
    setForm({
      title: event.title ?? "",
      slug: event.slug ?? "",
      status: event.status || "draft",
      startsAt: isoToLocalInput(event.startsAt, allDay),
      endsAt: isoToLocalInput(event.endsAt, allDay),
      allDay: allDay ? "true" : "false",
      timezone: event.timezone ?? "",
      locationName: event.locationName ?? "",
      locationAddress: event.locationAddress ?? "",
      locationUrl: event.locationUrl ?? "",
      imageUrl: event.imageUrl ?? "",
      imageAlt: event.imageAlt ?? "",
      url: event.url ?? "",
      excerpt: event.excerpt ?? "",
      description: event.description ?? "",
      organizerName: event.organizerName ?? "",
      organizerContact: event.organizerContact ?? "",
      seoTitle: event.seoTitle ?? "",
      seoDescription: event.seoDescription ?? "",
      featured: event.featured ? "true" : "false",
    });
    setErrorMsg("");
    setStatusMsg("");
    setFormOpen(true);
  }

  /**
   * Switching All Day converts what is already typed rather than discarding
   * it: a date survives losing its clock, and gains midnight coming back.
   */
  function toggleAllDay(next: boolean) {
    setForm((prev) => ({
      ...prev,
      allDay: next ? "true" : "false",
      startsAt: prev.startsAt ? isoToLocalInput(localInputToIso(prev.startsAt), next) : "",
      endsAt: prev.endsAt ? isoToLocalInput(localInputToIso(prev.endsAt), next) : "",
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setErrorMsg("Event name is required."); return; }
    const startsAt = localInputToIso(form.startsAt);
    const endsAt = localInputToIso(form.endsAt);
    // An end before its start is the one date mistake worth refusing: it makes
    // every calendar view render the event backwards or not at all.
    if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
      setErrorMsg("The end of an event cannot come before its start.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    setStatusMsg("");
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim() || textToSlug(form.title.trim()),
      status: form.status || "draft",
      startsAt,
      endsAt,
      allDay: form.allDay === "true",
      timezone: form.timezone.trim(),
      locationName: form.locationName.trim(),
      locationAddress: form.locationAddress.trim(),
      locationUrl: form.locationUrl.trim(),
      imageUrl: form.imageUrl.trim(),
      imageAlt: form.imageAlt.trim(),
      url: form.url.trim(),
      excerpt: form.excerpt.trim(),
      description: form.description || "",
      organizerName: form.organizerName.trim(),
      organizerContact: form.organizerContact.trim(),
      seoTitle: form.seoTitle.trim(),
      seoDescription: form.seoDescription.trim(),
      featured: form.featured === "true",
    };
    try {
      const res = await fetch(
        editId ? `/api/events/${encodeURIComponent(editId)}` : "/api/events",
        {
          method: editId ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readApiErrorMessage(data, editId ? "Failed to update event." : "Failed to create event."));
      setStatusMsg(editId ? "Event updated." : "Event created.");
      closeForm();
      loadEvents();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: getCrmProjectHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(readApiErrorMessage(data, "Failed to delete event."));
      }
      if (editId === deleteTarget.id) closeForm();
      setDeleteTarget(null);
      setStatusMsg("Event deleted.");
      loadEvents();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to delete event.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const isAllDay = form.allDay === "true";
  const dateInputType = isAllDay ? "date" : "datetime-local";

  const eventForm = formOpen ? (
    <form className="builder-event-manager-form" onSubmit={handleSubmit}>
      <h3 className="builder-event-manager-form-title">{editId ? "Edit Event" : "New Event"}</h3>

      <div className="builder-event-manager-field">
        <label className="builder-event-manager-label" htmlFor="event-title">Event Name *</label>
        <input
          id="event-title"
          className="builder-event-manager-input"
          value={form.title}
          onChange={(e) => {
            const next = e.target.value;
            setForm((f) => ({ ...f, title: next, slug: f.slug || textToSlug(next) }));
          }}
        />
      </div>

      <div className="builder-event-manager-field-row">
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-slug">Slug</label>
          <input
            id="event-slug"
            className="builder-event-manager-input"
            value={form.slug}
            onChange={(e) => setField("slug", e.target.value)}
          />
        </div>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-status">Status</label>
          <select
            id="event-status"
            className="builder-event-manager-input"
            value={form.status}
            onChange={(e) => setField("status", e.target.value)}
          >
            {EVENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="builder-event-manager-field-row">
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-starts">Starts</label>
          <input
            id="event-starts"
            className="builder-event-manager-input"
            type={dateInputType}
            value={form.startsAt}
            onChange={(e) => setField("startsAt", e.target.value)}
          />
        </div>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-ends">Ends</label>
          <input
            id="event-ends"
            className="builder-event-manager-input"
            type={dateInputType}
            value={form.endsAt}
            onChange={(e) => setField("endsAt", e.target.value)}
          />
        </div>
      </div>

      <div className="builder-event-manager-field-row">
        <label className="builder-event-manager-check">
          <input
            type="checkbox"
            checked={isAllDay}
            onChange={(e) => toggleAllDay(e.target.checked)}
          />
          <span>All day</span>
        </label>
        <label className="builder-event-manager-check">
          <input
            type="checkbox"
            checked={form.featured === "true"}
            onChange={(e) => setField("featured", e.target.checked ? "true" : "false")}
          />
          <span>Featured</span>
        </label>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-timezone">Time Zone</label>
          <input
            id="event-timezone"
            className="builder-event-manager-input"
            value={form.timezone}
            onChange={(e) => setField("timezone", e.target.value)}
            placeholder="America/Denver"
          />
        </div>
      </div>

      <div className="builder-event-manager-field-row">
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-location-name">Location</label>
          <input
            id="event-location-name"
            className="builder-event-manager-input"
            value={form.locationName}
            onChange={(e) => setField("locationName", e.target.value)}
            placeholder="Center Court"
          />
        </div>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-location-address">Address</label>
          <input
            id="event-location-address"
            className="builder-event-manager-input"
            value={form.locationAddress}
            onChange={(e) => setField("locationAddress", e.target.value)}
          />
        </div>
      </div>

      <div className="builder-event-manager-field-row">
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-location-url">Map Link</label>
          <input
            id="event-location-url"
            className="builder-event-manager-input"
            value={form.locationUrl}
            onChange={(e) => setField("locationUrl", e.target.value)}
            placeholder="https://…"
          />
        </div>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-url">Event Link</label>
          <input
            id="event-url"
            className="builder-event-manager-input"
            value={form.url}
            onChange={(e) => setField("url", e.target.value)}
            placeholder="Tickets or registration"
          />
        </div>
      </div>

      <div className="builder-event-manager-field">
        <label className="builder-event-manager-label">Image</label>
        <BuilderImagePickerField
          value={form.imageUrl}
          onChange={(url) => setField("imageUrl", url)}
          placeholder="https://…"
        />
      </div>

      {form.imageUrl ? (
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-image-alt">Image Alt Text</label>
          <input
            id="event-image-alt"
            className="builder-event-manager-input"
            value={form.imageAlt}
            onChange={(e) => setField("imageAlt", e.target.value)}
            placeholder="What the picture shows"
          />
        </div>
      ) : null}

      <div className="builder-event-manager-field">
        <label className="builder-event-manager-label" htmlFor="event-excerpt">Summary</label>
        <textarea
          id="event-excerpt"
          className="builder-event-manager-input builder-event-manager-textarea"
          value={form.excerpt}
          onChange={(e) => setField("excerpt", e.target.value)}
          placeholder="One or two lines for calendar cards"
        />
      </div>

      <div className="builder-event-manager-field">
        <label className="builder-event-manager-label">Description</label>
        <BuilderRichTextEditor
          value={form.description}
          onChange={(html) => setField("description", html)}
          placeholder="Full event details…"
        />
      </div>

      <div className="builder-event-manager-field-row">
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-organizer">Organizer</label>
          <input
            id="event-organizer"
            className="builder-event-manager-input"
            value={form.organizerName}
            onChange={(e) => setField("organizerName", e.target.value)}
          />
        </div>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-organizer-contact">Organizer Contact</label>
          <input
            id="event-organizer-contact"
            className="builder-event-manager-input"
            value={form.organizerContact}
            onChange={(e) => setField("organizerContact", e.target.value)}
            placeholder="Email or phone"
          />
        </div>
      </div>

      <div className="builder-event-manager-field-row">
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-seo-title">SEO Title</label>
          <input
            id="event-seo-title"
            className="builder-event-manager-input"
            value={form.seoTitle}
            onChange={(e) => setField("seoTitle", e.target.value)}
          />
        </div>
        <div className="builder-event-manager-field">
          <label className="builder-event-manager-label" htmlFor="event-seo-description">SEO Description</label>
          <input
            id="event-seo-description"
            className="builder-event-manager-input"
            value={form.seoDescription}
            onChange={(e) => setField("seoDescription", e.target.value)}
          />
        </div>
      </div>

      {errorMsg ? <div className="builder-event-manager-error">{errorMsg}</div> : null}

      <div className="builder-event-manager-form-actions">
        <button type="button" className="btn btn-ghost" onClick={closeForm} disabled={saving}>Cancel</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
          style={{ background: accent, borderColor: accent }}
        >
          {saving ? "Saving…" : editId ? "Update Event" : "Create Event"}
        </button>
      </div>
    </form>
  ) : null;

  const columnCount = 1 + (showStatus ? 1 : 0) + (showDate ? 1 : 0) + (showLocation ? 1 : 0) + 1;

  return (
    <div
      className="builder-event-manager-module builder-admin-data-table-module"
      style={getAdminDataTableThemeStyle(themePalette, theme)}
    >
      <h2 className="builder-admin-data-table-title">Events</h2>

      {statusMsg ? <div className="builder-event-manager-notice">{statusMsg}</div> : null}
      {loadError ? <div className="builder-event-manager-error">{loadError}</div> : null}
      {errorMsg && !formOpen ? <div className="builder-event-manager-error">{errorMsg}</div> : null}

      <div className="builder-admin-data-table-wrap">
        <table className="builder-admin-data-table">
          <thead>
            {/*
              * The Add button lives in the FILTER row, not the header row —
              * the same place the CRM contacts table puts "Add Contact". The
              * header row is dark, so a button there renders black on black
              * and reads as a fifth column heading rather than a control.
              */}
            <tr className="builder-admin-data-table-filter-row table-filter-row">
              <th />
              {showStatus ? <th /> : null}
              {showDate ? <th /> : null}
              {showLocation ? <th /> : null}
              <th className="builder-admin-data-table-actions-col actions-col">
                <button type="button" className="btn tiny-btn" onClick={startCreate}>Add Event</button>
              </th>
            </tr>
            <tr className="builder-admin-data-table-header-row">
              <th>Event</th>
              {showStatus ? <th>Status</th> : null}
              {showDate ? <th>When</th> : null}
              {showLocation ? <th>Where</th> : null}
              <th className="builder-admin-data-table-actions-col actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="builder-admin-data-table-empty">Loading events…</td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="builder-admin-data-table-empty">
                  No events yet. Choose Add Event to create your first one.
                </td>
              </tr>
            ) : events.map((event) => {
              const viewHref = viewBaseUrl && event.slug
                ? `${viewBaseUrl}${viewBaseUrl.includes("?") ? "&" : "?"}event=${encodeURIComponent(event.slug)}`
                : undefined;
              return (
                <tr key={event.id}>
                  <td className="builder-admin-data-table-cell">
                    <span className="builder-event-manager-title">{event.title || "Untitled event"}</span>
                    {event.featured ? <span className="builder-event-manager-featured">Featured</span> : null}
                  </td>
                  {showStatus ? (
                    <td className="builder-admin-data-table-cell">
                      <span className={eventStatusClass(event.status)}>{event.status || "draft"}</span>
                    </td>
                  ) : null}
                  {showDate ? (
                    <td className="builder-admin-data-table-cell builder-admin-data-table-date">
                      {formatEventWhen(event)}
                    </td>
                  ) : null}
                  {showLocation ? (
                    <td className="builder-admin-data-table-cell">{event.locationName || "—"}</td>
                  ) : null}
                  <td className="builder-admin-data-table-actions">
                    <div className="table-actions-row" role="group">
                      <AdminTableIconButton
                        icon="view"
                        label="View"
                        href={viewHref}
                        linkTarget="_blank"
                        disabled={!viewHref}
                        onClick={!viewHref ? () => {} : undefined}
                      />
                      <AdminTableIconButton icon="edit" label="Edit" onClick={() => startEdit(event)} />
                      {showDelete ? (
                        <AdminTableIconButton
                          icon="delete"
                          label="Delete"
                          danger
                          onClick={() => setDeleteTarget(event)}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {eventForm}

      {deleteTarget ? (
        <BuilderBodyPortal>
          <div className="crm-contacts-modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
            <div className="crm-contacts-modal" onClick={(e) => e.stopPropagation()}>
              <div className="crm-contacts-modal-header">
                <strong>Delete Event</strong>
                <button type="button" className="crm-contacts-modal-close" onClick={() => setDeleteTarget(null)} disabled={deleting}>✕</button>
              </div>
              <div className="crm-contacts-modal-body">
                <p className="builder-admin-data-table-delete-copy">
                  Delete <strong>{deleteTarget.title || "this event"}</strong>? This cannot be undone.
                  To take an event off the calendar without losing it, set its status to Cancelled instead.
                </p>
              </div>
              <div className="crm-contacts-modal-footer">
                <button type="button" className="crm-contacts-modal-btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
                <button type="button" className="crm-contacts-modal-btn crm-contacts-modal-btn-danger" onClick={confirmDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete Event"}
                </button>
              </div>
            </div>
          </div>
        </BuilderBodyPortal>
      ) : null}
    </div>
  );
}

function BlogCategoryManagerPreview({ settings }: { settings: Record<string, string> }) {
  const accent = settings.accentColor || "#0f4f8f";
  const showDescription = settings.showDescription !== "false";
  const showColor = settings.showColor !== "false";
  const showSortOrder = settings.showSortOrder === "true";
  const showDelete = settings.showDelete !== "false";

  const [cats, setCats] = useState<(BlogCategory & { description?: string; color?: string; sortOrder?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryFormValues>({ name: "", slug: "", description: "", color: "#3b82f6", sortOrder: "0" });
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const headers = { ...getCrmProjectHeaders(), "Content-Type": "application/json" };

  function loadCats() {
    fetch("/api/blog/categories", { credentials: "include", headers: getCrmProjectHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.categories)) setCats(d.categories); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCats(); }, []);

  function resetForm() {
    setEditId(null);
    setForm({ name: "", slug: "", description: "", color: "#3b82f6", sortOrder: "0" });
    setStatusMsg("");
    setErrorMsg("");
  }

  function startEdit(cat: typeof cats[number]) {
    setEditId(cat.id);
    setForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || "",
      color: cat.color || "#3b82f6",
      sortOrder: String(cat.sortOrder ?? 0),
    });
    setStatusMsg("");
    setErrorMsg("");
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete category "${name}"? This will not delete posts in this category.`)) return;
    const r = await fetch(`/api/blog/categories/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", headers: getCrmProjectHeaders() });
    if (r.ok) { loadCats(); if (editId === id) resetForm(); }
    else setErrorMsg("Failed to delete category.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErrorMsg("Name is required."); return; }
    setSaving(true);
    setErrorMsg("");
    setStatusMsg("");
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim() || textToSlug(form.name.trim()),
      description: form.description.trim(),
      color: form.color,
      sortOrder: parseInt(form.sortOrder || "0", 10) || 0,
    };
    const url = editId ? `/api/blog/categories/${encodeURIComponent(editId)}` : "/api/blog/categories";
    const method = editId ? "PUT" : "POST";
    try {
      const r = await fetch(url, { method, credentials: "include", headers, body: JSON.stringify(body) });
      const data = await r.json().catch(() => null);
      if (!r.ok) { setErrorMsg(data?.error?.message || "Save failed."); return; }
      setStatusMsg(editId ? "Category updated." : "Category created.");
      loadCats();
      resetForm();
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle: CSSProperties = { marginBottom: "0.75rem" };
  const labelStyle: CSSProperties = { display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "#374151", marginBottom: "0.25rem" };
  const inputStyle: CSSProperties = { width: "100%", padding: "0.5rem 0.625rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.875rem", boxSizing: "border-box" };

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {/* Category table */}
      {loading ? (
        <div style={{ padding: "1rem", color: "#888", textAlign: "center" }}>Loading…</div>
      ) : cats.length === 0 ? (
        <div style={{ padding: "1rem", color: "#888", textAlign: "center", border: "1px dashed #ccc", borderRadius: 8, marginBottom: "1.5rem" }}>
          No categories yet. Use the form below to add your first one.
        </div>
      ) : (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: `${showColor ? "28px " : ""}1fr auto${showDescription ? " 1fr" : ""}${showSortOrder ? " 48px" : ""} auto`, gap: "0 12px", padding: "7px 12px", background: "#f8fafc", borderBottom: "1px solid #e4ecf2", fontSize: "0.6875rem", fontWeight: 700, color: "#587592", textTransform: "uppercase", alignItems: "center" }}>
            {showColor ? <span></span> : null}
            <span>Name</span>
            <span>Slug</span>
            {showDescription ? <span>Description</span> : null}
            {showSortOrder ? <span>Sort</span> : null}
            <span>Actions</span>
          </div>
          {cats.map((cat, i) => (
            <div key={cat.id} style={{ display: "grid", gridTemplateColumns: `${showColor ? "28px " : ""}1fr auto${showDescription ? " 1fr" : ""}${showSortOrder ? " 48px" : ""} auto`, gap: "0 12px", padding: "8px 12px", borderBottom: i < cats.length - 1 ? "1px solid #f0f4f8" : undefined, alignItems: "center" }}>
              {showColor ? (
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: cat.color || "#94a3b8", display: "inline-block", flexShrink: 0 }} />
              ) : null}
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1a202c" }}>{cat.name}</span>
              <span style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>{cat.slug}</span>
              {showDescription ? <span style={{ fontSize: "0.8125rem", color: "#718096" }}>{cat.description || ""}</span> : null}
              {showSortOrder ? <span style={{ fontSize: "0.8125rem", color: "#94a3b8", textAlign: "center" }}>{cat.sortOrder ?? 0}</span> : null}
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={() => startEdit(cat)} style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: "1rem", padding: 0 }} title="Edit">✎</button>
                {showDelete ? <button type="button" onClick={() => handleDelete(cat.id, cat.name)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e53e3e", fontSize: "0.9rem", padding: 0 }} title="Delete">✕</button> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit form */}
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "1.25rem", background: "#fafbfc" }}>
        <h3 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 700, color: "#1a202c" }}>
          {editId ? "Edit Category" : "New Category"}
        </h3>
        {errorMsg ? <div style={{ padding: "0.625rem", background: "#fff5f5", color: "#c53030", borderRadius: 6, marginBottom: "0.75rem", fontSize: "0.875rem" }}>{errorMsg}</div> : null}
        {statusMsg ? <div style={{ padding: "0.625rem", background: "#f0fff4", color: "#276749", borderRadius: 6, marginBottom: "0.75rem", fontSize: "0.875rem" }}>{statusMsg}</div> : null}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Name *</label>
              <input
                style={inputStyle}
                value={form.name}
                onChange={(e) => {
                  const n = e.target.value;
                  setForm((f) => ({ ...f, name: n, slug: f.slug || textToSlug(n) }));
                }}
                placeholder="Technology"
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Slug</label>
              <input
                style={inputStyle}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="technology"
              />
            </div>
          </div>
          {showDescription ? (
            <div style={fieldStyle}>
              <label style={labelStyle}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
          ) : null}
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            {showColor ? (
              <label style={fieldStyle}>
                <span style={labelStyle}>Color</span>
                <input type="color" className="builder-color-wheel-input" title="Open the color picker" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} />
              </label>
            ) : null}
            {showSortOrder ? (
              <div style={fieldStyle}>
                <label style={labelStyle}>Sort order</label>
                <input type="number" style={{ ...inputStyle, width: 80 }} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
              </div>
            ) : null}
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", marginLeft: "auto" }}>
              {editId ? (
                <button type="button" onClick={resetForm} style={{ padding: "0.5rem 1rem", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", color: "#718096", cursor: "pointer", fontSize: "0.875rem" }}>
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                disabled={saving}
                style={{ padding: "0.5rem 1.25rem", border: "none", borderRadius: 6, background: accent, color: "#fff", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontSize: "0.875rem", opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "Saving…" : editId ? "Update Category" : "Create Category"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function BlogCategoryFilterPreview({ settings }: { settings: Record<string, string> }) {
  const [apiCats, setApiCats] = useState<BlogCategory[]>([]);

  useEffect(() => {
    fetch("/api/blog/categories", { credentials: "include", headers: getCrmProjectHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.categories)) setApiCats(d.categories as BlogCategory[]); })
      .catch(() => {});
  }, []);

  const layout = settings.layout || "pills";
  const showAll = settings.showAll !== "false";
  const allLabel = settings.allLabel || "All";
  const activeColor = settings.activeColor || "#0f4f8f";
  const activeBg = settings.activeBg || activeColor;
  const inactiveColor = settings.inactiveColor || "#587592";
  const inactiveBg = settings.inactiveBg || "#f0f4f8";
  const borderRadius = parseInt(settings.borderRadius || "20", 10) || 20;
  const fontSize = parseInt(settings.fontSize || "13", 10) || 13;
  const gap = parseInt(settings.gap || "8", 10) || 8;
  const alignment = settings.alignment || "left";
  const targetPageUrl = (settings.targetPageUrl || "").trim();
  const filterParam = (settings.filterParam || "category").trim();
  const justifyMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };

  // Use real API categories; fall back to manually entered ones in settings
  let cats: Array<{ id: string; label: string; slug: string }> = [];
  if (apiCats.length > 0) {
    cats = apiCats.map((c) => ({ id: c.id, label: c.name, slug: c.slug }));
  } else {
    try {
      const parsed = JSON.parse(settings.categories || "[]");
      if (Array.isArray(parsed)) cats = parsed as typeof cats;
    } catch {}
  }

  const allItem = { id: "_all", label: allLabel, slug: "" };
  const items = showAll ? [allItem, ...cats] : cats;

  function makeHref(slug: string) {
    if (!targetPageUrl) return "#";
    const sep = targetPageUrl.includes("?") ? "&" : "?";
    return slug ? `${targetPageUrl}${sep}${filterParam}=${encodeURIComponent(slug)}` : targetPageUrl;
  }

  if (layout === "dropdown") {
    return (
      <div style={{ textAlign: alignment as "left" | "center" | "right" }}>
        <select
          style={{ padding: "0.5rem 0.75rem", borderRadius: borderRadius / 2, border: "1px solid #d1d5db", fontSize, color: inactiveColor, background: inactiveBg, cursor: "pointer" }}
          onChange={(e) => { if (e.target.value !== "_all") window.location.href = makeHref(e.target.value); else window.location.href = makeHref(""); }}
        >
          {items.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
    );
  }

  const currentCatSlug = new URLSearchParams(window.location.search).get(filterParam) ?? "";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap, justifyContent: justifyMap[alignment] || "flex-start" }}>
      {items.map((c) => {
        const isActive = c.slug === "" ? !currentCatSlug : currentCatSlug === c.slug;
        return (
          <a
            key={c.id}
            href={makeHref(c.slug)}
            style={{
              padding: `0.3rem ${borderRadius > 12 ? "0.85rem" : "0.65rem"}`,
              borderRadius,
              background: isActive ? activeBg : inactiveBg,
              color: isActive ? "#fff" : inactiveColor,
              fontSize,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            {c.label}
          </a>
        );
      })}
    </div>
  );
}

function BlogTagCloudPreview({ settings }: { settings: Record<string, string> }) {
  let tags: Array<{ id: string; label: string; slug: string; count?: number }> = [];
  try {
    tags = JSON.parse(settings.tags || "[]") as typeof tags;
  } catch {}
  if (!tags.length) {
    tags = [
      { id: "a", label: "News", slug: "news" },
      { id: "b", label: "Tutorial", slug: "tutorial" },
      { id: "c", label: "Design", slug: "design" }
    ];
  }
  const activeColor = settings.activeColor || "#0f4f8f";
  const inactiveBg = settings.inactiveBg || "#f3f4f6";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: settings.gap || "0.5rem" }}>
      {tags.map((tag) => (
        <span
          key={tag.id}
          style={{
            padding: "0.3rem 0.85rem",
            borderRadius: "999px",
            background: inactiveBg,
            color: activeColor,
            fontSize: "0.8rem",
            cursor: "pointer"
          }}
        >
          {tag.label}
          {settings.showCounts !== "false" && tag.count ? ` (${tag.count})` : ""}
        </span>
      ))}
    </div>
  );
}

function BlogPostTagsPreview({ settings }: { settings: Record<string, string> }) {
  const rawTags = settings.tags || "";
  const tags = rawTags
    ? rawTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : ["Example", "Tag"];
  const layout = settings.layout || "pills";
  const color = settings.color || "#0f4f8f";
  const bgColor = settings.bgColor || "#eff6ff";
  const prefix = settings.prefix || "Tags:";
  const showPrefix = (settings.showPrefix ?? "true") !== "false";

  if (layout === "inline") {
    return (
      <p style={{ fontSize: "0.875rem", color: "#4a5568" }}>
        {showPrefix ? <strong>{prefix} </strong> : null}
        {tags.join(", ")}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
      {showPrefix ? (
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#6b7280" }}>{prefix}</span>
      ) : null}
      {tags.map((tag, i) => (
        <span
          key={i}
          style={{
            padding: "0.2rem 0.7rem",
            borderRadius: settings.borderRadius || "999px",
            background: bgColor,
            color,
            fontSize: settings.fontSize || "0.75rem"
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function BlogPostViewPreview({ settings }: { settings: Record<string, string> }) {
  type LivePost = BlogPostRecord & {
    body?: string;
    author?: string;
    excerpt?: string;
    published_at?: string;
    publishedAt?: string;
    featuredImageUrl?: string;
    status?: string;
  };

  const [postSlug, setPostSlug] = useState("");
  const [post, setPost] = useState<LivePost | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    function syncSlugFromUrl() {
      setPostSlug(new URLSearchParams(window.location.search).get("post") ?? "");
    }
    syncSlugFromUrl();
    window.addEventListener("popstate", syncSlugFromUrl);
    return () => window.removeEventListener("popstate", syncSlugFromUrl);
  }, []);

  useEffect(() => {
    if (!postSlug) {
      setPost(null);
      setNotFound(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotFound(false);
    fetch(`/api/blog/posts/${encodeURIComponent(postSlug)}?by=slug`, {
      credentials: "include",
      headers: getCrmProjectHeaders()
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const raw = d?.data ?? d?.post ?? null;
        if (!raw || typeof raw !== "object") {
          setPost(null);
          setNotFound(true);
          return;
        }
        setPost(raw as LivePost);
      })
      .catch(() => {
        setPost(null);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [postSlug]);

  if (postSlug) {
    if (loading) {
      return <div className="builder-blog-post-manager-stub">Loading post…</div>;
    }
    if (notFound || !post) {
      return (
        <div className="builder-blog-post-manager-stub">
          Post not found. It may be unpublished or the link is incorrect.
        </div>
      );
    }

    const imageUrl = blogPostFeaturedImageUrl(post as unknown as Record<string, unknown>);
    const pubRaw = post.published_at || post.publishedAt || "";
    const pubDate = pubRaw
      ? new Date(pubRaw).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "";
    const showFeaturedImage = (settings.showFeaturedImage ?? "true") !== "false";
    const showExcerpt = (settings.showExcerpt ?? "true") !== "false";
    const showAuthor = (settings.showAuthor ?? "true") !== "false";
    const showDate = (settings.showDate ?? "true") !== "false";

    return (
      <article className="blog-post-page">
        <div className="blog-post-header">
          {showFeaturedImage && imageUrl ? (
            <img alt={post.title} className="blog-post-featured-image" src={imageUrl} />
          ) : null}
          <h1 className="blog-post-title">{post.title}</h1>
          {(showAuthor && post.author) || (showDate && pubDate) ? (
            <p className="blog-post-meta blog-card-date">
              {showAuthor && post.author ? <>By {post.author}</> : null}
              {showAuthor && post.author && showDate && pubDate ? " · " : null}
              {showDate && pubDate ? pubDate : null}
            </p>
          ) : null}
          {showExcerpt && post.excerpt ? (
            <p className="blog-post-excerpt">{post.excerpt}</p>
          ) : null}
        </div>
        {post.body ? (
          <div
            className="blog-post-body builder-preview-text"
            dangerouslySetInnerHTML={{ __html: formatRichTextContent(post.body) || "" }}
          />
        ) : null}
      </article>
    );
  }

  // Canvas preview (no ?post= in URL) — show placeholder from settings
  const title = settings.title || "Post Title";
  const body = settings.body || "";
  const author = settings.author || "";
  const excerpt = settings.excerpt || "";

  return (
    <article className="blog-post-page">
      <div className="blog-post-header">
        <h1 className="blog-post-title">{title}</h1>
        {author ? <p className="blog-post-meta">By {author}</p> : null}
        {excerpt ? <p className="blog-post-excerpt">{excerpt}</p> : null}
      </div>
      {body ? (
        <div
          className="blog-post-body builder-preview-text"
          dangerouslySetInnerHTML={{ __html: formatRichTextContent(body) || "" }}
        />
      ) : (
        <p className="blog-post-body" style={{ color: "#9ca3af" }}>Post body will appear here when opened with ?post=slug.</p>
      )}
    </article>
  );
}

function BlogNewsletterSubscribePreview({
  settings,
  theme,
  themePalette,
  projectId = ""
}: {
  settings: Record<string, string>;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
  projectId?: string;
}) {
  const headline = settings.headline || "Stay in the loop";
  const description = settings.description || "";
  const bgColor = settings.bgColor || "#eaf4ff";
  const crmFormId = settings.crmFormId ?? "";
  const showImage = settings.showImage === "true";
  const imageUrl = settings.imageUrl ?? "";

  return (
    <div style={{ background: bgColor, borderRadius: 8, padding: "1.5rem" }}>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        {showImage && imageUrl ? (
          <img
            alt=""
            src={imageUrl}
            style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          {headline ? (
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.125rem", fontWeight: 700 }}>{headline}</h3>
          ) : null}
          {description ? (
            <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#4a5568" }}>{description}</p>
          ) : null}
          {crmFormId ? (
            <CrmFormPreview settings={settings} theme={theme} themePalette={themePalette} projectId={projectId} />
          ) : (
            <div className="builder-contact-form-stub">
              Paste a CRM Form ID in module settings to activate this newsletter block.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlogRelatedPostsPreview({ settings }: { settings: Record<string, string> }) {
  const matchBy = settings.matchBy ?? "categories";
  const isManual = matchBy === "manual";
  const count = Math.max(1, parseInt(settings.count ?? "3", 10) || 3);
  const layout = settings.layout ?? "grid";
  const cols = Math.max(1, parseInt(settings.columns ?? "3", 10) || 3);
  const cardGap = parseInt(settings.cardGap ?? "20", 10) || 20;
  const cardStyle = settings.cardStyle ?? "default";
  const showFeaturedImage = (settings.showFeaturedImage ?? "true") !== "false";
  const showExcerpt = settings.showExcerpt === "true";
  const showAuthor = settings.showAuthor === "true";
  const showDate = (settings.showDate ?? "true") !== "false";
  const showCategories = (settings.showCategories ?? "true") !== "false";
  const showTitle = (settings.showTitle ?? "true") !== "false";
  const titleText = settings.title || "You Might Also Like";
  const postPageUrl = (settings.postPageUrl || "").trim() || defaultBlogPostViewPath();
  const imgAspectRatioMap: Record<string, string> = {
    "16:9": "16/9",
    "4:3": "4/3",
    "3:2": "3/2",
    "1:1": "1/1"
  };
  const imgAspectRatio = imgAspectRatioMap[settings.imageAspectRatio ?? "16:9"] ?? "16/9";

  const [postSlug, setPostSlug] = useState(() =>
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("post") ?? "")
      : ""
  );
  const [relatedPosts, setRelatedPosts] = useState<BlogPostRecord[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [loading, setLoading] = useState(!isManual);

  useEffect(() => {
    function sync() {
      setPostSlug(new URLSearchParams(window.location.search).get("post") ?? "");
    }
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (isManual) {
      setLoading(false);
      return;
    }
    if (!postSlug) {
      setRelatedPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const headers = getCrmProjectHeaders();

    Promise.all([
      fetch(`/api/blog/posts/${encodeURIComponent(postSlug)}?by=slug`, {
        credentials: "include",
        headers
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/blog/posts?status=published&limit=100`, {
        credentials: "include",
        headers
      }).then((r) => (r.ok ? r.json() : null)),
      showCategories
        ? fetch("/api/blog/categories", { credentials: "include", headers }).then((r) =>
            r.ok ? r.json() : null
          )
        : Promise.resolve(null)
    ])
      .then(([currentData, allData, catData]) => {
        const current: BlogPostRecord | null =
          (currentData?.data ?? currentData?.post ?? null) as BlogPostRecord | null;
        const allPosts: BlogPostRecord[] = Array.isArray(allData?.posts)
          ? (allData.posts as BlogPostRecord[])
          : [];
        const fetchedCats: BlogCategory[] = Array.isArray(catData?.categories)
          ? (catData.categories as BlogCategory[])
          : [];

        if (fetchedCats.length > 0) setCategories(fetchedCats);

        if (!current) {
          setRelatedPosts([]);
          return;
        }

        const filtered = allPosts.filter((p) => {
          if (p.slug === current.slug) return false;
          if (matchBy === "tags") {
            return (current.tags ?? []).some((t) => p.tags?.includes(t));
          }
          const sharedCat = (current.categoryIds ?? []).some((id) => p.categoryIds?.includes(id));
          if (matchBy === "categories") return sharedCat;
          const sharedTag = (current.tags ?? []).some((t) => p.tags?.includes(t));
          return sharedCat || sharedTag;
        });

        setRelatedPosts(filtered.slice(0, count));
      })
      .catch(() => setRelatedPosts([]))
      .finally(() => setLoading(false));
  }, [postSlug, isManual, matchBy, count, showCategories]);

  const manualPosts = useMemo((): Array<{
    id: string;
    title: string;
    imageUrl: string;
    url: string;
    date: string;
    categories: string;
  }> => {
    if (!isManual) return [];
    try {
      const parsed = JSON.parse(settings.manualPosts || "[]") as unknown;
      return Array.isArray(parsed) ? (parsed as typeof manualPosts).slice(0, count) : [];
    } catch {
      return [];
    }
  }, [isManual, settings.manualPosts, count]);

  const cardBorderStyle: CSSProperties =
    cardStyle === "shadow"
      ? { border: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }
      : { border: "1px solid #e2e8f0", boxShadow: "none" };

  const gridStyle: CSSProperties =
    layout === "list"
      ? { display: "flex", flexDirection: "column", gap: `${cardGap}px` }
      : { display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: `${cardGap}px` };

  const cardBase: CSSProperties = { ...cardBorderStyle, borderRadius: 8, overflow: "hidden", background: "#fff" };

  const sectionTitle = showTitle ? (
    <h3 style={{ margin: "0 0 1rem", fontSize: "1.125rem", fontWeight: 700 }}>{titleText}</h3>
  ) : null;

  if (loading) {
    return (
      <div>
        {sectionTitle}
        <div style={{ color: "#888", fontSize: "0.875rem" }}>Loading related posts…</div>
      </div>
    );
  }

  if (isManual) {
    if (manualPosts.length === 0) {
      return (
        <div>
          {sectionTitle}
          <div
            style={{
              padding: "1.5rem",
              border: "1px dashed #d1d5db",
              borderRadius: 8,
              textAlign: "center",
              color: "#9ca3af",
              fontSize: "0.875rem"
            }}
          >
            Add posts in module settings.
          </div>
        </div>
      );
    }
    return (
      <div>
        {sectionTitle}
        <div style={gridStyle}>
          {manualPosts.map((p) => (
            <article
              key={p.id}
              style={{ ...cardBase, display: "flex", flexDirection: layout === "list" ? "row" : "column" }}
            >
              {showFeaturedImage && p.imageUrl ? (
                layout === "list" ? (
                  <div style={{ flexShrink: 0, width: 140, overflow: "hidden" }}>
                    <img
                      alt={p.title}
                      src={p.imageUrl}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                ) : (
                  <div style={{ overflow: "hidden", aspectRatio: imgAspectRatio }}>
                    <img
                      alt={p.title}
                      src={p.imageUrl}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                )
              ) : null}
              <div style={{ padding: "0.875rem 1rem", flex: 1 }}>
                {showCategories && p.categories ? (
                  <div
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#0f4f8f",
                      marginBottom: "0.25rem"
                    }}
                  >
                    {p.categories}
                  </div>
                ) : null}
                <h4 style={{ margin: "0 0 0.375rem", fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.3 }}>
                  <a href={p.url || "#"} style={{ color: "#1a202c", textDecoration: "none" }}>
                    {p.title}
                  </a>
                </h4>
                {showDate && p.date ? (
                  <div style={{ fontSize: "0.8125rem", color: "#a0aec0" }}>{p.date}</div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (!postSlug) {
    return (
      <div>
        {sectionTitle}
        <div
          style={{
            padding: "1.5rem",
            border: "1px dashed #d1d5db",
            borderRadius: 8,
            textAlign: "center",
            color: "#9ca3af",
            fontSize: "0.875rem"
          }}
        >
          Related posts appear here when viewing a blog post.
        </div>
      </div>
    );
  }

  if (relatedPosts.length === 0) {
    return null;
  }

  return (
    <div>
      {sectionTitle}
      <div style={gridStyle}>
        {relatedPosts.map((post) => {
          const sep = postPageUrl.includes("?") ? "&" : "?";
          const href = `${postPageUrl}${sep}post=${encodeURIComponent(post.slug)}`;
          const postCats = showCategories ? categories.filter((c) => post.categoryIds?.includes(c.id)) : [];
          const dateStr = post.published_at
            ? new Date(post.published_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric"
              })
            : "";
          const imageUrl = post.featuredImageUrl || post.featured_image_url || "";
          return (
            <article
              key={post.id}
              style={{ ...cardBase, display: "flex", flexDirection: layout === "list" ? "row" : "column" }}
            >
              {showFeaturedImage && imageUrl && layout === "list" ? (
                <div style={{ flexShrink: 0, width: 140, overflow: "hidden" }}>
                  <img
                    alt={post.title}
                    src={imageUrl}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </div>
              ) : null}
              <div style={{ padding: "0.875rem 1rem", flex: 1 }}>
                {postCats.length > 0 ? (
                  <div
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#0f4f8f",
                      marginBottom: "0.25rem"
                    }}
                  >
                    {postCats.map((c) => c.name).join(", ")}
                  </div>
                ) : null}
                {showFeaturedImage && imageUrl && layout !== "list" ? (
                  <div
                    style={{
                      width: "calc(100% + 2rem)",
                      marginLeft: "-1rem",
                      marginTop: "-0.875rem",
                      marginBottom: "0.75rem",
                      overflow: "hidden",
                      aspectRatio: imgAspectRatio
                    }}
                  >
                    <img
                      alt={post.title}
                      src={imageUrl}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                ) : null}
                <h4 style={{ margin: "0 0 0.375rem", fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.3 }}>
                  <a href={href} style={{ color: "#1a202c", textDecoration: "none" }}>
                    {post.title}
                  </a>
                </h4>
                {showExcerpt && post.excerpt ? (
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", color: "#4a5568", lineHeight: 1.5 }}>
                    {post.excerpt}
                  </p>
                ) : null}
                {(showAuthor && post.author) || (showDate && dateStr) ? (
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                      fontSize: "0.8125rem",
                      color: "#a0aec0",
                      marginTop: "0.375rem"
                    }}
                  >
                    {showAuthor && post.author ? <span>{post.author}</span> : null}
                    {showDate && dateStr ? <span>{dateStr}</span> : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function BlogSearchPreview({ settings }: { settings: Record<string, string> }) {
  const searchParam = (settings.searchParam || "search").trim();
  const targetPageUrl = (settings.targetPageUrl || "").trim();
  const placeholder = settings.placeholder || "Search posts…";
  const buttonLabel = settings.buttonLabel || "Search";
  const accent = settings.accentColor || "#0f4f8f";
  const radius = parseInt(settings.borderRadius || "8", 10) || 8;

  const initialQuery =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get(searchParam) ?? ""
      : "";

  const [query, setQuery] = useState(initialQuery);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (typeof window === "undefined") return;
    const base = targetPageUrl || window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (query.trim()) {
      params.set(searchParam, query.trim());
    } else {
      params.delete(searchParam);
    }
    window.location.href = `${base}${params.toString() ? "?" + params.toString() : ""}`;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          height: 40,
          padding: "0 12px",
          border: "1px solid #c6d8e8",
          borderRadius: radius,
          fontSize: 14,
          color: "#18324a",
          background: "#fff",
          outline: "none"
        }}
      />
      <button
        type="submit"
        style={{
          height: 40,
          padding: "0 18px",
          background: accent,
          color: "#fff",
          border: "none",
          borderRadius: radius,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0
        }}
      >
        {buttonLabel}
      </button>
    </form>
  );
}

function BlogSearchResultsPreview({ settings }: { settings: Record<string, string> }) {
  const searchParam = (settings.searchParam || "search").trim();
  const limit = Math.max(1, parseInt(settings.limit || "50", 10) || 50);
  const thumbWidth = Math.max(60, parseInt(settings.thumbWidth || "120", 10) || 120);
  const emptyMessage = settings.emptyMessage || "No posts found.";
  const postPageUrl = (settings.postPageUrl || "").trim() || defaultBlogPostViewPath();

  const [allPosts, setAllPosts] = useState<(BlogPostRecord & { updatedAt?: string; categoryIds?: string[] })[]>([]);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = (new URLSearchParams(window.location.search).get(searchParam) ?? "").trim().toLowerCase().replace(/-/g, " ");
    setQuery(q);
  }, [searchParam]);

  useEffect(() => {
    const headers = getCrmProjectHeaders();
    const fetchPosts = fetch(`/api/blog/posts?status=published&limit=${limit}`, {
      credentials: "include",
      headers
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.posts)) {
          setAllPosts(d.posts as (BlogPostRecord & { updatedAt?: string; categoryIds?: string[] })[]);
        }
      })
      .catch(() => {});

    const fetchCategories = fetch("/api/blog/categories", {
      credentials: "include",
      headers
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const cats = Array.isArray(d?.categories) ? d.categories : [];
        const map: Record<string, string> = {};
        for (const c of cats) {
          if (c.id && c.name) map[String(c.id)] = String(c.name).toLowerCase();
        }
        setCategoryNames(map);
      })
      .catch(() => {});

    Promise.all([fetchPosts, fetchCategories]).finally(() => setLoading(false));
  }, [limit]);

  const filtered = useMemo(() => {
    if (!query) return allPosts;
    return allPosts.filter((p) => {
      const catText = (p.categoryIds ?? []).map((id) => categoryNames[id] ?? "").join(" ");
      const haystack = [p.title, p.excerpt, ...(p.tags ?? []), catText].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [allPosts, categoryNames, query]);

  function postHref(p: BlogPostRecord) {
    return `${postPageUrl}?post=${encodeURIComponent(p.slug)}`;
  }

  function formatDate(iso?: string) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  if (loading) {
    return <div style={{ color: "#8aa", fontSize: 13, padding: "20px 0" }}>Loading…</div>;
  }

  if (!query) {
    return (
      <div style={{ color: "#8aa", fontSize: 13, padding: "20px 0", fontStyle: "italic" }}>
        Enter a search term above to find posts.
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div style={{ color: "#8aa", fontSize: 13, padding: "20px 0", fontStyle: "italic" }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {filtered.map((post, i) => {
        const imgUrl = post.featuredImageUrl || post.featured_image_url;
        const updatedLabel = formatDate((post as { updatedAt?: string }).updatedAt || post.published_at);
        return (
          <a
            key={post.id}
            href={postHref(post)}
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              padding: "14px 0",
              borderBottom: i < filtered.length - 1 ? "1px solid #e8eef4" : "none",
              textDecoration: "none",
              color: "inherit"
            }}
          >
            {/* Thumbnail */}
            <div
              style={{
                width: thumbWidth,
                flexShrink: 0,
                aspectRatio: "16/9",
                borderRadius: 6,
                overflow: "hidden",
                background: "#d4e3ef"
              }}
            >
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : null}
            </div>

            {/* Title + excerpt */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  color: "#18324a",
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {post.title}
              </div>
              {post.excerpt ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "#587592",
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden"
                  }}
                >
                  {post.excerpt}
                </div>
              ) : null}
            </div>

            {/* Last Updated */}
            <div
              style={{
                flexShrink: 0,
                textAlign: "right",
                minWidth: 80
              }}
            >
              <div style={{ fontSize: 10, color: "#8aa", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                Last Updated
              </div>
              <div style={{ fontSize: 12, color: "#587592", fontWeight: 500 }}>
                {updatedLabel || "—"}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

// ── Site Search ───────────────────────────────────────────────────────────────

/**
 * Site Search reads the SAME payload the public site already downloads to
 * render itself (`GET /api/public/pages`), so the search box needs no new
 * endpoint and no new public data. The ranking lives in `@/lib/site-search`,
 * away from React, where it can be tested.
 */

/**
 * A2: an empty Button Color means "follow the theme", and only when the theme
 * has nothing either does the shared default apply.
 *
 * The explicit `""` fallback on every call is the whole point.
 * `normalizeBuilderHexColor` defaults to WHITE when handed an empty string, so
 * the obvious `normalizeBuilderHexColor(a) || normalizeBuilderHexColor(b) || c`
 * never falls through — the first call answers "#ffffff" and the search button
 * ships white on white. Caught by the render test, not by review.
 */
function siteSearchAccent(settings: Record<string, string>, palette?: CrmThemePalette): string {
  return (
    normalizeBuilderHexColor(settings.accentColor, "")
    || normalizeBuilderHexColor(palette?.accentColor, "")
    || normalizeBuilderHexColor(palette?.primaryColor, "")
    || "#0f4f8f"
  );
}

function siteSearchRadius(settings: Record<string, string>): number {
  const parsed = Number.parseInt(settings.borderRadius || "8", 10);
  return Number.isFinite(parsed) ? Math.min(40, Math.max(0, parsed)) : 8;
}

/** The query currently in the URL, kept in sync when the visitor uses Back. */
function useSiteSearchQueryParam(searchParam: string): string {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => setQuery((new URLSearchParams(window.location.search).get(searchParam) ?? "").trim());
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [searchParam]);

  return query;
}

/** A bounded whole number from a setting, or the fallback when it is unset. */
function siteSearchNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/**
 * Every style setting, as CSS custom properties on the form.
 *
 * Variables rather than inline styles on each element, for two reasons.
 * Standard 3: the structural rules stay in the stylesheet's BASE ruleset where
 * a media query can adjust them — inline styles cannot be overridden by a
 * breakpoint at all, so a hard-coded field width would survive onto a phone
 * and push the page sideways. And an unset setting emits NO variable, so the
 * stylesheet's own `var(--x, fallback)` decides — which is what keeps "empty
 * means follow the theme" (A2) true for every one of these at once.
 */
function siteSearchFieldVars(
  settings: Record<string, string>,
  themePalette?: CrmThemePalette
): CSSProperties {
  const radius = siteSearchRadius(settings);
  const vars: Record<string, string> = {
    "--site-search-radius": `${radius}px`,
    "--site-search-btn-bg": siteSearchAccent(settings, themePalette)
  };

  const set = (name: string, value: string | undefined) => {
    const clean = String(value ?? "").trim();
    if (clean) vars[name] = clean;
  };

  // Field. Width 0 means "grow to fill the row", which is the default.
  const fieldWidth = siteSearchNumber(settings.fieldWidth, 0, 0, 1200);
  if (fieldWidth > 0) {
    vars["--site-search-field-grow"] = "0";
    // Shrink off too, or the field collapses to whatever the shrink-wrapped
    // module box happens to be and elbows the button onto the next line.
    vars["--site-search-field-shrink"] = "0";
    vars["--site-search-field-basis"] = `${fieldWidth}px`;
  }
  vars["--site-search-field-height"] = `${siteSearchNumber(settings.fieldHeight, 40, 24, 96)}px`;

  // Button text.
  set("--site-search-btn-text", normalizeBuilderHexColor(settings.buttonTextColor, ""));
  const btnSize = siteSearchNumber(settings.buttonFontSize, 0, 8, 48);
  if (btnSize > 0) vars["--site-search-btn-size"] = `${btnSize}px`;
  if (settings.buttonBold === "false") vars["--site-search-btn-weight"] = "400";

  // Button border. A width with no color would paint the browser default,
  // so the color carries its own visible fallback in the stylesheet.
  const btnBorder = siteSearchNumber(settings.buttonBorderWidth, 0, 0, 12);
  vars["--site-search-btn-border-width"] = `${btnBorder}px`;
  set("--site-search-btn-border-color", normalizeBuilderHexColor(settings.buttonBorderColor, ""));
  set("--site-search-btn-border-style", settings.buttonBorderStyle);

  // Label.
  set("--site-search-label-color", normalizeBuilderHexColor(settings.labelColor, ""));
  const labelSize = siteSearchNumber(settings.labelFontSize, 0, 8, 48);
  if (labelSize > 0) vars["--site-search-label-size"] = `${labelSize}px`;
  if (settings.labelBold === "true") vars["--site-search-label-weight"] = "700";

  return vars as CSSProperties;
}

function SiteSearchField({
  settings,
  themePalette,
  initialQuery
}: {
  settings: Record<string, string>;
  themePalette?: CrmThemePalette;
  initialQuery: string;
}) {
  const searchParam = (settings.searchParam || "q").trim() || "q";
  const targetPageUrl = (settings.targetPageUrl || "").trim();
  const placeholder = settings.placeholder || "Search this site…";
  const buttonLabel = settings.buttonLabel || "Search";
  const showButton = (settings.showButton ?? "true") !== "false";
  const showLabel = settings.showLabel === "true";
  const labelText = settings.labelText || "Search";
  // "above" puts the label on its own line; "inline" sits it before the field.
  const labelPosition = settings.labelPosition === "inline" ? "inline" : "above";
  const inputId = useId();

  const [value, setValue] = useState(initialQuery);
  useEffect(() => setValue(initialQuery), [initialQuery]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (typeof window === "undefined") return;
    const base = targetPageUrl || window.location.pathname;
    const params = new URLSearchParams(targetPageUrl ? "" : window.location.search);
    const trimmed = value.trim();
    if (trimmed) params.set(searchParam, trimmed);
    else params.delete(searchParam);
    const qs = params.toString();
    window.location.href = qs ? `${base}?${qs}` : base;
  }

  // Standard 8: the input always has a real label. Showing it is a style
  // choice; HAVING it is not, so "hidden" means visually hidden, never absent.
  const labelClass = showLabel
    ? `builder-site-search-label is-visible is-${labelPosition}`
    : "builder-site-search-label";

  return (
    <form
      className={`builder-site-search-form${showLabel && labelPosition === "above" ? " has-label-above" : ""}`}
      onSubmit={handleSubmit}
      role="search"
      style={siteSearchFieldVars(settings, themePalette)}
    >
      <label className={labelClass} htmlFor={inputId}>
        {showLabel ? labelText : placeholder}
      </label>
      <input
        id={inputId}
        className="builder-site-search-input"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
      {showButton ? (
        <button className="builder-site-search-submit" type="submit">
          {buttonLabel}
        </button>
      ) : null}
    </form>
  );
}

function SiteSearchPreview({
  settings,
  themePalette
}: {
  settings: Record<string, string>;
  themePalette?: CrmThemePalette;
}) {
  const searchParam = (settings.searchParam || "q").trim() || "q";
  const query = useSiteSearchQueryParam(searchParam);
  return <SiteSearchField settings={settings} themePalette={themePalette} initialQuery={query} />;
}

/** Snippet with the matched run marked. Text nodes only — never raw HTML. */
function SiteSearchSnippet({ match }: { match: SiteSearchMatch }) {
  const { snippet, highlights } = match;
  if (!highlights.length) return <>{snippet}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  highlights.forEach((range, i) => {
    const start = Math.max(cursor, Math.min(range.start, snippet.length));
    const end = Math.max(start, Math.min(range.end, snippet.length));
    if (start > cursor) parts.push(snippet.slice(cursor, start));
    if (end > start) parts.push(<mark key={`h${i}`}>{snippet.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < snippet.length) parts.push(snippet.slice(cursor));
  return <>{parts}</>;
}

const SITE_SEARCH_KIND_LABELS: Record<SiteSearchMatch["kind"], string> = {
  pageName: "page name",
  title: "heading",
  body: "page content",
  meta: "image and link text"
};

function SiteSearchResultsPreview({
  settings,
  themePalette,
  projectId: projectIdProp = ""
}: {
  settings: Record<string, string>;
  themePalette?: CrmThemePalette;
  projectId?: string;
}) {
  const searchParam = (settings.searchParam || "q").trim() || "q";
  const limit = Math.max(1, Number.parseInt(settings.limit || "50", 10) || 50);
  const showSearchField = (settings.showSearchField ?? "true") !== "false";
  const showResultCount = (settings.showResultCount ?? "true") !== "false";
  const showOtherMatches = (settings.showOtherMatches ?? "true") !== "false";
  const showMatchLocation = (settings.showMatchLocation ?? "false") === "true";
  const emptyMessage = settings.emptyMessage || "Nothing on this site matched that search.";
  const accent = siteSearchAccent(settings, themePalette);

  const query = useSiteSearchQueryParam(searchParam);

  const [pages, setPages] = useState<SiteSearchPageInput[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const projectId = projectIdProp || resolveSessionProjectId();
    if (!projectId) {
      setFailed(true);
      return;
    }
    fetch(`/api/public/pages?projectId=${encodeURIComponent(projectId)}`, {
      credentials: "include",
      headers: starcasterScopedHeaders()
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return;
        const list = Array.isArray(body?.pages) ? (body.pages as SiteSearchPageInput[]) : null;
        if (list) setPages(list);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectIdProp]);

  // Indexing walks every module on every page, so it is cached against the
  // payload rather than redone on each keystroke or re-render.
  const index = useMemo(() => (pages ? buildSiteSearchIndex(pages) : null), [pages]);

  const results = useMemo<SiteSearchResult[]>(
    () => (index && query ? searchSite(query, index, { limit }) : []),
    [index, query, limit]
  );

  const field = showSearchField ? (
    <SiteSearchField settings={settings} themePalette={themePalette} initialQuery={query} />
  ) : null;

  // Standard 5: every one of these is a designed state, not a blank box.
  let body: React.ReactNode;
  if (!query) {
    body = <p className="builder-site-search-note">Type something above to search this site.</p>;
  } else if (failed) {
    body = <p className="builder-site-search-note">Search is unavailable right now. Please try again shortly.</p>;
  } else if (!index) {
    body = <p className="builder-site-search-note">Searching…</p>;
  } else if (!results.length) {
    body = <p className="builder-site-search-note">{emptyMessage}</p>;
  } else {
    body = (
      <>
        {showResultCount ? (
          <p className="builder-site-search-count">
            {results.length === 1 ? "1 page matches" : `${results.length} pages match`} “{query}”
          </p>
        ) : null}
        <ol className="builder-site-search-results">
          {results.map((result) => (
            <li className="builder-site-search-result" key={result.pageId}>
              <a className="builder-site-search-result-title" href={result.href} style={{ color: accent }}>
                {result.pageName}
              </a>
              <p className="builder-site-search-result-snippet">
                <SiteSearchSnippet match={result.topMatch} />
              </p>
              {showMatchLocation ? (
                <p className="builder-site-search-result-where">
                  Found in {SITE_SEARCH_KIND_LABELS[result.topMatch.kind]}
                  {result.topMatch.moduleName ? ` — ${result.topMatch.moduleName}` : ""}
                </p>
              ) : null}
              {showOtherMatches && result.otherMatches.length ? (
                <ul className="builder-site-search-result-more">
                  {result.otherMatches.map((match, i) => (
                    <li key={`${result.pageId}-more-${i}`}>
                      <SiteSearchSnippet match={match} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </>
    );
  }

  return (
    <div className="builder-site-search-panel">
      {field}
      {body}
    </div>
  );
}

function BlogModulePlaceholder({ type }: { type: string }) {
  const labels: Record<string, string> = {
    "blog-post-card": "Post Card",
    "blog-author-bio": "Author Bio",
    "blog-toc": "Table of Contents"
  };
  return (
    <div
      style={{
        padding: "1.5rem",
        border: "1px dashed #d1d5db",
        borderRadius: 8,
        textAlign: "center",
        color: "#9ca3af",
        fontSize: "0.875rem"
      }}
    >
      {labels[type] || type}
    </div>
  );
}

/**
 * The Carousel — one renderer for both formats.
 *
 * `slideshow` and `slider` were separate module types until 2026-08-16.
 * They were never two different mechanisms: both hold an ordered row of
 * items and move through it. They differed in exactly two settings, each
 * hard-coded at opposite extremes — how many items share the frame, and
 * whether it advances on its own. Because those were fixed rather than
 * chosen, neither could ever borrow the other's behaviour: a slideshow had
 * no arrows and no clickable slides, a card shelf could not rotate.
 *
 * `format` is that choice, made once, and everything downstream reads from
 * it. The union of the two old setting sets applies to both formats except
 * where a setting is meaningless — see `formatSupports` below, which is the
 * single place that judgement is written down so the settings panel and this
 * renderer cannot disagree about it.
 */
function CarouselPreview({
  module
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
}) {
  const settings = module.settings;
  const format = settings.format === "cards" ? "cards" : "slideshow";
  const isCards = format === "cards";

  // Empty-image items are dropped at display time but kept in storage — a
  // just-added item must survive until its picture is picked. Cards may
  // legitimately have no image at all, so they only need SOME content.
  const items = useMemo(() => {
    const parsed = parseBuilderCardItems(settings.items, "item");
    return isCards
      ? parsed.filter((item) => item.imageUrl || item.title || item.body)
      : parsed.filter((item) => item.imageUrl);
  }, [settings.items, isCards]);

  const intervalMs = Math.max(Number.parseInt(settings.intervalMs ?? "5000", 10) || 5000, 1000);
  const transition = !isCards && settings.transition === "fade" ? "fade" : "slide";
  const heightPx = Number.parseInt(settings.heightPx ?? "", 10) || 0;
  const gap = Number.parseInt(settings.gap ?? (isCards ? "16" : "0"), 10) || 0;
  const cardWidth = Number.parseInt(settings.cardWidth ?? "280", 10) || 280;
  const autoplay = settings.autoplay === undefined ? !isCards : settings.autoplay !== "false";
  const pauseOnHover = settings.pauseOnHover !== "false";
  const loop = settings.loop !== "false";
  const showArrows = settings.showArrows !== "false";
  const showDots = settings.showDots === undefined ? !isCards : settings.showDots !== "false";
  const showCaptions = settings.showCaptions === "true";
  const captionPosition = settings.captionPosition || "bottom-left";

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const count = items.length;
  const step = cardWidth + gap;
  const setWidth = count * step;

  /**
   * Does the shelf hold more than it can show?
   *
   * Looping is built by rendering the cards three times over, so only the
   * middle copy is ever on screen and the strip can be walked past either end
   * without running out. That trick is worse than useless when the whole set
   * already fits: two cards on a wide page would render as "A B A B A B",
   * visibly repeating with nothing gained. Measured rather than guessed,
   * because it depends on the container the module happens to land in.
   */
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    if (!isCards) return;
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setOverflows(setWidth > el.clientWidth + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isCards, setWidth]);

  const loopCards = isCards && loop && overflows && count > 1;
  const copies = loopCards ? 3 : 1;

  /**
   * Park on the middle copy so there is a whole set of cards waiting on each
   * side. Runs when looping turns on, and again if the card geometry changes
   * under it.
   */
  useEffect(() => {
    if (!loopCards) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = setWidth;
    targetRef.current = setWidth;
  }, [loopCards, setWidth]);

  /**
   * The seam. Once scrolling settles, if the strip has walked off the middle
   * copy, put it back by exactly one set-width. The three copies are
   * identical, so the jump lands on the same picture in the same place and is
   * invisible — which is what makes the first card come round again instead
   * of the shelf dead-ending (operator, 2026-08-16).
   *
   * AFTER it settles, not during: a smooth scroll is still animating toward a
   * target, and moving the ground under it mid-flight lands somewhere nobody
   * asked for. `scrollend` would say this exactly, but Safari does not have
   * it, so the 120ms quiet period stands in.
   */
  useEffect(() => {
    if (!isCards) return;
    const el = scrollRef.current;
    if (!el) return;
    let settle = 0;

    function onScroll() {
      if (!el) return;
      // The dots follow the eye immediately, even mid-drag.
      const at = Math.round(el.scrollLeft / Math.max(step, 1));
      setIndex(count > 0 ? ((at % count) + count) % count : 0);

      if (!loopCards) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (!el) return;
        const shift = carouselSeamShift(el.scrollLeft, setWidth);
        if (shift) {
          el.scrollLeft += shift;
          if (targetRef.current != null) {
            // The pending target moves with the ground...
            targetRef.current += shift;
            // ...and the journey is restarted, because assigning `scrollLeft`
            // cancels any smooth scroll still running. Without this, a press
            // that lands while the strip is crossing the seam is thrown away
            // — eight quick presses moved seven cards.
            if (Math.abs(el.scrollLeft - targetRef.current) > 1) {
              el.scrollTo({ left: targetRef.current, behavior: "smooth" });
            }
          }
        }
        // Adopt reality only once the strip has actually arrived. A target
        // still some distance off means something is mid-flight toward it,
        // and overwriting it here would drop that step. Far-off with nothing
        // in flight is a swipe, which is exactly when adopting is right.
        if (targetRef.current == null || Math.abs(el.scrollLeft - targetRef.current) < step * 0.5) {
          targetRef.current = el.scrollLeft;
        }
      }, 120);
    }

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.clearTimeout(settle);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [isCards, step, count, loopCards, setWidth]);

  /**
   * Where the strip is HEADED, which is not where it currently is.
   *
   * A smooth scroll takes a moment, and every arrow press during that moment
   * used to read the half-finished position and work out its next step from
   * there — so a visitor clicking quickly got most of their presses ignored
   * (six deliberate clicks moved one card). Steps are counted from the
   * target instead, and the target is resynced to reality whenever scrolling
   * settles, which is also what absorbs a swipe.
   */
  const targetRef = useRef<number | null>(null);

  /** One card left or right, relative — position repeats while looping. */
  const nudgeCards = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const next = (targetRef.current ?? el.scrollLeft) + direction * step;
    targetRef.current = next;
    el.scrollTo({ left: next, behavior: "smooth" });
  };

  const goTo = (next: number) => {
    if (count === 0) return;
    if (isCards) {
      const el = scrollRef.current;
      if (!el) return;
      if (loopCards) {
        // Walk to the wanted card from wherever the strip is headed, rather
        // than to an absolute offset that names one of three identical
        // copies. The shorter way round wins, so the dots never take the
        // long trip past everything to reach a neighbour.
        const base = targetRef.current ?? el.scrollLeft;
        const at = Math.round(base / Math.max(step, 1));
        const to = base + carouselShortestDelta(at, next, count) * step;
        targetRef.current = to;
        el.scrollTo({ left: to, behavior: "smooth" });
        return;
      }
      const clamped = Math.min(Math.max(next, 0), count - 1);
      targetRef.current = clamped * step;
      el.scrollTo({ left: clamped * step, behavior: "smooth" });
      setIndex(clamped);
      return;
    }
    const wrapped = loop ? ((next % count) + count) % count : Math.min(Math.max(next, 0), count - 1);
    setIndex(wrapped);
  };

  useEffect(() => {
    if (!autoplay || count <= 1 || paused) return;
    const timer = window.setInterval(() => {
      if (isCards) {
        if (loopCards) {
          nudgeCards(1);
          return;
        }
        setIndex((current) => {
          const next = Math.min(current + 1, count - 1);
          scrollRef.current?.scrollTo({ left: next * step, behavior: "smooth" });
          return next;
        });
        return;
      }
      setIndex((current) => {
        const next = current + 1;
        // Autoplay respects Loop: without it the run stops on the last item
        // rather than snapping back to the first.
        return loop ? next % count : Math.min(next, count - 1);
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoplay, count, paused, intervalMs, isCards, step, loop, loopCards]);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) {
    return (
      <div className="builder-preview-carousel builder-preview-carousel-empty">
        {isCards ? "Add cards in the editor" : "Add slides in the editor"}
      </div>
    );
  }

  // The nudge (operator, 2026-08-12), the same two settings and the same
  // helper the image and heading modules use, so an operator learns it once.
  // `position: relative` only when there is a transform to apply: an
  // unconditional one would become the containing block for any
  // fixed-position overlay inside the carousel.
  const nudgeTransform = getModuleNudgeTransform(settings);
  const wrapStyle: CSSProperties = nudgeTransform
    ? { transform: nudgeTransform, position: "relative" }
    : {};
  /**
   * Where Height lands depends on the format, because the two formats have
   * different things whose height an operator is actually setting.
   *
   * Slideshow: the frame IS the picture, so Height sizes the frame.
   * Cards: the frame is a scrolling row whose height comes from the cards in
   *   it — sizing the frame just adds an empty band underneath (operator,
   *   2026-08-16: "the images in this slideshow are being cut off, and
   *   neither auto (0) nor a larger size changes the height"). What Height
   *   means on a shelf of cards is how tall each card's PICTURE is.
   *
   * Auto (0) leaves the picture at its own proportions rather than cropping
   * it to a fixed box, which is the other half of that report: the card
   * image used to be a hard 180px with `object-fit: cover`, so a poster lost
   * its top and bottom and no setting could give them back.
   */
  /**
   * The border, corner and drop shadow, one set for every picture in the
   * module (operator, 2026-08-16). Where it LANDS differs by format for the
   * same reason Height does — what the operator means by "the image" is the
   * frame on a slideshow and each card's picture on a shelf:
   *
   * Slideshow: the frame is the picture, and it already clips to itself
   *   (`overflow: hidden`), so a border drawn on it is a mount around the
   *   photo and the radius rounds the photo inside it.
   * Cards: the picture's own box, so the copy under it keeps its square
   *   corners and sits outside the frame.
   *
   * Both boxes already carried a hard `border-radius: 8px` in the stylesheet,
   * which is why 8 is the resolver's default rather than 0.
   */
  const imageFrame = getCarouselImageFrameStyle(settings);
  /**
   * Room for the shadow to fall into. `overflow-x: auto` on the card row
   * clips the other axis whether or not anything asks it to, so without this
   * the shadow stops dead at the bottom of the card. Vertical only — see
   * `getCarouselImageShadowGutter`.
   */
  const shadowGutter = isCards ? getCarouselImageShadowGutter(settings) : 0;
  const frameStyle: CSSProperties = {
    ...(heightPx > 0 && !isCards ? { height: `${heightPx}px` } : {}),
    ...(shadowGutter > 0 ? { paddingTop: `${shadowGutter}px`, paddingBottom: `${shadowGutter}px` } : {}),
    // The card row carries its OWN rounding in CSS (8px) and clips to it,
    // which shaves the outer corners of the first and last card whatever the
    // pictures are set to — so Radius 0 could not actually reach square
    // (operator, 2026-08-16: "allow the radius to go all the way to 0px").
    // The row follows the setting instead of holding a number of its own.
    ...(isCards ? { borderRadius: imageFrame.borderRadius } : imageFrame)
  };
  const cardImageStyle: CSSProperties = {
    ...(heightPx > 0 ? { height: `${heightPx}px` } : {}),
    ...imageFrame
  };

  const atStart = index <= 0;
  const atEnd = index >= count - 1;

  const caption = (item: (typeof items)[number]) => {
    if (!showCaptions || (!item.title && !item.body)) return null;
    return (
      <div className={`builder-preview-carousel-caption builder-preview-carousel-caption-${captionPosition}`}>
        {item.title ? <strong>{item.title}</strong> : null}
        {item.body ? <p>{item.body}</p> : null}
        {item.linkUrl && item.linkLabel ? (
          <span className="builder-preview-carousel-caption-link">
            {item.linkLabel}
            <span aria-hidden="true"> →</span>
          </span>
        ) : null}
      </div>
    );
  };

  /** A whole item wrapped in its link, when it has one. */
  const linked = (item: (typeof items)[number], children: React.ReactNode) =>
    item.linkUrl ? (
      <Link className="builder-preview-carousel-link" href={item.linkUrl}>
        {children}
      </Link>
    ) : (
      children
    );

  return (
    <div
      className={`builder-preview-carousel-wrap builder-preview-carousel-wrap-${format}`}
      style={wrapStyle}
      onMouseEnter={() => pauseOnHover && setPaused(true)}
      onMouseLeave={() => pauseOnHover && setPaused(false)}
    >
      {showArrows && count > 1 && (!isCards || !atStart || loop) ? (
        <button
          type="button"
          className="builder-preview-carousel-arrow builder-preview-carousel-arrow-left"
          onClick={() => goTo(index - 1)}
          disabled={!loop && atStart}
          aria-label="Previous"
        >
          ‹
        </button>
      ) : null}

      {isCards ? (
        <div
          className="builder-preview-carousel builder-preview-carousel-cards"
          ref={scrollRef}
          style={{ ...frameStyle, gap: `${gap}px` }}
        >
          {/* The set, rendered `copies` times — once normally, or three times
              when looping. Only the middle copy is ever on screen; the outer
              two are what the strip walks into instead of hitting an end.
              Clones are hidden from screen readers and taken out of the tab
              order, so a keyboard or screen-reader visitor meets each card
              once rather than three times. */}
          {Array.from({ length: copies }).flatMap((_, copy) =>
            items.map((item) => (
            <article
              key={`${item.id}-copy-${copy}`}
              className="builder-preview-carousel-card"
              aria-hidden={copies > 1 && copy !== 1 ? true : undefined}
              inert={copies > 1 && copy !== 1 ? true : undefined}
              // Both, not `minWidth` alone: a flex item with `flex: 0 0 auto`
              // and no width takes its size from its content, so a card
              // holding a 1920px photo came out 1920px wide.
              style={{ width: `${cardWidth}px`, minWidth: `${cardWidth}px` }}
            >
              {linked(
                item,
                <>
                  {item.imageUrl ? (
                    <div className="builder-preview-carousel-card-image" style={cardImageStyle}>
                      <img
                        {...imageProps(item.imageUrl, { sizes: `${cardWidth}px` })}
                        alt={item.imageAlt || item.title || ""}
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <div className="builder-preview-carousel-card-copy">
                    {item.title ? <strong>{item.title}</strong> : null}
                    {item.body ? <p>{item.body}</p> : null}
                    {item.linkUrl && item.linkLabel ? (
                      <span className="builder-preview-carousel-caption-link">
                        {item.linkLabel}
                        <span aria-hidden="true"> →</span>
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </article>
            ))
          )}
        </div>
      ) : (
        <div
          className={`builder-preview-carousel builder-preview-carousel-slideshow builder-preview-carousel-anim-${transition}`}
          style={frameStyle}
        >
          {transition === "slide" ? (
            <div
              className="builder-preview-carousel-track"
              style={{ transform: `translateX(-${index * 100}%)`, gap: `${gap}px` }}
            >
              {items.map((item) => (
                <div key={item.id} className="builder-preview-carousel-slide">
                  {linked(
                    item,
                    <>
                      <img {...imageProps(item.imageUrl)} alt={item.imageAlt} loading="lazy" />
                      {caption(item)}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            items.map((item, slideIndex) => (
              <div
                key={item.id}
                className="builder-preview-carousel-slide builder-preview-carousel-fade-frame"
                style={{ opacity: slideIndex === index ? 1 : 0 }}
                aria-hidden={slideIndex === index ? undefined : true}
              >
                {linked(
                  item,
                  <>
                    <img {...imageProps(item.imageUrl)} alt={item.imageAlt} loading="lazy" />
                    {caption(item)}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {showArrows && count > 1 && (!isCards || !atEnd || loop) ? (
        <button
          type="button"
          className="builder-preview-carousel-arrow builder-preview-carousel-arrow-right"
          onClick={() => goTo(index + 1)}
          disabled={!loop && atEnd}
          aria-label="Next"
        >
          ›
        </button>
      ) : null}

      {showDots && count > 1 ? (
        <div className="builder-preview-carousel-dots">
          {items.map((item, dotIndex) => (
            <button
              key={item.id}
              type="button"
              className={`builder-preview-carousel-dot${dotIndex === index ? " is-current" : ""}`}
              onClick={() => goTo(dotIndex)}
              aria-label={`Go to ${isCards ? "card" : "slide"} ${dotIndex + 1}`}
              aria-current={dotIndex === index ? "true" : undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HeadlineRotatorPreview({
  module
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
}) {
  const color = module.settings.color || "#18324a";
  const entries = useMemo(
    () => parseHeadlineRotatorEntries(module.settings.headlines ?? "", color),
    [module.settings.headlines, color]
  );
  const fadeDuration = Math.max(Number.parseInt(module.settings.fadeDuration ?? "800", 10) || 800, 0);
  const displaySpeed = Math.max(Number.parseInt(module.settings.displaySpeed ?? "3000", 10) || 3000, 200);
  const fontSize =
    Number.parseInt(module.settings.fontSize ?? HEADLINE_ROTATOR_DEFAULT_FONT_SIZE, 10) ||
    Number.parseInt(HEADLINE_ROTATOR_DEFAULT_FONT_SIZE, 10);
  const isBold = module.settings.bold !== "false";
  const horizontal = getModuleAlignment(module.settings);
  const verticalAlignment =
    (module.settings.verticalAlignment as "top" | "center" | "bottom") || "center";
  const minHeight = resolveHeadlineRotatorMinHeight(module.settings.minHeight);
  const justify =
    verticalAlignment === "top" ? "flex-start" : verticalAlignment === "bottom" ? "flex-end" : "center";
  const alignSelf =
    horizontal === "left" ? "flex-start" : horizontal === "right" ? "flex-end" : "center";

  const [stableIndex, setStableIndex] = useState(0);
  const [transition, setTransition] = useState<{
    fromIndex: number;
    toIndex: number;
    fromOpacity: number;
    toOpacity: number;
  } | null>(null);
  const stableIndexRef = useRef(0);

  useEffect(() => {
    stableIndexRef.current = stableIndex;
  }, [stableIndex]);

  useEffect(() => {
    if (entries.length <= 1) {
      setStableIndex(0);
      stableIndexRef.current = 0;
      setTransition(null);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const animationFrames: number[] = [];

    function scheduleTimer(callback: () => void, delay: number) {
      const timer = window.setTimeout(callback, delay);
      timers.push(timer);
      return timer;
    }

    function afterPaint(callback: () => void) {
      const outer = window.requestAnimationFrame(() => {
        const inner = window.requestAnimationFrame(() => {
          if (!cancelled) callback();
        });
        animationFrames.push(inner);
      });
      animationFrames.push(outer);
    }

    function finishTransition(toIndex: number) {
      if (cancelled) return;
      stableIndexRef.current = toIndex;
      setStableIndex(toIndex);
      setTransition(null);
      scheduleTimer(rotate, displaySpeed);
    }

    function rotate() {
      if (cancelled) return;

      const fromIndex = stableIndexRef.current % entries.length;
      const outgoing = entries[fromIndex];
      const overlapMs = Number.parseInt(outgoing?.overlap ?? "0", 10) || 0;
      const fadeInDelay = computeHeadlineRotatorFadeInDelay(fadeDuration, overlapMs);
      const transitionMs = computeHeadlineRotatorTransitionMs(fadeDuration, overlapMs);
      const toIndex = (fromIndex + 1) % entries.length;

      setTransition({ fromIndex, toIndex, fromOpacity: 1, toOpacity: 0 });

      afterPaint(() => {
        setTransition((current) => (current ? { ...current, fromOpacity: 0 } : current));
      });

      scheduleTimer(() => {
        if (!cancelled) {
          setTransition((current) => (current ? { ...current, toOpacity: 1 } : current));
        }
      }, fadeInDelay);

      scheduleTimer(() => finishTransition(toIndex), transitionMs);
    }

    scheduleTimer(rotate, displaySpeed);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      animationFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [entries, fadeDuration, displaySpeed]);

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    justifyContent: justify,
    width: "100%",
    minHeight: `${minHeight}px`,
    textAlign: horizontal,
    color,
    fontSize: `${fontSize}px`,
    fontWeight: isBold ? 700 : 400,
    position: "relative",
    overflow: "visible",
    ...({ textShadow: getHeadingModuleStyle(module.settings).textShadow } as CSSProperties)
  };

  if (entries.length === 0) {
    return (
      <div className="builder-preview-headline-rotator" style={containerStyle}>
        <span style={{ alignSelf }}>Add headlines in the editor</span>
      </div>
    );
  }

  function getPositionedHeadlineStyle(entry: HeadlineRotatorEntry, opacity: number): CSSProperties {
    const anchor = getHeadlineRotatorPositionStyle(entry.xAxis, entry.yAxis);

    return {
      position: "absolute",
      ...anchor,
      transition: `opacity ${fadeDuration}ms ease`,
      opacity,
      color: entry.color || color,
      pointerEvents: opacity > 0 ? "auto" : "none",
      textDecoration: "none",
      whiteSpace: "nowrap"
    };
  }

  function getEntryOpacity(index: number): number {
    if (!transition) {
      return index === stableIndex ? 1 : 0;
    }

    if (index === transition.fromIndex) {
      return transition.fromOpacity;
    }

    if (index === transition.toIndex) {
      return transition.toOpacity;
    }

    return 0;
  }

  return (
    <div className="builder-preview-headline-rotator" style={containerStyle}>
      {entries.map((entry, index) => {
        const opacity = getEntryOpacity(index);

        return entry.href ? (
          <Link href={entry.href} key={entry.id} style={getPositionedHeadlineStyle(entry, opacity)}>
            {entry.label}
          </Link>
        ) : (
          <span key={entry.id} style={getPositionedHeadlineStyle(entry, opacity)}>
            {entry.label}
          </span>
        );
      })}
    </div>
  );
}

function toPreviewHref(href: string): string {
  const clean = href.trim();
  if (!clean || clean.startsWith("#") || clean.startsWith("http") || clean.startsWith("mailto:") || clean.endsWith(".html")) {
    return clean || "#";
  }
  const withoutTrailingSlash = clean.endsWith("/") && clean.length > 1 ? clean.slice(0, -1) : clean;
  return `${withoutTrailingSlash}.html`;
}

type NavRenderItem = {
  href: string;
  label: string;
  id?: string;
  parentId?: string;
  width?: string;
  /** The mega panel's extra column — a whole module, or the tile it replaced. */
  featureModule?: import("@/lib/builder-template").BuilderTemplateModule;
  featureImage?: string;
  featureHeading?: string;
};

/**
 * One top-level item of a mega menu, plus its panel.
 *
 * ClickUp 86bbafg38. The reference implementation this was modelled on
 * (blazefish.com) opens the panel purely with `:hover` / `:focus-within`,
 * which means: no `aria-expanded` for screen readers, no way to dismiss it
 * from the keyboard, and it flickers open whenever the pointer merely
 * crosses the item. This version keeps the top-level link navigable and
 * adds a real disclosure `<button>` beside it, so the panel is operable by
 * mouse, touch, and keyboard alike.
 */
function NavMegaItem({
  item,
  columns,
  isOpen,
  onOpen,
  onClose,
  previewMode,
  activePath
}: {
  item: NavRenderItem;
  columns: NavMegaColumn<NavRenderItem>[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  previewMode: boolean;
  activePath: string;
}) {
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  function clearHoverTimer() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  // Hover intent: a panel that opens the instant the pointer grazes the
  // label makes a nav bar feel like a minefield when you are aiming at the
  // item next to it.
  function handleMouseEnter() {
    clearHoverTimer();
    hoverTimer.current = setTimeout(onOpen, 120);
  }

  function handleMouseLeave() {
    clearHoverTimer();
    hoverTimer.current = setTimeout(onClose, 160);
  }

  const href = previewMode ? toPreviewHref(item.href || "#") : toPublicHref(item.href || "#");
  const isActive = isNavPathActive(item.href || "#", activePath);
  const featureImage = item.featureImage ? resolvePublicBuilderAssetUrl(item.featureImage) : "";

  return (
    <div
      className={`site-nav-mega${isOpen ? " site-nav-mega--open" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="site-nav-mega-trigger">
        <Link
          aria-current={isActive ? "page" : undefined}
          className={`site-nav-link${isActive ? " site-nav-link-active" : ""}`}
          href={href}
        >
          {item.label}
        </Link>
        <button
          type="button"
          ref={toggleRef}
          className="site-nav-mega-toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={`${item.label} menu`}
          onClick={() => {
            clearHoverTimer();
            if (isOpen) onClose();
            else onOpen();
          }}
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>

      <div className="site-nav-mega-panel" id={panelId} hidden={!isOpen}>
        <div className="site-nav-mega-grid">
          {columns.map((column) => (
            <div className="site-nav-mega-column" key={column.id}>
              {column.heading ? (
                column.heading.href ? (
                  <Link
                    className="site-nav-mega-heading"
                    href={previewMode ? toPreviewHref(column.heading.href) : toPublicHref(column.heading.href)}
                  >
                    {column.heading.label}
                  </Link>
                ) : (
                  <span className="site-nav-mega-heading">{column.heading.label}</span>
                )
              ) : null}
              {column.links.map((link) => {
                const linkHref = previewMode ? toPreviewHref(link.href || "#") : toPublicHref(link.href || "#");
                const linkActive = isNavPathActive(link.href || "#", activePath);
                return (
                  <Link
                    key={link.id ?? `${linkHref}-${link.label}`}
                    className={`site-nav-mega-link${linkActive ? " site-nav-link-active" : ""}`}
                    href={linkHref}
                    aria-current={linkActive ? "page" : undefined}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}

          {/*
            * The extra column, in two forms. A module chosen from the palette
            * renders as itself — the slot supplies the grid cell and nothing
            * else, so the module's own background, padding and alignment are
            * not sitting inside a second card. Where no module has been
            * chosen the original image-plus-heading tile still renders, which
            * is what keeps live tenant menus (Delray's "Visit Delray Tennis")
            * exactly as they are.
            */}
          {item.featureModule ? (
            <div className="site-nav-mega-feature-module">
              <BuilderModulePreview module={item.featureModule} previewMode={previewMode} />
            </div>
          ) : featureImage || item.featureHeading ? (
            <Link className="site-nav-mega-feature" href={href}>
              {featureImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img {...imageProps(featureImage, { sizes: FEATURE_CARD_SIZES })} alt="" loading="lazy" />
              ) : null}
              {item.featureHeading ? <strong>{item.featureHeading}</strong> : null}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NavigationModulePreview({
  module,
  previewMode = false
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
  previewMode?: boolean;
}) {
  const pathname = usePathname();
  const activePath = normalizeNavPath(pathname || "/");
  const menuId = useId();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const [openMegaId, setOpenMegaId] = useState<string | null>(null);

  useEffect(() => {
    setOpenMegaId(null);
  }, [pathname]);

  let navItems: NavRenderItem[] = [];
  try {
    const parsed = JSON.parse(module.settings.navItems || "[]");
    navItems = Array.isArray(parsed)
      ? parsed.map((item) => ({ ...item, href: item?.href || item?.url || "" }))
      : [];
  } catch {
    navItems = [];
  }

  const topLevelItems = navItems.filter((item) => !item.parentId);
  const childrenOf = (parentId: string) => navItems.filter((item) => item.parentId === parentId);

  // Every visual setting resolves in one place — lib/builder-client/builder-nav-style.ts.
  // It used to resolve here, differently from how the published page resolved
  // it: `navPadding` and `navBorderRadius` mean the LINK on a live site and
  // were being applied to the whole bar by this component.
  const navStyle = getNavModuleStyle(module.settings);
  const moduleBackgroundStyle = getBuilderBackgroundStyle(getModuleBackgroundSettings(module.settings)) ?? {};
  const nudgeTransform = getModuleNudgeTransform(module.settings);
  const showsArrow = showsNavDropdownArrow(module.settings);
  const rawAlignment = module.settings.navAlignment ?? "center";
  const flexAlign = rawAlignment === "left" ? "flex-start" : rawAlignment === "right" ? "flex-end" : "center";
  const isVertical = module.settings.navDirection === "vertical";
  const navLevels = Number.parseInt(module.settings.navLevels ?? "2", 10) || 2;
  const itemSizing = module.settings.navItemSizing === "custom" || module.settings.navItemSizing === "equal"
    ? module.settings.navItemSizing
    : "auto";
  // Backward compatibility is a hard requirement on this module (live tenant
  // sites run it): anything other than an explicit "mega" keeps the exact
  // dropdown markup that shipped before.
  const isMega = isNavMegaMenu(module.settings);
  const megaColumnCount = getNavMegaColumnCount(module.settings);

  return (
    <nav
      className={`site-nav site-nav--sizing-${itemSizing}${isVertical ? " site-nav--vertical" : ""}${mobileOpen ? " site-nav--open" : ""}${isMega ? " site-nav--mega" : ""}${
        // The bar's backdrop-filter makes it a stacking context, so the
        // panel's own z-index can order it only against the bar's other
        // children — never against sibling modules. While a panel is open
        // the whole bar has to outrank them, and only the renderer knows
        // when that is.
        isMega && openMegaId ? " site-nav--panel-open" : ""
      } ${getNavModuleClassNames(module.settings)}`}
      aria-label="Main navigation"
      onKeyDown={
        isMega
          ? (event) => {
              // Escape closes the open panel — the reference implementation
              // has no keyboard dismissal at all.
              if (event.key === "Escape" && openMegaId) {
                setOpenMegaId(null);
              }
            }
          : undefined
      }
      style={
        {
          ...navStyle,
          // The operator's Background wins over the bar's default fill —
          // it is a real declaration, not a variable, so it lands last.
          ...moduleBackgroundStyle,
          ...(isVertical ? { alignItems: flexAlign } : {}),
          ...(isVertical ? {} : { justifyContent: flexAlign }),
          ...(nudgeTransform ? { transform: nudgeTransform } : {})
        } as CSSProperties
      }
    >
      {!isVertical && topLevelItems.length > 0 && (
        <button
          type="button"
          className="site-nav-toggle"
          aria-expanded={mobileOpen}
          aria-controls={menuId}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span className="site-nav-toggle-bar" aria-hidden="true" />
          <span className="site-nav-toggle-bar" aria-hidden="true" />
          <span className="site-nav-toggle-bar" aria-hidden="true" />
        </button>
      )}
      <div className="site-nav-items" id={menuId}>
      {topLevelItems.map((item) => {
        const href = previewMode ? toPreviewHref(item.href || "#") : toPublicHref(item.href || "#");
        const isActive = isNavPathActive(item.href || "#", activePath);
        const itemId = item.id ?? `${href}-${item.label}`;
        const children = navLevels >= 2 ? childrenOf(itemId) : [];
        const rawWidth = itemSizing === "custom" && item.width ? item.width.trim() : undefined;
        const itemWidth = rawWidth
          ? /^\d+(\.\d+)?$/.test(rawWidth) ? `${rawWidth}%` : rawWidth
          : undefined;

        if (children.length === 0) {
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={`site-nav-link${isActive ? " site-nav-link-active" : ""}`}
              href={href}
              key={itemId}
              onClick={() => setMobileOpen(false)}
              style={itemWidth ? { flex: `0 0 ${itemWidth}`, width: itemWidth } : undefined}
            >
              {item.label}
            </Link>
          );
        }

        if (isMega) {
          return (
            <NavMegaItem
              key={itemId}
              item={item}
              activePath={activePath}
              previewMode={previewMode}
              columns={buildMegaColumns(children, childrenOf, megaColumnCount)}
              isOpen={openMegaId === itemId}
              onOpen={() => setOpenMegaId(itemId)}
              onClose={() => setOpenMegaId((current) => (current === itemId ? null : current))}
            />
          );
        }

        return (
          <div
            key={itemId}
            className="site-nav-dropdown"
            style={itemWidth ? { flex: `0 0 ${itemWidth}`, width: itemWidth } : undefined}
          >
            <Link
              aria-current={isActive ? "page" : undefined}
              className={`site-nav-link site-nav-dropdown-trigger${isActive ? " site-nav-link-active" : ""}`}
              href={href}
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
              {!isVertical && showsArrow && <span className="site-nav-dropdown-arrow" aria-hidden>▾</span>}
            </Link>
            <div className="site-nav-dropdown-menu">
              {children.map((child) => {
                const childHref = previewMode ? toPreviewHref(child.href || "#") : toPublicHref(child.href || "#");
                const childActive = isNavPathActive(child.href || "#", activePath);
                return (
                  <Link
                    key={child.id ?? `${childHref}-${child.label}`}
                    href={childHref}
                    aria-current={childActive ? "page" : undefined}
                    className={`site-nav-link site-nav-dropdown-item${childActive ? " site-nav-link-active" : ""}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </nav>
  );
}

function TableModulePreview({ module }: { module: import("@/lib/builder-template").BuilderTemplateModule }) {
  const td = parseTableData(module.settings);
  const borderW = Number.parseInt(module.settings.borderWidth || "1", 10);
  const borderC = module.settings.borderColor || "#cccccc";
  const cellPad = Number.parseInt(module.settings.cellPadding || "8", 10);
  const tableBgStyle = getBuilderBackgroundStyle(getModuleBackgroundSettings(module.settings)) ?? { background: "transparent" };

  return (
    <div className="builder-preview-table-wrap" style={getTableWrapStyle(module.settings)}>
      <table
        className="builder-preview-table"
        style={{ borderCollapse: "collapse", width: "100%", border: `${borderW}px solid ${borderC}`, ...tableBgStyle }}
      >
        {td.headers.length > 0 && module.settings.showColumnHeads !== "false" && (
          <thead>
            <tr>
              {td.headers.map((h, i) => (
                <th key={i} style={{ border: `${borderW}px solid ${borderC}`, padding: `${cellPad}px`, textAlign: "left", fontWeight: 600 }}>
                  {h}
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
                  <td key={ci} style={{ border: `${borderW}px solid ${borderC}`, padding: `${cellPad}px`, verticalAlign: "top" }}>
                    {cellMods.map((m) => (
                      <div key={m.id} className={`builder-preview-module ${getAlignmentClass(getModuleAlignment(m.settings))}`}>
                        <BuilderModulePreview module={m} />
                      </div>
                    ))}
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

/**
 * Slider and Feature Cards share one card model (`BuilderCardItem`) so an
 * operator can move content between them — see lib/builder-client/
 * builder-card-items.ts. Slider ignores the fields it has no use for.
 */

const FEATURE_CARD_ASPECTS: Record<string, string> = {
  "4-3": "4 / 3",
  "16-9": "16 / 9",
  "3-2": "3 / 2",
  "1-1": "1 / 1"
};

/**
 * Icon badge options. Each set is the single source of truth for its
 * setting: the renderer validates against it, the CSS carries one rule
 * per member, and the editor's dropdown is built from the same names —
 * so an unknown stored value falls back to the default rather than
 * emitting a class no stylesheet answers.
 */
const FEATURE_CARD_ICON_PLACEMENTS = new Set(["above", "on-image", "inline"]);
const FEATURE_CARD_ICON_ALIGNS = new Set(["center", "left", "right"]);
const FEATURE_CARD_ICON_SHAPES = new Set(["circle", "square", "plain"]);

/**
 * Feature Cards — a responsive grid of linked cards.
 *
 * Built to docs/MODULE_STANDARDS.md from the spec on ClickUp 86bbaffu3.
 * All structural CSS lives in the BASE layer of
 * `_builder-react-overrides.css` (standard 3); the media queries there only
 * reduce the column count, they never introduce layout.
 */
/**
 * Programs — a club's classes, clinics and mixers as readable page content.
 *
 * Replaces the flyer image. The operator's brief (ClickUp `86bbdby3a`) was
 * that staff must be able to change a start time without a design tool, and
 * that "flyers don't belong on a website" — so nothing here reproduces the
 * poster. No logo, no address block, no decorative palm: those were identical
 * on all fifteen source flyers and are site chrome or print filler.
 *
 * The times are a real table with a monospaced, tabular-figures column,
 * because a schedule is a timetable and the columns should line up. Centered
 * text baked into an image never could.
 */
function ProgramListModulePreview({
  module
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
}) {
  const programs = parsePrograms(module.settings.programs);

  // Standard 5: an empty module is a designed state, not a blank box.
  if (programs.length === 0) {
    return (
      <div className="builder-preview-programs builder-preview-programs-empty">
        Add programs in the editor
      </div>
    );
  }

  const showLevelBadge = module.settings.showLevelBadge !== "false";
  const showReserve = module.settings.showReserve !== "false";
  const showInstructorColumn = module.settings.showInstructorColumn !== "false";
  const reserveLabel = module.settings.reserveLabel || "Reserve";
  const reservePhone = (module.settings.reservePhone || "").trim();
  const policyNote = (module.settings.policyNote || "").trim();
  const radius = Math.min(48, Math.max(0, Number.parseInt(module.settings.cardRadius || "10", 10) || 0));

  // Empty color settings follow the site theme. The --crm-theme-* vars are
  // set on the preview root by getCrmThemePaletteVars on both the editor
  // canvas and the public site; the literals are the no-theme fallback.
  const accent = module.settings.accentColor || "var(--crm-theme-primary, #4f9c3a)";
  const heading = module.settings.headingColor || "var(--crm-theme-accent, #14265c)";

  // `tel:` needs the digits only; the label keeps whatever formatting the
  // operator typed, because that is how the club writes its own number.
  const dialable = reservePhone.replace(/[^\d+]/g, "");
  const canReserve = showReserve && reservePhone.length > 0;

  // A program with no coach on any session leaves the column out entirely
  // rather than rendering a row of blanks.
  const anyInstructor = programs.some((program) =>
    program.sessions.some((session) => Boolean(session.instructor))
  );
  const withInstructors = showInstructorColumn && anyInstructor;

  return (
    <div
      className="builder-preview-programs"
      style={
        {
          "--program-radius": `${radius}px`,
          "--program-accent": accent,
          "--program-heading": heading,
          "--program-bg": module.settings.cardBackground || "var(--lp-surface, #ffffff)",
          // A card border is a quiet line, not a brand color, so it does NOT
          // default to a theme color. On a theme whose secondary is a strong
          // green every card gained a green hairline — spotted in the settings
          // swatch on 2026-08-13 before it ever reached a page. The operator
          // can still pick any color; the default just stays out of the way.
          "--program-border": module.settings.cardBorderColor || "#dce3ef"
        } as React.CSSProperties
      }
    >
      <div className="builder-preview-programs-list">
        {programs.map((program) => (
          <article className="builder-preview-program" key={program.id}>
            <div className="builder-preview-program-intro">
              <h3 className="builder-preview-program-title">{program.title}</h3>
              {program.subtitle ? (
                <p className="builder-preview-program-subtitle">{program.subtitle}</p>
              ) : null}
              {showLevelBadge && program.levelBadge ? (
                <span className="builder-preview-program-level">{program.levelBadge}</span>
              ) : null}
              {program.bullets.length > 0 ? (
                <ul className="builder-preview-program-points">
                  {program.bullets.map((bullet, index) => (
                    <li key={`${program.id}-point-${index}`}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="builder-preview-program-detail">
              {program.sessions.length > 0 ? (
                <div className="builder-preview-program-when">
                  <p className="builder-preview-program-when-label">When</p>
                  <table className="builder-preview-program-table">
                    <tbody>
                      {program.sessions.map((session) => (
                        <tr key={session.id}>
                          <td className="builder-preview-program-day">{session.day}</td>
                          <td className="builder-preview-program-time">
                            {formatSessionHours(session)}
                          </td>
                          {withInstructors ? (
                            <td className="builder-preview-program-who">{session.instructor ?? ""}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {program.pricing.length > 0 ? (
                <div className="builder-preview-program-cost">
                  {program.pricing.map((price) => (
                    <div className="builder-preview-program-cost-row" key={price.id}>
                      <span className="builder-preview-program-cost-amount">{price.amount}</span>
                      {price.appliesTo ? (
                        <span className="builder-preview-program-cost-for">{price.appliesTo}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {canReserve ? (
                <p className="builder-preview-program-reserve">
                  <span>{reserveLabel}:</span>{" "}
                  <a href={`tel:${dialable}`}>{reservePhone}</a>
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {policyNote ? <p className="builder-preview-programs-policy">{policyNote}</p> : null}
    </div>
  );
}

function FeatureCardsModulePreview({
  module,
  previewMode = false
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
  previewMode?: boolean;
}) {
  const cards = parseBuilderCardItems(module.settings.cards, "card");

  // Standard 5: an empty module is a designed state, not a blank box.
  if (cards.length === 0) {
    return (
      <div className="builder-preview-feature-cards builder-preview-feature-cards-empty">
        Add cards in the editor
      </div>
    );
  }

  const columns = Math.min(6, Math.max(1, Number.parseInt(module.settings.cardColumns || "3", 10) || 3));
  const gap = Math.min(48, Math.max(0, Number.parseInt(module.settings.cardGap || "12", 10) || 0));
  const radius = Math.min(48, Math.max(0, Number.parseInt(module.settings.cardRadius || "18", 10) || 0));
  const align = module.settings.cardAlign === "left" ? "left" : "center";
  const aspect = FEATURE_CARD_ASPECTS[module.settings.imageAspect || "4-3"] || FEATURE_CARD_ASPECTS["4-3"];
  const showIcons = module.settings.showIcons !== "false";
  const alternateIcons = module.settings.iconAlternate !== "false";
  // Empty color settings follow the site theme; the --crm-theme-* vars are
  // set on the preview root by getCrmThemePaletteVars on both the editor
  // canvas and the public site, with the factory colors as the no-theme
  // fallback.
  const iconColor = module.settings.iconColor || "var(--crm-theme-accent, #0b2a4a)";
  const iconAltColor = module.settings.iconAltColor || "var(--crm-theme-primary, #4f9c3a)";
  const showArrow = module.settings.linkArrow !== "false";
  const fallbackLinkLabel = module.settings.linkLabel ?? "Learn More";

  // Icon badge geometry. Every one of these was a hardcoded CSS value
  // until 2026-08-12; the fallbacks below are those exact values, so a
  // module saved before then renders identically — with one deliberate
  // exception, `iconFront`. The badge sits earlier in the DOM than the
  // image and neither declared a z-index, so the image always painted
  // over it. Defaulting to "in front" fixes a bug rather than changing a
  // design: an icon hidden behind the picture was never a choice anyone
  // made.
  // `|| 48` on the parse would turn a stored "0" into 48 rather than the
  // 16px floor — the two cases are different and only one is a fallback.
  const parsedIconSize = Number.parseInt(module.settings.iconSize || "48", 10);
  const iconSize = Number.isFinite(parsedIconSize) ? Math.min(160, Math.max(16, parsedIconSize)) : 48;
  const iconPlacement = FEATURE_CARD_ICON_PLACEMENTS.has(module.settings.iconPlacement || "")
    ? (module.settings.iconPlacement as string)
    : "above";
  const iconAlign = FEATURE_CARD_ICON_ALIGNS.has(module.settings.iconAlign || "")
    ? (module.settings.iconAlign as string)
    : "center";
  const iconShape = FEATURE_CARD_ICON_SHAPES.has(module.settings.iconShape || "")
    ? (module.settings.iconShape as string)
    : "circle";
  const iconInFront = module.settings.iconFront !== "false";
  // Anything but an explicit "image" is a symbol — every module saved before
  // image icons existed carries no `iconType` at all.
  const iconIsImage = module.settings.iconType === "image";

  const className = [
    "builder-preview-feature-cards",
    `builder-preview-feature-cards-align-${align}`,
    module.settings.cardShadow === "false" ? "" : "builder-preview-feature-cards-shadow",
    module.settings.cardHoverLift === "false" ? "" : "builder-preview-feature-cards-lift",
    `builder-preview-feature-cards-icon-${iconPlacement}`,
    `builder-preview-feature-cards-icon-align-${iconAlign}`,
    `builder-preview-feature-cards-icon-shape-${iconShape}`
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      style={
        {
          "--feature-card-columns": String(columns),
          "--feature-card-gap": `${gap}px`,
          "--feature-card-radius": `${radius}px`,
          "--feature-card-bg": module.settings.cardBackground || "var(--lp-surface, #ffffff)",
          "--feature-card-border": module.settings.cardBorderColor || "var(--crm-theme-secondary, #e1e8f0)",
          "--feature-card-accent": iconColor,
          "--feature-card-aspect": aspect,
          "--feature-card-icon-size": `${iconSize}px`,
          // 0 keeps the badge in the same paint layer as the image, where
          // DOM order puts the image on top — i.e. the old behaviour, now
          // reachable on purpose instead of by accident.
          "--feature-card-icon-z": iconInFront ? "3" : "0"
        } as CSSProperties
      }
    >
      {cards.map((card, index) => {
        const body = parseCardBody(card.body);
        const href = card.linkUrl ? (previewMode ? toPreviewHref(card.linkUrl) : toPublicHref(card.linkUrl)) : "";
        const linkLabel = card.linkLabel || fallbackLinkLabel;
        const badgeColor = alternateIcons && index % 2 === 1 ? iconAltColor : iconColor;
        // "Plain" drops the filled disc, so the glyph itself has to carry
        // the color — white-on-nothing is invisible. With a disc, white
        // stays the default and Icon Text overrides it.
        const glyphColor = module.settings.iconTextColor || (iconShape === "plain" ? badgeColor : "#ffffff");

        return (
          <article className="builder-preview-feature-card" key={card.id}>
            {showIcons && (iconIsImage ? card.iconImageUrl : card.icon) ? (
              <span
                className="builder-preview-feature-card-badge"
                style={{ background: iconShape === "plain" ? "transparent" : badgeColor, color: glyphColor }}
                aria-hidden="true"
              >
                {iconIsImage ? (
                  // Decorative, like the glyph it replaces — the badge is
                  // aria-hidden, so the picture carries an empty alt rather
                  // than repeating the card title to a screen reader.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="builder-preview-feature-card-badge-img" src={card.iconImageUrl} />
                ) : (
                  card.icon
                )}
              </span>
            ) : null}

            {card.imageUrl ? (
              <div className="builder-preview-feature-card-media">
                <Image
                  alt={card.imageAlt}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  src={card.imageUrl}
                  unoptimized
                />
              </div>
            ) : null}

            <div className="builder-preview-feature-card-copy">
              {card.title ? <h3 className="builder-preview-feature-card-title">{card.title}</h3> : null}

              {body.lines.length > 0 ? (
                body.kind === "list" ? (
                  <ul className="builder-preview-feature-card-list">
                    {body.lines.map((line, lineIndex) => (
                      <li key={`${card.id}-line-${lineIndex}`}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  body.lines.map((line, lineIndex) => (
                    <p className="builder-preview-feature-card-body" key={`${card.id}-line-${lineIndex}`}>
                      {line}
                    </p>
                  ))
                )
              ) : null}
            </div>

            {href && linkLabel ? (
              <Link className="builder-preview-feature-card-link" href={href}>
                {linkLabel}
                {showArrow ? <span aria-hidden="true"> →</span> : null}
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

type SocialItem = { id: string; label: string; href: string; iconUrl: string; backgroundColor: string };

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
        iconUrl: resolvePublicBuilderAssetUrl(raw.iconUrl),
        backgroundColor: normalizeSocialIconBackgroundColor(raw.backgroundColor)
      };
    });
  } catch {
    return [];
  }
}

function SocialModulePreview({ module }: { module: import("@/lib/builder-template").BuilderTemplateModule }) {
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
    <div className="builder-preview-social-row">
      <div
        className="builder-preview-social"
        style={{ gap: `${gap}px`, ...(padding > 0 ? { padding: `${padding}px` } : {}) }}
      >
        {items.map((item) => (
          <div key={item.id} className="builder-preview-social-entry">
            <a
              className="builder-preview-social-item"
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
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={item.label || "Social icon"} src={item.iconUrl} className="builder-preview-social-icon-img" />
              ) : (
                <span className="builder-preview-social-fallback">{item.label.slice(0, 1) || "@"}</span>
              )}
            </a>
            {showLabels ? <span className="builder-preview-social-label">{item.label}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin module renderers ────────────────────────────────────────────────────

type AdminTeamUser = { id: string; email: string; role: string; createdAt: string };

function AdminTeamUsersPreview({
  settings,
  projectId: projectIdProp = "",
  theme,
  themePalette,
}: {
  settings: Record<string, string>;
  projectId?: string;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const tableTitle     = settings.tableTitle || "Team Members";
  const showTitle      = settings.showTitle !== "false";
  const showAddButton  = settings.showAddButton !== "false";
  const addButtonLabel = settings.addButtonLabel || "Add Team Member";
  const showEditBtn    = settings.showEditButton !== "false";
  const showDeleteBtn  = settings.showDeleteButton !== "false";
  const hasActions     = showEditBtn || showDeleteBtn;

  const [users, setUsers]           = useState<AdminTeamUser[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail]     = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole]       = useState("editor");
  const [addError, setAddError]     = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editRole, setEditRole]     = useState("editor");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError]   = useState("");
  const [sortColumn, setSortColumn] = useState("email");
  const [sortDirection, setSortDirection] = useState<AdminTableSortDirection>("asc");

  const headers = getCrmProjectHeaders(projectIdProp);

  function getTeamColumnValue(user: AdminTeamUser, key: string): string {
    if (key === "email") return user.email ?? "";
    if (key === "role") return user.role ?? "";
    if (key === "createdAt") return user.createdAt ?? "";
    return "";
  }

  const sortedUsers = [...users].sort((a, b) => compareAdminTableValues(
    getTeamColumnValue(a, sortColumn),
    getTeamColumnValue(b, sortColumn),
    sortDirection,
    sortColumn === "createdAt"
  ));

  function toggleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  async function loadUsers() {
    setLoading(true);
    setLoadError("");
    try {
      const r = await fetch("/api/admin/users", { credentials: "include", headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401 && !window.location.pathname.includes("builder-preview")) {
          window.location.href = "/admin-login";
          return;
        }
        setLoadError(d.error || "Failed to load team members");
        return;
      }
      const list = Array.isArray(d.adminUsers) ? d.adminUsers : Array.isArray(d.data) ? d.data : [];
      setUsers(list as AdminTeamUser[]);
    } catch {
      setLoadError("Failed to load team members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddError("");
    const projectId = headers["X-Project-ID"] || "";
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ email: addEmail, password: addPassword, role: addRole, projectId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAddError(d.error || "Failed to add team member"); return; }
      const created = (d.adminUser || d.data || d) as AdminTeamUser;
      setUsers((prev) => [...prev, created]);
      setShowAddForm(false);
      setAddEmail(""); setAddPassword(""); setAddRole("editor");
    } catch {
      setAddError("Failed to add team member");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleEditSave(userId: string) {
    setEditLoading(true);
    setEditError("");
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ role: editRole }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEditError(d.error || "Failed to update role"); return; }
      const updated = (d.adminUser || d.data || d) as AdminTeamUser;
      setUsers((prev) => prev.map((u) => u.id === userId ? updated : u));
      setEditUserId(null);
    } catch {
      setEditError("Failed to update role");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Remove "${email}" from the team? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      if (!r.ok) { alert("Failed to remove team member"); return; }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch {
      alert("Failed to remove team member");
    }
  }

  return (
    <div
      className="builder-admin-data-table-module"
      style={getAdminDataTableThemeStyle(themePalette, theme)}
    >
      {showTitle && <h2 className="builder-admin-data-table-title">{tableTitle}</h2>}
      {loading ? (
        <div className="builder-admin-data-table-stub">Loading team members…</div>
      ) : loadError ? (
        <div className="builder-admin-data-table-stub is-error">{loadError}</div>
      ) : (
        <>
          <div className="builder-admin-data-table-wrap">
            <table className="builder-admin-data-table">
              <thead>
                <tr className="builder-admin-data-table-filter-row table-filter-row">
                  <th />
                  <th />
                  <th />
                  {hasActions && (
                    <th className="builder-admin-data-table-actions-col actions-col">
                      {showAddButton && (
                        <button
                          type="button"
                          className="btn tiny-btn"
                          onClick={() => setShowAddForm(true)}
                        >
                          {addButtonLabel}
                        </button>
                      )}
                    </th>
                  )}
                </tr>
                <tr className="builder-admin-data-table-header-row">
                  <th
                    className="builder-admin-data-table-sortable"
                    onClick={() => toggleSort("email")}
                  >
                    {formatAdminSortableHeader("Email", "email", sortColumn, sortDirection)}
                  </th>
                  <th
                    className="builder-admin-data-table-sortable"
                    onClick={() => toggleSort("role")}
                  >
                    {formatAdminSortableHeader("Role", "role", sortColumn, sortDirection)}
                  </th>
                  <th
                    className="builder-admin-data-table-sortable"
                    onClick={() => toggleSort("createdAt")}
                  >
                    {formatAdminSortableHeader("Added", "createdAt", sortColumn, sortDirection)}
                  </th>
                  {hasActions && <th className="builder-admin-data-table-actions-col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sortedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={hasActions ? 4 : 3} className="builder-admin-data-table-empty">
                      No team members yet.
                    </td>
                  </tr>
                ) : sortedUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="builder-admin-data-table-cell">{u.email}</td>
                    <td className="builder-admin-data-table-cell">
                      {editUserId === u.id ? (
                        <select
                          className="crm-contacts-modal-input"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                        >
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="builder-admin-data-table-role-badge">{u.role}</span>
                      )}
                    </td>
                    <td className="builder-admin-data-table-cell builder-admin-data-table-date">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                    </td>
                    {hasActions && (
                      <td className="builder-admin-data-table-actions">
                        {editUserId === u.id ? (
                          <>
                            <button
                              type="button"
                              className="builder-admin-action-btn"
                              disabled={editLoading}
                              onClick={() => handleEditSave(u.id)}
                            >
                              {editLoading ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className="builder-admin-action-btn"
                              onClick={() => { setEditUserId(null); setEditError(""); }}
                            >
                              Cancel
                            </button>
                            {editError && <span className="builder-admin-data-table-inline-error">{editError}</span>}
                          </>
                        ) : (
                          <div className="table-actions-row" role="group">
                            {showEditBtn && (
                              <AdminTableIconButton
                                icon="edit"
                                label="Edit"
                                onClick={() => { setEditUserId(u.id); setEditRole(u.role); setEditError(""); }}
                              />
                            )}
                            {showDeleteBtn && (
                              <AdminTableIconButton
                                icon="delete"
                                label="Remove"
                                danger
                                onClick={() => handleDelete(u.id, u.email)}
                              />
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="builder-admin-data-table-count">
            {users.length} team member{users.length !== 1 ? "s" : ""}
          </div>

          {showAddButton && showAddForm && (
            <BuilderBodyPortal>
              <div className="crm-contacts-modal-overlay" onClick={() => !addLoading && setShowAddForm(false)}>
                <div className="crm-contacts-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="crm-contacts-modal-header">
                    <strong>Add Team Member</strong>
                    <button
                      type="button"
                      className="crm-contacts-modal-close"
                      onClick={() => setShowAddForm(false)}
                      disabled={addLoading}
                    >
                      ✕
                    </button>
                  </div>
                  <form onSubmit={handleAdd}>
                    <div className="crm-contacts-modal-body">
                      <div className="crm-contacts-modal-row crm-contacts-modal-row-edit">
                        <label className="crm-contacts-modal-label" htmlFor="admin-team-add-email">Email</label>
                        <input
                          id="admin-team-add-email"
                          className="crm-contacts-modal-input"
                          type="email"
                          required
                          value={addEmail}
                          onChange={(e) => setAddEmail(e.target.value)}
                        />
                      </div>
                      <div className="crm-contacts-modal-row crm-contacts-modal-row-edit">
                        <label className="crm-contacts-modal-label" htmlFor="admin-team-add-password">Password</label>
                        <input
                          id="admin-team-add-password"
                          className="crm-contacts-modal-input"
                          type="password"
                          required
                          minLength={8}
                          value={addPassword}
                          onChange={(e) => setAddPassword(e.target.value)}
                        />
                      </div>
                      <div className="crm-contacts-modal-row crm-contacts-modal-row-edit">
                        <label className="crm-contacts-modal-label" htmlFor="admin-team-add-role">Role</label>
                        <select
                          id="admin-team-add-role"
                          className="crm-contacts-modal-input"
                          value={addRole}
                          onChange={(e) => setAddRole(e.target.value)}
                        >
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      {addError && <p className="builder-admin-data-table-stub is-error">{addError}</p>}
                    </div>
                    <div className="crm-contacts-modal-footer">
                      <button
                        type="button"
                        className="crm-contacts-modal-btn"
                        onClick={() => { setShowAddForm(false); setAddError(""); }}
                        disabled={addLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="crm-contacts-modal-btn crm-contacts-modal-btn-primary"
                        disabled={addLoading}
                      >
                        {addLoading ? "Adding…" : addButtonLabel}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </BuilderBodyPortal>
          )}
        </>
      )}
    </div>
  );
}

// ── Admin Login ───────────────────────────────────────────────────────────────

function AdminLoginPreview({
  settings,
  projectId: projectIdProp = "",
}: {
  settings: Record<string, string>;
  projectId?: string;
}) {
  const formTitle          = settings.formTitle || "Admin Sign In";
  const buttonText         = settings.buttonText || "Sign In";
  const showForgotPassword = settings.showForgotPassword !== "false";

  const [authState, setAuthState]     = useState<"loading" | "authed" | "unauthed">("loading");
  const [adminEmail, setAdminEmail]   = useState("");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [showForgot, setShowForgot]   = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  // "request" = ask for the email, "code" = enter the emailed code + new password,
  // "done" = password changed. Replaces an earlier stub that only flipped a flag
  // and never contacted the server, so no reset email was ever sent.
  const [forgotStep, setForgotStep]       = useState<"request" | "code" | "done">("request");
  const [forgotNotice, setForgotNotice]   = useState("");
  const [forgotError, setForgotError]     = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [resetCode, setResetCode]         = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm]   = useState("");

  const successRedirect = settings.successRedirect || "/admin-dashboard";
  const projectId = projectIdProp || getCrmProjectHeaders()["X-Project-ID"] || "";
  const isPreview = typeof window !== "undefined" && window.location.pathname.includes("builder-preview");

  useEffect(() => {
    fetch("/api/admin/auth/me", { credentials: "include", headers: getAdminAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const adminUser = d?.adminUser ?? d?.data?.adminUser;
        if (adminUser) {
          setAdminEmail(adminUser.email || "");
          setAuthState("authed");
          if (!isPreview) window.location.href = successRedirect;
        } else {
          setAuthState("unauthed");
        }
      })
      .catch(() => setAuthState("unauthed"));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: email.trim().toLowerCase(), password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(readApiErrorMessage(d, "Invalid email or password"));
        return;
      }
      const payload = (d && typeof d === "object" ? d.data ?? d : {}) as Record<string, unknown>;
      const token = String(payload.sessionToken || "").trim();
      if (token) setAdminSessionToken(token);
      window.location.href = successRedirect;
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function closeForgot() {
    setShowForgot(false);
    setForgotStep("request");
    setForgotEmail("");
    setForgotNotice("");
    setForgotError("");
    setResetCode("");
    setResetPassword("");
    setResetConfirm("");
  }

  async function handleForgotRequest(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    setForgotNotice("");
    setForgotLoading(true);
    try {
      const r = await fetch("/api/admin/auth/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: forgotEmail.trim().toLowerCase() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setForgotError(readApiErrorMessage(d, "Could not send the reset email. Please try again."));
        return;
      }
      const payload = (d && typeof d === "object" ? d.data ?? d : {}) as Record<string, unknown>;
      setForgotNotice(
        String(d?.message || payload.message || "")
        || "If that email has an admin account, a 6-digit reset code is on its way."
      );
      setForgotStep("code");
    } catch {
      setForgotError("Connection error. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    if (resetPassword !== resetConfirm) {
      setForgotError("The two passwords do not match.");
      return;
    }
    if (resetPassword.length < 8) {
      setForgotError("Please choose a password of at least 8 characters.");
      return;
    }
    setForgotLoading(true);
    try {
      const r = await fetch("/api/admin/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          email: forgotEmail.trim().toLowerCase(),
          code: resetCode.trim(),
          password: resetPassword,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setForgotError(readApiErrorMessage(d, "That code is invalid or has expired."));
        return;
      }
      setForgotStep("done");
    } catch {
      setForgotError("Connection error. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    maxWidth: 420, margin: "0 auto", background: "#fff",
    border: "1px solid #dde8f0", borderRadius: 12, padding: "36px 32px",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", fontSize: 14, border: "1px solid #c9dcea",
    borderRadius: 7, boxSizing: "border-box", marginTop: 4,
  };
  const btnStyle: React.CSSProperties = {
    width: "100%", padding: "10px 0", background: "#0f4f8f", color: "#fff",
    border: "none", borderRadius: 7, fontWeight: 700, fontSize: 14,
    cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
    marginTop: 16,
  };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#18324a", display: "block", marginTop: 14 };

  if (!isPreview && (authState === "loading" || authState === "authed")) {
    return null;
  }

  if (showForgot) {
    const forgotBtnStyle: React.CSSProperties = {
      ...btnStyle,
      cursor: forgotLoading ? "not-allowed" : "pointer",
      opacity: forgotLoading ? 0.7 : 1,
    };
    const noticeStyle: React.CSSProperties = {
      marginTop: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7,
      padding: "12px 14px", fontSize: 13, color: "#15803d",
    };
    const errorStyle: React.CSSProperties = {
      marginTop: 10, fontSize: 13, color: "#c0392b", background: "#fef2f2",
      border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px",
    };

    return (
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#18324a", marginBottom: 4 }}>Reset Password</div>

        {forgotStep === "done" ? (
          <>
            <div style={noticeStyle}>
              Your password has been updated. You can sign in with it now.
            </div>
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button type="button" onClick={closeForgot} style={{ background: "none", border: "none", color: "#0f4f8f", fontSize: 13, cursor: "pointer" }}>
                Go to sign in
              </button>
            </div>
          </>
        ) : forgotStep === "code" ? (
          <>
            <div style={{ fontSize: 13, color: "#587592", marginBottom: 4 }}>
              Enter the 6-digit code we emailed you, then choose a new password.
            </div>
            {forgotNotice && <div style={noticeStyle}>{forgotNotice}</div>}
            <form onSubmit={handleResetSubmit}>
              <label style={labelStyle}>6-digit code</label>
              <input
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                style={inputStyle}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
              />
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                style={inputStyle}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                style={inputStyle}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="Re-type it"
              />
              {forgotError && <div style={errorStyle}>{forgotError}</div>}
              <button type="submit" disabled={forgotLoading} style={forgotBtnStyle}>
                {forgotLoading ? "Updating…" : "Set New Password"}
              </button>
            </form>
            <div style={{ marginTop: 12, textAlign: "center" }}>
              <button
                type="button"
                onClick={() => { setForgotStep("request"); setForgotError(""); setForgotNotice(""); }}
                style={{ background: "none", border: "none", color: "#587592", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
              >
                Didn&rsquo;t get a code? Send it again
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#587592", marginBottom: 4 }}>
              Enter your email and we&rsquo;ll send you a 6-digit code to set a new password.
            </div>
            <form onSubmit={handleForgotRequest}>
              <label style={labelStyle}>Email address</label>
              <input
                type="email"
                required
                autoComplete="email"
                style={inputStyle}
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@example.com"
              />
              {forgotError && <div style={errorStyle}>{forgotError}</div>}
              <button type="submit" disabled={forgotLoading} style={forgotBtnStyle}>
                {forgotLoading ? "Sending…" : "Email Me A Code"}
              </button>
            </form>
          </>
        )}

        {forgotStep !== "done" && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button type="button" onClick={closeForgot} style={{ background: "none", border: "none", color: "#0f4f8f", fontSize: 13, cursor: "pointer" }}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 700, fontSize: 20, color: "#18324a", marginBottom: 20 }}>{formTitle}</div>
      <form onSubmit={handleLogin}>
        <label style={labelStyle}>Email address</label>
        <input type="email" required style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label style={labelStyle}>Password</label>
        <input type="password" required style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "#c0392b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px" }}>{error}</div>}
        <button type="submit" disabled={loading} style={btnStyle}>{loading ? "Signing in…" : buttonText}</button>
      </form>
      {showForgotPassword && (
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button onClick={() => setShowForgot(true)} style={{ background: "none", border: "none", color: "#587592", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
            Forgot your password?
          </button>
        </div>
      )}
    </div>
  );
}

// ── Admin Nav Link ────────────────────────────────────────────────────────────

/** Conditional header/nav link — only renders once the admin nav cookie is set (i.e. an admin is signed in). */
function AdminNavLinkPreview({ settings }: { settings: Record<string, string> }) {
  const linkText = settings.linkText || "Admin";
  const linkHref = settings.linkHref || "/admin-login";
  const isPreview = typeof window !== "undefined" && window.location.pathname.includes("builder-preview");

  const [visible, setVisible] = useState(isPreview);

  useEffect(() => {
    if (isPreview) return;
    setVisible(isAdminNavCookieSet());
  }, [isPreview]);

  if (!visible) return null;

  return (
    <a href={linkHref} className="builder-admin-nav-link">
      {linkText}
    </a>
  );
}

const PREMIUM_MODULE_GROUPS: Array<{ key: string; label: string; description: string }> = [
  { key: "crm",  label: "CRM",  description: "Lead capture forms and contact table" },
  { key: "blog", label: "Blog", description: "Blog post feeds, editors, and author bios" },
  { key: "events", label: "Events", description: "Event calendar with an admin manager" },
];

/** Mirrors MAX_CONTACT_ALERT_RECIPIENTS in lib/projectSiteSettingsStore.js. */
const MAX_CONTACT_ALERT_RECIPIENTS = 10;

/**
 * Read the stored Contact Alert value into editable rows.
 *
 * Handles both shapes: an array (current) and a bare string (older project
 * rows, from before this setting took more than one address). Always returns
 * at least one row so the field is visible when nothing is set yet.
 */
function readEmailList(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value.map((v) => String(v ?? ""))
    : String(value ?? "").split(/[,;\n]/);
  const cleaned = list.map((v) => v.trim()).filter(Boolean);
  return cleaned.length ? cleaned : [""];
}

/**
 * Settings panel for a tenant's own admin area (/admin-settings).
 *
 * Backed by GET/PATCH /api/admin/site-settings, which pins a project-admin
 * session to its own project — so this reads and writes only the site the
 * signed-in admin belongs to.
 */
function AdminSiteSettingsPreview({
  settings,
  projectId: projectIdProp = "",
}: {
  settings: Record<string, string>;
  projectId?: string;
}) {
  const panelTitle = settings.panelTitle || "Site Settings";
  const showTitle  = settings.showTitle !== "false";

  // Always at least one row, so the field is visible when nothing is set yet.
  const [contactAlertEmails, setContactAlertEmails] = useState<string[]>([""]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedNote, setSavedNote] = useState("");

  const headers = getCrmProjectHeaders(projectIdProp);
  const isPreview = typeof window !== "undefined" && window.location.pathname.includes("builder-preview");

  useEffect(() => {
    const projectId = headers["X-Project-ID"] || "";
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    fetch(`/api/admin/site-settings${qs}`, { credentials: "include", headers })
      .then(async (r) => {
        if (r.status === 401 && !isPreview) {
          window.location.href = "/admin-login";
          return null;
        }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(readApiErrorMessage(d, `Failed to load settings (${r.status})`));
        return d;
      })
      .then((d) => {
        if (!d) return;
        const s = d.siteSettings ?? d.data ?? d;
        if (s && typeof s === "object") {
          setContactAlertEmails(readEmailList((s as Record<string, unknown>).contactAlertEmail));
        }
      })
      .catch((e: Error) => setLoadError(e.message || "Failed to load settings."))
      .finally(() => setLoading(false));
  }, []);

  function updateRecipient(index: number, value: string) {
    setContactAlertEmails((prev) => prev.map((v, i) => (i === index ? value : v)));
    setSavedNote("");
  }

  function addRecipient() {
    setContactAlertEmails((prev) => [...prev, ""]);
    setSavedNote("");
  }

  function removeRecipient(index: number) {
    // Never drop to zero rows — an empty list is expressed by leaving the one
    // remaining box blank, which is clearer than the field vanishing.
    setContactAlertEmails((prev) => (prev.length <= 1 ? [""] : prev.filter((_, i) => i !== index)));
    setSavedNote("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");
    setSavedNote("");
    setSaving(true);
    try {
      const projectId = headers["X-Project-ID"] || "";
      const r = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          projectId,
          // Blank rows are dropped rather than rejected, so an empty box the
          // user never filled in does not block the save.
          settings: {
            contactAlertEmail: contactAlertEmails
              .map((v) => v.trim().toLowerCase())
              .filter(Boolean),
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSaveError(readApiErrorMessage(d, "Could not save settings."));
        return;
      }
      // Show what the server actually stored, not what was typed — a save
      // toast alone proves a write happened, not that it wrote the right value.
      const s = (d.siteSettings ?? d.data ?? d) as Record<string, unknown>;
      if (s && typeof s === "object" && s.contactAlertEmail !== undefined) {
        setContactAlertEmails(readEmailList(s.contactAlertEmail));
      }
      setSavedNote("Saved.");
    } catch {
      setSaveError("Connection error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="builder-module-runtime-wrapper" style={{ padding: "1rem" }}>
      {showTitle && <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>{panelTitle}</h3>}
      {loading ? (
        <p className="builder-module-runtime-note">Loading settings…</p>
      ) : loadError ? (
        <p className="builder-module-runtime-note" style={{ color: "var(--danger, #c00)" }}>{loadError}</p>
      ) : (
        <form onSubmit={handleSave} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <div style={{ padding: "14px 16px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8 }}>
            <label htmlFor="admin-contact-alert-email-0" style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
              Contact Alert Email
            </label>
            <p style={{ margin: "2px 0 8px", fontSize: 12, color: "var(--muted, #888)" }}>
              Where we email you when someone submits a contact form on your site.
              Add as many recipients as you like &mdash; they all receive the same
              message. Leave them blank to turn these alerts off.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {contactAlertEmails.map((value, index) => (
                <div key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id={`admin-contact-alert-email-${index}`}
                    type="email"
                    value={value}
                    onChange={(e) => updateRecipient(index, e.target.value)}
                    placeholder="you@example.com"
                    aria-label={`Contact alert recipient ${index + 1}`}
                    style={{
                      width: "100%", maxWidth: 340, padding: "7px 10px", fontSize: 14,
                      border: "1px solid #c9dcea", borderRadius: 7, boxSizing: "border-box",
                    }}
                  />
                  {contactAlertEmails.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRecipient(index)}
                      aria-label={`Remove recipient ${index + 1}`}
                      title="Remove this recipient"
                      style={{
                        border: "none", background: "none", cursor: "pointer",
                        fontSize: 18, lineHeight: 1, padding: "0 4px",
                        color: "var(--muted, #888)",
                      }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
            {contactAlertEmails.length < MAX_CONTACT_ALERT_RECIPIENTS ? (
              <button
                type="button"
                onClick={addRecipient}
                style={{
                  marginTop: 10, border: "none", background: "none", padding: 0,
                  color: "#0f4f8f", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", textDecoration: "underline",
                }}
              >
                + Add Recipient
              </button>
            ) : (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted, #888)" }}>
                That&rsquo;s the maximum of {MAX_CONTACT_ALERT_RECIPIENTS} recipients.
              </p>
            )}
          </div>
          {saveError && (
            <p className="builder-module-runtime-note" style={{ margin: 0, color: "var(--danger, #c00)" }}>{saveError}</p>
          )}
          {savedNote && (
            <p className="builder-module-runtime-note" style={{ margin: 0, color: "#15803d" }}>{savedNote}</p>
          )}
          <div>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 6,
                border: "1px solid #0f4f8f", background: "#0f4f8f", color: "#fff",
                cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1,
                whiteSpace: "nowrap", width: "fit-content",
              }}
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Support request form ────────────────────────────────────────────────────

/** Mirrors PRIORITIES in lib/projectSupportRequestsStore.js and the SQL CHECK. */
const SUPPORT_PRIORITIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "low", label: "Low — whenever you get to it" },
  { value: "normal", label: "Normal — needs attention soon" },
  { value: "high", label: "High — something is broken" },
  { value: "urgent", label: "Urgent — the site is down" },
];

/** Same ceiling as routes/projectSupport.js, checked here to fail fast. */
const MAX_SCREENSHOT_BASE64_CHARS = 9_000_000;

type SupportRequestRecord = {
  id: string;
  priority: string;
  title: string;
  description: string;
  screenshotUrl: string;
  status: string;
  createdAt: string | null;
};

function supportPriorityLabel(value: string): string {
  switch (value) {
    case "low": return "Low";
    case "high": return "High";
    case "urgent": return "Urgent";
    default: return "Normal";
  }
}

function supportStatusLabel(value: string): string {
  switch (value) {
    case "in_progress": return "In progress";
    case "resolved": return "Resolved";
    case "closed": return "Closed";
    default: return "Open";
  }
}

function formatSupportDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Strip the `data:image/png;base64,` prefix a FileReader result carries. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Support request form for a tenant's own admin area (/admin-support).
 *
 * Backed by POST/GET /api/support/requests, which pins a project-admin session
 * to its own project — an admin can only ever file against, and read back,
 * the site they belong to.
 */
function AdminSupportFormPreview({
  settings,
  projectId: projectIdProp = "",
}: {
  settings: Record<string, string>;
  projectId?: string;
}) {
  const formTitle      = settings.formTitle || "Request Support";
  const showTitle      = settings.showTitle !== "false";
  const buttonText     = settings.buttonText || "Send Request";
  const showScreenshot = settings.showScreenshot !== "false";
  const showHistory    = settings.showHistory !== "false";
  const historyTitle   = settings.historyTitle || "Your Recent Requests";
  const showContact    = settings.showContact !== "false";
  const contactHeading = settings.contactHeading ?? "Need a hand with your website?";
  const contactIntro   = settings.contactIntro ?? "";
  // Two columns by default: the form and the request history read better side
  // by side than stacked. Falls back to one column on narrow screens.
  const twoColumn      = (settings.layout ?? "two-column") !== "stacked";
  const defaultPriority = SUPPORT_PRIORITIES.some((p) => p.value === settings.defaultPriority)
    ? settings.defaultPriority
    : "normal";

  const [priority, setPriority]       = useState(defaultPriority);
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile]               = useState<File | null>(null);
  const [fileError, setFileError]     = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successNote, setSuccessNote] = useState("");
  const [warningNote, setWarningNote] = useState("");

  const [history, setHistory] = useState<SupportRequestRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(showHistory);

  // Support contact details come from StarCaster > Settings > Projects > Edit.
  // They are platform-only settings that a tenant may READ but not write, so
  // the client cannot change the number they are told to call.
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");

  const headers = getCrmProjectHeaders(projectIdProp);
  const isPreview = typeof window !== "undefined" && window.location.pathname.includes("builder-preview");

  useEffect(() => {
    if (!showContact) return;
    const projectId = headers["X-Project-ID"] || "";
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    fetch(`/api/admin/site-settings${qs}`, { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const s = (d.siteSettings ?? d.data ?? d) as Record<string, unknown>;
        if (s && typeof s === "object") {
          setSupportEmail(String(s.supportEmail ?? ""));
          setSupportPhone(String(s.supportPhone ?? ""));
        }
      })
      // Contact details are a nicety; failing to load them must not stop the
      // admin filing a request, so this stays silent.
      .catch(() => {});
  }, []);

  function loadHistory() {
    if (!showHistory) return;
    const projectId = headers["X-Project-ID"] || "";
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    fetch(`/api/support/requests${qs}`, { credentials: "include", headers })
      .then(async (r) => {
        if (r.status === 401 && !isPreview) {
          window.location.href = "/admin-login";
          return null;
        }
        if (!r.ok) return null;
        return r.json().catch(() => null);
      })
      .then((d) => {
        if (!d) return;
        const rows = d.supportRequests ?? d.data ?? [];
        if (Array.isArray(rows)) setHistory(rows as SupportRequestRecord[]);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }

  useEffect(loadHistory, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError("");
    const picked = e.target.files?.[0] || null;
    if (picked && !picked.type.startsWith("image/")) {
      setFile(null);
      setFileError("Please choose an image file (PNG, JPG or GIF).");
      return;
    }
    setFile(picked);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setSuccessNote("");
    setWarningNote("");

    if (!title.trim()) {
      setSubmitError("Please give the issue a short title.");
      return;
    }
    setSubmitting(true);

    try {
      let screenshot: { fileName: string; mimeType: string; fileBase64: string } | undefined;
      if (file) {
        const fileBase64 = await readFileAsBase64(file);
        if (fileBase64.length > MAX_SCREENSHOT_BASE64_CHARS) {
          setSubmitError("That screenshot is too large. Please use an image under about 6MB.");
          return;
        }
        screenshot = { fileName: file.name, mimeType: file.type, fileBase64 };
      }

      const projectId = headers["X-Project-ID"] || "";
      const r = await fetch("/api/support/requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          projectId,
          priority,
          title: title.trim(),
          description: description.trim(),
          ...(screenshot ? { screenshot } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSubmitError(readApiErrorMessage(d, "Could not send your request."));
        return;
      }

      // Say what actually happened. The request is saved either way, but if the
      // notification email did not go out, claiming "we have been notified"
      // would be a lie.
      setSuccessNote(d.emailSent
        ? "Thanks — your request has been sent. We'll be in touch."
        : "Your request has been saved, but the notification email could not be sent. Please follow up using the contact details on this page.");
      if (d.screenshotWarning) setWarningNote(String(d.screenshotWarning));

      setTitle("");
      setDescription("");
      setPriority(defaultPriority);
      setFile(null);
      const created = d.supportRequest ?? d.data;
      if (created && typeof created === "object") {
        setHistory((prev) => [created as SupportRequestRecord, ...prev]);
      }
    } catch {
      setSubmitError("Connection error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: 14,
    border: "1px solid #c9dcea", borderRadius: 7, boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4 };

  return (
    <div className="builder-module-runtime-wrapper" style={{ padding: "1rem" }}>
      {showContact && (contactHeading || contactIntro || supportEmail || supportPhone) ? (
        <div style={{ marginBottom: 22, maxWidth: 560 }}>
          {contactHeading ? (
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>{contactHeading}</h3>
          ) : null}
          {contactIntro ? (
            <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 }}>{contactIntro}</p>
          ) : null}
          {supportEmail || supportPhone ? (
            <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
              {supportEmail ? (
                <div><strong>Email:</strong>{" "}
                  <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
                </div>
              ) : null}
              {supportPhone ? (
                <div><strong>Phone:</strong>{" "}
                  <a href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}>{supportPhone}</a>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        style={twoColumn
          // auto-fit + minmax gives two columns when there is room for two
          // and one when there is not, with no media query — which matters
          // because these are inline styles and cannot carry one.
          ? {
              display: "grid",
              gap: 32,
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
              alignItems: "start",
            }
          : { display: "grid", gap: 28 }}
      >
        <div>
      {showTitle && <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>{formTitle}</h3>}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        <div>
          <label htmlFor="admin-support-priority" style={labelStyle}>Priority</label>
          <select
            id="admin-support-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={fieldStyle}
          >
            {SUPPORT_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="admin-support-title" style={labelStyle}>Issue title</label>
          <input
            id="admin-support-title"
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(e) => { setTitle(e.target.value); setSuccessNote(""); }}
            placeholder="Short summary of the problem"
            style={fieldStyle}
          />
        </div>

        <div>
          <label htmlFor="admin-support-description" style={labelStyle}>Issue description</label>
          <textarea
            id="admin-support-description"
            rows={6}
            maxLength={5000}
            value={description}
            onChange={(e) => { setDescription(e.target.value); setSuccessNote(""); }}
            placeholder="What happened, what were you doing at the time, and what did you expect instead?"
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {showScreenshot && (
          <div>
            <label htmlFor="admin-support-screenshot" style={labelStyle}>Screenshot (optional)</label>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted, #888)" }}>
              A picture of what you are seeing helps a lot. Images up to about 6MB.
            </p>
            <input
              id="admin-support-screenshot"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ fontSize: 13 }}
            />
            {file && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted, #888)" }}>
                Attached: {file.name}
              </p>
            )}
            {fileError && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--danger, #c00)" }}>{fileError}</p>
            )}
          </div>
        )}

        {submitError && (
          <p className="builder-module-runtime-note" style={{ margin: 0, color: "var(--danger, #c00)" }}>{submitError}</p>
        )}
        {successNote && (
          <p className="builder-module-runtime-note" style={{ margin: 0, color: "#15803d" }}>{successNote}</p>
        )}
        {warningNote && (
          <p className="builder-module-runtime-note" style={{ margin: 0, color: "#b45309" }}>{warningNote}</p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: "1px solid #0f4f8f", background: "#0f4f8f", color: "#fff",
              cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1,
              whiteSpace: "nowrap", width: "fit-content",
            }}
          >
            {submitting ? "Sending…" : buttonText}
          </button>
        </div>
      </form>
        </div>

      {showHistory && (
        <div style={{ maxWidth: 560 }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>{historyTitle}</h4>
          {historyLoading ? (
            <p className="builder-module-runtime-note">Loading your requests…</p>
          ) : history.length === 0 ? (
            <p className="builder-module-runtime-note">You haven&rsquo;t sent any support requests yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {history.map((r) => (
                <div
                  key={r.id}
                  style={{ padding: "10px 14px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <strong style={{ fontSize: 14 }}>{r.title}</strong>
                    <span style={{ fontSize: 12, color: "var(--muted, #888)", whiteSpace: "nowrap" }}>
                      {formatSupportDate(r.createdAt)}
                    </span>
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted, #888)" }}>
                    {supportPriorityLabel(r.priority)} priority &middot; {supportStatusLabel(r.status)}
                    {r.screenshotUrl ? " · screenshot attached" : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function AdminModulesPreview({
  settings,
  projectId: projectIdProp = "",
}: {
  settings: Record<string, string>;
  projectId?: string;
}) {
  const tableTitle  = settings.tableTitle || "Premium Modules";
  const showTitle   = settings.showTitle !== "false";
  const showToggle  = settings.showToggle !== "false";

  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const headers = getCrmProjectHeaders(projectIdProp);

  useEffect(() => {
    const projectId = headers["X-Project-ID"] || "";
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    fetch(`/api/admin/enabled-modules${qs}`, { credentials: "include", headers })
      .then((r) => {
        if (r.status === 401 && !window.location.pathname.includes("builder-preview")) {
          window.location.href = "/admin-login";
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (!d) return;
        const mods = d.enabledModules ?? d.data ?? d;
        if (mods && typeof mods === "object" && !Array.isArray(mods)) {
          setEnabledModules(mods as Record<string, boolean>);
        }
      })
      .catch(() => setLoadError("Failed to load module settings"))
      .finally(() => setLoading(false));
  }, []);

  async function toggleModule(key: string, enabled: boolean) {
    setSaving(key);
    const projectId = headers["X-Project-ID"] || "";
    try {
      const r = await fetch("/api/admin/enabled-modules", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ projectId, modules: { [key]: enabled } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || "Failed to update module"); return; }
      const updated = d.enabledModules ?? d.data ?? d;
      if (updated && typeof updated === "object") setEnabledModules(updated as Record<string, boolean>);
    } catch {
      alert("Failed to update module");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="builder-module-runtime-wrapper" style={{ padding: "1rem" }}>
      {showTitle && <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>{tableTitle}</h3>}
      {loading ? (
        <p className="builder-module-runtime-note">Loading module settings…</p>
      ) : loadError ? (
        <p className="builder-module-runtime-note" style={{ color: "var(--danger, #c00)" }}>{loadError}</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {PREMIUM_MODULE_GROUPS.map(({ key, label, description }) => {
            const isEnabled = enabledModules[key] === true;
            const isSaving  = saving === key;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8, background: isEnabled ? "rgba(15,79,143,0.04)" : undefined }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{label}</strong>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted, #888)" }}>{description}</p>
                </div>
                {showToggle ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => toggleModule(key, !isEnabled)}
                    style={{ padding: "6px 16px", fontSize: 13, cursor: isSaving ? "default" : "pointer", background: isEnabled ? "#0f4f8f" : undefined, color: isEnabled ? "#fff" : undefined, borderRadius: 6, border: `1px solid ${isEnabled ? "#0f4f8f" : "#ccc"}`, minWidth: 80 }}
                  >
                    {isSaving ? "…" : isEnabled ? "Enabled" : "Enable"}
                  </button>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: isEnabled ? "#0f4f8f" : "var(--muted, #888)" }}>{isEnabled ? "Enabled" : "Disabled"}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
