// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubstackConversations, {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  conversationSortValue,
  cutBetweenWords,
  emptyFilterText,
  filterConversations,
  READ_NOTES_PATH,
  readNowNotice,
  readRefusal,
  replyLabel,
  replyNotice,
  type Conversation,
} from './substack-conversations';
import { sortRows } from './outreach-table';

/**
 * Outreach wizard 14/19 (86bcrmbqu). The headline ("N new Notes worth replying
 * to" / "Cannot tell") is the stage's sentence, tested with the server code
 * that writes it (scripts/builder/substackConversations.test.js). What is
 * tested here is that the list asks the wizard to re-read that sentence after
 * every change, so the count above the list never disagrees with it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function note(over: Partial<Conversation> = {}): Conversation {
  return {
    url: 'https://substack.com/@ann/note/c-1',
    text: 'A Note about attention.',
    postedAt: '2026-10-27T12:00:00Z',
    foundAt: '2026-10-27T12:00:00Z',
    keyword: 'attention',
    approved: false,
    score: 5,
    reason: 'Found by "attention".',
    replyItemId: '',
    replyStatus: '',
    writer: { id: 'w1', handle: 'ann', name: 'Ann', status: 'candidate', publicationUrl: '' },
    author: { handle: 'ann', profileUrl: 'https://substack.com/@ann' },
    ...over,
  };
}

let reads = 0;
let listed: Conversation[] = [note()];
let failReply = false;
let replyAnswer: Record<string, any> = { data: { drafted: true } };
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  reads = 0;
  replyAnswer = { data: { drafted: true } };
  listed = [note()];
  failReply = false;
  (window as any).App = {
    setActivePage: vi.fn(),
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) {
        reads += 1;
        return { data: { items: listed, newCount: listed.length, reading: { state: 'current', sentence: 'S.' }, skippedCount: 0 } };
      }
      if (path.endsWith('/reply')) {
        if (failReply) throw new Error('Substack did not answer');
        return replyAnswer;
      }
      return { data: {} };
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

async function render(props: { onChanged?: () => void; onDrafted?: () => void; version?: string }) {
  await act(async () => { root!.render(<SubstackConversations {...props} />); });
}

/** A row action, found by the start of its accessible label ("Write replies to Ann's Note"). */
function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
  if (!found) throw new Error(`no "${label}" button`);
  return found as HTMLButtonElement;
}

function bodyRows(): HTMLTableRowElement[] {
  return [...container!.querySelectorAll('.substack-conversations-table tbody tr.substack-conversation-row')] as HTMLTableRowElement[];
}

async function choose(label: string, value: string) {
  const select = container!.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  if (!select) throw new Error(`no "${label}" filter`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const ann = note();
const bea = note({
  url: 'https://substack.com/@bea/note/c-2', text: 'On slow mornings.', postedAt: '2026-10-29T12:00:00Z', keyword: 'mornings',
  approved: true, score: 9, replyStatus: 'draft', replyItemId: 'r2',
  writer: { id: 'w2', handle: 'bea', name: 'Bea', status: 'approved', publicationUrl: 'https://bea.substack.com' },
  author: { handle: 'bea', profileUrl: 'https://substack.com/@bea' },
});
const cal = note({
  url: 'https://substack.com/@cal/note/c-3', text: 'Undated, found by a search.', postedAt: '', keyword: 'attention',
  approved: true, score: 2, replyStatus: '',
  writer: { id: 'w3', handle: 'cal', name: 'Cal', status: 'approved', publicationUrl: 'https://cal.substack.com' },
  author: { handle: 'cal', profileUrl: 'https://substack.com/@cal' },
});

describe('Find conversations', () => {
  it('picks up a reply already drafted rather than writing a second', () => {
    const c = { replyStatus: 'draft' } as Conversation;
    expect(replyLabel(c)).toBe('Open the replies');
    expect(replyLabel({ ...c, replyStatus: '' })).toBe('Write replies');
    expect(replyLabel({ ...c, replyStatus: 'idea' })).toBe('Write replies');
  });

  it('says "Already drafted" when the server wrote nothing, never "Replies written"', () => {
    const c = note();
    expect(replyNotice(c, { data: { drafted: false } })).toMatch(/^Already drafted/);
    expect(replyNotice(c, { data: { drafted: true } })).toMatch(/^Replies written for Ann's Note/);
    // SC-916: both point at Write replies on this screen, never another screen.
    for (const drafted of [true, false]) {
      expect(replyNotice(c, { data: { drafted } })).toContain('in Write replies below');
      expect(replyNotice(c, { data: { drafted } })).not.toMatch(/Notes screen|Engage ›/);
    }
  });

  it('Add writer and Write replies ask the wizard to re-read the stage sentence', async () => {
    const onChanged = vi.fn();
    const onDrafted = vi.fn();
    await render({ onChanged, onDrafted });
    await act(async () => { button('Add Writer').click(); });
    expect(onChanged).toHaveBeenCalledTimes(1);
    replyAnswer = { data: { drafted: false } };
    await act(async () => { button('Write replies').click(); });
    expect(onChanged).toHaveBeenCalledTimes(2);
    // SC-916: Write replies stays on the Outreach screen and shows Write replies there.
    expect((window as any).App.setActivePage).not.toHaveBeenCalled();
    expect(onDrafted).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain('Already drafted');
  });

  it('a new overview re-reads the list in place, keeping its notice', async () => {
    await render({ version: 'a' });
    await act(async () => { button('Add Writer').click(); });
    const before = reads;
    await render({ version: 'b' });
    expect(reads).toBe(before + 1);
    expect(container!.textContent).toContain('Ann is approved');
  });

  it('a failed Write replies shows its message in a full-width line directly under that row', async () => {
    listed = [ann, bea];
    failReply = true;
    await render({});
    await act(async () => { button("Write replies to Ann").click(); });
    const annRow = bodyRows().find((r) => r.textContent!.includes('Ann'))!;
    const next = annRow.nextElementSibling as HTMLTableRowElement;
    expect(next.className).toBe('substack-conversation-message-row');
    expect((next.querySelector('td') as HTMLTableCellElement).colSpan).toBe(8);
    expect(next.textContent).toContain('No replies written: Substack did not answer');
  });
});

describe('Find conversations as a table (SC-889)', () => {
  it('rows default to best rank first', async () => {
    listed = [ann, bea, cal];
    await render({});
    expect(bodyRows().map((r) => r.getAttribute('data-score'))).toEqual(['9', '5', '2']);
  });

  it('Posted sorts both ways, and an undated Note stays last in both', () => {
    const newest = sortRows([ann, bea, cal], { key: 'posted', dir: 'desc' }, conversationSortValue);
    expect(newest.map((c) => c.writer.name)).toEqual(['Bea', 'Ann', 'Cal']);
    const oldest = sortRows([ann, bea, cal], { key: 'posted', dir: 'asc' }, conversationSortValue);
    expect(oldest.map((c) => c.writer.name)).toEqual(['Ann', 'Bea', 'Cal']);
  });

  it('clicking Posted sorts newest first, then flips', async () => {
    listed = [ann, bea, cal];
    await render({});
    const posted = container!.querySelector('th[data-sort-key="posted"]') as HTMLElement;
    await act(async () => { posted.click(); });
    expect(bodyRows().map((r) => r.getAttribute('data-score'))).toEqual(['9', '5', '2']);
    await act(async () => { posted.click(); });
    expect(bodyRows().map((r) => r.getAttribute('data-score'))).toEqual(['5', '9', '2']);
    expect(posted.getAttribute('aria-sort')).toBe('ascending');
  });

  it('Writer and Keyword sort by name', () => {
    expect(sortRows([bea, cal, ann], { key: 'writer', dir: 'asc' }, conversationSortValue).map((c) => c.writer.name)).toEqual(['Ann', 'Bea', 'Cal']);
    expect(sortRows([bea, cal, ann], { key: 'keyword', dir: 'asc' }, conversationSortValue).map((c) => c.keyword)).toEqual(['attention', 'attention', 'mornings']);
    expect(DEFAULT_SORT).toEqual({ key: 'rank', dir: 'desc' });
  });

  it('Writers = Approved only hides Notes from writers not approved', async () => {
    listed = [ann, bea, cal];
    await render({});
    await choose('Writers', 'approved');
    expect(bodyRows().map((r) => r.getAttribute('data-approved'))).toEqual(['true', 'true']);
    expect(container!.querySelector('tbody')!.textContent).not.toContain('Ann');
  });

  it('Keyword keeps only the Notes that keyword found', async () => {
    listed = [ann, bea, cal];
    await render({});
    await choose('Keyword', 'mornings');
    expect(bodyRows().map((r) => r.getAttribute('data-score'))).toEqual(['9']);
  });

  it('Writer keeps only that writer, and search matches the Note text', () => {
    expect(filterConversations([ann, bea, cal], { ...DEFAULT_FILTERS, writer: 'cal' }).map((c) => c.writer.name)).toEqual(['Cal']);
    expect(filterConversations([ann, bea, cal], { ...DEFAULT_FILTERS, search: 'slow MORN' }).map((c) => c.writer.name)).toEqual(['Bea']);
  });

  it('Reply: Not replied and Waiting split the list', () => {
    expect(filterConversations([ann, bea, cal], { ...DEFAULT_FILTERS, reply: 'not_replied' }).map((c) => c.writer.name)).toEqual(['Ann', 'Cal']);
    expect(filterConversations([ann, bea, cal], { ...DEFAULT_FILTERS, reply: 'waiting' }).map((c) => c.writer.name)).toEqual(['Bea']);
  });

  it('an empty filtered result names the filters and the cause', async () => {
    listed = [ann];
    await render({});
    await choose('Writers', 'approved');
    const empty = container!.querySelector('[data-empty-filter]')!;
    expect(empty.textContent).toBe('No Notes from approved writers. Notes a keyword found from writers you have not approved are hidden; set Writers to All to see them.');
    expect(emptyFilterText({ ...DEFAULT_FILTERS, keyword: 'yoga', reply: 'waiting' })).toBe("No Notes found by 'yoga' with a reply waiting. Clear a filter to see the rest.");
  });

  it('every row action is a square icon with a label naming the row; no text buttons or links remain', async () => {
    listed = [ann, bea];
    await render({});
    for (const row of bodyRows()) {
      const actions = row.querySelector('td.actions-col')!;
      const controls = [...actions.querySelectorAll('a, button')];
      expect(controls.length).toBeGreaterThan(0);
      for (const el of controls) {
        expect(el.classList.contains('outreach-row-icon')).toBe(true);
        expect(el.getAttribute('title')).toBe(el.getAttribute('aria-label'));
        expect(el.textContent).toBe('');
      }
    }
    const beaLabels = [...bodyRows()[0].querySelectorAll('td.actions-col [aria-label]')].map((e) => e.getAttribute('aria-label'));
    // Bea is approved: no Add writer; her reply is drafted, so it is picked up.
    expect(beaLabels).toEqual(["Open the replies to Bea's Note", "Skip Bea's Note", "Open Bea's Note on Substack"]);
    expect(container!.querySelector('.outreach-conversations-list')).toBeNull();
  });

  it('cuts a long Note between words', () => {
    const long = 'word '.repeat(60).trim();
    const cut = cutBetweenWords(long, 40);
    expect(cut.endsWith('word…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cutBetweenWords('short', 40)).toBe('short');
    expect(cutBetweenWords('x'.repeat(100), 40)).toHaveLength(40);
  });
});

describe('Read now (SC-882)', () => {
  function readNowButton(): HTMLButtonElement {
    const found = [...container!.querySelectorAll('button')].find((b) => /^(Read now|Reading…)$/.test(b.textContent || ''));
    if (!found) throw new Error('no Read now button');
    return found;
  }

  it('reads the project, says "Reading…" and refuses a second press while it runs, then reloads the list and says what it read', async () => {
    let finish: (v: unknown) => void = () => {};
    const api = (window as any).App.api;
    const base = api.getMockImplementation();
    let posts = 0;
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === READ_NOTES_PATH) {
        posts += 1;
        await new Promise((r) => { finish = r; });
        return { data: { approved: 3, read: [{ name: 'Ann', notes: 3 }, { name: 'Bo', notes: 2 }], skipped: [], failed: [{ name: 'Cy', reason: 'their Notes answered HTTP 429' }], notReached: [] } };
      }
      return base(path, options);
    });
    const onChanged = vi.fn();
    await render({ onChanged });
    expect(reads).toBe(1);
    await act(async () => { readNowButton().click(); });
    expect(readNowButton().textContent).toBe('Reading…');
    expect(readNowButton().disabled).toBe(true);
    await act(async () => { readNowButton().click(); });
    expect(posts).toBe(1);
    await act(async () => { finish(null); });
    expect(posts).toBe(1);
    expect(reads).toBe(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(readNowButton().textContent).toBe('Read now');
    expect(container!.textContent).toContain('Read 2 writers, 5 Notes. Cy was not read: their Notes answered HTTP 429.');
  });

  it('a refusal outside the active hours is a calm notice naming the hours, not an error', async () => {
    const api = (window as any).App.api;
    const base = api.getMockImplementation();
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === READ_NOTES_PATH) {
        const err = new Error('Not reading now — the Substack account is active between 8am and 10pm (America/Denver), and the reading runs in the same hours. Run it again then.');
        (err as any).status = 409;
        throw err;
      }
      return base(path, options);
    });
    await render({});
    await act(async () => { readNowButton().click(); });
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(container!.querySelector('[role="status"]')?.textContent).toMatch(/active between 8am and 10pm/);
  });

  it('any other refusal is an error that says it did not read', () => {
    const err = new Error('Too many requests');
    (err as any).status = 429;
    expect(readRefusal(err)).toEqual({ calm: false, message: 'Not read: Too many requests' });
  });

  it('the notice counts writers left until next week, so "Read 0 writers" is never unexplained', () => {
    expect(readNowNotice({ approved: 2, read: [], skipped: [{ name: 'Ann' }, { name: 'Bo' }], failed: [], notReached: [] }))
      .toBe('Read 0 writers, 0 Notes. 2 writers read in the last 7 days were left until next week.');
    expect(readNowNotice(null)).toMatch(/did not say what it read/);
  });
});
