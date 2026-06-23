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
    const configUrl = crmConfigId ? `/api/crm/configs/${encodeURIComponent(crmConfigId)}` : "/api/crm/configs";
    fetch(configUrl)
      .then((r) => r.json())
      .then((d) => {
        const cfg: CrmConfigData | null = crmConfigId
          ? (d?.config ?? d?.data ?? (d?.id ? d : null))
          : (d?.configs?.[0] ?? d?.data?.[0] ?? null);
        setConfig(cfg);
        if (!cfg) return;
        return fetch(`/api/crm/contacts?configId=${encodeURIComponent(cfg.id)}`)
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
    await fetch(`/api/crm/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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

  return null;
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
