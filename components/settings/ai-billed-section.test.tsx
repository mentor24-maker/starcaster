import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BilledView, type Billed } from './ai-billed-section';

/**
 * "What Anthropic actually billed" on Settings › AI Quota (task 86bcvj7v0).
 * Asserted on rendered markup, because the point of the section is one
 * sentence and two refusals: the warning when the bill runs well past the
 * meter, and never showing $0 for "not connected" or "could not read".
 */

function billed(overrides: Partial<Extract<Billed, { status: 'ok' }>> = {}): Billed {
  return {
    status: 'ok',
    startingAt: '2026-09-30T00:00:00.000Z',
    finishedUntil: '2026-10-30T00:00:00.000Z',
    byDay: [
      { day: '2026-10-29', costUsd: 40, finished: true },
      { day: '2026-10-30', costUsd: 1, finished: false },
    ],
    byModel: [{ model: 'claude-sonnet-5-5', costUsd: 41 }],
    totalUsd: 41,
    finishedUsd: 40,
    byKey: [{ apiKeyId: 'apikey_mini', name: 'Mac Mini OpenClaw', tokens: 1_100_000, estimatedUsd: 3, unpricedModels: [], models: { 'claude-sonnet-5-5': 1_100_000 } }],
    byKeyError: '',
    comparison: { meterUsd: 5, billedUsd: 40, unseenUsd: 35, alarm: true, meterCalls: 12, meterUnpricedCalls: 0, meterTruncated: false },
    comparisonError: '',
    readAt: '2026-10-30T15:00:00.000Z',
    cached: false,
    ...overrides,
  };
}

const view = (data: Billed) => renderToStaticMarkup(<BilledView data={data} />);

describe('What Anthropic actually billed', () => {
  it('says what the meter missed in plain words when the bill is well above it', () => {
    const html = view(billed());
    expect(html).toContain('Starcaster’s meter saw <strong>$5.00</strong>; Anthropic billed <strong>$40.00</strong>');
    expect(html).toContain('$35.00 was spent by something Starcaster cannot see.');
    expect(html).toContain('role="alert"');
  });

  it('stays quiet when the bill and the meter agree', () => {
    const html = view(billed({ comparison: { meterUsd: 38, billedUsd: 40, unseenUsd: 0, alarm: false, meterCalls: 12, meterUnpricedCalls: 0, meterTruncated: false } }));
    expect(html).toContain('Anthropic billed <strong>$40.00</strong>');
    expect(html).not.toContain('cannot see');
  });

  it('shows the bill by day, by model and by key, naming the key', () => {
    const html = view(billed());
    expect(html).toContain('Oct 29: $40.00');
    expect(html).toContain('so far (today');
    expect(html).toContain('claude-sonnet-5-5');
    expect(html).toContain('Mac Mini OpenClaw');
    expect(html).toContain('$41.00');
  });

  it('with no Admin key says "Not connected" and how to connect — never $0', () => {
    const html = view({ status: 'not-connected' });
    expect(html).toContain('Not connected.');
    expect(html).toContain('Settings › Admin keys');
    expect(html).toContain('ANTHROPIC_ADMIN_KEY');
    expect(html).not.toContain('$0');
  });

  it('a failed read says it failed and why — never $0', () => {
    const html = view({ status: 'error', message: 'Anthropic refused the read: invalid x-api-key' });
    expect(html).toContain('could not be read');
    expect(html).toContain('invalid x-api-key');
    expect(html).not.toContain('$0');
  });

  it('a meter that could not be read is said, not compared as $0', () => {
    const html = view(billed({ comparison: null, comparisonError: 'Metered Anthropic spend read failed: timeout' }));
    expect(html).toContain('cannot be compared');
    expect(html).not.toContain('meter saw');
  });

  it('tells a non-owner why the bill is not shown', () => {
    expect(view({ status: 'owner-only' })).toContain('only the platform owner');
  });
});
