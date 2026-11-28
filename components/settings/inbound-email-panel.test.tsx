import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  InboundEmailView,
  outcomeLabel,
  readInboundState,
  summaryLine,
  type InboundState,
} from './inbound-email-panel';

/**
 * Settings › Projects › (a project) › Email (SC-928). Asserted on rendered
 * markup from props, because the panel itself talks to window.App.
 */

function state(overrides: Partial<InboundState> = {}): InboundState {
  return {
    domains: ['alphire.agency'],
    canEdit: true,
    routes: [
      {
        id: 'r1',
        address: 'admin@alphire.agency',
        forwardTo: 'dane@gmail.example',
        enabled: true,
        lastArrivalAt: '2026-11-27T22:00:00Z',
        deliveries: [
          { id: 'm1', receivedAt: '2026-11-27T22:00:00Z', from: 'ann@outside.example', subject: 'Question', outcome: 'forwarded', error: '', attempts: 1 },
          { id: 'm2', receivedAt: '2026-11-27T21:00:00Z', from: 'bob@outside.example', subject: 'Old', outcome: 'refused', error: 'the route for admin@alphire.agency is switched off', attempts: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

const NO_DRAFT = { address: '', forwardTo: '' };

function view(s: InboundState, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(<InboundEmailView state={s} open draft={NO_DRAFT} {...extra} />);
}

describe('readInboundState', () => {
  it('reads the server answer and treats a missing canEdit as read-only', () => {
    const s = readInboundState({ data: { routes: [{ id: 'r1', address: 'a@x.com', forwardTo: 'b@y.com', enabled: true }], domains: ['x.com'] } });
    expect(s.canEdit).toBe(false);
    expect(s.routes[0].deliveries).toEqual([]);
    expect(s.domains).toEqual(['x.com']);
  });
});

describe('summaryLine', () => {
  it('counts addresses and says how many are off', () => {
    expect(summaryLine(state({ routes: [] }))).toBe('Receives no email');
    expect(summaryLine(state())).toBe('1 address');
    const two = state();
    two.routes = [...two.routes, { ...two.routes[0], id: 'r2', enabled: false }];
    expect(summaryLine(two)).toBe('2 addresses, 1 switched off');
  });
});

describe('outcomeLabel', () => {
  it('says why mail was not forwarded', () => {
    expect(outcomeLabel({ id: '', receivedAt: '', from: '', subject: '', outcome: 'refused', error: 'the route for a@x.com is switched off', attempts: 1 }))
      .toBe('Refused: the route for a@x.com is switched off');
    expect(outcomeLabel({ id: '', receivedAt: '', from: '', subject: '', outcome: 'failed', error: 'domain not verified', attempts: 2 }))
      .toBe('Failed: domain not verified (attempt 2)');
  });
});

describe('InboundEmailView', () => {
  it('lists each route with where it forwards and whether it is on', () => {
    const html = view(state());
    expect(html).toContain('admin@alphire.agency');
    expect(html).toContain('Forwards to dane@gmail.example');
    expect(html).toContain('>On<');
    expect(html).toContain('Last email arrived');
    expect(html).toContain('Add address');
  });

  it('explains an empty list instead of showing nothing', () => {
    expect(view(state({ routes: [] }))).toContain('This project receives no email yet. Add an address to start.');
  });

  it('shows recent deliveries with the refusal reason when the log is open', () => {
    const html = view(state(), { logOpenId: 'r1' });
    expect(html).toContain('ann@outside.example');
    expect(html).toContain('Refused: the route for admin@alphire.agency is switched off');
  });

  it('says why nothing can be added when the project has no domain', () => {
    expect(view(state({ domains: [], routes: [] }))).toContain('This project has no domain set, so it cannot receive email.');
  });

  it('hides editing from a member and says who can change it', () => {
    const html = view(state({ canEdit: false }));
    expect(html).toContain('Only a project owner or admin can change these.');
    expect(html).not.toContain('Add address');
    expect(html).not.toContain('>Delete<');
  });

  it('a failed read says so instead of claiming the project receives nothing', () => {
    const html = view(state({ routes: [] }), { loadError: 'Could not read this project\'s email settings: 503' });
    expect(html).toContain('Could not read email settings');
    expect(html).not.toContain('receives no email yet');
  });
});
