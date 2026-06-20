import { useState, useEffect } from "react";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

interface ModuleClass {
  id: number;
  name: string;
  createdAt: string;
}

function formatDate(iso: string) {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

async function syncLegacy() {
  const api = (window as unknown as { App?: { builder?: { refreshModuleClasses?: () => Promise<void> } } }).App?.builder;
  if (api?.refreshModuleClasses) await api.refreshModuleClasses();
}

export function BuilderModuleClassesPanel() {
  const [classes, setClasses] = useState<ModuleClass[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    try {
      const res = await appApi("/api/builder/module-classes");
      const list = unwrapEnvelope<ModuleClass[]>(res, "classes");
      setClasses(Array.isArray(list) ? list : []);
    } catch {
      setClasses([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await appApi("/api/builder/module-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNewName("");
      setStatus("Class created");
      await load();
      await syncLegacy();
    } catch (err: unknown) {
      setStatus((err as Error).message || "Error creating class");
    }
  }

  function startEdit(cls: ModuleClass) {
    setEditingId(cls.id);
    setEditName(cls.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function handleRename(id: number) {
    const name = editName.trim();
    if (!name) return;
    try {
      await appApi(`/api/builder/module-classes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      cancelEdit();
      setStatus("Class renamed");
      await load();
      await syncLegacy();
    } catch (err: unknown) {
      setStatus((err as Error).message || "Error renaming class");
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!window.confirm(`Delete module class "${name}"?`)) return;
    try {
      await appApi(`/api/builder/module-classes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setStatus("Class deleted");
      await load();
      await syncLegacy();
    } catch (err: unknown) {
      setStatus((err as Error).message || "Error deleting class");
    }
  }

  return (
    <div className="builder-mc-panel">
      <form className="builder-mc-create-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New class name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="builder-mc-input"
          required
        />
        <button type="submit" className="btn btn-primary">Add Class</button>
      </form>
      {status && <p className="builder-mc-status meta">{status}</p>}
      {isLoading ? (
        <p className="meta">Loading classes…</p>
      ) : classes.length === 0 ? (
        <p className="meta">No module classes created yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="builder-mc-table">
            <thead>
              <tr>
                <th>Class Name</th>
                <th>Created</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((cls) => (
                <tr key={cls.id}>
                  <td>
                    {editingId === cls.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="builder-mc-inline-input"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(cls.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                    ) : (
                      cls.name
                    )}
                  </td>
                  <td className="meta">{formatDate(cls.createdAt)}</td>
                  <td className="builder-mc-actions">
                    {editingId === cls.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleRename(cls.id)}
                        >
                          Save
                        </button>
                        <button type="button" className="btn btn-sm" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => startEdit(cls)}>
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(cls.id, cls.name)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
