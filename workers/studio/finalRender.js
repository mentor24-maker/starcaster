'use strict';

/**
 * THE FINISHED VIDEO — what ffmpeg is told to make (Reel Spinner 5c, SC-840).
 *
 * Pure: no network, no files, no clock. The pass (finalRenderPass.js) fetches
 * everything and runs ffmpeg; this file decides only what the command says,
 * so every rule here can be tested without a video.
 *
 * WHAT A FINISHED VIDEO IS, in order:
 *
 *   title card   TITLE_CARD_S seconds of the title card (cards.js), silent
 *   the edit     the SAME kept stretches the rough cut used (the edit's row,
 *                never re-planned), cut from the ORIGINAL at its own size,
 *                with the sound the row names
 *   end card     END_CARD_S seconds of the end card, silent
 *
 * and the picked music under all of it, fading in over MUSIC_FADE_IN_S and
 * out over MUSIC_FADE_OUT_S. A track shorter than the video loops
 * (`-stream_loop -1`, then cut to length).
 *
 * HOW LOUD. The voice and the music are each brought to the same loudness
 * first (LOUDNESS, -16 LUFS, the level YouTube plays speech at), and only then
 * is the music turned down by MUSIC_VOLUME (20 dB). Without the first step the
 * gap depends on the recording: on the first real render (2026-11-19, a quiet
 * Zoom recording) a fixed volume put the music only 3 dB under the speech.
 * The level is fixed rather than ducked under the voice: a compressor is one
 * more setting that can be wrong in a way nobody hears until the video is
 * public, and 20 dB under, the voice always wins.
 *
 * YOUTUBE'S RECOMMENDED SETTINGS (support.google.com/youtube/answer/1722171):
 * H.264 High profile, 4:2:0, two B-frames, a closed keyframe every half
 * second, the moov atom at the front (`+faststart`), constant frame rate, and
 * AAC-LC stereo at 48 kHz, 384 kb/s. Quality is x264 CRF 18 at `medium`,
 * visually lossless for a talking head; YouTube re-encodes everything anyway.
 *
 * The cards are 1920 × 1080 pictures. A recording of another shape (a phone
 * held upright) gets them scaled to fit and padded with black, never
 * stretched.
 *
 * KNOWN LIMIT: an iPhone's HDR (HLG) recording is converted to ordinary
 * 8-bit colour without tone-mapping, because the Mini's ffmpeg has no zscale.
 * It can look a little flat. The pass says so in its report (`hdr`).
 */

const TITLE_CARD_S = 4;
const END_CARD_S = 6;
/** -20 dB: the music, once as loud as the voice, is turned down this far. */
const MUSIC_VOLUME = 0.1;
const LOUDNESS = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const MUSIC_FADE_IN_S = 2;
const MUSIC_FADE_OUT_S = 4;
const SAMPLE_RATE = 48000;

/** Bump when anything below changes, so a render kept from an earlier try under old settings is not reused. */
const RENDER_VERSION = '2';

const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '384k', '-ar', String(SAMPLE_RATE), '-ac', '2'];

/**
 * A generous guess at the finished file's size, to decide whether the disk
 * has room before anything is downloaded: 0.2 bits per pixel per frame of
 * picture (CRF 18 on a talking head comes in well under it: about 12 Mbit/s
 * at 1080p30) plus the 384 kb/s sound. The measured figure is in docs/STUDIO.md.
 */
const ESTIMATE_BITS_PER_PIXEL = 0.2;
const AUDIO_BYTES_PER_SECOND = 384000 / 8;
/** When the catalog does not know the size: 1080p at 30 frames a second. */
const FALLBACK_PIXELS_PER_SECOND = 1920 * 1080 * 30;

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function keptSeconds(ranges) {
  return (Array.isArray(ranges) ? ranges : []).reduce((sum, r) => sum + (Number(r.end_s) - Number(r.start_s)), 0);
}

/** How long the finished video runs: the title card, the kept stretches, the end card. */
function expectedLengthS(ranges) {
  return round(TITLE_CARD_S + keptSeconds(ranges) + END_CARD_S);
}

/**
 * The frame rate as ffmpeg should be told it: "30000/1001" stays a fraction
 * (a rounded 29.97 drifts a frame every half minute), anything unusable falls
 * back to 30. `{ rate: string, fps: number }`.
 */
function frameRate(value) {
  const raw = String(value == null ? '' : value).trim();
  const frac = /^(\d+)\/(\d+)$/.exec(raw);
  if (frac && Number(frac[2]) > 0) {
    const fps = Number(frac[1]) / Number(frac[2]);
    if (fps >= 1 && fps <= 240) return { rate: raw, fps };
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 240) {
    // The NTSC rates a phone reports as decimals, back to their exact fractions.
    for (const [approx, exact] of [[23.976, '24000/1001'], [29.97, '30000/1001'], [59.94, '60000/1001']]) {
      if (Math.abs(n - approx) < 0.01) return { rate: exact, fps: n };
    }
    return { rate: String(round(n)), fps: n };
  }
  return { rate: '30', fps: 30 };
}

/** Even numbers, which 4:2:0 picture needs. */
function even(value) {
  const n = Math.floor(positive(value));
  return n - (n % 2);
}

/** Bytes the finished file is expected to need, from what the catalog knows about the recording. */
function estimateOutputBytes({ ranges, width, height, fps }) {
  const pixelsPerSecond = positive(width) && positive(height) && positive(fps)
    ? positive(width) * positive(height) * positive(fps)
    : FALLBACK_PIXELS_PER_SECOND;
  const seconds = Math.max(1, expectedLengthS(ranges));
  return Math.ceil(seconds * ((pixelsPerSecond * ESTIMATE_BITS_PER_PIXEL) / 8 + AUDIO_BYTES_PER_SECOND));
}

function videoArgs(fps) {
  // A closed keyframe every half second, which is what YouTube asks for.
  const gop = Math.max(1, Math.round(positive(fps) / 2) || 15);
  return [
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-bf', '2', '-g', String(gop), '-keyint_min', String(gop), '-flags', '+cgop',
  ];
}

/**
 * The ffmpeg inputs, in the order the filter graph names them.
 *
 *   0  the original (picture; and sound when the edit uses its own)
 *   1  the other recording's sound, only when the edit uses it
 *   n  the title card, looped for TITLE_CARD_S
 *   n+1 the end card, looped for END_CARD_S
 *   n+2 the music, looped for as long as it takes
 */
function inputsFor({ picturePath, soundPath, titleCardPath, endCardPath, musicPath, rate }) {
  const args = ['-i', picturePath];
  const separateSound = Boolean(soundPath) && soundPath !== picturePath;
  if (separateSound) args.push('-i', soundPath);
  const titleInput = separateSound ? 2 : 1;
  args.push('-loop', '1', '-framerate', rate, '-t', String(TITLE_CARD_S), '-i', titleCardPath);
  args.push('-loop', '1', '-framerate', rate, '-t', String(END_CARD_S), '-i', endCardPath);
  args.push('-stream_loop', '-1', '-i', musicPath);
  return {
    args,
    audioInput: separateSound ? 1 : 0,
    titleInput,
    endInput: titleInput + 1,
    musicInput: titleInput + 2,
  };
}

/**
 * The filter graph. Written to a file, because a full edit of an hour's
 * recording has hundreds of kept stretches.
 *
 * Each kept stretch of picture and sound is trimmed and joined with `concat`,
 * which keeps every stretch's sound with its picture — the rule the rough cut
 * uses (roughCutPass.js `filterScript`). `shiftS` puts another recording's
 * sound on the picture's clock.
 */
function filterScript({ ranges, shiftS = 0, width, height, rate, inputs }) {
  const n = Array.isArray(ranges) ? ranges.length : 0;
  if (!n) throw new Error('an edit with no kept stretches cannot be rendered');
  const w = even(width);
  const h = even(height);
  if (!w || !h) throw new Error(`the recording's picture size is not known (${width} × ${height}), so the cards cannot be fitted to it`);
  const total = expectedLengthS(ranges);
  const fadeOutAt = round(Math.max(0, total - MUSIC_FADE_OUT_S));
  const sound = 'aresample=' + SAMPLE_RATE + ',aformat=sample_fmts=fltp:channel_layouts=stereo';
  const card = (input, seconds, out) => `[${input}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,`
    + `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,fps=${rate},`
    + `trim=duration=${seconds},setpts=PTS-STARTPTS[${out}];`;
  const lines = [];
  lines.push(`[0:v]split=${n}${ranges.map((_, i) => `[v${i}]`).join('')};`);
  lines.push(`[${inputs.audioInput}:a]asplit=${n}${ranges.map((_, i) => `[a${i}]`).join('')};`);
  ranges.forEach((r, i) => {
    const s = round(Number(r.start_s));
    const e = round(Number(r.end_s));
    lines.push(`[v${i}]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[pv${i}];`);
    lines.push(`[a${i}]atrim=start=${round(s + shiftS)}:end=${round(e + shiftS)},asetpts=PTS-STARTPTS[pa${i}];`);
  });
  lines.push(`${ranges.map((_, i) => `[pv${i}][pa${i}]`).join('')}concat=n=${n}:v=1:a=1[keptv][kepta];`);
  lines.push(`[keptv]scale=${w}:${h},setsar=1,format=yuv420p,fps=${rate}[mainv];`);
  // loudnorm works at 192 kHz inside, so the sound is brought back to 48 kHz after it.
  // And cut back to exactly the kept length: loudnorm hands back a few extra
  // samples at the end, and the end card would start that much late.
  lines.push(`[kepta]${sound},${LOUDNESS},${sound},apad,atrim=duration=${round(keptSeconds(ranges))}[maina];`);
  lines.push(card(inputs.titleInput, TITLE_CARD_S, 'titlev'));
  lines.push(card(inputs.endInput, END_CARD_S, 'endv'));
  lines.push(`aevalsrc=0:c=stereo:s=${SAMPLE_RATE}:d=${TITLE_CARD_S},aformat=sample_fmts=fltp[titlea];`);
  lines.push(`aevalsrc=0:c=stereo:s=${SAMPLE_RATE}:d=${END_CARD_S},aformat=sample_fmts=fltp[enda];`);
  lines.push('[titlev][titlea][mainv][maina][endv][enda]concat=n=3:v=1:a=1[outv][voice];');
  lines.push(`[${inputs.musicInput}:a]${sound},atrim=duration=${total},asetpts=PTS-STARTPTS,${LOUDNESS},${sound},volume=${MUSIC_VOLUME},`
    + `afade=t=in:st=0:d=${MUSIC_FADE_IN_S},afade=t=out:st=${fadeOutAt}:d=${MUSIC_FADE_OUT_S}[music];`);
  lines.push('[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]');
  return lines.join('\n');
}

/**
 * The whole ffmpeg command. `scriptPath` is where the pass wrote
 * `filterScript`'s output.
 */
function renderArgs({ picturePath, soundPath, titleCardPath, endCardPath, musicPath, scriptPath, outPath, rate, fps }) {
  const inputs = inputsFor({ picturePath, soundPath, titleCardPath, endCardPath, musicPath, rate });
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    ...inputs.args,
    '-/filter_complex', scriptPath,
    '-map', '[outv]', '-map', '[outa]',
    ...videoArgs(fps), ...AUDIO_ARGS,
    '-movflags', '+faststart', '-f', 'mp4', outPath,
  ];
}

/**
 * The picture's shown size and frame rate, out of ffprobe's JSON for the
 * first video stream. A phone held upright records landscape pixels with a
 * rotation tag; ffmpeg turns the picture on the way in, so the size that
 * matters is the turned one.
 *
 * `{ ok: true, width, height, rate, fps, hdr }` or `{ ok: false, why }`.
 */
function pictureFacts(probeJson) {
  const streams = Array.isArray(probeJson && probeJson.streams) ? probeJson.streams : [];
  const video = streams.find((s) => s && s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (!video) return { ok: false, why: 'the original has no picture' };
  let rotation = Number(video.tags && video.tags.rotate) || 0;
  for (const side of Array.isArray(video.side_data_list) ? video.side_data_list : []) {
    if (side && Number.isFinite(Number(side.rotation))) rotation = Number(side.rotation);
  }
  const turned = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const width = even(turned ? video.height : video.width);
  const height = even(turned ? video.width : video.height);
  if (!width || !height) return { ok: false, why: `the original's picture size could not be read (${video.width} × ${video.height})` };
  const avg = frameRate(video.avg_frame_rate);
  const { rate, fps } = String(video.avg_frame_rate || '').startsWith('0') || !video.avg_frame_rate
    ? frameRate(video.r_frame_rate) : avg;
  const transfer = String(video.color_transfer || '');
  return { ok: true, width, height, rate, fps, hdr: transfer === 'arib-std-b67' || transfer === 'smpte2084' };
}

/**
 * Is the finished file the length it should be? The picture runs at a
 * constant frame rate, so each kept stretch can come out up to a frame off
 * where it starts and ends; `toleranceS` allows one frame per stretch and
 * card, and never less than a tenth of a second.
 */
function lengthCheck({ ranges, fps, actualS }) {
  const expected = expectedLengthS(ranges);
  const frame = 1 / (positive(fps) || 30);
  const toleranceS = round(Math.max(0.1, frame * ((Array.isArray(ranges) ? ranges.length : 0) + 2)));
  const actual = Number(actualS);
  if (!Number.isFinite(actual) || actual <= 0) {
    return { ok: false, expectedS: expected, toleranceS, why: 'the finished file\'s length could not be read' };
  }
  const offS = round(actual - expected);
  if (Math.abs(offS) > toleranceS) {
    return { ok: false, expectedS: expected, actualS: actual, offS, toleranceS,
      why: `the finished file runs ${round(actual)} s, but the cards and the kept stretches add up to ${expected} s (${offS > 0 ? '+' : ''}${offS} s, more than the ${toleranceS} s allowed)` };
  }
  return { ok: true, expectedS: expected, actualS: actual, offS, toleranceS };
}

module.exports = {
  TITLE_CARD_S,
  END_CARD_S,
  MUSIC_VOLUME,
  LOUDNESS,
  MUSIC_FADE_IN_S,
  MUSIC_FADE_OUT_S,
  RENDER_VERSION,
  AUDIO_ARGS,
  keptSeconds,
  expectedLengthS,
  frameRate,
  estimateOutputBytes,
  videoArgs,
  inputsFor,
  filterScript,
  renderArgs,
  pictureFacts,
  lengthCheck,
};
