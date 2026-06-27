// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveSessionAuthToken,
  resolveSessionProjectId,
  starcasterScopedHeaders
} from './starcaster-app';

const ADMIN_TOKEN_KEY = 'app.adminSessionToken';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  window.localStorage.removeItem('app_session');
  delete (window as unknown as { App?: unknown }).App;
  delete (window as unknown as { __SITE_CONFIG__?: unknown }).__SITE_CONFIG__;
});

describe('starcasterScopedHeaders', () => {
  it('uses platform session token when App shell is available', () => {
    (window as unknown as { App: unknown }).App = {
      api: async () => ({}),
      getSessionToken: () => 'platform-token',
      projectContext: { getSessionProjectId: () => 'proj-1' }
    };

    expect(starcasterScopedHeaders()).toEqual({
      'X-Project-ID': 'proj-1',
      Authorization: 'Bearer platform-token'
    });
  });

  it('falls back to admin session token and site config without App shell', () => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, 'admin-token');
    (window as unknown as { __SITE_CONFIG__?: { projectId?: string } }).__SITE_CONFIG__ = {
      projectId: 'tenant-proj'
    };

    expect(resolveSessionProjectId()).toBe('tenant-proj');
    expect(resolveSessionAuthToken()).toBe('admin-token');
    expect(starcasterScopedHeaders()).toEqual({
      'X-Project-ID': 'tenant-proj',
      Authorization: 'Bearer admin-token'
    });
  });
});
