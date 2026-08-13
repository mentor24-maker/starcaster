/**
 * Program List — the shared shape for a club's classes, clinics and mixers.
 *
 * Delray Beach Tennis Center published its programmes as designed flyer
 * images: staff could not change a start time without reopening a design
 * file, re-exporting and re-uploading. This module's whole reason for
 * existing is the operator's line on 2026-08-12 — *"they want the info
 * highlighted, but it's weird to repeat the address over and over. Flyers
 * don't belong on a website."* (ClickUp `86bbdby3a`.)
 *
 * So this is deliberately **not** a flyer renderer. It carries the content
 * that varies between programmes and nothing else. Everything that was
 * identical across all fifteen source flyers — club logo, address block,
 * social links, the decorative palm and halftone — is either site chrome
 * the page already provides or decoration that existed to fill a printed
 * page. None of it belongs in this shape.
 *
 * The schema is shared on purpose: Phase 2 of the same project is a reader
 * that turns a flyer image into these fields, and a reader that emits a
 * different shape than the renderer consumes is two schemas drifting apart
 * from the first commit.
 */

/**
 * One occurrence of a programme.
 *
 * `instructor` is per session, not per programme, because it genuinely
 * varies within one: the "Back to Basics" flyer runs with Zach Schneider on
 * Tuesday and Vincent Williams on Thursday. A programme-level coach field
 * alone would have silently dropped one of those two names.
 */
export type ProgramSession = {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  instructor?: string;
};

/**
 * One price band.
 *
 * A list rather than a single amount because both mixers charge members $20
 * and non-members $25, while the clinics charge everyone the same. A scalar
 * price field would have forced the two-tier case into a string like
 * "$20/$25" that nothing downstream could read.
 */
export type ProgramPrice = {
  id: string;
  amount: string;
  appliesTo: string;
};

export type Program = {
  id: string;
  title: string;
  /** "with Glenn Muller", or a descriptive line like "Drills and intermediate king of the court". */
  subtitle?: string;
  /** "New Players", "3.0 - 3.5 Players" — the one flyer device that does real work. */
  levelBadge?: string;
  sessions: ProgramSession[];
  pricing: ProgramPrice[];
  bullets: string[];
};

const MAX_PROGRAMS = 60;
const MAX_SESSIONS = 24;
const MAX_PRICES = 8;
const MAX_BULLETS = 12;

/** Field lengths. Generous, but bounded — settings are user input. */
const MAX_SHORT = 160;
const MAX_BULLET = 240;

function text(value: unknown, limit: number): string {
  if (typeof value === "string") return value.trim().slice(0, limit);
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, limit);
  return "";
}

/** An optional field is absent rather than empty, so callers can use `??`. */
function optionalText(value: unknown, limit: number): string | undefined {
  const trimmed = text(value, limit);
  return trimmed || undefined;
}

/**
 * Ids only have to be unique within one module, and hand-authored fixtures
 * (and anything the Phase 2 reader emits) will not carry them. Falling back
 * to the index keeps React keys stable for a given ordering without forcing
 * every producer to mint ids.
 */
function id(value: unknown, prefix: string, index: number): string {
  return text(value, 64) || `${prefix}-${index + 1}`;
}

function parseSessions(raw: unknown): ProgramSession[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_SESSIONS)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;

      const session: ProgramSession = {
        id: id(row.id, "session", index),
        day: text(row.day, MAX_SHORT),
        startTime: text(row.startTime, MAX_SHORT),
        endTime: text(row.endTime, MAX_SHORT)
      };

      const instructor = optionalText(row.instructor, MAX_SHORT);
      if (instructor) session.instructor = instructor;

      // A row with no day and no start time carries nothing a reader could
      // act on; it is a half-typed row, not content. Dropping it here keeps
      // the empty-state check (standard 5) honest.
      return session.day || session.startTime ? session : null;
    })
    .filter((session): session is ProgramSession => session !== null);
}

function parsePricing(raw: unknown): ProgramPrice[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_PRICES)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;

      const amount = text(row.amount, MAX_SHORT);
      if (!amount) return null;

      return {
        id: id(row.id, "price", index),
        amount,
        appliesTo: text(row.appliesTo, MAX_SHORT)
      } satisfies ProgramPrice;
    })
    .filter((price): price is ProgramPrice => price !== null);
}

function parseBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_BULLETS)
    .map((entry) => text(entry, MAX_BULLET))
    .filter((entry) => entry.length > 0);
}

/**
 * Turn a stored `programs` setting into usable data.
 *
 * Settings collections are stored as JSON strings (see
 * `normalizeBuilderModuleSettingsForType`), so both a string and an
 * already-parsed array arrive here depending on the caller. Neither may
 * throw: standard 5 requires a malformed collection to fall back to empty
 * rather than crash the page, and this renderer serves live tenant sites.
 */
export function parsePrograms(raw: unknown): Program[] {
  let source: unknown = raw;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      source = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(source)) return [];

  return source
    .slice(0, MAX_PROGRAMS)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;

      const title = text(row.title, MAX_SHORT);
      // A programme with no name cannot be listed or chosen. Everything else
      // is optional — a title-only entry is a legitimate work in progress.
      if (!title) return null;

      const program: Program = {
        id: id(row.id, "program", index),
        title,
        sessions: parseSessions(row.sessions),
        pricing: parsePricing(row.pricing),
        bullets: parseBullets(row.bullets)
      };

      const subtitle = optionalText(row.subtitle, MAX_SHORT);
      if (subtitle) program.subtitle = subtitle;

      const levelBadge = optionalText(row.levelBadge, MAX_SHORT);
      if (levelBadge) program.levelBadge = levelBadge;

      return program;
    })
    .filter((program): program is Program => program !== null);
}

/**
 * Render one session's hours as a single string.
 *
 * Kept out of the renderer so the em-dash and the one-sided cases are
 * decided once. An open-ended session ("Sunday 10:00 AM") is real — it
 * happens on flyers that give a start and let the coach finish — so a
 * missing end time must not produce a dangling dash.
 */
export function formatSessionHours(session: ProgramSession): string {
  const start = session.startTime.trim();
  const end = session.endTime.trim();

  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/**
 * True when a module has nothing worth rendering, so the caller can show the
 * designed empty state (standard 5) rather than an empty box.
 */
export function isProgramListEmpty(programs: Program[]): boolean {
  return programs.length === 0;
}

/**
 * Store a collection back into module settings.
 *
 * Deliberately does **not** re-run `parsePrograms`. The editor holds
 * half-typed rows — a session with a day and no time yet, a programme whose
 * title is still being typed — and parsing on the way out would delete them
 * mid-keystroke. Validation belongs on the read side, which is where the
 * renderer needs it.
 */
export function serializePrograms(programs: Program[]): string {
  return JSON.stringify(programs);
}

let sequence = 0;

/**
 * A locally-unique id for a newly added row.
 *
 * Ids only have to distinguish rows inside one module, and `Date.now()` alone
 * collides when two rows are added in the same millisecond — which happens
 * with a held-down key or a paste. The counter makes that impossible.
 */
function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

export function createProgram(): Program {
  return { id: newId("program"), title: "", sessions: [], pricing: [], bullets: [] };
}

export function createProgramSession(): ProgramSession {
  return { id: newId("session"), day: "", startTime: "", endTime: "" };
}

export function createProgramPrice(): ProgramPrice {
  return { id: newId("price"), amount: "", appliesTo: "" };
}

/**
 * Bullets are edited as one per line in a textarea rather than as a list of
 * add/remove rows: they are short, order matters, and reordering four points
 * with arrow buttons is slower than editing four lines of text.
 */
export function bulletsToText(bullets: string[]): string {
  return bullets.join("\n");
}

export function bulletsFromText(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
