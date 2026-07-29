import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The Associations panel: everything linked to one object, with add and remove.
 *
 * This is a React island inside the frozen vanilla admin screens. The host page
 * says which object is open by dispatching ASSOCIATIONS_TARGET_EVENT; the panel
 * owns everything after that. See AssociationsPanelHost at the bottom.
 */

export const ASSOCIATIONS_TARGET_EVENT = 'starcaster:associations-target';

export type ObjectRef = {
  type: string;
  id: string;
  label?: string;
};

export type LinkedItem = {
  id: number;
  object: ObjectRef;
  createdAt?: string;
};

type Candidate = {
  id: string;
  label: string;
};

type AddableType = {
  type: string;
  label: string;
  endpoint: string;
  collectionKey: string;
  labelField: string;
  keep?: (row: Record<string, unknown>) => boolean;
  emptyHint: string;
};

/**
 * What you can attach from this panel. Adding a kind later is one entry here —
 * the API and the table already accept any type in lib/associationTypes.js.
 */
const ADDABLE_TYPES: AddableType[] = [
  {
    type: 'asset',
    label: 'Images',
    endpoint: '/api/assets',
    collectionKey: 'assets',
    labelField: 'assetName',
    keep: (row) => String(row?.assetType ?? '').trim() === 'Image',
    emptyHint: 'No image assets in this project yet.',
  },
  {
    type: 'messaging_hashtags',
    label: 'Hashtags',
    endpoint: '/api/messaging/hashtags?limit=5000',
    collectionKey: 'hashtags',
    labelField: 'hashtag',
    emptyHint: 'No hashtags yet — create them in Messaging > Hashtags.',
  },
  {
    type: 'messaging_tags',
    label: 'Tags',
    endpoint: '/api/messaging/tags?limit=5000',
    collectionKey: 'tags',
    labelField: 'tag',
    emptyHint: 'No tags yet — create them in Messaging > Tags.',
  },
];

/** Group headings, in the order they should read. */
const GROUP_ORDER = ADDABLE_TYPES.map((entry) => entry.type);

const GROUP_LABELS: Record<string, string> = {
  asset: 'Images',
  messaging_hashtags: 'Hashtags',
  messaging_tags: 'Tags',
  messaging_tweets: 'Tweets',
  messaging_posts: 'Posts',
  messaging_headlines: 'Headlines',
  campaign: 'Campaigns',
  landing_page: 'Builder Pages',
};

export function groupLabel(type: string): string {
  return GROUP_LABELS[type] || type.replace(/^messaging_/, '').replace(/_/g, ' ');
}

/**
 * Buckets linked items by kind, in a stable reading order: the kinds you can
 * add from this panel come first, in the order they appear in the Add menu,
 * then anything else attached from elsewhere (the assets page can attach many
 * more types). Empty buckets are dropped.
 */
export function groupLinkedItems(linked: LinkedItem[]): { type: string; items: LinkedItem[] }[] {
  const byType = new Map<string, LinkedItem[]>();
  linked.forEach((item) => {
    const list = byType.get(item.object.type) || [];
    list.push(item);
    byType.set(item.object.type, list);
  });
  const order = [...GROUP_ORDER];
  byType.forEach((_, type) => {
    if (!order.includes(type)) order.push(type);
  });
  return order
    .map((type) => ({ type, items: byType.get(type) || [] }))
    .filter((group) => group.items.length > 0);
}

function safeText(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

/**
 * Calls go through the vanilla App.api() so they carry the session token and
 * the X-Project-ID header. A bare fetch() would lose the tenant scope.
 */
type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, unknown>>;

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: { api?: AppApi } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

async function apiCall(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const api = getAppApi();
  if (!api) throw new Error('The admin app is still loading — try again in a moment.');
  return api(path, options);
}

function readCollection(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const direct = body?.[key];
  if (Array.isArray(direct)) return direct as Record<string, unknown>[];
  const data = body?.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

export function AssociationsPanel({ self }: { self: ObjectRef | null }): React.ReactElement {
  const [linked, setLinked] = useState<LinkedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const [addType, setAddType] = useState<string>(ADDABLE_TYPES[0].type);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [search, setSearch] = useState('');

  const selfKey = self ? `${self.type}:${self.id}` : '';

  const loadLinked = useCallback(async () => {
    if (!self) {
      setLinked([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body = await apiCall(
        `/api/associations?type=${encodeURIComponent(self.type)}&id=${encodeURIComponent(self.id)}`
      );
      const rows = readCollection(body, 'associations');
      setLinked(
        rows
          .map((row) => {
            const object = (row?.object ?? null) as ObjectRef | null;
            const id = Number(row?.id ?? 0) || 0;
            if (!object || !safeText(object.type) || !safeText(object.id) || !id) return null;
            return { id, object, createdAt: safeText(row?.createdAt) } as LinkedItem;
          })
          .filter((item): item is LinkedItem => item !== null)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load associations.');
    } finally {
      setLoading(false);
    }
  }, [self]);

  useEffect(() => {
    void loadLinked();
    // selfKey rather than the object identity, so re-renders don't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfKey]);

  const activeAddable = useMemo(
    () => ADDABLE_TYPES.find((entry) => entry.type === addType) || ADDABLE_TYPES[0],
    [addType]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadCandidates() {
      setCandidatesLoading(true);
      try {
        const body = await apiCall(activeAddable.endpoint);
        const rows = readCollection(body, activeAddable.collectionKey);
        const mapped = rows
          .filter((row) => (activeAddable.keep ? activeAddable.keep(row) : true))
          .map((row) => ({
            id: safeText(row?.id),
            label: safeText(row?.[activeAddable.labelField]) || `#${safeText(row?.id)}`,
          }))
          .filter((row) => row.id);
        if (!cancelled) setCandidates(mapped);
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setCandidatesLoading(false);
      }
    }
    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [activeAddable]);

  const linkedKeys = useMemo(
    () => new Set(linked.map((item) => `${item.object.type}:${item.object.id}`)),
    [linked]
  );

  const visibleCandidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return candidates
      .filter((row) => !linkedKeys.has(`${activeAddable.type}:${row.id}`))
      .filter((row) => (needle ? row.label.toLowerCase().includes(needle) : true))
      .slice(0, 50);
  }, [candidates, linkedKeys, activeAddable.type, search]);

  const groups = useMemo(() => groupLinkedItems(linked), [linked]);

  async function addAssociation(candidate: Candidate) {
    if (!self) return;
    setBusyId(`add:${candidate.id}`);
    setError('');
    try {
      await apiCall('/api/associations', {
        method: 'POST',
        body: JSON.stringify({
          a: { type: self.type, id: self.id, label: self.label || '' },
          b: { type: activeAddable.type, id: candidate.id, label: candidate.label },
        }),
      });
      await loadLinked();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not add that association.';
      setError(/already/i.test(message) ? 'Those two are already linked.' : message);
    } finally {
      setBusyId('');
    }
  }

  async function removeAssociation(item: LinkedItem) {
    setBusyId(`remove:${item.id}`);
    setError('');
    try {
      await apiCall(`/api/associations/${encodeURIComponent(String(item.id))}`, { method: 'DELETE' });
      setLinked((rows) => rows.filter((row) => row.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that association.');
    } finally {
      setBusyId('');
    }
  }

  if (!self) {
    return (
      <div className="assoc-panel">
        <p className="assoc-panel-hint">Save this item first, then you can associate things with it.</p>
      </div>
    );
  }

  return (
    <div className="assoc-panel">
      {error ? <p className="assoc-panel-error">{error}</p> : null}

      <div className="assoc-panel-linked">
        {loading ? <p className="assoc-panel-hint">Loading…</p> : null}
        {!loading && !groups.length ? (
          <p className="assoc-panel-hint">Nothing associated yet.</p>
        ) : null}
        {groups.map((group) => (
          <section key={group.type} className="assoc-panel-group">
            <h4>{groupLabel(group.type)}</h4>
            <ul className="assoc-panel-items">
              {group.items.map((item) => (
                <li key={item.id}>
                  <span className="assoc-panel-item-label" title={item.object.label || item.object.id}>
                    {item.object.label || `#${item.object.id}`}
                  </span>
                  <button
                    type="button"
                    className="btn tiny-btn icon-btn"
                    aria-label={`Remove ${item.object.label || item.object.id}`}
                    disabled={busyId === `remove:${item.id}`}
                    onClick={() => void removeAssociation(item)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="assoc-panel-add">
        <div className="assoc-panel-add-controls">
          <label htmlFor="assocPanelType">Add</label>
          <select
            id="assocPanelType"
            value={addType}
            onChange={(event) => {
              setAddType(event.target.value);
              setSearch('');
            }}
          >
            {ADDABLE_TYPES.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            placeholder={`Search ${activeAddable.label.toLowerCase()}`}
            aria-label={`Search ${activeAddable.label.toLowerCase()}`}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <ul className="assoc-panel-candidates">
          {candidatesLoading ? <li className="assoc-panel-hint">Loading…</li> : null}
          {!candidatesLoading && !candidates.length ? (
            <li className="assoc-panel-hint">{activeAddable.emptyHint}</li>
          ) : null}
          {!candidatesLoading && candidates.length > 0 && !visibleCandidates.length ? (
            <li className="assoc-panel-hint">
              {search.trim() ? 'Nothing matches that search.' : 'All of these are already linked.'}
            </li>
          ) : null}
          {visibleCandidates.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                className="assoc-panel-candidate"
                disabled={busyId === `add:${candidate.id}`}
                onClick={() => void addAssociation(candidate)}
              >
                {candidate.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Mounts one panel and listens for the host page to name the open object.
 *
 * The vanilla screen dispatches, on the document:
 *   new CustomEvent(ASSOCIATIONS_TARGET_EVENT, {
 *     detail: { host: '<this hostId>', self: { type, id, label } | null }
 *   })
 *
 * Events addressed to another host are ignored, so several panels can coexist.
 */
export function AssociationsPanelHost({ hostId }: { hostId: string }): React.ReactElement {
  const [self, setSelf] = useState<ObjectRef | null>(null);

  useEffect(() => {
    function onTarget(event: Event) {
      const detail = (event as CustomEvent).detail as
        | { host?: string; self?: ObjectRef | null }
        | undefined;
      if (!detail || detail.host !== hostId) return;
      const next = detail.self;
      if (!next || !safeText(next.type) || !safeText(next.id)) {
        setSelf(null);
        return;
      }
      setSelf({ type: safeText(next.type), id: safeText(next.id), label: safeText(next.label) });
    }
    document.addEventListener(ASSOCIATIONS_TARGET_EVENT, onTarget);
    return () => document.removeEventListener(ASSOCIATIONS_TARGET_EVENT, onTarget);
  }, [hostId]);

  return <AssociationsPanel self={self} />;
}

export default AssociationsPanelHost;
