import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "You don't have a workspace yet" — where a signed-in user lands when they
 * belong to no project at all.
 *
 * This is reachable because an invitation may deliberately name no workspace.
 * Every other screen would be empty and full of "Active project is required",
 * so the shell sends them here instead.
 *
 * WHY IT EMAILS THE INVITER, NOT "THE PROJECT OWNERS"
 * The original sketch was to let them pick a project and notify its owners.
 * But someone with no workspace has no way to name one — they would have to
 * be shown a list of every project on the platform, which tells one client
 * that the others exist. The person who invited them is already known, so
 * this asks them and nobody sees a list.
 */

const REQUEST_PATH = '/api/invitations/request-access';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApp(): any {
  return (window as unknown as { App?: any }).App;
}

function getAppApi(): AppApi | null {
  const app = getApp();
  return typeof app?.api === 'function' ? app.api : null;
}

export default function NoWorkspacePanel(): JSX.Element {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  // react-entry.js mounts every island at DOMContentLoaded, so this renders
  // long before anyone signs in and App.auth.user is still null. Reading the
  // name once at render gave a permanently anonymous greeting; re-read it when
  // the page is actually revealed.
  const [name, setName] = useState('');
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const readName = () => setName(String(getApp()?.auth?.user?.name || '').trim());
    readName();
    const section = hostRef.current?.closest('.app-page');
    if (!section) return undefined;
    const observer = new MutationObserver(() => {
      if (!section.classList.contains('hidden')) readName();
    });
    observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const onRequest = async () => {
    const api = getAppApi();
    if (!api) return;
    setSending(true);
    setError('');
    try {
      const res = await api(REQUEST_PATH, { method: 'POST', body: JSON.stringify({ note: note.trim() }) });
      const data = res?.data || res;
      setSentTo(String(data?.notified || '').trim() || 'your administrator');
    } catch (err) {
      setError((err as Error)?.message || 'Could not send the request');
    } finally {
      setSending(false);
    }
  };

  // Once someone adds them, nothing tells the open page — so give them a way
  // to look again that is not "reload and hope".
  const onCheckAgain = useCallback(async () => {
    const api = getAppApi();
    if (!api) return;
    setChecking(true);
    setError('');
    try {
      const res = await api('/api/projects', { method: 'GET' });
      const list = Array.isArray(res?.projects) ? res.projects : (Array.isArray(res?.data) ? res.data : []);
      if (list.length) {
        window.location.reload();
        return;
      }
      setError('Still no workspace. Whoever invited you has not added you to one yet.');
    } catch (err) {
      setError((err as Error)?.message || 'Could not check');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Landing here is itself the notification that something is unfinished;
    // no automatic email, or a forgetful inviter gets one on every reload.
  }, []);

  return (
    <div ref={hostRef} className="card" style={{ maxWidth: '40rem', margin: '2rem auto' }}>
      <h2 style={{ marginTop: 0 }}>{name ? `Welcome, ${name}` : 'Welcome to StarCaster'}</h2>
      <p>
        Your account is ready, but you have not been given a workspace yet — so there is
        nothing to show you here. Whoever invited you needs to add you to one.
      </p>

      {sentTo ? (
        <>
          <p style={{ fontWeight: 600 }}>We have let {sentTo} know that you are waiting.</p>
          <p className="meta">
            You will not see anything change here until they add you. Once they have,
            use the button below.
          </p>
        </>
      ) : (
        <>
          <div className="form-row">
            <label htmlFor="noWorkspaceNote">Anything you want to add? (optional)</label>
            <textarea
              id="noWorkspaceNote"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. I should have access to the Delray site"
            />
          </div>
          <div className="page-heading-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-primary" onClick={onRequest} disabled={sending}>
              {sending ? 'Sending…' : 'Ask for access'}
            </button>
          </div>
        </>
      )}

      {error && <p className="meta" style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}

      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid var(--border, #e5e7eb)' }} />

      <div className="page-heading-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn" onClick={onCheckAgain} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const logout = document.getElementById('authLogoutButton');
            if (logout) logout.click();
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
