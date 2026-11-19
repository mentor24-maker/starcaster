'use strict';

/**
 * TITLE AND END CARDS — the still pictures a finished video opens and closes
 * on (Reel Spinner 5b, SC-838).
 *
 * Every video opens on a TITLE CARD (the video's title) and closes on an END
 * CARD inviting the viewer to the project the video speaks to: WaveCenter, the
 * DEO movement, Alphire, StarCaster or Spirality. That is the channel's
 * purpose in Dane's own words: "to attract collaborators to my various
 * projects, especially WaveCenter and the DEO movement".
 *
 * WHERE THE WORDS COME FROM. A Context note in the project, titled exactly
 * `Reel Spinner — end cards` (END_CARDS_TITLE) and switched on for Reel
 * Spinner on Assets › Context. One line per project:
 *
 *     WaveCenter | Come and build it with us | wavecenter.com
 *
 * Nothing on a card is typed into this file. A missing note, a project with
 * no line, or a line that does not read stops with the reason ("no end card
 * for DEO in Reel Spinner — end cards"), never a blank or a guessed card.
 *
 * WHICH END CARD (`endCardProjectFor`):
 *   - a short: the project of the moment it was cut from;
 *   - a full video: the project its moments name most often (a tie goes to
 *     the project whose moments scored higher in total, then to the order of
 *     moments.js PROJECTS, so the answer never depends on list order);
 *   - "personal story" gets the WaveCenter card (Dane: "especially
 *     WaveCenter").
 *
 * NOTHING RUNS OFF A CARD. `fitText` wraps every piece of text itself, at the
 * largest size that fits its box, from a deliberately generous estimate of
 * how wide each letter is; text that cannot fit even at the smallest size is
 * cut with "…" and the card says so in `notes`. The browser then draws each
 * line as one unbreakable span and `renderCard` MEASURES every box, refusing
 * the picture if anything spilled. The estimate is the first lock, the
 * measurement the second.
 *
 * Drawn by the same Chromium the UI harness uses (playwright), from
 * `card-template.html` beside this file: 1920 × 1080 PNG. ffmpeg's text
 * drawing was the other option and the Mini's ffmpeg is built without it.
 *
 * Not here: putting the cards into a video (5c).
 */

const fs = require('node:fs');
const path = require('node:path');

const { PROJECTS, projectNamed } = require('./moments.js');

const END_CARDS_TITLE = 'Reel Spinner — end cards';
const USE = 'reel-spinner';
const PERSONAL = 'personal story';
const PERSONAL_CARD = 'WaveCenter';

const WIDTH = 1920;
const HEIGHT = 1080;
const TEMPLATE_FILE = path.join(__dirname, 'card-template.html');

/** The text area inside the card's padding (card-template.html). */
const INNER_WIDTH = WIDTH - 2 * 160;
const INNER_HEIGHT = HEIGHT - 2 * 140;
const GAP = 48;
const RULE = 8;

/**
 * Each box on a card: the sizes tried, largest first, its line height, and
 * how much of the card it may take. The end card's heights plus its rule and
 * gaps add up to under INNER_HEIGHT, so the three boxes never push each other
 * off the card.
 */
const BOXES = Object.freeze({
  title: { sizes: [128, 112, 100, 88, 76, 64], lineHeight: 1.15, maxHeight: INNER_HEIGHT - RULE - GAP },
  name: { sizes: [140, 120, 104, 88, 72], lineHeight: 1.1, maxHeight: 180 },
  invitation: { sizes: [72, 64, 56, 48], lineHeight: 1.25, maxHeight: 280 },
  address: { sizes: [72, 64, 56, 48, 40], lineHeight: 1.2, maxHeight: 140 },
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ── Measuring and wrapping ─────────────────────────────────────────────────

/**
 * How wide one character is, as a share of the font size, in a bold
 * Helvetica — rounded UP throughout, so the estimate errs towards wrapping
 * early and leaving room, never towards spilling.
 */
function charEm(ch) {
  if (ch === ' ') return 0.3;
  if ('iljI.,:;!|\'`'.includes(ch)) return 0.34;
  if ('ftr()[]{}-/'.includes(ch)) return 0.42;
  if ('MW'.includes(ch)) return 1.0;
  if ('mw@%'.includes(ch)) return 0.96;
  if (/[A-Z]/.test(ch)) return 0.8;
  if (/[0-9]/.test(ch)) return 0.62;
  if (/[a-z]/.test(ch)) return 0.64;
  return 1.0; // anything else (accents, symbols, emoji): assume wide
}

function textWidth(value, fontPx) {
  let em = 0;
  for (const ch of String(value)) em += charEm(ch);
  return em * fontPx;
}

/** Split one word too long for a line into pieces that each fit. */
function splitLongWord(word, fontPx, maxWidth) {
  const pieces = [];
  let piece = '';
  for (const ch of word) {
    if (piece && textWidth(piece + ch, fontPx) > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy wrap: as many words on each line as fit. */
function wrapWords(value, fontPx, maxWidth) {
  const words = String(value).split(/\s+/).filter(Boolean)
    .flatMap((w) => (textWidth(w, fontPx) > maxWidth ? splitLongWord(w, fontPx, maxWidth) : [w]));
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, fontPx) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Shorten a line from the end until it and an "…" fit. */
function ellipsize(line, fontPx, maxWidth) {
  let cut = line;
  while (cut && textWidth(`${cut}…`, fontPx) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.replace(/\s+$/, '')}…`;
}

/**
 * Fit `value` into a box: the largest size whose wrapped lines fit both the
 * width and the height. `{ fontPx, lines, truncated }`. When nothing fits,
 * the smallest size is used, as many lines as the box holds are kept, and
 * the last is cut with "…" (`truncated: true`).
 */
function fitText(value, box, maxWidth = INNER_WIDTH) {
  const words = text(value).replace(/\s+/g, ' ');
  for (const fontPx of box.sizes) {
    const maxLines = Math.floor(box.maxHeight / (fontPx * box.lineHeight));
    const lines = wrapWords(words, fontPx, maxWidth);
    if (maxLines >= 1 && lines.length <= maxLines) return { fontPx, lines, truncated: false };
  }
  const fontPx = box.sizes[box.sizes.length - 1];
  const maxLines = Math.max(1, Math.floor(box.maxHeight / (fontPx * box.lineHeight)));
  const lines = wrapWords(words, fontPx, maxWidth).slice(0, maxLines);
  lines[lines.length - 1] = ellipsize(lines[lines.length - 1], fontPx, maxWidth);
  return { fontPx, lines, truncated: true };
}

// ── The end-cards note ─────────────────────────────────────────────────────

/** "https://www.wavecenter.com/" → "wavecenter.com", the way a viewer types it. */
function displayAddress(address) {
  return text(address).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

/**
 * Read the note's words into one card per project. `{ cards, problems }`:
 * `cards` maps a PROJECTS name to `{ project, name, invitation, address }`;
 * each problem names the line and what is wrong with it. Lines with no `|`
 * are prose and ignored, so the note can carry a sentence saying what it is.
 */
function parseEndCards(noteText) {
  const cards = new Map();
  const problems = [];
  String(noteText || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/^[-*•]\s+/, '');
    if (!line.includes('|')) return;
    const where = `line ${i + 1} ("${line.slice(0, 60)}")`;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length !== 3 || parts.some((p) => !p)) {
      problems.push(`${where} needs three parts, Name | invitation | address`);
      return;
    }
    const [name, invitation, address] = parts;
    const project = projectNamed(name);
    if (!project || project === PERSONAL) {
      const names = PROJECTS.filter((p) => p !== PERSONAL).join(', ');
      problems.push(`${where} names "${name}", which is not one of ${names}`);
      return;
    }
    if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(address)) {
      problems.push(`${where} has "${address}" as its address, which is not a web address`);
      return;
    }
    if (cards.has(project)) {
      problems.push(`${where} is a second line for ${project}; each project has one`);
      return;
    }
    cards.set(project, { project, name, invitation, address: displayAddress(address) });
  });
  return { cards, problems };
}

/**
 * The project whose end card closes an edit.
 * `{ ok: true, project, why }` or `{ ok: false, reason }`.
 *
 * @param {{ kind: string, momentIndex?: number|null }} edit
 * @param {Array<{ project?: string, score?: number }>} moments  the source's scored moments
 */
function endCardProjectFor(edit, moments) {
  const list = Array.isArray(moments) ? moments : [];
  const kind = text(edit && edit.kind);
  let project = '';
  let why = '';
  if (kind === 'short') {
    const index = edit.momentIndex;
    const moment = Number.isInteger(index) ? list[index] : null;
    if (!moment) return { ok: false, reason: `this short is cut from moment ${index}, and the recording has no such moment` };
    project = projectNamed(moment.project);
    if (!project) return { ok: false, reason: `moment ${index} names no project, so there is no end card to choose` };
    why = `the moment it is cut from is about ${project}`;
  } else if (kind === 'full') {
    const tally = new Map();
    for (const m of list) {
      const p = projectNamed(m && m.project);
      if (!p) continue;
      const t = tally.get(p) || { count: 0, score: 0 };
      t.count += 1;
      t.score += Number(m.score) || 0;
      tally.set(p, t);
    }
    if (!tally.size) return { ok: false, reason: 'none of this recording\'s moments names a project, so there is no end card to choose' };
    const ranked = [...tally.entries()].sort((a, b) => (b[1].count - a[1].count)
      || (b[1].score - a[1].score)
      || (PROJECTS.indexOf(a[0]) - PROJECTS.indexOf(b[0])));
    const [top, t] = ranked[0];
    project = top;
    why = `${top} is named by ${t.count} of its ${list.length} moment${list.length === 1 ? '' : 's'}, more than any other`;
  } else {
    return { ok: false, reason: `an edit is "full" or "short", not ${JSON.stringify(kind)}` };
  }
  if (project === PERSONAL) {
    return { ok: true, project: PERSONAL_CARD, why: `${why}; a personal story closes on the ${PERSONAL_CARD} card` };
  }
  return { ok: true, project, why };
}

/** The end card for a project, or the named refusal. */
function endCardFor(project, cards) {
  const card = cards && cards.get(project);
  if (!card) return { ok: false, reason: `no end card for ${project} in ${END_CARDS_TITLE}` };
  return { ok: true, card };
}

/**
 * Read the end-cards note of one project, through lib/contextStore.js.
 * `{ ok: true, cards, problems, entryId }` or `{ ok: false, reason }`.
 * Could not read and no note are both a stop; they say which.
 */
async function readEndCards({ projectId, deps = {} } = {}) {
  const pid = text(projectId);
  if (!pid) return { ok: false, reason: 'no project was named, so there is no end-cards note to read' };
  const contextStore = deps.contextStore || require('../../lib/contextStore.js');
  const { htmlToText } = deps.contextReadout || require('../../lib/contextReadout.js');
  const listed = await contextStore.listEntries(2000, { projectId: pid });
  if (!listed || !listed.ok) {
    return { ok: false, reason: `could not read this project's Context notes: ${(listed && listed.error) || 'the database did not say why'}` };
  }
  const wanted = END_CARDS_TITLE.toLowerCase();
  const named = (listed.data || []).filter((e) => e.projectId === pid && text(e.title).toLowerCase() === wanted);
  if (!named.length) return { ok: false, reason: `this project has no Context note titled "${END_CARDS_TITLE}", so no end card can be made` };
  const on = named.filter((e) => Array.isArray(e.usedBy) && e.usedBy.includes(USE));
  if (!on.length) return { ok: false, reason: `the "${END_CARDS_TITLE}" note is not switched on for Reel Spinner on Assets › Context` };
  if (on.length > 1) return { ok: false, reason: `there are ${on.length} notes titled "${END_CARDS_TITLE}" switched on for Reel Spinner; keep one` };
  const { cards, problems } = parseEndCards(htmlToText(on[0].bodyHtml));
  return { ok: true, cards, problems, entryId: on[0].id };
}

// ── Drawing ────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function blockHtml(cls, fitted, box) {
  const lines = fitted.lines.map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('');
  return `    <div class="block ${cls}" data-fit="${cls}" style="font-size:${fitted.fontPx}px;max-width:${INNER_WIDTH}px;max-height:${box.maxHeight}px">${lines}</div>`;
}

function fillTemplate(kind, blocks) {
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  return template.replace('{{kind}}', kind).replace('{{blocks}}', blocks.join('\n'));
}

/**
 * A title card, laid out. `{ ok, html, notes }`; `ok` false only for a
 * missing title. A title too long to fit whole is cut with "…" and `notes`
 * says so.
 */
function titleCard(title) {
  const words = text(title);
  if (!words) return { ok: false, reason: 'the video has no title, so there is no title card' };
  const fitted = fitText(words, BOXES.title);
  const notes = fitted.truncated ? [`the title is too long for the card and was cut to "${fitted.lines.join(' ')}"`] : [];
  const html = fillTemplate('title-card', ['    <div class="rule"></div>', blockHtml('title', fitted, BOXES.title)]);
  return { ok: true, html, notes, layout: { title: fitted } };
}

/** An end card, laid out from one parsed line of the note. */
function endCard(card) {
  if (!card || !text(card.name) || !text(card.invitation) || !text(card.address)) {
    return { ok: false, reason: 'an end card needs a name, an invitation and an address' };
  }
  const layout = {
    name: fitText(card.name, BOXES.name),
    invitation: fitText(card.invitation, BOXES.invitation),
    address: fitText(card.address, BOXES.address),
  };
  const notes = Object.entries(layout).filter(([, f]) => f.truncated)
    .map(([part]) => `the ${part} on the ${card.project} card is too long and was cut with "…"`);
  const html = fillTemplate('end-card', [
    blockHtml('name', layout.name, BOXES.name),
    '    <div class="rule"></div>',
    blockHtml('invitation', layout.invitation, BOXES.invitation),
    blockHtml('address', layout.address, BOXES.address),
  ]);
  return { ok: true, html, notes, layout };
}

/**
 * Draw a laid-out card to a 1920 × 1080 PNG. `browser` is a playwright
 * Browser (`openBrowser`). Refuses, writing nothing, if any box spilled.
 * `{ ok: true, file }` or `{ ok: false, reason }`.
 */
async function renderCard({ html, outFile, browser }) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const spilled = await page.evaluate(([w, h]) => {
      const out = [];
      for (const el of document.querySelectorAll('[data-fit]')) {
        const box = el.getBoundingClientRect();
        const fontPx = parseFloat(getComputedStyle(el).fontSize) || 0;
        // Each line's INK, measured over its text, against the box's width.
        const wide = [...el.querySelectorAll('.line')].some((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          const r = range.getBoundingClientRect();
          return r.left < box.left - 1 || r.right > box.right + 1;
        });
        // A box cut short by its max-height hides whole lines. A few pixels of
        // descender below the last line box is how type is drawn, not a spill.
        const clipped = el.scrollHeight - el.clientHeight > fontPx * 0.25;
        const off = box.left < 0 || box.top < 0 || box.right > w || box.bottom > h;
        if (wide || clipped || off) out.push(el.getAttribute('data-fit'));
      }
      return out;
    }, [WIDTH, HEIGHT]);
    if (spilled.length) return { ok: false, reason: `the ${spilled.join(', ')} ran off the card, so it was not saved` };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    return { ok: true, file: outFile };
  } finally {
    await page.close();
  }
}

async function openBrowser() {
  const { chromium } = require('playwright');
  return chromium.launch({ headless: true });
}

module.exports = {
  END_CARDS_TITLE,
  WIDTH,
  HEIGHT,
  INNER_WIDTH,
  BOXES,
  textWidth,
  fitText,
  displayAddress,
  parseEndCards,
  endCardProjectFor,
  endCardFor,
  readEndCards,
  titleCard,
  endCard,
  renderCard,
  openBrowser,
};
