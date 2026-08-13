import { describe, it, expect } from "vitest";
import {
  parsePrograms,
  formatSessionHours,
  isProgramListEmpty,
  type Program
} from "./builder-program-list";

/**
 * The fixtures are the four real Delray flyers supplied on 2026-08-12, not
 * invented data. Between them they cover every variation found across the
 * fifteen flyers in that style: a program with three sessions and no named
 * coach, one with a different coach per session, single-price and two-tier
 * pricing, and bullet lists present on the mixers but not the clinics.
 */
const DELRAY_FIXTURE = [
  {
    id: "beginners",
    title: "Beginners",
    subtitle: "with Glenn Muller",
    levelBadge: "New Players",
    sessions: [
      { id: "s1", day: "Tuesday", startTime: "6:00 PM", endTime: "7:00 PM" },
      { id: "s2", day: "Thursday", startTime: "6:00 PM", endTime: "7:00 PM" },
      { id: "s3", day: "Friday", startTime: "5:30 PM", endTime: "6:30 PM" }
    ],
    pricing: [{ id: "p1", amount: "$27.50", appliesTo: "members & non-members" }],
    bullets: []
  },
  {
    id: "back-to-basics",
    title: "Back to Basics",
    subtitle: "Drills and intermediate king of the court",
    levelBadge: "3.0 - 3.5 Players",
    sessions: [
      { id: "s1", day: "Tuesday", startTime: "7:00 PM", endTime: "8:30 PM", instructor: "Zach Schneider" },
      { id: "s2", day: "Thursday", startTime: "7:00 PM", endTime: "8:30 PM", instructor: "Vincent Williams" }
    ],
    pricing: [{ id: "p1", amount: "$30", appliesTo: "members & non-members" }],
    bullets: []
  },
  {
    id: "sunday-mixer",
    title: "Sunday Morning Mixer",
    subtitle: "with Jeff Kantor",
    levelBadge: "3.0 - 5.0 Players",
    sessions: [{ id: "s1", day: "Sunday", startTime: "10:00 AM", endTime: "12:00 PM" }],
    pricing: [
      { id: "p1", amount: "$20", appliesTo: "members" },
      { id: "p2", amount: "$25", appliesTo: "non-members" }
    ],
    bullets: [
      "Progressive mixed doubles",
      "Winners move up, losers move down",
      "Competitive match play",
      "Meet new players"
    ]
  },
  {
    id: "friday-mixer",
    title: "Friday Night Mixer",
    subtitle: "with Michael Campbell",
    levelBadge: "2.5 - 3.5 Players",
    sessions: [{ id: "s1", day: "Friday", startTime: "6:30 PM", endTime: "8:30 PM" }],
    pricing: [
      { id: "p1", amount: "$20", appliesTo: "members" },
      { id: "p2", amount: "$25", appliesTo: "non-members" }
    ],
    bullets: [
      "Progressive mixed doubles",
      "Winners move up, losers move down",
      "Competitive match play",
      "Meet new players"
    ]
  }
];

function byId(programs: Program[], wanted: string): Program {
  const found = programs.find((program) => program.id === wanted);
  if (!found) throw new Error(`fixture program ${wanted} did not survive parsing`);
  return found;
}

describe("parsePrograms — the real Delray flyers", () => {
  it("keeps all four programs", () => {
    expect(parsePrograms(DELRAY_FIXTURE)).toHaveLength(4);
  });

  it("reads a stored JSON string as well as an array", () => {
    const fromString = parsePrograms(JSON.stringify(DELRAY_FIXTURE));
    expect(fromString).toEqual(parsePrograms(DELRAY_FIXTURE));
  });

  it("keeps a different instructor on each session", () => {
    // The reason `instructor` sits on the session and not the program. A
    // program-level coach field would have dropped one of these two names.
    const sessions = byId(parsePrograms(DELRAY_FIXTURE), "back-to-basics").sessions;
    expect(sessions.map((session) => session.instructor)).toEqual([
      "Zach Schneider",
      "Vincent Williams"
    ]);
  });

  it("keeps both price bands when members and non-members differ", () => {
    const pricing = byId(parsePrograms(DELRAY_FIXTURE), "sunday-mixer").pricing;
    expect(pricing).toEqual([
      { id: "p1", amount: "$20", appliesTo: "members" },
      { id: "p2", amount: "$25", appliesTo: "non-members" }
    ]);
  });

  it("leaves instructor absent rather than empty when a program has no per-session coach", () => {
    const sessions = byId(parsePrograms(DELRAY_FIXTURE), "beginners").sessions;
    expect(sessions.every((session) => session.instructor === undefined)).toBe(true);
  });

  it("keeps bullets on the mixers and none on the clinics", () => {
    const parsed = parsePrograms(DELRAY_FIXTURE);
    expect(byId(parsed, "friday-mixer").bullets).toHaveLength(4);
    expect(byId(parsed, "beginners").bullets).toHaveLength(0);
  });
});

describe("parsePrograms — malformed input never throws", () => {
  // Standard 5: a malformed collection falls back to empty. This renderer
  // serves live tenant sites, so a bad save must not take a page down.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { title: "not an array" }],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["broken JSON", '[{"title": "Beginners"'],
    ["JSON that is not an array", '{"title":"Beginners"}']
  ])("returns an empty list for %s", (_label, input) => {
    expect(parsePrograms(input)).toEqual([]);
  });

  it("drops entries that are not objects", () => {
    expect(parsePrograms(["a string", 7, null, ["nested"]])).toEqual([]);
  });

  it("drops a program with no title, since it cannot be listed or chosen", () => {
    const parsed = parsePrograms([{ title: "   ", sessions: [] }, { title: "Real" }]);
    expect(parsed.map((program) => program.title)).toEqual(["Real"]);
  });

  it("keeps a title-only program, which is a legitimate work in progress", () => {
    const parsed = parsePrograms([{ title: "Junior Camp" }]);
    expect(parsed[0]).toMatchObject({ title: "Junior Camp", sessions: [], pricing: [], bullets: [] });
  });

  it("drops a session row with neither a day nor a start time", () => {
    const parsed = parsePrograms([
      { title: "X", sessions: [{ day: "", startTime: "", endTime: "7:00 PM" }, { day: "Monday" }] }
    ]);
    expect(parsed[0].sessions.map((session) => session.day)).toEqual(["Monday"]);
  });

  it("drops a price with no amount", () => {
    const parsed = parsePrograms([
      { title: "X", pricing: [{ appliesTo: "members" }, { amount: "$20", appliesTo: "members" }] }
    ]);
    expect(parsed[0].pricing).toHaveLength(1);
  });

  it("drops empty bullets rather than rendering blank list items", () => {
    const parsed = parsePrograms([{ title: "X", bullets: ["Real", "", "   ", "Also real"] }]);
    expect(parsed[0].bullets).toEqual(["Real", "Also real"]);
  });
});

describe("parsePrograms — ids and bounds", () => {
  it("falls back to a positional id so producers need not mint one", () => {
    // The Phase 2 flyer reader will emit programs with no ids.
    const parsed = parsePrograms([{ title: "First" }, { title: "Second" }]);
    expect(parsed.map((program) => program.id)).toEqual(["program-1", "program-2"]);
  });

  it("gives sessions and prices positional ids too", () => {
    const parsed = parsePrograms([
      { title: "X", sessions: [{ day: "Monday" }], pricing: [{ amount: "$5" }] }
    ]);
    expect(parsed[0].sessions[0].id).toBe("session-1");
    expect(parsed[0].pricing[0].id).toBe("price-1");
  });

  it("caps the collection lengths so one bad save cannot render forever", () => {
    const many = Array.from({ length: 500 }, (_unused, index) => ({
      title: `Program ${index}`,
      sessions: Array.from({ length: 200 }, () => ({ day: "Monday", startTime: "9:00 AM" })),
      bullets: Array.from({ length: 200 }, () => "point")
    }));
    const parsed = parsePrograms(many);
    expect(parsed.length).toBeLessThanOrEqual(60);
    expect(parsed[0].sessions.length).toBeLessThanOrEqual(24);
    expect(parsed[0].bullets.length).toBeLessThanOrEqual(12);
  });

  it("trims surrounding whitespace on text fields", () => {
    const parsed = parsePrograms([{ title: "  Beginners  ", subtitle: "  with Glenn Muller " }]);
    expect(parsed[0]).toMatchObject({ title: "Beginners", subtitle: "with Glenn Muller" });
  });
});

describe("formatSessionHours", () => {
  it("joins a start and end time", () => {
    expect(
      formatSessionHours({ id: "s", day: "Tuesday", startTime: "6:00 PM", endTime: "7:00 PM" })
    ).toBe("6:00 PM – 7:00 PM");
  });

  it("leaves no dangling dash when a session has only a start time", () => {
    // Real on flyers that give a start and let the coach finish.
    expect(
      formatSessionHours({ id: "s", day: "Sunday", startTime: "10:00 AM", endTime: "" })
    ).toBe("10:00 AM");
  });

  it("renders an end-only session without a leading dash", () => {
    expect(formatSessionHours({ id: "s", day: "Sunday", startTime: "", endTime: "12:00 PM" })).toBe(
      "12:00 PM"
    );
  });
});

describe("isProgramListEmpty", () => {
  it("is true for no programs, so the designed empty state shows", () => {
    expect(isProgramListEmpty(parsePrograms(undefined))).toBe(true);
  });

  it("is false once a program survives parsing", () => {
    expect(isProgramListEmpty(parsePrograms(DELRAY_FIXTURE))).toBe(false);
  });
});
