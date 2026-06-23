"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, type FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { BuilderTemplateSection } from "@/lib/builder-template";
import {
  formatRichTextContent,
  getBuilderBackgroundStyle,
  getLayoutColumns,
  getLayoutGridTemplate,
  resolvePublicBuilderAssetUrl
} from "@/lib/builder-template";
import { sanitizeEmbedHtml } from "@/lib/sanitize-html";
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
  getThemeRootVars,
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
  showShell?: boolean;
  emailPreview?: boolean;
  /** When true (Builder /preview), speech bubbles with game/on-load triggers do not auto-fire. */
  previewMode?: boolean;
  /** Project ID for contact form submissions on live landing pages. */
  projectId?: string;
};

type ContactFormField = {
  id: string;
  label: string;
  type: "text" | "email" | "tel";
};

function normalizeNavPath(value: string) {
  const path = value.split("?")[0]?.split("#")[0] || "/";
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;

  return normalized === "/home" ? "/" : normalized;
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
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to submit the form.");
      }

      setMessage(data.message ?? "Thanks. Your information has been saved.");
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

type CrmFormField = { key: string; label: string; type: string; required: boolean };
type CrmFormData = {
  heading: string;
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
  fields: CrmFormField[];
  crmConfigId: string;
};

function CrmFormPreview({ settings }: { settings: Record<string, string> }) {
  const crmFormId = settings.crmFormId ?? "";
  const [form, setForm] = useState<CrmFormData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!crmFormId) return;
    fetch(`/api/crm/forms/${crmFormId}`)
      .then((r) => r.json())
      .then((d) => {
        const formData = d?.data ?? d ?? null;
        // Guard: only set state if the response looks like a form (has an id)
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
        body: JSON.stringify({ ...values, crmConfigId: form?.crmConfigId ?? "", crm_form_id: crmFormId, _trap: honeypot })
      });
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to submit the form.");
      }

      setMessage(data.message ?? form?.successMessage ?? "Thank you!");
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

  return (
    <form className="builder-contact-form" onSubmit={submitCrmForm}>
      <input type="text" name="_trap" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
      {form.heading ? <div className="builder-contact-form-heading">{form.heading}</div> : null}
      {message ? <div className="builder-contact-form-message">{message}</div> : null}
      {error ? <div className="builder-contact-form-error">{error}</div> : null}
      <div className="builder-contact-form-fields">
        {(form.fields ?? []).map((field) => (
          <label className="builder-contact-form-field" key={field.key}>
            <input
              type={field.type || "text"}
              name={field.key}
              placeholder={field.label}
              required={field.required}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <button className="builder-contact-form-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Submitting…" : form.submitLabel || "Submit"}
      </button>
    </form>
  );
}

// ── CRM Contacts Table ────────────────────────────────────────────────────────

function getCrmProjectHeaders(): Record<string, string> {
  // Prefer window.App (available inside builder admin where projectContext.js is loaded).
  const fromApp =
    (window as unknown as { App?: { projectContext?: { getSessionProjectId?: () => string } } })
      ?.App?.projectContext?.getSessionProjectId?.() ?? "";
  if (fromApp) return { "X-Project-ID": fromApp };

  // Fall back to localStorage — projectContext.js stores the active project ID there
  // under 'alphire.currentProjectId'. builder-preview.html doesn't load projectContext.js
  // but the key is already written by the main builder session.
  try {
    const key =
      (window as unknown as { App?: { CURRENT_PROJECT_ID_STORAGE_KEY?: string } })
        ?.App?.CURRENT_PROJECT_ID_STORAGE_KEY ?? "alphire.currentProjectId";
    const fromStorage = localStorage.getItem(key) ?? "";
    if (fromStorage) return { "X-Project-ID": fromStorage };
  } catch {}

  return {};
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

function CrmContactsTablePreview({ settings }: { settings: Record<string, string> }) {
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
  const [search, setSearch]         = useState("");
  const [page, setPage]             = useState(1);
  const [viewContact, setViewContact] = useState<CrmContact | null>(null);
  const [editContact, setEditContact] = useState<CrmContact | null>(null);
  const [editValues, setEditValues]   = useState<Record<string, string>>({});
  const [addMode, setAddMode]         = useState(false);
  const [addValues, setAddValues]     = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    const headers = getCrmProjectHeaders();
    const configUrl = crmConfigId ? `/api/crm/configs/${encodeURIComponent(crmConfigId)}` : "/api/crm/configs";
    fetch(configUrl, { headers })
      .then((r) => r.json())
      .then((d) => {
        const cfg: CrmConfigData | null = crmConfigId
          ? (d?.config ?? d?.data ?? (d?.id ? d : null))
          : (d?.configs?.[0] ?? d?.data?.[0] ?? null);
        setConfig(cfg);
        if (!cfg) return;
        return fetch(`/api/crm/contacts?configId=${encodeURIComponent(cfg.id)}`, { headers })
          .then((r) => r.json())
          .then((d2) => {
            const list = d2?.contacts ?? d2?.data ?? [];
            setContacts(Array.isArray(list) ? list : []);
          });
      })
      .catch((e: Error) => setLoadError(e.message || "Failed to load contacts."))
      .finally(() => setLoading(false));
  }, [crmConfigId]);

  const fields = getContactFields(config);

  const filtered = contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.email ?? "").toLowerCase().includes(q) ||
      Object.values(c.data ?? {}).some((v) => String(v).toLowerCase().includes(q))
    );
  });

  const totalPages   = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage     = Math.min(page, totalPages);
  const pageContacts = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const tableCols    = fields.slice(0, 5);
  const hasActions   = showViewBtn || showEditBtn || showDeleteBtn;

  async function deleteContact(id: string) {
    if (!confirm("Delete this contact? This cannot be undone.")) return;
    await fetch(`/api/crm/contacts/${encodeURIComponent(id)}`, { method: "DELETE", headers: getCrmProjectHeaders() });
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (viewContact?.id === id) setViewContact(null);
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
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
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
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
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
    <div className="crm-contacts-table-module">
      {showTitle && <h2 className="crm-contacts-table-title">{tableTitle}</h2>}

      <div className="crm-contacts-table-toolbar">
        {showSearch && (
          <input
            className="crm-contacts-table-search"
            type="search"
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        )}
        {showAddButton && (
          <button
            className="crm-contacts-table-add-btn"
            type="button"
            onClick={() => { setAddValues({}); setAddMode(true); }}
          >
            {addButtonLabel}
          </button>
        )}
      </div>

      <div className="crm-contacts-table-wrap">
        <table className="crm-contacts-table">
          <thead>
            <tr>
              {tableCols.map((f) => <th key={f.key}>{f.label}</th>)}
              <th>Added</th>
              {hasActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageContacts.length === 0 ? (
              <tr>
                <td colSpan={tableCols.length + 1 + (hasActions ? 1 : 0)} className="crm-contacts-table-empty">
                  {search ? "No contacts match your search." : "No contacts yet."}
                </td>
              </tr>
            ) : pageContacts.map((c) => (
              <tr key={c.id}>
                {tableCols.map((f) => (
                  <td key={f.key} className="crm-contacts-table-cell">
                    {f.key === "email" ? (c.email ?? "") : String(c.data?.[f.key] ?? "")}
                  </td>
                ))}
                <td className="crm-contacts-table-cell crm-contacts-table-date">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                </td>
                {hasActions && (
                  <td className="crm-contacts-table-actions">
                    {showViewBtn   && <button type="button" className="crm-contacts-action-btn" onClick={() => setViewContact(c)}>View</button>}
                    {showEditBtn   && <button type="button" className="crm-contacts-action-btn" onClick={() => openEdit(c)}>Edit</button>}
                    {showDeleteBtn && <button type="button" className="crm-contacts-action-btn crm-contacts-action-btn-danger" onClick={() => deleteContact(c.id)}>Delete</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="crm-contacts-table-pagination">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span>Page {safePage} of {totalPages}</span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
      <div className="crm-contacts-table-count">
        {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
      </div>

      {/* View modal */}
      {viewContact && (
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
      )}

      {/* Edit modal */}
      {editContact && (
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
      )}

      {/* Add contact modal */}
      {addMode && (
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
  showShell = true,
  emailPreview = false,
  previewMode = false,
  projectId = ""
}: BuilderTemplatePreviewProps) {
  const pageStyle = getBuilderBackgroundStyle(pageBackground);
  // Theme tokens go first so the page background (and any per-module inline
  // styles further down) still win where they overlap.
  const rootStyle = { ...getThemeRootVars(theme), ...pageStyle };
  const sitePlayerRegistered = useSitePlayerRegistration();

  /** Live and builder previews need the shell so overlay-flow rows stack above the game wash. */
  const shellClassName = !emailPreview ? "builder-preview-shell" : undefined;
  const pageOverlaySections = layoutSections.filter(sectionHasOnlyPageOverlayImageModules);

  return (
    <div
      className={
        shellClassName
          ? pageOverlaySections.length > 0
            ? `${shellClassName} builder-preview-shell-has-overlay`
            : shellClassName
          : undefined
      }
      style={rootStyle}
    >
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
            />
          ))}
        </div>
      ) : null}
      {layoutSections
        .filter((section) => !sectionHasOnlyPageOverlayImageModules(section))
        .map((section) => (
          <BuilderSectionPreview
            emailPreview={emailPreview}
            key={section.id}
            previewMode={previewMode}
            section={section}
            sitePlayerRegistered={sitePlayerRegistered}
          />
        ))}
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
  sitePlayerRegistered = false
}: {
  section: BuilderTemplateSection;
  emailPreview?: boolean;
  previewMode?: boolean;
  projectId?: string;
  sitePlayerRegistered?: boolean;
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
  sitePlayerRegistered = false
}: {
  module: import("@/lib/builder-template").BuilderTemplateModule;
  emailPreview?: boolean;
  /** Floating image in a full-page overlay row — always visible on the live site. */
  overlayFlowDecor?: boolean;
  previewMode?: boolean;
  projectId?: string;
  sitePlayerRegistered?: boolean;
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
    return <CrmFormPreview settings={module.settings} />;
  }

  if (module.type === "crm-contacts-table") {
    return <CrmContactsTablePreview settings={module.settings} />;
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
    return <BlogPostListPreview settings={module.settings} />;
  }
  if (module.type === "blog-post-create") {
    return <BlogPostCreatePreview settings={module.settings} />;
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
  if (
    module.type === "blog-post-card" ||
    module.type === "blog-author-bio" ||
    module.type === "blog-toc" ||
    module.type === "blog-newsletter-subscribe" ||
    module.type === "blog-related-posts"
  ) {
    return <BlogModulePlaceholder type={module.type} />;
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
  featured_image_url?: string;
  published_at?: string;
};

function BlogPostListPreview({ settings }: { settings: Record<string, string> }) {
  const [posts, setPosts] = useState<BlogPostRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/blog/posts?status=published&limit=6", {
      credentials: "include",
      headers: getCrmProjectHeaders()
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPosts(Array.isArray(d?.posts) ? (d.posts as BlogPostRecord[]) : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const accent = settings.accentColor || "#0f4f8f";
  const layout = settings.layout || "grid";
  const postPageUrl = (settings.postPageUrl || "").trim();
  const readMoreLabel = settings.readMoreLabel || "Read more";
  const showReadMore = (settings.showReadMore ?? "true") !== "false";

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#888" }}>Loading posts…</div>;
  }

  if (!posts.length) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "#888", border: "1px dashed #ccc", borderRadius: 8 }}>
        No published posts yet. Use the Create Post module to add your first post.
      </div>
    );
  }

  const gridStyle: CSSProperties =
    layout === "list"
      ? { display: "flex", flexDirection: "column", gap: "1.5rem" }
      : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" };

  return (
    <div style={gridStyle}>
      {posts.map((post) => {
        // Use ?post= so it doesn't collide with builder-preview.html's own ?slug= page param
        const sep = postPageUrl.includes("?") ? "&" : "?";
        const href = postPageUrl ? `${postPageUrl}${sep}post=${encodeURIComponent(post.slug)}` : "#";
        return (
        <article
          key={post.id}
          style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", background: "#fff" }}
        >
          {post.featured_image_url ? (
            <img
              alt={post.title}
              src={post.featured_image_url}
              style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
            />
          ) : null}
          <div style={{ padding: "1rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", color: "#1a202c" }}>{post.title}</h3>
            {post.excerpt ? (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "#4a5568" }}>{post.excerpt}</p>
            ) : null}
            {showReadMore ? (
              <a href={href} style={{ color: accent, fontSize: "0.875rem", fontWeight: 600 }}>
                {readMoreLabel} →
              </a>
            ) : null}
          </div>
        </article>
        );
      })}
    </div>
  );
}

function BlogPostCreatePreview({ settings }: { settings: Record<string, string> }) {
  const accent = settings.accentColor || "#0f4f8f";
  const formTitle = settings.formTitle || "Create New Post";
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

  const [values, setValues] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
          ? values.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : []
      };
      const res = await fetch("/api/blog/posts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getCrmProjectHeaders() },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as { error?: { message?: string } | string };
      if (!res.ok) {
        const errMsg =
          typeof data.error === "string"
            ? data.error
            : (data.error as { message?: string } | undefined)?.message || "Failed to create post.";
        throw new Error(errMsg);
      }
      setStatusMsg(successMessage);
      setValues({});
      if (redirectAfterCreate) {
        setTimeout(() => {
          window.location.href = redirectAfterCreate;
        }, 1500);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
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
      style={{
        maxWidth: 720,
        margin: "0 auto",
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
          <label style={labelStyle}>Featured Image URL</label>
          <input
            style={inputStyle}
            type="url"
            value={values.featuredImageUrl || ""}
            onChange={(e) => setField("featuredImageUrl", e.target.value)}
            placeholder="https://…"
          />
        </div>
      ) : null}

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
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: 200 }}
          value={values.body || ""}
          onChange={(e) => setField("body", e.target.value)}
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

function BlogCategoryFilterPreview({ settings }: { settings: Record<string, string> }) {
  let cats: Array<{ id: string; label: string; slug: string }> = [];
  try {
    cats = JSON.parse(settings.categories || "[]") as typeof cats;
  } catch {}
  const accent = settings.activeColor || "#0f4f8f";
  const activeBg = settings.activeBg || accent;
  const layout = settings.layout || "pills";
  const allLabel = settings.allLabel || "All";
  const items = [{ id: "_all", label: allLabel, slug: "" }, ...cats];

  if (layout === "dropdown") {
    return (
      <select
        style={{ padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.875rem" }}
      >
        {items.map((c) => (
          <option key={c.id} value={c.slug}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: settings.gap || "0.5rem" }}>
      {items.map((c, i) => (
        <span
          key={c.id}
          style={{
            padding: "0.3rem 0.85rem",
            borderRadius: settings.borderRadius || "999px",
            background: i === 0 ? activeBg : (settings.inactiveBg || "#f3f4f6"),
            color: i === 0 ? "#fff" : (settings.inactiveColor || "#374151"),
            fontSize: settings.fontSize || "0.8rem",
            fontWeight: i === 0 ? 600 : 400,
            cursor: "pointer"
          }}
        >
          {c.label}
        </span>
      ))}
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
  const [post, setPost] = useState<BlogPostRecord & { body?: string; author?: string; excerpt?: string; published_at?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // ?post= carries the blog post slug; ?slug= is reserved for the builder page slug
    const slug = new URLSearchParams(window.location.search).get("post") ?? "";
    if (!slug) return;
    setLoading(true);
    fetch(`/api/blog/posts/${encodeURIComponent(slug)}?by=slug`, {
      credentials: "include",
      headers: getCrmProjectHeaders()
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.data ?? d?.post ?? null;
        setPost(p && typeof p === "object" ? (p as BlogPostRecord & { body?: string; author?: string; excerpt?: string; published_at?: string }) : null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#888" }}>Loading post…</div>;
  }

  // Render live fetched post when navigated via ?slug=
  if (post) {
    const pubDate = post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    return (
      <article style={{ maxWidth: 720, margin: "0 auto" }}>
        {(post as unknown as { featured_image_url?: string }).featured_image_url ? (
          <img
            alt={post.title}
            src={(post as unknown as { featured_image_url?: string }).featured_image_url}
            style={{ width: "100%", borderRadius: 8, marginBottom: "1.5rem", display: "block" }}
          />
        ) : null}
        <h1 style={{ margin: "0 0 0.75rem", fontSize: "2rem", color: "#111827" }}>{post.title}</h1>
        <p style={{ margin: "0 0 1.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
          {post.author ? <>By {post.author}</> : null}
          {post.author && pubDate ? " · " : null}
          {pubDate}
        </p>
        {post.excerpt ? (
          <p style={{ margin: "0 0 1.5rem", fontSize: "1.1rem", color: "#4a5568", fontStyle: "italic", borderLeft: "3px solid #e2e8f0", paddingLeft: "1rem" }}>
            {post.excerpt}
          </p>
        ) : null}
        {post.body ? (
          <div
            className="builder-preview-text"
            dangerouslySetInnerHTML={{ __html: formatRichTextContent(post.body) || "" }}
          />
        ) : null}
      </article>
    );
  }

  // Canvas preview (no ?slug= in URL) — show placeholder from settings
  const title = settings.title || "Post Title";
  const body = settings.body || "";
  const author = settings.author || "";
  const excerpt = settings.excerpt || "";

  return (
    <article style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 0.75rem", fontSize: "2rem", color: "#111827" }}>{title}</h1>
      {author ? <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#6b7280" }}>By {author}</p> : null}
      {excerpt ? (
        <p style={{ margin: "0 0 1.5rem", fontSize: "1.1rem", color: "#4a5568", fontStyle: "italic" }}>{excerpt}</p>
      ) : null}
      {body ? (
        <div
          className="builder-preview-text"
          dangerouslySetInnerHTML={{ __html: formatRichTextContent(body) || "" }}
        />
      ) : (
        <p style={{ color: "#9ca3af" }}>Post body will appear here.</p>
      )}
    </article>
  );
}

function BlogModulePlaceholder({ type }: { type: string }) {
  const labels: Record<string, string> = {
    "blog-post-card": "Post Card",
    "blog-author-bio": "Author Bio",
    "blog-toc": "Table of Contents",
    "blog-newsletter-subscribe": "Newsletter Subscribe",
    "blog-related-posts": "Related Posts"
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
  const variant = module.settings.variant ?? "";
  const pathname = usePathname();
  const activePath = normalizeNavPath(pathname || "/");

  let navItems: { href: string; label: string; id?: string; parentId?: string }[] = [];
  try {
    const parsed = JSON.parse(module.settings.navItems || "[]");
    navItems = Array.isArray(parsed) ? parsed : [];
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

  return (
    <nav
      className={`site-nav builder-preview-nav-${variant || "site-nav"}${isVertical ? " site-nav--vertical" : ""}`}
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
        const href = previewMode ? toPreviewHref(item.href || "#") : (item.href || "#");
        const isActive = normalizeNavPath(item.href || "#") === activePath;
        const itemId = item.id ?? `${href}-${item.label}`;
        const children = navLevels >= 2 ? childrenOf(itemId) : [];

        if (children.length === 0) {
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={`site-nav-link${isActive ? " site-nav-link-active" : ""}`}
              href={href}
              key={itemId}
            >
              {item.label}
            </Link>
          );
        }

        return (
          <div key={itemId} className="site-nav-dropdown">
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
                const childHref = previewMode ? toPreviewHref(child.href || "#") : (child.href || "#");
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
                <Image alt={item.label || "Social icon"} fill sizes={`${iconSize}px`} src={item.iconUrl} unoptimized />
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
