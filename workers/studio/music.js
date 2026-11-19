'use strict';

/**
 * THE MUSIC PICKER — which track from the shelf goes under which edit.
 *
 * Reel Spinner 5a (SC-837). Dane chose on 2026-11-16 that music is "Picked for
 * you": nobody chooses a track by hand. Each edit gets one track from a fixed
 * shelf of licensed music, matched to the mood the scoring found (2c,
 * workers/studio/moments.js `MOODS`).
 *
 * Pure: no network, no files, no clock. The shelf is the committed manifest
 * `lib/studioMusicShelf.json` (built once by
 * scripts/studio_build_music_shelf.cjs); the audio files live on Drive in the
 * Studio folder's `Music` folder and are never committed.
 *
 * THE RULES, in order:
 *
 *   1. Tracks of the edit's mood. A mood with no tracks on the shelf, or no
 *      mood at all, falls back to the CALMEST track (the lowest-tempo `calm`
 *      one) and says so in `note` — music under a talking head that is too
 *      quiet is a smaller mistake than music that is too loud.
 *   2. Never the track the previous edit of the same recording got
 *      (`previousTrackId`). If that rules out every track of the mood, the
 *      calmest track that is not the previous one is used, and `note` says so.
 *   3. Long enough to run under the whole edit if any is; otherwise the
 *      longest (5c, the mixer, loops or fades it).
 *   4. Among what is left, `seed` (the edit's id) chooses, so two edits of the
 *      same mood do not all get the first track, and the same edit always
 *      gets the same track when asked again.
 *
 * WHAT IS STORED. The pick is stored as the track's `id` in
 * `video_edits.music_track` — an id, never a copy of its title (CLAUDE.md
 * landmine 19). `trackLabel` turns the id back into words for a screen, and
 * `attribution` is the line the YouTube description must carry (6b).
 */

const { MOODS } = require('./moments.js');
// The shelf and its labeller live in lib/ so the website can read them too.
const { trackLabel, loadShelf } = require('../../lib/studioMusicShelf.js');

/** The mood the fallback comes from. */
const CALM = 'calm';

const REQUIRED_TEXT = ['id', 'title', 'artist', 'licence', 'licenceUrl', 'sourceUrl', 'mood', 'fileName'];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Check a shelf (the parsed manifest). Returns `{ ok, tracks, problems }`:
 * `ok` false means at least one track is unusable, and each problem names the
 * track and what is wrong. A licence that needs credit must carry its line.
 */
function checkShelf(shelf) {
  const tracks = Array.isArray(shelf && shelf.tracks) ? shelf.tracks : null;
  if (!tracks) return { ok: false, tracks: [], problems: ['the shelf has no "tracks" list'] };
  const problems = [];
  const seen = new Set();
  tracks.forEach((track, i) => {
    const name = text(track && track.id) || `track ${i + 1}`;
    for (const key of REQUIRED_TEXT) {
      if (!text(track && track[key])) problems.push(`${name}: missing ${key}`);
    }
    if (track && track.mood && !MOODS.includes(track.mood)) {
      problems.push(`${name}: mood ${JSON.stringify(track.mood)} is not one of ${MOODS.join(', ')}`);
    }
    if (!isPositive(track && track.lengthS)) problems.push(`${name}: lengthS must be a positive number of seconds`);
    if (track && track.attributionRequired && !text(track.attribution)) {
      problems.push(`${name}: its licence needs credit, and it has no attribution line`);
    }
    for (const key of ['licenceUrl', 'sourceUrl']) {
      const url = text(track && track[key]);
      if (url && !/^https:\/\//.test(url)) problems.push(`${name}: ${key} is not an https link`);
    }
    if (seen.has(name)) problems.push(`${name}: the id is used twice`);
    seen.add(name);
  });
  return { ok: problems.length === 0, tracks, problems };
}

/** A stable small number from a string, so a seed always picks the same index. */
function hashOf(value) {
  let h = 2166136261;
  const s = String(value == null ? '' : value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The calm tracks, calmest first: lowest tempo, then shortest id. */
function calmestFirst(tracks) {
  const tempo = (t) => (isPositive(t.bpm) ? t.bpm : Number.MAX_SAFE_INTEGER);
  return tracks.filter((t) => t.mood === CALM).sort((a, b) => tempo(a) - tempo(b) || byId(a, b));
}

/** Rule 3 and 4 over a non-empty pool. */
function chooseFrom(pool, lengthS, seed) {
  const need = isPositive(lengthS) ? lengthS : 0;
  const longEnough = pool.filter((t) => t.lengthS >= need);
  const candidates = longEnough.length
    ? longEnough.slice().sort(byId)
    : [pool.slice().sort((a, b) => b.lengthS - a.lengthS || byId(a, b))[0]];
  return candidates[hashOf(seed) % candidates.length];
}

/**
 * Pick the music for one edit.
 *
 *   shelf            the parsed manifest
 *   mood             the edit's mood (a word from MOODS, or '' for none)
 *   lengthS          how long the edit runs, in seconds
 *   previousTrackId  the track the previous edit of the same recording got
 *   seed             the edit's id, so the pick is stable and varied
 *
 * Returns `{ ok: true, track, trackId, attribution, note }` (`note` is '' unless
 * a rule had to bend, and then says which), or `{ ok: false, reason }` when the
 * shelf is unusable or holds nothing to pick.
 */
function pickTrack({ shelf, mood = '', lengthS = 0, previousTrackId = '', seed = '' } = {}) {
  const checked = checkShelf(shelf);
  if (!checked.ok) return { ok: false, reason: `the music shelf is not usable: ${checked.problems.join('; ')}` };
  const tracks = checked.tracks;
  const previous = text(previousTrackId);
  const wanted = text(mood);
  const notPrevious = (t) => t.id !== previous;

  let pool = wanted ? tracks.filter((t) => t.mood === wanted) : [];
  let note = '';
  if (!pool.length) {
    note = wanted
      ? `no track on the shelf has the mood "${wanted}", so the calmest track was used`
      : 'the edit has no mood, so the calmest track was used';
  } else {
    pool = pool.filter(notPrevious);
    if (!pool.length) {
      note = `every "${wanted}" track was the previous edit's, so the calmest other track was used`;
    }
  }

  let track;
  if (pool.length) {
    track = chooseFrom(pool, lengthS, seed);
  } else {
    track = calmestFirst(tracks).find(notPrevious) || tracks.slice().sort(byId).find(notPrevious);
    if (!track) return { ok: false, reason: 'the shelf holds no track other than the previous edit\'s' };
  }

  return {
    ok: true,
    track,
    trackId: track.id,
    attribution: text(track.attribution),
    note,
  };
}

/**
 * The mood of a whole recording's edit: the mood of its best-scoring moment
 * that has one, or '' (which picks the calmest track).
 */
function moodForMoments(moments) {
  const scored = (Array.isArray(moments) ? moments : [])
    .filter((m) => m && MOODS.includes(m.mood))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return scored.length ? scored[0].mood : '';
}

module.exports = {
  CALM,
  checkShelf,
  pickTrack,
  moodForMoments,
  trackLabel,
  loadShelf,
};
