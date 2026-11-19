#!/usr/bin/env node
'use strict';

/**
 * npm run studio:music-shelf [-- --apply]
 *
 * Reel Spinner 5a (SC-837). Builds the music shelf once: thirty tracks by
 * Kevin MacLeod (incompetech.com, Creative Commons Attribution 4.0), five per
 * mood the scoring uses, copied into a `Music` folder inside the Studio folder
 * on Drive, and the manifest `workers/studio/music-shelf.json` that the picker
 * (workers/studio/music.js) reads. Why this library: docs/STUDIO.md, "Music".
 *
 * THE TRACKS ARE CHOSEN HERE, BY NAME (`SHELF` below), not by a rule over the
 * catalogue: a rule picked novelty pieces (a Christmas rap, a medieval feast)
 * that would be wrong under a talking head. Each title is looked up in
 * incompetech's own catalogue, which supplies its length, tempo, ISRC (the
 * per-track page) and file name, so nothing about a track is typed by hand.
 *
 * DRY RUN BY DEFAULT: without `--apply` it reads the catalogue, checks every
 * track's download and licence link answers, and prints the manifest it would
 * write; it touches neither Drive nor the repository. With `--apply` it
 * creates `Music` if absent, uploads each track that is not already there (a
 * file of the same name is reused, so a second run uploads nothing), and
 * writes the manifest with each file's Drive id.
 *
 * It runs under the Studio worker's Drive sign-in:
 *   cd ~/Studio && doppler run --scope ~/Studio --project starcaster --config prd -- \
 *     node <repo>/scripts/studio_build_music_shelf.cjs --apply
 * Uploads count against that account's storage (mentor24); thirty tracks are
 * about 200 MB.
 *
 * Exit 0 done (or dry run clean), 1 a track, link, upload or write failed,
 * 2 not configured (no Drive sign-in).
 */

const fs = require('node:fs');
const path = require('node:path');

const googleDrive = require('../lib/googleDrive.js');
const { checkShelf } = require('../workers/studio/music.js');

/** The Studio folder on mentorofaio's Drive (docs/STUDIO.md). */
const STUDIO_FOLDER_ID = '17HZZDNlGAcxWUxbMBdlywnn-Tjf4pfD7';
const MUSIC_FOLDER = 'Music';
const CATALOGUE_URL = 'https://incompetech.com/music/royalty-free/pieces.json';
const MP3_BASE = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';
const TRACK_PAGE = 'https://incompetech.com/music/royalty-free/index.html?isrc=';
const LICENCE = 'CC BY 4.0';
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const ARTIST = 'Kevin MacLeod';
const MANIFEST = path.join(__dirname, '..', 'workers', 'studio', 'music-shelf.json');

/** Five per mood. The moods are workers/studio/moments.js MOODS. */
const SHELF = {
  hopeful: ['Inspired', 'Life of Riley', 'Carefree', 'Carpe Diem', 'Nowhere Land'],
  urgent: ['Exit the Premises', 'Undaunted', 'Unity', 'Furious Freak', 'Big Drumming'],
  reflective: ['Immersed', 'Danse Morialta', 'Calmant', 'Floating Cities', 'The Parting'],
  determined: ['Nonstop', 'Motivator', 'Super Power Cool Dude', 'Gonna Start v2', 'Shiny Tech'],
  playful: ['Android Sock Hop', 'Mighty Like Us', 'Salty Ditty', 'Goblin Tinker Soldier Spy', 'March of the Spoons'],
  calm: ['Morning', 'Evening', 'Late Night Radio', 'Study And Relax', 'Pleasant Porridge'],
};

function slug(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function seconds(hms) {
  const parts = String(hms || '').split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** Kevin MacLeod's own required credit, on the lines a YouTube description takes. */
function attributionFor(title) {
  return `"${title}" ${ARTIST} (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\n${LICENCE_URL}`;
}

async function answers(url, method = 'HEAD') {
  try {
    const res = await fetch(url, { method, redirect: 'follow' });
    return res.ok ? '' : `HTTP ${res.status}`;
  } catch (err) {
    return err.message;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const failures = [];

  const res = await fetch(CATALOGUE_URL).catch((err) => ({ ok: false, statusText: err.message }));
  if (!res.ok) {
    console.error(`Could not read incompetech's catalogue (${CATALOGUE_URL}): ${res.status || ''} ${res.statusText || ''}`);
    return 1;
  }
  const catalogue = await res.json();
  const byTitle = new Map(catalogue.map((p) => [p.title, p]));

  const tracks = [];
  for (const [mood, titles] of Object.entries(SHELF)) {
    for (const title of titles) {
      const piece = byTitle.get(title);
      if (!piece) { failures.push(`"${title}" is not in incompetech's catalogue`); continue; }
      if (!piece.isrc) { failures.push(`"${title}" has no ISRC, so it has no track page to link`); continue; }
      tracks.push({
        id: slug(title),
        title,
        artist: ARTIST,
        mood,
        lengthS: seconds(piece.length),
        bpm: Number(piece.bpm) || null,
        licence: LICENCE,
        licenceUrl: LICENCE_URL,
        sourceUrl: TRACK_PAGE + encodeURIComponent(piece.isrc),
        attributionRequired: true,
        attribution: attributionFor(title),
        fileName: piece.filename,
        driveFileId: '',
      });
    }
  }

  for (const t of tracks) {
    const mp3 = MP3_BASE + encodeURIComponent(t.fileName);
    for (const [what, url] of [['download', mp3], ['track page', t.sourceUrl]]) {
      const problem = await answers(url);
      if (problem) failures.push(`${t.title}: ${what} ${url} did not open (${problem})`);
    }
  }
  const licenceProblem = await answers(LICENCE_URL, 'GET');
  if (licenceProblem) failures.push(`the licence page ${LICENCE_URL} did not open (${licenceProblem})`);

  if (failures.length) {
    for (const f of failures) console.error(`FAILED: ${f}`);
    return 1;
  }

  if (!apply) {
    for (const t of tracks) console.log(`would add  ${t.mood.padEnd(10)} ${t.title} (${t.lengthS}s, ${t.bpm || '?'} bpm)`);
    console.log(`DRY RUN: ${tracks.length} tracks, every download and licence link opens. Nothing uploaded, nothing written. Add --apply to build the shelf.`);
    return 0;
  }

  if (!googleDrive.isConfigured()) {
    console.error('Google Drive is not signed in here (GOOGLE_DRIVE_* settings). Run this under the Studio worker\'s doppler scope; see the header.');
    return 2;
  }
  const tokenRes = await googleDrive.getAccessToken();
  if (!tokenRes.ok) { console.error(`Drive sign-in failed: ${tokenRes.error}`); return 1; }
  const token = tokenRes.data.accessToken;

  let folder = await googleDrive.findFolderByName(token, STUDIO_FOLDER_ID, MUSIC_FOLDER);
  if (!folder.ok) { console.error(`Could not look for the Music folder: ${folder.error}`); return 1; }
  let folderId = folder.data && folder.data.id;
  if (!folderId) {
    const created = await googleDrive.createFolder(token, STUDIO_FOLDER_ID, MUSIC_FOLDER);
    if (!created.ok) { console.error(`Could not create the Music folder: ${created.error}`); return 1; }
    folderId = created.data.id;
    console.log(`created    Music folder (${folderId})`);
  }

  for (const t of tracks) {
    const existing = await googleDrive.findFileByName(token, folderId, t.fileName);
    if (!existing.ok) { failures.push(`${t.title}: could not look for it on Drive (${existing.error})`); continue; }
    if (existing.data && existing.data.id) {
      t.driveFileId = existing.data.id;
      console.log(`already    ${t.title} (${t.driveFileId})`);
      continue;
    }
    const audio = await fetch(MP3_BASE + encodeURIComponent(t.fileName)).catch((err) => ({ ok: false, statusText: err.message }));
    if (!audio.ok) { failures.push(`${t.title}: download failed (${audio.status || ''} ${audio.statusText || ''})`); continue; }
    const fileBuffer = Buffer.from(await audio.arrayBuffer());
    const up = await googleDrive.uploadFile({ token, folderId, fileName: t.fileName, mimeType: 'audio/mpeg', fileBuffer });
    if (!up.ok || !up.data || !up.data.id) { failures.push(`${t.title}: upload failed (${up.error || 'no file id returned'})`); continue; }
    t.driveFileId = up.data.id;
    console.log(`uploaded   ${t.title} (${Math.round(fileBuffer.length / 1e5) / 10} MB, ${t.driveFileId})`);
  }

  // Read the folder back: the manifest is only written for files Drive lists.
  const listed = await googleDrive.listFilesInFolder(token, folderId, { limit: 1000 });
  if (!listed.ok) { console.error(`Could not read the Music folder back: ${listed.error}`); return 1; }
  const onDrive = new Set(listed.data.map((f) => f.id));
  for (const t of tracks) {
    if (t.driveFileId && !onDrive.has(t.driveFileId)) failures.push(`${t.title}: uploaded as ${t.driveFileId}, but the Music folder does not list it`);
  }
  if (failures.length) {
    for (const f of failures) console.error(`FAILED: ${f}`);
    console.error('The manifest was NOT written. Run again: tracks already on Drive are reused.');
    return 1;
  }

  const shelf = {
    about: 'Reel Spinner music shelf (SC-837). Built by scripts/studio_build_music_shelf.cjs; read by workers/studio/music.js. The audio lives on Drive in Studio › Music, never in git.',
    driveFolderId: folderId,
    tracks,
  };
  const checked = checkShelf(shelf);
  if (!checked.ok) {
    for (const p of checked.problems) console.error(`FAILED: ${p}`);
    return 1;
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(shelf, null, 2)}\n`);
  console.log(`DONE: ${tracks.length} tracks in Music (${folderId}); manifest written to ${path.relative(process.cwd(), MANIFEST)}.`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.stack || err.message); process.exitCode = 1; });
