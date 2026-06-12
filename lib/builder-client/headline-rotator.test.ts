import { describe, expect, it } from "vitest";
import {
  HEADLINE_ROTATOR_MAX_Y_PERCENT,
  clampHeadlineRotatorYPercent,
  computeHeadlineRotatorFadeInDelay,
  computeHeadlineRotatorTransitionMs,
  getHeadlineRotatorPositionStyle,
  getHeadlineRotatorSkyPosition,
  normalizeHeadlineRotatorHeadlinesJson,
  parseHeadlineRotatorEntries,
  usesDefaultHeadlineRotatorPosition
} from "@/lib/headline-rotator";

describe("headline rotator sky positions", () => {
  it("detects legacy center defaults", () => {
    expect(usesDefaultHeadlineRotatorPosition("50", "50")).toBe(true);
    expect(usesDefaultHeadlineRotatorPosition(undefined, undefined)).toBe(true);
    expect(usesDefaultHeadlineRotatorPosition("22", "14")).toBe(false);
  });

  it("assigns unique sky positions per index", () => {
    const first = getHeadlineRotatorSkyPosition(0);
    const second = getHeadlineRotatorSkyPosition(1);
    expect(first).not.toEqual(second);
    expect(Number(first.yAxis)).toBeLessThanOrEqual(HEADLINE_ROTATOR_MAX_Y_PERCENT);
    expect(Number(second.yAxis)).toBeLessThanOrEqual(HEADLINE_ROTATOR_MAX_Y_PERCENT);
  });

  it("maps stored 50/50 entries to sky positions on parse", () => {
    const entries = parseHeadlineRotatorEntries(
      JSON.stringify([
        { id: "a", label: "One", xAxis: "50", yAxis: "50" },
        { id: "b", label: "Two", xAxis: "50", yAxis: "50" }
      ]),
      "#18324a"
    );

    expect(entries[0]?.xAxis).not.toBe("50");
    expect(entries[0]?.yAxis).not.toBe("50");
    expect(entries[1]?.xAxis).not.toBe(entries[0]?.xAxis);
  });

  it("preserves custom coordinates", () => {
    const entries = parseHeadlineRotatorEntries(
      JSON.stringify([{ id: "a", label: "One", xAxis: "33", yAxis: "20" }]),
      "#18324a"
    );

    expect(entries[0]?.xAxis).toBe("33");
    expect(entries[0]?.yAxis).toBe("20");
  });

  it("anchors low x to the left edge and high x to the right edge", () => {
    expect(getHeadlineRotatorPositionStyle("12", "20").left).toBe("12%");
    expect(getHeadlineRotatorPositionStyle("12", "20").transform).toBe("translate(0, -50%)");
    expect(getHeadlineRotatorPositionStyle("88", "20").right).toBe("12%");
    expect(getHeadlineRotatorPositionStyle("88", "20").left).toBeUndefined();
  });

  it("clamps y-axis to the top sky band", () => {
    expect(clampHeadlineRotatorYPercent("80")).toBe(HEADLINE_ROTATOR_MAX_Y_PERCENT);
    expect(getHeadlineRotatorPositionStyle("50", "80").top).toBe(`${HEADLINE_ROTATOR_MAX_Y_PERCENT}%`);
  });

  it("computes fade-in delay from overlap milliseconds", () => {
    expect(computeHeadlineRotatorFadeInDelay(800, 400)).toBe(400);
    expect(computeHeadlineRotatorFadeInDelay(800, 900)).toBe(0);
    expect(computeHeadlineRotatorTransitionMs(2000, 400)).toBe(3600);
  });

  it("normalizes headline JSON for persistence", () => {
    const normalized = normalizeHeadlineRotatorHeadlinesJson(
      JSON.stringify([{ id: "a", label: "Sky", xAxis: "50", yAxis: "50", color: "#fff" }]),
      "#18324a"
    );
    const parsed = JSON.parse(normalized) as { xAxis: string; yAxis: string }[];

    expect(parsed[0]?.xAxis).not.toBe("50");
    expect(parsed[0]?.yAxis).not.toBe("50");
  });
});
