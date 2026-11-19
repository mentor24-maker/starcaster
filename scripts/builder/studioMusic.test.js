'use strict';

// Reel Spinner 5a (SC-837): the music picker and the committed shelf.

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkShelf, pickTrack, moodForMoments, trackLabel, loadShelf } = require('../../workers/studio/music.js');
const { MOODS } = require('../../workers/studio/moments.js');

function track(id, mood, extra = {}) {
  return {
    id,
    title: id,
    artist: 'Test Artist',
    mood,
    lengthS: 200,
    bpm: 100,
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: `https://example.com/${id}`,
    attributionRequired: true,
    attribution: `"${id}" Test Artist`,
    fileName: `${id}.mp3`,
    driveFileId: `drive-${id}`,
    ...extra,
  };
}

const SHELF = {
  tracks: [
    track('h1', 'hopeful'),
    track('h2', 'hopeful'),
    track('h3', 'hopeful', { lengthS: 60 }),
    track('u1', 'urgent'),
    track('c-slow', 'calm', { bpm: 55 }),
    track('c-fast', 'calm', { bpm: 120 }),
  ],
};

test('a pick matches the mood', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const pick = pickTrack({ shelf: SHELF, mood: 'hopeful', lengthS: 90, seed });
    assert.equal(pick.ok, true);
    assert.equal(pick.track.mood, 'hopeful');
    assert.equal(pick.note, '');
    assert.equal(pick.attribution, `"${pick.trackId}" Test Artist`);
  }
});

test('the same edit always gets the same track, and different edits spread out', () => {
  const again = pickTrack({ shelf: SHELF, mood: 'hopeful', seed: 'edit-1' });
  assert.equal(pickTrack({ shelf: SHELF, mood: 'hopeful', seed: 'edit-1' }).trackId, again.trackId);
  const picked = new Set();
  for (let i = 0; i < 40; i++) picked.add(pickTrack({ shelf: SHELF, mood: 'hopeful', seed: `edit-${i}` }).trackId);
  assert.ok(picked.size > 1, 'every edit got the same track');
});

test('no repeat within a recording: the previous edit\'s track is never picked again', () => {
  for (let i = 0; i < 40; i++) {
    const pick = pickTrack({ shelf: SHELF, mood: 'hopeful', previousTrackId: 'h1', seed: `edit-${i}` });
    assert.notEqual(pick.trackId, 'h1');
    assert.equal(pick.track.mood, 'hopeful');
  }
});

test('a mood whose only track was the previous one falls back to the calmest other track and says so', () => {
  const pick = pickTrack({ shelf: SHELF, mood: 'urgent', previousTrackId: 'u1' });
  assert.equal(pick.trackId, 'c-slow');
  assert.match(pick.note, /every "urgent" track was the previous edit's/);
});

test('a mood with no tracks falls back to the calmest track and says so', () => {
  const pick = pickTrack({ shelf: SHELF, mood: 'playful', seed: 'x' });
  assert.equal(pick.ok, true);
  assert.equal(pick.trackId, 'c-slow');
  assert.match(pick.note, /no track on the shelf has the mood "playful"/);
});

test('an edit with no mood gets the calmest track and says so', () => {
  const pick = pickTrack({ shelf: SHELF, mood: '' });
  assert.equal(pick.trackId, 'c-slow');
  assert.match(pick.note, /no mood/);
});

test('the calmest track is skipped when it was the previous one', () => {
  const pick = pickTrack({ shelf: SHELF, mood: 'playful', previousTrackId: 'c-slow' });
  assert.equal(pick.trackId, 'c-fast');
});

test('a track long enough for the edit is preferred; if none is, the longest', () => {
  for (let i = 0; i < 20; i++) {
    assert.notEqual(pickTrack({ shelf: SHELF, mood: 'hopeful', lengthS: 120, seed: `s${i}` }).trackId, 'h3');
  }
  const long = { tracks: [track('a', 'calm', { lengthS: 100 }), track('b', 'calm', { lengthS: 150 })] };
  assert.equal(pickTrack({ shelf: long, mood: 'calm', lengthS: 400, seed: 'q' }).trackId, 'b');
});

test('an unusable shelf refuses rather than picking', () => {
  const broken = { tracks: [track('x', 'hopeful', { attribution: '' })] };
  const pick = pickTrack({ shelf: broken, mood: 'hopeful' });
  assert.equal(pick.ok, false);
  assert.match(pick.reason, /needs credit/);
  assert.equal(pickTrack({ shelf: {}, mood: 'calm' }).ok, false);
  assert.match(checkShelf({ tracks: [track('y', 'gloomy')] }).problems.join(), /not one of/);
});

test('the mood of a whole recording is its best-scoring moment\'s', () => {
  assert.equal(moodForMoments([
    { score: 40, mood: 'calm' },
    { score: 90, mood: 'urgent' },
    { score: 95, mood: '' },
  ]), 'urgent');
  assert.equal(moodForMoments([]), '');
});

test('a stored track id reads back as words, and an unknown one says so', () => {
  assert.equal(trackLabel(SHELF, 'h1'), 'h1, Test Artist');
  assert.equal(trackLabel(SHELF, ''), 'No music picked yet');
  assert.match(trackLabel(SHELF, 'gone'), /Unknown track "gone"/);
});

// The committed shelf itself.

test('the committed shelf is usable, credits every track, and covers every mood', () => {
  const shelf = loadShelf();
  const checked = checkShelf(shelf);
  assert.deepEqual(checked.problems, []);
  assert.ok(shelf.tracks.length >= 30, `only ${shelf.tracks.length} tracks`);
  for (const t of shelf.tracks) {
    assert.ok(t.driveFileId, `${t.id} has no Drive file`);
    assert.match(t.licenceUrl, /^https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/$/);
    assert.match(t.attribution, /Licensed under Creative Commons/);
  }
  for (const mood of MOODS) {
    assert.ok(shelf.tracks.some((t) => t.mood === mood), `no track for mood "${mood}"`);
  }
});
