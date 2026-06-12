import { describe, expect, it } from "vitest";
import {
  getRequestClientIp,
  isHoneypotTriggered,
  isReasonableEmail,
  isUuid,
  safePublicText
} from "@/lib/public-request";

describe("isUuid", () => {
  it("accepts valid uuids", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("isReasonableEmail", () => {
  it("accepts simple valid emails", () => {
    expect(isReasonableEmail("reader@example.com")).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isReasonableEmail("missing-at.com")).toBe(false);
    expect(isReasonableEmail("@example.com")).toBe(false);
  });
});

describe("isHoneypotTriggered", () => {
  it("is false when empty", () => {
    expect(isHoneypotTriggered("")).toBe(false);
    expect(isHoneypotTriggered(undefined)).toBe(false);
  });

  it("is true when a bot fills the field", () => {
    expect(isHoneypotTriggered("https://spam.test")).toBe(true);
  });
});

describe("getRequestClientIp", () => {
  it("reads the first x-forwarded-for hop", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.1, 70.41.67.2" }
    });

    expect(getRequestClientIp(request)).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "198.51.100.10" }
    });

    expect(getRequestClientIp(request)).toBe("198.51.100.10");
  });
});

describe("safePublicText", () => {
  it("trims and caps length", () => {
    expect(safePublicText("  hello  ", 3)).toBe("hel");
  });
});
