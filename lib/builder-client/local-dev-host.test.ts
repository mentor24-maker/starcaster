import { describe, expect, it } from "vitest";

import { LOCAL_DEV_HOST, isLocalDevHost } from "./local-dev-host";

describe("isLocalDevHost", () => {
  it("exposes the expected local dev host constant", () => {
    expect(LOCAL_DEV_HOST).toBe("localhost:3000");
  });

  it("matches the exact local dev host", () => {
    expect(isLocalDevHost("localhost:3000")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isLocalDevHost("LOCALHOST:3000")).toBe(true);
    expect(isLocalDevHost("LocalHost:3000")).toBe(true);
  });

  it("returns false for null or undefined", () => {
    expect(isLocalDevHost(null)).toBe(false);
    expect(isLocalDevHost(undefined)).toBe(false);
  });

  it("returns false for a non-matching host", () => {
    expect(isLocalDevHost("example.com")).toBe(false);
    expect(isLocalDevHost("localhost:3001")).toBe(false);
    expect(isLocalDevHost("")).toBe(false);
  });
});
