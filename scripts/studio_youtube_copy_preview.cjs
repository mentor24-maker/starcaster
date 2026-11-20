#!/usr/bin/env node
'use strict';

/**
 * npm run studio:youtube-copy-preview [-- --edit <id>]
 *
 * Reel Spinner 6a (SC-839). Writes the YouTube title, description and tags for
 * ONE rough cut and PRINTS them, writing nothing anywhere: the catalog's write
 * doors are replaced by recorders and the queue is a throwaway file. It runs
 * the very job the Mini's pass runs (workers/studio/youtubeCopyPass.js), so
 * what it prints is what the pass would write.
 *
 * It costs one AI call, through the AI door like every other.
 *
 * Without --edit it takes the oldest rough cut waiting in review that still
 * has an empty box. Exit 0 printed, 1 could not (the reason is printed),
 * 2 not configured.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openQueue } = require('../workers/studio/queue.js');
const pass = require('../workers/studio/youtubeCopyPass.js');
const { scopeFor } = require('../workers/studio/ingest.js');
const videoEditsStore = require('../lib/videoEditsStore.js');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
}

async function main() {
  const scope = scopeFor({}, process.env);
  if (!scope) {
    console.error('STUDIO_PROJECT_ID is not set, so there is no project to read. Run it through npm (doppler supplies it).');
    return 2;
  }
  let editId = arg('--edit');
  if (!editId) {
    const listed = await videoEditsStore.listEditsByStatus(500, ['review'], scope);
    if (!listed.ok) { console.error(`The edits in review could not be read: ${listed.error}`); return 1; }
    const first = listed.data.find((e) => pass.emptyFields(e).length) || listed.data[0];
    if (!first) { console.error('No rough cut is waiting in review, so there is nothing to preview.'); return 1; }
    editId = first.id;
  }

  const written = [];
  const notes = [];
  const catalog = {
    ...pass.realCatalog(),
    // A preview writes nothing: every write door only records what it was given.
    fillYoutubeCopy: async (id, input) => {
      written.push(input);
      const back = await videoEditsStore.getEditById(id, scope);
      if (!back.ok || !back.data) return back;
      const data = { ...back.data, ...input };
      return { ok: true, status: 200, data, written: Object.keys(input), kept: [] };
    },
    noteYoutubeCopyProblem: async (id, reason) => { notes.push(reason); return { ok: true }; },
    clearYoutubeCopyProblem: async () => ({ ok: true, cleared: false }),
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytcopy-preview-'));
  const queue = openQueue(path.join(dir, 'queue.sqlite'));
  try {
    // `force`: a preview may ask for text an edit already has, since it writes none.
    pass.enqueueYoutubeCopy(queue, { editId, why: 'preview' });
    const report = await pass.runYoutubeCopy({
      queue, env: process.env, catalog, alarm: () => ({ said: 'not posted (preview)' }), clearAlarm: () => {}, force: true,
    });
    const result = [...report.written, ...report.kept, ...report.movedOn, ...report.failed, ...report.blocked, ...report.released, ...report.lost][0];
    console.log(`Edit ${editId}: ${result ? `${result.outcome} — ${result.reason}` : 'nothing ran'}`);
    if (result && result.model) console.log(`Model: ${result.model}`);
    for (const n of notes) console.log(`The card would say: YouTube text not written yet: ${n}`);
    if (!written.length) return 1;
    const w = written[0];
    console.log('\n--- TITLE ---');
    console.log(w.youtubeTitle);
    console.log(`(${w.youtubeTitle.length} characters)`);
    console.log('\n--- DESCRIPTION ---');
    console.log(w.youtubeDescription);
    console.log(`(${w.youtubeDescription.length} characters)`);
    console.log('\n--- TAGS ---');
    console.log(w.youtubeTags.join(', '));
    console.log('\nNothing was written: this was a preview.');
    return 0;
  } finally {
    queue.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then((code) => process.exit(code), (err) => {
  console.error(`The preview stopped: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
