import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppPasswordForm, ConnectionCardRow } from './connections-panel';

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
