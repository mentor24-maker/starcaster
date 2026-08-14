import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Settings › Invitations — send, list, and revoke platform invitations.
 *
 * A React island inside the frozen vanilla admin screens, mounted into
 * #invitationsReactRoot by react-entry.js (same pattern as the Images
 * scaled-copies panel).
 *
 * WHY THE LINK ONLY APPEARS ONCE
 * Only a hash of the token is stored, so the signup link exists exactly once:
 * in the response to the request that created it. There is deliberately no
 * "copy link" button on older rows — it could not work, and a button that
 * silently produces a dead link is worse than no button. Re-inviting is the
 * supported way to get a fresh link, and it revokes the previous one.
 */

const LIST_PATH = '/api/invitations';
const PROJECTS_PATH = '/api/projects';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

type Invitation = {
  id: string;
  email: string;
  projectId: string;
  projectRole: string;
  status: string;
  invitedByUserId: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string | null;
};

type Project = {
  id: string;
  name?: string;
  slug?: string;
  membership?: { role?: string } | null;
};

type SentResult = {
  email: string;
  signupUrl: string;
  emailSent: boolean;
  emailError: string;
};

function getApp(): any {
  return (window as unknown as { App?: any }).App;
}

function getAppApi(): AppApi | null {
  const app = getApp();
  return typeof app?.api === 'function' ? app.api : null;
}

/** The platform owner may invite with no project; everyone else may not. */
function isPlatformOwner(): boolean {
  return String(getApp()?.auth?.user?.role || '').toLowerCase() === 'owner';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isExpired(invitation: Invitation): boolean {
  if (invitation.status !== 'pending' || !invitation.expiresAt) return false;
  const ms = new Date(invitation.expiresAt).getTime();
  return Number.isFinite(ms) && ms < Date.now();
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—';
}

/** Pending-but-past-expiry reads as "Expired" here; the row itself still says pending. */
function statusLabel(invitation: Invitation): string {
  if (isExpired(invitation)) return 'Expired';
  return titleCase(invitation.status || '');
}

export default function InvitationsPanel(): JSX.Element {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState('member');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState<SentResult | null>(null);
  const [copied, setCopied] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const platformOwner = isPlatformOwner();

  // Only projects this person owns can be invited into — the server enforces
  // the same rule, and offering the rest would just produce a refusal.
  const invitableProjects = useMemo(
    () => projects.filter((p) => platformOwner || String(p?.membership?.role || '').toLowerCase() === 'owner'),
    [projects, platformOwner]
  );

  const projectName = useCallback(
    (id: string) => {
      if (!id) return 'No workspace';
      const match = projects.find((p) => p.id === id);
      return match?.name || match?.slug || id;
    },
    [projects]
  );

  const load = useCallback(async () => {
    const api = getAppApi();
    if (!api) {
      setLoadError('The app is still starting up. Reload the page.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const [listRes, projectsRes] = await Promise.all([
        api(LIST_PATH, { method: 'GET' }),
        api(PROJECTS_PATH, { method: 'GET' }),
      ]);
      const list = Array.isArray(listRes?.invitations)
        ? listRes.invitations
        : (Array.isArray(listRes?.data) ? listRes.data : []);
      const projectList = Array.isArray(projectsRes?.projects)
        ? projectsRes.projects
        : (Array.isArray(projectsRes?.data) ? projectsRes.data : []);
      setInvitations(list as Invitation[]);
      setProjects(projectList as Project[]);
    } catch (err) {
      setLoadError((err as Error)?.message || 'Could not load invitations');
    } finally {
      setLoading(false);
    }
  }, []);

  // react-entry.js mounts every island at DOMContentLoaded — which is before
  // anyone has signed in. Loading here regardless meant the panel's first act
  // was a 401, and it sat there reading "Not authenticated" behind a screen
  // nobody had opened yet. Wait for a session; the reveal below does the rest.
  useEffect(() => {
    if (!getApp()?.auth?.user) {
      setLoading(false);
      return;
    }
    load();
  }, [load]);

  // Default the project to whichever workspace is active, once both are known.
  useEffect(() => {
    if (projectId) return;
    const active = String(getApp()?.state?.currentProjectId || '');
    if (active && invitableProjects.some((p) => p.id === active)) setProjectId(active);
    else if (invitableProjects.length === 1) setProjectId(invitableProjects[0].id);
  }, [invitableProjects, projectId]);

  // The screen lives inside the vanilla shell, which shows and hides pages by
  // toggling a class rather than mounting them — so the component is mounted
  // long before anyone looks at it. Reload whenever the page is revealed, or
  // the list is stale from the moment it is opened.
  useEffect(() => {
    const section = hostRef.current?.closest('.app-page');
    if (!section) return undefined;
    let wasHidden = section.classList.contains('hidden');
    const observer = new MutationObserver(() => {
      const hidden = section.classList.contains('hidden');
      if (wasHidden && !hidden) load();
      wasHidden = hidden;
    });
    observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [load]);

  const notify = (text: string, isError = false) => {
    const app = getApp();
    if (typeof app?.notify === 'function') app.notify(text, isError);
  };

  const onSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const api = getAppApi();
    if (!api) return;

    const address = email.trim().toLowerCase();
    if (!address || !address.includes('@')) {
      setFormError('Enter a valid email address');
      return;
    }
    if (!projectId && !platformOwner) {
      setFormError('Choose a workspace for this invitation');
      return;
    }

    setSending(true);
    setFormError('');
    setSent(null);
    setCopied(false);
    try {
      const res = await api(LIST_PATH, {
        method: 'POST',
        body: JSON.stringify({ email: address, projectId, projectRole: role }),
      });
      const data = res?.data || res;
      setSent({
        email: address,
        signupUrl: String(data?.signupUrl || ''),
        emailSent: Boolean(data?.emailSent),
        emailError: String(data?.emailError || ''),
      });
      setEmail('');
      notify(data?.emailSent ? `Invitation sent to ${address}` : `Invitation created for ${address} — email did not send`, !data?.emailSent);
      await load();
    } catch (err) {
      setFormError((err as Error)?.message || 'Could not send the invitation');
    } finally {
      setSending(false);
    }
  };

  const onRevoke = async (invitation: Invitation) => {
    const api = getAppApi();
    if (!api) return;
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? Their link stops working immediately.`)) return;
    try {
      await api(`${LIST_PATH}/${encodeURIComponent(invitation.id)}/revoke`, { method: 'POST' });
      notify(`Invitation for ${invitation.email} revoked`);
      await load();
    } catch (err) {
      notify((err as Error)?.message || 'Could not revoke the invitation', true);
    }
  };

  const onCopy = async () => {
    if (!sent?.signupUrl) return;
    try {
      await navigator.clipboard.writeText(sent.signupUrl);
      setCopied(true);
    } catch (_) {
      setCopied(false);
    }
  };

  return (
    <div ref={hostRef}>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Invite someone</h3>
        <p className="meta">
          StarCaster accounts are by invitation only. The person you invite gets a link that only works
          for their email address, once, and expires in 7 days.
        </p>
        <form onSubmit={onSend}>
          <div className="form-row">
            <label htmlFor="inviteEmail">Email</label>
            <input
              id="inviteEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="them@example.com"
              autoComplete="off"
            />
          </div>
          <div className="form-row">
            <label htmlFor="inviteProject">Workspace</label>
            <select id="inviteProject" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {platformOwner && <option value="">No workspace yet — they'll ask you</option>}
              {invitableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || project.slug || project.id}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="inviteRole">Role</label>
            <select id="inviteRole" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="owner">Owner — can invite others to this workspace</option>
            </select>
          </div>
          {formError && <p className="meta" style={{ color: 'var(--danger, #b91c1c)' }}>{formError}</p>}
          <div className="page-heading-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </form>

        {sent && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <p style={{ marginTop: 0 }}>
              {sent.emailSent
                ? `Invitation emailed to ${sent.email}.`
                : `Invitation created for ${sent.email}, but the email did not send.`}
            </p>
            {!sent.emailSent && sent.emailError && (
              <p className="meta" style={{ color: 'var(--danger, #b91c1c)' }}>{sent.emailError}</p>
            )}
            <p className="meta">
              This link is shown once and cannot be shown again — copy it now if you need to send it yourself.
            </p>
            <div className="form-row">
              <input readOnly value={sent.signupUrl} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn" onClick={onCopy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="page-heading-row">
        <h3 style={{ margin: 0 }}>Invitations</h3>
        <div className="page-heading-actions">
          <button type="button" className="btn" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loadError && <p className="meta" style={{ color: 'var(--danger, #b91c1c)' }}>{loadError}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Workspace</th>
              <th>Role</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Expires</th>
              <th className="actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading && invitations.length === 0 && (
              <tr>
                <td colSpan={7} className="meta">No invitations yet.</td>
              </tr>
            )}
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>{projectName(invitation.projectId)}</td>
                <td>{invitation.projectId ? titleCase(invitation.projectRole) : '—'}</td>
                <td>{statusLabel(invitation)}</td>
                <td>{formatDate(invitation.createdAt)}</td>
                <td>{formatDate(invitation.expiresAt)}</td>
                <td className="actions-col">
                  {invitation.status === 'pending' && !isExpired(invitation) ? (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => onRevoke(invitation)}>
                      Revoke
                    </button>
                  ) : (
                    <span className="meta">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
