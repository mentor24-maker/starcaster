'use strict';

/**
 * An asset row holds the ADDRESS of a file, never the file.
 *
 * 2026-11-06: twelve AI-generated videos sat in `assets.location` as base64
 * JSON (~30 MB each, 93 MB of a 97 MB table). A single read that touched them
 * restarted the production database and took the client sites down. These
 * tests pin the two halves of the fix: the store refuses that shape on any
 * write, and a finished generation is uploaded and stored as a URL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function loadStoreWithStubs() {
  const projectScope = require('../../lib/projectScope');
  const supabase = require('../../lib/supabase');
  const originals = {
    scopedInsertRow: projectScope.scopedInsertRow,
    scopedPatchRow: projectScope.scopedPatchRow,
    scopedIdQuery: projectScope.scopedIdQuery,
    scopedListQuery: projectScope.scopedListQuery,
    sbQuery: supabase.sbQuery,
  };
  const calls = [];
  projectScope.scopedInsertRow = async (_t, row) => row;
  projectScope.scopedPatchRow = async (_t, row) => row;
  projectScope.scopedIdQuery = async (_t, q) => q;
  projectScope.scopedListQuery = async (_t, q) => q;
  supabase.sbQuery = async (args) => {
    calls.push(args);
    return { ok: true, status: 200, data: [{ id: 1 }] };
  };
  delete require.cache[require.resolve('../../lib/assetsStore')];
  const store = require('../../lib/assetsStore');
  const restore = () => {
    Object.assign(projectScope, {
      scopedInsertRow: originals.scopedInsertRow,
      scopedPatchRow: originals.scopedPatchRow,
      scopedIdQuery: originals.scopedIdQuery,
      scopedListQuery: originals.scopedListQuery,
    });
    supabase.sbQuery = originals.sbQuery;
    delete require.cache[require.resolve('../../lib/assetsStore')];
  };
  return { store, calls, restore };
}

const FAKE_BASE64 = 'A'.repeat(40000);
const BAD_LOCATIONS = {
  'the JSON a generator returns': JSON.stringify({ videos: [{ bytesBase64Encoded: FAKE_BASE64 }] }),
  'a data: URI': `data:video/mp4;base64,${FAKE_BASE64.slice(0, 100)}`,
  'a JSON array': '[{"url":"x"}]',
  'anything past 2 KB': `https://example.com/${'a'.repeat(2100)}`,
};

test('createAsset refuses a location that is a file rather than an address, and never reaches the database', async () => {
  const { store, calls, restore } = loadStoreWithStubs();
  try {
    for (const [label, location] of Object.entries(BAD_LOCATIONS)) {
      const res = await store.createAsset({ assetName: 'clip', assetType: 'Video', location });
      assert.equal(res.ok, false, `expected ${label} to be refused`);
      assert.equal(res.code, 'ASSET_LOCATION_NOT_A_URL');
      assert.match(res.error, /location/);
    }
    assert.equal(calls.length, 0, 'a refused write must not send anything to the database');
  } finally {
    restore();
  }
});

test('updateAsset refuses the same shapes, for location and thumbnail_location', async () => {
  const { store, calls, restore } = loadStoreWithStubs();
  try {
    for (const [label, location] of Object.entries(BAD_LOCATIONS)) {
      const a = await store.updateAsset(7, { location, generationStatus: 'completed' });
      assert.equal(a.ok, false, `expected location = ${label} to be refused`);
      const b = await store.updateAsset(7, { thumbnailLocation: location });
      assert.equal(b.ok, false, `expected thumbnailLocation = ${label} to be refused`);
    }
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('ordinary addresses, and updates that do not touch location, still save', async () => {
  const { store, calls, restore } = loadStoreWithStubs();
  try {
    const url = 'https://abc.public.blob.vercel-storage.com/APP/Assets/Video/Generated/1_clip.mp4';
    assert.equal((await store.createAsset({ assetName: 'clip', location: url })).ok, true);
    assert.equal((await store.createAsset({ assetName: 'pending clip' })).ok, true, 'a queued generation has no location yet');
    assert.equal((await store.updateAsset(7, { location: url, size: 123 })).ok, true);
    assert.equal((await store.updateAsset(7, { generationStatus: 'failed' })).ok, true);
    assert.equal(calls.length, 4);
  } finally {
    restore();
  }
});

test('the library list names its columns instead of select=*', async () => {
  const { store, calls, restore } = loadStoreWithStubs();
  try {
    await store.listAssets({ projectId: 'p1' });
    const query = calls[0].query;
    assert.doesNotMatch(query, /select=\*/);
    // Every column rowToAsset reads must be in the list, or the screen loses it.
    for (const col of ['id', 'asset_name', 'location', 'thumbnail_location', 'renditions', 'generation_status', 'source', 'updated_at']) {
      assert.match(query, new RegExp(`[=,]${col}(,|&)`), `list must select ${col}`);
    }
  } finally {
    restore();
  }
});

// ── a finished generation is uploaded, and only its URL comes back ──

test('storeGeneratedVideo uploads the bytes and returns a URL plus the size', async () => {
  const { storeGeneratedVideo } = require('../../lib/generatedVideoStorage');
  const bytes = Buffer.from('fake mp4 bytes');
  let sent = null;
  const res = await storeGeneratedVideo({
    videoBase64: bytes.toString('base64'),
    assetId: 42,
    assetName: 'Sunset over / the pier',
    upload: async (args) => {
      sent = args;
      return { ok: true, data: { location: 'https://x.public.blob.vercel-storage.com/APP/Assets/Video/Generated/1_42.mp4' } };
    },
  });
  assert.equal(res.ok, true);
  assert.match(res.location, /^https:\/\/.*blob\.vercel-storage\.com\//);
  assert.equal(res.size, bytes.length);
  assert.equal(sent.mimeType, 'video/mp4');
  assert.ok(Buffer.isBuffer(sent.fileBuffer) && sent.fileBuffer.equals(bytes));
  assert.match(sent.pathname, /^APP\/Assets\/Video\/Generated\/\d+_42_Sunset_over_the_pier\.mp4$/);
});

test('storeGeneratedVideo fails loudly — no stand-in video — when there is nothing to store or the upload fails', async () => {
  const { storeGeneratedVideo } = require('../../lib/generatedVideoStorage');
  const neverCalled = async () => { throw new Error('should not upload'); };
  assert.equal((await storeGeneratedVideo({ videoBase64: '', assetId: 1, upload: neverCalled })).ok, false);
  assert.equal((await storeGeneratedVideo({ videoBase64: null, assetId: 1, upload: neverCalled })).ok, false);

  const refused = await storeGeneratedVideo({
    videoBase64: 'AAAA', assetId: 1, upload: async () => ({ ok: false, error: 'BLOB_READ_WRITE_TOKEN is not configured' }),
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /BLOB_READ_WRITE_TOKEN/);

  const thrown = await storeGeneratedVideo({ videoBase64: 'AAAA', assetId: 1, upload: async () => { throw new Error('network'); } });
  assert.equal(thrown.ok, false);

  const noUrl = await storeGeneratedVideo({ videoBase64: 'AAAA', assetId: 1, upload: async () => ({ ok: true, data: {} }) });
  assert.equal(noUrl.ok, false);
});

test('the status route stores a URL from storeGeneratedVideo, never the generator response', () => {
  // A source check, because the route needs a live generator to execute. The
  // two lines it pins are the exact ones that put 93 MB into the table.
  const src = require('node:fs').readFileSync(require.resolve('../../routes/assets.js'), 'utf8');
  assert.doesNotMatch(src, /location:\s*JSON\.stringify/, 'the generator response must never be written as a location');
  assert.doesNotMatch(src, /oceans\.mp4/, 'a failed parse must not mark a job completed with a stock video');
  assert.match(src, /location:\s*stored\.location/);
});
