import { useState, useEffect, useMemo, useRef } from "react";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

interface ExtensionRecord {
  id: string;
  slug: string;
  name: string;
  extensionType: string;
  parentId: string;
  status: string;
  tags: string;
  summary: string;
  definition: string;
  isFeatured: boolean;
  usageCount: number;
  lastUsedAt: string;
  launchPageId: string;
  createdAt: string;
  updatedAt: string;
  taxonomyPath?: string;
}

interface Draft {
  id: string;
  name: string;
  extensionType: string;
  parentId: string;
  status: string;
  tags: string;
  summary: string;
  definition: string;
  slug?: string;
  launchPageId?: string;
  isFeatured?: boolean;
  usageCount?: number;
  lastUsedAt?: string;
}

interface Filters {
  name: string;
  extensionType: string;
  status: string;
  tags: string;
}

interface Sort {
  key: string;
  dir: "asc" | "desc";
}

const EXTENSION_TYPES = [
  { value: "manager", label: "Manager" },
  { value: "utility", label: "Utility" },
  { value: "generator", label: "Generator" },
  { value: "connector", label: "Connector" },
  { value: "workflow", label: "Workflow" },
  { value: "automation", label: "Automation" },
  { value: "analytics", label: "Analytics" },
  { value: "catalog", label: "Catalog" },
  { value: "custom", label: "Custom" },
];

const SORT_COLS: { key: string; label: string; defaultDir: "asc" | "desc" }[] = [
  { key: "name", label: "Name", defaultDir: "asc" },
  { key: "extensionType", label: "Type", defaultDir: "asc" },
  { key: "taxonomyPath", label: "Taxonomy", defaultDir: "asc" },
  { key: "status", label: "Status", defaultDir: "asc" },
  { key: "updatedAt", label: "Updated", defaultDir: "desc" },
];

function typeLabel(value: string) {
  return EXTENSION_TYPES.find((t) => t.value === value)?.label || value || "-";
}

function buildPath(id: string, map: Map<string, ExtensionRecord>, seen = new Set<string>()): string {
  if (!id || seen.has(id)) return "";
  const item = map.get(id);
  if (!item) return "";
  seen.add(id);
  const parent = buildPath(item.parentId, map, seen);
  const name = item.name || id;
  return parent ? `${parent} / ${name}` : name;
}

function deriveSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

function emptyDraft(): Draft {
  return { id: "", name: "", extensionType: "", parentId: "", status: "active", tags: "", summary: "", definition: "" };
}

function draftFromRecord(rec: ExtensionRecord): Draft {
  return {
    id: rec.id,
    name: rec.name || "",
    extensionType: rec.extensionType || "",
    parentId: rec.parentId || "",
    status: rec.status || "active",
    tags: rec.tags || "",
    summary: rec.summary || "",
    definition: rec.definition || "",
    slug: rec.slug,
    launchPageId: rec.launchPageId,
    isFeatured: rec.isFeatured,
    usageCount: rec.usageCount,
    lastUsedAt: rec.lastUsedAt,
  };
}

function formatDate(iso: string) {
  return iso ? new Date(iso).toLocaleString() : "-";
}

interface Props {
  onRegisterOpenItem: (fn: (item: ExtensionRecord) => void) => void;
}

export function BuilderExtensionsPage({ onRegisterOpenItem }: Props) {
  const [extensions, setExtensions] = useState<ExtensionRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [filters, setFilters] = useState<Filters>({ name: "", extensionType: "", status: "", tags: "" });
  const [sort, setSort] = useState<Sort>({ key: "updatedAt", dir: "desc" });
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const configLoaded = useRef(false);

  async function load() {
    try {
      const res = await appApi("/api/builder/extensions");
      const list = unwrapEnvelope<ExtensionRecord[]>(res, "extensions");
      setExtensions(Array.isArray(list) ? list : []);
    } catch {
      setExtensions([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadConfig() {
    try {
      const res = await appApi("/api/builder/extensions-manager");
      const manager = unwrapEnvelope<{ defaultFilters?: Partial<Filters>; defaultSortKey?: string; defaultSortDir?: string }>(res, "manager");
      if (manager?.defaultFilters) {
        setFilters((prev) => ({ ...prev, ...manager.defaultFilters }));
      }
      if (manager?.defaultSortKey) {
        setSort({ key: manager.defaultSortKey, dir: (manager.defaultSortDir as "asc" | "desc") || "desc" });
      }
    } catch {
      // Non-blocking — defaults stay
    }
    configLoaded.current = true;
  }

  async function saveConfig(f: Filters, s: Sort) {
    try {
      await appApi("/api/builder/extensions-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultFilters: f, defaultSortKey: s.key, defaultSortDir: s.dir }),
      });
    } catch {
      // Non-blocking preference persistence
    }
  }

  useEffect(() => {
    onRegisterOpenItem((item) => setDraft(draftFromRecord(item)));
    load();
    loadConfig();
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function deferSaveConfig(f: Filters, s: Sort) {
    if (!configLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveConfig(f, s), 600);
  }

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      deferSaveConfig(next, sort);
      return next;
    });
  }

  function toggleSort(key: string, defaultDir: "asc" | "desc") {
    setSort((prev) => {
      const next: Sort =
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: defaultDir };
      deferSaveConfig(filters, next);
      return next;
    });
  }

  const parentOptions = useMemo(() => {
    const map = new Map(extensions.map((e) => [e.id, e]));
    return extensions
      .filter((e) => e.id !== draft.id)
      .map((e) => ({ value: e.id, label: buildPath(e.id, map) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [extensions, draft.id]);

  const tableRows = useMemo(() => {
    const map = new Map(extensions.map((e) => [e.id, e]));
    let rows = extensions
      .filter((e) => {
        const n = (e.name || "").toLowerCase();
        const t = (e.tags || "").toLowerCase();
        if (filters.name && !n.includes(filters.name.toLowerCase())) return false;
        if (filters.extensionType && e.extensionType !== filters.extensionType) return false;
        if (filters.status && e.status !== filters.status) return false;
        if (filters.tags && !t.includes(filters.tags.toLowerCase())) return false;
        return true;
      })
      .map((e) => ({ ...e, taxonomyPath: buildPath(e.id, map) }));

    const { key, dir } = sort;
    rows.sort((a, b) => {
      let left: string | number;
      let right: string | number;
      if (key === "updatedAt") {
        left = new Date(a.updatedAt || 0).getTime();
        right = new Date(b.updatedAt || 0).getTime();
      } else {
        left = ((a[key as keyof typeof a] as string) || "").toLowerCase();
        right = ((b[key as keyof typeof b] as string) || "").toLowerCase();
      }
      if (left < right) return dir === "asc" ? -1 : 1;
      if (left > right) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [extensions, filters, sort]);

  function set(field: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    const extensionType = draft.extensionType.trim();
    if (!name) { setStatus({ message: "Extension name is required", isError: true }); return; }
    if (!extensionType) { setStatus({ message: "Extension type is required", isError: true }); return; }
    if (draft.parentId && draft.parentId === draft.id) {
      setStatus({ message: "An extension cannot be its own parent", isError: true });
      return;
    }
    setIsSaving(true);
    setStatus(null);
    const isNew = !draft.id;
    const existing = extensions.find((e) => e.id === draft.id) ?? null;
    const payload = {
      slug: existing?.slug || deriveSlug(name),
      name,
      extensionType,
      parentId: draft.parentId,
      status: draft.status || "active",
      tags: draft.tags,
      summary: draft.summary,
      definition: draft.definition,
      launchPageId: existing?.launchPageId || "",
      isFeatured: existing?.isFeatured === true,
      usageCount: Number(existing?.usageCount || 0) || 0,
      lastUsedAt: existing?.lastUsedAt || "",
    };
    try {
      const url = isNew ? "/api/builder/extensions" : `/api/builder/extensions/${encodeURIComponent(draft.id)}`;
      await appApi(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus({ message: isNew ? "Extension created" : "Extension updated", isError: false });
      setDraft(emptyDraft());
      await load();
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not save extension", isError: true });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: ExtensionRecord) {
    if (!window.confirm(`Delete extension "${item.name || item.id}"?`)) return;
    try {
      await appApi(`/api/builder/extensions/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setStatus({ message: "Extension deleted", isError: false });
      if (draft.id === item.id) setDraft(emptyDraft());
      await load();
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Could not delete extension", isError: true });
    }
  }

  const sortIndicator = (key: string) => sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="builder-ext-page">
      <div className="builder-ext-form-wrap">
        <h3 className="builder-ext-form-heading">{draft.id ? "Edit Extension" : "New Extension"}</h3>
        <form className="standard-form-grid builder-ext-form" onSubmit={handleSave}>
          <label>Extension Name</label>
          <input type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} required />

          <label>Extension Type</label>
          <select value={draft.extensionType} onChange={(e) => set("extensionType", e.target.value)} required>
            <option value="">Extension Type</option>
            {EXTENSION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <label>Parent Extension</label>
          <select value={draft.parentId} onChange={(e) => set("parentId", e.target.value)}>
            <option value="">Parent Extension (Optional)</option>
            {parentOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <label>Status</label>
          <select value={draft.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>

          <label>Tags</label>
          <input type="text" value={draft.tags} onChange={(e) => set("tags", e.target.value)} />

          <label>Summary</label>
          <textarea rows={3} value={draft.summary} onChange={(e) => set("summary", e.target.value)} />

          <label>Definition</label>
          <textarea rows={6} value={draft.definition} onChange={(e) => set("definition", e.target.value)} />

          <div />
          <div className="builder-ext-form-actions">
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Saving…" : draft.id ? "Update Extension" : "Save Extension"}
            </button>
            <button type="button" className="btn" onClick={() => { setDraft(emptyDraft()); setStatus(null); }}>
              Reset
            </button>
          </div>
        </form>
        {status && (
          <p className={`builder-ext-status${status.isError ? " is-error" : ""}`}>{status.message}</p>
        )}
      </div>

      <div className="builder-ext-table-wrap">
        {isLoading ? (
          <p className="meta">Loading extensions…</p>
        ) : (
          <table className="builder-ext-table">
            <thead>
              <tr className="builder-ext-filter-row">
                <th>
                  <input
                    type="text"
                    placeholder="Filter Name"
                    value={filters.name}
                    onChange={(e) => updateFilter("name", e.target.value)}
                    className="builder-ext-filter-input"
                  />
                </th>
                <th>
                  <select
                    value={filters.extensionType}
                    onChange={(e) => updateFilter("extensionType", e.target.value)}
                    className="builder-ext-filter-input"
                  >
                    <option value="">All Types</option>
                    {EXTENSION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </th>
                <th />
                <th>
                  <select
                    value={filters.status}
                    onChange={(e) => updateFilter("status", e.target.value)}
                    className="builder-ext-filter-input"
                  >
                    <option value="">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </th>
                <th>
                  <input
                    type="text"
                    placeholder="Filter Tags"
                    value={filters.tags}
                    onChange={(e) => updateFilter("tags", e.target.value)}
                    className="builder-ext-filter-input"
                  />
                </th>
                <th />
              </tr>
              <tr>
                {SORT_COLS.map((col) => (
                  <th
                    key={col.key}
                    className="builder-ext-sort-th"
                    onClick={() => toggleSort(col.key, col.defaultDir)}
                  >
                    {col.label}{sortIndicator(col.key)}
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr><td colSpan={6}>No extensions yet.</td></tr>
              ) : (
                tableRows.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name || "-"}</td>
                    <td>{typeLabel(item.extensionType)}</td>
                    <td className="meta">{item.taxonomyPath || "-"}</td>
                    <td>{item.status || "-"}</td>
                    <td className="meta">{formatDate(item.updatedAt)}</td>
                    <td className="builder-ext-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { setDraft(draftFromRecord(item)); setStatus(null); }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(item)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
