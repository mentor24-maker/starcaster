'use strict';

/**
 * The small working copies everything downstream reads (Studio Phase 1 · 6 of 8).
 *
 * Three derivatives per source, and each one exists for a different reader:
 * a 720p H.264 **proxy** for scrubbing and for the Footage screen, a 16 kHz
 * mono **WAV** for speech recognition, and a **contact sheet** so a person can
 * see what a clip is without opening it.
 *
 * EVERY STREAM IS MAPPED BY HAND. An iPhone capture carries seven tracks —
 * picture, sound, and five Core Media Metadata tracks — and ffmpeg's default
 * stream selection either refuses the job or writes something subtly wrong.
 * `-map 0:v:0 -map 0:a:0` names exactly the two tracks that matter and leaves
 * the other five where they are. The source file is never written to.
 *
 * AND THE MAPS ARE NOT OPTIONAL (`0:a:0`, never `0:a:0?`). The trailing `?`
 * turns "this file has no sound" into a silent video-only run, and the WHOLE
 * point of the WAV is that transcription gets fed. Whether a source has audio
 * is read from the container first and answered out loud; a source with no
 * audio track gets no WAV **and says so**, which is a different fact from a
 * WAV that failed to appear.
 *
 * A PROXY THAT IS BIGGER THAN THE ORIGINAL IS NOT A PROXY. The Zoom spike
 * source measured 268 kbps at 1080p25; a 720p CRF 28 encode of it comes out
 * LARGER than the file it was meant to replace, and slower to read. So a
 * source at or below a bitrate floor is used directly and the decision is
 * logged with its reason and the number it was taken on.
 *
 * BUT BITRATE IS NOT THE ONLY REASON A PROXY EXISTS. The second job of a proxy
 * is making a file ORDINARY: an iPhone's HEVC Main 10 is awkward to scrub, to
 * play in a browser and to hand to anything that expects 8-bit H.264. So the
 * floor only releases a source that is ALREADY ordinary — 8-bit H.264 — and a
 * low-bitrate 10-bit HEVC clip is still proxied. Two guards, both stated,
 * because one of them alone is wrong in a way nobody would notice until a
 * screen somewhere played black.
 *
 * THREE OUTCOMES, NEVER TWO (DOCTRINE 3.2). "I read the bitrate and it is
 * below the floor", "I read it and it is above", and "I could not read it at
 * all" are three answers. The third one ENCODES, because a proxy that was not
 * needed costs disk, and a proxy that was needed and never made costs the rest
 * of the pipeline — and it records that it was a guess rather than a reading.
 *
 * IDEMPOTENT BY REUSE, NOT BY RE-ENCODING. Every output has one deterministic
 * name; a finished artifact whose source has not moved is reused and said to
 * be reused. Work in progress is written to `<name>.part` and renamed into
 * place only when ffmpeg has exited 0, so a machine that dies mid-encode
 * leaves no half-file that looks finished — the one shape that would make a
 * re-run "identical" while being quietly broken.
 *
 * NO `setInterval`, NO SPAWNING AT MODULE SCOPE (DOCTRINE 5.2). Requiring this
 * file does nothing at all. The daemon that runs it on a timer is 7/8.
 *
 * THE PROBE SEAM. Studio 5/8 (`probe.js`) already takes an ffprobe reading of
 * every source, so this module accepts one (`probeJson`) and only takes its
 * own when the caller has none. That keeps 6/8 runnable on its own — it landed
 * while 5/8 was still in review — without probing the same file twice once the
 * daemon wires them together.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * "720p" means the box 1280×720 in WHICHEVER ORIENTATION the picture is, and
 * it never enlarges a source that is already smaller than the box.
 *
 * Scaling on the stored height alone is the obvious implementation and it is
 * wrong for the file this pipeline sees most: a phone clip shot upright is
 * 1080×1920 once rotated, and `scale=-2:720` turns it into a 406×720
 * postage stamp — a quarter of the pixels a landscape clip keeps.
 */
const PROXY_LONG_EDGE = 1280;
const PROXY_SHORT_EDGE = 720;

/** CRF 28 / veryfast: the ticket's number, and a preset that keeps up on the Mini. */
const PROXY_CRF = 28;
const PROXY_PRESET = 'veryfast';

/**
 * 8-bit 4:2:0 on the way out, ALWAYS, and it is not cosmetic. libx264 given
 * 10-bit frames writes a High 10 profile stream, which Safari, QuickTime and
 * most browsers refuse to play — so an iPhone source would produce a "proxy"
 * that the Footage screen renders as a black rectangle.
 */
const PROXY_PIX_FMT = 'yuv420p';

/** What speech recognition wants, and nothing more: 16 kHz, mono, 16-bit PCM. */
const ANALYSIS_SAMPLE_RATE = 16000;
const ANALYSIS_CHANNELS = 1;
const ANALYSIS_CODEC = 'pcm_s16le';

/** A contact sheet: twelve stills, evenly spaced, 320 px wide each. */
const SHEET_COLUMNS = 4;
const SHEET_ROWS = 3;
const SHEET_TILE_WIDTH = 320;
const SHEET_TILES = SHEET_COLUMNS * SHEET_ROWS;

/**
 * Below this, a 720p CRF 28 encode is not reliably smaller than the source, so
 * making one spends an hour of the Mini's evening to produce a worse file.
 *
 * The number is held to the one measurement that exists rather than to taste:
 * the Zoom spike source is 268 kbps at 1080p25 and encodes LARGER. Real
 * 720p CRF 28 output of camera footage lands around 1–2 Mbps, so a source
 * already under 1.5 Mbps is at best a wash. It is an option and an env var
 * (`STUDIO_PROXY_FLOOR_KBPS`) because it is a judgement, and a judgement
 * baked into a constant is one nobody can revise from a machine.
 */
const DEFAULT_FLOOR_KBPS = 1500;

/**
 * What "already ordinary" means. A source in this list, at 8 bits, can be
 * handed straight to a browser, a scrubber and a trimmer, so the floor is
 * allowed to release it. Anything else is proxied whatever its bitrate.
 */
const DIRECTLY_USABLE_CODECS = Object.freeze(['h264']);

/** ffprobe on a header read is instant; anything slower is a hung mount. */
const FFPROBE_TIMEOUT_MS = 30_000;

/**
 * An encode gets six times the clip's own length, with a fifteen-minute floor.
 * Generous on purpose: a timeout that fires early kills real work and puts the
 * job back for another machine to kill again. The queue's lease (2/8) is the
 * mechanism that survives a wedged worker; this is only a backstop against a
 * process that will never exit at all.
 */
const ENCODE_TIMEOUT_FLOOR_MS = 15 * 60 * 1000;
const ENCODE_TIMEOUT_PER_SECOND_MS = 6 * 1000;

/** ffmpeg prints a lot on stderr; a wedged filter graph can print a lot more. */
const FFMPEG_MAX_BUFFER = 32 * 1024 * 1024;

/** The manifest's shape. Bumping it makes every existing derivative rebuild. */
const MANIFEST_VERSION = 2;

const OUTPUT_NAMES = Object.freeze({
  proxy: 'proxy.mp4',
  audio: 'analysis-16k.wav',
  contactSheet: 'contact-sheet.jpg',
  manifest: 'derivatives.json',
});

/** What happened to one derivative. Never a bare boolean. */
const ACTIONS = Object.freeze({
  ENCODED: 'encoded',
  REUSED: 'reused',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

/** Why a derivative was skipped. Every one of these is a fact, not a shrug. */
const SKIP_REASONS = Object.freeze({
  BELOW_FLOOR: 'source_at_or_below_bitrate_floor',
  NO_VIDEO: 'source_has_no_video_track',
  NO_AUDIO: 'source_has_no_audio_track',
});

/** Why a proxy was made. Recorded too — the reason is the useful half. */
const ENCODE_REASONS = Object.freeze({
  ABOVE_FLOOR: 'source_above_bitrate_floor',
  NOT_DIRECTLY_USABLE: 'source_codec_or_depth_not_directly_usable',
  BITRATE_UNKNOWN: 'source_bitrate_could_not_be_read',
});

/** How the bitrate reading was taken. A derived number says so. */
const BITRATE_BASIS = Object.freeze({
  VIDEO_STREAM: 'video_stream_bit_rate',
  CONTAINER_LESS_AUDIO: 'container_bit_rate_less_audio',
  CONTAINER: 'container_bit_rate',
  SIZE_AND_DURATION: 'file_size_over_duration',
});

/** Why nothing could be produced. Named, so a run report can say which. */
const FAILURES = Object.freeze({
  SOURCE_MISSING: 'source_file_missing',
  SOURCE_UNREADABLE: 'source_could_not_be_probed',
  SOURCE_EMPTY: 'source_has_no_video_and_no_audio',
  FFMPEG_MISSING: 'ffmpeg_missing',
  FFMPEG_TIMEOUT: 'ffmpeg_timeout',
  FFMPEG_FAILED: 'ffmpeg_failed',
  OUTPUT_EMPTY: 'ffmpeg_exited_0_but_wrote_nothing',
});

/** Why a decode measurement could not be taken. Never "hardware is slower". */
const MEASURE_UNAVAILABLE = Object.freeze({
  NOT_BUILT: 'hwaccel_not_built_into_this_ffmpeg',
  FAILED: 'hwaccel_decode_failed',
  NO_TOOL: 'ffmpeg_missing',
});

/**
 * The only hardware decoder this pipeline runs on. The Studio lives on the
 * Mac Mini; naming one accelerator and reporting "not available" everywhere
 * else is honest, where a list of guesses would report a number taken from
 * something nobody has.
 */
const HWACCEL = 'videotoolbox';

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function positiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// ---------------------------------------------------------------------------
// Reading the source
// ---------------------------------------------------------------------------

/**
 * The picture track, found by TYPE and by having a picture in it.
 *
 * Not `streams[0]`: on an iPhone capture stream 0 is often a metadata track,
 * and cover art in an audio file is a `video` stream with a width that must
 * not be mistaken for footage (it has no frame rate worth the name).
 */
function primaryVideoStream(streams) {
  const list = Array.isArray(streams) ? streams.filter(Boolean) : [];
  const video = list.filter((s) => s.codec_type === 'video');
  const moving = video.find((s) => {
    if (text(s.disposition && s.disposition.attached_pic) === '1') return false;
    const rate = text(s.avg_frame_rate || s.r_frame_rate);
    const [num, den] = rate.split('/');
    return Number(num) > 0 && Number(den) > 0;
  });
  return moving || video.find((s) => text(s.disposition && s.disposition.attached_pic) !== '1') || null;
}

function firstAudioStream(streams) {
  const list = Array.isArray(streams) ? streams.filter(Boolean) : [];
  return list.find((s) => s.codec_type === 'audio') || null;
}

/**
 * How many kbps of picture is in this file, and how do we know?
 *
 * Four ways to answer, in order of how directly they were measured, and a
 * fifth answer — `null` — which is a real outcome and not a zero. A zero here
 * would read as "below the floor" and skip the proxy on a file nobody had
 * measured at all.
 */
function sourceBitrate(probeJson) {
  const json = probeJson && typeof probeJson === 'object' ? probeJson : {};
  const format = json.format && typeof json.format === 'object' ? json.format : {};
  const streams = Array.isArray(json.streams) ? json.streams.filter(Boolean) : [];
  const video = primaryVideoStream(streams);
  const audio = firstAudioStream(streams);

  const videoBits = video ? positiveNumber(video.bit_rate) : null;
  if (videoBits) {
    return { kbps: Math.round(videoBits / 1000), basis: BITRATE_BASIS.VIDEO_STREAM };
  }

  const containerBits = positiveNumber(format.bit_rate);
  const audioBits = audio ? positiveNumber(audio.bit_rate) : null;
  if (containerBits) {
    if (audioBits && audioBits < containerBits) {
      return {
        kbps: Math.round((containerBits - audioBits) / 1000),
        basis: BITRATE_BASIS.CONTAINER_LESS_AUDIO,
      };
    }
    return { kbps: Math.round(containerBits / 1000), basis: BITRATE_BASIS.CONTAINER };
  }

  const size = positiveNumber(format.size);
  const duration = positiveNumber(format.duration);
  if (size && duration) {
    return {
      kbps: Math.round((size * 8) / duration / 1000),
      basis: BITRATE_BASIS.SIZE_AND_DURATION,
    };
  }

  return { kbps: null, basis: null };
}

/**
 * Is this source already in a shape everything downstream can read?
 *
 * AN ALLOWLIST, NOT A PATTERN, and that is the second time this rule was
 * written. The first version tested the pixel format against a regex for
 * "ten bits or more", which reads correctly and lets `p010le` straight
 * through — VideoToolbox's OWN 10-bit format, and therefore precisely the
 * spelling an Apple pipeline produces. A rule that has to recognise every way
 * a format can be unusable will always be one spelling behind; a rule that
 * names the four formats that ARE usable is wrong only in the safe direction,
 * where the cost is a proxy nobody needed.
 *
 * The list is 8-bit 4:2:0, which is what a browser, a scrubber and a trimmer
 * can all take. 4:2:2 and 4:4:4 are excluded on purpose even at 8 bits: they
 * make H.264 profiles Safari refuses, which is the same black rectangle the
 * bit depth would have caused.
 *
 * `profile` is not consulted at all — every encoder spells it differently
 * ("Main 10", "High 10", "Rext"), while the pixel format says the same thing
 * in every file.
 */
const DIRECTLY_USABLE_PIX_FMTS = Object.freeze(['yuv420p', 'yuvj420p', 'nv12', 'nv21']);

function isDirectlyUsable(videoStream) {
  if (!videoStream) return false;
  const codec = text(videoStream.codec_name).toLowerCase();
  if (!DIRECTLY_USABLE_CODECS.includes(codec)) return false;
  return DIRECTLY_USABLE_PIX_FMTS.includes(text(videoStream.pix_fmt).toLowerCase());
}

/**
 * Proxy or no proxy, and on what evidence.
 *
 * Pure: it takes an ffprobe reading and a floor and returns a verdict. All the
 * awkward cases live here rather than inside a function that also spawns
 * processes, because that is the difference between a rule that can be tested
 * and a rule that can only be observed.
 */
function decideProxy({ probeJson, floorKbps = DEFAULT_FLOOR_KBPS } = {}) {
  const json = probeJson && typeof probeJson === 'object' ? probeJson : {};
  const streams = Array.isArray(json.streams) ? json.streams.filter(Boolean) : [];
  const video = primaryVideoStream(streams);
  const floor = positiveNumber(floorKbps) || DEFAULT_FLOOR_KBPS;

  if (!video) {
    return {
      encode: false,
      reason: SKIP_REASONS.NO_VIDEO,
      bitrateKbps: null,
      bitrateBasis: null,
      floorKbps: floor,
      videoCodec: null,
      pixFmt: null,
      directlyUsable: false,
    };
  }

  const { kbps, basis } = sourceBitrate(json);
  const usable = isDirectlyUsable(video);
  const common = {
    bitrateKbps: kbps,
    bitrateBasis: basis,
    floorKbps: floor,
    videoCodec: text(video.codec_name) || null,
    pixFmt: text(video.pix_fmt) || null,
    directlyUsable: usable,
  };

  // The second guard, and it runs FIRST: a 10-bit HEVC clip at 400 kbps is
  // small and still unreadable to half the things downstream.
  if (!usable) {
    return { encode: true, reason: ENCODE_REASONS.NOT_DIRECTLY_USABLE, ...common };
  }
  if (kbps === null) {
    return { encode: true, reason: ENCODE_REASONS.BITRATE_UNKNOWN, ...common };
  }
  if (kbps <= floor) {
    return { encode: false, reason: SKIP_REASONS.BELOW_FLOOR, ...common };
  }
  return { encode: true, reason: ENCODE_REASONS.ABOVE_FLOOR, ...common };
}

// ---------------------------------------------------------------------------
// The ffmpeg calls
// ---------------------------------------------------------------------------

/**
 * Fit inside the 720p box without ever enlarging, and land on even numbers.
 *
 * `min(edge, iw)` is what stops the upscale: the box shrinks to the source
 * when the source is already smaller, so `decrease` has nothing to decrease.
 * `force_divisible_by=2` is not cosmetic — libx264 refuses odd dimensions in
 * 4:2:0, and a 1080×1921 input rounds to one.
 */
function scaleFilter({ longEdge = PROXY_LONG_EDGE, shortEdge = PROXY_SHORT_EDGE } = {}) {
  return `scale=w='min(${longEdge}\\,iw)':h='min(${longEdge}\\,ih)'`
    + `:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic`
    // The short edge is capped by the aspect fit above for anything wider than
    // 16:9; a squarer source is then capped here so a 1:1 clip cannot arrive
    // at 1280×1280 and cost more than the source it replaces.
    + `,scale=w='min(iw\\,if(gte(iw\\,ih)\\,${longEdge}\\,${shortEdge}))'`
    + `:h='min(ih\\,if(gte(iw\\,ih)\\,${shortEdge}\\,${longEdge}))'`
    + `:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic`;
}

/**
 * The shared head of every call: no banner, no prompt, errors only, overwrite.
 *
 * `-nostdin` matters on a daemon — without it ffmpeg reads the terminal and a
 * background worker can be stopped by the shell for reading input nobody is
 * typing.
 */
function baseArgs({ decodeMode = 'software' } = {}) {
  const head = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  if (decodeMode === 'hardware') head.push('-hwaccel', HWACCEL);
  return head;
}

/**
 * `-fflags +bitexact` and `-flags +bitexact`, so two runs of the same encode
 * produce the same bytes.
 *
 * Without it the mp4 muxer stamps the wall clock into the file header and
 * x264 writes its build number, so an output is never comparable with
 * another one — which would make "re-running produces identical output"
 * unprovable rather than false. The cost is that the proxy carries no
 * metadata, which is right for a working copy: the original is the record,
 * and 5/8 has already read it.
 */
const BITEXACT = Object.freeze(['-fflags', '+bitexact', '-flags', '+bitexact']);

function proxyArgs({ input, output, hasAudio, decodeMode = 'software' } = {}) {
  const args = baseArgs({ decodeMode });
  args.push('-i', input);
  // Named by hand. Five metadata tracks on an iPhone file are left alone by
  // saying which two tracks we want, never by asking ffmpeg to guess.
  args.push('-map', '0:v:0');
  if (hasAudio) args.push('-map', '0:a:0');
  args.push('-vf', scaleFilter());
  args.push('-c:v', 'libx264', '-preset', PROXY_PRESET, '-crf', String(PROXY_CRF));
  args.push('-pix_fmt', PROXY_PIX_FMT);
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  args.push(...BITEXACT);
  // The moov atom at the front, so the Footage screen (8/8) can start playing
  // a proxy before it has the whole file.
  args.push('-movflags', '+faststart');
  // THE MUXER IS NAMED, NEVER INFERRED. Every output is written to a
  // `<name>.part` file first, and ffmpeg picks a format from the extension —
  // `.part` is not one, so every single encode failed with "Unable to choose
  // an output format" until this line existed. Naming it is better anyway: an
  // output format that depends on a file name is one a rename can change.
  args.push('-f', 'mp4');
  args.push(output);
  return args;
}

function analysisAudioArgs({ input, output, decodeMode = 'software' } = {}) {
  const args = baseArgs({ decodeMode });
  args.push('-i', input);
  args.push('-map', '0:a:0');
  // No video at all in a WAV, said twice: the map above selects only sound,
  // and `-vn` means a container that somehow carried a picture cannot write
  // one into a file speech recognition is about to read as samples.
  args.push('-vn');
  args.push('-ac', String(ANALYSIS_CHANNELS), '-ar', String(ANALYSIS_SAMPLE_RATE));
  args.push('-c:a', ANALYSIS_CODEC);
  args.push(...BITEXACT);
  args.push('-f', 'wav');
  args.push(output);
  return args;
}

/**
 * Twelve stills spread evenly across the clip, tiled 4×3.
 *
 * The sample rate is worked out from the duration rather than fixed, so a
 * ninety-second clip and a ninety-minute one both produce a sheet that covers
 * the whole thing. A source whose duration could not be read falls back to one
 * frame every five seconds and says so in the manifest — the sheet is then a
 * sample of the opening minute rather than of the clip, which is worth knowing
 * before anybody decides a scene is missing.
 */
function contactSheetArgs({ input, output, durationSec, decodeMode = 'software' } = {}) {
  const duration = positiveNumber(durationSec);
  // Half a tile in from each end: the first frame of a capture is very often
  // black or a hand reaching for the record button.
  const args = baseArgs({ decodeMode });
  args.push('-i', input);
  args.push('-map', '0:v:0');
  args.push('-vf', [
    `fps=${sheetRate(duration)}`,
    `scale=w=${SHEET_TILE_WIDTH}:h=-2:flags=bicubic`,
    `tile=${SHEET_COLUMNS}x${SHEET_ROWS}`,
  ].join(','));
  args.push('-frames:v', '1');
  args.push('-q:v', '4');
  args.push(...BITEXACT);
  // One JPEG, said explicitly for the same reason as the proxy's `-f mp4`.
  args.push('-c:v', 'mjpeg', '-f', 'image2');
  args.push(output);
  return args;
}

/**
 * Twelve stills across the whole clip, as an exact fraction.
 *
 * `12/3600` and not `0.003333`: ffmpeg evaluates the fraction, and a rounded
 * decimal is short by a frame on a long clip — which produces an eleven-tile
 * sheet with a blank corner and no explanation anywhere.
 */
function sheetRate(durationSec) {
  const duration = positiveNumber(durationSec);
  if (!duration) return '1/5';
  return `${SHEET_TILES}/${Math.round(duration * 1e6) / 1e6}`;
}

function encodeTimeoutMs(durationSec) {
  const duration = positiveNumber(durationSec) || 0;
  return Math.max(ENCODE_TIMEOUT_FLOOR_MS, Math.ceil(duration * ENCODE_TIMEOUT_PER_SECOND_MS));
}

/**
 * Run ffmpeg once and say what happened in the four ways it can happen: it
 * worked, the tool is not installed, it ran out of time, it refused. ffmpeg's
 * own complaint is kept verbatim in every failing case — a paraphrase of a
 * codec error has never once helped anybody.
 */
function runFfmpeg(args, {
  run = spawnSync,
  bin = process.env.STUDIO_FFMPEG || 'ffmpeg',
  timeoutMs = ENCODE_TIMEOUT_FLOOR_MS,
  clock = () => Number(process.hrtime.bigint() / 1000000n),
} = {}) {
  const started = clock();
  const res = run(bin, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: FFMPEG_MAX_BUFFER,
  });
  const ms = Math.max(0, clock() - started);

  if (res && res.error && res.error.code === 'ENOENT') {
    return { ok: false, reason: FAILURES.FFMPEG_MISSING, detail: `${bin} is not installed or not on PATH`, ms };
  }
  if (res && (res.signal === 'SIGTERM' || (res.error && res.error.code === 'ETIMEDOUT'))) {
    return { ok: false, reason: FAILURES.FFMPEG_TIMEOUT, detail: `ffmpeg did not finish within ${Math.round(timeoutMs / 1000)}s`, ms };
  }
  if (res && res.error) {
    return { ok: false, reason: FAILURES.FFMPEG_FAILED, detail: String(res.error.message || res.error), ms };
  }
  if (!res || Number(res.status) !== 0) {
    const stderr = text(res && res.stderr).trim();
    return {
      ok: false,
      reason: FAILURES.FFMPEG_FAILED,
      detail: stderr || `ffmpeg exited ${res ? res.status : 'with no status'}`,
      ms,
    };
  }
  return { ok: true, ms, stderr: text(res.stderr).trim() };
}

/** ffprobe, asked for JSON. The path goes last, which is what ffprobe wants. */
function probeSource(filePath, {
  run = spawnSync,
  bin = process.env.STUDIO_FFPROBE || 'ffprobe',
  timeoutMs = FFPROBE_TIMEOUT_MS,
} = {}) {
  const res = run(bin, [
    '-hide_banner', '-loglevel', 'error',
    '-print_format', 'json',
    '-show_format', '-show_streams',
    String(filePath),
  ], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: FFMPEG_MAX_BUFFER });

  if (res && res.error && res.error.code === 'ENOENT') {
    return { ok: false, reason: FAILURES.SOURCE_UNREADABLE, detail: `${bin} is not installed or not on PATH` };
  }
  if (!res || Number(res.status) !== 0 || res.error) {
    const detail = text(res && res.stderr).trim() || String((res && res.error && res.error.message) || 'ffprobe failed');
    return { ok: false, reason: FAILURES.SOURCE_UNREADABLE, detail };
  }
  try {
    return { ok: true, json: JSON.parse(text(res.stdout)) };
  } catch (err) {
    return { ok: false, reason: FAILURES.SOURCE_UNREADABLE, detail: `ffprobe answered something that is not JSON: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Hardware against software decode
// ---------------------------------------------------------------------------

function hwaccelAvailable({ run = spawnSync, bin = process.env.STUDIO_FFMPEG || 'ffmpeg' } = {}) {
  const res = run(bin, ['-hide_banner', '-hwaccels'], { encoding: 'utf8', timeout: FFPROBE_TIMEOUT_MS });
  if (!res || res.error || Number(res.status) !== 0) return false;
  return text(res.stdout).split(/\s+/).map((s) => s.trim().toLowerCase()).includes(HWACCEL);
}

/**
 * ffmpeg's own `-benchmark` line, which is the only portable way to get CPU
 * time out of a child process. It prints at `info`, so the measurement runs
 * noisier than everything else here on purpose.
 */
function parseBenchmark(stderr) {
  const match = /bench:\s*utime=([\d.]+)s\s+stime=([\d.]+)s\s+rtime=([\d.]+)s/.exec(text(stderr));
  if (!match) return null;
  return {
    cpuSec: Math.round((Number(match[1]) + Number(match[2])) * 1000) / 1000,
    rtimeSec: Number(match[3]),
  };
}

/** Decode a whole file and throw the frames away, timing the process. */
function decodeOnce(filePath, mode, { run, bin, timeoutMs, clock } = {}) {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-y', '-benchmark'];
  if (mode === 'hardware') args.push('-hwaccel', HWACCEL);
  args.push('-i', String(filePath), '-map', '0:v:0', '-f', 'null', '-');
  const result = runFfmpeg(args, { run, bin, timeoutMs, ...(clock ? { clock } : {}) });
  if (!result.ok) return result;
  return { ...result, ...(parseBenchmark(result.stderr) || {}) };
}

/**
 * Decode the whole file twice — once on the GPU, once on the CPU — and write
 * down the difference. `-f null -` throws the frames away, so this measures
 * decoding and nothing else.
 *
 * IT REPORTS CPU TIME AS WELL AS WALL CLOCK, and that turned out to be the
 * whole answer. Measured on the Mini over 30s of 1080p30 HEVC Main 10: wall
 * clock 1.98s hardware against 2.04s software — no difference worth having —
 * while CPU time was 1.17s against 6.85s. Software decode is not slower here,
 * it is SIX TIMES more expensive, and the cost lands on the cores the encoder
 * wants. A wall-clock-only reading would have said "no difference" and been
 * wrong about the only thing that matters on a machine running several jobs.
 *
 * The hardware half has a THIRD answer and it matters: a machine whose ffmpeg
 * was built without VideoToolbox, or a Linux CI runner, has not measured that
 * hardware decode is slow — it has not measured anything. Reporting that as a
 * number would put a made-up figure in a manifest somebody later trusts.
 */
function measureDecode(filePath, {
  run = spawnSync,
  bin = process.env.STUDIO_FFMPEG || 'ffmpeg',
  timeoutMs = ENCODE_TIMEOUT_FLOOR_MS,
  clock,
} = {}) {
  const common = { file: String(filePath), hwaccel: HWACCEL };
  const opts = { run, bin, timeoutMs, clock };
  const software = decodeOnce(filePath, 'software', opts);

  if (!software.ok && software.reason === FAILURES.FFMPEG_MISSING) {
    return { ...common, ok: false, reason: MEASURE_UNAVAILABLE.NO_TOOL, detail: software.detail };
  }

  const side = (r) => (r.ok
    ? { ok: true, ms: r.ms, cpuSec: r.cpuSec === undefined ? null : r.cpuSec }
    : { ok: false, reason: r.reason, detail: r.detail });

  if (!hwaccelAvailable({ run, bin })) {
    return {
      ...common,
      ok: false,
      reason: MEASURE_UNAVAILABLE.NOT_BUILT,
      detail: `this ffmpeg does not list ${HWACCEL}; nothing was measured on the hardware side`,
      software: side(software),
    };
  }

  const hardware = decodeOnce(filePath, 'hardware', opts);

  if (!software.ok || !hardware.ok) {
    const broken = !hardware.ok ? hardware : software;
    return {
      ...common,
      ok: false,
      reason: MEASURE_UNAVAILABLE.FAILED,
      detail: broken.detail,
      software: side(software),
      hardware: side(hardware),
    };
  }

  const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);
  const cpuRatio = software.cpuSec && hardware.cpuSec ? ratio(software.cpuSec, hardware.cpuSec) : null;
  return {
    ...common,
    ok: true,
    software: side(software),
    hardware: side(hardware),
    // Two verdicts, because they disagree and both are true. Wall clock is what
    // a person waiting feels; CPU is what the NEXT job on this machine feels.
    fasterByClock: hardware.ms < software.ms ? 'hardware' : 'software',
    cheaperByCpu: cpuRatio === null ? null : (cpuRatio > 1 ? 'hardware' : 'software'),
    clockRatio: ratio(software.ms, hardware.ms),
    cpuRatio,
  };
}

/**
 * Which decoder this run will use, and the honest answer when the asked-for
 * one is not there.
 *
 * SOFTWARE IS THE DEFAULT, AND IT IS A MEASURED CHOICE rather than caution.
 * VideoToolbox costs a sixth of the CPU (see `measureDecode`) — but its output
 * is not bit-identical to the software decoder's. Measured on the Mini over a
 * 1080p HEVC Main 10 file: luma is bit-exact and one chroma plane differs at
 * 60.5 dB PSNR, which no eye will ever see, and which nonetheless makes the
 * encoded proxy a different FILE. Byte-identical output is what makes "a
 * re-run produces the same thing" a question anybody can check, on any
 * machine, so the default keeps it and the throughput is opt-in.
 */
function resolveDecodeMode(requested, { run, bin } = {}) {
  const want = text(requested) || 'software';
  if (want !== 'hardware') return { mode: 'software', requested: want };
  if (!hwaccelAvailable({ run, bin })) {
    return {
      mode: 'software',
      requested: want,
      fellBack: true,
      reason: MEASURE_UNAVAILABLE.NOT_BUILT,
      detail: `hardware decode was asked for, but this ffmpeg does not list ${HWACCEL}; decoded in software instead`,
    };
  }
  return { mode: 'hardware', requested: want };
}

// ---------------------------------------------------------------------------
// Where the derivatives live, and whether they are already there
// ---------------------------------------------------------------------------

function resolveDerivedDir(options = {}, env = process.env) {
  const supplied = text(options.derivedDir || env.STUDIO_DERIVED_DIR);
  if (supplied) return supplied;
  // Beside 4/8's `~/Studio/cache`, not inside it: ingest is free to empty its
  // cache once a source is archived, and that must not take the derivatives
  // the rest of the pipeline reads with it.
  return path.join(os.homedir(), 'Studio', 'derived');
}

/**
 * One folder per source, one deterministic name per derivative.
 *
 * Deterministic is the whole of "no duplicate files": nothing here ever
 * invents `proxy (1).mp4`, so a second run either reuses a file or overwrites
 * the one it owns.
 */
function derivedPathsFor({ derivedDir, key, lane = 'inbox' } = {}) {
  const dir = path.join(derivedDir, safeSegment(lane) || 'inbox', safeSegment(key));
  return {
    dir,
    proxy: path.join(dir, OUTPUT_NAMES.proxy),
    audio: path.join(dir, OUTPUT_NAMES.audio),
    contactSheet: path.join(dir, OUTPUT_NAMES.contactSheet),
    manifest: path.join(dir, OUTPUT_NAMES.manifest),
  };
}

/**
 * A Drive file id is already safe; a key somebody typed is not. Anything that
 * is not a letter, a digit, a dash, a dot or an underscore becomes a dash, and
 * a leading dot cannot survive — `..` as a key would otherwise write the
 * derivatives one folder up.
 */
function safeSegment(value) {
  return text(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // No run of dots survives ANYWHERE, not merely at the front. `path.join`
    // would not traverse out of `a-..-b`, but a folder name nobody can read at
    // a glance is one nobody checks, and the cost of forbidding it is nil.
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120);
}

/**
 * What the source WAS when these derivatives were made.
 *
 * Size and modification time rather than a content hash: this runs before
 * every encode, and a hash means reading gigabytes off disk to answer a
 * question the file system already answered. 4/8 hashes on the way in, which
 * is where a hash is worth what it costs.
 */
function sourceFingerprint(sourcePath) {
  const stat = fs.statSync(sourcePath);
  return {
    path: String(sourcePath),
    sizeBytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

function readManifest(manifestPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Is the artifact this manifest describes still on disk, unchanged, and made
 * from the same source?
 *
 * The size check is the one that earns its keep: a `.part` renamed by a
 * half-written run, or a file truncated by a full disk, is exactly the shape
 * that passes an existence check and fails to play.
 */
function artifactIsGood(manifest, name, fingerprint, outPath) {
  if (!manifest || manifest.version !== MANIFEST_VERSION) return false;
  const source = manifest.source;
  if (!source) return false;
  if (source.sizeBytes !== fingerprint.sizeBytes) return false;
  if (source.mtimeMs !== fingerprint.mtimeMs) return false;
  const record = manifest.outputs && manifest.outputs[name];
  if (!record) return false;
  if (record.action === ACTIONS.SKIPPED) return true;
  if (!record.bytes) return false;
  try {
    return fs.statSync(outPath).size === record.bytes;
  } catch {
    return false;
  }
}

/**
 * Write to `<name>.part`, then rename. The rename is the only moment the
 * finished name exists, and on one file system it is atomic — so a power cut
 * mid-encode leaves a `.part` that the next run deletes, never a short
 * `proxy.mp4` that every later run happily reuses.
 */
function encodeTo(outPath, args, runOptions) {
  const partPath = `${outPath}.part`;
  fs.rmSync(partPath, { force: true });
  const result = runFfmpeg(args.map((a) => (a === '__OUT__' ? partPath : a)), runOptions);
  if (!result.ok) {
    fs.rmSync(partPath, { force: true });
    return result;
  }
  let bytes = 0;
  try {
    bytes = fs.statSync(partPath).size;
  } catch {
    bytes = 0;
  }
  if (!bytes) {
    fs.rmSync(partPath, { force: true });
    return {
      ok: false,
      reason: FAILURES.OUTPUT_EMPTY,
      detail: `ffmpeg reported success but ${path.basename(outPath)} is empty`,
      ms: result.ms,
    };
  }
  fs.renameSync(partPath, outPath);
  return { ok: true, ms: result.ms, bytes };
}

/** Anything a dead run left behind, swept before this one starts. */
function sweepPartFiles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const swept = [];
  for (const name of names) {
    if (!name.endsWith('.part')) continue;
    fs.rmSync(path.join(dir, name), { force: true });
    swept.push(name);
  }
  return swept;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/**
 * Make (or reuse) the three derivatives for one source.
 *
 * Every answer it can give is named. It never throws for an ordinary failure —
 * a missing file, an unreadable container, an ffmpeg that refused — because
 * this is called by a worker whose job is to put a reason on a queue, and an
 * exception carrying a stack trace is not a reason anybody can act on.
 */
function buildDerivatives(options = {}) {
  const sourcePath = text(options.sourcePath);
  const key = text(options.key) || path.basename(sourcePath);
  const lane = text(options.lane) || 'inbox';
  const derivedDir = resolveDerivedDir(options);
  const floorKbps = positiveNumber(options.floorKbps)
    || positiveNumber(process.env.STUDIO_PROXY_FLOOR_KBPS)
    || DEFAULT_FLOOR_KBPS;
  const run = options.run || spawnSync;
  const ffmpegBin = options.ffmpegBin || process.env.STUDIO_FFMPEG || 'ffmpeg';
  const ffprobeBin = options.ffprobeBin || process.env.STUDIO_FFPROBE || 'ffprobe';
  const decode = resolveDecodeMode(options.decodeMode || process.env.STUDIO_DECODE_MODE, { run, bin: ffmpegBin });
  const decodeMode = decode.mode;
  const paths = derivedPathsFor({ derivedDir, key, lane });

  let fingerprint;
  try {
    fingerprint = sourceFingerprint(sourcePath);
  } catch (err) {
    return {
      ok: false,
      key,
      lane,
      sourcePath,
      outDir: paths.dir,
      reason: FAILURES.SOURCE_MISSING,
      detail: `${sourcePath}: ${err.message}`,
    };
  }

  const probed = options.probeJson
    ? { ok: true, json: options.probeJson }
    : probeSource(sourcePath, { run, bin: ffprobeBin });
  if (!probed.ok) {
    return {
      ok: false, key, lane, sourcePath, outDir: paths.dir,
      reason: probed.reason, detail: probed.detail,
    };
  }

  const streams = Array.isArray(probed.json.streams) ? probed.json.streams.filter(Boolean) : [];
  const video = primaryVideoStream(streams);
  const audio = firstAudioStream(streams);
  if (!video && !audio) {
    return {
      ok: false, key, lane, sourcePath, outDir: paths.dir,
      reason: FAILURES.SOURCE_EMPTY,
      detail: `${sourcePath} carries neither a picture track nor a sound track — there is nothing to make a working copy of`,
    };
  }

  const durationSec = positiveNumber(probed.json.format && probed.json.format.duration);
  const decision = decideProxy({ probeJson: probed.json, floorKbps });
  const timeoutMs = positiveNumber(options.timeoutMs) || encodeTimeoutMs(durationSec);
  const runOptions = { run, bin: ffmpegBin, timeoutMs, ...(options.clock ? { clock: options.clock } : {}) };

  fs.mkdirSync(paths.dir, { recursive: true });
  const sweptParts = sweepPartFiles(paths.dir);
  const previous = readManifest(paths.manifest);

  const outputs = {};
  const failures = [];
  const decodeNotes = decode.fellBack ? [decode.detail] : [];

  /**
   * Encode, and if a HARDWARE decode refuses, do it again in software and say
   * so. A GPU that will not take one particular file is a fact about that
   * file, not a reason to leave the pipeline with no working copy — and the
   * retry is recorded, because a silent fallback is how "it is using the GPU"
   * stays believed long after it stopped being true.
   */
  const encodeMaybeFallingBack = (outPath, argsFor) => {
    const first = encodeTo(outPath, argsFor(decodeMode), runOptions);
    if (first.ok || decodeMode !== 'hardware') return first;
    const detail = `${HWACCEL} could not decode this file (${first.detail}); it was decoded in software instead`;
    const second = encodeTo(outPath, argsFor('software'), runOptions);
    if (second.ok) {
      decodeNotes.push(detail);
      return { ...second, fellBackToSoftware: true, fallbackDetail: detail };
    }
    return second;
  };

  // --- the proxy -----------------------------------------------------------
  if (!decision.encode) {
    // Used directly, and the manifest says so with the number it was decided
    // on. Downstream reads `path`, which is the ORIGINAL — a skipped proxy is
    // not a missing proxy, and the field is never left empty.
    outputs.proxy = {
      action: ACTIONS.SKIPPED,
      reason: decision.reason,
      path: sourcePath,
      usedSourceDirectly: true,
      bitrateKbps: decision.bitrateKbps,
      bitrateBasis: decision.bitrateBasis,
      floorKbps: decision.floorKbps,
    };
  } else if (artifactIsGood(previous, 'proxy', fingerprint, paths.proxy)) {
    outputs.proxy = { ...previous.outputs.proxy, action: ACTIONS.REUSED };
  } else {
    const result = encodeMaybeFallingBack(paths.proxy, (mode) => proxyArgs({
      input: sourcePath,
      output: '__OUT__',
      hasAudio: Boolean(audio),
      decodeMode: mode,
    }));
    outputs.proxy = result.ok
      ? {
        action: ACTIONS.ENCODED,
        reason: decision.reason,
        path: paths.proxy,
        usedSourceDirectly: false,
        bytes: result.bytes,
        ms: result.ms,
        bitrateKbps: decision.bitrateKbps,
        bitrateBasis: decision.bitrateBasis,
        floorKbps: decision.floorKbps,
        // Which decoder made this file. Recorded and NOT compared on a re-run:
        // the two decoders differ by a chroma rounding no eye can see, and
        // rebuilding hours of proxies over that would be worse than a library
        // that says honestly which mode each file came from.
        decodedWith: result.fellBackToSoftware ? 'software' : decodeMode,
      }
      : { action: ACTIONS.FAILED, reason: result.reason, detail: result.detail };
    if (!result.ok) failures.push({ output: 'proxy', reason: result.reason, detail: result.detail });
  }

  // --- the analysis WAV ----------------------------------------------------
  if (!audio) {
    outputs.audio = {
      action: ACTIONS.SKIPPED,
      reason: SKIP_REASONS.NO_AUDIO,
      path: null,
      detail: 'the container has no sound track, so there is nothing for speech recognition to read',
    };
  } else if (artifactIsGood(previous, 'audio', fingerprint, paths.audio)) {
    outputs.audio = { ...previous.outputs.audio, action: ACTIONS.REUSED };
  } else {
    const result = encodeTo(paths.audio, analysisAudioArgs({
      input: sourcePath,
      output: '__OUT__',
      decodeMode: 'software', // decoding sound on the GPU buys nothing
    }), runOptions);
    outputs.audio = result.ok
      ? {
        action: ACTIONS.ENCODED,
        path: paths.audio,
        bytes: result.bytes,
        ms: result.ms,
        sampleRate: ANALYSIS_SAMPLE_RATE,
        channels: ANALYSIS_CHANNELS,
      }
      : { action: ACTIONS.FAILED, reason: result.reason, detail: result.detail };
    if (!result.ok) failures.push({ output: 'audio', reason: result.reason, detail: result.detail });
  }

  // --- the contact sheet ---------------------------------------------------
  if (!video) {
    outputs.contactSheet = {
      action: ACTIONS.SKIPPED,
      reason: SKIP_REASONS.NO_VIDEO,
      path: null,
      detail: 'the container has no picture track, so there is nothing to photograph',
    };
  } else if (artifactIsGood(previous, 'contactSheet', fingerprint, paths.contactSheet)) {
    outputs.contactSheet = { ...previous.outputs.contactSheet, action: ACTIONS.REUSED };
  } else {
    const result = encodeMaybeFallingBack(paths.contactSheet, (mode) => contactSheetArgs({
      input: sourcePath,
      output: '__OUT__',
      durationSec,
      decodeMode: mode,
    }));
    outputs.contactSheet = result.ok
      ? {
        action: ACTIONS.ENCODED,
        path: paths.contactSheet,
        bytes: result.bytes,
        ms: result.ms,
        tiles: SHEET_TILES,
        // Said out loud, because a sheet built on the fallback rate covers the
        // opening minute rather than the clip (DOCTRINE 5.31).
        coversWholeClip: Boolean(durationSec),
      }
      : { action: ACTIONS.FAILED, reason: result.reason, detail: result.detail };
    if (!result.ok) failures.push({ output: 'contactSheet', reason: result.reason, detail: result.detail });
  }

  // --- the decode measurement ---------------------------------------------
  let measurement = null;
  if (options.measureDecode && video) {
    measurement = measureDecode(sourcePath, { run, bin: ffmpegBin, timeoutMs, ...(options.clock ? { clock: options.clock } : {}) });
  }

  const manifest = {
    version: MANIFEST_VERSION,
    key,
    lane,
    source: fingerprint,
    media: {
      durationSec,
      videoCodec: video ? text(video.codec_name) || null : null,
      pixFmt: video ? text(video.pix_fmt) || null : null,
      audioCodec: audio ? text(audio.codec_name) || null : null,
      streamCount: streams.length,
    },
    decision,
    outputs,
    decodeMode: { requested: decode.requested, used: decodeMode, notes: decodeNotes },
    decode: measurement,
  };

  // The manifest is written even when an output failed, and it names only what
  // is actually on disk — a manifest describing a file that is not there is
  // worse than no manifest, because the next run reuses it.
  writeManifest(paths.manifest, manifest);

  return {
    ok: failures.length === 0,
    key,
    lane,
    sourcePath,
    outDir: paths.dir,
    paths,
    decision,
    outputs,
    decodeMode: { requested: decode.requested, used: decodeMode, notes: decodeNotes },
    decode: measurement,
    sweptParts,
    failures,
    manifestPath: paths.manifest,
  };
}

function writeManifest(manifestPath, manifest) {
  const partPath = `${manifestPath}.part`;
  const keep = { ...manifest, outputs: {} };
  for (const [name, record] of Object.entries(manifest.outputs || {})) {
    if (record && record.action === ACTIONS.FAILED) continue;
    keep.outputs[name] = record;
  }
  fs.writeFileSync(partPath, `${JSON.stringify(keep, null, 2)}\n`, 'utf8');
  fs.renameSync(partPath, manifestPath);
}

/**
 * The run report, in the words a person would use.
 *
 * DOCTRINE 5.31: the interesting lines here are the ones where nothing was
 * produced, and each of them says WHICH nothing it is — skipped on a
 * measurement, skipped because the track does not exist, or failed.
 */
function formatDerivativesReport(result) {
  if (!result) return ['Nothing to report — no result was produced.'];
  const lines = [];
  const name = path.basename(result.sourcePath || result.key || 'the source');

  if (!result.ok && result.reason && !result.outputs) {
    lines.push(`${name}: nothing could be made — ${result.reason}.`);
    if (result.detail) lines.push(`  ${result.detail}`);
    return lines;
  }

  lines.push(`${name} -> ${result.outDir}`);

  const proxy = result.outputs.proxy || {};
  if (proxy.action === ACTIONS.SKIPPED) {
    lines.push(`  proxy: NOT MADE, on purpose — ${humanKbps(proxy.bitrateKbps)} is at or below the ${proxy.floorKbps} kbps floor, `
      + `so a 720p CRF ${PROXY_CRF} copy would be no smaller. The original is used directly.`);
  } else if (proxy.action === ACTIONS.REUSED) {
    lines.push(`  proxy: already made (${humanBytes(proxy.bytes)}), source unchanged — reused.`);
  } else if (proxy.action === ACTIONS.ENCODED) {
    lines.push(`  proxy: made (${humanBytes(proxy.bytes)} in ${humanMs(proxy.ms)}) — ${proxyWhy(proxy.reason, proxy)}`);
  } else if (proxy.action === ACTIONS.FAILED) {
    lines.push(`  proxy: FAILED — ${proxy.reason}: ${proxy.detail}`);
  }

  const audio = result.outputs.audio || {};
  if (audio.action === ACTIONS.SKIPPED) {
    lines.push('  analysis audio: NOT MADE — this file has no sound track at all, so there is nothing to transcribe.');
  } else if (audio.action === ACTIONS.REUSED) {
    lines.push(`  analysis audio: already made (${humanBytes(audio.bytes)}) — reused.`);
  } else if (audio.action === ACTIONS.ENCODED) {
    lines.push(`  analysis audio: made (${humanBytes(audio.bytes)} in ${humanMs(audio.ms)}), ${ANALYSIS_SAMPLE_RATE / 1000} kHz mono.`);
  } else if (audio.action === ACTIONS.FAILED) {
    lines.push(`  analysis audio: FAILED — ${audio.reason}: ${audio.detail}`);
  }

  const sheet = result.outputs.contactSheet || {};
  if (sheet.action === ACTIONS.SKIPPED) {
    lines.push('  contact sheet: NOT MADE — this file has no picture track.');
  } else if (sheet.action === ACTIONS.REUSED) {
    lines.push('  contact sheet: already made — reused.');
  } else if (sheet.action === ACTIONS.ENCODED) {
    lines.push(`  contact sheet: made (${SHEET_TILES} stills)${sheet.coversWholeClip ? '' : ' — WARNING: the clip has no readable duration, so the sheet samples the opening minute rather than the whole thing'}.`);
  } else if (sheet.action === ACTIONS.FAILED) {
    lines.push(`  contact sheet: FAILED — ${sheet.reason}: ${sheet.detail}`);
  }

  for (const note of (result.decodeMode && result.decodeMode.notes) || []) {
    lines.push(`  decode: ${note}`);
  }

  if (result.decode) {
    const d = result.decode;
    if (d.ok) {
      lines.push(`  decode measured: ${HWACCEL} ${humanMs(d.hardware.ms)} against software ${humanMs(d.software.ms)} on the clock`
        + ` (${d.fasterByClock} ahead), and ${d.hardware.cpuSec}s against ${d.software.cpuSec}s of CPU`
        + `${d.cpuRatio ? ` — ${d.cpuRatio}x cheaper on the GPU` : ''}.`);
    } else {
      lines.push(`  decode: NOT MEASURED — ${d.reason}. ${d.detail || ''}`.trim());
    }
  }

  if (result.sweptParts && result.sweptParts.length) {
    lines.push(`  swept ${result.sweptParts.length} half-written file(s) left by an earlier run: ${result.sweptParts.join(', ')}`);
  }
  return lines;
}

function proxyWhy(reason, proxy) {
  if (reason === ENCODE_REASONS.ABOVE_FLOOR) {
    return `the source runs at ${humanKbps(proxy.bitrateKbps)}, above the ${proxy.floorKbps} kbps floor.`;
  }
  if (reason === ENCODE_REASONS.NOT_DIRECTLY_USABLE) {
    return 'the source is not 8-bit H.264, so it needs an ordinary copy whatever its size.';
  }
  if (reason === ENCODE_REASONS.BITRATE_UNKNOWN) {
    return 'the source bitrate could not be read, so a copy was made rather than guessed against the floor.';
  }
  return String(reason || 'no reason recorded');
}

function humanKbps(kbps) {
  return kbps === null || kbps === undefined ? 'an unreadable bitrate' : `${kbps} kbps`;
}

function humanMs(ms) {
  const num = Number(ms);
  if (!Number.isFinite(num)) return 'an unmeasured time';
  if (num < 1000) return `${Math.round(num)}ms`;
  return `${Math.round(num / 100) / 10}s`;
}

function humanBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num)) return 'an unknown size';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${Math.round(num / 102.4) / 10} KB`;
  if (num < 1024 * 1024 * 1024) return `${Math.round(num / (1024 * 102.4)) / 10} MB`;
  return `${Math.round(num / (1024 * 1024 * 102.4)) / 10} GB`;
}

module.exports = {
  buildDerivatives,
  formatDerivativesReport,
  measureDecode,
  // Exported for their own tests. Each is a rule that can be wrong on its own,
  // and driving a whole encode to check one boundary is how a test ends up
  // asserting nothing in particular.
  decideProxy,
  sourceBitrate,
  isDirectlyUsable,
  primaryVideoStream,
  firstAudioStream,
  proxyArgs,
  analysisAudioArgs,
  contactSheetArgs,
  scaleFilter,
  sheetRate,
  encodeTimeoutMs,
  runFfmpeg,
  probeSource,
  hwaccelAvailable,
  resolveDecodeMode,
  parseBenchmark,
  decodeOnce,
  derivedPathsFor,
  resolveDerivedDir,
  safeSegment,
  sourceFingerprint,
  artifactIsGood,
  sweepPartFiles,
  humanBytes,
  ACTIONS,
  SKIP_REASONS,
  ENCODE_REASONS,
  BITRATE_BASIS,
  FAILURES,
  MEASURE_UNAVAILABLE,
  OUTPUT_NAMES,
  DEFAULT_FLOOR_KBPS,
  DIRECTLY_USABLE_CODECS,
  DIRECTLY_USABLE_PIX_FMTS,
  PROXY_CRF,
  PROXY_PRESET,
  PROXY_PIX_FMT,
  PROXY_LONG_EDGE,
  PROXY_SHORT_EDGE,
  ANALYSIS_SAMPLE_RATE,
  ANALYSIS_CHANNELS,
  SHEET_COLUMNS,
  SHEET_ROWS,
  SHEET_TILES,
  MANIFEST_VERSION,
  HWACCEL,
};
