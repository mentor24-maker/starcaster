import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlarmView, type Alarm } from './ai-spend-alarm-section';

/**
 * "Spending alarm" on Settings › AI Quota (task 86bcvj7zm). The section's job
 * is to say what the last check saw and which spend it read — and never to
 * show $0 when the check could not read the spend, or a working alarm when its
 * settings could not be read.
 */

function alarm(overrides: Partial<Extract<Alarm, { status: 'ok' }>> = {}): Alarm {
  return {
    status: 'ok',
    exists: true,
    dailyLimitUsd: 5,
    spikeMultiple: 3,
    alertEmail: 'dane@example.com',
    miniDailyRequests: 40,
    defaultEmail: 'dane@example.com',
    lastCheckAt: '2026-10-30T17:37:00.000Z',
    lastCheck: { source: 'bill', todayUsd: 14.2, averageUsd: 1, topSpender: 'the API key “Mac Mini OpenClaw”', active: { 'over-limit': true, spike: true } },
    ...overrides,
  };
}

const view = (data: Alarm) => renderToStaticMarkup(
  <AlarmView alarm={data} onSave={() => {}} saving={false} message={null} />,
);

describe('Spending alarm', () => {
  it('says what the last check read, from which source, and that it is firing', () => {
    const html = view(alarm());
    expect(html).toContain('today (UTC) so far <strong>$14.20</strong>');
    expect(html).toContain('Read from Anthropic’s bill.');
    expect(html).toContain('Over the $5.00 limit today.');
    expect(html).toContain('More than 3× a normal day.');
    expect(html).toContain('Most of it is the API key “Mac Mini OpenClaw”.');
  });

  it('quotes the limit the check judged against, not one saved after it', () => {
    const html = view(alarm({ dailyLimitUsd: 5, lastCheck: { source: 'bill', todayUsd: 0.8, averageUsd: 1, dailyLimitUsd: 0.01, active: { 'over-limit': true } } }));
    expect(html).toContain('Over the $0.01 limit today.');
  });

  it('names the estimate, and what it cannot see, when the bill is not connected', () => {
    const html = view(alarm({ lastCheck: { source: 'meter', todayUsd: 0.4, averageUsd: 0.3, active: {} } }));
    expect(html).toContain('Starcaster’s estimate (Anthropic’s bill is not connected, and the estimate does not see the Mac Mini)');
    expect(html).not.toContain('role="alert"');
  });

  it('never shows $0 for a check that could not read the spend', () => {
    const html = view(alarm({ lastCheck: { todayUsd: null, unreadableWhy: 'Supabase down' } }));
    expect(html).toContain('could not read the spend.');
    expect(html).toContain('Supabase down');
    expect(html).not.toContain('$0.00</strong>');
  });

  it('says it has not run yet, and that the defaults are in force before a save', () => {
    const html = view(alarm({ exists: false, lastCheckAt: null, lastCheck: {} }));
    expect(html).toContain('Not checked yet.');
    expect(html).toContain('Not saved yet — the defaults below are in force.');
  });

  it('says the alarm is not running when its settings cannot be read', () => {
    const html = view({ status: 'error', message: 'relation "ai_spend_alarm" does not exist' });
    expect(html).toContain('so the alarm is not running.');
    expect(html).toContain('ai_spend_alarm');
  });

  it('is owner-only', () => {
    expect(view({ status: 'owner-only' })).toContain('only the platform owner can set it');
  });
});
