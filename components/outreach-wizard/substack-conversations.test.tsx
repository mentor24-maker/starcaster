// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubstackConversations, { replyLabel, replyNotice, type Conversation } from './substack-conversations';

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
let replyAnswer: Record<string, any> = { data: { drafted: true } };
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  reads = 0;
  replyAnswer = { data: { drafted: true } };
  (window as any).App = {
    setActivePage: vi.fn(),
    api: vi.fn(async (path: string, options?: RequestInit) => {
      if (!options) {
        reads += 1;
        return { data: { items: [note()], newCount: 1, reading: { state: 'current', sentence: 'S.' }, skippedCount: 0 } };
      }
      if (path.endsWith('/reply')) return replyAnswer;
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

async function render(props: { onChanged?: () => void; version?: string }) {
  await act(async () => { root!.render(<SubstackConversations {...props} />); });
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`no "${label}" button`);
  return found as HTMLButtonElement;
}

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
  });

  it('Add writer and Write replies ask the wizard to re-read the stage sentence', async () => {
    const onChanged = vi.fn();
    await render({ onChanged });
    await act(async () => { button('Add writer').click(); });
    expect(onChanged).toHaveBeenCalledTimes(1);
    replyAnswer = { data: { drafted: false } };
    await act(async () => { button('Write replies').click(); });
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(container!.textContent).toContain('Already drafted');
  });

  it('a new overview re-reads the list in place, keeping its notice', async () => {
    await render({ version: 'a' });
    await act(async () => { button('Add writer').click(); });
    const before = reads;
    await render({ version: 'b' });
    expect(reads).toBe(before + 1);
    expect(container!.textContent).toContain('Ann is approved');
  });
});
