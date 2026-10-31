import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MiniLimitLine, type MiniLimit } from './mini-ai-limit';

/**
 * The Mini's daily AI limit on Settings › AI Quota (AI Quota 5/5, task
 * 86bcvj7zw). It must say when the limit stopped the Mini, and never draw a
 * count it could not read as "0 used".
 */

function reading(overrides: Partial<Extract<MiniLimit, { status: 'ok' }>> = {}): MiniLimit {
  return {
    status: 'ok',
    day: '2026-10-30',
    limit: 40,
    used: 12,
    reached: false,
    reachedAt: null,
    resetsAt: '2026-10-31T06:00:00.000Z',
    sentence: '',
    limitSource: 'saved',
    byJob: { 'starcaster:openclaw-smoke': 9, 'starcaster:reddit-watch': 3 },
    ...overrides,
  };
}

describe('Mini AI limit reading', () => {
  it('says how much of today is used, by job', () => {
    const html = renderToStaticMarkup(<MiniLimitLine reading={reading()} />);
    expect(html).toContain('<strong>12</strong> of its 40 AI requests');
    expect(html).toContain('openclaw-smoke 9, reddit-watch 3');
  });

  it('leads with the stopped sentence once the limit is reached', () => {
    const sentence = "Stopped for today: the Mini's AI limit (40 requests) was reached at 3:12 AM.";
    const html = renderToStaticMarkup(<MiniLimitLine reading={reading({ used: 40, reached: true, reachedAt: '2026-10-30T09:12:00.000Z', sentence })} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Stopped for today: the Mini&#x27;s AI limit (40 requests) was reached at 3:12 AM.');
  });

  it('a count it could not read is an alert, never "0 used"', () => {
    const html = renderToStaticMarkup(<MiniLimitLine reading={{ status: 'error', message: 'database down' }} />);
    expect(html).toContain('could not be read');
    expect(html).toContain('do not run');
    expect(html).not.toContain('of its');
  });
});
