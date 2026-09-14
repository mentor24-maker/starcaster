import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Builder's upload adapter sent EVERY file to /api/assets/import-image,
 * which refuses anything that is not an image — so Upload Video in Row
 * Background could never work, whatever the row handler did with the result
 * ("import-image only accepts image files", found driving the real button for
 * task 86bbwe98a). A video now goes to Blob and is recorded as an asset with
 * its size; an image takes exactly the route it always did.
 */

const uploadFileToBlob = vi.fn(async (file: File) => `https://blob.example/${file.name}`);
vi.mock('../media-blob-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media-blob-upload')>()),
  uploadFileToBlob: (file: File, type: string) => uploadFileToBlob(file, type as never)
}));

const { builderAdminFetch } = await import('./builder-admin-fetch');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function formWith(file: File) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

afterEach(() => {
  vi.unstubAllGlobals();
  uploadFileToBlob.mockClear();
});

describe('POST /api/admin/media with a video', () => {
  it('goes to Blob, records a Video asset WITH its size, and never touches import-image', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}'));
      calls.push({ url, body });
      return json({ ok: true, asset: { id: 9, assetName: body.assetName, assetType: 'Video', location: body.location, size: body.size } }, 201);
    }));

    const clip = new File([new Uint8Array(4096)], 'hero.mp4', { type: 'video/mp4' });
    const response = await builderAdminFetch('/api/admin/media', { method: 'POST', body: formWith(clip) });
    const data = await response.json();

    expect(uploadFileToBlob).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.url)).toEqual(['/api/assets']);
    expect(calls[0].body).toMatchObject({ assetType: 'Video', location: 'https://blob.example/hero.mp4', size: 4096 });
    expect(response.status).toBe(201);
    expect(data.media).toMatchObject({ kind: 'video', path: 'https://blob.example/hero.mp4' });
  });

  it('says which file failed when storage refuses it, rather than recording nothing silently', async () => {
    uploadFileToBlob.mockRejectedValueOnce(new Error('token denied'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const clip = new File(['x'], 'hero.mov', { type: 'video/quicktime' });
    const response = await builderAdminFetch('/api/admin/media', { method: 'POST', body: formWith(clip) });
    expect(response.ok).toBe(false);
    expect((await response.json()).error).toContain('hero.mov');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/media with an image', () => {
  it('still takes import-image, and never Blob', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return json({ ok: true, asset: { id: 3, assetName: 'photo.jpg', assetType: 'Image', location: '/api/admin/media-file/photo.jpg' } }, 201);
    }));
    const photo = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const response = await builderAdminFetch('/api/admin/media', { method: 'POST', body: formWith(photo) });
    expect(urls).toEqual(['/api/assets/import-image']);
    expect(uploadFileToBlob).not.toHaveBeenCalled();
    expect((await response.json()).media).toMatchObject({ kind: 'image' });
  });
});
