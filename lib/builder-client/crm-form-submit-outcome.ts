/**
 * What the live CRM form shows — or where it sends the visitor — after a
 * submit (task 86bcwy44f).
 *
 * The bug this exists for: the form editor has a "Success Message" box, and it
 * never showed. The server always answered with its own fixed sentence and the
 * form preferred the server's words over the site owner's. The same shape hid
 * the "Error Message": the server's raw technical text won instead.
 *
 * The rule now, in one place:
 *   - success → the form's own Success Message; the server's text only when
 *     the form has none; "Thank you!" when neither does.
 *   - success with a redirect → go there (live site only — on the Builder
 *     canvas a redirect would navigate the editor away from the page).
 *   - failure → the form's own Error Message, always. The technical detail is
 *     returned separately so the caller can log it, never shown to a visitor.
 */

export const CRM_DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

export type CrmSubmitFormLike = {
  successMessage?: string | null;
  errorMessage?: string | null;
};

export type CrmSubmitOutcome =
  | { kind: "message"; message: string }
  | { kind: "redirect"; url: string; message: string }
  | { kind: "error"; message: string; detail: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A same-site path or an http(s) address; anything else is not followed. */
export function safeCrmRedirectUrl(value: unknown): string {
  const url = text(value);
  if (!url) return "";
  if (url.startsWith("/")) {
    if (url.startsWith("//") || url.startsWith("/\\")) return "";
    return /[\s<>"]/.test(url) ? "" : url;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function crmSubmitSuccessOutcome(
  form: CrmSubmitFormLike | null | undefined,
  response: unknown,
  liveSite: boolean
): CrmSubmitOutcome {
  const body = (response && typeof response === "object" ? response : {}) as Record<string, unknown>;
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const message = text(form?.successMessage) || text(body.message) || text(data.message) || "Thank you!";
  const url = safeCrmRedirectUrl(body.redirectUrl ?? data.redirectUrl);
  if (url && liveSite) return { kind: "redirect", url, message };
  return { kind: "message", message };
}

export function crmSubmitErrorOutcome(
  form: CrmSubmitFormLike | null | undefined,
  detail: unknown
): CrmSubmitOutcome {
  const detailText = detail instanceof Error ? detail.message : text(detail);
  return {
    kind: "error",
    message: text(form?.errorMessage) || CRM_DEFAULT_ERROR_MESSAGE,
    detail: detailText,
  };
}
