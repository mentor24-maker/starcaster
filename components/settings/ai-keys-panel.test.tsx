import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiKeysTable, accountText, type AiKeyRow } from './ai-keys-panel';

/**
 * Settings › APIs › AI keys (86bcvhfht). The claim that matters is what Dane
 * reads: WHICH account to top up, and never a key value.
 */

function row(overrides: Partial<AiKeyRow> = {}): AiKeyRow {
  return {
    id: 'website-anthropic',
    provider: 'anthropic',
    place: 'the website',
    job: 'Write with AI',
    source: 'environment variable ANTHROPIC_API_KEY',
    fingerprint: '0f6257af',
    verdict: 'OUT OF CREDIT',
    reason: 'anthropic answered 400 — "Your credit balance is too low"',
    account: '33d0ab74-d6bd-4d7d-a525-029a6e4217d1',
    accountLabel: 'org 33d0ab74… (not named yet)',
    ...overrides,
  };
}

describe('AiKeysTable', () => {
  it('shows the account a dry key bills, its verdict and its fingerprint', () => {
    const html = renderToStaticMarkup(<AiKeysTable keys={[row()]} />);
    expect(html).toContain('org 33d0ab74… (not named yet)');
    expect(html).toContain('OUT OF CREDIT');
    expect(html).toContain('key 0f6257af');
    expect(html).toContain('Anthropic (Claude)');
  });

  it('says WHY the account is blank instead of leaving an empty cell', () => {
    expect(accountText(row({ provider: 'gemini', accountLabel: '', account: '', verdict: 'WORKS' })))
      .toBe('Google does not say which project a key bills');
    expect(accountText(row({ provider: 'openai', accountLabel: '', account: '' })))
      .toBe('OpenAI did not name the account in its reply');
    expect(accountText(row({ verdict: 'NOT SET', accountLabel: '', account: '' }))).toBe('—');
  });
});
