import { describe, expect, it } from 'vitest';
import { replyLabel, type Conversation } from './substack-conversations';

/**
 * Outreach wizard 14/19 (86bcrmbqu). The headline ("N new Notes worth replying
 * to" / "Cannot tell") is the stage's sentence, tested with the server code
 * that writes it (scripts/builder/substackConversations.test.js).
 */

describe('Find conversations', () => {
  it('picks up a reply already drafted rather than writing a second', () => {
    const c = { replyStatus: 'draft' } as Conversation;
    expect(replyLabel(c)).toBe('Open the replies');
    expect(replyLabel({ ...c, replyStatus: '' })).toBe('Write replies');
    expect(replyLabel({ ...c, replyStatus: 'idea' })).toBe('Write replies');
  });
});
