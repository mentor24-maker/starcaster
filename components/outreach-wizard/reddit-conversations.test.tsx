// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedditConversations, {
  DEFAULT_REDDIT_FILTERS, commentReplyLabel, commentsNote, emptyPostsText, filterPosts, rankPosts, redditSortValue, replyWord,
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

beforeEach(() => {
  posts.length = 0;
  listed = [item()];
  failNext = false;
  (window as any).App = {
    setActivePage: vi.fn(),
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return { data: { items: listed, newCount: listed.length, reading: { state: 'current', sentence: 'S.' } } };
      if (failNext) { failNext = false; throw new Error('the server said no'); }
      posts.push({ path, body: JSON.parse(String(options.body)) });
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
  await act(async () => { button('Show the comments').click(); });
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

  it('Write replies to the post, and to a comment, post the ids and open Engage › Comments', async () => {
    const onChanged = vi.fn();
    act(() => root!.render(<RedditConversations onChanged={onChanged} />));
    await flush();
    await expand();
    await act(async () => { button('Write replies').click(); });
    await flush();
    expect(posts[0]).toEqual({ path: '/api/outreach/reddit/conversations/reply', body: { postId: 'abc1' } });
    expect((window as any).App.setActivePage).toHaveBeenCalledWith('engageCommentResponsesPage');
    expect(onChanged).toHaveBeenCalled();
    await act(async () => { button("Reply to u/dave's comment").click(); });
    await flush();
    expect(posts[1].body).toEqual({ postId: 'abc1', commentId: 'c1' });
  });

  it('Save as contact sends the commenter', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    await expand();
    await act(async () => { button('Save u/dave').click(); });
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
      'Hide the comments on "How do generalists learn?"',
      'Write replies to "How do generalists learn?"',
      'Skip "How do generalists learn?"',
      'Save u/alice as a contact',
      'Open "How do generalists learn?" on Reddit',
      "Reply to u/dave's comment",
      'Save u/dave as a contact',
    ]));
  });

  it('the expand icon shows and hides the comments, and a replied comment is held with "Replied"', async () => {
    listed = [item({ topComments: [{ id: 'c1', author: 'dave', body: 'Great question', score: 40, replyStatus: 'posted' }] })];
    act(() => root!.render(<RedditConversations />));
    await flush();
    expect(container!.querySelector('tr[data-comment-id]')).toBeNull();
    await expand();
    expect(button('Hide the comments').getAttribute('aria-expanded')).toBe('true');
    const held = button('Replied');
    expect(held.disabled).toBe(true);
    expect(held.title).toBe("Replied to u/dave's comment");
    await act(async () => { button('Hide the comments').click(); });
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
    await act(async () => { button('Write replies to "How do').click(); });
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

  it('the empty sentence names every filter in force', () => {
    expect(emptyPostsText({ search: 'yoga', subreddit: 'polymath', keyword: 'generalist', reply: 'waiting' }, 4))
      .toBe("No posts in r/polymath match 'yoga' and were found by the keyword 'generalist' with a reply waiting (4 listed, all hidden by these filters).");
    expect(emptyPostsText({ ...DEFAULT_REDDIT_FILTERS, reply: 'not_replied' }, 2)).toBe('No posts without a reply (2 listed, all hidden by these filters).');
  });
});
