'use strict';

/**
 * What a file IS, read from the container (Studio Phase 1 · 5 of 8).
 *
 * FILENAMES LIE, AND NOT HYPOTHETICALLY. Episode 3's project file is named
 * `youtube_cover_S1-E3.wfp`, and a `DoE_S1-E2.mp4` sits inside the Ep. 3
 * folder. So nothing in this module reads the name of a file to decide what it
 * is: every answer comes from the bytes of the container, via ffprobe, or from
 * the FOLDER — and the folder is the one place a name is allowed to mean
 * something, because a folder is a decision somebody made rather than a label
 * that travelled with a file.
 *
 * THREE OUTCOMES, NEVER TWO (DOCTRINE 3.2). "I read the container and it is an
 * iPhone", "I read the container and it names no device I recognise", and "I
 * could not read the container at all" are three different answers, and the
 * third is not a lane. `probeFile` returns `ok: false` with a named reason when
 * ffprobe is missing, times out, fails or answers something that is not JSON —
 * it does NOT return `lane: 'unknown'`, because a caller that files those two
 * together will quietly build a library of "unknown" files whose real problem
 * is that the tool was never installed.
 *
 * NEVER A WRONG GUESS ABOUT THE DEVICE. `com.apple.quicktime.model` is the
 * device naming ITSELF — it is measured, not inferred — so it is stored
 * verbatim and never normalised, prettified or guessed at. An Apple file that
 * carries a make and no model lands in `unknown` with its probe kept, because
 * "it is an Apple something" is not the question anybody asks; the iPhone lane
 * and the iPad lane are handled differently downstream.
 *
 * THE ZOOM LANE IS SHAPED, NOT SIGNED. Zoom writes no vendor tag, so it can
 * only be recognised by what it does NOT have: an `mp42` container carrying no
 * device tags, no Apple Core Media handlers, and both a video and an audio
 * track. That is inference, and it says so — every verdict carries a `basis`
 * and a `confidence`, so a downstream screen can show "Zoom (inferred from the
 * container)" rather than stating it like a measurement.
 *
 * WHAT `vendor_id` IS NOT. Every ffmpeg-written track carries `vendor_id:
 * "FFMP"`, so "no vendor tags" cannot mean that field or nothing would ever
 * classify. It means no DEVICE tag — `com.apple.quicktime.make`/`.model` and
 * the bare `make`/`model` keys other cameras use.
 *
 * THE FOLDER OUTRANKS THE FILE, DELIBERATELY. A file under `/Studio/Plates/`
 * is a plate even when it carries perfect iPhone tags: a plate is a role in
 * the edit, not a kind of camera, and Dane declares that role by where he puts
 * the file. Studio 3/8 makes the same call from the other end — the inbox lane
 * emits no role at all rather than a plausible guess.
 *
 * NO SIDE EFFECTS AT MODULE SCOPE (DOCTRINE 5.2). Requiring this file spawns
 * nothing and schedules nothing. The daemon that calls it on a timer is 7/8.
 */

const { spawnSync } = require('node:child_process');

/**
 * The lanes, as code keys. The ticket writes them `iPhone` / `iPad` / `zoom` /
 * `plate`; these are the machine spellings of exactly those, plus the third
 * outcome that is not a device at all.
 */
const LANES = Object.freeze({
  IPHONE: 'iphone',
  IPAD: 'ipad',
  ZOOM: 'zoom',
  PLATE: 'plate',
  UNKNOWN: 'unknown',
});

/**
 * Where plates live. This MUST stay the same string Studio 3/8 watches
 * (`drive.js` → `LANES.plates.path`), or a file the watcher filed as a plate
 * would be probed as whatever camera shot it. The two are held together by a
 * test rather than by an import, so this module does not drag the Google Drive
 * client in behind it.
 */
const PLATES_ROOT = '/Studio/Plates/';

/** Zoom's container brand. `major_brand` arrives space-padded (`"qt  "`). */
const ZOOM_MAJOR_BRAND = 'mp42';
const APPLE_MAJOR_BRAND = 'qt';

/** ffprobe is fast on a header read; anything slower than this is a hung mount. */
const FFPROBE_TIMEOUT_MS = 30_000;

/** A probe of a long file with many streams is still only tens of KB of JSON. */
const FFPROBE_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * The tags a device writes to name itself. `make`/`model` without the Apple
 * prefix is what most non-Apple cameras use.
 */
const DEVICE_MAKE_KEYS = Object.freeze([
  'com.apple.quicktime.make',
  'make',
]);
const DEVICE_MODEL_KEYS = Object.freeze([
  'com.apple.quicktime.model',
  'model',
]);

/**
 * Why a file landed in `unknown`. Named rather than free text, because the
 * Footage screen (8/8) has to be able to say WHICH kind of "I cannot tell"
 * this is — DOCTRINE 5.31: an empty answer that does not say why reads as a
 * broken one.
 */
const UNKNOWN_REASONS = Object.freeze({
  APPLE_WITHOUT_MODEL: 'apple_device_without_model',
  APPLE_MODEL_UNRECOGNISED: 'apple_model_unrecognised',
  DEVICE_NOT_APPLE: 'device_tags_name_another_maker',
  NO_DEVICE_TAGS: 'no_device_tags_and_not_zoom_shaped',
});

/** Why a probe could not be taken at all. Never a lane. */
const PROBE_FAILURES = Object.freeze({
  MISSING: 'ffprobe_missing',
  TIMEOUT: 'ffprobe_timeout',
  FAILED: 'ffprobe_failed',
  UNPARSEABLE: 'ffprobe_unparseable',
});

function tagValue(tags, key) {
  if (!tags || typeof tags !== 'object') return '';
  // Container tag keys are not reliably cased — `Make` and `make` both occur —
  // so the lookup is case-insensitive while the VALUE stays untouched.
  const wanted = String(key).toLowerCase();
  for (const [name, value] of Object.entries(tags)) {
    if (String(name).toLowerCase() === wanted) return String(value == null ? '' : value);
  }
  return '';
}

function firstTagValue(tags, keys) {
  for (const key of keys) {
    const value = tagValue(tags, key).trim();
    if (value) return value;
  }
  return '';
}

/** `"25/1"` → 25, `"0/0"` → null. Never throws, never returns Infinity. */
function parseFrameRate(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const [numText, denText = '1'] = raw.split('/');
  const num = Number(numText);
  const den = Number(denText);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num === 0) return null;
  const fps = num / den;
  if (!Number.isFinite(fps) || fps <= 0) return null;
  // 30000/1001 is 29.97002997…; three places is the most anybody displays and
  // it keeps 23.976 and 29.97 distinguishable.
  return Math.round(fps * 1000) / 1000;
}

/**
 * Rotation as degrees CLOCKWISE in 0/90/180/270.
 *
 * ffprobe reports the display matrix as a signed rotation that can be negative
 * (`-90` is the ordinary portrait iPhone case) and, from the legacy `rotate`
 * tag, as any multiple of 90. Both are normalised here so nothing downstream
 * has to remember which spelling it got.
 */
function normaliseRotation(value) {
  const deg = Number(value);
  if (!Number.isFinite(deg)) return null;
  const snapped = Math.round(deg / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function rotationOf(stream) {
  const sideData = Array.isArray(stream && stream.side_data_list) ? stream.side_data_list : [];
  for (const entry of sideData) {
    if (entry && entry.rotation !== undefined) {
      const deg = normaliseRotation(entry.rotation);
      if (deg !== null) return deg;
    }
  }
  const tagged = tagValue(stream && stream.tags, 'rotate');
  return tagged ? normaliseRotation(tagged) : null;
}

/**
 * The primary video track — NOT `streams[0]`.
 *
 * An iPhone capture puts video first and then five Core Media Metadata tracks
 * behind it, but a remux can put audio first, and an audio file with cover art
 * carries a `video` stream that is a single still JPEG. `attached_pic` is how
 * that still says so, and treating it as the picture would report a podcast as
 * 3000×3000 at 90000 fps.
 */
function primaryVideoStream(streams) {
  return streams.find((s) => s
    && s.codec_type === 'video'
    && !(s.disposition && Number(s.disposition.attached_pic) === 1)) || null;
}

/**
 * Turn ffprobe's JSON into the handful of numbers the rest of the Studio needs.
 *
 * Everything is null when it could not be read, never 0 and never a default:
 * a duration of 0 is a real value that means an empty file, and a pipeline that
 * cannot tell those apart will happily schedule a render of nothing.
 */
function readProbe(probeJson) {
  const json = probeJson && typeof probeJson === 'object' ? probeJson : {};
  const format = json.format && typeof json.format === 'object' ? json.format : {};
  const streams = Array.isArray(json.streams) ? json.streams.filter(Boolean) : [];
  const formatTags = format.tags || {};

  const video = primaryVideoStream(streams);
  const audio = streams.find((s) => s.codec_type === 'audio') || null;

  const duration = Number(format.duration);
  const durationSec = Number.isFinite(duration) && duration >= 0
    ? Math.round(duration * 1000) / 1000
    : null;

  // Guarded through `video` rather than through the number: `video && video.width`
  // is `null` when there is no video track, and `Number(null)` is a perfectly
  // finite 0, so testing the number first walks straight into reading `.width`
  // off nothing. Every audio-only file took that path.
  const positive = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  const width = video ? positive(video.width) : null;
  const height = video ? positive(video.height) : null;

  const fps = video
    ? (parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate))
    : null;

  const rotationDeg = video ? rotationOf(video) : null;
  // What the viewer actually sees. A portrait iPhone clip is stored 1920×1080
  // with a 90° matrix on it; a thumbnail built from the stored numbers comes
  // out on its side.
  const turned = rotationDeg === 90 || rotationDeg === 270;
  const displayWidth = width === null || height === null ? null : (turned ? height : width);
  const displayHeight = width === null || height === null ? null : (turned ? width : height);

  // Apple's own `creationdate` carries the offset the camera was standing in
  // ("2026-08-01T12:34:56-0400"); `creation_time` is UTC and is written by
  // nearly everything. Prefer the richer one, keep whichever we used verbatim.
  const appleCreated = tagValue(formatTags, 'com.apple.quicktime.creationdate').trim();
  const containerCreated = tagValue(formatTags, 'creation_time').trim();
  const streamCreated = tagValue(video && video.tags, 'creation_time').trim();
  const recordedAtRaw = appleCreated || containerCreated || streamCreated || null;
  const recordedAtMs = recordedAtRaw ? Date.parse(recordedAtRaw) : NaN;

  const countByType = (type) => streams.filter((s) => s.codec_type === type).length;

  return {
    durationSec,
    width,
    height,
    displayWidth,
    displayHeight,
    fps,
    rotationDeg,
    videoCodec: video ? String(video.codec_name || '') || null : null,
    audioCodec: audio ? String(audio.codec_name || '') || null : null,
    recordedAt: Number.isFinite(recordedAtMs) ? new Date(recordedAtMs).toISOString() : null,
    recordedAtRaw,
    majorBrand: tagValue(formatTags, 'major_brand').trim() || null,
    formatName: String(format.format_name || '') || null,
    sizeBytes: Number.isFinite(Number(format.size)) ? Number(format.size) : null,
    streamCount: streams.length,
    streamCounts: {
      video: countByType('video'),
      audio: countByType('audio'),
      data: countByType('data'),
      subtitle: countByType('subtitle'),
      other: streams.filter((s) => !['video', 'audio', 'data', 'subtitle'].includes(s.codec_type)).length,
    },
  };
}

/**
 * Is this path inside the plates folder?
 *
 * Segment-aware on purpose: `/Studio/PlatesOld/wide.mov` is not a plate, and a
 * plain `includes()` would say it was. Drive paths and local paths both arrive
 * here, so backslashes are folded to forward slashes first.
 */
function isUnderFolder(sourcePath, folder) {
  const haystack = String(sourcePath || '').replace(/\\/g, '/').toLowerCase();
  if (!haystack) return false;
  const needle = String(folder || '').replace(/\\/g, '/').toLowerCase().replace(/\/*$/, '/');
  if (needle === '/') return false;
  return haystack.includes(needle);
}

/** Does any track hand itself to Apple's Core Media layer? */
function hasCoreMediaHandler(streams) {
  return streams.some((s) => /core media/i.test(tagValue(s && s.tags, 'handler_name')));
}

/**
 * Which lane does this file belong to, and on what evidence?
 *
 * `sourcePath` is where the file CAME FROM (its Drive path or its path on
 * disk); it is used for the plates folder and for nothing else — the lane is
 * never read out of a filename.
 */
function inferDeviceLane({ probe, sourcePath = '', platesRoot = PLATES_ROOT } = {}) {
  const json = probe && typeof probe === 'object' ? probe : {};
  const format = json.format && typeof json.format === 'object' ? json.format : {};
  const streams = Array.isArray(json.streams) ? json.streams.filter(Boolean) : [];
  const formatTags = format.tags || {};

  const verdict = (lane, extra) => Object.assign({
    lane,
    basis: null,
    confidence: null,
    deviceMake: null,
    deviceModel: null,
    signals: [],
    reason: null,
  }, extra);

  // 1. THE FOLDER DECIDES. Before any tag is read, because a plate that was
  //    shot on an iPhone is still a plate.
  if (isUnderFolder(sourcePath, platesRoot)) {
    return verdict(LANES.PLATE, {
      basis: 'folder',
      confidence: 'measured',
      signals: [`under ${String(platesRoot).replace(/\/*$/, '/')}`],
    });
  }

  const make = firstTagValue(formatTags, DEVICE_MAKE_KEYS);
  const model = firstTagValue(formatTags, DEVICE_MODEL_KEYS);
  const majorBrand = tagValue(formatTags, 'major_brand').trim().toLowerCase();

  // 2. THE FILE NAMES ITS OWN DEVICE. Measured, so it outranks every shape
  //    rule below — and the model string is carried through untouched.
  if (make || model) {
    const signals = [];
    if (make) signals.push(`make=${make}`);
    if (model) signals.push(`model=${model}`);
    if (majorBrand) signals.push(`major_brand=${majorBrand}`);

    const isApple = /^apple$/i.test(make.trim());
    if (!isApple && make) {
      // Some other camera named itself. That is a real reading and a useful
      // one, but it is not a lane this pipeline has — so it is `unknown` WITH
      // the maker kept, not a shrug.
      return verdict(LANES.UNKNOWN, {
        basis: 'device-tag',
        confidence: 'measured',
        deviceMake: make,
        deviceModel: model || null,
        signals,
        reason: UNKNOWN_REASONS.DEVICE_NOT_APPLE,
      });
    }

    if (!model) {
      return verdict(LANES.UNKNOWN, {
        basis: 'device-tag',
        confidence: 'measured',
        deviceMake: make || null,
        deviceModel: null,
        signals,
        reason: UNKNOWN_REASONS.APPLE_WITHOUT_MODEL,
      });
    }

    const lane = /\biphone\b/i.test(model) ? LANES.IPHONE
      : (/\bipad\b/i.test(model) ? LANES.IPAD : null);
    if (!lane) {
      return verdict(LANES.UNKNOWN, {
        basis: 'device-tag',
        confidence: 'measured',
        deviceMake: make || null,
        deviceModel: model,
        signals,
        reason: UNKNOWN_REASONS.APPLE_MODEL_UNRECOGNISED,
      });
    }
    return verdict(lane, {
      basis: 'device-tag',
      confidence: 'measured',
      deviceMake: make || null,
      deviceModel: model,
      signals,
    });
  }

  // 3. NOTHING SIGNED IT. The only lane left is recognised by its shape, and a
  //    shape is inference — it says so.
  const hasVideo = Boolean(primaryVideoStream(streams));
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  if (majorBrand === ZOOM_MAJOR_BRAND && hasVideo && hasAudio && !hasCoreMediaHandler(streams)) {
    const signals = [`major_brand=${majorBrand}`, 'no device tags', 'no Core Media handler'];
    const fps = readProbe(json).fps;
    // 25 fps is what the spike measured on Zoom's exports. It corroborates and
    // is deliberately NOT required: a 30 fps Zoom export is an ordinary thing
    // and refusing to name it would make the lane useless.
    if (fps === 25) signals.push('fps=25');
    return verdict(LANES.ZOOM, {
      basis: 'container-shape',
      confidence: 'inferred',
      signals,
      reason: null,
    });
  }

  return verdict(LANES.UNKNOWN, {
    basis: majorBrand === APPLE_MAJOR_BRAND ? 'container-shape' : null,
    confidence: 'inferred',
    signals: majorBrand ? [`major_brand=${majorBrand}`] : [],
    reason: UNKNOWN_REASONS.NO_DEVICE_TAGS,
  });
}

/**
 * Run ffprobe over one file and hand back its JSON.
 *
 * `run` is injectable so the failure paths — the tool not being installed, a
 * timeout, a non-zero exit, a truncated answer — are testable without
 * uninstalling anything.
 */
function runFfprobe(filePath, { run = spawnSync, bin = process.env.STUDIO_FFPROBE || 'ffprobe', timeoutMs = FFPROBE_TIMEOUT_MS } = {}) {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    String(filePath),
  ];
  const res = run(bin, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: FFPROBE_MAX_BUFFER,
  }) || {};

  if (res.error) {
    const code = String(res.error.code || '');
    if (code === 'ENOENT') {
      return {
        ok: false,
        reason: PROBE_FAILURES.MISSING,
        message: `${bin} is not installed on this machine — install ffmpeg (which carries ffprobe) or set STUDIO_FFPROBE to its path`,
      };
    }
    if (res.signal === 'SIGTERM' || code === 'ETIMEDOUT') {
      return {
        ok: false,
        reason: PROBE_FAILURES.TIMEOUT,
        message: `${bin} did not answer within ${timeoutMs}ms for ${filePath}`,
      };
    }
    return { ok: false, reason: PROBE_FAILURES.FAILED, message: String(res.error.message || res.error) };
  }

  if (Number(res.status) !== 0) {
    const stderr = String(res.stderr || '').trim();
    return {
      ok: false,
      reason: PROBE_FAILURES.FAILED,
      message: `${bin} exited ${res.status}${stderr ? `: ${stderr}` : ''}`,
      stderr: stderr || null,
    };
  }

  const stdout = String(res.stdout || '');
  try {
    const json = JSON.parse(stdout);
    if (!json || typeof json !== 'object') throw new Error('not an object');
    return { ok: true, json };
  } catch (err) {
    return {
      ok: false,
      reason: PROBE_FAILURES.UNPARSEABLE,
      message: `${bin} answered something that is not JSON (${String(err.message || err)})`,
      stdout: stdout.slice(0, 2000) || null,
    };
  }
}

/**
 * The whole job for one file: probe it, read it, place it.
 *
 * On success: `{ ok: true, lane, deviceModel, media, probe, … }` — `probe` is
 * ffprobe's raw JSON, kept whatever the verdict, because an `unknown` whose
 * evidence was thrown away can never be re-decided without the file.
 * On failure: `{ ok: false, reason, message }` and NO lane at all.
 */
function probeFile(filePath, { sourcePath, platesRoot = PLATES_ROOT, run, bin, timeoutMs } = {}) {
  const probed = runFfprobe(filePath, { run, bin, timeoutMs });
  if (!probed.ok) return Object.assign({ ok: false, filePath: String(filePath) }, probed);

  const media = readProbe(probed.json);
  const placed = inferDeviceLane({
    probe: probed.json,
    // The file's own path stands in when the caller knows no better one; it is
    // only ever consulted for the plates folder.
    sourcePath: sourcePath === undefined ? filePath : sourcePath,
    platesRoot,
  });

  return {
    ok: true,
    filePath: String(filePath),
    lane: placed.lane,
    basis: placed.basis,
    confidence: placed.confidence,
    deviceMake: placed.deviceMake,
    deviceModel: placed.deviceModel,
    signals: placed.signals,
    unknownReason: placed.reason,
    media,
    probe: probed.json,
  };
}

module.exports = {
  probeFile,
  runFfprobe,
  readProbe,
  inferDeviceLane,
  // Exported for their own tests: each one is a small rule that is far easier
  // to get wrong than it looks, and two of them (the folder match and the
  // frame-rate parse) have obvious-looking implementations that are wrong.
  isUnderFolder,
  parseFrameRate,
  normaliseRotation,
  primaryVideoStream,
  LANES,
  UNKNOWN_REASONS,
  PROBE_FAILURES,
  PLATES_ROOT,
  FFPROBE_TIMEOUT_MS,
};
