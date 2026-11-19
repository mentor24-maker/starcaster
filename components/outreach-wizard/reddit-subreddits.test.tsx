// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedditSubreddits, {
  DEFAULT_SUBREDDIT_FILTERS,
  emptySubredditsText,
  filterSubreddits,
  readText,
  subredditSortValue,
  suggestSummary,
  type Subreddit,
} from './reddit-subreddits';
import { sortRows } from './outreach-table';

/** Outreach wizard 18/19 (86bcrmbwm): Reddit's Find creators — the subreddits the Mini watches. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sub(over: Partial<Subreddit> = {}): Subreddit {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'polymath',
    status: 'candidate',
    suggestedBy: 'ai',
    why: 'Generalists talk here.',
    promotionRule: '',
    lastReadState: '',
    lastReadAt: null,
    lastReadError: '',
    lastReadSeen: 0,
    lastReadKept: 0,
    ...over,
  };
}

const posts: Array<{ path: string; body: any }> = [];
let list: Subreddit[] = [];
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  posts.length = 0;
  list = [sub()];
  (window as any).App = {
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return { data: list };
      const body = JSON.parse(String(options.body));
      posts.push({ path, body });
      if (path.endsWith('/decide')) return { data: { ...list[0], status: body.status } };
      if (path.endsWith('/suggest')) return { data: { added: [sub()], kept: [], keywords: 2, canonDocs: 3 } };
      return { data: { added: [], kept: [], refused: [] } };
    }),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function button(label: string): HTMLButtonElement {
  // A row action is an icon: it is found by its accessible label, which
  // names the row (SC-890). Other buttons still by their text.
  const b = [...container!.querySelectorAll('button')].find((x) => x.textContent === label || x.getAttribute('aria-label') === label);
  if (!b) throw new Error(`no button "${label}"`);
  return b as HTMLButtonElement;
}

function rowNames(): string[] {
  return [...container!.querySelectorAll('tr.reddit-sub-row')].map((tr) => tr.getAttribute('data-subreddit') || '');
}

function setStatusFilter(value: string) {
  const select = container!.querySelector('select[aria-label="Status"]') as HTMLSelectElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('RedditSubreddits', () => {
  it('Find subreddits for my topics asks the server and says what came back', async () => {
    const onChanged = vi.fn();
    act(() => root!.render(<RedditSubreddits onChanged={onChanged} />));
    await flush();
    await act(async () => { button('Find subreddits for my topics').click(); });
    await flush();
    expect(posts[0].path).toBe('/api/outreach/reddit/subreddits/suggest');
    expect(container!.textContent).toContain('1 new subreddit suggested from 2 keywords and 3 canon documents.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('Approve sends the decision for that subreddit', async () => {
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    expect(container!.textContent).toContain('Generalists talk here.');
    await act(async () => { button('Approve r/polymath').click(); });
    await flush();
    expect(posts[0]).toEqual({ path: '/api/outreach/reddit/subreddits/11111111-1111-1111-1111-111111111111/decide', body: { status: 'approved' } });
  });

  it('an approved subreddit says what its last read found, signed out included, and its promotion rule', async () => {
    list = [sub({ status: 'approved', lastReadState: 'signed_out', lastReadAt: '2026-10-28T12:00:00Z', promotionRule: 'No links to your own blog.' })];
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    expect(container!.textContent).toContain('signed out of Reddit');
    expect(container!.textContent).toContain('No links to your own blog.');
    expect(readText(sub({ status: 'approved' }))).toMatch(/Not read yet/);
    expect(suggestSummary({ added: [], kept: ['x'], keywords: 1, canonDocs: 0 })).toMatch(/already on your list/);
  });

  it('Approving a suggested subreddit moves it to Watching without a reload', async () => {
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    const reads = (window as any).App.api.mock.calls.filter((c: any[]) => !c[1]).length;
    await act(async () => { button('Approve r/polymath').click(); });
    await flush();
    const row = container!.querySelector('tr[data-subreddit="polymath"]')!;
    expect(row.getAttribute('data-status')).toBe('approved');
    expect(row.querySelector('.reddit-sub-status')!.textContent).toBe('Watching');
    expect((window as any).App.api.mock.calls.filter((c: any[]) => !c[1]).length).toBe(reads);
    // Its own outcome sits directly under it.
    expect(row.nextElementSibling?.getAttribute('data-row-message')).toBe('polymath');
    expect(row.nextElementSibling?.textContent).toContain('r/polymath approved');
  });

  it('every row action is a square icon with a label naming the row; no text buttons or links in rows', async () => {
    list = [sub(), sub({ id: '22222222-2222-2222-2222-222222222222', name: 'philosophy', status: 'approved' })];
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    const actions = [...container!.querySelectorAll('tr.reddit-sub-row td.actions-col')].flatMap((td) => [...td.querySelectorAll('button, a')]);
    expect(actions.length).toBe(5);
    for (const el of actions) {
      expect(el.classList.contains('icon-btn')).toBe(true);
      expect(el.textContent).toBe('');
      expect(el.getAttribute('title')).toBe(el.getAttribute('aria-label'));
      expect(el.getAttribute('aria-label')).toMatch(/r\/(polymath|philosophy)/);
    }
    expect(actions.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Approve r/polymath', 'Reject r/polymath', 'Open r/polymath on Reddit',
      'Stop Watching r/philosophy', 'Open r/philosophy on Reddit',
    ]);
    expect([...container!.querySelectorAll('button')].some((b) => /Show rejected/.test(b.textContent || ''))).toBe(false);
  });

  it('Status opens on Suggested + Watching; Rejected shows only the rejected ones; an empty result names the filter', async () => {
    list = [
      sub(),
      sub({ id: '22222222-2222-2222-2222-222222222222', name: 'philosophy', status: 'approved' }),
      sub({ id: '33333333-3333-3333-3333-333333333333', name: 'spam', status: 'rejected' }),
    ];
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    expect(rowNames()).toEqual(['polymath', 'philosophy']);
    setStatusFilter('rejected');
    expect(rowNames()).toEqual(['spam']);
    setStatusFilter('approved');
    expect(rowNames()).toEqual(['philosophy']);
    setStatusFilter('all');
    expect(rowNames()).toEqual(['polymath', 'philosophy', 'spam']);
    list = [sub()];
    act(() => root!.unmount());
    root = createRoot(container!);
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    setStatusFilter('rejected');
    expect(container!.querySelector('[data-empty-filter]')!.textContent).toBe('No rejected subreddits.');
  });

  it('a failed decision says so under its own row', async () => {
    (window as any).App.api = vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return { data: list };
      throw new Error('r/polymath changed while you were deciding — reload the list.');
    });
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    await act(async () => { button('Reject r/polymath').click(); });
    await flush();
    const message = container!.querySelector('tr[data-row-message="polymath"]')!;
    expect(message.previousElementSibling?.getAttribute('data-subreddit')).toBe('polymath');
    expect(message.querySelector('[role="alert"]')!.textContent).toContain('was not saved: r/polymath changed');
  });

  it('a decision that moves its row out of the filter still shows its message', async () => {
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    await act(async () => { button('Reject r/polymath').click(); });
    await flush();
    expect(rowNames()).toEqual([]);
    expect(container!.querySelector('[data-row-message-hidden]')!.textContent).toBe('r/polymath rejected.');
  });

  it('the list read failing says so above the table', async () => {
    (window as any).App.api = vi.fn(async () => { throw new Error('Reddit table missing'); });
    act(() => root!.render(<RedditSubreddits />));
    await flush();
    expect(container!.querySelector('[role="alert"]')!.textContent).toBe('The subreddit list could not be read: Reddit table missing');
  });
});

describe('subreddit table helpers', () => {
  const a = sub({ id: 'a', name: 'zen', status: 'approved', lastReadState: 'read', lastReadAt: '2026-11-10T10:00:00Z' });
  const b = sub({ id: 'b', name: 'Alpha', status: 'candidate' });
  const c = sub({ id: 'c', name: 'mid', status: 'rejected', lastReadState: 'failed', lastReadAt: '2026-11-12T10:00:00Z' });

  it('sorts by subreddit, status and last read (never read goes last both ways)', () => {
    expect(sortRows([a, b, c], { key: 'subreddit', dir: 'asc' }, subredditSortValue).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(sortRows([a, b, c], { key: 'status', dir: 'asc' }, subredditSortValue).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows([a, b, c], { key: 'lastRead', dir: 'desc' }, subredditSortValue).map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(sortRows([a, b, c], { key: 'lastRead', dir: 'asc' }, subredditSortValue).map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('filters by text (an r/ prefix is ignored) and by each status', () => {
    const f = DEFAULT_SUBREDDIT_FILTERS;
    expect(filterSubreddits([a, b, c], f).map((s) => s.id)).toEqual(['a', 'b']);
    expect(filterSubreddits([a, b, c], { ...f, status: 'candidate' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSubreddits([a, b, c], { ...f, status: 'approved' }).map((s) => s.id)).toEqual(['a']);
    expect(filterSubreddits([a, b, c], { ...f, status: 'rejected' }).map((s) => s.id)).toEqual(['c']);
    expect(filterSubreddits([a, b, c], { ...f, status: 'all' }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(filterSubreddits([a, b, c], { search: 'r/AL', status: 'all' }).map((s) => s.id)).toEqual(['b']);
  });

  it('an empty result names every filter in force', () => {
    expect(emptySubredditsText(DEFAULT_SUBREDDIT_FILTERS)).toBe('No suggested or watched subreddits.');
    expect(emptySubredditsText({ search: 'yoga', status: 'rejected' })).toBe("No rejected subreddits match 'yoga'.");
    expect(emptySubredditsText({ search: '', status: 'all' })).toBe('No subreddits.');
  });
});
