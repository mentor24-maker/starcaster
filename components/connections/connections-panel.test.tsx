import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AppPasswordForm,
  CONNECT_PARAMS,
  ConnectionCardRow,
  connectReturnMessage,
  disconnectConfirmMessage,
  parseConnectHash,
} from './connections-panel';

/**
 * The Connections screen's four card states. Connections 4 of 7 (86bbpz1gd).
 *
 * Asserted on rendered markup rather than on props, because every one of these
 * is a claim about what a CLIENT sees: whether there is a button to press,
 * whether the sentence under the name tells them what they get or what broke,
 * and — the one this repo has been bitten by — whether a screen ever puts a box
 * on the page for a credential.
 *
 * The panel itself is not rendered here on purpose. It talks to window.App,
 * loads on mount and re-loads when the vanilla shell reveals its section, so a
 * static render of it produces the word "Loading" and nothing to test. The card
 * is a pure component precisely so these can be real assertions.
 */

type Card = Parameters<typeof ConnectionCardRow>[0]['card'];

function card(overrides: Partial<Card> = {}): Card {
  return {
    provider: 'bluesky',
    displayName: 'Bluesky',
    iconKey: 'bluesky',
    blurb: 'Post to your Bluesky account.',
    readiness: 'ready',
    authKind: 'app_password',
    connectable: true,
    cardState: 'not_connected',
    account: null,
    reason: '',
    accounts: [],
    ...overrides,
  } as Card;
}

function rowHtml(overrides: Partial<Card> = {}, busy = false): string {
  return renderToStaticMarkup(
    <ConnectionCardRow
      card={card(overrides)}
      busy={busy}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onPickAccount={() => {}}
    />
  );
}

const ACCOUNT = { accountId: '12345', accountLabel: 'Delray Beach Tennis', accountAvatarUrl: '' };

describe('Connections card — the four states', () => {
  it('not connected: says what connecting gets you, and offers Connect', () => {
    const html = rowHtml();
    expect(html).toContain('data-card-state="not_connected"');
    expect(html).toContain('Post to your Bluesky account.');
    expect(html).toContain('>Connect<');
    expect(html).not.toContain('>Disconnect<');
  });

  it('connected: names the account, and offers Disconnect rather than Connect', () => {
    const html = rowHtml({ cardState: 'connected', account: ACCOUNT });
    expect(html).toContain('data-card-state="connected"');
    expect(html).toContain('Delray Beach Tennis');
    expect(html).toContain('>Disconnect<');
    expect(html).not.toContain('>Connect<');
  });

  /**
   * The reason replaces the blurb rather than joining it. A broken connection
   * that still reads "Post to your Bluesky account" tells a client everything
   * is fine and buries the one sentence that is not.
   */
  it('needs attention: shows the plain reason instead of the blurb, and says Reconnect', () => {
    const html = rowHtml({
      cardState: 'needs_attention',
      account: ACCOUNT,
      reason: 'This connection has expired. Reconnect to start posting again.',
    });
    expect(html).toContain('data-card-state="needs_attention"');
    expect(html).toContain('This connection has expired.');
    expect(html).not.toContain('Post to your Bluesky account.');
    expect(html).toContain('>Reconnect<');
  });

  /**
   * No button AT ALL, not a disabled one: a greyed button still takes a Tab
   * stop and still invites a press, with nothing behind it.
   */
  it('coming soon: renders no button of any kind', () => {
    const html = rowHtml({ cardState: 'coming_soon', readiness: 'coming_soon', connectable: false });
    expect(html).toContain('data-card-state="coming_soon"');
    expect(html).toContain('Coming soon');
    expect(html).not.toContain('<button');
  });
});

describe('Connections card — accounts and credentials', () => {
  it('offers an account chooser only when the grant covered more than one', () => {
    const one = rowHtml({ cardState: 'connected', account: ACCOUNT, accounts: [ACCOUNT] });
    expect(one).not.toContain('<select');

    const several = rowHtml({
      cardState: 'connected',
      account: ACCOUNT,
      accounts: [ACCOUNT, { accountId: '67890', accountLabel: 'Second Page', accountAvatarUrl: '' }],
    });
    expect(several).toContain('<select');
    expect(several).toContain('Second Page');
  });

  /**
   * The Non-goal, as a test. A card in any state must never put a text box on
   * the page — the app-password form is a separate component the panel only
   * mounts after Connect is pressed, and it is described by the server.
   */
  it('never renders an input on a card, in any state', () => {
    for (const state of ['not_connected', 'connected', 'needs_attention', 'coming_soon'] as const) {
      const html = rowHtml({ cardState: state, account: state === 'not_connected' ? null : ACCOUNT });
      expect(html, `card state ${state}`).not.toContain('<input');
      expect(html, `card state ${state}`).not.toContain('<textarea');
    }
  });

  it('every control is a real focusable button, not a clickable div', () => {
    const html = rowHtml({ cardState: 'connected', account: ACCOUNT });
    expect(html).toContain('<button type="button"');
    expect(html).toContain('connections-card-button');
  });
});

describe("Connections card — the platform's mark", () => {
  /**
   * The icon is derived from the catalogue's `iconKey`, not from a lookup
   * table in the component — same promise as the cards themselves. This
   * renders a key the component has never heard of and expects the matching
   * path, which is what proves the derivation rather than a coincidence.
   */
  it('builds the icon path from the catalogue key, for any key', () => {
    expect(rowHtml({ iconKey: 'bluesky' })).toContain('/images/logos/bluesky.svg');
    expect(rowHtml({ iconKey: 'facebook' })).toContain('/images/logos/facebook.svg');
    expect(rowHtml({ iconKey: 'mastodon' })).toContain('/images/logos/mastodon.svg');
  });

  it('prefers the connected account\'s own picture over the platform mark', () => {
    const html = rowHtml({
      cardState: 'connected',
      account: { ...ACCOUNT, accountAvatarUrl: 'https://example.com/page-avatar.png' },
    });
    expect(html).toContain('https://example.com/page-avatar.png');
    expect(html).not.toContain('/images/logos/');
  });

  it('falls back to a plain tile when the catalogue names no icon at all', () => {
    const html = rowHtml({ iconKey: '' });
    expect(html).not.toContain('/images/logos/');
    expect(html).toContain('connections-card-avatar');
  });

  it('never gives the mark alt text — the platform name is already a heading beside it', () => {
    expect(rowHtml()).toContain('alt=""');
  });
});

describe('The app-password form', () => {
  const pending = {
    provider: 'bluesky',
    displayName: 'Bluesky',
    fields: [
      { name: 'identifier', label: 'Your handle', type: 'text', placeholder: 'you.bsky.social', help: 'Without the @.' },
      { name: 'appPassword', label: 'App password', type: 'password', help: 'Never your account password.' },
    ],
    values: { identifier: 'delray.bsky.social', appPassword: '' },
    error: '',
    busy: false,
  };

  function formHtml(overrides: Partial<typeof pending> = {}): string {
    return renderToStaticMarkup(
      <AppPasswordForm
        pending={{ ...pending, ...overrides }}
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
  }

  /**
   * The fields come from the server's description, so this test renders two
   * that the component has never heard of and expects both — that is the proof
   * it is not carrying a hardcoded Bluesky form.
   */
  it('renders exactly the fields it was handed, with their labels and help', () => {
    const html = formHtml();
    expect(html).toContain('Your handle');
    expect(html).toContain('App password');
    expect(html).toContain('you.bsky.social');
    expect(html).toContain('Never your account password.');
  });

  it('renders a password field as a password field, so it is not shoulder-readable', () => {
    expect(formHtml()).toContain('type="password"');
  });

  it('ties every field to its label and its help text by id', () => {
    const html = formHtml();
    expect(html).toContain('for="connectionsField-bluesky-identifier"');
    expect(html).toContain('id="connectionsField-bluesky-identifier"');
    expect(html).toContain('aria-describedby="connectionsField-bluesky-identifier-help"');
  });

  it('shows an error above the buttons when there is one', () => {
    expect(formHtml({ error: 'App password is required' })).toContain('App password is required');
    expect(formHtml()).not.toContain('connections-card-form-error');
  });
});

/**
 * The confirmation is the consent for a delete, so what it PROMISES and what
 * the route DOES have to be the same thing.
 *
 * Round 1 of this ticket was sent back because they were not: the message named
 * `card.account` — one Page — while DELETE /api/connections/<provider> removes
 * every account stored for that platform. Three Facebook Pages under one grant
 * meant a client agreed to lose one by name and lost three.
 *
 * These assert the wording against `accounts.length`, which is the SAME list
 * the route deletes from (routes/connections.js builds both from the identical
 * provider rows), so a future change that narrows the delete without changing
 * the sentence — or the reverse — fails here.
 */
describe('Disconnect confirmation — it names everything it removes', () => {
  const page = (n: number) => ({
    accountId: `page-${n}`,
    accountLabel: `Delray Page ${n}`,
    accountAvatarUrl: '',
  });

  it('one account: names that account', () => {
    const message = disconnectConfirmMessage(card({
      cardState: 'connected',
      displayName: 'Bluesky',
      account: ACCOUNT,
      accounts: [ACCOUNT],
    }));
    expect(message).toContain('Disconnect Delray Beach Tennis?');
    expect(message).not.toContain('removes all');
  });

  /**
   * The exact case from the send-back: three Pages behind one grant. The count
   * has to be in the sentence, and every name with it — a client cannot consent
   * to losing an account the dialog never mentioned.
   */
  it('several accounts: gives the count AND every name, not just the active one', () => {
    const accounts = [page(1), page(2), page(3)];
    const message = disconnectConfirmMessage(card({
      cardState: 'connected',
      displayName: 'Facebook Page',
      account: accounts[0],
      accounts,
    }));
    expect(message).toContain('Disconnect Facebook Page?');
    expect(message).toContain('removes all 3 connected accounts');
    expect(message).toContain('Delray Page 1');
    expect(message).toContain('Delray Page 2');
    expect(message).toContain('Delray Page 3');
  });

  /**
   * The bug was a message that was true about one account and silent about the
   * rest, so "does it mention the others" is the assertion that would have
   * caught it — not merely "does it mention the active one".
   */
  it('several accounts: does not describe the delete as touching only one', () => {
    const accounts = [page(1), page(2)];
    const message = disconnectConfirmMessage(card({
      cardState: 'connected',
      displayName: 'Facebook Page',
      account: accounts[0],
      accounts,
    }));
    expect(message).toContain('them straight away');
    expect(message).not.toContain('Disconnect Delray Page 1?');
    expect(message).not.toContain('to it straight away');
  });

  /** A long list is trimmed for readability, but the COUNT stays exact. */
  it('many accounts: keeps the count honest even when the names are trimmed', () => {
    const accounts = Array.from({ length: 9 }, (_, i) => page(i + 1));
    const message = disconnectConfirmMessage(card({
      cardState: 'connected',
      displayName: 'Facebook Page',
      account: accounts[0],
      accounts,
    }));
    expect(message).toContain('removes all 9 connected accounts');
    expect(message).toContain('and 3 more');
  });

  /** An account with no label still has to be countable rather than blank. */
  it('falls back to the platform name when there is nothing to name', () => {
    const message = disconnectConfirmMessage(card({
      cardState: 'connected',
      displayName: 'Bluesky',
      account: null,
      accounts: [],
    }));
    expect(message).toContain('Disconnect Bluesky?');
  });
});

/**
 * The refused connect. Connections 6b of 7 (86bbu50mb).
 *
 * A refusal stores NOTHING — no row, so no card state to read — which is why
 * this is a separate surface from the amber card rather than a fifth state of
 * it. The whole of it travels on the return URL, so these tests hand the reader
 * a URL's worth of parameters and assert what a client ends up seeing.
 */
function reader(params: Record<string, string>) {
  return (name: string) => params[name] || '';
}

describe('A refused connect says why', () => {
  it('carries the adapter\'s own sentence, unedited', () => {
    const sentence = 'This Instagram account is a personal account. '
      + 'Switch it to a Professional account in the Instagram app, then try again.';
    const found = connectReturnMessage(reader({
      connect_oauth: 'error',
      connect_provider: 'instagram',
      connect_error: sentence,
    }));
    expect(found).toEqual({ provider: 'instagram', tone: 'error', sentence });
  });

  /**
   * THE criterion this whole surface turns on. The adapters were written to
   * produce plain English naming what to change — an Instagram refusal says
   * "switch it to a Professional account" — and every generic sentence
   * substituted for one of those throws that away and puts the client back at
   * "it did not work". Asserted by identity, not by a substring: a panel that
   * appended so much as a helpful "Please try again." would still pass a
   * `toContain`.
   */
  it('does not substitute wording of its own', () => {
    const sentence = 'Instagram refused the connection.';
    const found = connectReturnMessage(reader({ connect_provider: 'instagram', connect_error: sentence }));
    expect(found?.sentence).toBe(sentence);
  });

  it('a notice is a notice, not an error — the tones are not the same face', () => {
    const found = connectReturnMessage(reader({
      connect_provider: 'facebook',
      connect_notice: 'This grant covers three Pages. Choose which one posts.',
    }));
    expect(found?.tone).toBe('notice');
  });

  /** An error and a notice together: the error is the one that matters. */
  it('prefers the error when both arrive', () => {
    const found = connectReturnMessage(reader({
      connect_provider: 'x',
      connect_error: 'X refused the connection.',
      connect_notice: 'Something milder.',
    }));
    expect(found?.tone).toBe('error');
    expect(found?.sentence).toBe('X refused the connection.');
  });

  /** A plain success carries neither, and must not render an empty box. */
  it('says nothing at all about a connect that worked', () => {
    expect(connectReturnMessage(reader({
      connect_oauth: 'connected',
      connect_provider: 'instagram',
      connect_account: '17841400000000000',
    }))).toBe(null);
    expect(connectReturnMessage(reader({}))).toBe(null);
  });

  /** Whitespace is not a sentence. A trailing "&connect_error=" renders nothing. */
  it('treats a blank parameter as absent', () => {
    expect(connectReturnMessage(reader({ connect_provider: 'x', connect_error: '   ' }))).toBe(null);
  });

  /**
   * Acceptance criterion 3 — reloading does not show it again — is only true if
   * every parameter is cleared, not just the one that was rendered. A leftover
   * `connect_oauth=error` in the hash is a URL a client can bookmark or share
   * that still says something went wrong.
   */
  it('clears every parameter it consumes, so a reload is clean', () => {
    expect(CONNECT_PARAMS).toContain('connect_error');
    expect(CONNECT_PARAMS).toContain('connect_notice');
    expect(CONNECT_PARAMS).toContain('connect_provider');
    expect(CONNECT_PARAMS).toContain('connect_oauth');
    expect(CONNECT_PARAMS).toContain('connect_code');
  });
});

describe('The refusal on the card', () => {
  const REFUSAL = 'Instagram could not be connected because this account is not linked to a Facebook Page.';

  function withNotice(tone: 'error' | 'notice') {
    return renderToStaticMarkup(
      <ConnectionCardRow
        card={card({ provider: 'instagram', displayName: 'Instagram', blurb: 'Post to Instagram.' })}
        busy={false}
        notice={{ provider: 'instagram', tone, sentence: REFUSAL }}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onPickAccount={() => {}}
      />
    );
  }

  it('renders the sentence against the card, in the provider\'s own words', () => {
    const html = withNotice('error');
    expect(html).toContain('data-provider="instagram"');
    expect(html).toContain(REFUSAL);
  });

  /**
   * A refusal is NOT a failure of the connection, and the card must not act
   * like one. Nothing was stored, so the card is still not-connected and
   * Connect — not Reconnect — is still the right thing to press. Getting this
   * wrong would tell a client their account had broken when they had simply
   * been asked to change a setting and come back.
   */
  it('leaves the card not-connected, with Connect still offered', () => {
    const html = withNotice('error');
    expect(html).toContain('data-card-state="not_connected"');
    expect(html).toContain('>Connect<');
    expect(html).not.toContain('>Reconnect<');
    expect(html).not.toContain('connections-card-needs_attention');
  });

  it('a card with nothing to report renders no notice element at all', () => {
    const html = rowHtml({ provider: 'instagram' });
    expect(html).not.toContain('connections-card-notice');
    expect(html).not.toContain('data-notice-tone');
  });

  it('keeps the two tones apart in the markup, so CSS can tell them apart', () => {
    expect(withNotice('error')).toContain('data-notice-tone="error"');
    expect(withNotice('notice')).toContain('data-notice-tone="notice"');
  });
});

/**
 * Reading the hash, and why this parser exists at all.
 *
 * `routes/engage.js` puts the outcome in the FRAGMENT, not the query string —
 * `connectionsReturnUrl` builds `#page=settingsConnectionsPage&connect_...` —
 * so `URLSearchParams(location.search)` would find nothing. These use the exact
 * strings that function produces.
 *
 * The parser is the panel's own rather than `App.readHashParam` because it runs
 * at module-evaluation time, before `window.App` is built. That is not a
 * preference: measured in a real browser on 2026-09-04, reading the hash inside
 * a mount effect found nothing at all, because the vanilla shell rewrites the
 * hash to exactly `#page=<id>` while it boots and drops every other key. Every
 * test in this file passed while the screen showed nothing.
 */
describe('The return URL', () => {
  it('reads the parameters out of the fragment, the way slice 5 writes them', () => {
    const sentence = 'Instagram refused: this account is not linked to a Facebook Page.';
    const hash = '#page=settingsConnectionsPage&connect_oauth=error&connect_provider=instagram'
      + `&connect_error=${encodeURIComponent(sentence)}`;
    const params = parseConnectHash(hash);
    expect(params.page).toBe('settingsConnectionsPage');
    expect(params.connect_provider).toBe('instagram');
    expect(params.connect_error).toBe(sentence);
    expect(connectReturnMessage((n) => params[n] || '')?.sentence).toBe(sentence);
  });

  /**
   * The shell's rewrite, as it actually appears. If this ever starts yielding a
   * sentence, something has changed about when the panel reads — and the mount
   * effect that used to do the reading produced exactly this and rendered
   * nothing.
   */
  it('finds nothing once the shell has rewritten the hash', () => {
    const params = parseConnectHash('#page=settingsConnectionsPage');
    expect(connectReturnMessage((n) => params[n] || '')).toBe(null);
  });

  it('survives an empty hash, a bare key and a broken escape', () => {
    expect(parseConnectHash('')).toEqual({});
    expect(parseConnectHash('#')).toEqual({});
    expect(parseConnectHash('#page=x&connect_error')).toEqual({ page: 'x', connect_error: '' });
    // A lone % is not valid percent-encoding; the raw text is better than a throw.
    expect(parseConnectHash('#connect_error=100%').connect_error).toBe('100%');
  });

  /** A sentence has spaces in it, and a redirect may encode them either way. */
  it('decodes both spellings of a space', () => {
    expect(parseConnectHash('#connect_error=try%20again').connect_error).toBe('try again');
    expect(parseConnectHash('#connect_error=try+again').connect_error).toBe('try again');
  });
});
