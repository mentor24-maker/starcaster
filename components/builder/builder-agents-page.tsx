import { useState, useEffect } from "react";
import { appApi, unwrapEnvelope } from "@/lib/adapters/starcaster-app";

const STORAGE_KEY = "develop_saved_agents_v1";

const AGENT_ACTIONS = [
  "agent_api_setup_orchestrator",
  "create_job",
  "preview_job",
  "approve_job",
  "execute_job",
  "job_status",
];

interface AgentRecord {
  id: string;
  name: string;
  action: string;
  job_id: string;
  workspace_id: string;
  type: string;
  requested_by_user_id: string;
  requested_by_email: string;
  payload_json: string;
  approval_decision: string;
  approval_token: string;
  approval_comment: string;
  manual_confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

function emptyDraft(): AgentRecord {
  return {
    id: "",
    name: "",
    action: "agent_api_setup_orchestrator",
    job_id: "",
    workspace_id: "alphire-main",
    type: "acquire.web",
    requested_by_user_id: "alphire-ui",
    requested_by_email: "ops@alphire.ai",
    payload_json: '{"source_urls":[],"max_pages":20}',
    approval_decision: "APPROVE",
    approval_token: "",
    approval_comment: "",
    manual_confirmed: false,
    createdAt: "",
    updatedAt: "",
  };
}

function nextLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadFromStorage(): AgentRecord[] {
  try {
    const raw = (window.localStorage.getItem(STORAGE_KEY) || "").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(agents: AgentRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  } catch {
    // ignore quota errors
  }
}

function parseJson(value: string, fallback: unknown = {}) {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function buildRequest(d: AgentRecord): { action: string; request: Record<string, unknown> } {
  const action = d.action || "create_job";
  if (!d.manual_confirmed) throw new Error("Manual confirmation is required");
  const request: Record<string, unknown> = { manual_confirmed: true };
  const jobId = d.job_id.trim();
  const requestedBy = {
    user_id: d.requested_by_user_id.trim() || "alphire-ui",
    email: d.requested_by_email.trim() || "ops@alphire.ai",
  };

  if (action === "create_job") {
    request.type = d.type.trim() || "acquire.web";
    request.workspace_id = d.workspace_id.trim() || "alphire-main";
    request.requested_by = requestedBy;
    request.payload = parseJson(d.payload_json, {});
    request.policy = { requires_manual_approval: true };
    return { action, request };
  }

  if (!jobId) throw new Error("job_id is required for this action");
  request.job_id = jobId;

  if (action === "preview_job") {
    request.requested_by = requestedBy;
    request.options = { include_confidence: true, sample_size: 25 };
    return { action, request };
  }
  if (action === "approve_job") {
    request.decision = d.approval_decision || "APPROVE";
    request.approver = requestedBy;
    request.comment = d.approval_comment.trim();
    request.constraints = { expires_in_minutes: 30 };
    return { action, request };
  }
  if (action === "execute_job") {
    if (!d.approval_token.trim()) throw new Error("approval_token is required for execute_job");
    request.requested_by = requestedBy;
    request.approval_token = d.approval_token.trim();
    request.execution = { priority: "normal", dry_run: false };
    return { action, request };
  }
  if (action === "job_status") return { action, request };
  if (action === "agent_api_setup_orchestrator") {
    request.workspace_id = d.workspace_id.trim() || "alphire-main";
    request.requested_by = requestedBy;
    request.payload = parseJson(d.payload_json, {});
    return { action, request };
  }

  throw new Error("Unsupported action");
}

interface Props {
  initialView: "list" | "builder";
  onRegisterSetView: (fn: (view: "list" | "builder") => void) => void;
}

export function BuilderAgentsPage({ initialView, onRegisterSetView }: Props) {
  const [agents, setAgents] = useState<AgentRecord[]>(() => loadFromStorage());
  const [view, setView] = useState<"list" | "builder">(initialView);
  const [draft, setDraft] = useState<AgentRecord>(emptyDraft);
  const [requestPreview, setRequestPreview] = useState<unknown>(null);
  const [response, setResponse] = useState<unknown>(null);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    onRegisterSetView((v) => setView(v));
  }, [onRegisterSetView]);

  function set(field: keyof AgentRecord, value: string | boolean) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function openCreate() {
    setDraft(emptyDraft());
    setRequestPreview(null);
    setResponse(null);
    setStatus(null);
    setView("builder");
  }

  function openEdit(item: AgentRecord) {
    setDraft({ ...item });
    setRequestPreview(null);
    setResponse(null);
    setStatus(null);
    setView("builder");
  }

  function openList() {
    setView("list");
    setStatus(null);
  }

  function savePreset({ clone = false } = {}) {
    const name = draft.name.trim();
    if (!name) { setStatus({ message: "Agent name is required", isError: true }); return; }
    const now = new Date().toISOString();
    const isNew = clone || !draft.id;
    const id = isNew ? nextLocalId("agent") : draft.id;
    const existing = agents.find((a) => a.id === draft.id);
    const record: AgentRecord = {
      ...draft,
      id,
      updatedAt: now,
      createdAt: isNew ? now : (existing?.createdAt || now),
    };
    const updated = (() => {
      if (!clone) {
        const idx = agents.findIndex((a) => a.id === draft.id);
        if (idx >= 0) {
          const copy = [...agents];
          copy.splice(idx, 1, record);
          return copy;
        }
      }
      return [record, ...agents];
    })();
    saveToStorage(updated);
    setAgents(updated);
    setDraft({ ...record });
    setStatus({ message: clone ? "Agent cloned" : (existing ? "Agent updated" : "Agent saved"), isError: false });
  }

  function deleteAgent(item: AgentRecord) {
    if (!window.confirm(`Delete agent "${item.name || "Untitled Agent"}"?`)) return;
    const updated = agents.filter((a) => a.id !== item.id);
    saveToStorage(updated);
    setAgents(updated);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    let built: ReturnType<typeof buildRequest>;
    try {
      built = buildRequest(draft);
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message, isError: true });
      return;
    }
    setRequestPreview(built);
    setIsSending(true);
    try {
      const res = await appApi(`/api/openclaw/${built.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.request),
      });
      setResponse(res);
      setStatus({ message: `OpenClaw ${built.action} request sent`, isError: false });
    } catch (err: unknown) {
      setStatus({ message: (err as Error).message || "Request failed", isError: true });
    } finally {
      setIsSending(false);
    }
  }

  const sorted = [...agents].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );

  if (view === "list") {
    return (
      <div className="builder-agents-page">
        <div className="builder-agents-list-toolbar">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Create Agent
          </button>
        </div>
        {agents.length === 0 ? (
          <p className="meta">No saved agents yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="builder-agents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Action</th>
                  <th>Workspace</th>
                  <th>Type</th>
                  <th>Updated</th>
                  <th className="develop-agents-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name || "Untitled Agent"}</td>
                    <td>{item.action || "-"}</td>
                    <td>{item.workspace_id || "-"}</td>
                    <td>{item.type || "-"}</td>
                    <td className="meta">{item.updatedAt || "-"}</td>
                    <td className="builder-agents-actions">
                      <button type="button" className="btn btn-sm" onClick={() => openEdit(item)}>Edit</button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { setDraft({ ...item, id: "", name: `${item.name || "Agent"} Copy` }); setView("builder"); }}
                      >
                        Clone
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => deleteAgent(item)}
                      >
                        Delete
                      </button>
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

  return (
    <div className="builder-agents-page">
      <div className="builder-agents-builder-panel card">
        <form className="standard-form-grid" onSubmit={handleSend}>
          <div className="standard-form-grid-full page-heading-row" style={{ marginBottom: "0.75rem" }}>
            <h3 style={{ margin: 0 }}>Agent Builder</h3>
            <div className="page-heading-actions">
              <button
                type="button"
                className="btn"
                onClick={() => savePreset({ clone: false })}
              >
                Save Agent
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => savePreset({ clone: true })}
              >
                Clone Agent
              </button>
              <button type="button" className="btn" onClick={openList}>
                Back To Agents
              </button>
            </div>
          </div>

          <label>Agent Name</label>
          <input type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} />

          <label>Action</label>
          <select value={draft.action} onChange={(e) => set("action", e.target.value)}>
            {AGENT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <label>Job ID</label>
          <input
            type="text"
            value={draft.job_id}
            onChange={(e) => set("job_id", e.target.value)}
            placeholder="Required for preview/approve/execute/status"
          />

          <label>Workspace ID</label>
          <input type="text" value={draft.workspace_id} onChange={(e) => set("workspace_id", e.target.value)} />

          <label>Job Type</label>
          <input type="text" value={draft.type} onChange={(e) => set("type", e.target.value)} />

          <label>Requested By User ID</label>
          <input type="text" value={draft.requested_by_user_id} onChange={(e) => set("requested_by_user_id", e.target.value)} />

          <label>Requested By Email</label>
          <input type="text" value={draft.requested_by_email} onChange={(e) => set("requested_by_email", e.target.value)} />

          <label>Payload JSON</label>
          <textarea
            rows={6}
            value={draft.payload_json}
            onChange={(e) => set("payload_json", e.target.value)}
            placeholder='{"source_urls":["https://example.com"],"max_pages":20}'
          />

          <label>Approval Decision</label>
          <select value={draft.approval_decision} onChange={(e) => set("approval_decision", e.target.value)}>
            <option value="APPROVE">APPROVE</option>
            <option value="REJECT">REJECT</option>
          </select>

          <label>Approval Token</label>
          <input
            type="text"
            value={draft.approval_token}
            onChange={(e) => set("approval_token", e.target.value)}
            placeholder="For execute_job"
          />

          <label>Approval Comment</label>
          <input type="text" value={draft.approval_comment} onChange={(e) => set("approval_comment", e.target.value)} />

          <div className="standard-form-grid-full">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.manual_confirmed}
                onChange={(e) => set("manual_confirmed", e.target.checked)}
              />
              I manually confirm this API action.
            </label>
          </div>

          <div />
          <button type="submit" className="btn btn-primary" disabled={isSending}>
            {isSending ? "Sending…" : "Send Agent Request"}
          </button>
        </form>
      </div>

      {status && (
        <p className={`builder-agents-status${status.isError ? " is-error" : ""}`}>{status.message}</p>
      )}

      {requestPreview !== null && (
        <>
          <h3>Request Preview</h3>
          <pre className="code-box">{JSON.stringify(requestPreview, null, 2)}</pre>
        </>
      )}
      {response !== null && (
        <>
          <h3>Response</h3>
          <pre className="code-box">{JSON.stringify(response, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
