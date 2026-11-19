import { describe, expect, it } from "vitest";
import { filterRows, nextSort, sortRows } from "./outreach-table";

/** The shared Outreach table helpers (SC-887): pure, so held still here. */

type Row = { name: string; n: number | null };
const rows: Row[] = [
  { name: "video 10", n: 3 },
  { name: "Video 2", n: null },
  { name: "alpha", n: 7 },
  { name: "Beta", n: 3 },
];
const value = (r: Row, k: "name" | "n") => r[k];

describe("sortRows", () => {
  it("numbers sort both ways, a null stays last both ways, ties keep their order", () => {
    expect(sortRows(rows, { key: "n", dir: "desc" }, value).map((r) => r.name)).toEqual(["alpha", "video 10", "Beta", "Video 2"]);
    expect(sortRows(rows, { key: "n", dir: "asc" }, value).map((r) => r.name)).toEqual(["video 10", "Beta", "alpha", "Video 2"]);
  });
  it("words ignore case and read numbers inside them as numbers", () => {
    expect(sortRows(rows, { key: "name", dir: "asc" }, value).map((r) => r.name)).toEqual(["alpha", "Beta", "Video 2", "video 10"]);
  });
  it("no sort returns a copy in the original order", () => {
    const out = sortRows(rows, null, value);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
});

describe("filterRows", () => {
  it("combines filters with AND and ignores the ones switched off", () => {
    const out = filterRows(rows, [(r) => r.n !== null, null, false, (r) => r.name.toLowerCase().startsWith("v")]);
    expect(out.map((r) => r.name)).toEqual(["video 10"]);
    expect(filterRows(rows, [null, undefined])).toEqual(rows);
  });
});

describe("nextSort", () => {
  it("a new column starts at its first direction; the same column flips", () => {
    expect(nextSort(null, "n", "desc")).toEqual({ key: "n", dir: "desc" });
    expect(nextSort({ key: "n", dir: "desc" }, "n")).toEqual({ key: "n", dir: "asc" });
    expect(nextSort({ key: "n", dir: "asc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});
