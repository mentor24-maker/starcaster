import { describe, expect, it } from "vitest";
import { firstRunSteps, isFirstRun, FIRST_CREATORS } from "./first-run-path";
import type { OutreachChannel, OutreachStage } from "./outreach-wizard-panel";

/** The first-run path's steps (SC-916), from the overview the panel already has. */

function stage(key: string, extra: Partial<OutreachStage> & Record<string, unknown> = {}): OutreachStage {
  return { key, label: key, state: "not_started", sentence: "s", next: null, inline: true, ...extra } as OutreachStage;
}

function channel(over: { account?: OutreachChannel["account"]; creators?: number; replies?: number; waiting?: number; repliesState?: OutreachStage["state"] } = {}): OutreachChannel {
  return {
    key: "youtube",
    label: "YouTube",
    account: "account" in over ? over.account : { expectedAccount: "", observedAccount: "", confirmedAt: null, checkRequestedAt: null, browserCheckedAt: null },
    stages: [
      stage("connect"),
      stage("creators", { approvedCount: over.creators ?? 0 }),
      stage("conversations"),
      stage("replies", { approvedCount: over.replies ?? 0, waitingCount: over.waiting ?? 0, state: over.repliesState ?? "not_started" }),
      stage("learn"),
    ],
  };
}

const saved = { keywords: ["tennis"], source: "saved" as const };
const state = (c: OutreachChannel, k: Parameters<typeof firstRunSteps>[1]) => firstRunSteps(c, k).map((s) => `${s.key}:${s.state}`);

describe("firstRunSteps", () => {
  it("walks Connect, account, keywords, creators, reply — the first not done is Now", () => {
    expect(state(channel(), saved)).toEqual(["connect:now", "account:later", "keywords:done", "creators:later", "reply:later"]);
    const signedIn = { expectedAccount: "", observedAccount: "Dane", confirmedAt: null, checkRequestedAt: null, browserCheckedAt: null };
    expect(state(channel({ account: signedIn }), saved)[1]).toBe("account:now");
    const chosen = { ...signedIn, expectedAccount: "Dane" };
    expect(state(channel({ account: chosen, creators: 4 }), saved)).toEqual(["connect:done", "account:done", "keywords:done", "creators:now", "reply:later"]);
    expect(state(channel({ account: chosen, creators: FIRST_CREATORS }), saved)[4]).toBe("reply:now");
  });

  it("keywords started from the Miner's list are not done until saved, and a failed read is cannot tell", () => {
    const steps = firstRunSteps(channel(), { keywords: ["x"], source: "substack_miner" });
    expect(steps[2].state).toBe("later");
    expect(steps[2].sentence).toContain("Started from the Substack Miner's keywords");
    expect(firstRunSteps(channel(), { error: "boom." })[2].state).toBe("cannot_tell");
  });

  it("an account that could not be read is cannot tell, never done, and does not hold up the rest", () => {
    expect(state(channel({ account: null }), saved).slice(0, 4)).toEqual(["connect:cannot_tell", "account:cannot_tell", "keywords:done", "creators:now"]);
  });

  it("every step says what happens next", () => {
    for (const s of firstRunSteps(channel(), saved)) expect(s.next.length).toBeGreaterThan(20);
  });

  it("the reply step sends you to Write replies once something is waiting", () => {
    expect(firstRunSteps(channel(), saved)[4].stage).toBe("conversations");
    expect(firstRunSteps(channel({ waiting: 2 }), saved)[4].stage).toBe("replies");
  });
});

describe("isFirstRun", () => {
  it("is true only for a counted zero approved replies", () => {
    expect(isFirstRun(channel())).toBe(true);
    expect(isFirstRun(channel({ replies: 1 }))).toBe(false);
    expect(isFirstRun(channel({ repliesState: "cannot_tell" }))).toBe(false);
  });

  it("an account chosen but not the one the Mini is signed in as is not done (SC-916 send-back)", () => {
    const mismatch = { expectedAccount: "Dane of Earth", observedAccount: "Dane Christensen", confirmedAt: null, checkRequestedAt: null, browserCheckedAt: null };
    const steps = firstRunSteps(channel({ account: mismatch }), saved);
    expect(steps[1].state).toBe("now");
    expect(steps[1].sentence).toContain("set to post as Dane of Earth, but the Mini is signed in as Dane Christensen");
  });
});
