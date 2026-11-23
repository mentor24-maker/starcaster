'use strict';

/**
 * The rough-cut PASS — a watchable first cut of each edit, made on the Mini.
 *
 * Reel Spinner 4b (SC-834). The decisions are 4a's (workers/studio/editList.js):
 * nothing about WHAT to keep is decided here. The moments pass queues a
 * `rough_cut` job when a recording's moments are `done`, and this pass:
 *
 *   1. reads the recording, its transcript, cut marks, moments and line-up
 *      back from the catalog, and plans its edits with `planEdits` — one
 *      `full`, plus the shorts that scored high enough;
 *   2. creates the `video_edits` rows that do not exist yet (one full edit per
 *      recording, one short per moment: a second run creates none);
 *   3. renders each edit that is waiting, FROM ITS ROW (the keep ranges and the
 *      sound the row names), out of the 720p proxy already on this disk, with
 *      ffmpeg: the kept stretches joined, the chosen recording's sound;
 *   4. uploads it into a `Rough cuts` folder inside the Studio folder on
 *      mentorofaio's Drive, stores the Drive file id, moves the edit to
 *      `review`, reads it back, and only then deletes the local render.
 *
 * No music, no cards and no full-quality render (5c), and no review screen (4c).
 *
 * WHERE THE FOLDER GOES. Inside the Studio folder (`17HZZ…`), which sits under
 * the `Starcaster` folder shared with the worker's account. Never a folder
 * shared on its own: on 2026-10-09 a folder shared straight to mentor24 was
 * accepted on paper and never listed to it (docs/STUDIO.md, "Which Google
 * account owns what"). The upload spends the UPLOADER's storage — mentor24's.
 *
 * THE LEASE IS SIZED TO THE RENDER, BEFORE IT STARTS — the rule proxyPass.js
 * explains. ffmpeg runs under spawnSync, so this process cannot beat while it
 * renders; with the default five-minute lease, a second worker on the same
 * queue would reap the job and render the same edit at once. So before each
 * edit the lease is stretched to cover that render and its upload.
 *
 * WHAT IS CHARGED TO THE EDIT, AND WHAT IS NOT (the line every Studio pass
 * draws). ffmpeg missing, the catalog unreachable, or the disk too full to
 * render into: facts about the MACHINE. The job is put back without spending
 * an attempt, and the edits are left as they were. A render ffmpeg refuses,
 * or an upload Drive refuses: this edit's. The edit goes to `failed` with the
 * reason, and the job fails through the queue's retry rules — a retry picks
 * the edit up again (failed → draft → rendering), and a finished render whose
 * upload failed is KEPT on disk and reused, never rendered twice.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { planEdits } = require('./editList.js');
const { runFfmpeg, encodeTimeoutMs, resolveDerivedDir, FAILURES } = require('./proxy.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoTranscriptsStore = require('../../lib/videoTranscriptsStore.js');
const videoCutMarksStore = require('../../lib/videoCutMarksStore.js');
const videoMomentsStore = require('../../lib/videoMomentsStore.js');
const videoAudioPairsStore = require('../../lib/videoAudioPairsStore.js');
const videoEditsStore = require('../../lib/videoEditsStore.js');

const STAGE_ROUGH_CUT = 'rough_cut';
const SUBJECT_VIDEO_SOURCE = 'video_source';

/** The Studio folder on mentorofaio's Drive (docs/STUDIO.md). `STUDIO_DRIVE_FOLDER_ID` overrides. */
const STUDIO_FOLDER_ID = '17HZZDNlGAcxWUxbMBdlywnn-Tjf4pfD7';
const ROUGH_CUTS_FOLDER = 'Rough cuts';
const FOLDER_CACHE_KEY = 'rough-cuts-folder-id';

/** Bump when the render settings change, so a kept render made under the old ones is not reused. */
const RENDER_VERSION = '1';

/**
 * Small and quick, from the 720p proxy: x264 at `veryfast`, quality 28, sound
 * at 96 kb/s. A rough cut is for deciding, not for showing anyone.
 */
const VIDEO_ARGS = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p'];
const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '96k'];

/**
 * A generous guess at the size of a rough cut, to decide whether the disk has
 * room before rendering: 3 Mbit/s, which is above what these settings produce
 * from a 720p talking-head proxy. The measured figure is in docs/STUDIO.md.
 */
const ESTIMATE_BYTES_PER_SECOND = (3 * 1000 * 1000) / 8;
/** Never render into the last 5 GB of the disk: other stages are downloading into it too. */
const DISK_MARGIN_BYTES = 5 * 1024 * 1024 * 1024;

/** Not the edit's fault: hold the job for the 15 minutes every Studio pass uses. */
const RELEASE_HOLD_MS = 15 * 60 * 1000;
/** Time for the catalog writes around a render. */
const LEASE_MARGIN_MS = 5 * 60 * 1000;
/** An upload is allowed at least ten minutes, and as long as 256 KB/s would take. */
const UPLOAD_FLOOR_MS = 10 * 60 * 1000;
const UPLOAD_SLOWEST_BYTES_PER_MS = 256;

const EDIT_DONE = 'done';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

function realCatalog() {
  return {
    getSourceById: videoSourcesStore.getSourceById,
    getTranscriptBySource: videoTranscriptsStore.getTranscriptBySource,
    getCutMarksBySource: videoCutMarksStore.getCutMarksBySource,
    getMomentsBySource: videoMomentsStore.getMomentsBySource,
    listAudioPairsForSource: videoAudioPairsStore.listAudioPairsForSource,
    listEditsForSource: videoEditsStore.listEditsForSource,
    createEdit: videoEditsStore.createEdit,
    moveEdit: videoEditsStore.moveEdit,
    getEditById: videoEditsStore.getEditById,
  };
}

/** The Drive calls this pass makes, behind one seam so the tests never reach Google. */
function realDrive() {
  const googleDrive = require('../../lib/googleDrive.js');
  return {
    getAccessToken: () => googleDrive.getAccessToken(),
    findFolderByName: (token, parentId, name) => googleDrive.findFolderByName(token, parentId, name),
    createFolder: (token, parentId, name) => googleDrive.createFolder(token, parentId, name),
    findFileByName: (token, parentId, name, options) => googleDrive.findFileByName(token, parentId, name, options),
    upload: (args) => googleDrive.uploadFileResumable(args),
  };
}

/** How long the output runs, by ffprobe. Null when it cannot be read. */
function realProbeDuration(file, { run = spawnSync, bin = process.env.STUDIO_FFPROBE || 'ffprobe' } = {}) {
  const res = run(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8', timeout: 30 * 1000,
  });
  const value = Number(text(res && res.stdout));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Put a rough-cut job on the queue for one source. Keyed by the source id, so
 * the queue's unique index on live (stage, subject) jobs is the dedupe: the
 * moments pass, a rescore and the backfill all get the same job.
 */
function enqueueRoughCut(queue, { sourceId, why = '' }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueRoughCut needs a source id');
  return queue.enqueue({
    stage: STAGE_ROUGH_CUT,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id, ...(text(why) ? { why: text(why) } : {}) },
  });
}

function keptSeconds(ranges) {
  return ranges.reduce((sum, r) => sum + (r.end_s - r.start_s), 0);
}

function estimateBytes(keptS) {
  return Math.ceil(Math.max(1, keptS) * ESTIMATE_BYTES_PER_SECOND);
}

/** The lease one edit needs: its render, its upload, and the writes around them. */
function leaseForRender(keptS) {
  const uploadMs = Math.max(UPLOAD_FLOOR_MS, Math.ceil(estimateBytes(keptS) / UPLOAD_SLOWEST_BYTES_PER_MS));
  return encodeTimeoutMs(keptS) + uploadMs + LEASE_MARGIN_MS;
}

/**
 * How far the sound's clock is from the picture's, for the sound the edit's
 * row names. Read off the line-up the same way editList.js `soundSource` does:
 * `offsetS` is how many seconds after A's first frame B's was recorded, so on
 * A, B's clock reads `t - offsetS`.
 *
 * @returns {{ ok: true, shiftS: number } | { ok: false, why: string }}
 */
function soundShift(sourceId, audioSourceId, pairs) {
  const id = text(sourceId).toLowerCase();
  const audio = text(audioSourceId).toLowerCase();
  if (!audio || audio === id) return { ok: true, shiftS: 0 };
  const pair = (pairs || []).find((p) => {
    const a = text(p.sourceAId).toLowerCase();
    const b = text(p.sourceBId).toLowerCase();
    return (a === id && b === audio) || (b === id && a === audio);
  });
  if (!pair) return { ok: false, why: `the edit uses the sound of recording ${audioSourceId}, but no line-up with it exists any more` };
  if (pair.status !== 'done' || typeof pair.offsetS !== 'number' || !Number.isFinite(pair.offsetS)) {
    return { ok: false, why: `the edit uses the sound of recording ${audioSourceId}, but their line-up is ${pair.status || 'unknown'} with no usable offset` };
  }
  const a = text(pair.sourceAId).toLowerCase();
  return { ok: true, shiftS: round(a === id ? -pair.offsetS : pair.offsetS) };
}

/**
 * The ffmpeg filter graph for one edit: every kept stretch of the picture
 * (input 0) and the same stretch of the sound (input `audioInput`, shifted onto
 * its clock), joined end to end. Written to a file rather than the command
 * line: a full edit of an hour's recording has hundreds of stretches.
 *
 * `concat` lines each stretch's sound up with its picture, so a stretch whose
 * picture is a frame shorter than its sound cannot push the sound off the lips
 * for everything after it.
 */
function filterScript({ ranges, shiftS = 0, audioInput = 0 }) {
  const n = ranges.length;
  if (!n) throw new Error('an edit with no kept stretches cannot be rendered');
  const lines = [];
  const vOut = ranges.map((_, i) => `[v${i}]`).join('');
  const aOut = ranges.map((_, i) => `[a${i}]`).join('');
  lines.push(`[0:v]split=${n}${vOut};`);
  lines.push(`[${audioInput}:a]asplit=${n}${aOut};`);
  ranges.forEach((r, i) => {
    const s = round(r.start_s);
    const e = round(r.end_s);
    lines.push(`[v${i}]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[pv${i}];`);
    lines.push(`[a${i}]atrim=start=${round(s + shiftS)}:end=${round(e + shiftS)},asetpts=PTS-STARTPTS[pa${i}];`);
  });
  const pairs = ranges.map((_, i) => `[pv${i}][pa${i}]`).join('');
  lines.push(`${pairs}concat=n=${n}:v=1:a=1[outv][outa]`);
  return lines.join('\n');
}

function renderArgs({ picturePath, soundPath, scriptPath, outPath }) {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', picturePath];
  if (soundPath && soundPath !== picturePath) args.push('-i', soundPath);
  args.push('-/filter_complex', scriptPath, '-map', '[outv]', '-map', '[outa]',
    ...VIDEO_ARGS, ...AUDIO_ARGS, '-movflags', '+faststart', '-f', 'mp4', outPath);
  return args;
}

/** What a render is made from. Two renders with the same fingerprint are the same file. */
function renderFingerprint({ ranges, shiftS, picturePath, soundPath }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ v: RENDER_VERSION, ranges, shiftS, picturePath, soundPath }))
    .digest('hex').slice(0, 16);
}

function localPathsFor(derivedDir, editId) {
  const dir = path.join(derivedDir, 'rough-cuts');
  return {
    dir,
    video: path.join(dir, `${editId}.mp4`),
    part: path.join(dir, `${editId}.part.mp4`),
    script: path.join(dir, `${editId}.filter.txt`),
    sidecar: path.join(dir, `${editId}.json`),
  };
}

/** A finished render from an earlier try, if it was made from exactly this. */
function keptRender(paths, fingerprint, io = fs) {
  try {
    const side = JSON.parse(io.readFileSync(paths.sidecar, 'utf8'));
    const size = io.statSync(paths.video).size;
    if (side && side.fingerprint === fingerprint && size > 0 && side.bytes === size) return side;
  } catch {
    // No sidecar, no file, or a sidecar that does not parse: nothing to reuse.
  }
  return null;
}

function removeQuietly(file, io = fs) {
  try { io.rmSync(file, { force: true }); } catch { /* a leftover is tidied by the next render */ }
}

/** "IMG_1962" out of ".../IMG_1962.MOV". */
function recordingName(source) {
  const base = path.basename(text(source.localPath) || text(source.proxyPath) || text(source.id));
  return base.replace(/\.[A-Za-z0-9]{2,4}$/, '') || text(source.id);
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The name on Drive. Named after the recording so Dane can tell them apart,
 * and ending in the edit's id so two recordings with the same name (two
 * phones' IMG_0001) never collide and a retry finds its own upload.
 */
function driveFileName(source, edit, moment) {
  const id8 = text(edit.id).slice(0, 8);
  const name = recordingName(source);
  // A re-cut (4d) is a different file from the cut he sent back, so it says
  // which re-cut it is: the same name would read as the old cut on Drive.
  const recut = Number(edit.recutCount) > 0 ? `, re-cut ${edit.recutCount}` : '';
  if (edit.kind === 'full') return `${name} — full edit${recut} (${id8}).mp4`;
  const at = moment && typeof moment.start_s === 'number' ? ` from ${clock(moment.start_s)}` : '';
  const score = moment && typeof moment.score === 'number' ? `, score ${moment.score}` : '';
  return `${name} — short${at}${score}${recut} (${id8}).mp4`;
}

/** Which entry of video_moments.moments a planned short was cut from. */
function momentIndexOf(moments, short) {
  return moments.findIndex((m) => m && Math.abs(Number(m.start_s) - short.moment.startS) < 0.0005
    && Math.abs(Number(m.end_s) - short.moment.endS) < 0.0005);
}

function toRows(ranges) {
  return ranges.map((r) => ({ start_s: r.start, end_s: r.end }));
}

/**
 * The edit rows this recording should have, created where missing. A row that
 * already exists is left exactly as it is — a decision already on the row is
 * the decision, even if a later plan would differ — so a second run creates
 * nothing. A create that meets a row another writer made in the meantime (409)
 * is the same outcome as finding it.
 */
async function ensureEdits({ catalog, sourceId, plan, moments, scope }) {
  const listed = await catalog.listEditsForSource(sourceId, scope);
  if (!listed.ok) return { ok: false, outage: true, error: `the edits of source ${sourceId} could not be read: ${listed.error}` };
  const existing = listed.data;
  const want = [{ kind: 'full', momentIndex: null, edit: plan.full }];
  for (const short of plan.shorts) {
    const index = momentIndexOf(moments, short);
    if (index < 0) continue; // planEdits only ever returns moments from this list
    want.push({ kind: 'short', momentIndex: index, edit: short });
  }
  const created = [];
  for (const w of want) {
    const have = existing.find((e) => e.kind === w.kind && (w.kind === 'full' || e.momentIndex === w.momentIndex));
    if (have) continue;
    const input = { kind: w.kind, keepRanges: toRows(w.edit.ranges) };
    if (w.kind === 'short') input.momentIndex = w.momentIndex;
    if (w.edit.sound && text(w.edit.sound.sourceId)) input.audioSourceId = w.edit.sound.sourceId;
    const made = await catalog.createEdit(sourceId, input, scope);
    if (made.ok) {
      created.push(made.data);
      continue;
    }
    if (made.status === 409) continue; // someone else made it: it exists, which is all this wanted
    if (made.status === 400 || made.status === 404) {
      return { ok: false, outage: false, error: `the ${w.kind} edit for source ${sourceId} was refused by the catalog: ${made.error}` };
    }
    return { ok: false, outage: true, error: `the ${w.kind} edit for source ${sourceId} could not be created: ${made.error}` };
  }
  if (!created.length) return { ok: true, edits: existing, created };
  const again = await catalog.listEditsForSource(sourceId, scope);
  if (!again.ok) return { ok: false, outage: true, error: `the edits of source ${sourceId} were created but could not be read back: ${again.error}` };
  return { ok: true, edits: again.data, created };
}

/** The Rough cuts folder's id, found or made once and remembered on this machine. */
async function roughCutsFolder({ drive, token, queue, env }) {
  const cached = typeof queue.cacheGet === 'function' ? text(queue.cacheGet(FOLDER_CACHE_KEY)) : '';
  if (cached) return { ok: true, id: cached };
  const parent = text(env.STUDIO_DRIVE_FOLDER_ID) || STUDIO_FOLDER_ID;
  const found = await drive.findFolderByName(token, parent, ROUGH_CUTS_FOLDER);
  if (!found.ok) return { ok: false, error: `could not look for the Rough cuts folder in the Studio folder (${parent}): ${found.error}` };
  let id = text(found.data && found.data.id);
  if (!id) {
    const made = await drive.createFolder(token, parent, ROUGH_CUTS_FOLDER);
    if (!made.ok) return { ok: false, error: `could not make the Rough cuts folder in the Studio folder (${parent}): ${made.error}` };
    id = text(made.data && made.data.id);
    if (!id) return { ok: false, error: 'Drive made the Rough cuts folder but returned no id' };
  }
  if (typeof queue.cacheSet === 'function') queue.cacheSet(FOLDER_CACHE_KEY, id, { ttlMs: 30 * 24 * 60 * 60 * 1000 });
  return { ok: true, id };
}

/**
 * Put one finished render on Drive, or find the one an earlier try put there.
 * The upload counts only when Drive reports the same number of bytes as the
 * file on disk.
 */
async function uploadRender({ drive, queue, env, file, bytes, name }) {
  const tokenRes = await drive.getAccessToken();
  if (!tokenRes.ok) return { ok: false, error: `Drive sign-in failed: ${tokenRes.error}` };
  const token = tokenRes.data.accessToken;
  const folder = await roughCutsFolder({ drive, token, queue, env });
  if (!folder.ok) return { ok: false, error: folder.error };
  const started = Date.now();
  // `withSize`: Drive leaves `size` out unless asked, and without it this
  // check never matches and every retry uploads a second copy (SC-834 review).
  const already = await drive.findFileByName(token, folder.id, name, { withSize: true });
  if (already.ok && already.data && Number(already.data.size) === bytes) {
    return { ok: true, id: text(already.data.id), folderId: folder.id, reused: true, ms: Date.now() - started };
  }
  const up = await drive.upload({ token, folderId: folder.id, fileName: name, mimeType: 'video/mp4', filePath: file });
  if (!up.ok) return { ok: false, error: `Drive refused the upload: ${up.error}` };
  const id = text(up.data && up.data.id);
  if (!id) return { ok: false, error: 'Drive accepted the upload but returned no file id' };
  if (Number(up.data.size) !== bytes) {
    return { ok: false, error: `Drive holds ${up.data.size} bytes of ${name}, but the render is ${bytes} bytes, so the upload is not trusted` };
  }
  return { ok: true, id, folderId: folder.id, reused: false, ms: Date.now() - started };
}

/**
 * Render one edit into its local file, or reuse the render an earlier try
 * finished. Never throws for ffmpeg's sake: every outcome is in the return.
 */
function renderToDisk({ paths, ranges, shiftS, picturePath, soundPath, ffmpeg, probeDuration, io = fs, keptS }) {
  const fingerprint = renderFingerprint({ ranges, shiftS, picturePath, soundPath });
  const kept = keptRender(paths, fingerprint, io);
  if (kept) return { ok: true, reused: true, ...kept };
  io.mkdirSync(paths.dir, { recursive: true });
  removeQuietly(paths.part, io);
  io.writeFileSync(paths.script, filterScript({ ranges, shiftS, audioInput: soundPath && soundPath !== picturePath ? 1 : 0 }));
  const ran = ffmpeg(renderArgs({ picturePath, soundPath, scriptPath: paths.script, outPath: paths.part }), {
    timeoutMs: encodeTimeoutMs(keptS),
  });
  if (!ran.ok) {
    removeQuietly(paths.part, io);
    removeQuietly(paths.script, io);
    const detail = text(ran.detail);
    return { ok: false, machine: ran.reason === FAILURES.FFMPEG_MISSING, why: detail.length > 1500 ? `…${detail.slice(-1500)}` : detail };
  }
  io.renameSync(paths.part, paths.video);
  removeQuietly(paths.script, io);
  const bytes = io.statSync(paths.video).size;
  const durationS = probeDuration(paths.video);
  const side = { fingerprint, bytes, renderMs: ran.ms, durationS };
  io.writeFileSync(paths.sidecar, JSON.stringify(side));
  return { ok: true, reused: false, ...side };
}

/**
 * Bring one edit to `rendering` from wherever a previous try left it. `draft`
 * moves straight on; `failed` and a `rendering` left by a run that died go
 * through `failed → draft` first, which is the only way back the store allows.
 */
async function startRendering(catalog, edit, scope) {
  let current = edit;
  if (current.status === 'rendering') {
    const failed = await catalog.moveEdit(current.id, 'failed', {
      error: 'left in rendering by an earlier run that did not finish; rendering it again',
    }, scope);
    if (!failed.ok) return failed;
    current = failed.data;
  }
  if (current.status === 'failed') {
    const back = await catalog.moveEdit(current.id, 'draft', {}, scope);
    if (!back.ok) return back;
    current = back.data;
  }
  return catalog.moveEdit(current.id, 'rendering', {}, scope);
}

/**
 * Which edits this run renders, full edit first. `review` and later are never
 * touched — and neither is a `failed` edit the UPLOAD stopped (SC-842): that
 * one was approved, and rendering it again would erase its reason and move it
 * back to waiting for review, so Dane's approval would be lost.
 */
function editsToRender(edits) {
  const waiting = edits.filter((e) => ['draft', 'failed', 'rendering'].includes(e.status)
    && !videoEditsStore.isUploadProblem(e));
  return waiting.sort((a, b) => (a.kind === b.kind ? (a.momentIndex ?? 0) - (b.momentIndex ?? 0) : (a.kind === 'full' ? -1 : 1)));
}

/**
 * Make one claimed job's rough cuts. The caller owns the claim; this never
 * claims. Every return says what happened (`outcome`) and what the queue was
 * told (`jobAction`), and lists each edit with its length, size and timings.
 */
async function roughCutJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  drive = realDrive(),
  options = {},
  env = process.env,
  ffmpeg = runFfmpeg,
  probeDuration = realProbeDuration,
  exists = fs.existsSync,
  freeBytes = (dir) => require('./ingest.js').freeBytesFor(dir),
  io = fs,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const sourceId = text(payload.sourceId) || text(job && job.subjectId);
  const base = { jobId: job.id, sourceId, created: 0, edits: [] };
  const scope = scopeFor(options, env);
  const derivedDir = resolveDerivedDir(options, env);

  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_ROUGH_CUT,
      subjectKind: SUBJECT_VIDEO_SOURCE,
      subjectId: sourceId || text(job.subjectId),
      reason,
      payload: job.payload || null,
      jobId: job.id,
    });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const releaseIt = (reason, extra = {}) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: RELEASE_HOLD_MS })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, ...extra, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };

  if (!sourceId) {
    return blockIt('this rough-cut job names no source, so there is nothing to cut. '
      + 'Fix: this should not be reachable from the moments pass — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the edits cannot be written in their project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so its edits have nothing to belong to. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }
  const source = row.data;
  const picturePath = text(source.proxyPath);
  if (!picturePath || !exists(picturePath)) {
    return blockIt(`source ${sourceId} has no working copy on this disk (${picturePath || 'no proxy path in the catalog'}), `
      + 'so there is nothing to render from. Fix: re-run its proxy step, then delete this blocked job.');
  }

  const moments = await catalog.getMomentsBySource(sourceId, scope);
  if (!moments.ok) return releaseIt(`the moments of source ${sourceId} could not be read: ${moments.error}`);
  if (!moments.data || text(moments.data.status) !== EDIT_DONE) {
    return blockIt(`source ${sourceId} has no scored moments (they read "${text(moments.data && moments.data.status) || 'none'}"), `
      + 'so its shorts cannot be chosen. Fix: score it (npm run studio:backfill-moments), which queues this again.');
  }
  const transcript = await catalog.getTranscriptBySource(sourceId, scope);
  if (!transcript.ok) return releaseIt(`the transcript of source ${sourceId} could not be read: ${transcript.error}`);
  const cuts = await catalog.getCutMarksBySource(sourceId, scope);
  if (!cuts.ok) return releaseIt(`the cut marks of source ${sourceId} could not be read: ${cuts.error}`);
  if (!transcript.data || text(transcript.data.state) !== EDIT_DONE || !cuts.data || text(cuts.data.state) !== EDIT_DONE) {
    return blockIt(`source ${sourceId} has no finished transcript or cut marks, so nothing says what to cut. `
      + 'Fix: re-run its transcription and cut marks, then delete this blocked job.');
  }
  const pairsRes = await catalog.listAudioPairsForSource(sourceId, scope);
  if (!pairsRes.ok) return releaseIt(`the line-ups of source ${sourceId} could not be read: ${pairsRes.error}`);
  const pairs = pairsRes.data;
  const pair = pairs.find((p) => p.status === 'done') || pairs[0] || null;

  let otherDurationS;
  if (pair && pair.status === 'done') {
    const otherId = text(pair.sourceAId).toLowerCase() === sourceId.toLowerCase() ? pair.sourceBId : pair.sourceAId;
    const other = await catalog.getSourceById(otherId, scope);
    // The edit rows are permanent once made, so they are never planned
    // without the partner's length just because the catalog blinked.
    if (!other.ok) return releaseIt(`the lined-up partner recording ${otherId} of source ${sourceId} could not be read: ${other.error}`);
    if (other.data) otherDurationS = other.data.durationS;
  }

  const momentList = Array.isArray(moments.data.moments) ? moments.data.moments : [];
  const durationS = Number(cuts.data.durationS) > 0 ? Number(cuts.data.durationS) : Number(source.durationS);
  const plan = planEdits({
    words: Array.isArray(transcript.data.words) ? transcript.data.words : [],
    marks: Array.isArray(cuts.data.marks) ? cuts.data.marks : [],
    durationS,
    fps: source.fps,
    sourceId,
    pair,
    otherDurationS,
    moments: momentList,
  }, { config: options.editConfig });

  const ensured = await ensureEdits({ catalog, sourceId, plan, moments: momentList, scope });
  if (!ensured.ok) return ensured.outage ? releaseIt(ensured.error) : blockIt(`${ensured.error}. Fix: inspect video_edits for source ${sourceId}, then delete this blocked job.`);
  base.created = ensured.created.length;

  const ffmpegCheck = ffmpeg(['-hide_banner', '-version'], { timeoutMs: 30 * 1000 });
  if (!ffmpegCheck.ok && ffmpegCheck.reason === FAILURES.FFMPEG_MISSING) {
    return releaseIt('ffmpeg is not installed or not on PATH on this machine — no rough cuts were made, '
      + 'and the edits were left as they were. Fix: brew install ffmpeg.');
  }

  const failures = [];
  for (const edit of editsToRender(ensured.edits)) {
    const ranges = Array.isArray(edit.keepRanges) ? edit.keepRanges : [];
    const keptS = keptSeconds(ranges);
    const entry = { editId: edit.id, kind: edit.kind, momentIndex: edit.momentIndex, keptS: round(keptS) };
    base.edits.push(entry);

    const paths = localPathsFor(derivedDir, edit.id);
    const shift = soundShift(sourceId, edit.audioSourceId, pairs);
    let soundPath = picturePath;
    let refusal = '';
    if (!ranges.length) refusal = 'the edit keeps nothing, so there is nothing to render';
    else if (!shift.ok) refusal = shift.why;
    else if (text(edit.audioSourceId) && text(edit.audioSourceId).toLowerCase() !== sourceId.toLowerCase()) {
      const other = await catalog.getSourceById(edit.audioSourceId, scope);
      if (!other.ok) return releaseIt(`the sound's recording ${edit.audioSourceId} could not be read: ${other.error}`);
      soundPath = text(other.data && other.data.proxyPath);
      if (!soundPath || !exists(soundPath)) refusal = `the edit uses the sound of recording ${edit.audioSourceId}, whose working copy is not on this disk (${soundPath || 'no proxy path'})`;
    }

    // Room on the disk BEFORE the edit moves: a full disk is the machine's
    // problem, and the edit is left exactly as it was.
    if (!refusal && !keptRender(paths, renderFingerprint({ ranges, shiftS: shift.shiftS, picturePath, soundPath }), io)) {
      const free = freeBytes(derivedDir);
      const need = estimateBytes(keptS) + DISK_MARGIN_BYTES;
      if (!free || !free.ok) {
        return releaseIt(`the free space where rough cuts are rendered (${derivedDir}) could not be read: ${free && free.error}`);
      }
      if (free.value < need) {
        const gb = (b) => `${(b / (1024 ** 3)).toFixed(1)} GB`;
        return releaseIt(`the disk is too full to render a rough cut: ${gb(free.value)} free where rough cuts are rendered `
          + `(${derivedDir}), and this ${edit.kind} edit needs about ${gb(estimateBytes(keptS))} plus the ${gb(DISK_MARGIN_BYTES)} always left free. `
          + 'Nothing was rendered and the edits were left as they were. Fix: free some space on the Mini.');
      }
    }

    if (!queue.heartbeat(job.id, owner, { leaseMs: leaseForRender(keptS) })) {
      return { ...base, outcome: 'lost', jobAction: 'none',
        reason: `the lease on job ${job.id} was no longer this worker's, so the rendering was left to whoever holds it` };
    }

    const moving = await startRendering(catalog, edit, scope);
    if (!moving.ok) {
      if (moving.status === 409) {
        entry.status = 'skipped';
        entry.why = moving.error;
        continue; // it moved underneath us: whoever moved it owns it now
      }
      return releaseIt(`edit ${edit.id} could not be moved to rendering: ${moving.error}`);
    }

    const failEdit = async (why) => {
      const failed = await catalog.moveEdit(edit.id, 'failed', { error: why }, scope);
      entry.status = 'failed';
      entry.why = why;
      if (!failed.ok) entry.why += ` (and the failure could not be written on the edit: ${failed.error})`;
      failures.push(entry);
    };

    if (refusal) {
      await failEdit(refusal);
      continue;
    }

    const rendered = renderToDisk({ paths, ranges, shiftS: shift.shiftS, picturePath, soundPath, ffmpeg, probeDuration, io, keptS });
    if (!rendered.ok) {
      if (rendered.machine) {
        const marked = await catalog.moveEdit(edit.id, 'failed', { error: 'ffmpeg went missing mid-run; it will be rendered again' }, scope);
        const note = marked.ok ? '' : ` (and edit ${edit.id} could not be marked failed: ${marked.error})`;
        return releaseIt(`ffmpeg is not installed or not on PATH on this machine. Fix: brew install ffmpeg.${note}`);
      }
      await failEdit(`ffmpeg could not render it: ${rendered.why}`);
      continue;
    }
    Object.assign(entry, { bytes: rendered.bytes, durationS: rendered.durationS, renderMs: rendered.renderMs, renderReused: rendered.reused });

    const name = driveFileName(source, edit, edit.kind === 'short' ? momentList[edit.momentIndex] : null);
    const uploaded = await uploadRender({ drive, queue, env, file: paths.video, bytes: rendered.bytes, name });
    if (!uploaded.ok) {
      // The render is KEPT: the retry uploads it rather than rendering it again.
      await failEdit(`rendered, but not uploaded: ${uploaded.error}. The render is kept at ${paths.video} for the next try.`);
      break; // a Drive that refused one will refuse the rest; stop rendering into nowhere
    }
    Object.assign(entry, { driveFileId: uploaded.id, driveName: name, uploadMs: uploaded.ms, uploadReused: uploaded.reused });

    const moved = await catalog.moveEdit(edit.id, 'review', { roughCutDriveFileId: uploaded.id }, scope);
    const back = moved.ok ? await catalog.getEditById(edit.id, scope) : moved;
    if (!back.ok || !back.data || back.data.status !== 'review' || text(back.data.roughCutDriveFileId) !== uploaded.id) {
      const why = !moved.ok ? moved.error
        : `it was written but read back as "${text(back.data && back.data.status) || 'nothing'}" with Drive file "${text(back.data && back.data.roughCutDriveFileId)}"`;
      entry.status = 'failed';
      entry.why = `uploaded to Drive as ${uploaded.id}, but the edit could not be marked for review: ${why}. The render is kept at ${paths.video}.`;
      failures.push(entry);
      continue;
    }
    // Confirmed on Drive and on the row: only now does the local copy go.
    removeQuietly(paths.video, io);
    removeQuietly(paths.sidecar, io);
    entry.status = 'review';
  }

  if (failures.length) {
    const reason = failures.map((f) => `${f.kind} edit ${f.editId}: ${f.why}`).join(' | ');
    queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'failed', jobAction: 'failed', reason };
  }
  const completed = queue.complete(job.id, owner);
  const made = base.edits.filter((e) => e.status === 'review').length;
  return { ...base, outcome: 'done', jobAction: completed ? 'completed' : 'none',
    reason: `${made} rough cut(s) ready for review, ${base.created} edit row(s) created` };
}

/**
 * Claim and render up to `max` jobs. The daemon calls it with `max: 1`: a full
 * edit of a long recording is minutes of ffmpeg, and the daemon must get back
 * to the other stages. An outage stops the run.
 */
async function runRoughCut(options = {}) {
  const {
    queue,
    owner = `roughcut-${process.pid}`,
    max = 1,
  } = options;
  if (!queue) throw new Error('runRoughCut needs a queue (workers/studio/queue.js)');
  const report = { owner, done: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_ROUGH_CUT] });
    if (!job) break;
    let result;
    try {
      result = await roughCutJob({ ...options, queue, job, owner, options });
    } catch (err) {
      const reason = `making this source's rough cuts threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason, edits: [] };
    }
    const bucket = { done: report.done, failed: report.failed, blocked: report.blocked, outage: report.released, lost: report.lost }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runRoughCut,
  roughCutJob,
  enqueueRoughCut,
  // Reused by the re-cut pass (workers/studio/recutPass.js, Reel Spinner 4d),
  // so a re-cut renders and uploads exactly the way a first cut does.
  realCatalog,
  realDrive,
  realProbeDuration,
  renderToDisk,
  uploadRender,
  keptRender,
  renderFingerprint,
  estimateBytes,
  keptSeconds,
  removeQuietly,
  ensureEdits,
  soundShift,
  filterScript,
  renderArgs,
  driveFileName,
  leaseForRender,
  editsToRender,
  localPathsFor,
  STAGE_ROUGH_CUT,
  SUBJECT_VIDEO_SOURCE,
  ROUGH_CUTS_FOLDER,
  STUDIO_FOLDER_ID,
  RELEASE_HOLD_MS,
  DISK_MARGIN_BYTES,
};
