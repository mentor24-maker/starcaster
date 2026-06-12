import { afterEach, describe, expect, it, vi } from 'vitest';
import { builderAdminFetch } from './builder-admin-fetch';

function envelopeResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('builderAdminFetch', () => {
  it('rewrites /api/admin/pages to landing pages and re-keys the response', async () => {
    const fetchMock = vi.fn(async () =>
      envelopeResponse({ ok: true, data: [], landingPages: [{ id: 7, name: 'Home' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await builderAdminFetch('/api/admin/pages');
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledWith('/api/develop/landing-pages', expect.objectContaining({ credentials: 'include' }));
    expect(body.pages).toEqual([{ id: 7, name: 'Home' }]);
  });

  it('re-keys single records for cell modules', async () => {
    const fetchMock = vi.fn(async () =>
      envelopeResponse({ ok: true, data: {}, module: { id: 'm1', name: 'Saved' } }, 201)
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await builderAdminFetch('/api/admin/cell-modules', {
      method: 'POST',
      body: JSON.stringify({ name: 'Saved', modules: [] })
    });
    const body = await response.json();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/develop/modules');
    expect(response.status).toBe(201);
    expect(body.cellModule).toEqual({ id: 'm1', name: 'Saved' });
  });

  it('flattens starcaster error envelopes to strings', async () => {
    const fetchMock = vi.fn(async () =>
      envelopeResponse({ ok: false, error: { message: 'name is required', code: 'VALIDATION_ERROR' } }, 400)
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await builderAdminFetch('/api/admin/page-templates', { method: 'POST', body: '{}' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('name is required');
  });

  it('maps /api/assets rows into the media library shape', async () => {
    const fetchMock = vi.fn(async () =>
      envelopeResponse({
        ok: true,
        assets: [
          {
            id: 3,
            assetName: 'Hero Banner',
            assetType: 'image',
            category: 'banners',
            aspect: 'wide',
            location: 'https://blob.example.com/hero-banner.png',
            thumbnailUrl: 'https://blob.example.com/hero-banner-thumb.png'
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await builderAdminFetch('/api/admin/media');
    const body = await response.json();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/assets');
    expect(body.total).toBe(1);
    expect(body.media[0]).toMatchObject({
      name: 'Hero Banner',
      path: 'https://blob.example.com/hero-banner.png',
      kind: 'image',
      extension: '.png',
      mediaCategory: 'banners'
    });
  });

  it('re-keys polls from the data envelope', async () => {
    const fetchMock = vi.fn(async () =>
      envelopeResponse({ ok: true, data: [{ id: 'p1', question: 'Favorite color?' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await builderAdminFetch('/api/admin/polls');
    const body = await response.json();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/polls');
    expect(body.polls).toEqual([{ id: 'p1', question: 'Favorite color?' }]);
  });

  it('passes through unmapped paths untouched', async () => {
    const fetchMock = vi.fn(async () => envelopeResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await builderAdminFetch('/api/contact', { method: 'POST', body: '{}' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/contact');
  });
});
