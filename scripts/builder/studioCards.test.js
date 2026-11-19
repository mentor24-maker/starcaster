'use strict';

// Reel Spinner 5b (SC-838): title and end cards.
// The drawing itself (renderCard) needs a browser, which CI does not have; it
// is exercised by `npm run studio:cards`. Everything that decides what goes on
// a card, and whether it fits, is tested here.

const test = require('node:test');
const assert = require('node:assert/strict');

const cards = require('../../workers/studio/cards.js');

const {
  END_CARDS_TITLE, INNER_WIDTH, BOXES, textWidth, fitText, displayAddress, parseEndCards,
  endCardProjectFor, endCardFor, readEndCards, titleCard, endCard,
} = cards;

const NOTE = [
  'One line per project: its name, an invitation, and its address, split by bars.',
  'WaveCenter | Come and build it with us | https://www.wavecenter.com/',
  'Alphire | Work with us | alphire.agency',
  '- StarCaster | Build your site on StarCaster | starcaster.pro',
].join('\n');

function linesFit(fitted, box) {
  for (const line of fitted.lines) assert.ok(textWidth(line, fitted.fontPx) <= INNER_WIDTH, `"${line}" is wider than the card`);
  assert.ok(fitted.lines.length * fitted.fontPx * box.lineHeight <= box.maxHeight, 'more lines than the box holds');
}

test('the note: one card per project, prose ignored, address shown the way a viewer types it', () => {
  const { cards: parsed, problems } = parseEndCards(NOTE);
  assert.deepEqual(problems, []);
  assert.deepEqual([...parsed.keys()], ['WaveCenter', 'Alphire', 'StarCaster']);
  assert.deepEqual(parsed.get('WaveCenter'), {
    project: 'WaveCenter', name: 'WaveCenter', invitation: 'Come and build it with us', address: 'wavecenter.com',
  });
  assert.equal(displayAddress('http://starcaster.pro/join/'), 'starcaster.pro/join');
});

test('the note: a spoken name finds its project ("DEO movement" is DEO)', () => {
  const { cards: parsed } = parseEndCards('DEO movement | Join the movement | example.org');
  assert.equal(parsed.get('DEO').name, 'DEO movement');
});

test('the note: a bad line is a named problem, never a card', () => {
  const { cards: parsed, problems } = parseEndCards([
    'WaveCenter | no address |',
    'Nobody | Join | example.org',
    'Alphire | Work with us | not an address',
    'personal story | Hear more | example.org',
    'StarCaster | One | starcaster.pro',
    'StarCaster | Two | starcaster.pro',
  ].join('\n'));
  assert.deepEqual([...parsed.keys()], ['StarCaster']);
  assert.equal(parsed.get('StarCaster').invitation, 'One');
  assert.equal(problems.length, 5);
  assert.match(problems[0], /line 1 .*three parts/);
  assert.match(problems[1], /"Nobody", which is not one of WaveCenter, DEO, Alphire, StarCaster, Spirality$/);
  assert.match(problems[2], /not a web address/);
  assert.match(problems[3], /"personal story"/);
  assert.match(problems[4], /second line for StarCaster/);
});

test('which card: a short takes its own moment\'s project', () => {
  const moments = [{ project: 'Alphire', score: 90 }, { project: 'DEO', score: 40 }];
  const got = endCardProjectFor({ kind: 'short', momentIndex: 1 }, moments);
  assert.equal(got.ok, true);
  assert.equal(got.project, 'DEO');
});

test('which card: a full video takes its most-mentioned project, not its best-scoring one', () => {
  const moments = [
    { project: 'Alphire', score: 99 },
    { project: 'StarCaster', score: 30 },
    { project: 'StarCaster', score: 30 },
  ];
  const got = endCardProjectFor({ kind: 'full' }, moments);
  assert.equal(got.project, 'StarCaster');
  assert.match(got.why, /2 of its 3 moments/);
});

test('which card: a tie goes to the higher total score, then to the list order, never to input order', () => {
  const byScore = [{ project: 'Spirality', score: 20 }, { project: 'DEO', score: 80 }];
  assert.equal(endCardProjectFor({ kind: 'full' }, byScore).project, 'DEO');
  const even = [{ project: 'Spirality', score: 50 }, { project: 'Alphire', score: 50 }];
  assert.equal(endCardProjectFor({ kind: 'full' }, even).project, 'Alphire');
  assert.equal(endCardProjectFor({ kind: 'full' }, [...even].reverse()).project, 'Alphire');
});

test('which card: a personal story closes on the WaveCenter card', () => {
  const short = endCardProjectFor({ kind: 'short', momentIndex: 0 }, [{ project: 'personal story', score: 70 }]);
  assert.equal(short.project, 'WaveCenter');
  assert.match(short.why, /personal story closes on the WaveCenter card/);
  const full = endCardProjectFor({ kind: 'full' }, [
    { project: 'personal story', score: 10 }, { project: 'personal story', score: 10 }, { project: 'DEO', score: 90 },
  ]);
  assert.equal(full.project, 'WaveCenter');
});

test('which card: no moment, or no project, is a named stop', () => {
  assert.match(endCardProjectFor({ kind: 'short', momentIndex: 4 }, []).reason, /no such moment/);
  assert.match(endCardProjectFor({ kind: 'short', momentIndex: 0 }, [{ score: 3 }]).reason, /names no project/);
  assert.match(endCardProjectFor({ kind: 'full' }, []).reason, /none of this recording's moments names a project/);
  assert.match(endCardProjectFor({ kind: 'trailer' }, []).reason, /"full" or "short"/);
});

test('a project with no line in the note is a named refusal, never a blank card', () => {
  const { cards: parsed } = parseEndCards(NOTE);
  const got = endCardFor('DEO', parsed);
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'no end card for DEO in Reel Spinner — end cards');
  assert.equal(endCardFor('Alphire', parsed).card.address, 'alphire.agency');
});

function fakeStore(entries, ok = true) {
  return {
    contextStore: { listEntries: async () => (ok ? { ok: true, data: entries } : { ok: false, error: 'timed out' }) },
    contextReadout: { htmlToText: (html) => html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '') },
  };
}

function entry(extra = {}) {
  return { id: 'e1', projectId: 'p1', title: END_CARDS_TITLE, bodyHtml: NOTE.split('\n').join('<br>'), usedBy: ['reel-spinner'], ...extra };
}

test('reading the note: found, switched on, parsed', async () => {
  const got = await readEndCards({ projectId: 'p1', deps: fakeStore([entry()]) });
  assert.equal(got.ok, true);
  assert.equal(got.entryId, 'e1');
  assert.equal(got.cards.size, 3);
});

test('reading the note: missing, switched off, another project\'s, or unreadable each say which', async () => {
  assert.match((await readEndCards({ projectId: 'p1', deps: fakeStore([]) })).reason, /no Context note titled "Reel Spinner — end cards"/);
  assert.match((await readEndCards({ projectId: 'p1', deps: fakeStore([entry({ usedBy: [] })]) })).reason, /not switched on for Reel Spinner/);
  assert.match((await readEndCards({ projectId: 'p1', deps: fakeStore([entry({ projectId: 'p2' })]) })).reason, /no Context note titled/);
  assert.match((await readEndCards({ projectId: 'p1', deps: fakeStore([], false) })).reason, /could not read .*timed out/);
  assert.match((await readEndCards({ projectId: '' })).reason, /no project was named/);
});

test('fitting: a short title is set large on one line', () => {
  const fitted = fitText('Why WaveCenter', BOXES.title);
  assert.equal(fitted.fontPx, BOXES.title.sizes[0]);
  assert.deepEqual(fitted.lines, ['Why WaveCenter']);
});

test('fitting: a long title wraps, shrinks, and never runs off the card', () => {
  const long = 'What I learned in forty years of building things nobody asked for, and why the next ten will be different from all of them put together';
  const fitted = fitText(long, BOXES.title);
  assert.equal(fitted.truncated, false);
  assert.ok(fitted.lines.length > 1);
  assert.ok(fitted.fontPx < BOXES.title.sizes[0]);
  assert.equal(fitted.lines.join(' '), long);
  linesFit(fitted, BOXES.title);
});

test('fitting: a title too long for any size is cut with "…" and the card says so', () => {
  const huge = 'word '.repeat(200).trim();
  const fitted = fitText(huge, BOXES.title);
  assert.equal(fitted.truncated, true);
  assert.match(fitted.lines[fitted.lines.length - 1], /…$/);
  linesFit(fitted, BOXES.title);
  const card = titleCard(huge);
  assert.match(card.notes[0], /too long for the card and was cut/);
});

test('fitting: one unbroken word wider than the card is broken, not left to spill', () => {
  const fitted = fitText('W'.repeat(80), BOXES.title);
  linesFit(fitted, BOXES.title);
  assert.equal(fitted.lines.join(''), 'W'.repeat(80));
});

test('the cards: escaped text, sized boxes, and no title is a refusal', () => {
  const t = titleCard('<b>&</b>');
  assert.equal(t.ok, true);
  assert.match(t.html, />&lt;b&gt;&amp;&lt;\/b&gt;</);
  assert.match(t.html, /data-fit="title" style="font-size:\d+px/);
  assert.doesNotMatch(t.html, /\{\{(kind|blocks)\}\}/);
  assert.equal(titleCard('  ').ok, false);

  const { cards: parsed } = parseEndCards(NOTE);
  const e = endCard(parsed.get('WaveCenter'));
  assert.equal(e.ok, true);
  for (const part of ['name', 'invitation', 'address']) assert.match(e.html, new RegExp(`data-fit="${part}"`));
  assert.match(e.html, />wavecenter\.com</);
  assert.deepEqual(e.notes, []);
  assert.equal(endCard({ project: 'DEO', name: 'DEO' }).ok, false);
});

test('the end card\'s three boxes together fit inside the card', () => {
  const total = BOXES.name.maxHeight + BOXES.invitation.maxHeight + BOXES.address.maxHeight + 8 + 3 * 48;
  assert.ok(total <= 1080 - 2 * 140, `${total}px of boxes on an 800px card`);
});
