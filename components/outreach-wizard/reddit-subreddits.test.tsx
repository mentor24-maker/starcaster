// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedditSubreddits, { readText, suggestSummary, type Subreddit } from './reddit-subreddits';

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
  const b = [...container!.querySelectorAll('button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button "${label}"`);
  return b as HTMLButtonElement;
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
    await act(async () => { button('Approve').click(); });
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
});
