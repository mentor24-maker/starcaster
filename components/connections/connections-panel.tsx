import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Settings › Connections — the screen a client uses to let Starcaster post on
 * their own social accounts. Connections 4 of 7 (86bbpz1gd).
 *
 * A React island inside the frozen vanilla admin shell, mounted into
 * #connectionsReactRoot by react-entry.js — the same pattern as the
 * Invitations panel next door.
 *
 * ── One card per platform, and this file names none of them ────────────────
 *
 * Everything rendered here comes from GET /api/connections, which is generated
 * from lib/connections/registry.js. There is no platform list in this
 * component, no per-provider branch and no icon path: adding a registry entry
 * makes a card appear here with nothing in this file edited. That is the
 * slice's central acceptance criterion, and it only stays true while this file
 * stays ignorant — so if a future change wants "except for X", the answer is
 * almost always a new field on the catalogue entry instead.
 *
 * The one thing the component switches on is `authKind`, which is a property of
 * how a platform is connected rather than of which platform it is: `redirect`
 * sends the browser to a consent screen, `app_password` shows the small form
 * the server described. A third kind would arrive as data, not as a branch.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 *
 * No field for an access token, an app id or a page id. Those are OUR
 * credentials — the ones that used to be pasted into Vercel — and a client can
 * neither obtain them nor should hold them; a platform that cannot be connected
 * by clicking shows as "coming soon" instead. An app password is not one of
 * those: it is the client's own credential, minted in their own account
 * settings, and it is Bluesky's equivalent of a consent screen. The server says
 * which fields to show; this file never invents one.
 */

const LIST_PATH = '/api/connections';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

type CardState = 'not_connected' | 'connected' | 'needs_attention' | 'coming_soon';

type ConnectionAccount = {
  accountId: string;
  accountLabel: string;
  accountAvatarUrl: string;
};

type ConnectionCard = {
  provider: string;
  displayName: string;
  iconKey: string;
  blurb: string;
  readiness: string;
  authKind: string;
  connectable: boolean;
  cardState: CardState;
  account: ConnectionAccount | null;
  reason: string;
  accounts: ConnectionAccount[];
};

type StartField = {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  help?: string;
};

/** The small form an app-password platform asks for, once Connect is pressed. */
type PendingForm = {
  provider: string;
  displayName: string;
  fields: StartField[];
  values: Record<string, string>;
  error: string;
  busy: boolean;
};

function getApp(): any {
  return (window as unknown as { App?: any }).App;
}

function getAppApi(): AppApi | null {
  const app = getApp();
  return typeof app?.api === 'function' ? app.api : null;
}

/**
 * The one line under the platform's name, and it changes with the state.
 *
 * A not-connected card says what connecting GETS you (the catalogue's blurb,
 * written for the client); a card needing attention says what went wrong. Those
 * are different sentences answering different questions, and showing the blurb
 * on a broken card is how "reconnect" reads as optional.
 */
function cardMessage(card: ConnectionCard): string {
  if (card.cardState === 'needs_attention') return card.reason || 'This connection is not working.';
  return card.blurb;
}

/**
 * The platform's mark, from its catalogue `iconKey`.
 *
 * Built from the key rather than looked up in a table here, which is the same
 * promise the rest of this file makes: drop `mastodon.svg` into
 * public/images/logos/ alongside a catalogue entry whose iconKey is
 * "mastodon", and the card has its icon with nothing edited. The registry says
 * as much where it defines the field — the key is deliberately not a path, so
 * that moving the icons is a change HERE and not in the catalogue.
 *
 * The key is narrowed to the characters a filename may contain before it is
 * interpolated. A catalogue is repo content rather than user input, so this is
 * not a live injection risk today — but a value that reaches a URL should not
 * be one edit away from becoming one.
 */
function platformIconUrl(iconKey: string): string {
  const safe = String(iconKey || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return safe ? `/images/logos/${safe}.svg` : '';
}

const STATE_LABEL: Record<CardState, string> = {
  connected: 'Connected',
  not_connected: 'Not connected',
  needs_attention: 'Needs attention',
  coming_soon: 'Coming soon',
};

/**
 * One card, and nothing else.
 *
 * Split out of the panel deliberately, not for tidiness: the panel talks to
 * `window.App`, loads on mount and re-loads on reveal, so a test that renders
 * it gets the "Loading…" line and nothing to assert about. This component is
 * pure — props in, markup out — so the four states are testable as the four
 * things a client actually sees, which is the acceptance criterion this slice
 * turns on. `components/connections/connections-panel.test.tsx` renders it.
 *
 * `children` is the app-password form, which the panel owns because it holds
 * the in-flight values.
 */
export function ConnectionCardRow({
  card,
  busy,
  onConnect,
  onDisconnect,
  onPickAccount,
  children,
}: {
  card: ConnectionCard;
  busy: boolean;
  onConnect: (card: ConnectionCard) => void;
  onDisconnect: (card: ConnectionCard) => void;
  onPickAccount: (card: ConnectionCard, accountId: string) => void;
  children?: React.ReactNode;
}): JSX.Element {
  const comingSoon = card.cardState === 'coming_soon';
  const connected = card.cardState === 'connected';
  const needsAttention = card.cardState === 'needs_attention';
  const account = card.account;
  const headingId = `connectionCard-${card.provider}`;

  // A platform with no logo file yet falls back to the plain tile rather than
  // to a browser's broken-image glyph, which reads as a fault in the client's
  // account rather than as an icon we have not drawn.
  const [markFailed, setMarkFailed] = React.useState(false);
  const markUrl = platformIconUrl(card.iconKey);
  const avatarUrl = account?.accountAvatarUrl || '';

  return (
    <li
      className={`connections-card connections-card-${card.cardState}`}
      data-provider={card.provider}
      data-card-state={card.cardState}
    >
      <div className="connections-card-main">
        <div className="connections-card-identity">
          {avatarUrl || (markUrl && !markFailed)
            ? (
              <img
                className="connections-card-avatar"
                src={avatarUrl || markUrl}
                alt=""
                width={36}
                height={36}
                onError={avatarUrl ? undefined : () => setMarkFailed(true)}
              />
            )
            : <span className={`connections-card-avatar connections-card-avatar-${card.iconKey}`} aria-hidden="true" />}
          <div className="connections-card-text">
            <h4 className="connections-card-name" id={headingId}>{card.displayName}</h4>
            {connected && account && (
              <p className="connections-card-account">{account.accountLabel}</p>
            )}
            <p className="connections-card-message">{cardMessage(card)}</p>
          </div>
        </div>

        <div className="connections-card-side">
          <span className={`connections-card-badge connections-card-badge-${card.cardState}`}>
            {STATE_LABEL[card.cardState]}
          </span>
          {/* A coming-soon card has no button at all — not a disabled one.
              A greyed button still takes a Tab stop and still invites a press,
              and there is nothing behind it to press. */}
          {!comingSoon && (
            <div className="connections-card-actions">
              {connected
                ? (
                  <button
                    type="button"
                    className="btn btn-ghost connections-card-button"
                    onClick={() => onDisconnect(card)}
                    disabled={busy}
                    aria-describedby={headingId}
                  >
                    {busy ? 'Working…' : 'Disconnect'}
                  </button>
                )
                : (
                  <button
                    type="button"
                    className="btn btn-primary connections-card-button"
                    onClick={() => onConnect(card)}
                    disabled={busy}
                    aria-describedby={headingId}
                  >
                    {busy ? 'Working…' : (needsAttention ? 'Reconnect' : 'Connect')}
                  </button>
                )}
            </div>
          )}
        </div>
      </div>

      {/* A grant can cover several accounts — several Facebook Pages behind one
          sign-in. The chooser only appears when there is a real choice. */}
      {card.accounts.length > 1 && (
        <div className="connections-card-accounts">
          <label htmlFor={`connectionsAccount-${card.provider}`}>Post to</label>
          <select
            id={`connectionsAccount-${card.provider}`}
            value={account?.accountId || ''}
            disabled={busy}
            onChange={(event) => onPickAccount(card, event.target.value)}
          >
            {card.accounts.map((option) => (
              <option key={option.accountId} value={option.accountId}>
                {option.accountLabel}
              </option>
            ))}
          </select>
        </div>
      )}

      {children}
    </li>
  );
}

/**
 * The small form a platform with no consent screen asks for.
 *
 * Every field here was described by the server (GET /api/connections →
 * /start), never chosen by this file. That is what keeps the Non-goal true:
 * the screen cannot invent a box for a credential, because it does not know
 * what boxes exist until the catalogue tells it.
 */
export function AppPasswordForm({
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  pending: PendingForm;
  onChange: (name: string, value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <form className="connections-card-form" onSubmit={onSubmit}>
      <p className="connections-card-form-lead">
        {pending.displayName} has no sign-in screen, so it uses an app password you create
        yourself. It is not your account password, and you can revoke it from
        {' '}{pending.displayName} at any time.
      </p>
      {pending.fields.map((field) => {
        const inputId = `connectionsField-${pending.provider}-${field.name}`;
        return (
          <div className="form-row connections-card-form-row" key={field.name}>
            <label htmlFor={inputId}>{field.label}</label>
            <input
              id={inputId}
              type={field.type === 'password' ? 'password' : 'text'}
              value={pending.values[field.name] || ''}
              placeholder={field.placeholder || ''}
              autoComplete="off"
              aria-describedby={field.help ? `${inputId}-help` : undefined}
              onChange={(event) => onChange(field.name, event.target.value)}
            />
            {field.help && <p className="meta" id={`${inputId}-help`}>{field.help}</p>}
          </div>
        );
      })}
      {pending.error && <p className="connections-card-form-error">{pending.error}</p>}
      <div className="connections-card-form-actions">
        <button type="submit" className="btn btn-primary connections-card-button" disabled={pending.busy}>
          {pending.busy ? 'Connecting…' : `Connect ${pending.displayName}`}
        </button>
        <button
          type="button"
          className="btn btn-ghost connections-card-button"
          onClick={onCancel}
          disabled={pending.busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ConnectionsPanel(): JSX.Element {
  const [cards, setCards] = useState<ConnectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState<PendingForm | null>(null);
  const [busyProvider, setBusyProvider] = useState('');

  const hostRef = useRef<HTMLDivElement | null>(null);

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
      const res = await api(LIST_PATH, { method: 'GET' });
      const list = Array.isArray(res?.connections)
        ? res.connections
        : (Array.isArray(res?.data) ? res.data : []);
      setCards(list as ConnectionCard[]);
    } catch (err) {
      setLoadError((err as Error)?.message || 'Could not load your connections');
    } finally {
      setLoading(false);
    }
  }, []);

  // react-entry.js mounts every island at DOMContentLoaded, which is before
  // anyone has signed in — loading regardless would make this panel's first act
  // a 401 behind a screen nobody has opened. Wait for a session.
  useEffect(() => {
    if (!getApp()?.auth?.user) {
      setLoading(false);
      return;
    }
    load();
  }, [load]);

  // The vanilla shell shows and hides pages by toggling a class rather than
  // mounting them, so this component exists long before anyone looks at it.
  // Reload on reveal — which is also what refreshes the cards when a client
  // comes back from a provider's consent screen.
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

  const onConnect = async (card: ConnectionCard) => {
    const api = getAppApi();
    if (!api) return;
    setBusyProvider(card.provider);
    try {
      const res = await api(`${LIST_PATH}/${encodeURIComponent(card.provider)}/start`, { method: 'POST' });
      const data = res?.data || res;

      if (String(data?.authKind) === 'app_password') {
        const fields = (Array.isArray(data?.fields) ? data.fields : []) as StartField[];
        const values: Record<string, string> = {};
        fields.forEach((field) => { values[field.name] = ''; });
        setPending({
          provider: card.provider,
          displayName: card.displayName,
          fields,
          values,
          error: '',
          busy: false,
        });
        return;
      }

      const authorizeUrl = String(data?.authorizeUrl || '');
      if (!authorizeUrl) {
        notify(`${card.displayName} did not return a sign-in link`, true);
        return;
      }
      // A full navigation rather than a popup: a popup is blocked by default in
      // most browsers when it is not opened directly from the click, and a
      // client who sees nothing happen concludes the button is broken.
      window.location.assign(authorizeUrl);
    } catch (err) {
      notify((err as Error)?.message || `Could not start connecting ${card.displayName}`, true);
    } finally {
      setBusyProvider('');
    }
  };

  const onSubmitPending = async (event: React.FormEvent) => {
    event.preventDefault();
    const api = getAppApi();
    if (!api || !pending) return;

    const missing = pending.fields.find((field) => !String(pending.values[field.name] || '').trim());
    if (missing) {
      setPending({ ...pending, error: `${missing.label} is required` });
      return;
    }

    setPending({ ...pending, busy: true, error: '' });
    try {
      const res = await api(`${LIST_PATH}/${encodeURIComponent(pending.provider)}/finish`, {
        method: 'POST',
        body: JSON.stringify(pending.values),
      });
      const data = res?.data || res;
      notify(`${pending.displayName} connected`);
      if (data?.needsAccountChoice) {
        notify(`${pending.displayName} covers more than one account — choose which one posts.`);
      }
      setPending(null);
      await load();
    } catch (err) {
      setPending((current) => (current
        ? { ...current, busy: false, error: (err as Error)?.message || 'Could not connect' }
        : current));
    }
  };

  const onDisconnect = async (card: ConnectionCard) => {
    const api = getAppApi();
    if (!api) return;
    const who = card.account?.accountLabel || card.displayName;
    if (!window.confirm(
      `Disconnect ${who}? Starcaster stops posting to it straight away. `
      + `You can connect it again at any time.`
    )) return;

    setBusyProvider(card.provider);
    try {
      await api(`${LIST_PATH}/${encodeURIComponent(card.provider)}`, { method: 'DELETE' });
      notify(`${card.displayName} disconnected`);
      await load();
    } catch (err) {
      notify((err as Error)?.message || `Could not disconnect ${card.displayName}`, true);
    } finally {
      setBusyProvider('');
    }
  };

  const onPickAccount = async (card: ConnectionCard, accountId: string) => {
    const api = getAppApi();
    if (!api || !accountId) return;
    setBusyProvider(card.provider);
    try {
      await api(`${LIST_PATH}/${encodeURIComponent(card.provider)}/account`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      });
      await load();
    } catch (err) {
      notify((err as Error)?.message || 'Could not switch accounts', true);
    } finally {
      setBusyProvider('');
    }
  };

  return (
    <div ref={hostRef} className="connections-panel">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Your accounts</h3>
        <p className="meta">
          Connect the accounts you want Starcaster to post to. Nothing is posted without your
          say-so, and you can disconnect any of them at any time.
        </p>

        {loading && <p className="meta">Loading your connections…</p>}
        {!loading && loadError && <p className="connections-panel-error">{loadError}</p>}

        {!loading && !loadError && (
          <ul className="connections-card-list">
            {cards.map((card) => (
              <ConnectionCardRow
                key={card.provider}
                card={card}
                busy={busyProvider === card.provider}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                onPickAccount={onPickAccount}
              >
                {pending?.provider === card.provider && (
                  <AppPasswordForm
                    pending={pending}
                    onChange={(name, value) => setPending((current) => (current
                      ? { ...current, values: { ...current.values, [name]: value } }
                      : current))}
                    onSubmit={onSubmitPending}
                    onCancel={() => setPending(null)}
                  />
                )}
              </ConnectionCardRow>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
