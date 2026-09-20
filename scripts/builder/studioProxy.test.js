'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');

/**
 * Studio Phase 1 · 6 of 8 (86bbjv68x) — proxy, analysis audio, contact sheet.
 *
 * TWO KINDS OF TEST, ON PURPOSE — the same split 5/8 uses.
 *
 * The first kind drives the rules over ffprobe JSON written out here and over
 * a fake `spawnSync`, because the awkward cases are unbuildable: a container
 * that reports no bitrate at all, an ffmpeg that is not installed, a machine
 * with no hardware decoder.
 *
 * The second kind BUILDS REAL MEDIA WITH FFMPEG and runs the real encodes.
 * Every acceptance criterion on this ticket is about what really comes out of
 * ffmpeg — a proxy that is 8-bit, a WAV at 16 kHz, a source whose five extra
 * tracks were left alone — and none of that can be proved against a mock.
 * Nothing media-shaped is committed: every fixture is made in a temp folder
 * and deleted when the test finishes.
 *
 * WHAT THESE TESTS DO NOT CLAIM. The three spike inputs the ticket names
 * (`subject_iphone.MOV`, `background_zoom.mp4`) have never been copied to this
 * machine, so no test here has touched a genuine iPhone capture. What is
 * generated instead carries the same structural hazards — seven streams, HEVC
 * Main 10, a display matrix, a bitrate below the floor — which is the part the
 * code can actually be wrong about.
 */

const proxy = require('../../workers/studio/proxy.js');
const {
  buildDerivatives,
  formatDerivativesReport,
  measureDecode,
  decideProxy,
  sourceBitrate,
  isDirectlyUsable,
  primaryVideoStream,
  proxyArgs,
  analysisAudioArgs,
  contactSheetArgs,
  sheetRate,
  encodeTimeoutMs,
  runFfmpeg,
  resolveDecodeMode,
  parseBenchmark,
  derivedPathsFor,
  resolveDerivedDir,
  safeSegment,
  artifactIsGood,
  sweepPartFiles,
  ACTIONS,
  SKIP_REASONS,
  ENCODE_REASONS,
  BITRATE_BASIS,
  FAILURES,
  MEASURE_UNAVAILABLE,
  DEFAULT_FLOOR_KBPS,
  MANIFEST_VERSION,
  HWACCEL,
} = proxy;

// ---------------------------------------------------------------------------
// ffprobe JSON, written out. Shapes and spellings copied from real ffprobe 9.
// ---------------------------------------------------------------------------

function videoStream(extra = {}) {
  return {
    index: 0,
    codec_name: 'h264',
    codec_type: 'video',
    width: 1920,
    height: 1080,
    pix_fmt: 'yuv420p',
    avg_frame_rate: '30/1',
    r_frame_rate: '30/1',
    ...extra,
  };
}

function audioStream(extra = {}) {
  return {
    index: 1,
    codec_name: 'aac',
    codec_type: 'audio',
    avg_frame_rate: '0/0',
    r_frame_rate: '0/0',
    ...extra,
  };
}

function metadataStream(index) {
  return {
    index,
    codec_type: 'data',
    codec_tag_string: 'mebx',
    avg_frame_rate: '0/0',
    r_frame_rate: '0/0',
    tags: { handler_name: 'Core Media Metadata' },
  };
}

function probeJson({ streams, format } = {}) {
  return {
    streams: streams || [videoStream(), audioStream()],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '60.000000', ...format },
  };
}

// ---------------------------------------------------------------------------
// Reading the bitrate
// ---------------------------------------------------------------------------

test('the video track\'s own bitrate is preferred, and it says so', () => {
  const out = sourceBitrate(probeJson({ streams: [videoStream({ bit_rate: '8000000' }), audioStream({ bit_rate: '128000' })] }));
  assert.equal(out.kbps, 8000);
  assert.equal(out.basis, BITRATE_BASIS.VIDEO_STREAM);
});

test('a container that only knows its own total has the sound subtracted', () => {
  const out = sourceBitrate(probeJson({
    streams: [videoStream(), audioStream({ bit_rate: '128000' })],
    format: { bit_rate: '2128000' },
  }));
  assert.equal(out.kbps, 2000);
  assert.equal(out.basis, BITRATE_BASIS.CONTAINER_LESS_AUDIO);
});

test('an unknown audio bitrate leaves the container figure alone rather than guessing', () => {
  const out = sourceBitrate(probeJson({ streams: [videoStream(), audioStream()], format: { bit_rate: '2000000' } }));
  assert.equal(out.kbps, 2000);
  assert.equal(out.basis, BITRATE_BASIS.CONTAINER);
});

test('with no bitrate anywhere it is worked out from size and length, and says which', () => {
  const out = sourceBitrate(probeJson({ format: { size: '75000000', duration: '60.000000' } }));
  assert.equal(out.kbps, 10000);
  assert.equal(out.basis, BITRATE_BASIS.SIZE_AND_DURATION);
});

test('an unmeasurable file reports NULL, never zero', () => {
  // A zero here reads as "below the floor" and would skip the proxy on a file
  // nobody has measured at all — the exact shape of a confident wrong answer.
  const out = sourceBitrate(probeJson({ format: {} }));
  assert.equal(out.kbps, null);
  assert.equal(out.basis, null);
});

test('sourceBitrate survives rubbish without throwing', () => {
  for (const junk of [null, undefined, 42, 'nope', {}, { streams: 'no' }]) {
    assert.equal(sourceBitrate(junk).kbps, null);
  }
});

// ---------------------------------------------------------------------------
// Which track is the picture
// ---------------------------------------------------------------------------

test('the picture is found by type, not by being stream 0', () => {
  const streams = [metadataStream(0), metadataStream(1), videoStream({ index: 2 }), audioStream({ index: 3 })];
  assert.equal(primaryVideoStream(streams).index, 2);
});

test('five Core Media Metadata tracks do not blank the geometry', () => {
  const streams = [videoStream(), audioStream(), ...[2, 3, 4, 5, 6].map(metadataStream)];
  const video = primaryVideoStream(streams);
  assert.equal(video.width, 1920);
  assert.equal(streams.length, 7);
});

test('cover art is not the picture', () => {
  const art = videoStream({ index: 0, codec_name: 'mjpeg', avg_frame_rate: '0/0', r_frame_rate: '0/0', disposition: { attached_pic: 1 } });
  const real = videoStream({ index: 2 });
  assert.equal(primaryVideoStream([art, audioStream(), real]).index, 2);
});

test('an audio file whose only video stream is cover art has no picture at all', () => {
  const art = videoStream({ codec_name: 'mjpeg', avg_frame_rate: '0/0', r_frame_rate: '0/0', disposition: { attached_pic: 1 } });
  assert.equal(primaryVideoStream([art, audioStream()]), null);
});

// ---------------------------------------------------------------------------
// The skip-the-proxy rule
// ---------------------------------------------------------------------------

test('a source above the floor is proxied, with the number it was decided on', () => {
  const out = decideProxy({ probeJson: probeJson({ streams: [videoStream({ bit_rate: '8000000' }), audioStream()] }) });
  assert.equal(out.encode, true);
  assert.equal(out.reason, ENCODE_REASONS.ABOVE_FLOOR);
  assert.equal(out.bitrateKbps, 8000);
  assert.equal(out.floorKbps, DEFAULT_FLOOR_KBPS);
});

test('the Zoom case: 268 kbps of 8-bit H.264 is used directly, with the reason', () => {
  const out = decideProxy({ probeJson: probeJson({ streams: [videoStream({ bit_rate: '268000' }), audioStream()] }) });
  assert.equal(out.encode, false);
  assert.equal(out.reason, SKIP_REASONS.BELOW_FLOOR);
  assert.equal(out.bitrateKbps, 268);
});

test('exactly at the floor is a skip — the boundary is stated, not left to a reader', () => {
  const at = decideProxy({ probeJson: probeJson({ streams: [videoStream({ bit_rate: '1500000' }), audioStream()] }) });
  assert.equal(at.encode, false, 'at the floor: used directly');
  const above = decideProxy({ probeJson: probeJson({ streams: [videoStream({ bit_rate: '1501000' }), audioStream()] }) });
  assert.equal(above.encode, true, 'one kbps above the floor: proxied');
});

test('the floor can be moved, and moving it moves the verdict', () => {
  const json = probeJson({ streams: [videoStream({ bit_rate: '2000000' }), audioStream()] });
  assert.equal(decideProxy({ probeJson: json }).encode, true);
  assert.equal(decideProxy({ probeJson: json, floorKbps: 4000 }).encode, false);
});

test('a small 10-bit HEVC clip is STILL proxied — the floor only releases ordinary files', () => {
  // The second guard, and the one a bitrate-only rule gets wrong: this file is
  // tiny and unplayable in half the things downstream.
  const out = decideProxy({
    probeJson: probeJson({ streams: [videoStream({ codec_name: 'hevc', pix_fmt: 'yuv420p10le', bit_rate: '400000' }), audioStream()] }),
  });
  assert.equal(out.encode, true);
  assert.equal(out.reason, ENCODE_REASONS.NOT_DIRECTLY_USABLE);
  assert.equal(out.directlyUsable, false);
});

test('10-bit H.264 is not ordinary either — High 10 is what browsers refuse', () => {
  const out = decideProxy({ probeJson: probeJson({ streams: [videoStream({ pix_fmt: 'yuv420p10le', bit_rate: '200000' }), audioStream()] }) });
  assert.equal(out.encode, true);
  assert.equal(out.reason, ENCODE_REASONS.NOT_DIRECTLY_USABLE);
});

test('an unreadable bitrate proxies rather than skipping, and records that it was not a reading', () => {
  const out = decideProxy({ probeJson: probeJson({ streams: [videoStream(), audioStream()], format: {} }) });
  assert.equal(out.encode, true);
  assert.equal(out.reason, ENCODE_REASONS.BITRATE_UNKNOWN);
  assert.equal(out.bitrateKbps, null);
});

test('no picture track is a named skip, never a proxy of nothing', () => {
  const out = decideProxy({ probeJson: probeJson({ streams: [audioStream()] }) });
  assert.equal(out.encode, false);
  assert.equal(out.reason, SKIP_REASONS.NO_VIDEO);
});

test('"already ordinary" is an allowlist, so an unfamiliar pixel format is proxied rather than waved through', () => {
  assert.equal(isDirectlyUsable(videoStream()), true, 'yuv420p');
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'yuvj420p' })), true, 'the JPEG-range spelling');
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'nv12' })), true);
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'yuv420p10le' })), false, '10-bit');
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'yuv422p10le' })), false, '10-bit 4:2:2');
  // The one that broke the first implementation: VideoToolbox's own 10-bit
  // format, and therefore exactly what an Apple pipeline hands over. A
  // "ten bits or more" pattern reads correctly and lets this straight through.
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'p010le' })), false, 'p010le is 10-bit');
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'yuv422p' })), false, '8-bit 4:2:2 is still a profile Safari refuses');
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: 'yuv444p' })), false);
  assert.equal(isDirectlyUsable(videoStream({ pix_fmt: '' })), false, 'an unread pixel format is not a promise');
  assert.equal(isDirectlyUsable(videoStream({ codec_name: 'prores' })), false);
  assert.equal(isDirectlyUsable(videoStream({ codec_name: 'hevc' })), false);
  assert.equal(isDirectlyUsable(null), false);
});

// ---------------------------------------------------------------------------
// The ffmpeg command lines
// ---------------------------------------------------------------------------

test('both tracks are mapped by hand, and NEITHER map is optional', () => {
  const args = proxyArgs({ input: 'in.mov', output: 'out.mp4', hasAudio: true }).join(' ');
  assert.match(args, /-map 0:v:0/);
  assert.match(args, /-map 0:a:0(?!\?)/);
  assert.equal(args.includes('0:a:0?'), false, 'a trailing ? turns a missing sound track into a silent video-only run');
  assert.equal(args.includes('0:v:0?'), false);
});

test('a source with no sound gets no audio map at all, rather than an optional one', () => {
  const args = proxyArgs({ input: 'in.mov', output: 'out.mp4', hasAudio: false }).join(' ');
  assert.match(args, /-map 0:v:0/);
  assert.equal(args.includes('0:a'), false);
});

test('the proxy is always written 8-bit — the High 10 trap', () => {
  const args = proxyArgs({ input: 'in.mov', output: 'out.mp4', hasAudio: true });
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
});

test('every output names its muxer, because the file it writes is called .part', () => {
  // Without this, every single encode failed with "Unable to choose an output
  // format" — the `.part` extension ffmpeg cannot infer anything from.
  assert.equal(proxyArgs({ input: 'i', output: 'o', hasAudio: true }).includes('-f'), true);
  assert.match(proxyArgs({ input: 'i', output: 'o', hasAudio: true }).join(' '), /-f mp4/);
  assert.match(analysisAudioArgs({ input: 'i', output: 'o' }).join(' '), /-f wav/);
  assert.match(contactSheetArgs({ input: 'i', output: 'o', durationSec: 10 }).join(' '), /-f image2/);
});

test('the analysis WAV is exactly what speech recognition asks for', () => {
  const args = analysisAudioArgs({ input: 'in.mov', output: 'out.wav' });
  assert.equal(args[args.indexOf('-ar') + 1], '16000');
  assert.equal(args[args.indexOf('-ac') + 1], '1');
  assert.equal(args[args.indexOf('-c:a') + 1], 'pcm_s16le');
  assert.equal(args.includes('-vn'), true);
  assert.match(args.join(' '), /-map 0:a:0/);
});

test('hardware decode is asked for only when it was asked for', () => {
  assert.equal(proxyArgs({ input: 'i', output: 'o', hasAudio: true }).includes('-hwaccel'), false);
  assert.match(proxyArgs({ input: 'i', output: 'o', hasAudio: true, decodeMode: 'hardware' }).join(' '), new RegExp(`-hwaccel ${HWACCEL}`));
});

test('the contact sheet spreads twelve stills over the WHOLE clip, as an exact fraction', () => {
  assert.equal(sheetRate(30), '12/30');
  assert.equal(sheetRate(3600), '12/3600');
  // A rounded decimal is short by a frame on a long clip, which produces an
  // eleven-tile sheet with a blank corner and no explanation anywhere.
  assert.equal(sheetRate(3600).includes('.'), false);
});

test('a clip with no readable duration falls back to one still every five seconds', () => {
  assert.equal(sheetRate(null), '1/5');
  assert.equal(sheetRate(0), '1/5');
  assert.match(contactSheetArgs({ input: 'i', output: 'o' }).join(' '), /fps=1\/5/);
});

test('the sheet asks for exactly one image out of the tile filter', () => {
  const args = contactSheetArgs({ input: 'i', output: 'o', durationSec: 12 });
  assert.equal(args[args.indexOf('-frames:v') + 1], '1');
  assert.match(args.join(' '), /tile=4x3/);
});

test('an encode gets six times the clip, and never less than a quarter of an hour', () => {
  assert.equal(encodeTimeoutMs(0), 15 * 60 * 1000);
  assert.equal(encodeTimeoutMs(null), 15 * 60 * 1000);
  assert.equal(encodeTimeoutMs(60), 15 * 60 * 1000, 'a one-minute clip still gets the floor');
  assert.equal(encodeTimeoutMs(3600), 6 * 3600 * 1000);
});

// ---------------------------------------------------------------------------
// Running ffmpeg: the four ways it can go
// ---------------------------------------------------------------------------

function fakeRun(result) {
  return () => result;
}

test('an ffmpeg that is not installed is reported as that, not as a failed encode', () => {
  const out = runFfmpeg(['-i', 'x'], { run: fakeRun({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, FAILURES.FFMPEG_MISSING);
});

test('a hung encode times out and says how long it waited', () => {
  const out = runFfmpeg(['-i', 'x'], { run: fakeRun({ signal: 'SIGTERM', status: null }), timeoutMs: 90_000 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, FAILURES.FFMPEG_TIMEOUT);
  assert.match(out.detail, /90s/);
});

test("a refusal keeps ffmpeg's own complaint verbatim", () => {
  const out = runFfmpeg(['-i', 'x'], { run: fakeRun({ status: 1, stderr: 'Invalid data found when processing input' }) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, FAILURES.FFMPEG_FAILED);
  assert.match(out.detail, /Invalid data found/);
});

test('a clean run reports how long it took', () => {
  let t = 1000;
  const out = runFfmpeg(['-i', 'x'], { run: fakeRun({ status: 0, stderr: '' }), clock: () => (t += 250) });
  assert.equal(out.ok, true);
  assert.equal(out.ms, 250);
});

// ---------------------------------------------------------------------------
// Hardware decode: three outcomes, never two
// ---------------------------------------------------------------------------

test("a machine with no hardware decoder has not measured that hardware is slow — it has measured NOTHING", () => {
  const run = (bin, args) => {
    if (args.includes('-hwaccels')) return { status: 0, stdout: 'Hardware acceleration methods:\n' };
    return { status: 0, stderr: 'bench: utime=6.000s stime=0.100s rtime=2.000s' };
  };
  const out = measureDecode('/tmp/x.mov', { run });
  assert.equal(out.ok, false);
  assert.equal(out.reason, MEASURE_UNAVAILABLE.NOT_BUILT);
  assert.equal(out.hardware, undefined, 'no number is invented for the side that was never run');
  assert.equal(out.software.ok, true, 'the half that COULD be measured is still reported');
});

test('a real reading reports both clocks and both CPU figures', () => {
  let call = 0;
  const run = (bin, args) => {
    if (args.includes('-hwaccels')) return { status: 0, stdout: `Hardware acceleration methods:\n${HWACCEL}\n` };
    call += 1;
    return call === 1
      ? { status: 0, stderr: 'bench: utime=6.749s stime=0.101s rtime=2.039s' }
      : { status: 0, stderr: 'bench: utime=0.903s stime=0.267s rtime=1.984s' };
  };
  const out = measureDecode('/tmp/x.mov', { run });
  assert.equal(out.ok, true);
  assert.equal(out.software.cpuSec, 6.85);
  assert.equal(out.hardware.cpuSec, 1.17);
  assert.equal(out.cheaperByCpu, 'hardware');
  assert.ok(out.cpuRatio > 5, 'the CPU saving is the finding, and it is reported as a ratio');
});

test('an ffmpeg that cannot be run at all is a missing tool, not a slow GPU', () => {
  const out = measureDecode('/tmp/x.mov', { run: fakeRun({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) }) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, MEASURE_UNAVAILABLE.NO_TOOL);
});

test("ffmpeg's benchmark line is read for CPU time, and rubbish does not throw", () => {
  assert.deepEqual(parseBenchmark('bench: utime=6.749s stime=0.101s rtime=2.039s'), { cpuSec: 6.85, rtimeSec: 2.039 });
  assert.equal(parseBenchmark('nothing here'), null);
  assert.equal(parseBenchmark(undefined), null);
});

test('asking for hardware on a machine that has none decodes in software AND SAYS SO', () => {
  const run = (bin, args) => (args.includes('-hwaccels') ? { status: 0, stdout: 'Hardware acceleration methods:\n' } : { status: 0 });
  const out = resolveDecodeMode('hardware', { run });
  assert.equal(out.mode, 'software');
  assert.equal(out.fellBack, true);
  assert.match(out.detail, new RegExp(HWACCEL));
});

test('software is the default, and it is a decision rather than an absence', () => {
  assert.equal(resolveDecodeMode(undefined, { run: fakeRun({ status: 0, stdout: '' }) }).mode, 'software');
  assert.equal(resolveDecodeMode('', { run: fakeRun({ status: 0, stdout: '' }) }).mode, 'software');
});

// ---------------------------------------------------------------------------
// Where things are written
// ---------------------------------------------------------------------------

test('one folder per source, one deterministic name per derivative', () => {
  const p = derivedPathsFor({ derivedDir: '/d', key: 'abc123', lane: 'inbox' });
  assert.equal(p.dir, path.join('/d', 'inbox', 'abc123'));
  assert.equal(path.basename(p.proxy), 'proxy.mp4');
  assert.equal(path.basename(p.audio), 'analysis-16k.wav');
  assert.equal(path.basename(p.contactSheet), 'contact-sheet.jpg');
  // Deterministic names ARE "no duplicate files": nothing here can invent
  // `proxy (1).mp4`.
  assert.deepEqual(derivedPathsFor({ derivedDir: '/d', key: 'abc123', lane: 'inbox' }), p);
});

test('a key cannot write outside its own folder, and no run of dots survives anywhere', () => {
  assert.equal(safeSegment('..'), '');
  assert.equal(safeSegment('a/b'), 'a-b');
  assert.equal(safeSegment('.hidden'), 'hidden');
  assert.equal(safeSegment('1AbC_-.mov'), '1AbC_-.mov');
  for (const nasty of ['../../etc', '..', './../x', 'a/../../b']) {
    assert.equal(safeSegment(nasty).includes('..'), false, `safeSegment(${nasty}) kept a dot run`);
  }
  const p = derivedPathsFor({ derivedDir: '/d', key: '../../escape', lane: '../x' });
  assert.equal(p.dir.startsWith(`${path.join('/d')}${path.sep}`), true, p.dir);
  assert.equal(p.dir.includes('..'), false);
  assert.equal(path.relative('/d', p.dir).startsWith('..'), false, 'the folder is inside the derived root');
});

test('the derived folder is beside the ingest cache, and both can be pointed elsewhere', () => {
  assert.equal(resolveDerivedDir({ derivedDir: '/somewhere' }, {}), '/somewhere');
  assert.equal(resolveDerivedDir({}, { STUDIO_DERIVED_DIR: '/env' }), '/env');
  assert.equal(resolveDerivedDir({}, {}), path.join(os.homedir(), 'Studio', 'derived'));
});

// ---------------------------------------------------------------------------
// Is what is on disk still good?
// ---------------------------------------------------------------------------

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-proxy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('an artifact is reused only when the source AND the file are unchanged', (t) => {
  const dir = tmpDir(t);
  const out = path.join(dir, 'proxy.mp4');
  fs.writeFileSync(out, 'x'.repeat(100));
  const fingerprint = { path: '/src.mov', sizeBytes: 1000, mtimeMs: 5 };
  const manifest = { version: MANIFEST_VERSION, source: fingerprint, outputs: { proxy: { action: ACTIONS.ENCODED, bytes: 100 } } };

  assert.equal(artifactIsGood(manifest, 'proxy', fingerprint, out), true);
  assert.equal(artifactIsGood(manifest, 'proxy', { ...fingerprint, sizeBytes: 2000 }, out), false, 'the source changed size');
  assert.equal(artifactIsGood(manifest, 'proxy', { ...fingerprint, mtimeMs: 9 }, out), false, 'the source was rewritten');
  assert.equal(artifactIsGood({ ...manifest, version: 0 }, 'proxy', fingerprint, out), false, 'an older manifest shape rebuilds');
  assert.equal(artifactIsGood(manifest, 'audio', fingerprint, out), false, 'nothing was recorded for this output');
  assert.equal(artifactIsGood(null, 'proxy', fingerprint, out), false);
});

test('a TRUNCATED artifact is not reused — the shape that passes an existence check and fails to play', (t) => {
  const dir = tmpDir(t);
  const out = path.join(dir, 'proxy.mp4');
  fs.writeFileSync(out, 'x'.repeat(40));
  const fingerprint = { path: '/src.mov', sizeBytes: 1000, mtimeMs: 5 };
  const manifest = { version: MANIFEST_VERSION, source: fingerprint, outputs: { proxy: { action: ACTIONS.ENCODED, bytes: 100 } } };
  assert.equal(artifactIsGood(manifest, 'proxy', fingerprint, out), false);
});

test('a SKIPPED output stays skipped without a file to check', () => {
  const fingerprint = { path: '/src.mov', sizeBytes: 1000, mtimeMs: 5 };
  const manifest = { version: MANIFEST_VERSION, source: fingerprint, outputs: { proxy: { action: ACTIONS.SKIPPED, reason: SKIP_REASONS.BELOW_FLOOR } } };
  assert.equal(artifactIsGood(manifest, 'proxy', fingerprint, '/nowhere/proxy.mp4'), true);
});

test('half-written files from a dead run are swept, and nothing else is', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'proxy.mp4.part'), 'half');
  fs.writeFileSync(path.join(dir, 'analysis-16k.wav.part'), 'half');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  const swept = sweepPartFiles(dir);
  assert.equal(swept.length, 2);
  assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  assert.deepEqual(sweepPartFiles(path.join(dir, 'not-there')), [], 'a folder that does not exist is not an error');
});

// ---------------------------------------------------------------------------
// The run report
// ---------------------------------------------------------------------------

test('every "nothing was made" line says WHICH nothing it is', () => {
  const lines = formatDerivativesReport({
    ok: true,
    sourcePath: '/x/clip.mov',
    outDir: '/d/inbox/k',
    outputs: {
      proxy: { action: ACTIONS.SKIPPED, reason: SKIP_REASONS.BELOW_FLOOR, bitrateKbps: 268, floorKbps: 1500 },
      audio: { action: ACTIONS.SKIPPED, reason: SKIP_REASONS.NO_AUDIO },
      contactSheet: { action: ACTIONS.SKIPPED, reason: SKIP_REASONS.NO_VIDEO },
    },
  }).join('\n');
  assert.match(lines, /268 kbps/);
  assert.match(lines, /1500 kbps floor/);
  assert.match(lines, /original is used directly/);
  assert.match(lines, /no sound track/);
  assert.match(lines, /no picture track/);
});

test('a sheet built on the fallback rate warns that it does not cover the clip', () => {
  const lines = formatDerivativesReport({
    ok: true, sourcePath: '/x/clip.mov', outDir: '/d',
    outputs: { contactSheet: { action: ACTIONS.ENCODED, coversWholeClip: false } },
  }).join('\n');
  assert.match(lines, /WARNING/);
  assert.match(lines, /opening minute/);
});

test('a failure names the output, the reason and ffmpeg\'s own words', () => {
  const lines = formatDerivativesReport({
    ok: false, sourcePath: '/x/clip.mov', outDir: '/d',
    outputs: { proxy: { action: ACTIONS.FAILED, reason: FAILURES.FFMPEG_FAILED, detail: 'Invalid data found' } },
  }).join('\n');
  assert.match(lines, /proxy: FAILED/);
  assert.match(lines, /Invalid data found/);
});

// ---------------------------------------------------------------------------
// Real media, real ffmpeg
// ---------------------------------------------------------------------------

const FFMPEG = process.env.STUDIO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.STUDIO_FFPROBE || 'ffprobe';

function toolWorks(bin) {
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return !res.error && Number(res.status) === 0;
}

function hasEncoder(name) {
  const res = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (res.error || Number(res.status) !== 0) return false;
  return String(res.stdout).includes(name);
}

const HAVE_FFMPEG = toolWorks(FFMPEG) && toolWorks(FFPROBE);
const HAVE_X265 = HAVE_FFMPEG && hasEncoder('libx265');

test('ffmpeg, ffprobe and libx265 are installed, or the real-media proof below is not being taken', () => {
  // A SKIP NOBODY SEES IS A PASS THAT PROVED NOTHING. Every criterion on this
  // ticket is about what really comes out of ffmpeg, so missing tools are RED
  // with an instruction rather than a quiet green board. libx265 is in the
  // list because the HEVC Main 10 criterion cannot be checked without it — and
  // a machine that silently skipped that one would be claiming the hardest
  // half of this slice works.
  if (process.env.STUDIO_ALLOW_NO_FFMPEG === '1') {
    assert.ok(true, 'waived by STUDIO_ALLOW_NO_FFMPEG=1');
    return;
  }
  assert.ok(HAVE_FFMPEG,
    `ffmpeg/ffprobe not runnable (${FFMPEG} / ${FFPROBE}). `
    + 'Install it — macOS: `brew install ffmpeg`, Debian/Ubuntu/CI: `sudo apt-get install -y ffmpeg` — '
    + 'or set STUDIO_ALLOW_NO_FFMPEG=1 to say out loud that this machine is not taking the reading.');
  assert.ok(HAVE_X265, 'this ffmpeg has no libx265, so the HEVC Main 10 criterion cannot be checked here.');
});

function ffmpeg(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
}

function probeOf(file, entries) {
  const res = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', ...entries, file], { encoding: 'utf8' });
  assert.equal(Number(res.status), 0, res.stderr);
  return JSON.parse(res.stdout);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** A 1080p H.264 clip with sound — an ordinary capture, well above the floor. */
function makeBigH264(dir, name = 'big.mp4', duration = 2) {
  const out = path.join(dir, name);
  ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    out,
  ]);
  return out;
}

/** HEVC Main 10 — what an iPhone writes, and what browsers refuse to play. */
function makeHevcMain10(dir, name = 'iphone-ish.mov', duration = 1) {
  const out = path.join(dir, name);
  ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
    '-c:v', 'libx265', '-crf', '22', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=none',
    '-tag:v', 'hvc1', '-c:a', 'aac',
    out,
  ]);
  return out;
}

test('a real HEVC Main 10 source decodes and comes out as ordinary 8-bit H.264', { skip: !HAVE_X265 && 'ffmpeg without libx265' }, (t) => {
  const dir = tmpDir(t);
  const source = makeHevcMain10(dir);
  const before = probeOf(source, ['-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,profile']);
  assert.equal(before.streams[0].codec_name, 'hevc');
  assert.equal(before.streams[0].pix_fmt, 'yuv420p10le');
  assert.equal(before.streams[0].profile, 'Main 10');

  const out = buildDerivatives({ sourcePath: source, key: 'hevc10', derivedDir: path.join(dir, 'derived') });
  assert.equal(out.ok, true, JSON.stringify(out.failures));
  assert.equal(out.outputs.proxy.action, ACTIONS.ENCODED);
  // Small AND 10-bit: the bitrate floor alone would have skipped it.
  assert.equal(out.decision.reason, ENCODE_REASONS.NOT_DIRECTLY_USABLE);

  const after = probeOf(out.outputs.proxy.path, ['-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt']);
  assert.equal(after.streams[0].codec_name, 'h264');
  assert.equal(after.streams[0].pix_fmt, 'yuv420p', 'a High 10 proxy is a black rectangle in Safari');
});

test('a real seven-stream file is proxied without touching the five extra tracks', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const base = makeBigH264(dir, 'base.mov', 1);
  const srt = path.join(dir, 'track.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nx\n\n');
  const seven = path.join(dir, 'seven.mov');
  // ffmpeg cannot write `mebx` Core Media Metadata tracks, so the five extra
  // tracks are timed text. The hazard is identical — five tracks with no
  // width and no frame rate that a naive invocation either chokes on or
  // carries into the output.
  ffmpeg(['-i', base, '-i', srt,
    '-map', '1', '-map', '1', '-map', '1', '-map', '1', '-map', '1', '-map', '0:v', '-map', '0:a',
    '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', seven]);
  const sourceBefore = sha256(seven);
  assert.equal(probeOf(seven, ['-show_entries', 'stream=index']).streams.length, 7);

  const out = buildDerivatives({ sourcePath: seven, key: 'seven', derivedDir: path.join(dir, 'derived') });
  assert.equal(out.ok, true, JSON.stringify(out.failures));

  const streams = probeOf(out.outputs.proxy.path, ['-show_entries', 'stream=index,codec_type']).streams;
  assert.equal(streams.length, 2, 'exactly the picture and the sound, never the five extra tracks');
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  assert.equal(sha256(seven), sourceBefore, 'the source file was never written to');
});

test('a source below the floor is used directly — and the proxy really would have been bigger', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  // The ticket's own case: 1080p, low bitrate, ordinary H.264.
  const source = path.join(dir, 'zoom-ish.mp4');
  ffmpeg([
    '-f', 'lavfi', '-i', 'smptebars=size=1920x1080:rate=25:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
    '-c:v', 'libx264', '-b:v', '268k', '-maxrate', '300k', '-bufsize', '600k',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', source,
  ]);

  const out = buildDerivatives({ sourcePath: source, key: 'zoomish', derivedDir: path.join(dir, 'derived') });
  assert.equal(out.ok, true, JSON.stringify(out.failures));
  assert.equal(out.outputs.proxy.action, ACTIONS.SKIPPED);
  assert.equal(out.outputs.proxy.reason, SKIP_REASONS.BELOW_FLOOR);
  assert.equal(out.outputs.proxy.path, source, 'downstream reads the original, and the field is never left empty');
  assert.equal(out.outputs.proxy.usedSourceDirectly, true);
  assert.equal(fs.existsSync(path.join(out.outDir, 'proxy.mp4')), false, 'no proxy was written at all');
  // The sound and the sheet are still made — the skip is about the proxy only.
  assert.equal(out.outputs.audio.action, ACTIONS.ENCODED);
  assert.equal(out.outputs.contactSheet.action, ACTIONS.ENCODED);

  // AND THE RULE EARNS ITS KEEP: encode it anyway and measure.
  const wouldBe = path.join(dir, 'would-be-proxy.mp4');
  ffmpeg([...proxyArgs({ input: source, output: wouldBe, hasAudio: true }).slice(4)]);
  assert.ok(fs.statSync(wouldBe).size > fs.statSync(source).size,
    `a 720p CRF 28 copy of this source is ${fs.statSync(wouldBe).size} bytes against the source's ${fs.statSync(source).size} — `
    + 'if this ever stops being true the floor is wrong and should be re-measured');
});

test('re-running produces byte-identical output, reuses rather than re-encodes, and leaves no extra files', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = makeBigH264(dir, 'big.mp4', 2);
  const derivedDir = path.join(dir, 'derived');

  const first = buildDerivatives({ sourcePath: source, key: 'idem', derivedDir });
  assert.equal(first.ok, true, JSON.stringify(first.failures));
  assert.equal(first.outputs.proxy.action, ACTIONS.ENCODED);
  const names = fs.readdirSync(first.outDir).sort();
  // The three DERIVATIVES must be identical. The manifest deliberately is not:
  // it records how long each encode took and that the second run reused rather
  // than encoded, which is the difference it exists to report.
  const media = ['proxy.mp4', 'analysis-16k.wav', 'contact-sheet.jpg'];
  const hashes = media.map((n) => sha256(path.join(first.outDir, n)));

  const second = buildDerivatives({ sourcePath: source, key: 'idem', derivedDir });
  assert.equal(second.ok, true, JSON.stringify(second.failures));
  assert.equal(second.outputs.proxy.action, ACTIONS.REUSED);
  assert.equal(second.outputs.audio.action, ACTIONS.REUSED);
  assert.equal(second.outputs.contactSheet.action, ACTIONS.REUSED);

  assert.deepEqual(fs.readdirSync(second.outDir).sort(), names, 'no duplicate files, and none left over');
  assert.deepEqual(media.map((n) => sha256(path.join(second.outDir, n))), hashes, 'identical bytes');
  assert.equal(names.length, 4, 'three derivatives and one manifest');
});

test('two encodes of the same source are byte-identical, so "identical" is checkable and not just asserted', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = makeBigH264(dir, 'big.mp4', 1);
  const a = buildDerivatives({ sourcePath: source, key: 'k', derivedDir: path.join(dir, 'one') });
  const b = buildDerivatives({ sourcePath: source, key: 'k', derivedDir: path.join(dir, 'two') });
  assert.equal(a.ok && b.ok, true);
  for (const name of ['proxy.mp4', 'analysis-16k.wav', 'contact-sheet.jpg']) {
    assert.equal(sha256(path.join(a.outDir, name)), sha256(path.join(b.outDir, name)), `${name} differs between two runs`);
  }
});

test('a half-written file from a dead run is swept and never becomes the output', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = makeBigH264(dir, 'big.mp4', 1);
  const derivedDir = path.join(dir, 'derived');
  const paths = derivedPathsFor({ derivedDir, key: 'crashed', lane: 'inbox' });
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(`${paths.proxy}.part`, 'this is not a video');

  const out = buildDerivatives({ sourcePath: source, key: 'crashed', derivedDir });
  assert.equal(out.ok, true, JSON.stringify(out.failures));
  assert.ok(out.sweptParts.includes('proxy.mp4.part'), 'the dead run\'s leftovers are named in the report');
  assert.equal(fs.existsSync(`${paths.proxy}.part`), false);
  const streams = probeOf(paths.proxy, ['-show_entries', 'stream=codec_type']).streams;
  assert.equal(streams.length, 2, 'the real proxy was written, not the junk');
});

test('a truncated proxy is rebuilt rather than reused', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = makeBigH264(dir, 'big.mp4', 1);
  const derivedDir = path.join(dir, 'derived');
  const first = buildDerivatives({ sourcePath: source, key: 'trunc', derivedDir });
  assert.equal(first.outputs.proxy.action, ACTIONS.ENCODED);
  // A full disk, a power cut after the rename: the file is there and short.
  fs.truncateSync(first.paths.proxy, 500);

  const second = buildDerivatives({ sourcePath: source, key: 'trunc', derivedDir });
  assert.equal(second.outputs.proxy.action, ACTIONS.ENCODED, 'a short file is not a finished one');
  assert.equal(fs.statSync(second.paths.proxy).size, first.outputs.proxy.bytes);
});

test('an edited source rebuilds everything, rather than serving the old working copy forever', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = path.join(dir, 'clip.mp4');
  fs.copyFileSync(makeBigH264(dir, 'a.mp4', 1), source);
  const derivedDir = path.join(dir, 'derived');
  const first = buildDerivatives({ sourcePath: source, key: 'edited', derivedDir });
  assert.equal(first.outputs.proxy.action, ACTIONS.ENCODED);

  fs.copyFileSync(makeBigH264(dir, 'b.mp4', 2), source);
  const second = buildDerivatives({ sourcePath: source, key: 'edited', derivedDir });
  assert.equal(second.outputs.proxy.action, ACTIONS.ENCODED);
  assert.equal(second.outputs.audio.action, ACTIONS.ENCODED);
});

test('a source with no sound gets no WAV, and says which kind of nothing that is', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const silent = path.join(dir, 'silent.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6000k', '-pix_fmt', 'yuv420p', silent]);

  const out = buildDerivatives({ sourcePath: silent, key: 'silent', derivedDir: path.join(dir, 'derived') });
  assert.equal(out.ok, true, JSON.stringify(out.failures));
  assert.equal(out.outputs.audio.action, ACTIONS.SKIPPED);
  assert.equal(out.outputs.audio.reason, SKIP_REASONS.NO_AUDIO);
  assert.equal(out.outputs.proxy.action, ACTIONS.ENCODED, 'the picture is still worth a working copy');
  const streams = probeOf(out.outputs.proxy.path, ['-show_entries', 'stream=codec_type']).streams;
  assert.equal(streams.length, 1, 'no silent audio track was invented');
});

test('a sound-only source gets its WAV and a named skip for the two picture outputs', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const audioOnly = path.join(dir, 'interview.m4a');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', audioOnly]);

  const out = buildDerivatives({ sourcePath: audioOnly, key: 'audio-only', derivedDir: path.join(dir, 'derived') });
  assert.equal(out.ok, true, JSON.stringify(out.failures));
  assert.equal(out.outputs.audio.action, ACTIONS.ENCODED);
  assert.equal(out.outputs.proxy.action, ACTIONS.SKIPPED);
  assert.equal(out.outputs.proxy.reason, SKIP_REASONS.NO_VIDEO);
  assert.equal(out.outputs.contactSheet.action, ACTIONS.SKIPPED);
  assert.equal(out.outputs.contactSheet.reason, SKIP_REASONS.NO_VIDEO);
});

test('the WAV really is 16 kHz mono PCM, whatever the source was', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = path.join(dir, 'stereo48.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-ar', '48000', source]);

  const out = buildDerivatives({ sourcePath: source, key: 'wav', derivedDir: path.join(dir, 'derived') });
  const wav = probeOf(out.outputs.audio.path, ['-show_entries', 'stream=codec_name,sample_rate,channels']).streams[0];
  assert.equal(wav.codec_name, 'pcm_s16le');
  assert.equal(wav.sample_rate, '16000');
  assert.equal(wav.channels, 1);
});

test('an upright phone clip proxies upright, rather than on its side', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const flat = path.join(dir, 'flat.mp4');
  const turned = path.join(dir, 'turned.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8000k', '-pix_fmt', 'yuv420p', flat]);
  // What a phone actually writes: landscape frames with a 90° matrix on them.
  ffmpeg(['-display_rotation:v:0', '90', '-i', flat, '-c', 'copy', turned]);

  const out = buildDerivatives({ sourcePath: turned, key: 'turned', derivedDir: path.join(dir, 'derived') });
  const v = probeOf(out.outputs.proxy.path, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height']).streams[0];
  assert.equal(v.width, 720);
  assert.equal(v.height, 1280, 'the rotation is baked in, so nothing downstream has to honour a matrix');
});

test('a source already smaller than the box is not blown up', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const small = path.join(dir, 'small.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', small]);
  const out = buildDerivatives({ sourcePath: small, key: 'small', derivedDir: path.join(dir, 'derived') });
  const v = probeOf(out.outputs.proxy.path, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height']).streams[0];
  assert.equal(v.width, 640);
  assert.equal(v.height, 360);
});

test('the contact sheet really is twelve stills wide and three tall', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = makeBigH264(dir, 'big.mp4', 3);
  const out = buildDerivatives({ sourcePath: source, key: 'sheet', derivedDir: path.join(dir, 'derived') });
  const img = probeOf(out.outputs.contactSheet.path, ['-show_entries', 'stream=width,height']).streams[0];
  assert.equal(img.width, 320 * 4, 'four tiles across');
  assert.equal(img.height, 180 * 3, 'three tiles down, at 16:9');
});

test('a file that is not media fails with a reason, and writes no derivatives at all', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const notMedia = path.join(dir, 'notes.txt');
  fs.writeFileSync(notMedia, 'this is not a video');
  const derivedDir = path.join(dir, 'derived');
  const out = buildDerivatives({ sourcePath: notMedia, key: 'notes', derivedDir });
  assert.equal(out.ok, false);
  assert.equal(out.reason, FAILURES.SOURCE_UNREADABLE);
  assert.ok(out.detail, 'ffprobe\'s own complaint is kept');
  assert.equal(fs.existsSync(path.join(derivedDir, 'inbox', 'notes')), false, 'nothing is written for a file that could not be read');
});

test('a source that is not there is a missing file, not a failed encode', (t) => {
  const dir = tmpDir(t);
  const out = buildDerivatives({ sourcePath: path.join(dir, 'gone.mov'), key: 'gone', derivedDir: path.join(dir, 'derived') });
  assert.equal(out.ok, false);
  assert.equal(out.reason, FAILURES.SOURCE_MISSING);
});

test('the manifest never names a file that is not on disk', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const source = makeBigH264(dir, 'big.mp4', 1);
  const out = buildDerivatives({ sourcePath: source, key: 'manifest', derivedDir: path.join(dir, 'derived') });
  const manifest = JSON.parse(fs.readFileSync(out.manifestPath, 'utf8'));
  assert.equal(manifest.version, MANIFEST_VERSION);
  for (const [name, record] of Object.entries(manifest.outputs)) {
    if (record.action === ACTIONS.SKIPPED) continue;
    assert.notEqual(record.action, ACTIONS.FAILED, `${name} was written to the manifest as a failure`);
    assert.equal(fs.existsSync(record.path), true, `${name}: the manifest names ${record.path}, which is not there`);
  }
  assert.equal(manifest.decodeMode.used, 'software', 'the decoder that made these files is recorded');
});

test('a real decode measurement is either a reading with both sides or a named "not measured"', { skip: !HAVE_X265 && 'ffmpeg without libx265' }, (t) => {
  const dir = tmpDir(t);
  const source = makeHevcMain10(dir, 'measure.mov', 1);
  const out = measureDecode(source);
  if (out.ok) {
    assert.ok(out.software.ms >= 0 && out.hardware.ms >= 0);
    assert.ok(['hardware', 'software'].includes(out.fasterByClock));
    // The CPU figures are the useful half and both sides must have one.
    assert.equal(typeof out.software.cpuSec, 'number');
    assert.equal(typeof out.hardware.cpuSec, 'number');
  } else {
    assert.ok(Object.values(MEASURE_UNAVAILABLE).includes(out.reason), `unnamed reason: ${out.reason}`);
    assert.equal(out.hardware === undefined || out.hardware.ok === false, true, 'no number is reported for a side that did not run');
  }
});

test('this slice commits no media to git', () => {
  const repo = path.resolve(__dirname, '..', '..');
  const tracked = execFileSync('git', ['ls-files', 'workers/studio', 'scripts/builder'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(mp4|mov|m4v|mkv|avi|webm|wav|m4a|mp3|aac|jpg|jpeg|png)$/i.test(f));
  assert.deepEqual(tracked, [], `media fixtures must be generated at test time, not committed: ${tracked.join(', ')}`);
});
