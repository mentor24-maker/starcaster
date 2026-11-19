// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YoutubeConversations, { canAct, readNowNotice, replyLabel, type YtComment, type YtVideo } from './youtube-conversations';

/**
 * Outreach wizard 16/19 (86bcrmbtn). The ranking, the grouping and the server
 * refusals are tested with the server code (scripts/builder/youtubeConversations.test.js).
 * What is tested here: each comment shows who wrote it and why it ranked, Write
 * replies sends THAT comment's id and opens the YouTube outreach screen, a
 * video waiting on one reply holds its others, and every change asks the
 * wizard to re-read the stage sentence above the list.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function comment(over: Partial<YtComment> = {}): YtComment {
  return {
    commentId: 'Ugz1',
    videoId: 'vid00000001',
    url: 'https://www.youtube.com/watch?v=vid00000001&lc=Ugz1',
    text: 'Where does attention go?',
    postedAt: '2026-10-28T12:00:00Z',
    likes: 4,
    replies: 0,
    score: 60,
    reason: 'Asks a question nobody has answered yet, posted 3 hours ago.',
    replyStatus: '',
    author: { name: 'Ann Viewer', channelUrl: 'https://www.youtube.com/@ann', channelId: '' },
    ...over,
  };
}

function video(over: Partial<YtVideo> = {}): YtVideo {
  return {
    videoId: 'vid00000001',
    videoUrl: 'https://www.youtube.com/watch?v=vid00000001',
    title: 'A video',
    publishedAt: '2026-10-27T12:00:00Z',
    commentsDisabled: false,
    channel: { id: 'cr1', channelId: 'UC', name: 'Channel A', url: 'https://www.youtube.com/@a' },
    targetId: '',
    state: 'open',
    blocked: '',
    waitingOn: '',
    replyStatus: '',
    comments: [comment()],
    ...over,
  };
}

let listed: YtVideo[] = [];
let posts: Array<{ path: string; body: any }> = [];
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  listed = [video()];
  posts = [];
  (window as any).App = {
    setActivePage: vi.fn(),
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) return { data: { videos: listed, newCount: 1, reading: { state: 'current', sentence: 'S.' }, skippedCount: 0, commentedCount: 0 } };
      posts.push({ path, body: JSON.parse(String(options.body || '{}')) });
      if (path.endsWith('/contact')) return { data: { mode: 'created' } };
      return { data: { drafted: true } };
    }),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  delete (window as any).App;
});

async function render(props: { onChanged?: () => void } = {}) {
  await act(async () => { root!.render(<YoutubeConversations {...props} />); });
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`no "${label}" button`);
  return found as HTMLButtonElement;
}

describe('YouTube Find conversations', () => {
  it('shows each comment under its video with who wrote it and why it ranked', async () => {
    await render();
    const item = container!.querySelector('[data-comment-id="Ugz1"]')!;
    expect(item.querySelector('a')!.getAttribute('href')).toBe('https://www.youtube.com/@ann');
    expect(item.textContent).toContain('Ann Viewer');
    expect(item.querySelector('.outreach-conversation-why')!.textContent).toBe('Asks a question nobody has answered yet, posted 3 hours ago.');
    expect(container!.querySelector('[data-video-id="vid00000001"]')!.textContent).toContain('A video');
  });

  it('Write replies sends the comment id clicked, opens the YouTube outreach screen and re-reads the stage', async () => {
    const onChanged = vi.fn();
    await render({ onChanged });
    await act(async () => { button('Write replies').click(); });
    expect(posts).toEqual([{ path: '/api/outreach/youtube/conversations/reply', body: { commentId: 'Ugz1' } }]);
    expect((window as any).App.setActivePage).toHaveBeenCalledWith('engageYoutubeOutreachPage');
    expect(onChanged).toHaveBeenCalled();
  });

  it('Comment on the video and Save as contact send what they act on', async () => {
    await render();
    await act(async () => { button('Comment on the video').click(); });
    await act(async () => { button('Save as contact').click(); });
    expect(posts.map((p) => [p.path.split('/').pop(), p.body])).toEqual([['video', { videoId: 'vid00000001' }], ['contact', { commentId: 'Ugz1' }]]);
    expect(container!.textContent).toContain('Ann Viewer is saved to your contacts');
  });

  it('a video waiting on one reply holds its other buttons and says why', async () => {
    listed = [video({
      state: 'waiting', waitingOn: 'Ugz1', blocked: "A reply to Ann Viewer's comment is waiting for approval.",
      comments: [comment({ replyStatus: 'draft' }), comment({ commentId: 'Ugz2', author: { name: 'Bob', channelUrl: '', channelId: '' } })],
    })];
    await render();
    expect(container!.querySelector('[data-blocked]')!.textContent).toContain('waiting for approval');
    expect(button('Open the replies').disabled).toBe(false);
    const bob = container!.querySelector('[data-comment-id="Ugz2"]')!;
    expect((bob.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(button('Comment on the video').disabled).toBe(true);
  });

  it('labels and holds follow the video state', () => {
    expect(replyLabel('draft')).toBe('Open the replies');
    expect(replyLabel('', true)).toBe('Comment on the video');
    expect(canAct(video({ state: 'paused' }), 'Ugz1')).toBe(false);
    expect(canAct(video({ state: 'waiting', waitingOn: 'video' }), 'video')).toBe(true);
  });

  it('Read now holds itself while the read runs, then reloads the list and says what it read (SC-880)', async () => {
    let finish: (v: unknown) => void = () => {};
    const api = (window as any).App.api;
    const lists = () => api.mock.calls.filter((c: unknown[]) => !c[1]).length;
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (!options) return { data: { videos: listed, newCount: 1, reading: { state: 'not_read_yet', sentence: 'S.' }, skippedCount: 0, commentedCount: 0 } };
      posts.push({ path, body: JSON.parse(String(options.body || '{}')) });
      return new Promise((r) => { finish = r; });
    });
    const onChanged = vi.fn();
    await render({ onChanged });
    const before = lists();
    await act(async () => { button('Read now').click(); });
    const busy = button('Reading…');
    expect(busy.disabled).toBe(true);
    await act(async () => { busy.click(); });
    expect(posts).toEqual([{ path: '/api/outreach/youtube/conversations/read-now', body: {} }]);
    await act(async () => {
      finish({ data: { channels: 3, read: 3, comments: 44, failed: [], notReached: [], quota: null } });
    });
    expect(button('Read now').disabled).toBe(false);
    expect(lists()).toBe(before + 1);
    expect(onChanged).toHaveBeenCalled();
    expect(container!.textContent).toContain('Read 3 channels: 44 comments.');
  });

  it('Read now names each failure by channel, and a used-up quota with its time', () => {
    expect(readNowNotice({
      channels: 2, read: 1, comments: 4, failed: [{ channel: 'Channel B', error: 'YouTube did not list the uploads.' }], notReached: [], quota: null,
    })).toBe('Read 1 channel: 4 comments. Channel B was not read: YouTube did not list the uploads.');
    expect(readNowNotice({
      channels: 2, read: 0, comments: 0, failed: [], notReached: [{ channel: 'Channel B', reason: 'quota' }], quota: { resetsAt: '2026-11-19T08:00:00.000Z' },
    })).toBe("Read 0 channels: 0 comments. YouTube's quota is used up until Nov 19, 1:00am, so 2 channels could not be read.");
  });

  it('Read now says the channel list could not be read, never "no approved channels" over a failure', () => {
    const said = readNowNotice({
      channels: 0, read: 0, comments: 0, failed: [{ channel: '', error: 'the approved channels could not be read: connection refused' }], notReached: [], quota: null,
    });
    expect(said).toContain('The channel list was not read: the approved channels could not be read: connection refused');
    expect(said).not.toContain('no approved channels');
    expect(readNowNotice({ channels: 0, read: 0, comments: 0, failed: [], notReached: [], quota: null }))
      .toBe('There are no approved channels to read. Approve channels in Find creators first.');
  });
});
