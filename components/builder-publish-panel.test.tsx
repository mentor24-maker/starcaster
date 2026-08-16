import { describe, expect, it } from 'vitest';
import { describePending, type PublishStatus } from './builder/builder-publish-panel';

/**
 * The Publish panel's real job is the SENTENCE, not the button.
 *
 * Publishing is a step now, and a step you can forget is worse than no step:
 * without a number in front of him the operator edits all afternoon and the
 * live site silently stays where it was this morning. So the count is the
 * headline, and it has to be unambiguous in every state — including the two
 * that look alike and mean opposite things ("nothing to publish because it is
 * all live" versus "nothing to publish because there are no pages").
 */

const status = (pending: number, total: number): PublishStatus => ({
  pending,
  total,
  pages: []
});

describe('what the operator is told', () => {
  it('says how many pages are waiting', () => {
    expect(describePending(status(9, 20))).toBe('9 pages have changes that are not live yet.');
  });

  it('uses singular wording for one page', () => {
    expect(describePending(status(1, 20))).toBe('1 page has changes that are not live yet.');
  });

  it('confirms the live site matches, rather than just going quiet', () => {
    // "0 pending" with no message reads as "the panel is broken".
    expect(describePending(status(0, 20))).toBe('Everything is published. The live site matches your drafts.');
  });

  it('distinguishes an all-published site from an empty one', () => {
    expect(describePending(status(0, 0))).toBe('There are no pages to publish yet.');
    expect(describePending(status(0, 0))).not.toBe(describePending(status(0, 20)));
  });

  it('says nothing at all before the first answer arrives', () => {
    // The panel shows its own "Checking…" copy in this state; a stale or
    // invented count here would be the one way this panel actively misleads.
    expect(describePending(null)).toBe('');
  });
});
