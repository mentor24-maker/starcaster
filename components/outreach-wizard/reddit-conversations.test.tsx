// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedditConversations, {
  DEFAULT_REDDIT_FILTERS, readRequestNote, readRequestHolds, agoText, READ_REQUEST_POLL_MS, commentReplyLabel, commentsNote, emptyPostsText, filterPosts, rankPosts, redditSortValue, replyWord,
  type RedditConversation,
} from './reddit-conversations';
import { sortRows } from './outreach-table';

/**
 * Outreach wizard 18/19 (86bcrmbwm). The headline — how many, or "the Mini is
 * signed out" — is the stage's sentence, tested with the server code that
 * writes it (scripts/builder/redditWatch.test.js). Tested here: every item
 * shows why it ranked and the subreddit's promotion rule, the comments carry
 * their authors, and each action posts what the server expects. Since SC-891
 * the list is a table: every action is a square icon found by its label, a
 * post's comments sit behind its expand icon, and the sort and each filter
 * are tested on their own.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(over: Partial<RedditConversation> = {}): RedditConversation {
  return {
    postId: 'abc1',
    subreddit: 'polymath',
    url: 'https://www.reddit.com/r/polymath/comments/abc1/',
    title: 'How do generalists learn?',
    body: 'Asking for a friend.',
    author: 'alice',
    postedAt: '2026-10-28T12:00:00Z',
    score: 12,
    numComments: 8,
    keyword: 'generalist',
    topComments: [{ id: 'c1', author: 'dave', body: 'Great question', score: 40 }],
    commentsReadAt: '2026-10-28T13:00:00Z',
    promotionRule: 'No self-promotion more than 1 in 10.',
    replyItemId: '',
    replyStatus: '',
    reason: 'Found by your keyword "generalist", posted 3 hours ago.',
    ...over,
  };
}

const posts: Array<{ path: string; body: any }> = [];
let container: HTMLDivElement | null = null;
let root: Root | null = null;
let listed: RedditConversation[] = [];
let failNext = false;
let requestedAt: string | null = null;
let stale = false;
let listCalls = 0;

beforeEach(() => {
  posts.length = 0;
  listed = [item()];
  failNext = false;
  requestedAt = null;
  stale = false;
  listCalls = 0;
  (window as any).App = {
    setActivePage: vi.fn(),
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) {
        listCalls += 1;
        return { data: { items: listed, newCount: listed.length, reading: { state: 'current', sentence: 'S.' }, readRequest: { ok: true, requestedAt, stale } } };
      }
      if (failNext) { failNext = false; throw new Error('the server said no'); }
      posts.push({ path, body: JSON.parse(String(options.body)) });
      if (path.endsWith('/read-now') && (!requestedAt || stale)) { requestedAt = new Date().toISOString(); stale = false; }
      return { data: { drafted: true, created: true } };
    }),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** A row icon, by the start of its accessible label ("Write replies to …"). */
function button(label: string): HTMLButtonElement {
  const b = [...container!.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(label));
  if (!b) throw new Error(`no button "${label}"`);
  return b as HTMLButtonElement;
}

async function expand() {
  await act(async () => { button('Show the Comments').click(); });
}

function postIds(): string[] {
  return [...container!.querySelectorAll('tr[data-post-id]')].map((r) => r.getAttribute('data-post-id') || '');
}

describe('RedditConversations', () => {
  it('shows why it ranked, the promotion rule, and the strongest comment with its author', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    expect(container!.querySelector('[data-col="rank"]')!.getAttribute('title')).toContain('Found by your keyword "generalist"');
    expect(container!.textContent).not.toContain('Great question');
    await expand();
    const text = container!.textContent || '';
    expect(text).toContain("r/polymath's self-promotion rule:");
    expect(text).toContain('No self-promotion more than 1 in 10.');
    expect(text).toContain('u/dave');
    expect(text).toContain('Great question');
  });

  it('Write replies to the post, and to a comment, post the ids and stay on this screen', async () => {
    const onChanged = vi.fn();
    const onDrafted = vi.fn();
    act(() => root!.render(<RedditConversations onChanged={onChanged} onDrafted={onDrafted} />));
    await flush();
    await expand();
    await act(async () => { button('Write Replies').click(); });
    await flush();
    expect(posts[0]).toEqual({ path: '/api/outreach/reddit/conversations/reply', body: { postId: 'abc1' } });
    // SC-916: the main button of Find conversations never opens another screen.
    expect((window as any).App.setActivePage).not.toHaveBeenCalled();
    expect(onDrafted).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalled();
    expect(container!.textContent).toContain('in Write replies below');
    expect(container!.textContent).not.toContain('Engage › Comments');
    await act(async () => { button("Reply to dave's Comment").click(); });
    await flush();
    expect(posts[1].body).toEqual({ postId: 'abc1', commentId: 'c1' });
  });

  it('Save as contact sends the commenter', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    await expand();
    await act(async () => { button('Save dave').click(); });
    await flush();
    expect(posts[0]).toEqual({ path: '/api/outreach/reddit/conversations/contact', body: { postId: 'abc1', author: 'dave' } });
    expect(container!.textContent).toContain('u/dave saved as a contact.');
  });

  it('a comment button follows the reply to that comment, not the post reply', () => {
    const c = { id: 'c1', author: 'dave', body: 'x', score: 1 };
    expect(commentReplyLabel(c)).toBe('Reply to this comment');
    expect(commentReplyLabel({ ...c, replyStatus: 'draft' })).toBe('Open the replies');
    expect(commentReplyLabel({ ...c, replyStatus: 'posted' })).toBe('Replied');
  });

  it('says when comments were not read yet rather than implying there are none', () => {
    expect(commentsNote(item({ topComments: [], commentsReadAt: null, numComments: 4 }))).toMatch(/4 comments; not read yet/);
    expect(commentsNote(item({ topComments: [], commentsReadAt: '2026-10-28T13:00:00Z', numComments: 0 }))).toMatch(/first/);
  });

  it('every row action is a square icon whose label names the row; no text buttons remain', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    await expand();
    const buttons = [...container!.querySelectorAll('tbody button, tbody a.tiny-btn')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.classList.contains('outreach-row-icon')).toBe(true);
      expect(b.textContent).toBe('');
      expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
    }
    const labels = buttons.map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining([
      'Hide the Comments on "How do generalists learn?"',
      'Write Replies to "How do generalists learn?"',
      'Skip "How do generalists learn?"',
      'Save alice as a Contact',
      'Open "How do generalists learn?" on Reddit',
      "Reply to dave's Comment",
      'Save dave as a Contact',
    ]));
  });

  it('the expand icon shows and hides the comments, and a replied comment is held with "Replied"', async () => {
    listed = [item({ topComments: [{ id: 'c1', author: 'dave', body: 'Great question', score: 40, replyStatus: 'posted' }] })];
    act(() => root!.render(<RedditConversations />));
    await flush();
    expect(container!.querySelector('tr[data-comment-id]')).toBeNull();
    await expand();
    expect(button('Hide the Comments').getAttribute('aria-expanded')).toBe('true');
    const held = button('Replied');
    expect(held.disabled).toBe(true);
    expect(held.title).toBe("Replied to dave's Comment");
    await act(async () => { button('Hide the Comments').click(); });
    expect(container!.querySelector('tr[data-comment-id]')).toBeNull();
  });

  it('says why a post shows no comments once expanded', async () => {
    listed = [item({ topComments: [], commentsReadAt: null, numComments: 4 })];
    act(() => root!.render(<RedditConversations />));
    await flush();
    await expand();
    expect(container!.querySelector('[data-comments-note]')!.textContent).toMatch(/4 comments; not read yet/);
  });

  it("a failed Write replies shows its message on a full-width line directly under that row", async () => {
    listed = [item(), item({ postId: 'abc2', title: 'Second post' })];
    failNext = true;
    act(() => root!.render(<RedditConversations />));
    await flush();
    await act(async () => { button('Write Replies to "How do').click(); });
    await flush();
    const message = container!.querySelector('tr[data-row-message]') as HTMLTableRowElement;
    expect(message.textContent).toBe('No replies written: the server said no');
    expect((message.previousElementSibling as HTMLElement).getAttribute('data-post-id')).toBe('abc1');
    expect((message.querySelector('td') as HTMLTableCellElement).colSpan).toBe(10);
  });

  it('opens on best rank first, and Score sorts high-to-low then low-to-high', async () => {
    listed = [item({ postId: 'best', redditScore: 5 }), item({ postId: 'mid', redditScore: 90 }), item({ postId: 'low', redditScore: 30 })];
    act(() => root!.render(<RedditConversations />));
    await flush();
    expect(postIds()).toEqual(['best', 'mid', 'low']);
    const score = container!.querySelector('th[data-sort-key="score"]') as HTMLElement;
    await act(async () => { score.click(); });
    expect(postIds()).toEqual(['mid', 'low', 'best']);
    expect(score.getAttribute('aria-sort')).toBe('descending');
    await act(async () => { score.click(); });
    expect(postIds()).toEqual(['best', 'low', 'mid']);
  });

  it('an empty filtered table names the filter and how many it hid', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    const search = container!.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'yoga');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container!.querySelector('[data-empty-filter]')!.textContent).toBe("No posts match 'yoga' (1 listed, all hidden by these filters).");
  });
});

describe('Reddit conversations table helpers', () => {
  const rows = rankPosts([
    item({ postId: 'a', subreddit: 'polymath', keyword: 'generalist', redditScore: 3, numComments: 50, postedAt: '2026-11-01T00:00:00Z', title: 'Learning many things', body: '' }),
    item({ postId: 'b', subreddit: 'philosophy', keyword: 'nonduality', redditScore: 70, numComments: 2, postedAt: '2026-11-10T00:00:00Z', title: 'Who am I?', body: 'A question about yoga', replyStatus: 'draft' }),
    item({ postId: 'c', subreddit: 'Polymath', keyword: 'Generalist', redditScore: 20, numComments: 9, postedAt: '', title: 'Third', body: '', replyStatus: 'idea' }),
  ]);
  const ids = (list: { post: RedditConversation }[]) => list.map((r) => r.post.postId);
  const only = (over: Partial<typeof DEFAULT_REDDIT_FILTERS>) => ids(filterPosts(rows, { ...DEFAULT_REDDIT_FILTERS, ...over }));

  it('Comments, Posted and Subreddit sort; a post with no date goes last either way', () => {
    expect(ids(sortRows(rows, { key: 'comments', dir: 'desc' }, redditSortValue))).toEqual(['a', 'c', 'b']);
    expect(ids(sortRows(rows, { key: 'comments', dir: 'asc' }, redditSortValue))).toEqual(['b', 'c', 'a']);
    expect(ids(sortRows(rows, { key: 'posted', dir: 'desc' }, redditSortValue))).toEqual(['b', 'a', 'c']);
    expect(ids(sortRows(rows, { key: 'posted', dir: 'asc' }, redditSortValue))).toEqual(['a', 'b', 'c']);
    expect(ids(sortRows(rows, { key: 'subreddit', dir: 'asc' }, redditSortValue))).toEqual(['b', 'a', 'c']);
    expect(ids(sortRows(rows, { key: 'rank', dir: 'desc' }, redditSortValue))).toEqual(['c', 'b', 'a']);
  });

  it('search reads the title and the body', () => {
    expect(only({ search: 'learning' })).toEqual(['a']);
    expect(only({ search: 'YOGA' })).toEqual(['b']);
  });

  it('Subreddit and Keyword match ignoring case', () => {
    expect(only({ subreddit: 'polymath' })).toEqual(['a', 'c']);
    expect(only({ keyword: 'generalist' })).toEqual(['a', 'c']);
    expect(only({ subreddit: 'polymath', keyword: 'nonduality' })).toEqual([]);
  });

  it('Reply: Not replied keeps posts with nothing written; Waiting keeps a draft', () => {
    expect(only({ reply: 'not_replied' })).toEqual(['a', 'c']);
    expect(only({ reply: 'waiting' })).toEqual(['b']);
    expect(only({ reply: 'all' })).toEqual(['a', 'b', 'c']);
    expect(replyWord('')).toBe('none');
    expect(replyWord('idea')).toBe('none');
    expect(replyWord('draft')).toBe('draft — waiting');
    expect(replyWord('posted')).toBe('posted');
  });

  it('Read now asks the Mini once, then says so and holds itself (SC-883)', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    const readNow = () => [...container!.querySelectorAll('button')].find((b) => /Read now|Read asked for/.test(b.textContent || '')) as HTMLButtonElement;
    expect(readNow().textContent).toBe('Read now');
    expect(readNow().disabled).toBe(false);
    await act(async () => { readNow().click(); });
    await flush();
    expect(posts).toEqual([{ path: '/api/outreach/reddit/conversations/read-now', body: {} }]);
    expect(container!.textContent).toContain('Asked the Mini to read just now. It picks this up within about 10 minutes.');
    expect(readNow().textContent).toBe('Read asked for');
    expect(readNow().disabled).toBe(true);
    await act(async () => { readNow().click(); });
    await flush();
    expect(posts.length).toBe(1);
  });

  it('Read now that fails says why, and a request that could not be read is not shown as none', async () => {
    failNext = true;
    act(() => root!.render(<RedditConversations />));
    await flush();
    const readNow = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Read now') as HTMLButtonElement;
    await act(async () => { readNow.click(); });
    await flush();
    expect(container!.querySelector('[role="alert"]')!.textContent).toBe('Not asked: the server said no');
    expect(readRequestNote({ ok: false, requestedAt: null, error: 'table missing' })).toBe('Cannot tell whether a read is already waiting: table missing');
    expect(readRequestNote({ ok: true, requestedAt: null })).toBe('');
    expect(readRequestNote(undefined)).toBe('');
  });

  it('a request the Mini has not picked up in 20 minutes says so plainly, and a press asks again (SC-883 review)', async () => {
    requestedAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    stale = true;
    act(() => root!.render(<RedditConversations />));
    await flush();
    const readNow = () => [...container!.querySelectorAll('button')].find((b) => /Read now|Read asked for/.test(b.textContent || '')) as HTMLButtonElement;
    expect(container!.textContent).toContain('Asked the Mini to read 25 minutes ago, and it has not picked this up. Its Read now check may not be running');
    expect(container!.textContent).toContain('scripts/install_reddit_watch.sh --status');
    expect(readNow().textContent).toBe('Read now');
    expect(readNow().disabled).toBe(false);
    await act(async () => { readNow().click(); });
    await flush();
    expect(posts.map((p) => p.path)).toEqual(['/api/outreach/reddit/conversations/read-now']);
    expect(readNow().textContent).toBe('Read asked for');
  });

  it('while a request waits the list reloads, so a read the Mini finished frees the button (SC-883 review)', async () => {
    vi.useFakeTimers();
    try {
      requestedAt = new Date().toISOString();
      act(() => root!.render(<RedditConversations />));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const readNow = () => [...container!.querySelectorAll('button')].find((b) => /Read now|Read asked for/.test(b.textContent || '')) as HTMLButtonElement;
      expect(readNow().textContent).toBe('Read asked for');
      const before = listCalls;
      requestedAt = null; // the Mini read it and cleared the request
      await act(async () => { await vi.advanceTimersByTimeAsync(READ_REQUEST_POLL_MS); });
      expect(listCalls).toBeGreaterThan(before);
      expect(readNow().textContent).toBe('Read now');
      expect(readNow().disabled).toBe(false);
      // With nothing waiting, it stops reloading.
      const settled = listCalls;
      await act(async () => { await vi.advanceTimersByTimeAsync(READ_REQUEST_POLL_MS * 3); });
      expect(listCalls).toBe(settled);
    } finally { vi.useRealTimers(); }
  });

  it('a read the Mini could not start says why and lets a press ask again', () => {
    const now = Date.parse('2026-11-19T20:30:00Z');
    const failed = { ok: true, requestedAt: null, stale: false, failedWhy: 'There are no keywords.', failedAt: '2026-11-19T20:20:00Z' };
    expect(readRequestNote(failed, now)).toBe('The Mini tried to read 10 minutes ago and could not start: There are no keywords. Press Read now to ask again.');
    expect(readRequestHolds(failed)).toBe(false);
    expect(readRequestHolds({ ok: true, requestedAt: '2026-11-19T20:25:00Z', stale: false })).toBe(true);
    expect(readRequestHolds({ ok: true, requestedAt: '2026-11-19T20:00:00Z', stale: true })).toBe(false);
    expect(agoText('2026-11-19T18:30:00Z', now)).toBe('2 hours ago');
    expect(agoText('nope', now)).toBe('');
  });

  it('the empty sentence names every filter in force', () => {
    expect(emptyPostsText({ search: 'yoga', subreddit: 'polymath', keyword: 'generalist', reply: 'waiting' }, 4))
      .toBe("No posts in r/polymath match 'yoga' and were found by the keyword 'generalist' with a reply waiting (4 listed, all hidden by these filters).");
    expect(emptyPostsText({ ...DEFAULT_REDDIT_FILTERS, reply: 'not_replied' }, 2)).toBe('No posts without a reply (2 listed, all hidden by these filters).');
  });
});
