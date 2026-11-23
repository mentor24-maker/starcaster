// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YoutubeConversations, {
  canAct, conversationRows, cutBetweenWords, emptyConversationsText, filterConversations, readNowNotice, replyLabel,
  DEFAULT_CONVERSATION_FILTERS, type YtComment, type YtVideo,
} from './youtube-conversations';

/**
 * Outreach wizard 16/19 (86bcrmbtn). The ranking, the grouping and the server
 * refusals are tested with the server code (scripts/builder/youtubeConversations.test.js).
 * What is tested here: each comment shows who wrote it and why it ranked, Write
 * replies sends THAT comment's id and stays on the Outreach screen (SC-916), a
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

async function render(props: { onChanged?: () => void; onDrafted?: () => void } = {}) {
  await act(async () => { root!.render(<YoutubeConversations {...props} />); });
}

/** A button by its text, or a row icon by the start of its accessible label (SC-888). */
function button(label: string, within: ParentNode = container!): HTMLButtonElement {
  const all = [...within.querySelectorAll('button')];
  const found = all.find((b) => b.textContent === label) || all.find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
  if (!found) throw new Error(`no "${label}" button`);
  return found as HTMLButtonElement;
}

describe('YouTube Find conversations', () => {
  it('shows each comment under its video with who wrote it and why it ranked', async () => {
    await render();
    const item = container!.querySelector('[data-comment-id="Ugz1"]')!;
    expect(item.querySelector('.yt-conversation-author a')!.getAttribute('href')).toBe('https://www.youtube.com/@ann');
    expect(item.textContent).toContain('Ann Viewer');
    expect(item.querySelector('.yt-conversation-rank')!.getAttribute('title')).toBe('Asks a question nobody has answered yet, posted 3 hours ago.');
    expect(item.querySelector('.yt-conversation-video-cell')!.textContent).toContain('A video');
  });

  it('Write replies sends the comment id clicked, stays on this screen, shows Write replies and re-reads the stage', async () => {
    const onChanged = vi.fn();
    const onDrafted = vi.fn();
    await render({ onChanged, onDrafted });
    await act(async () => { button('Write replies').click(); });
    expect(posts).toEqual([{ path: '/api/outreach/youtube/conversations/reply', body: { commentId: 'Ugz1' } }]);
    // SC-916: the main button of Find conversations never opens another screen.
    expect((window as any).App.setActivePage).not.toHaveBeenCalled();
    expect(onDrafted).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalled();
    expect(container!.textContent).toContain('in Write replies below');
    expect(container!.textContent).not.toMatch(/outreach screen|Engage ›/);
  });

  it('Comment on the video and Save as contact send what they act on', async () => {
    await render();
    await act(async () => { button('Comment on the video').click(); });
    await act(async () => { button('Save as Contact').click(); });
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
    const bobWrite = button('Write replies', bob);
    expect(bobWrite.disabled).toBe(true);
    // The held button says why on its tooltip, and the sentence shows once,
    // under the first of the video's rows.
    expect(bobWrite.title).toContain('waiting for approval');
    expect(container!.querySelectorAll('[data-blocked]').length).toBe(1);
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
  it('every row action is a square icon naming its row; no text buttons or links remain in rows', async () => {
    await render();
    const row = container!.querySelector('[data-comment-id="Ugz1"]')!;
    const actions = [...row.querySelectorAll('button, td.actions-col a')];
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.classList.contains('outreach-row-icon')).toBe(true);
      expect(a.getAttribute('aria-label')).toBeTruthy();
      expect(a.getAttribute('title')).toBe(a.getAttribute('aria-label'));
      expect(a.textContent).toBe('');
    }
    expect(row.querySelector('[aria-label="Open Comment on YouTube: Ann Viewer"]')!.getAttribute('href')).toContain('lc=Ugz1');
    expect(row.querySelector('[aria-label^="Comment on the video"]')).toBeTruthy();
  });

  it('a failed Write replies shows on a full-width line directly under its row', async () => {
    listed = [video({ comments: [comment(), comment({ commentId: 'Ugz2', author: { name: 'Bob', channelUrl: '', channelId: '' }, score: 10 })] })];
    (window as any).App.api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (!options) return { data: { videos: listed, newCount: 2, reading: { state: 'current', sentence: 'S.' }, skippedCount: 0, commentedCount: 0 } };
      throw new Error('YouTube said no');
    });
    await render();
    const bob = container!.querySelector('[data-comment-id="Ugz2"]')!;
    await act(async () => { button('Write replies', bob).click(); });
    const next = bob.nextElementSibling!;
    expect(next.querySelector('[role="alert"]')!.textContent).toBe('No replies written: YouTube said no');
    expect((next.querySelector('td') as HTMLTableCellElement).colSpan).toBe(8);
  });

  it('rows default to best rank first, and Likes and Posted sort both ways', async () => {
    listed = [
      video({ comments: [
        comment({ commentId: 'a', score: 40, likes: 9, postedAt: '2026-10-28T10:00:00Z' }),
        comment({ commentId: 'b', score: 90, likes: 1, postedAt: '2026-10-28T12:00:00Z' }),
      ] }),
      video({ videoId: 'vid00000002', title: 'B video', comments: [comment({ commentId: 'c', videoId: 'vid00000002', score: 60, likes: 5, postedAt: '2026-10-27T12:00:00Z' })] }),
    ];
    await render();
    const order = () => [...container!.querySelectorAll('tr[data-comment-id]')].map((r) => r.getAttribute('data-comment-id'));
    expect(order()).toEqual(['b', 'c', 'a']);
    const head = (key: string) => container!.querySelector(`th[data-sort-key="${key}"]`) as HTMLElement;
    await act(async () => { head('likes').click(); });
    expect(order()).toEqual(['a', 'c', 'b']);
    await act(async () => { head('likes').click(); });
    expect(order()).toEqual(['b', 'c', 'a']);
    await act(async () => { head('posted').click(); });
    expect(order()).toEqual(['b', 'a', 'c']);
    await act(async () => { head('posted').click(); });
    expect(order()).toEqual(['c', 'a', 'b']);
  });

  it('the Video filter shows only that video\'s comments, and an empty result names the filter', async () => {
    listed = [
      video({ comments: [comment({ commentId: 'a' })] }),
      video({ videoId: 'vid00000002', title: 'B video', comments: [comment({ commentId: 'c', videoId: 'vid00000002', text: 'Nice' })] }),
    ];
    await render();
    const select = container!.querySelector('select[aria-label="Video"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'vid00000002';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect([...container!.querySelectorAll('tr[data-comment-id]')].map((r) => r.getAttribute('data-comment-id'))).toEqual(['c']);
    const reply = container!.querySelector('select[aria-label="Reply"]') as HTMLSelectElement;
    await act(async () => {
      reply.value = 'waiting';
      reply.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container!.querySelector('[data-empty-filter]')!.textContent).toBe("No comments on 'B video' with a reply waiting.");
  });
});

describe('Find conversations filters', () => {
  const vids = [
    video({ comments: [
      comment({ commentId: 'none' }),
      comment({ commentId: 'draft', replyStatus: 'draft', text: 'Tennis question', author: { name: 'Zed', channelUrl: '', channelId: '' } }),
      comment({ commentId: 'posted', replyStatus: 'posted' }),
    ] }),
    video({ videoId: 'vid00000002', title: 'B', channel: { id: 'cr2', channelId: 'UC2', name: 'Channel B', url: '' }, comments: [comment({ commentId: 'other', videoId: 'vid00000002' })] }),
  ];
  const rows = conversationRows(vids);
  const ids = (f: Partial<typeof DEFAULT_CONVERSATION_FILTERS>) => filterConversations(rows, { ...DEFAULT_CONVERSATION_FILTERS, ...f }).map((r) => r.key);

  it('Reply: Not replied hides a reply waiting or posted; Waiting keeps only those waiting', () => {
    expect(ids({ reply: 'not_replied' })).toEqual(['none', 'other']);
    expect(ids({ reply: 'waiting' })).toEqual(['draft']);
    expect(ids({ reply: 'all' })).toEqual(['none', 'draft', 'posted', 'other']);
  });

  it('search covers comment text and author; Channel and Video narrow to theirs', () => {
    expect(ids({ search: 'tennis' })).toEqual(['draft']);
    expect(ids({ search: 'zed' })).toEqual(['draft']);
    expect(ids({ channel: 'cr2' })).toEqual(['other']);
    expect(ids({ video: 'vid00000001' })).toEqual(['none', 'draft', 'posted']);
  });

  it('a video with no comments still has a row, so Comment on the video stays reachable', () => {
    expect(conversationRows([video({ comments: [] })]).map((r) => r.key)).toEqual(['video:vid00000001']);
  });

  it('an empty result names every filter in force', () => {
    expect(emptyConversationsText({ ...DEFAULT_CONVERSATION_FILTERS, search: 'yoga', channel: 'cr2', reply: 'not_replied' }, vids))
      .toBe("No comments match 'yoga' on Channel B's videos without a reply waiting or posted.");
    expect(emptyConversationsText(DEFAULT_CONVERSATION_FILTERS, vids)).toBe('No comments.');
  });

  it('a long comment is cut between words, never through one', () => {
    const cut = cutBetweenWords('one two three four five', 14);
    expect(cut).toBe('one two three…');
    expect(cutBetweenWords('short', 14)).toBe('short');
    expect(cutBetweenWords('Supercalifragilistic', 5)).toBe('Supercalifragilistic');
  });
});
