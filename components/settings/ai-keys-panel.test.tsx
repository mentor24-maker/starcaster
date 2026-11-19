import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiKeysTable, accountText, switchSentence, type AiKeyRow } from './ai-keys-panel';

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

describe('AiKeysTable on the AI switch (SC-848)', () => {
  it('lists providers in switch order, Kimi included, and marks the switched-off ones', () => {
    const keys = [
      row({ id: 'website-openai', provider: 'openai', label: 'OpenAI', inSwitch: true, position: 1, enabled: true, verdict: 'WORKS' }),
      row({ id: 'website-anthropic', inSwitch: true, position: 2, enabled: true }),
      row({ id: 'website-kimi', provider: 'kimi', label: 'Kimi', inSwitch: true, position: 3, enabled: false, verdict: 'NOT SET', fingerprint: '', accountLabel: '', account: '', reason: 'no key is set: add MOONSHOT_API_KEY' }),
    ];
    const html = renderToStaticMarkup(<AiKeysTable keys={keys} />);
    expect(html.indexOf('1. OpenAI')).toBeGreaterThan(-1);
    expect(html.indexOf('1. OpenAI')).toBeLessThan(html.indexOf('2. Anthropic (Claude)'));
    expect(html.indexOf('2. Anthropic (Claude)')).toBeLessThan(html.indexOf('3. Kimi'));
    expect(html).toContain('(switched off)');
    expect(html).toContain('MOONSHOT_API_KEY');
  });

  it('names an added service by the name it was added under, and why its account is blank', () => {
    const groq = row({ provider: 'custom-groq', label: 'Groq', accountLabel: '', account: '', verdict: 'WORKS' });
    expect(renderToStaticMarkup(<AiKeysTable keys={[groq]} />)).toContain('Groq');
    expect(accountText(groq)).toBe('Groq does not say which account a key bills');
  });

  it('says what calls are using, or that every AI feature has stopped', () => {
    expect(switchSentence({ serving: 'OpenAI', outage: false, blind: false })?.text).toBe('AI calls are using OpenAI.');
    expect(switchSentence({ serving: '', outage: true, blind: false })?.text).toMatch(/every AI feature has stopped/);
    expect(switchSentence({ serving: '', outage: false, blind: true })?.text).toMatch(/cannot be told/);
    expect(switchSentence(undefined)).toBeNull();
  });
});
