"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, type FormEvent, type MouseEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { BuilderTemplateSection } from "@/lib/builder-template";
import {
  formatRichTextContent,
  getBuilderBackgroundStyle,
  getLayoutColumns,
  getLayoutGridTemplate,
  resolvePublicBuilderAssetUrl
} from "@/lib/builder-template";
import { sanitizeEmbedHtml } from "@/lib/sanitize-html";
import {
  buildCrmFormRenderContext,
  crmFormStylesToRenderStyles,
  publicFormFields
} from "../lib/crmFormStyles.js";
import {
  ADMIN_LOGIN_PATH,
  getAdminAuthHeaders,
  isAdminLogoutHref,
  readApiErrorMessage,
  redirectAfterAdminLogout,
  setAdminSessionToken,
} from "@/lib/public-admin-session";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
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
  getSectionMarginStyle,
  getModuleMarginStyle,
  getModuleOuterSpacingStyle,
  getVerticalMarginStyle,
  getVideoEmbedSource,
  isVideoMedia
} from "@/components/builder/builder-utils";
import { BuilderCodeEmbed } from "@/components/builder/builder-code-embed";
import { BuilderBodyPortal } from "@/components/builder/builder-body-portal";
import { BuilderImagePickerField } from "@/components/builder/builder-image-picker-field";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
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
  /** Project ID for contact form submissions on live landing pages. */
  projectId?: string;
  /** When false, page margins are applied by an outer public-site wrapper instead. */
  applyThemePageMargins?: boolean;
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
  const renderStyles = crmFormStylesToRenderStyles(form.styles, form.accentColor, renderContext);
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
  projectId = "",
  applyThemePageMargins = true
}: BuilderTemplatePreviewProps) {
  const shellBackground = getShellBackgroundLayers(pageBackground, themeShellBackground);
  const hasResolvedShellBackground = Boolean(
    shellBackground.inlineBackground || shellBackground.backdrop
  );
  const themeMarginStyle = applyThemePageMargins ? getBuilderThemePageMarginStyle(themeStyles) : {};
  // Theme tokens go first so the page background (and any per-module inline
  // styles further down) still win where they overlap.
  const rootStyle = {
    ...getThemeRootVars(theme),
    ...getCrmThemePaletteVars(themePalette),
    ...getBuilderThemeStyleVars(themeStyles),
    ...shellBackground.inlineBackground
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
      {shellBackground.backdrop ? (
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
          {mainSections.map((section) => (
            <BuilderSectionPreview
              emailPreview={emailPreview}
              key={section.id}
              previewMode={previewMode}
              section={section}
              sitePlayerRegistered={sitePlayerRegistered}
              theme={theme}
              themePalette={themePalette}
            />
          ))}
        </div>
      ) : (
        mainSections.map((section) => (
          <BuilderSectionPreview
            emailPreview={emailPreview}
            key={section.id}
            previewMode={previewMode}
            section={section}
            sitePlayerRegistered={sitePlayerRegistered}
            theme={theme}
            themePalette={themePalette}
          />
        ))
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
  projectId = "",
  sitePlayerRegistered = false,
  theme,
  themePalette
}: {
  section: BuilderTemplateSection;
  emailPreview?: boolean;
  previewMode?: boolean;
  projectId?: string;
  sitePlayerRegistered?: boolean;
  theme?: import("@/lib/builder-template").BuilderTheme;
  themePalette?: import("@/components/builder/builder-utils").CrmThemePalette;
}) {
  const sectionStyle = getBuilderBackgroundStyle(section.background);
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
  const gridStyle: CSSProperties = {
    ...(isNavigationSection ? {} : sectionStyle),
    ...(isOverlayLayoutCollapsed ? {} : getSectionMarginStyle(section)),
    ...getOverlayFlowCollapsedSectionStyle(isOverlayLayoutCollapsed),
    ...(isSectionOverlaySlot
      ? { position: "relative", zIndex: resolveSectionScopedOverlaySectionZIndex(section) }
      : hasNavigationModule
      ? { position: "relative", zIndex: 10 }
      : {}),
    ...(rowBorderWidth > 0 && !isNavigationSection && !isOverlayLayoutCollapsed
      ? {
          border: `${rowBorderWidth}px ${section.rowBorderStyle ?? "solid"} ${section.rowBorderColor ?? "#000000"}`,
          borderRadius: `${section.rowBorderRadius ?? "0"}px`
        }
      : {}),
    display: "grid",
    gridTemplateColumns: getLayoutGridTemplate(section.layout),
    gap: isOverlayLayoutCollapsed ? 0 : "16px",
    "--builder-layout-grid": getLayoutGridTemplate(section.layout)
  } as CSSProperties;

  return (
    <section
      className={`builder-preview-section builder-preview-section-layout-${section.layout || "single"} builder-preview-section-mobile-${section.mobileLayout || "stack"} ${
        isNavigationSection ? "builder-preview-section-navigation" : ""
      }${isPageOverlayFlowSection ? " builder-preview-section-overlay-flow" : ""}${
        isSectionOverlaySlot ? " builder-preview-section-overlay-slot" : ""
      }${hasPollModules ? " builder-preview-section-poll-row" : ""}`}
      style={gridStyle}
    >
      {columnKeys.map((columnKey) => {
        const columnModules = section.modules.filter((module) => module.column === columnKey);
        const isNavigationColumn = columnModules.length > 0 && columnModules.every((module) => module.type === "navigation");
        const columnBackground = section.cellBackgrounds?.[columnKey];
        const padding = section.cellPadding?.[columnKey] ?? "0";
        const verticalMargin = section.cellVerticalMargin?.[columnKey] ?? "0";
        const borderWidth = section.cellBorderWidth?.[columnKey] ?? "0";
        const borderColor = section.cellBorderColor?.[columnKey] ?? "transparent";
        const borderRadius = section.cellBorderRadius?.[columnKey] ?? "0";
        const isPageOverlayFlowColumn =
          columnModules.length > 0 &&
          columnModules.every((module) => isOverlayImageModule(module) && !isSectionScopedOverlayDecor(module));
        const isSectionOverlayColumn = columnHasOnlySectionScopedOverlayModules(columnModules);
        const columnStyle: CSSProperties = {
          ...(isNavigationColumn || !columnBackground ? {} : getBuilderBackgroundStyle(columnBackground)),
          ...(isPageOverlayFlowColumn || isSectionOverlayColumn ? {} : getVerticalMarginStyle(verticalMargin)),
          ...getOverlayFlowCollapsedColumnStyle(isPageOverlayFlowColumn),
          ...getSectionScopedOverlayColumnStyle(isSectionOverlayColumn),
          ...(Number(padding) > 0 && !isPageOverlayFlowColumn && !isSectionOverlayColumn
            ? { "--builder-cell-padding": `${padding}px` }
            : {}),
          padding: isNavigationColumn || isPageOverlayFlowColumn || isSectionOverlayColumn ? 0 : `${padding}px`,
          border:
            isPageOverlayFlowColumn || isSectionOverlayColumn || Number(borderWidth) <= 0
              ? undefined
              : `${borderWidth}px solid ${borderColor}`,
          borderRadius: isPageOverlayFlowColumn || isSectionOverlayColumn ? 0 : `${borderRadius}px`,
          ...(isNavigationColumn || isPageOverlayFlowColumn || isSectionOverlayColumn
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
                    ...(module.type === "navigation" ||
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
                      : module.type === "heading"
                        ? getModuleMarginStyle(module.settings)
                        : module.type === "button"
                          ? getModuleOuterSpacingStyle(module.settings)
                          : getVerticalMarginStyle(module.settings.verticalMargin)),
                    ...getOverlayFlowCollapsedModuleStyle(isPageOverlayFlowModule),
                    ...getSectionScopedOverlayModuleStyle(isSectionOverlayModule),
                    "--builder-mobile-font-size": module.settings.mobileFontSize
                      ? `${module.settings.mobileFontSize}px`
                      : undefined
                  } as CSSProperties}
                >
                  <BuilderModulePreview
                    emailPreview={emailPreview}
                    module={module}
                    overlayFlowDecor={isPageOverlayFlowModule || isSectionOverlayModule}
                    previewMode={previewMode}
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
  emailPreview = false,
  overlayFlowDecor = false,
  previewMode = false,
  projectId = "",
  sitePlayerRegistered = false,
  theme,
  themePalette
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
  emailPreview?: boolean;
  /** Floating image in a full-page overlay row — always visible on the live site. */
  overlayFlowDecor?: boolean;
  previewMode?: boolean;
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
    return (
      <Tag
        className={`builder-preview-heading builder-preview-heading-${variant || "default"}`}
        style={getHeadingModuleStyle(module.settings)}
      >
        {module.text || ""}
      </Tag>
    );
  }

  if (module.type === "headline-rotator") {
    return <HeadlineRotatorPreview module={module} />;
  }

  if (module.type === "poll-category-list") {
    return <PollCategoryListPreview module={module} />;
  }

  if (module.type === "text") {
    return (
      <div
        className={`builder-preview-text builder-preview-text-${variant || "default"}`}
        dangerouslySetInnerHTML={{ __html: formatRichTextContent(module.text) || "" }}
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
    const btnStyle = getButtonModuleStyle(s);
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
      <BuilderImagePreview module={module} variant={variant} placeholder="Choose an image" />
    );
  }

  if (module.type === "table") {
    return <TableModulePreview module={module} />;
  }

  if (module.type === "slider") {
    return <SliderModulePreview module={module} />;
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
  if (module.type === "blog-post" || module.type === "blog-post-view") {
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
  const postPageUrl = (settings.postPageUrl || "").trim() || defaultBlogPostViewPath();

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
                case "featured_image":
                  if (isSideBySide || !imageUrl) return null;
                  return (
                    <div style={{ width: "calc(100% + 2.5rem)", marginLeft: "-1.25rem", marginTop: "-1.125rem", overflow: "hidden", aspectRatio: aspectRatioMap[tplAspect] ?? "16/9" }}>
                      <img alt={post.title} src={imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                  );
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
              <article key={post.id} style={{ ...cardBorder, borderRadius: cardRadius, overflow: "hidden", background: "#fff", display: "flex", flexDirection: isSideBySide ? "row" : "column" }}>
                {isSideBySide && imageUrl && hasFeaturedImageInRows ? (
                  <div style={{ flexShrink: 0, width: 220, overflow: "hidden" }}>
                    <img alt={post.title} src={imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </div>
                ) : null}
                <div style={{ padding: "1.125rem 1.25rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem" }}>
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
  rows: [
    { id: "r1", cols: 1, slots: ["categories"] },
    { id: "r2", cols: 1, slots: ["headline"] },
    { id: "r3", cols: 1, slots: ["featured_image"] },
    { id: "r4", cols: 1, slots: ["excerpt"] },
    { id: "r5", cols: 3, slots: ["author", "date", "read_more"] },
  ],
};

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
    rows,
  };
}

function renderSampleElement(id: CardElementId, accentColor: string, readMoreLabel: string, imgAspect: string, isSideBySide: boolean): React.ReactNode {
  const sampleImageUrl = "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=70";
  switch (id) {
    case "categories":
      return <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accentColor }}>Technology</span>;
    case "headline":
      return <span style={{ fontSize: "0.95rem", lineHeight: 1.3, color: "#1a202c", fontWeight: 700, display: "block" }}>Sample Blog Post Title</span>;
    case "featured_image":
      if (isSideBySide) return null;
      return (
        <div style={{ width: "calc(100% + 2.5rem)", marginLeft: "-1.25rem", overflow: "hidden", aspectRatio: imgAspect }}>
          <img alt="" src={sampleImageUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      );
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
  const { cardLayout, imageAspectRatio, cardStyle, cardBorderRadius, readMoreLabel, accentColor, rows } = tpl;
  const aspectRatioMap: Record<string, string> = { "16:9": "16/9", "4:3": "4/3", "3:2": "3/2", "1:1": "1/1" };
  const imgAspect = aspectRatioMap[imageAspectRatio] ?? "16/9";
  const cardBorder: CSSProperties =
    cardStyle === "bordered" ? { border: `1px solid ${accentColor}40`, boxShadow: "none" }
    : cardStyle === "shadow"  ? { border: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }
    : { border: "1px solid #e2e8f0", boxShadow: "none" };
  const isSideBySide = cardLayout === "side-by-side";
  const hasFeaturedImage = rows.some((r) => r.slots.includes("featured_image"));
  const sampleImageUrl = "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=70";

  return (
    <article style={{ ...cardBorder, borderRadius: cardBorderRadius, overflow: "hidden", background: "#fff", display: "flex", flexDirection: isSideBySide ? "row" : "column", maxWidth: 340 }}>
      {isSideBySide && hasFeaturedImage ? (
        <div style={{ flexShrink: 0, width: 110, overflow: "hidden" }}>
          <img alt="" src={sampleImageUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      ) : null}
      <div style={{ padding: "1rem 1.25rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {rows.map((row) => {
          const filledSlots = row.slots.filter(Boolean);
          if (filledSlots.length === 0) return null;
          return (
            <div key={row.id} style={row.cols > 1 ? { display: "grid", gridTemplateColumns: `repeat(${row.cols}, 1fr)`, gap: "0.5rem", alignItems: "center" } : {}}>
              {row.slots.map((slot, si) => slot ? (
                <div key={si}>{renderSampleElement(slot, accentColor, readMoreLabel, imgAspect, isSideBySide)}</div>
              ) : <div key={si} />)}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function BlogCardManagerPreview() {
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

  return (
    <div className="builder-blog-card-manager-module builder-admin-data-table-module">
      <h3 className="builder-admin-data-table-title">Blog Card Template Manager</h3>

      {/* ── Card style controls ── */}
      <div className="bcm-controls-bar">
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
          <span className="bcm-label">Style</span>
          <select style={sel} value={tpl.cardStyle} onChange={(e) => setField("cardStyle", e.target.value)}>
            <option value="default">Default</option>
            <option value="bordered">Bordered</option>
            <option value="shadow">Shadow</option>
          </select>
        </div>
        <div className="bcm-control">
          <span className="bcm-label">Image</span>
          <select style={sel} value={tpl.imageAspectRatio} onChange={(e) => setField("imageAspectRatio", e.target.value)}>
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="3:2">3:2</option>
            <option value="1:1">1:1</option>
          </select>
        </div>
        <div className="bcm-control">
          <span className="bcm-label">Radius</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={0} max={32} step={2} style={{ ...sel, width: 52 }}
              value={tpl.cardBorderRadius} onChange={(e) => setField("cardBorderRadius", parseInt(e.target.value, 10) || 0)} />
            <span className="bcm-unit">px</span>
          </div>
        </div>
        <div className="bcm-control">
          <span className="bcm-label">Color</span>
          <input type="color" className="bcm-color-input" value={tpl.accentColor} onChange={(e) => setField("accentColor", e.target.value)} />
        </div>
        <div className="bcm-control">
          <span className="bcm-label">Read More</span>
          <input type="text" style={{ ...sel, width: 100 }} value={tpl.readMoreLabel} onChange={(e) => setField("readMoreLabel", e.target.value)} placeholder="Read More" />
        </div>
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
              <div style={fieldStyle}>
                <label style={labelStyle}>Color</label>
                <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} style={{ height: 36, width: 60, padding: 2, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }} />
              </div>
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

function NavigationModulePreview({
  module,
  previewMode = false
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
  previewMode?: boolean;
}) {
  const pathname = usePathname();
  const activePath = normalizeNavPath(pathname || "/");

  let navItems: { href: string; label: string; id?: string; parentId?: string; width?: string }[] = [];
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

  const fontSize = module.settings.navFontSize ? `${module.settings.navFontSize}px` : undefined;
  const fontWeight = module.settings.navBold === "true" ? 700 : undefined;
  const borderRadius = module.settings.navBorderRadius ? `${module.settings.navBorderRadius}px` : undefined;
  const padding = module.settings.navPadding || undefined;
  const moduleBackgroundStyle = getBuilderBackgroundStyle(getModuleBackgroundSettings(module.settings)) ?? {};
  const color = module.settings.navColor || undefined;
  const hoverColor = module.settings.navHoverColor || undefined;
  const hoverBackground = module.settings.navHoverBackground || undefined;
  const marginV = module.settings.navMarginV ? `${module.settings.navMarginV}px` : undefined;
  const rawAlignment = module.settings.navAlignment ?? "center";
  const flexAlign = rawAlignment === "left" ? "flex-start" : rawAlignment === "right" ? "flex-end" : "center";
  const isVertical = module.settings.navDirection === "vertical";
  const navLevels = Number.parseInt(module.settings.navLevels ?? "2", 10) || 2;
  const itemSizing = module.settings.navItemSizing === "custom" || module.settings.navItemSizing === "equal"
    ? module.settings.navItemSizing
    : "auto";

  return (
    <nav
      className={`site-nav site-nav--sizing-${itemSizing}${isVertical ? " site-nav--vertical" : ""}`}
      aria-label="Main navigation"
      style={
        {
          ...moduleBackgroundStyle,
          fontSize,
          fontWeight,
          borderRadius,
          padding,
          color,
          ...(isVertical ? { alignItems: flexAlign } : {}),
          ...(isVertical ? {} : { justifyContent: flexAlign }),
          ...(marginV ? { marginTop: marginV, marginBottom: marginV } : {}),
          "--site-nav-link-color": color,
          "--site-nav-link-hover-color": hoverColor,
          "--site-nav-link-hover-bg": hoverBackground
        } as CSSProperties
      }
    >
      {topLevelItems.map((item) => {
        const href = previewMode ? toPreviewHref(item.href || "#") : toPublicHref(item.href || "#");
        const isActive = normalizeNavPath(item.href || "#") === activePath;
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
              style={itemWidth ? { flex: `0 0 ${itemWidth}`, width: itemWidth } : undefined}
            >
              {item.label}
            </Link>
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
            >
              {item.label}
              {!isVertical && <span className="site-nav-dropdown-arrow" aria-hidden>▾</span>}
            </Link>
            <div className="site-nav-dropdown-menu">
              {children.map((child) => {
                const childHref = previewMode ? toPreviewHref(child.href || "#") : toPublicHref(child.href || "#");
                const childActive = normalizeNavPath(child.href || "#") === activePath;
                return (
                  <Link
                    key={child.id ?? `${childHref}-${child.label}`}
                    href={childHref}
                    aria-current={childActive ? "page" : undefined}
                    className={`site-nav-link site-nav-dropdown-item${childActive ? " site-nav-link-active" : ""}`}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

type ParsedTableData = {
  headers: string[];
  cells: Record<string, import("@/lib/builder-template").BuilderTemplateModule[]>;
  rowCount: number;
};

function parseTableData(settings: Record<string, string>): ParsedTableData {
  try {
    const data = JSON.parse(settings.tableData || "{}");
    const headers: string[] = Array.isArray(data.headers) ? data.headers : [];

    if (data.cells && typeof data.rowCount === "number") {
      return { headers, cells: data.cells as Record<string, import("@/lib/builder-template").BuilderTemplateModule[]>, rowCount: data.rowCount };
    }

    return { headers, cells: {}, rowCount: 1 };
  } catch {
    return { headers: [], cells: {}, rowCount: 1 };
  }
}

function TableModulePreview({ module }: { module: import("@/lib/builder-template").BuilderTemplateModule }) {
  const td = parseTableData(module.settings);
  const borderW = Number.parseInt(module.settings.borderWidth || "1", 10);
  const borderC = module.settings.borderColor || "#cccccc";
  const cellPad = Number.parseInt(module.settings.cellPadding || "8", 10);
  const tableBgStyle = getBuilderBackgroundStyle(getModuleBackgroundSettings(module.settings)) ?? { background: "transparent" };
  const tableMaxWidth = module.settings.tableMaxWidth ? Math.min(2000, Math.max(0, Number.parseInt(module.settings.tableMaxWidth, 10) || 0)) : undefined;

  return (
    <div className="builder-preview-table-wrap" style={tableMaxWidth ? { maxWidth: `${tableMaxWidth}px` } : {}}>
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

type SliderItem = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  linkUrl: string;
};

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
        imageUrl: resolvePublicBuilderAssetUrl(raw.imageUrl),
        linkUrl: String(raw.linkUrl || "")
      };
    });
  } catch {
    return [];
  }
}

function SliderModulePreview({ module }: { module: import("@/lib/builder-template").BuilderTemplateModule }) {
  const items = parseSliderItems(module.settings);
  const gap = Number.parseInt(module.settings.sliderGap || "16", 10);
  const cardWidth = Number.parseInt(module.settings.sliderCardWidth || "280", 10);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }

    update();
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -320 : 320, behavior: "smooth" });
  }

  return (
    <div className="builder-preview-slider-wrap">
      {canScrollLeft && (
        <button type="button" className="builder-preview-slider-arrow builder-preview-slider-arrow-left" onClick={() => scroll("left")}>
          ‹
        </button>
      )}
      <div className="builder-preview-slider" ref={scrollRef} style={{ gap: `${gap}px` }}>
        {items.map((item) => (
          <article key={item.id} className="builder-preview-slider-card" style={{ minWidth: `${cardWidth}px` }}>
            {item.imageUrl ? (
              <div className="builder-preview-slider-image">
                <Image alt={item.title || "Slider item"} fill sizes="280px" src={item.imageUrl} unoptimized />
              </div>
            ) : null}
            <div className="builder-preview-slider-copy">
              {item.linkUrl ? (
                <Link href={item.linkUrl}><strong>{item.title}</strong></Link>
              ) : (
                <strong>{item.title}</strong>
              )}
              <p>{item.body}</p>
            </div>
          </article>
        ))}
      </div>
      {canScrollRight && (
        <button type="button" className="builder-preview-slider-arrow builder-preview-slider-arrow-right" onClick={() => scroll("right")}>
          ›
        </button>
      )}
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
  const [forgotSent, setForgotSent]   = useState(false);

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
    return (
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#18324a", marginBottom: 4 }}>Reset Password</div>
        <div style={{ fontSize: 13, color: "#587592", marginBottom: 18 }}>Enter your email and your administrator will be notified.</div>
        {forgotSent ? (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "12px 14px", fontSize: 13, color: "#15803d" }}>
            Request sent. Your administrator will follow up with reset instructions.
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setForgotSent(true); }}>
            <label style={labelStyle}>Email address</label>
            <input type="email" required style={inputStyle} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@example.com" />
            <button type="submit" style={btnStyle}>Send Request</button>
          </form>
        )}
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }} style={{ background: "none", border: "none", color: "#0f4f8f", fontSize: 13, cursor: "pointer" }}>
            Back to sign in
          </button>
        </div>
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

const PREMIUM_MODULE_GROUPS: Array<{ key: string; label: string; description: string }> = [
  { key: "crm",  label: "CRM",  description: "Lead capture forms and contact table" },
  { key: "blog", label: "Blog", description: "Blog post feeds, editors, and author bios" },
];

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
