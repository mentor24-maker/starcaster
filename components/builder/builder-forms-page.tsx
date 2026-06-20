import { useState, useEffect, useCallback } from "react";
import { BuilderSettingRow } from "./builder-setting-row";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

// ─── constants ────────────────────────────────────────────────────────────────

const FORM_TEMPLATES = [
  {
    id: "squeeze-form",
    name: "Squeeze Form",
    defaultHeading: "Get Instant Access",
    defaultSubmitLabel: "Submit",
    fields: [
      { key: "first_name", label: "First Name", type: "text", defaultRequired: true },
      { key: "email", label: "Email", type: "email", defaultRequired: true },
    ],
  },
  {
    id: "short-form",
    name: "Short Form",
    defaultHeading: "Tell Us About Yourself",
    defaultSubmitLabel: "Send Request",
    fields: [
      { key: "first_name", label: "First Name", type: "text", defaultRequired: true },
      { key: "last_name", label: "Last Name", type: "text", defaultRequired: false },
      { key: "email", label: "Email", type: "email", defaultRequired: true },
      { key: "phone", label: "Phone Number", type: "tel", defaultRequired: false },
    ],
  },
  {
    id: "long-form",
    name: "Long Form",
    defaultHeading: "Complete The Form",
    defaultSubmitLabel: "Submit Form",
    fields: [
      { key: "first_name", label: "First Name", type: "text", defaultRequired: true },
      { key: "last_name", label: "Last Name", type: "text", defaultRequired: false },
      { key: "email", label: "Email", type: "email", defaultRequired: true },
      { key: "phone", label: "Phone Number", type: "tel", defaultRequired: false },
      { key: "city", label: "City", type: "text", defaultRequired: false },
      { key: "state", label: "State", type: "text", defaultRequired: false },
      { key: "country", label: "Country", type: "text", defaultRequired: false },
    ],
  },
] as const;

type FormTemplateId = (typeof FORM_TEMPLATES)[number]["id"];

const CONTACT_TYPE_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "subscriber", label: "Subscriber" },
  { value: "member", label: "Member" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

const LEAD_MAGNET_TYPES = [
  { value: "", label: "— None —" },
  { value: "White Paper", label: "White Paper" },
  { value: "Report", label: "Report" },
  { value: "Video", label: "Video" },
  { value: "Infographic", label: "Infographic" },
];

const DEFAULT_ACCENT = "#0b82d4";

// ─── types ────────────────────────────────────────────────────────────────────

type FormField = { key: string; label: string; type: string; required: boolean };

type DevelopFormRecord = {
  id: string;
  name: string;
  formType: FormTemplateId;
  contactType: string;
  leadMagnetType: string;
  leadMagnetId: string;
  ctaId: string;
  heading: string;
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
  accentColor: string;
  matchLandingColor: boolean;
  landingColorMode: string;
  useLandingBackground: boolean;
  fields: FormField[];
  createdAt: string;
  updatedAt: string;
};

type CtaRecord = { id: string; cta: string };
type AssetRecord = { id: string | number; assetName?: string; assetType?: string; category?: string };

// ─── helpers ──────────────────────────────────────────────────────────────────

function getTemplate(id: string) {
  return FORM_TEMPLATES.find((t) => t.id === id) ?? FORM_TEMPLATES[0];
}

function defaultDraft(templateId: FormTemplateId = "squeeze-form"): DevelopFormRecord {
  const t = getTemplate(templateId);
  return {
    id: "",
    name: "",
    formType: t.id,
    contactType: "lead",
    leadMagnetType: "",
    leadMagnetId: "",
    ctaId: "",
    heading: t.defaultHeading,
    submitLabel: t.defaultSubmitLabel,
    successMessage: "Thanks. Your request has been received.",
    errorMessage: "Something went wrong. Please try again.",
    accentColor: DEFAULT_ACCENT,
    matchLandingColor: false,
    landingColorMode: "primary",
    useLandingBackground: false,
    fields: t.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.defaultRequired })),
    createdAt: "",
    updatedAt: "",
  };
}

function draftFromRecord(record: DevelopFormRecord): DevelopFormRecord {
  const t = getTemplate(record.formType);
  // Merge saved fields onto the template field list so new fields appear after template updates
  const savedRequired: Record<string, boolean> = {};
  for (const f of record.fields ?? []) savedRequired[f.key] = f.required;
  const fields = t.fields.map((tf) => ({
    key: tf.key,
    label: tf.label,
    type: tf.type,
    required: tf.key in savedRequired ? savedRequired[tf.key] : tf.defaultRequired,
  }));
  return { ...record, fields };
}

function assetMatchesLeadMagnetType(asset: AssetRecord, type: string): boolean {
  if (!type) return true;
  const { assetType = "", category = "" } = asset;
  if (type === "White Paper") return (assetType === "Lead Magnet" || assetType === "File") && category === "White Paper";
  if (type === "Report") return (assetType === "Lead Magnet" || assetType === "File") && category === "Report";
  if (type === "Video") return assetType === "Video";
  if (type === "Infographic") return assetType === "Image" && category === "Infographic";
  return assetType === type || category === type;
}

function assetLabel(asset: AssetRecord): string {
  return String(asset.assetName || asset.id || "");
}

function formatDate(iso: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

// ─── live preview ─────────────────────────────────────────────────────────────

function FormPreview({ draft, ctaLabel }: { draft: DevelopFormRecord; ctaLabel: string }) {
  const accent = draft.matchLandingColor ? "#6b7a8d" : (draft.accentColor || DEFAULT_ACCENT);
  return (
    <div
      className="builder-forms-preview-card"
      style={{ borderColor: accent, boxShadow: `0 6px 20px ${accent}22` }}
    >
      <h3 className="builder-forms-preview-heading" style={{ color: accent }}>
        {draft.heading || "Form Heading"}
      </h3>
      {draft.fields.map((field) => (
        <input
          key={field.key}
          type={field.type}
          placeholder={`${field.label}${field.required ? " *" : ""}`}
          className="builder-forms-preview-input"
          readOnly
        />
      ))}
      <button
        type="button"
        className="builder-forms-preview-btn"
        style={{ background: accent, borderColor: accent }}
      >
        {ctaLabel || draft.submitLabel || "Submit"}
      </button>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function BuilderFormsPage() {
  const [forms, setForms] = useState<DevelopFormRecord[]>([]);
  const [ctas, setCtas] = useState<CtaRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [draft, setDraft] = useState<DevelopFormRecord | null>(null);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [formsRes, ctasRes, assetsRes] = await Promise.allSettled([
        appApi("/api/builder/forms"),
        appApi("/api/messaging/ctas?limit=200"),
        appApi("/api/assets"),
      ]);
      if (formsRes.status === "fulfilled") setForms(unwrapEnvelope<DevelopFormRecord[]>(formsRes.value, "forms") ?? []);
      if (ctasRes.status === "fulfilled") setCtas(unwrapEnvelope<CtaRecord[]>(ctasRes.value, "ctas") ?? []);
      if (assetsRes.status === "fulfilled") setAssets(unwrapEnvelope<AssetRecord[]>(assetsRes.value, "assets") ?? []);
    } catch {
      setStatus({ message: "Could not load data", isError: true });
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── derived ────────────────────────────────────────────────────────────────

  const filteredLeadMagnets = draft
    ? assets.filter((a) => assetMatchesLeadMagnetType(a, draft.leadMagnetType))
    : [];

  const ctaLabel = draft
    ? (ctas.find((c) => String(c.id) === draft.ctaId)?.cta ?? "")
    : "";

  // ── draft updater ──────────────────────────────────────────────────────────

  function patch(changes: Partial<DevelopFormRecord>) {
    setDraft((prev) => prev ? { ...prev, ...changes } : prev);
    setStatus(null);
  }

  function handleFormTypeChange(id: string) {
    if (!draft) return;
    const t = getTemplate(id);
    const existing = Object.fromEntries(draft.fields.map((f) => [f.key, f.required]));
    patch({
      formType: t.id,
      heading: draft.heading === getTemplate(draft.formType).defaultHeading ? t.defaultHeading : draft.heading,
      submitLabel: draft.submitLabel === getTemplate(draft.formType).defaultSubmitLabel ? t.defaultSubmitLabel : draft.submitLabel,
      fields: t.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.key in existing ? existing[f.key] : f.defaultRequired,
      })),
    });
  }

  function handleLeadMagnetTypeChange(type: string) {
    patch({ leadMagnetType: type, leadMagnetId: "" });
  }

  function handleFieldRequired(key: string, required: boolean) {
    if (!draft) return;
    setDraft((prev) =>
      prev ? { ...prev, fields: prev.fields.map((f) => f.key === key ? { ...f, required } : f) } : prev
    );
  }

  // ── save / delete / clone ──────────────────────────────────────────────────

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) { setStatus({ message: "Form name is required", isError: true }); return; }
    if (!draft.heading.trim()) { setStatus({ message: "Heading is required", isError: true }); return; }
    setIsSaving(true);
    setStatus(null);
    const isNew = !draft.id;
    const url = isNew ? "/api/builder/forms" : `/api/builder/forms/${encodeURIComponent(draft.id)}`;
    const resolvedSubmitLabel = ctaLabel || draft.submitLabel || getTemplate(draft.formType).defaultSubmitLabel;
    const payload = {
      name: draft.name.trim(),
      formType: draft.formType,
      contactType: draft.contactType || "lead",
      leadMagnetType: draft.leadMagnetType,
      leadMagnetId: draft.leadMagnetId,
      ctaId: draft.ctaId,
      heading: draft.heading.trim(),
      submitLabel: resolvedSubmitLabel,
      successMessage: draft.successMessage,
      errorMessage: draft.errorMessage,
      accentColor: draft.accentColor || DEFAULT_ACCENT,
      matchLandingColor: draft.matchLandingColor,
      landingColorMode: draft.landingColorMode || "primary",
      useLandingBackground: draft.matchLandingColor && draft.useLandingBackground,
      fields: draft.fields,
    };
    try {
      const res = await appApi(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved: DevelopFormRecord = unwrapEnvelope(res, "form");
      await loadAll();
      setDraft(draftFromRecord(saved));
      setStatus({ message: isNew ? "Form created" : "Form saved", isError: false });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not save form", isError: true });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(form: DevelopFormRecord) {
    if (!window.confirm(`Delete form "${form.name || form.id}"?`)) return;
    try {
      await appApi(`/api/builder/forms/${encodeURIComponent(form.id)}`, { method: "DELETE" });
      if (draft?.id === form.id) setDraft(null);
      await loadAll();
      setStatus({ message: "Form deleted", isError: false });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not delete form", isError: true });
    }
  }

  async function handleClone(form: DevelopFormRecord) {
    try {
      const payload = { ...form, id: undefined, name: form.name };
      await appApi("/api/builder/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadAll();
      setStatus({ message: "Form cloned", isError: false });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not clone form", isError: true });
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="builder-forms-page">
      {/* ── page header ── */}
      <div className="builder-forms-page-header">
        {draft ? (
          <>
            <span className="builder-forms-page-title">{draft.id ? `Edit: ${draft.name || "Form"}` : "New Form"}</span>
            <button type="button" className="builder-icon-button" onClick={() => { setDraft(null); setStatus(null); }}>
              ← Back to list
            </button>
            <button
              type="button"
              className="builder-icon-button builder-icon-button-active"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : draft.id ? "Save" : "Create"}
            </button>
            {draft.id && (
              <button type="button" className="builder-icon-button" onClick={() => handleDelete(draft)} disabled={isSaving}>
                Delete
              </button>
            )}
          </>
        ) : (
          <>
            <span className="builder-forms-page-title">Saved Forms</span>
            <button type="button" className="builder-icon-button builder-icon-button-active" onClick={() => setDraft(defaultDraft())}>
              + Create Form
            </button>
          </>
        )}
      </div>

      {/* ── status ── */}
      {status && (
        <div className={`builder-themes-status${status.isError ? " builder-themes-status-error" : ""}`} role="status">
          {status.message}
        </div>
      )}

      {/* ── editor ── */}
      {draft && (
        <div className="builder-forms-editor">
          <div className="builder-forms-editor-fields">

            {/* Basic */}
            <section className="builder-forms-section">
              <h4 className="builder-forms-section-heading">Basic</h4>
              <BuilderSettingRow label="Form name" fullWidth>
                <input type="text" value={draft.name} placeholder="My Form" onChange={(e) => patch({ name: e.target.value })} />
              </BuilderSettingRow>
              <BuilderSettingRow label="Form type" fullWidth>
                <select value={draft.formType} onChange={(e) => handleFormTypeChange(e.target.value)}>
                  {FORM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Contact type" fullWidth>
                <select value={draft.contactType} onChange={(e) => patch({ contactType: e.target.value })}>
                  {CONTACT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </BuilderSettingRow>
            </section>

            {/* Content */}
            <section className="builder-forms-section">
              <h4 className="builder-forms-section-heading">Content</h4>
              <BuilderSettingRow label="Heading" fullWidth>
                <input type="text" value={draft.heading} onChange={(e) => patch({ heading: e.target.value })} />
              </BuilderSettingRow>
              <BuilderSettingRow label="CTA / submit label" fullWidth>
                <select value={draft.ctaId} onChange={(e) => patch({ ctaId: e.target.value })}>
                  <option value="">— Use custom label —</option>
                  {ctas.map((c) => <option key={c.id} value={String(c.id)}>{c.cta}</option>)}
                </select>
              </BuilderSettingRow>
              {!draft.ctaId && (
                <BuilderSettingRow label="Submit label" fullWidth>
                  <input type="text" value={draft.submitLabel} onChange={(e) => patch({ submitLabel: e.target.value })} />
                </BuilderSettingRow>
              )}
              <BuilderSettingRow label="Success message" fullWidth>
                <textarea rows={2} value={draft.successMessage} onChange={(e) => patch({ successMessage: e.target.value })} />
              </BuilderSettingRow>
              <BuilderSettingRow label="Error message" fullWidth>
                <textarea rows={2} value={draft.errorMessage} onChange={(e) => patch({ errorMessage: e.target.value })} />
              </BuilderSettingRow>
            </section>

            {/* Lead magnet */}
            <section className="builder-forms-section">
              <h4 className="builder-forms-section-heading">Lead Magnet</h4>
              <BuilderSettingRow label="Type" fullWidth>
                <select value={draft.leadMagnetType} onChange={(e) => handleLeadMagnetTypeChange(e.target.value)}>
                  {LEAD_MAGNET_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </BuilderSettingRow>
              <BuilderSettingRow label="Asset" fullWidth>
                <select value={draft.leadMagnetId} onChange={(e) => patch({ leadMagnetId: e.target.value })}>
                  <option value="">— Optional —</option>
                  {filteredLeadMagnets.map((a) => (
                    <option key={String(a.id)} value={String(a.id)}>{assetLabel(a)}</option>
                  ))}
                </select>
              </BuilderSettingRow>
            </section>

            {/* Color */}
            <section className="builder-forms-section">
              <h4 className="builder-forms-section-heading">Color</h4>
              <BuilderSettingRow label="Accent color">
                <input
                  type="color"
                  value={draft.accentColor || DEFAULT_ACCENT}
                  disabled={draft.matchLandingColor}
                  onChange={(e) => patch({ accentColor: e.target.value })}
                />
              </BuilderSettingRow>
              <BuilderSettingRow label="Match page color" fullWidth>
                <label className="builder-forms-checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.matchLandingColor}
                    onChange={(e) => patch({ matchLandingColor: e.target.checked })}
                  />
                  Use page primary/accent color
                </label>
              </BuilderSettingRow>
              {draft.matchLandingColor && (
                <>
                  <BuilderSettingRow label="Color role" fullWidth>
                    <select value={draft.landingColorMode} onChange={(e) => patch({ landingColorMode: e.target.value })}>
                      <option value="primary">Primary Color</option>
                      <option value="accent">Accent Color</option>
                    </select>
                  </BuilderSettingRow>
                  <BuilderSettingRow label="Add background" fullWidth>
                    <label className="builder-forms-checkbox-row">
                      <input
                        type="checkbox"
                        checked={draft.useLandingBackground}
                        onChange={(e) => patch({ useLandingBackground: e.target.checked })}
                      />
                      Apply background color to form
                    </label>
                  </BuilderSettingRow>
                </>
              )}
            </section>

            {/* Field config */}
            <section className="builder-forms-section">
              <h4 className="builder-forms-section-heading">Fields</h4>
              <p className="builder-forms-section-note">Toggle which fields are required.</p>
              {draft.fields.map((field) => (
                <div key={field.key} className="builder-forms-field-row">
                  <span className="builder-forms-field-label">{field.label}</span>
                  <label className="builder-forms-checkbox-row">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => handleFieldRequired(field.key, e.target.checked)}
                    />
                    Required
                  </label>
                </div>
              ))}
            </section>
          </div>

          {/* ── preview ── */}
          <div className="builder-forms-editor-preview">
            <h4 className="builder-forms-section-heading">Preview</h4>
            <FormPreview draft={draft} ctaLabel={ctaLabel} />
          </div>
        </div>
      )}

      {/* ── saved forms list ── */}
      {!draft && (
        <div className="builder-forms-list">
          {forms.length === 0 ? (
            <p className="builder-forms-empty">No saved forms yet.</p>
          ) : (
            <table className="builder-forms-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Lead Magnet</th>
                  <th>CTA</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((form) => {
                  const leadMagnetAsset = assets.find((a) => String(a.id) === form.leadMagnetId);
                  const ctaRecord = ctas.find((c) => String(c.id) === form.ctaId);
                  return (
                    <tr key={form.id}>
                      <td>{form.name || "—"}</td>
                      <td>{getTemplate(form.formType).name}</td>
                      <td>{CONTACT_TYPE_OPTIONS.find((o) => o.value === form.contactType)?.label ?? form.contactType}</td>
                      <td>{leadMagnetAsset ? assetLabel(leadMagnetAsset) : (form.leadMagnetId ? form.leadMagnetId : "—")}</td>
                      <td>{ctaRecord?.cta ?? (form.ctaId ? form.ctaId : "—")}</td>
                      <td>{formatDate(form.updatedAt || form.createdAt)}</td>
                      <td className="builder-forms-actions">
                        <button type="button" className="builder-icon-button" onClick={() => { setDraft(draftFromRecord(form)); setStatus(null); }}>
                          Edit
                        </button>
                        <button type="button" className="builder-icon-button" onClick={() => handleClone(form)}>
                          Clone
                        </button>
                        <button type="button" className="builder-icon-button" onClick={() => handleDelete(form)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
