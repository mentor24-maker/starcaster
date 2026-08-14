import { describe, it, expect } from "vitest";
import { parseProgramFlyerText } from "./builder-program-flyer-text";

/**
 * The fixtures are the text of the four real Delray flyers supplied on
 * 2026-08-12, transcribed as they are set — in capitals, one element per
 * line, footer and all. Pasting a whole flyer is the normal case, so the
 * furniture is included on purpose rather than cleaned up first.
 */
const BEGINNERS = `
BEGINNERS
W/ GLENN MULLER
NEW PLAYERS
TUESDAY
6:00PM - 7:00PM
THURSDAY
6:00PM - 7:00PM
FRIDAY
5:30PM - 6:30PM
$27.50
MEMBERS & NON-MEMBERS
24-HOUR CANCELLATION POLICY
CALL OR STOP BY THE PRO SHOP TO RESERVE YOUR SPOT!
561-243-7360
DELRAY BEACH TENNIS CENTER
201 W Atlantic Ave
delraytennis.com
@delraybeachtennis
`;

const BACK_TO_BASICS = `
BACK TO BASICS
DRILLS & INTERMEDIATE KING OF THE COURT
3.0 - 3.5 PLAYERS
TUESDAY
7:00PM - 8:30PM
W/ Zach Schneider
THURSDAY
7:00PM - 8:30PM
W/ Vincent Williams
$30
MEMBERS & NON-MEMBERS
`;

const SUNDAY_MIXER = `
SUNDAY MORNING MIXER
W/ JEFF KANTOR
3.0-5.0 PLAYERS
SUNDAY
10:00AM - 12:00PM
$20 MEMBERS
$25 NON-MEMBERS
PROGRESSIVE MIXED DOUBLES
WINNERS MOVE UP, LOSERS MOVE DOWN
COMPETITIVE MATCH PLAY
MEET NEW PLAYERS
`;

describe("parseProgramFlyerText — the real Delray flyers", () => {
  it("reads the Beginners clinic", () => {
    const { program } = parseProgramFlyerText(BEGINNERS);
    expect(program).not.toBeNull();
    expect(program!.title).toBe("Beginners");
    expect(program!.subtitle).toBe("with Glenn Muller");
    expect(program!.levelBadge).toBe("New Players");
    expect(program!.sessions.map((s) => [s.day, s.startTime, s.endTime])).toEqual([
      ["Tuesday", "6:00 PM", "7:00 PM"],
      ["Thursday", "6:00 PM", "7:00 PM"],
      ["Friday", "5:30 PM", "6:30 PM"]
    ]);
    expect(program!.pricing).toEqual([
      { id: expect.any(String), amount: "$27.50", appliesTo: "Members & Non-Members" }
    ]);
  });

  it("does not mistake $27.50 for $2750", () => {
    // The reason this is rules and not a model. A misread price is not caught
    // until a member argues about it at the desk.
    const { program } = parseProgramFlyerText(BEGINNERS);
    expect(program!.pricing[0].amount).toBe("$27.50");
  });

  it("keeps a different coach on each session", () => {
    const { program } = parseProgramFlyerText(BACK_TO_BASICS);
    expect(program!.sessions.map((s) => s.instructor)).toEqual([
      "Zach Schneider",
      "Vincent Williams"
    ]);
    // The coach lines are per session here, so none of them became the subtitle.
    expect(program!.subtitle).toBe("Drills & intermediate king of the court");
  });

  it("keeps both price bands when members and non-members differ", () => {
    const { program } = parseProgramFlyerText(SUNDAY_MIXER);
    expect(program!.pricing.map((p) => [p.amount, p.appliesTo])).toEqual([
      ["$20", "Members"],
      ["$25", "Non-Members"]
    ]);
  });

  it("reads the mixer's bullets and does not swallow them into pricing", () => {
    const { program } = parseProgramFlyerText(SUNDAY_MIXER);
    expect(program!.bullets).toEqual([
      "Progressive mixed doubles",
      "Winners move up, losers move down",
      "Competitive match play",
      "Meet new players"
    ]);
  });

  it("reads a midday range across the AM/PM boundary", () => {
    const { program } = parseProgramFlyerText(SUNDAY_MIXER);
    expect(program!.sessions[0]).toMatchObject({
      day: "Sunday",
      startTime: "10:00 AM",
      endTime: "12:00 PM"
    });
  });
});

describe("parseProgramFlyerText — the flyer's printed furniture", () => {
  it("stops at the cancellation policy and keeps none of the footer", () => {
    const { program } = parseProgramFlyerText(BEGINNERS);
    const everything = JSON.stringify(program);
    for (const leak of ["Cancellation", "Pro Shop", "243-7360", "Atlantic", "delraytennis", "@delray"]) {
      expect(everything).not.toContain(leak);
    }
  });

  it("reports what it skipped, so the operator can see it was deliberate", () => {
    const { ignored } = parseProgramFlyerText(BEGINNERS);
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored.some((line) => /cancellation/i.test(line))).toBe(true);
  });

  it("drops a bare phone number, handle or domain wherever it appears", () => {
    const { program } = parseProgramFlyerText(
      "JUNIOR CAMP\n561-243-7360\n@delraybeachtennis\ndelraytennis.com\nMONDAY\n9:00AM - 10:00AM"
    );
    expect(program!.title).toBe("Junior Camp");
    expect(program!.bullets).toEqual([]);
    expect(program!.sessions).toHaveLength(1);
  });
});

describe("parseProgramFlyerText — shapes that are not the four fixtures", () => {
  it("reads a day and its hours from one line", () => {
    const { program } = parseProgramFlyerText("Cardio Tennis\nMonday 7:00 AM - 8:00 AM");
    expect(program!.sessions[0]).toMatchObject({
      day: "Monday",
      startTime: "7:00 AM",
      endTime: "8:00 AM"
    });
  });

  it("accepts abbreviated days and lowercase meridiems", () => {
    const { program } = parseProgramFlyerText("Drills\nTues\n6pm - 7pm");
    expect(program!.sessions[0]).toMatchObject({
      day: "Tuesday",
      startTime: "6:00 PM",
      endTime: "7:00 PM"
    });
  });

  it("accepts an en dash and the word 'to' between times", () => {
    const a = parseProgramFlyerText("X\nMonday\n6:00 PM – 7:00 PM").program;
    const b = parseProgramFlyerText("X\nMonday\n6:00 PM to 7:00 PM").program;
    expect(a!.sessions[0].endTime).toBe("7:00 PM");
    expect(b!.sessions[0].endTime).toBe("7:00 PM");
  });

  it("keeps an open-ended session rather than inventing an end time", () => {
    const { program } = parseProgramFlyerText("Open Play\nSaturday\n9:00 AM");
    expect(program!.sessions[0]).toMatchObject({ day: "Saturday", startTime: "9:00 AM", endTime: "" });
  });

  it("leaves normally-typed text alone instead of recasing it", () => {
    const { program } = parseProgramFlyerText("Cardio Tennis\nwith Sam O'Neill\nMonday\n7am - 8am");
    expect(program!.title).toBe("Cardio Tennis");
    expect(program!.subtitle).toBe("with Sam O'Neill");
  });

  it("returns nothing for empty or unusable input", () => {
    for (const input of ["", "   \n\n  ", undefined, null, 42]) {
      expect(parseProgramFlyerText(input).program).toBeNull();
    }
  });
});
