'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Acquire's YouTube video list threw "Cannot read properties of undefined
 * (reading 'created_at')" whenever a SAVED video had no run behind it to merge
 * with — so the whole list failed to read. Found by Outreach wizard 15/19
 * (task 86bcrmbrf), which reads that list for the channels behind it.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = ['../../lib/projectScope.js', '../../lib/acquire/YoutubeVideosStore.js'].map((p) => require.resolve(p));

test('a saved video with no run behind it is listed, not a crash', async () => {
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({ acquireYoutubeVideos: 'v', acquireYoutubeDetails: 'd', acquireYoutubeComments: 'c' }),
      sbQuery: async ({ table, query }) => {
        if (table === 'v' && !/limit=1$/.test(query || '')) {
          return { ok: true, status: 200, data: [{ video_record_id: 'ytvideo_abcdefghijk', video_id: 'abcdefghijk', video_url: 'https://www.youtube.com/watch?v=abcdefghijk', channel_url: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx', title: 'Saved by hand', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }] };
        }
        return { ok: true, status: 200, data: [] };
      },
    },
  };
  for (const p of ALL) delete require.cache[p];
  try {
    const store = require('../../lib/acquire/YoutubeVideosStore.js');
    const res = await store.listYoutubeVideos(50, { projectId: 'proj_a', userId: 'u' });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].channel_url, 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx');
  } finally {
    if (real) require.cache[supabasePath] = real; else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
});
