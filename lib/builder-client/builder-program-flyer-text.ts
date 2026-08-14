/**
 * Read a club flyer's text into a Program.
 *
 * The operator's objection to the settings panel, 2026-08-13: *"the idea is we
 * just paste whatever the content was that was going into the flyer into that
 * one field and it will sort it all out?"* — which was a better idea than the
 * eleven-field form it was aimed at. Adding next season's clinic should be
 * paste-and-check, not fill-in-every-box.
 *
 * **No model is involved, on purpose.** These flyers are one template with
 * slots, so rules read them instantly, for nothing, offline, and — the part
 * that matters — cannot invent a price. A vision or language model reading
 * "$27.50" as "$2750" is a mistake nobody catches until a member argues at the
 * desk. Rules either match or visibly do not.
 *
 * Scoped deliberately to the one flyer style Delray uses for its ~15 clinic
 * and mixer sheets. The operator confirmed the other 15-20 are *significantly*
 * different, and generalizing this to cover them is a parked decision
 * (ClickUp `86bbdby3a`), not an accident of scope.
 */

import type { Program, ProgramSession, ProgramPrice } from "./builder-program-list";

const DAY_NAMES: Array<[RegExp, string]> = [
  [/^mon(day)?\b/i, "Monday"],
  [/^tue(s|sday)?\b/i, "Tuesday"],
  [/^wed(nes(day)?)?\b/i, "Wednesday"],
  [/^thu(r|rs|rsday)?\b/i, "Thursday"],
  [/^fri(day)?\b/i, "Friday"],
  [/^sat(ur(day)?)?\b/i, "Saturday"],
  [/^sun(day)?\b/i, "Sunday"]
];

/** `6:00PM - 7:00PM`, `10:00AM – 12:00PM`, `5:30 pm to 6:30 pm`. */
const TIME_RANGE =
  /(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s*(?:-|–|—|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i;

const SINGLE_TIME = /(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i;

const PRICE = /\$\s*(\d+(?:\.\d{1,2})?)/;

/** "W/ Glenn Muller", "with Zach Schneider". */
const INSTRUCTOR = /^(?:w\/|with)\s+(.{2,})$/i;

/** "3.0 - 3.5 Players", "New Players", "2.5-3.5". */
const LEVEL_WORD = /\bplayers?\b/i;
const LEVEL_RATING = /^\d(?:\.\d)?\s*(?:-|–|—|to)\s*\d(?:\.\d)?$/;

/**
 * Everything below one of these is the flyer's printed furniture, not the
 * program: the cancellation shield, the pro-shop call bar, and the whole
 * dark footer with both addresses and the social handles. Pasting a whole
 * flyer is the normal case, so this has to be handled rather than assumed
 * away.
 */
const FOOTER_STARTS = [
  /cancellation\s+policy/i,
  /\bpro\s*shop\b/i,
  /reserve\s+your\s+spot/i,
  /call\s+or\s+stop\s+by/i
];

/** Lines that are only contact furniture, wherever they appear. */
const CHROME_LINE = [
  /^\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}$/, // a bare phone number
  /^@[\w.]+$/, // a social handle
  /^(?:https?:\/\/)?[\w.-]+\.(?:com|org|net|pro)\b/i, // a bare domain
  /^\d+\s+[\w\s.]+\b(?:ave|avenue|st|street|dr|drive|rd|road|blvd|way|ln|lane)\b\.?$/i
];

function isFooterStart(line: string): boolean {
  return FOOTER_STARTS.some((pattern) => pattern.test(line));
}

function isChrome(line: string): boolean {
  return CHROME_LINE.some((pattern) => pattern.test(line));
}

/**
 * A day, but only when the line really *is* one.
 *
 * "SUNDAY MORNING MIXER" is a program name that happens to open with a
 * weekday, and a looser test read it as a Sunday session — which then
 * swallowed the coach line beneath it as that phantom session's coach. So a
 * line counts as a day only when nothing but the day and its hours remain
 * once both are removed.
 */
function matchDay(line: string): string | null {
  for (const [pattern, name] of DAY_NAMES) {
    if (!pattern.test(line)) continue;
    const remainder = line
      .replace(pattern, "")
      .replace(TIME_RANGE, "")
      .replace(SINGLE_TIME, "")
      .replace(/[\s,:;.\-–—]/g, "");
    if (remainder.length === 0) return name;
  }
  return null;
}

/** `6:00PM` -> `6:00 PM`; `6pm` -> `6:00 PM`; `10:00 a.m.` -> `10:00 AM`. */
function normalizeTime(raw: string): string {
  const match = raw.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (!match) return raw.trim();
  const hour = match[1];
  const minutes = match[2] ?? "00";
  // The capture is the A or P alone, so the M has to be put back — without
  // it every time on the page read "6:00 P".
  const meridiem = `${match[3].toUpperCase()}M`;
  return `${hour}:${minutes} ${meridiem}`;
}

/**
 * The flyers are set in capitals, which is a design choice about the poster,
 * not about the words. Left alone, "GLENN MULLER" and "MEET NEW PLAYERS"
 * would shout on a web page that already styles its own headings.
 *
 * Only fully-uppercase input is touched, so anything typed normally is left
 * exactly as the operator wrote it.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or",
  "the", "to", "up", "vs", "with"
]);

function isAllCaps(value: string): boolean {
  return /[A-Z]/.test(value) && value === value.toUpperCase();
}

function titleCase(value: string): string {
  if (!isAllCaps(value)) return value;
  return value
    .toLowerCase()
    .replace(/[a-z][a-z']*/g, (word, offset: number) =>
      offset > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    );
}

/** Phrases read better as a sentence: "Winners move up, losers move down". */
function sentenceCase(value: string): string {
  if (!isAllCaps(value)) return value;
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export type FlyerTextResult = {
  program: Program | null;
  /** Lines recognized as the flyer's printed furniture and skipped. */
  ignored: string[];
};

let sequence = 0;
function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}-paste-${sequence}`;
}

/**
 * Parse one flyer's text into a single Program.
 *
 * One flyer per paste: that is how an operator works through a folder of
 * them, and guessing where one flyer ends and the next begins in a blob of
 * text is a source of silent mis-splits nobody would notice.
 */
export function parseProgramFlyerText(input: unknown): FlyerTextResult {
  const raw = typeof input === "string" ? input : "";
  const ignored: string[] = [];

  const lines: string[] = [];
  for (const original of raw.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    if (isFooterStart(line)) {
      // Everything from here down is the printed furniture.
      ignored.push(line);
      break;
    }
    if (isChrome(line)) {
      ignored.push(line);
      continue;
    }
    lines.push(line);
  }

  if (lines.length === 0) return { program: null, ignored };

  const sessions: ProgramSession[] = [];
  const pricing: ProgramPrice[] = [];
  const bullets: string[] = [];
  let title = "";
  let subtitle = "";
  let levelBadge = "";
  let sawSchedule = false;

  const pushSession = (day: string, times: string[] | null) => {
    sessions.push({
      id: newId("session"),
      day,
      startTime: times?.[0] ? normalizeTime(times[0]) : "",
      endTime: times?.[1] ? normalizeTime(times[1]) : ""
    });
  };

  for (const line of lines) {
    const day = matchDay(line);
    const range = line.match(TIME_RANGE);

    // A day, with or without its hours on the same line.
    if (day) {
      sawSchedule = true;
      pushSession(day, range ? [range[1], range[2]] : null);
      continue;
    }

    // Hours on their own line belong to the day above them.
    if (range) {
      sawSchedule = true;
      const current = sessions[sessions.length - 1];
      if (current && !current.startTime) {
        current.startTime = normalizeTime(range[1]);
        current.endTime = normalizeTime(range[2]);
      } else {
        pushSession("", [range[1], range[2]]);
      }
      continue;
    }

    const single = line.match(SINGLE_TIME);
    if (single && sessions.length > 0 && !sessions[sessions.length - 1].startTime) {
      sessions[sessions.length - 1].startTime = normalizeTime(single[1]);
      sawSchedule = true;
      continue;
    }

    // A price, with or without who it applies to on the same line.
    const price = line.match(PRICE);
    if (price) {
      const after = line.slice(line.indexOf(price[0]) + price[0].length).trim();
      pricing.push({
        id: newId("price"),
        amount: `$${price[1]}`,
        appliesTo: after ? titleCase(after.replace(/^[-–—:]\s*/, "")) : ""
      });
      continue;
    }

    // A coach: attached to the session above it, or the subtitle if the
    // schedule has not started yet ("Beginners / w/ Glenn Muller").
    const instructor = line.match(INSTRUCTOR);
    if (instructor) {
      const name = titleCase(instructor[1].trim());
      const current = sessions[sessions.length - 1];
      if (sawSchedule && current && !current.instructor) {
        current.instructor = name;
      } else if (!subtitle) {
        subtitle = `with ${name}`;
      }
      continue;
    }

    if (!levelBadge && (LEVEL_WORD.test(line) || LEVEL_RATING.test(line))) {
      levelBadge = titleCase(line);
      continue;
    }

    // A price band whose amount sat on the line above ("$27.50", then
    // "MEMBERS & NON-MEMBERS" underneath it, which is how the clinics are
    // set). Only "member" wording is claimed this way — anything else after
    // a price is far more likely to be a bullet.
    const lastPrice = pricing[pricing.length - 1];
    if (lastPrice && !lastPrice.appliesTo && /member/i.test(line)) {
      lastPrice.appliesTo = titleCase(line);
      continue;
    }

    if (!title) {
      title = titleCase(line);
      continue;
    }

    if (!subtitle && !sawSchedule && pricing.length === 0) {
      subtitle = sentenceCase(line);
      continue;
    }

    bullets.push(sentenceCase(line));
  }

  if (!title && sessions.length === 0 && pricing.length === 0) {
    return { program: null, ignored };
  }

  const program: Program = {
    id: newId("program"),
    title,
    sessions,
    pricing,
    bullets
  };
  if (subtitle) program.subtitle = subtitle;
  if (levelBadge) program.levelBadge = levelBadge;

  return { program, ignored };
}
