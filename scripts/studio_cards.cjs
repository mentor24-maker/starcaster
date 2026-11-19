#!/usr/bin/env node
'use strict';

/**
 * `npm run studio:cards` — draw Reel Spinner's title and end cards as
 * pictures, and seed the end-cards note (Reel Spinner 5b, SC-838).
 * docs/STUDIO.md "Title and end cards" says when.
 *
 *   npm run studio:cards -- draw --project <id> --title "<title>" --out <folder>
 *       a title card, and one end card per line of the project's
 *       "Reel Spinner — end cards" note, as 1920 × 1080 PNGs in <folder>
 *   npm run studio:cards -- draw --notes-file <file> --title "<title>" --out <folder>
 *       the same from a text file of lines, with no database
 *   npm run studio:cards -- seed --project <id> --notes-file <file> [--apply]
 *       create the end-cards note in the project, switched on for Reel
 *       Spinner. A dry run unless --apply; refuses if the note exists.
 *
 * The database is the one the environment names (the Mini's Studio scope is
 * Doppler `starcaster` / `prd`). <folder> should be outside the repository.
 *
 * Exit: 0 done, 1 refused (a bad line, a card that would not fit, the note
 * already there), 2 could not tell (the database or the browser failed).
 */

const fs = require('node:fs');
const path = require('node:path');

const cards = require('../workers/studio/cards.js');

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? '' : String(argv[i + 1] || '');
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function noteHtml(lines) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return lines.map((l) => `<p>${escape(l)}</p>`).join('');
}

async function loadCards() {
  const notesFile = flag('--notes-file');
  if (notesFile) {
    const parsed = cards.parseEndCards(fs.readFileSync(notesFile, 'utf8'));
    return { ...parsed, from: notesFile };
  }
  const projectId = flag('--project');
  if (!projectId) fail(1, 'Name the notes: --project <id> or --notes-file <file>.');
  const read = await cards.readEndCards({ projectId });
  if (!read.ok) fail(/could not read/.test(read.reason) ? 2 : 1, `No end cards: ${read.reason}.`);
  return { cards: read.cards, problems: read.problems, from: `the "${cards.END_CARDS_TITLE}" note` };
}

async function draw() {
  const title = flag('--title');
  const out = flag('--out');
  if (!title || !out) fail(1, 'draw needs --title "<title>" and --out <folder>.');
  const { cards: parsed, problems, from } = await loadCards();
  for (const p of problems) console.log(`skipped: ${p}`);
  const jobs = [['title-card', cards.titleCard(title)]];
  for (const [project, card] of parsed) jobs.push([`end-card-${slug(project)}`, cards.endCard(card)]);
  let refused = problems.length > 0;
  let browser;
  try {
    browser = await cards.openBrowser();
  } catch (err) {
    fail(2, `Could not start the browser that draws the cards: ${err.message}`);
  }
  try {
    for (const [name, laid] of jobs) {
      if (!laid.ok) { console.log(`refused ${name}: ${laid.reason}`); refused = true; continue; }
      for (const note of laid.notes) console.log(`note ${name}: ${note}`);
      // eslint-disable-next-line no-await-in-loop
      const got = await cards.renderCard({ html: laid.html, outFile: path.join(out, `${name}.png`), browser });
      if (got.ok) console.log(`saved ${got.file}`);
      else { console.log(`refused ${name}: ${got.reason}`); refused = true; }
    }
  } finally {
    await browser.close();
  }
  console.log(`${parsed.size} end card(s) from ${from}.`);
  process.exit(refused ? 1 : 0);
}

async function seed() {
  const projectId = flag('--project');
  const notesFile = flag('--notes-file');
  if (!projectId || !notesFile) fail(1, 'seed needs --project <id> and --notes-file <file>.');
  const lines = fs.readFileSync(notesFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { cards: parsed, problems } = cards.parseEndCards(lines.join('\n'));
  if (problems.length) fail(1, `Not seeded, the notes have problems:\n  ${problems.join('\n  ')}`);
  const contextStore = require('../lib/contextStore.js');
  const listed = await contextStore.listEntries(2000, { projectId });
  if (!listed.ok) fail(2, `Could not read the project's Context notes: ${listed.error}`);
  const same = listed.data.filter((e) => e.projectId === projectId
    && String(e.title).trim().toLowerCase() === cards.END_CARDS_TITLE.toLowerCase());
  if (same.length) fail(1, `Not seeded: the project already has "${cards.END_CARDS_TITLE}" (${same[0].id}). Edit it on Assets › Context.`);
  // The owner of the note it sits beside, so the new one is owned the same way.
  const brief = listed.data.find((e) => e.projectId === projectId && e.usedBy.includes('reel-spinner'));
  const ownerUserId = brief ? brief.ownerUserId : null;
  console.log(`Would create "${cards.END_CARDS_TITLE}" for ${[...parsed.keys()].join(', ')}, owned by ${ownerUserId || 'nobody'}, switched on for Reel Spinner.`);
  if (!argv.includes('--apply')) { console.log('Dry run: nothing written. Add --apply to create it.'); return; }
  const made = await contextStore.createEntry(
    { title: cards.END_CARDS_TITLE, kind: 'note', bodyHtml: noteHtml(lines), usedBy: ['reel-spinner'] },
    { projectId, userId: ownerUserId },
  );
  if (!made.ok) fail(2, `Not created: ${made.error}`);
  const back = await cards.readEndCards({ projectId });
  if (!back.ok || back.entryId !== made.data.id || back.cards.size !== parsed.size) {
    fail(2, `Created ${made.data.id}, but reading it back did not give the same cards: ${back.reason || `${back.cards && back.cards.size} card(s)`}`);
  }
  console.log(`Created ${made.data.id} and read it back: ${[...back.cards.keys()].join(', ')}.`);
}

const run = { draw, seed }[command];
if (!run) fail(1, 'Usage: npm run studio:cards -- draw|seed ... (see the top of scripts/studio_cards.cjs)');
run().catch((err) => fail(2, `Stopped: ${err && err.stack ? err.stack : err}`));
