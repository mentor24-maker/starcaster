// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RedditConversations, { commentsNote, type RedditConversation } from './reddit-conversations';

/**
 * Outreach wizard 18/19 (86bcrmbwm). The headline — how many, or "the Mini is
 * signed out" — is the stage's sentence, tested with the server code that
 * writes it (scripts/builder/redditWatch.test.js). Tested here: every item
 * shows why it ranked and the subreddit's promotion rule, the comments carry
 * their authors, and each action posts what the server expects.
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

beforeEach(() => {
  posts.length = 0;
  (window as any).App = {
    setActivePage: vi.fn(),
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return { data: { items: [item()], newCount: 1, reading: { state: 'current', sentence: 'S.' } } };
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

function button(label: string): HTMLButtonElement {
  const b = [...container!.querySelectorAll('button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button "${label}"`);
  return b as HTMLButtonElement;
}

describe('RedditConversations', () => {
  it('shows why it ranked, the promotion rule, and the strongest comment with its author', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    const text = container!.textContent || '';
    expect(text).toContain('Found by your keyword "generalist"');
    expect(text).toContain("r/polymath's self-promotion rule:");
    expect(text).toContain('No self-promotion more than 1 in 10.');
    expect(text).toContain('u/dave');
    expect(text).toContain('Great question');
  });

  it('Write replies to the post, and to a comment, post the ids and open Engage › Comments', async () => {
    const onChanged = vi.fn();
    act(() => root!.render(<RedditConversations onChanged={onChanged} />));
    await flush();
    await act(async () => { button('Write replies').click(); });
    await flush();
    expect(posts[0]).toEqual({ path: '/api/outreach/reddit/conversations/reply', body: { postId: 'abc1' } });
    expect((window as any).App.setActivePage).toHaveBeenCalledWith('engageCommentResponsesPage');
    expect(onChanged).toHaveBeenCalled();
    await act(async () => { button('Reply to this comment').click(); });
    await flush();
    expect(posts[1].body).toEqual({ postId: 'abc1', commentId: 'c1' });
  });

  it('Save as contact sends the commenter', async () => {
    act(() => root!.render(<RedditConversations />));
    await flush();
    await act(async () => { button('Save as contact').click(); });
    await flush();
    expect(posts[0]).toEqual({ path: '/api/outreach/reddit/conversations/contact', body: { postId: 'abc1', author: 'dave' } });
    expect(container!.textContent).toContain('u/dave saved as a contact.');
  });

  it('says when comments were not read yet rather than implying there are none', () => {
    expect(commentsNote(item({ topComments: [], commentsReadAt: null, numComments: 4 }))).toMatch(/4 comments; not read yet/);
    expect(commentsNote(item({ topComments: [], commentsReadAt: '2026-10-28T13:00:00Z', numComments: 0 }))).toMatch(/first/);
  });
});
