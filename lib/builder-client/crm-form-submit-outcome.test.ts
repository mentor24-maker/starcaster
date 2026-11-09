import { describe, expect, it } from "vitest";
import {
  CRM_DEFAULT_ERROR_MESSAGE,
  crmSubmitErrorOutcome,
  crmSubmitSuccessOutcome,
  safeCrmRedirectUrl
} from "./crm-form-submit-outcome";

// What the server answered before task 86bcwy44f, on every submit, for every form.
const OLD_SERVER_ANSWER = { ok: true, data: {}, message: "Thank you! Your information has been saved." };

describe("crmSubmitSuccessOutcome", () => {
  it("shows the form's OWN success message, not the server's fixed sentence", () => {
    // The bug: the editor's Success Message never showed, because the server's
    // text won. This is the acceptance case, word for word.
    const outcome = crmSubmitSuccessOutcome(
      { successMessage: "Thanks — we'll call you" },
      OLD_SERVER_ANSWER,
      true
    );
    expect(outcome).toEqual({ kind: "message", message: "Thanks — we'll call you" });
  });

  it("falls back to the server's message, then to 'Thank you!'", () => {
    expect(crmSubmitSuccessOutcome({ successMessage: "  " }, OLD_SERVER_ANSWER, true))
      .toEqual({ kind: "message", message: OLD_SERVER_ANSWER.message });
    expect(crmSubmitSuccessOutcome(null, {}, true)).toEqual({ kind: "message", message: "Thank you!" });
  });

  it("follows the form's redirect on a live site", () => {
    const outcome = crmSubmitSuccessOutcome(
      { successMessage: "Thanks" },
      { ok: true, data: { message: "Thanks", redirectUrl: "/thank-you" }, redirectUrl: "/thank-you" },
      true
    );
    expect(outcome).toEqual({ kind: "redirect", url: "/thank-you", message: "Thanks" });
  });

  it("does NOT navigate the Builder canvas away — it shows the message instead", () => {
    const outcome = crmSubmitSuccessOutcome(
      { successMessage: "Thanks" },
      { redirectUrl: "/thank-you" },
      false
    );
    expect(outcome).toEqual({ kind: "message", message: "Thanks" });
  });

  it("refuses a redirect that is not a page address", () => {
    for (const bad of ["javascript:alert(1)", "//evil.example/x", "/\\evil.example", "data:text/html,hi", "thank-you"]) {
      expect(crmSubmitSuccessOutcome({}, { redirectUrl: bad }, true).kind).toBe("message");
    }
  });
});

describe("crmSubmitErrorOutcome", () => {
  it("shows the form's Error Message and keeps the technical detail out of view", () => {
    const outcome = crmSubmitErrorOutcome(
      { errorMessage: "Sorry, please call us instead." },
      new Error("duplicate key value violates unique constraint")
    );
    expect(outcome).toEqual({
      kind: "error",
      message: "Sorry, please call us instead.",
      detail: "duplicate key value violates unique constraint"
    });
  });

  it("falls back to the default wording, never to the raw error", () => {
    const outcome = crmSubmitErrorOutcome(null, new Error("Failed to fetch"));
    expect(outcome.message).toBe(CRM_DEFAULT_ERROR_MESSAGE);
  });
});

describe("safeCrmRedirectUrl", () => {
  it("keeps same-site paths and http(s) addresses", () => {
    expect(safeCrmRedirectUrl("/thank-you?x=1")).toBe("/thank-you?x=1");
    expect(safeCrmRedirectUrl("https://example.com/thanks")).toBe("https://example.com/thanks");
    expect(safeCrmRedirectUrl("")).toBe("");
  });
});
