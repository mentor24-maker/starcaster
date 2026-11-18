import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProviderTable, moveRow, payloadOf, readingFor, sourceText, type ProviderRow } from './ai-provider-panel';

/**
 * Settings › APIs › AI provider (AI switch 2, SC-844). What matters is what
 * Dane reads: the order, each provider's reading, a missing key named by its
 * SETTING (never a value), and which order the door is really following.
 */

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'anthropic', label: 'Anthropic', enabled: true,
    fast: 'claude-haiku-4-5', strong: 'claude-sonnet-5-5',
    defaultFast: 'claude-haiku-4-5', defaultStrong: 'claude-sonnet-5-5',
    keyEnv: 'ANTHROPIC_API_KEY', keySet: true, custom: false, baseUrl: '',
    ...overrides,
  };
}

const kimi = row({ id: 'kimi', label: 'Kimi', enabled: false, keyEnv: 'MOONSHOT_API_KEY', keySet: false, fast: 'kimi-k3.1-pro-highspeed', strong: 'kimi-k3.1-pro' });
const openai = row({ id: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', fast: 'gpt-5.4-mini', strong: 'gpt-5.5' });

describe('moveRow', () => {
  it('moves a row up and down and stops at the ends', () => {
    expect(moveRow(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveRow(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveRow(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('readingFor', () => {
  it('names the missing key by its setting, with where to add it', () => {
    expect(readingFor(kimi, null)).toEqual({ verdict: 'NOT SET', detail: 'no key: add MOONSHOT_API_KEY to Doppler production' });
  });
  it('uses the AI keys check reading for that provider', () => {
    const reading = { checkedAt: 'x', keys: [{ provider: 'anthropic', verdict: 'OUT OF CREDIT', reason: 'credit too low' } as any] };
    expect(readingFor(row(), reading)).toEqual({ verdict: 'OUT OF CREDIT', detail: 'credit too low' });
  });
  it('says the reading is not taken yet, never a verdict it does not have', () => {
    expect(readingFor(row(), null).verdict).toBe('key set');
  });
});

describe('sourceText', () => {
  it('says when the screen is in charge', () => {
    expect(sourceText({ source: 'settings', fallbackReason: '' })).toMatch(/saved on this screen/);
  });
  it('says the fallback and why when the row could not be read', () => {
    const text = sourceText({ source: 'AI_PROVIDER_ORDER', fallbackReason: 'the saved setting could not be read (HTTP 500)' });
    expect(text).toContain('AI_PROVIDER_ORDER');
    expect(text).toContain('could not be read (HTTP 500)');
  });
});

describe('payloadOf', () => {
  it('sends every row in screen order with its switch and models', () => {
    const body = payloadOf([openai, row(), kimi], []);
    expect((body.providers as any[]).map((p) => [p.id, p.enabled])).toEqual([['openai', true], ['anthropic', true], ['kimi', false]]);
  });
});

describe('ProviderTable', () => {
  it('shows each provider, its switch and its reading, and no key value', () => {
    const html = renderToStaticMarkup(<ProviderTable rows={[row(), openai, kimi]} reading={null} onChange={() => {}} />);
    expect(html).toContain('Anthropic');
    expect(html).toContain('Kimi');
    expect(html).toContain('no key: add MOONSHOT_API_KEY to Doppler production');
    expect(html).toContain('data-ai-provider="kimi"');
    expect(html).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
