import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiQuotaView, windowCost, type AiQuota } from './ai-quota-page';
import { spendSummaryText } from '../observe/ai-spend-summary';

/**
 * Settings › AI Quota (task 86bcvj7k9). Asserted on rendered markup from props,
 * because the page itself talks to window.App. The Oct 28-30, 2026 overnight
 * spend was invisible because the panel never said what it could not see —
 * so most of these assert what the page ADMITS, not just what it adds up.
 */

const MINI_JOB = {
  id: 'reddit-watch',
  name: 'Reddit watch',
  machine: 'Mac Mini',
  runner: 'OpenClaw browser',
  cadence: 'every 4 hours',
  model: 'claude-sonnet-5-5',
  metered: false,
  meterNote: 'not metered yet',
};

function quota(overrides: Partial<AiQuota> = {}): AiQuota {
  return {
    since: '2026-09-30T00:00:00Z',
    totalUsd: 12.5,
    totalTokens: 1000,
    pricedCalls: 4,
    unpricedCalls: 0,
    complete: true,
    truncated: false,
    byFeature: [{ feature: 'theme_wizard', calls: 4, tokens: 1000, costUsd: 12.5, fullyPriced: true, models: { 'claude-sonnet-5-5': 4 } }],
    byModel: [{ provider: 'anthropic', model: 'claude-sonnet-5-5', calls: 4, tokens: 1000, costUsd: 12.5, fullyPriced: true }],
    unpriced: [],
    recent: {
      last24h: { costUsd: 1.25, calls: 1, unpricedCalls: 0, covered: true },
      last7d: { costUsd: 5, calls: 2, unpricedCalls: 0, covered: true },
    },
    jobs: [
      { id: 'website:theme_wizard', name: 'theme_wizard', machine: 'Website (Vercel)', runner: 'Starcaster', cadence: '4 calls in the last 30 days', model: 'claude-sonnet-5-5', metered: true, meterNote: 'metered' },
      MINI_JOB,
    ],
    ratesChecked: '2026-10-30',
    ...overrides,
  };
}

const view = (data: AiQuota) => renderToStaticMarkup(<AiQuotaView data={data} />);

describe('AiQuotaView', () => {
  it('shows today, 7-day and 30-day totals', () => {
    const html = view(quota());
    expect(html).toContain('Today (last 24 hours)');
    expect(html).toContain('$1.25');
    expect(html).toContain('Last 7 days');
    expect(html).toContain('$5.00');
    expect(html).toContain('Last 30 days');
    expect(html).toContain('$12.50');
  });

  it('prices Sonnet 5.5 in the by-model table instead of calling it incomplete', () => {
    const html = view(quota());
    expect(html).toContain('claude-sonnet-5-5');
    expect(html).not.toContain('incomplete — no price');
  });

  it('marks an unpriced model, and leads with an incomplete banner', () => {
    const html = view(quota({
      complete: false,
      unpricedCalls: 1,
      unpriced: [{ provider: 'gemini', model: 'gemini-2.5-pro', calls: 1, tokens: 10, reason: 'no rate table entered' }],
      byModel: [{ provider: 'gemini', model: 'gemini-2.5-pro', calls: 1, tokens: 10, costUsd: 0, fullyPriced: false }],
    }));
    expect(html).toContain('These totals are incomplete.');
    expect(html.indexOf('These totals are incomplete.')).toBeLessThan(html.indexOf('Today (last 24 hours)'));
    expect(html).toContain('incomplete — no price');
  });

  it('lists the Mini jobs as not metered, and says the totals leave them out', () => {
    const html = view(quota());
    expect(html).toContain('Reddit watch');
    expect(html).toContain('not metered yet');
    expect(html).toContain('not in these totals');
  });

  it('shows a metered Mini job’s calls today, this week and its cost (AI Quota 3/5)', () => {
    const watched = {
      ...MINI_JOB,
      metered: true,
      meterNote: 'metered',
      usage: {
        calls: 9, failedCalls: 2, unpricedCalls: 0, costUsd: 0.9,
        last24h: { calls: 3, costUsd: 0.3, unpricedCalls: 0 },
        last7d: { calls: 7, costUsd: 0.7, unpricedCalls: 0 },
      },
    };
    const html = view(quota({ jobs: [watched] }));
    expect(html).toContain('3 today · 7 this week');
    expect(html).toContain('$0.70 this week');
    expect(html).toContain('2 failed in 30 days');
    expect(html).not.toContain('not metered yet');
    expect(html).not.toContain('not in these totals');
  });

  it('never shows calls without token counts as $0', () => {
    const blind = {
      ...MINI_JOB,
      metered: true,
      meterNote: 'metered',
      usage: {
        calls: 2, failedCalls: 0, unpricedCalls: 2, costUsd: 0,
        last24h: { calls: 2, costUsd: 0, unpricedCalls: 2 },
        last7d: { calls: 2, costUsd: 0, unpricedCalls: 2 },
      },
    };
    const html = view(quota({ jobs: [blind] }));
    expect(html).toContain('cost unknown this week');
    expect(html).not.toContain('$0.00 this week');
    expect(windowCost({ calls: 0, costUsd: 0, unpricedCalls: 0 })).toBe('$0.00');
    expect(windowCost({ calls: 3, costUsd: 0.5, unpricedCalls: 1 })).toBe('$0.50 + unpriced');
    // A fraction of a cent is not free.
    expect(windowCost({ calls: 1, costUsd: 0.0037, unpricedCalls: 0 })).toBe('under $0.01');
  });

  it('says why no website features are listed when none ran', () => {
    const html = view(quota({ byFeature: [], byModel: [], jobs: [MINI_JOB], pricedCalls: 0, totalUsd: 0 }));
    expect(html).toContain('made no AI calls in the last 30 days');
    expect(html).toContain('each appears here the first time it runs');
  });

  it('never shows a short-window total the read did not reach', () => {
    const html = view(quota({
      recent: {
        last24h: { costUsd: 0, calls: 0, unpricedCalls: 0, covered: true },
        last7d: { costUsd: 0, calls: 0, unpricedCalls: 0, covered: false },
      },
    }));
    expect(html).toContain('not read');
  });
});

describe('spendSummaryText (Observe)', () => {
  it('says when the figure is partial', () => {
    expect(spendSummaryText({ totalUsd: 3, complete: false, pricedCalls: 2, unpricedCalls: 1 }))
      .toBe('AI spend, last 30 days: $3.00 (incomplete — some calls could not be priced) across 3 AI calls.');
    expect(spendSummaryText({ totalUsd: 3, complete: true, pricedCalls: 1, unpricedCalls: 0 }))
      .toBe('AI spend, last 30 days: $3.00 across 1 AI call.');
  });
});
