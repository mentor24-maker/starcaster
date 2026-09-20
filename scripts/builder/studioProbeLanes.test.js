'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

/**
 * Studio Phase 1 · 5 of 8 (86bbjv68w) — probe and device-lane inference.
 *
 * TWO KINDS OF TEST, ON PURPOSE.
 *
 * The first kind runs the inference over ffprobe JSON written out here. That
 * is where the awkward shapes live — an Apple file with no model tag, a video
 * track that is not stream 0, an audio file whose cover art looks like video —
 * because those are the cases a generated fixture cannot reach.
 *
 * The second kind BUILDS REAL MEDIA WITH FFMPEG at test time and probes it
 * with the real ffprobe, which is what the ticket's acceptance criteria
 * require and the only thing that proves the JSON above is the shape ffprobe
 * actually emits. Nothing media-shaped is committed: every fixture is made in
 * a temp directory and deleted when the test finishes.
 *
 * WHAT THE GENERATED FIXTURES CANNOT DO, SAID OUT LOUD: ffmpeg cannot write
 * `mebx` Core Media Metadata tracks, so the real seven-stream file reaches
 * seven streams with five tracks of another kind. That exercises the same
 * structural hazard — five tracks with no width and no frame rate, and a
 * probe that must not assume `streams[0]` — while the `mebx` spelling itself
 * is covered by the written-out case below. The three spike inputs named in
 * the ticket's "How to test" have never been copied to this machine, so no
 * test here claims to have probed a genuine iPhone capture.
 */

const {
  probeFile,
  runFfprobe,
  readProbe,
  inferDeviceLane,
  isUnderFolder,
  parseFrameRate,
  normaliseRotation,
  clockwiseFromDisplayMatrix,
  primaryVideoStream,
  LANES,
  UNKNOWN_REASONS,
  PROBE_FAILURES,
  PLATES_ROOT,
} = require('../../workers/studio/probe.js');

// ---------------------------------------------------------------------------
// ffprobe JSON, written out. Field names and value spellings are copied from
// real ffprobe 9 output (including the space-padded `"qt  "` brand).
// ---------------------------------------------------------------------------

function videoStream(extra = {}) {
  return {
    index: 0,
    codec_name: 'h264',
    codec_type: 'video',
    width: 1920,
    height: 1080,
    avg_frame_rate: '30/1',
    r_frame_rate: '30/1',
    tags: { handler_name: 'Core Media Video' },
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
    tags: { handler_name: 'Core Media Audio' },
    ...extra,
  };
}

/** A Core Media Metadata track: no width, no usable frame rate, `mebx` tag. */
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

function appleProbe({ model = 'iPhone 15 Pro', make = 'Apple', streams, extraTags = {} } = {}) {
  const tags = {
    major_brand: 'qt  ',
    minor_version: '0',
    compatible_brands: 'qt  ',
    creation_time: '2026-08-01T16:34:56.000000Z',
    ...extraTags,
  };
  if (make) tags['com.apple.quicktime.make'] = make;
  if (model) tags['com.apple.quicktime.model'] = model;
  return {
    streams: streams || [videoStream(), audioStream()],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '61.500000', size: '104857600', nb_streams: 2, tags },
  };
}

function zoomProbe(extra = {}) {
  return {
    streams: [
      videoStream({ width: 1280, height: 720, avg_frame_rate: '25/1', r_frame_rate: '25/1', tags: { handler_name: 'VideoHandler', vendor_id: 'FFMP' } }),
      audioStream({ tags: { handler_name: 'SoundHandler', vendor_id: 'FFMP' } }),
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '3600.000000',
      nb_streams: 2,
      tags: { major_brand: 'mp42', minor_version: '512', compatible_brands: 'mp42iso2avc1mp41' },
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The model is read, never guessed
// ---------------------------------------------------------------------------

test('an iPhone names itself and the model is stored exactly as written', () => {
  const placed = inferDeviceLane({ probe: appleProbe({ model: 'iPhone 15 Pro' }) });
  assert.equal(placed.lane, LANES.IPHONE);
  assert.equal(placed.deviceModel, 'iPhone 15 Pro', 'verbatim — not "iphone", not "iPhone15,2"');
  assert.equal(placed.basis, 'device-tag');
  assert.equal(placed.confidence, 'measured', 'the file said so; this is not an inference');
});

test('an iPad is its own lane, off the same tag', () => {
  const placed = inferDeviceLane({ probe: appleProbe({ model: 'iPad Pro (12.9-inch) (6th generation)' }) });
  assert.equal(placed.lane, LANES.IPAD);
  assert.equal(placed.deviceModel, 'iPad Pro (12.9-inch) (6th generation)');
});

test('an Apple file with no model tag is unknown — it never guesses iPhone', () => {
  const probe = appleProbe({ model: null });
  const placed = inferDeviceLane({ probe });
  assert.equal(placed.lane, LANES.UNKNOWN);
  assert.equal(placed.reason, UNKNOWN_REASONS.APPLE_WITHOUT_MODEL);
  assert.equal(placed.deviceMake, 'Apple', 'what WAS read is kept');
  assert.equal(placed.deviceModel, null);
});

test('an Apple model nobody has taught it lands in unknown with the model kept', () => {
  const placed = inferDeviceLane({ probe: appleProbe({ model: 'Apple Vision Pro' }) });
  assert.equal(placed.lane, LANES.UNKNOWN);
  assert.equal(placed.reason, UNKNOWN_REASONS.APPLE_MODEL_UNRECOGNISED);
  assert.equal(placed.deviceModel, 'Apple Vision Pro', 'so a person can decide what it should have been');
});

test('a camera that writes a model and no make is never filed as an unrecognised APPLE one', () => {
  // The GoPro/DJI shape: a bare `model` tag, no `make` at all. Nothing in that
  // file said Apple, so a reason that says "apple_model_unrecognised" is the
  // wrong guess this ticket's own criteria forbid — and it is the string the
  // Footage screen (8/8) prints.
  const probe = { streams: [videoStream(), audioStream()], format: { tags: { model: 'HERO12 Black' } } };
  const placed = inferDeviceLane({ probe });
  assert.equal(placed.lane, LANES.UNKNOWN);
  assert.equal(placed.reason, UNKNOWN_REASONS.MODEL_WITHOUT_MAKE);
  assert.notEqual(placed.reason, UNKNOWN_REASONS.APPLE_MODEL_UNRECOGNISED, 'no maker was named — do not name one');
  assert.equal(placed.deviceMake, null, 'what was NOT read stays empty');
  assert.equal(placed.deviceModel, 'HERO12 Black', 'what WAS read is kept verbatim');
});

test('an unrecognised model keeps saying Apple when the file actually said Apple', () => {
  // The other half of the same rule: the fix must not blank out a maker the
  // file really did write.
  const placed = inferDeviceLane({ probe: appleProbe({ model: 'Apple Vision Pro' }) });
  assert.equal(placed.reason, UNKNOWN_REASONS.APPLE_MODEL_UNRECOGNISED);
  assert.equal(placed.deviceMake, 'Apple');
});

test('another maker is a reading, not a shrug', () => {
  const probe = appleProbe({ make: 'Canon', model: 'EOS R5' });
  const placed = inferDeviceLane({ probe });
  assert.equal(placed.lane, LANES.UNKNOWN);
  assert.equal(placed.reason, UNKNOWN_REASONS.DEVICE_NOT_APPLE);
  assert.equal(placed.deviceMake, 'Canon');
  assert.equal(placed.deviceModel, 'EOS R5');
});

test('tag keys are matched whatever their case, and the value is left alone', () => {
  const probe = { streams: [videoStream()], format: { tags: { 'Com.Apple.QuickTime.Model': 'iPhone 15 Pro' } } };
  assert.equal(inferDeviceLane({ probe }).deviceModel, 'iPhone 15 Pro');
});

// ---------------------------------------------------------------------------
// Zoom and iPhone classify differently; the folder outranks both
// ---------------------------------------------------------------------------

test('a Zoom export and an iPhone capture of the same session land in different lanes', () => {
  const zoom = inferDeviceLane({ probe: zoomProbe() });
  const iphone = inferDeviceLane({ probe: appleProbe() });
  assert.equal(zoom.lane, LANES.ZOOM);
  assert.equal(iphone.lane, LANES.IPHONE);
  assert.notEqual(zoom.lane, iphone.lane);
  assert.equal(zoom.confidence, 'inferred', 'Zoom signs nothing, so the verdict says it is a shape');
  assert.ok(zoom.signals.includes('fps=25'), 'and it shows its working');
});

test('vendor_id is not a device tag — every ffmpeg-written track has one', () => {
  // If "no vendor tags" were read as "no vendor_id field", nothing ffmpeg has
  // ever touched would classify, including the fixtures below.
  assert.equal(inferDeviceLane({ probe: zoomProbe() }).lane, LANES.ZOOM);
});

test('an mp42 container with no audio is not called Zoom', () => {
  const probe = zoomProbe();
  probe.streams = [probe.streams[0]];
  assert.equal(inferDeviceLane({ probe }).lane, LANES.UNKNOWN);
});

test('the folder decides a plate, even when the file carries perfect iPhone tags', () => {
  const placed = inferDeviceLane({
    probe: appleProbe(),
    sourcePath: '/Studio/Plates/keynote-screen-capture.mov',
  });
  assert.equal(placed.lane, LANES.PLATE);
  assert.equal(placed.basis, 'folder');
});

test('a folder that merely starts the same way is not the plates folder', () => {
  const placed = inferDeviceLane({ probe: appleProbe(), sourcePath: '/Studio/PlatesOld/wide.mov' });
  assert.equal(placed.lane, LANES.IPHONE, 'PlatesOld is a different folder');
  assert.equal(isUnderFolder('/Studio/PlatesOld/wide.mov', PLATES_ROOT), false);
  assert.equal(isUnderFolder('/Volumes/Footage/Studio/Plates/a.mov', PLATES_ROOT), true,
    'the folder can sit under anything — a mounted drive, a home directory');
  assert.equal(isUnderFolder('C:\\Studio\\Plates\\a.mov', PLATES_ROOT), true, 'backslashes fold');
  assert.equal(isUnderFolder('', PLATES_ROOT), false);
});

test('the plates folder is the same string the Drive watcher files plates from', () => {
  // Two spellings of one folder is a file the watcher calls a plate and the
  // probe calls an iPhone. Studio 3/8 owns the definition; this is the guard
  // that notices if either side moves.
  const { LANES: DRIVE_LANES } = require('../../workers/studio/drive.js');
  assert.equal(PLATES_ROOT, DRIVE_LANES.plates.path);
});

test('an unrecognised container is unknown and says which kind of unknown', () => {
  const probe = { streams: [videoStream({ tags: {} })], format: { format_name: 'matroska,webm', duration: '10.0', tags: {} } };
  const placed = inferDeviceLane({ probe });
  assert.equal(placed.lane, LANES.UNKNOWN);
  assert.equal(placed.reason, UNKNOWN_REASONS.NO_DEVICE_TAGS);
});

// ---------------------------------------------------------------------------
// Seven streams
// ---------------------------------------------------------------------------

test('seven streams — video, audio and five Core Media Metadata tracks — probe cleanly', () => {
  const streams = [videoStream(), audioStream(), metadataStream(2), metadataStream(3), metadataStream(4), metadataStream(5), metadataStream(6)];
  const probe = appleProbe({ streams });
  const media = readProbe(probe);

  assert.equal(media.streamCount, 7);
  assert.equal(media.streamCounts.data, 5);
  assert.equal(media.width, 1920, 'the geometry comes off the video track');
  assert.equal(media.height, 1080);
  assert.equal(media.fps, 30);
  assert.equal(media.durationSec, 61.5);
  assert.equal(inferDeviceLane({ probe }).lane, LANES.IPHONE);
});

test('the video track is found by type, not by being stream 0', () => {
  const streams = [metadataStream(0), audioStream({ index: 1 }), videoStream({ index: 2, width: 3840, height: 2160 })];
  const media = readProbe({ streams, format: { tags: {} } });
  assert.equal(media.width, 3840, 'a remux that reorders the tracks must not blank the resolution');
  assert.equal(media.streamCounts.video, 1);
});

test('cover art is not the picture', () => {
  // An .m4a with artwork carries a `video` stream that is one still JPEG at a
  // nonsense frame rate. Reporting a podcast as 3000x3000 at 90000fps is how
  // an audio file gets scheduled for a render.
  const art = videoStream({ codec_name: 'mjpeg', width: 3000, height: 3000, avg_frame_rate: '90000/1', disposition: { attached_pic: 1 } });
  const media = readProbe({ streams: [art, audioStream()], format: { duration: '1800.0', tags: {} } });
  assert.equal(media.width, null);
  assert.equal(media.fps, null);
  assert.equal(media.audioCodec, 'aac');
  assert.equal(primaryVideoStream([art]), null);
});

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

test('frame rates parse, including the broken spellings', () => {
  assert.equal(parseFrameRate('25/1'), 25);
  assert.equal(parseFrameRate('30000/1001'), 29.97);
  assert.equal(parseFrameRate('24000/1001'), 23.976);
  assert.equal(parseFrameRate('0/0'), null, 'what an audio track reports');
  assert.equal(parseFrameRate(''), null);
  assert.equal(parseFrameRate('60'), 60);
  assert.equal(parseFrameRate('nonsense'), null);
});

test('normaliseRotation only snaps to 0/90/180/270 — it does not pick a direction', () => {
  // It is deliberately direction-blind: the two spellings ffprobe emits run
  // opposite ways, so the caller supplies the sign. -90 in, 270 out, with no
  // claim about which way the picture turns.
  assert.equal(normaliseRotation(-90), 270);
  assert.equal(normaliseRotation(90), 90);
  assert.equal(normaliseRotation(450), 90);
  assert.equal(normaliseRotation('180'), 180);
  assert.equal(normaliseRotation(0), 0);
  assert.equal(normaliseRotation('sideways'), null);
});

test('the display matrix is counter-clockwise, so a portrait iPhone turns 90 CLOCKWISE', () => {
  // THE DIRECTION IN WORDS, checked against a real file by the measuring test
  // further down: ffprobe's -90 renders with the stored LEFT edge at the TOP,
  // which is a clockwise quarter turn. Getting this backwards puts every
  // portrait clip 180 degrees out three slices downstream.
  assert.equal(clockwiseFromDisplayMatrix(-90), 90, 'the ordinary portrait iPhone spelling');
  assert.equal(clockwiseFromDisplayMatrix(90), 270);
  assert.equal(clockwiseFromDisplayMatrix(-180), 180, '180 is the same either way round');
  assert.equal(clockwiseFromDisplayMatrix(180), 180);
  assert.equal(clockwiseFromDisplayMatrix(0), 0);
  assert.equal(clockwiseFromDisplayMatrix('sideways'), null);
});

test('a turned clip reports what a viewer would see, not what is stored', () => {
  const streams = [videoStream({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] })];
  const media = readProbe({ streams, format: { tags: {} } });
  assert.equal(media.rotationDeg, 90, 'the matrix said -90 counter-clockwise, which is 90 clockwise');
  assert.equal(media.width, 1920, 'stored');
  assert.equal(media.displayWidth, 1080, 'shown');
  assert.equal(media.displayHeight, 1920);
});

test('the legacy rotate tag is already clockwise, so it is NOT negated', () => {
  // The two paths have to end on the same scale — one physical orientation,
  // one number. This half is asserted rather than measured (see the note on
  // `rotationOf`): ffmpeg 9 will not write a legacy tag that anything honours,
  // so it cannot be rendered and sampled the way the matrix path was.
  const quarter = [videoStream({ tags: { handler_name: 'Core Media Video', rotate: '90' } })];
  assert.equal(readProbe({ streams: quarter, format: { tags: {} } }).rotationDeg, 90,
    'a legacy rotate=90 is 90 CLOCKWISE, the same turn the matrix spells -90');

  const half = [videoStream({ tags: { handler_name: 'Core Media Video', rotate: '180' } })];
  assert.equal(readProbe({ streams: half, format: { tags: {} } }).rotationDeg, 180);
});

test('one physical orientation produces one number, whichever way the file spelled it', () => {
  // The portrait iPhone quarter turn, written both ways. If a future edit
  // negates the wrong path, these two stop agreeing.
  const matrix = readProbe({
    streams: [videoStream({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] })],
    format: { tags: {} },
  });
  const legacy = readProbe({
    streams: [videoStream({ tags: { handler_name: 'Core Media Video', rotate: '90' } })],
    format: { tags: {} },
  });
  assert.equal(matrix.rotationDeg, legacy.rotationDeg, 'the same turn must not read as two different numbers');
  assert.equal(matrix.rotationDeg, 90);
});

test('a missing reading is null, never zero', () => {
  const media = readProbe({ streams: [], format: {} });
  assert.equal(media.durationSec, null);
  assert.equal(media.width, null);
  assert.equal(media.fps, null);
  assert.equal(media.recordedAt, null);
  assert.equal(media.streamCount, 0);
  // Zero is a real value that means an empty file. A pipeline that cannot tell
  // "no duration was readable" from "this file is 0 seconds long" will queue a
  // render of nothing and report it as done.
  assert.equal(readProbe({ streams: [], format: { duration: '0' } }).durationSec, 0);
});

test("Apple's own creation date is preferred over the container's, and both are kept", () => {
  const probe = appleProbe({ extraTags: { 'com.apple.quicktime.creationdate': '2026-08-01T12:34:56-0400' } });
  const media = readProbe(probe);
  assert.equal(media.recordedAtRaw, '2026-08-01T12:34:56-0400', 'the offset the camera was standing in');
  assert.equal(media.recordedAt, '2026-08-01T16:34:56.000Z');
});

test('readProbe survives rubbish without throwing', () => {
  for (const junk of [null, undefined, {}, { streams: 'nope' }, { format: 7 }]) {
    assert.equal(readProbe(junk).streamCount, 0);
  }
});

// ---------------------------------------------------------------------------
// "Could not take a reading" is a third outcome, not a lane
// ---------------------------------------------------------------------------

function fakeRun(result) {
  return () => result;
}

test('ffprobe not being installed is reported as that, never as an unknown lane', () => {
  const err = new Error('spawnSync ffprobe ENOENT');
  err.code = 'ENOENT';
  const out = probeFile('/Studio/Inbox/a.mov', { run: fakeRun({ error: err }) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROBE_FAILURES.MISSING);
  assert.equal(out.lane, undefined, 'no lane at all — filing this as "unknown" builds a library of files whose real problem is a missing tool');
  assert.match(out.message, /install ffmpeg/i, 'and it says what to do about it');
});

test('a hung file times out and says so', () => {
  const err = new Error('spawnSync ETIMEDOUT');
  err.code = 'ETIMEDOUT';
  const out = probeFile('/Volumes/gone/a.mov', { run: fakeRun({ error: err }), timeoutMs: 1000 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROBE_FAILURES.TIMEOUT);
});

test('an answer too big for the buffer is reported as that, not as a timeout that never happened', () => {
  // Node kills the child with SIGTERM on a maxBuffer overflow — the same
  // signal a timeout uses — so a signal-first check calls an instant answer
  // "did not answer within 30000ms" and sends the reader hunting a hung mount.
  const err = new Error('spawnSync maxBuffer length exceeded');
  err.code = 'ENOBUFS';
  const out = probeFile('/Studio/Inbox/huge.mov', {
    run: fakeRun({ error: err, signal: 'SIGTERM', stdout: '{"streams":[' }),
    timeoutMs: 30000,
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROBE_FAILURES.OVERFLOW);
  assert.notEqual(out.reason, PROBE_FAILURES.TIMEOUT, 'it answered instantly and was cut off');
  assert.doesNotMatch(out.message, /did not answer within/, 'nothing timed out');
  assert.match(out.message, /cut off/i, 'and it says what actually happened');
  assert.equal(out.lane, undefined, 'still no lane — a truncated reading is not a reading');
});

test('a real timeout is still a timeout once ENOBUFS is checked first', () => {
  const err = new Error('spawnSync ETIMEDOUT');
  err.code = 'ETIMEDOUT';
  const out = probeFile('/Volumes/gone/b.mov', { run: fakeRun({ error: err, signal: 'SIGTERM' }), timeoutMs: 1000 });
  assert.equal(out.reason, PROBE_FAILURES.TIMEOUT);
});

test('a non-zero exit keeps ffprobe\'s own complaint', () => {
  const out = probeFile('/Studio/Inbox/truncated.mov', {
    run: fakeRun({ status: 1, stdout: '', stderr: 'moov atom not found' }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROBE_FAILURES.FAILED);
  assert.equal(out.stderr, 'moov atom not found');
});

test('an answer that is not JSON is a failure, not an empty probe', () => {
  const out = probeFile('/Studio/Inbox/a.mov', { run: fakeRun({ status: 0, stdout: '{"streams":[' }) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROBE_FAILURES.UNPARSEABLE);
});

test('ffprobe is asked for JSON, with the path behind -i and quiet stderr', () => {
  let seen = null;
  probeFile('/Studio/Inbox/a mov with spaces.mov', {
    run: (bin, args) => { seen = { bin, args }; return { status: 0, stdout: '{}' }; },
  });
  // FFPROBE, not the literal, so this still asserts the DEFAULT on a machine
  // that points STUDIO_FFPROBE somewhere else.
  assert.equal(seen.bin, FFPROBE);
  assert.deepEqual(seen.args.slice(0, 6), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams']);
  assert.equal(seen.args.at(-1), '/Studio/Inbox/a mov with spaces.mov', 'passed as one argument — never shelled out');
  assert.equal(seen.args.at(-2), '-i', 'so a filename that starts with a dash is a filename, not an option');
});

test('a successful probe keeps the raw ffprobe output whatever the verdict', () => {
  const probe = { streams: [videoStream({ tags: {} })], format: { duration: '5.0', tags: {} } };
  const out = probeFile('/Studio/Inbox/mystery.mkv', { run: fakeRun({ status: 0, stdout: JSON.stringify(probe) }) });
  assert.equal(out.ok, true);
  assert.equal(out.lane, LANES.UNKNOWN);
  assert.deepEqual(out.probe, probe, 'an unknown whose evidence was thrown away can never be re-decided');
  assert.equal(out.media.durationSec, 5);
});

// ---------------------------------------------------------------------------
// Real media, built by ffmpeg at test time
// ---------------------------------------------------------------------------

const FFMPEG = process.env.STUDIO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.STUDIO_FFPROBE || 'ffprobe';

function toolWorks(bin) {
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return !res.error && Number(res.status) === 0;
}

const HAVE_FFMPEG = toolWorks(FFMPEG) && toolWorks(FFPROBE);

test('ffmpeg and ffprobe are installed, or the real-media proof below is not being taken', () => {
  // A SKIP THAT NOBODY SEES IS A PASS THAT PROVED NOTHING. Every criterion on
  // this ticket is about what a real container says, so if the tools are gone
  // the honest verdict is red with an instruction, not a quiet green board.
  // The escape hatch exists for a machine that genuinely cannot have them, and
  // it has to be typed, which means somebody decided.
  if (process.env.STUDIO_ALLOW_NO_FFMPEG === '1') {
    assert.ok(true, 'waived by STUDIO_ALLOW_NO_FFMPEG=1');
    return;
  }
  assert.ok(HAVE_FFMPEG,
    `ffmpeg/ffprobe not runnable (${FFMPEG} / ${FFPROBE}), so nothing below probes real media. `
    + 'Install it — macOS: `brew install ffmpeg`, Debian/Ubuntu/CI: `sudo apt-get install -y ffmpeg` — '
    + 'or set STUDIO_ALLOW_NO_FFMPEG=1 to say out loud that this machine is not taking the reading.');
});

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function ffmpeg(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
}

/** An iPhone-shaped capture: qt brand, Apple make, the model verbatim. */
function makeApplePhoneFile(dir, name, model = 'iPhone 15 Pro') {
  const out = path.join(dir, name);
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', 'use_metadata_tags',
    '-metadata', 'com.apple.quicktime.make=Apple',
    '-metadata', `com.apple.quicktime.model=${model}`,
    '-metadata', 'com.apple.quicktime.creationdate=2026-08-01T12:34:56-0400',
    out,
  ]);
  return out;
}

/** A Zoom-shaped export: mp42 brand, no device tags, 25 fps. */
function makeZoomFile(dir, name) {
  const out = path.join(dir, name);
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-brand', 'mp42',
    out,
  ]);
  return out;
}

test('a real iPhone-shaped capture probes to the iPhone lane with its model verbatim', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  // THE FILENAME LIES, on purpose: this is the ticket's own hazard, and the
  // only defence is that nothing reads it.
  const file = makeApplePhoneFile(dir, 'zoom_call_recording_2026-08-01.mp4');
  const out = probeFile(file);

  assert.equal(out.ok, true, out.message || '');
  assert.equal(out.lane, LANES.IPHONE);
  assert.equal(out.deviceModel, 'iPhone 15 Pro');
  assert.equal(out.media.width, 1920);
  assert.equal(out.media.height, 1080);
  assert.equal(out.media.fps, 30);
  assert.equal(out.media.videoCodec, 'h264');
  assert.equal(out.media.audioCodec, 'aac');
  assert.ok(out.media.durationSec >= 0.9 && out.media.durationSec <= 1.2, `duration read as ${out.media.durationSec}`);
  assert.equal(out.media.recordedAt, '2026-08-01T16:34:56.000Z');
  assert.ok(out.media.sizeBytes > 0);
});

test('a real Zoom-shaped export and a real iPhone capture classify differently', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  // Both names are wrong, both ways round.
  const zoom = probeFile(makeZoomFile(dir, 'IMG_4021.MOV'));
  const iphone = probeFile(makeApplePhoneFile(dir, 'zoom_session_part2.mp4'));

  assert.equal(zoom.lane, LANES.ZOOM, `zoom file read as ${zoom.lane} (${JSON.stringify(zoom.signals)})`);
  assert.equal(iphone.lane, LANES.IPHONE);
  assert.notEqual(zoom.lane, iphone.lane);
  assert.equal(zoom.media.fps, 25);
  assert.equal(zoom.deviceModel, null, 'Zoom signs nothing');
  assert.equal(zoom.confidence, 'inferred');
  assert.equal(iphone.confidence, 'measured');
});

test('a real seven-stream file probes cleanly', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const base = makeApplePhoneFile(dir, 'base.mov');
  const srt = path.join(dir, 'track.srt');
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nx\n\n');
  const seven = path.join(dir, 'seven.mov');
  // ffmpeg cannot write `mebx` Core Media Metadata tracks, so the five extra
  // tracks are timed text. The hazard is identical: five tracks with no width
  // and no frame rate sitting behind the video.
  ffmpeg(['-i', base, '-i', srt,
    '-map', '0:v', '-map', '0:a', '-map', '1', '-map', '1', '-map', '1', '-map', '1', '-map', '1',
    '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
    '-movflags', 'use_metadata_tags',
    '-metadata', 'com.apple.quicktime.make=Apple',
    '-metadata', 'com.apple.quicktime.model=iPhone 15 Pro',
    seven]);

  const out = probeFile(seven);
  assert.equal(out.ok, true, out.message || '');
  assert.equal(out.media.streamCount, 7);
  assert.equal(out.media.width, 1920, 'the five extra tracks did not blank the geometry');
  assert.equal(out.media.fps, 30);
  assert.equal(out.lane, LANES.IPHONE);
});

// ---------------------------------------------------------------------------
// Which way does it turn? Measured from the pixels, not reasoned about.
//
// `rotationDeg` is published as degrees CLOCKWISE, and the display matrix is
// written counter-clockwise, so the sign has to be flipped somewhere. A test
// that only asserts a number cannot tell a correct flip from a missing one —
// both look like "270 came out" until somebody builds a thumbnail three slices
// downstream and every portrait clip is upside down. So these two build a clip
// with RED on the LEFT, turn it, render the frame a viewer actually sees, and
// look at where the red went.
// ---------------------------------------------------------------------------

/** A 320x160 clip, RED on the left half, BLUE on the right half. */
function makeSplitFile(dir, name) {
  const out = path.join(dir, name);
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=red:s=160x160:d=1:r=10',
    '-f', 'lavfi', '-i', 'color=blue:s=160x160:d=1:r=10',
    '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]', '-map', '[v]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    out,
  ]);
  return out;
}

/** What ffprobe says is on the wire, before this module touches the sign. */
function rawMatrixRotation(file) {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'stream_side_data=rotation', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  const match = out.match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

/** The single frame a player would put on screen, autorotation applied. */
function displayedFrame(dir, file, name) {
  const png = path.join(dir, name);
  ffmpeg(['-i', file, '-frames:v', '1', '-update', '1', png]);
  return png;
}

function frameSize(file) {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  const [width, height] = out.trim().split(',').map(Number);
  return { width, height };
}

/** The colour of an 8x8 patch, read straight out of the decoded frame. */
function patchColour(file, x, y) {
  const raw = execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `crop=8:8:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 1 << 20 });
  const [r, g, b] = [raw[0], raw[1], raw[2]];
  if (r > 128 && b < 128) return 'red';
  if (b > 128 && r < 128) return 'blue';
  return `neither, rgb(${r},${g},${b})`;
}

test('a portrait clip turns CLOCKWISE — the stored LEFT edge ends up at the TOP', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const portrait = path.join(dir, 'portrait.mp4');
  ffmpeg(['-display_rotation', '-90', '-i', makeSplitFile(dir, 'split.mp4'), '-c', 'copy', portrait]);

  assert.equal(rawMatrixRotation(portrait), -90, 'the ordinary portrait iPhone spelling, on the wire');

  const out = probeFile(portrait);
  assert.equal(out.ok, true, out.message || '');
  assert.equal(out.media.width, 320, 'stored');
  assert.equal(out.media.height, 160);
  assert.equal(out.media.displayWidth, 160, 'shown');
  assert.equal(out.media.displayHeight, 320);
  assert.equal(out.media.rotationDeg, 90,
    'ffprobe wrote -90 counter-clockwise, so the clockwise turn is 90 — not 270');

  // And now the proof, from the picture itself rather than from the number.
  const shown = displayedFrame(dir, portrait, 'shown-portrait.png');
  assert.deepEqual(frameSize(shown), { width: 160, height: 320 }, 'the picture stands up');
  assert.equal(patchColour(shown, 76, 4), 'red',
    'the stored LEFT edge is at the TOP, and left-to-top IS a clockwise quarter turn');
  assert.equal(patchColour(shown, 76, 308), 'blue', 'with the stored RIGHT edge at the bottom');
});

test('the other quarter turn is counter-clockwise, and reads as 270', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const other = path.join(dir, 'other-way.mp4');
  ffmpeg(['-display_rotation', '90', '-i', makeSplitFile(dir, 'split.mp4'), '-c', 'copy', other]);

  assert.equal(rawMatrixRotation(other), 90);
  assert.equal(probeFile(other).media.rotationDeg, 270, 'a clockwise 270 is the same turn as a counter-clockwise 90');

  const shown = displayedFrame(dir, other, 'shown-other.png');
  assert.deepEqual(frameSize(shown), { width: 160, height: 320 });
  assert.equal(patchColour(shown, 76, 308), 'red',
    'the stored LEFT edge is at the BOTTOM, which is the counter-clockwise way round');
  assert.equal(patchColour(shown, 76, 4), 'blue');
});

test('a real turned iPhone capture reports what a viewer would see', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const base = makeApplePhoneFile(dir, 'flat.mov');
  const turned = path.join(dir, 'portrait.mov');
  // A plain remux drops the Apple udta tags, and this test is about a file
  // that is still recognisably an iPhone after it has been turned.
  ffmpeg(['-display_rotation', '-90', '-i', base, '-c', 'copy',
    '-map_metadata', '0', '-movflags', 'use_metadata_tags', turned]);

  const out = probeFile(turned);
  assert.equal(out.lane, LANES.IPHONE);
  assert.equal(out.media.rotationDeg, 90);
  assert.equal(out.media.width, 1920);
  assert.equal(out.media.displayWidth, 1080);
  assert.equal(out.media.displayHeight, 1920);
});

test('a real file whose name starts with a dash is read, not mistaken for an option', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  // Without `-i`, ffprobe answers "Missing argument for option 'dash.mp4'"
  // over perfectly good media. Absolute Studio paths never hit it, which is
  // why this is insurance rather than a live bug — but the class is gone.
  const dir = tmpDir(t);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, '-dash-leading-name.mp4')]);

  // THE NAME HAS TO REACH FFPROBE STILL STARTING WITH A DASH. An absolute
  // temp path starts with `/`, so probing one proves nothing at all — the run
  // is given the temp folder as its working directory and the bare name, which
  // is the only shape that reproduces it.
  const out = probeFile('-dash-leading-name.mp4', {
    run: (bin, args, opts) => spawnSync(bin, args, { ...opts, cwd: dir }),
  });
  assert.equal(out.ok, true, out.message || '');
  assert.equal(out.media.width, 320);
});

test('a real container nobody recognises lands in unknown with its probe kept', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const wav = path.join(dir, 'IMG_0001.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav]);

  const out = probeFile(wav);
  assert.equal(out.ok, true, out.message || '');
  assert.equal(out.lane, LANES.UNKNOWN);
  assert.equal(out.unknownReason, UNKNOWN_REASONS.NO_DEVICE_TAGS);
  assert.equal(out.media.audioCodec, 'pcm_s16le');
  assert.ok(Array.isArray(out.probe.streams) && out.probe.streams.length === 1, 'the evidence survives the verdict');
});

test('a real file under the plates folder is a plate whatever the camera was', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const plates = path.join(dir, 'Studio', 'Plates');
  fs.mkdirSync(plates, { recursive: true });
  const file = makeApplePhoneFile(plates, 'screen-capture.mov');

  const out = probeFile(file);
  assert.equal(out.lane, LANES.PLATE);
  assert.equal(out.basis, 'folder');
  assert.equal(out.media.width, 1920, 'and it is still fully probed');
});

test('a real ffprobe run over a file that is not media fails rather than inventing a lane', { skip: !HAVE_FFMPEG && 'ffmpeg not installed' }, (t) => {
  const dir = tmpDir(t);
  const notMedia = path.join(dir, 'notes.txt');
  fs.writeFileSync(notMedia, 'this is not a video\n');

  const out = runFfprobe(notMedia);
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROBE_FAILURES.FAILED);
});

test('this slice commits no media to git', () => {
  // A 40 MB test video in the repo is permanent, so the fixtures are built in
  // a temp directory every run. This is the guard that keeps it that way.
  const repo = path.resolve(__dirname, '..', '..');
  const tracked = execFileSync('git', ['ls-files', 'workers/studio', 'scripts/builder'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(mp4|mov|m4v|mkv|avi|webm|wav|m4a|mp3|aac|srt)$/i.test(f));
  assert.deepEqual(tracked, [], 'media committed alongside this slice — build it at test time instead');
});
