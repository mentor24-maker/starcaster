import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroupRows, ModelChooser, ProviderTable, lastCallText, listStatusText, mountainTime, moveRow, payloadOf, readingFor, sourceText, syncGroups, type GroupRow, type ProviderRow } from './ai-provider-panel';

/**
 * Settings › APIs › AI provider (AI switch 2, SC-844). What matters is what
 * Dane reads: the order, each provider's reading, a missing key named by its
 * SETTING (never a value), and which order the door is really following.
 */

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'anthropic', label: 'Anthropic', enabled: true,
    fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5',
    defaultFast: 'claude-haiku-5-5', defaultStrong: 'claude-sonnet-5-5',
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

describe('List models (SC-903)', () => {
  const deepseek = row({ id: 'deepseek', label: 'DeepSeek', enabled: false, keyEnv: 'DEEPSEEK_API_KEY', keySet: true, fast: 'deepseek-flash', strong: 'deepseek-v4-pro' });

  it('offers a List models button on every provider when the screen can list', () => {
    const html = renderToStaticMarkup(<ProviderTable rows={[row(), deepseek]} reading={null} onChange={() => {}} lists={{}} onList={() => {}} />);
    expect(html).toContain('data-ai-list-models="deepseek"');
    expect(html).toContain('List models');
    // Nothing listed yet: no dropdown, only the typed box.
    expect(html).not.toContain('ai-provider-model-choice');
  });

  it('once listed, each model box gets a dropdown of that provider\'s models with the saved one chosen', () => {
    const lists = { deepseek: { models: ['deepseek-flash', 'deepseek-v4-pro'] } };
    const html = renderToStaticMarkup(<ProviderTable rows={[deepseek]} reading={null} onChange={() => {}} lists={lists} onList={() => {}} />);
    expect(html.match(/ai-provider-model-choice/g)?.length).toBe(2);
    expect(html).toContain('Choose from 2 models…');
    expect(html).toContain('<option value="deepseek-v4-pro" selected="">deepseek-v4-pro</option>');
    expect(html).toContain('2 models listed');
    expect(html).toContain('List again');
  });

  it('a typed name that is not on the list is said, not hidden', () => {
    const html = renderToStaticMarkup(<ModelChooser label="DeepSeek" tier="fast" value="deepseek-v2-typo" models={['deepseek-flash']} onPick={() => {}} />);
    expect(html).toContain('&quot;deepseek-v2-typo&quot; is not in DeepSeek&#x27;s list');
  });

  it('why a provider could not list is shown in its words', () => {
    expect(listStatusText({ reason: 'no key yet: add XAI_API_KEY to Doppler production, then list again' })).toMatch(/XAI_API_KEY/);
    expect(listStatusText({ busy: true })).toBe('Asking for its models…');
    expect(listStatusText({ models: ['one'] })).toBe('1 model listed: choose under each box');
    expect(listStatusText(undefined)).toBe('');
    const html = renderToStaticMarkup(<ProviderTable rows={[deepseek]} reading={null} onChange={() => {}} lists={{ deepseek: { reason: 'DeepSeek would not list its models: DeepSeek refused the key (401)' } }} onList={() => {}} />);
    expect(html).toContain('DeepSeek refused the key (401)');
    expect(html).not.toContain('ai-provider-model-choice');
  });
});

// ── Feature groups (AI provider groups 2, SC-876) ─────────────────────────

function group(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    id: 'outreach', label: 'Outreach', about: 'Reply drafts and the Substack passes',
    follows: true, providers: [row(), openai], groupError: '',
    lastCall: null, lastCallError: '', lastCallNone: 'No AI calls yet (none in the last 30 days)',
    ...overrides,
  };
}

describe('payloadOf with groups', () => {
  it('sends null for a group that follows and its own list for one that does not', () => {
    const body = payloadOf([row(), openai], [], [
      group(),
      group({ id: 'writing', follows: false, providers: [{ ...openai }, { ...row(), enabled: false }] }),
    ]);
    const orders = body.groupOrders as Record<string, any>;
    expect(orders.outreach).toBeNull();
    expect(orders.writing.map((p: any) => [p.id, p.enabled])).toEqual([['openai', true], ['anthropic', false]]);
  });
  it('sends no groupOrders at all when the screen has no groups', () => {
    expect('groupOrders' in payloadOf([row()], [], [])).toBe(false);
  });
});

describe('syncGroups', () => {
  it('adds a new service to a group with its own order switched off, and drops a removed one', () => {
    const groq = row({ id: 'custom-groq', label: 'Groq', custom: true });
    const own = group({ follows: false, providers: [{ ...openai }, { ...groq }, { ...row(), enabled: false }] });
    const [synced] = syncGroups([own], [row(), openai, kimi]);
    expect(synced.providers.map((p) => [p.id, p.enabled])).toEqual([['openai', true], ['anthropic', false], ['kimi', false]]);
  });
  it('a following group is a copy of the main list', () => {
    const [synced] = syncGroups([group()], [openai, kimi]);
    expect(synced.providers.map((p) => p.id)).toEqual(['openai', 'kimi']);
  });
});

describe('lastCallText', () => {
  it('names the provider, model and Mountain time of the last call', () => {
    const text = lastCallText(group({ lastCall: { provider: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.5', feature: 'reddit-comment-draft', at: '2026-11-25T22:04:00Z' } }));
    expect(text).toBe('Last AI call answered by OpenAI (gpt-5.5), Nov 25, 3:04 PM MT');
  });
  it('says the meter could not be read, never "No AI calls yet", when it could not', () => {
    const text = lastCallText(group({ lastCallError: 'Could not read which provider answered last: HTTP 500', lastCallNone: '' }));
    expect(text).toContain('Could not read');
    expect(text).not.toContain('No AI calls');
  });
  it('says "No AI calls yet" when there were none, never a blank', () => {
    expect(lastCallText(group())).toMatch(/^No AI calls yet/);
  });
  it('mountainTime does not invent a time it was not given', () => {
    expect(mountainTime(null)).toBe('at an unknown time');
  });
});

describe('GroupRows', () => {
  it('shows each group with what it covers, its choice, and its last call; a table only for its own order', () => {
    const html = renderToStaticMarkup(
      <GroupRows
        groups={[group(), group({ id: 'writing', label: 'Writing', about: 'Write with AI', follows: false })]}
        reading={null}
        mainRows={[row(), openai]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('Outreach');
    expect(html).toContain('Reply drafts and the Substack passes');
    expect(html).toContain('Follows the Main Setting');
    expect(html).toContain('Its Own Order');
    expect(html).toContain('No AI calls yet');
    // Only Writing has its own order, so only Writing shows a provider table.
    expect(html.match(/<table/g)?.length).toBe(1);
    expect(html).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
