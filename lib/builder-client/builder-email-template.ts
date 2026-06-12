export const BUILDER_EMAIL_FUNCTIONS = [
  { value: "signup_confirmation", label: "Signup Confirmation" },
  { value: "password_reset", label: "Password Reset" },
  { value: "admin_invite", label: "Admin Invite" },
  { value: "magic_link", label: "Magic Link" }
] as const;

export type BuilderEmailFunction = (typeof BUILDER_EMAIL_FUNCTIONS)[number]["value"];

export function normalizeEmailFunction(value: unknown): BuilderEmailFunction | "" {
  const text = String(value ?? "").trim().toLowerCase();

  if (BUILDER_EMAIL_FUNCTIONS.some((entry) => entry.value === text)) {
    return text as BuilderEmailFunction;
  }

  return "";
}

export function getEmailFunctionLabel(value: BuilderEmailFunction | ""): string {
  if (!value) {
    return "—";
  }

  return BUILDER_EMAIL_FUNCTIONS.find((entry) => entry.value === value)?.label ?? value;
}

export function getDefaultEmailTemplateName(value: BuilderEmailFunction | ""): string {
  const label = getEmailFunctionLabel(value);

  if (!label || label === "—") {
    return "Untitled Email Template";
  }

  return `${label} Email`;
}

/** Supabase Auth email templates (Go syntax). Use these in button hrefs — do not hand-build verify URLs. */
export const BUILDER_EMAIL_MERGE_TOKENS = [
  {
    label: "Confirmation URL",
    token: "{{ .ConfirmationURL }}",
    description: "Full Supabase verify link (token, type, and redirect are included automatically)."
  },
  {
    label: "Email Address",
    token: "{{ .Email }}",
    description: "Recipient email address."
  },
  {
    label: "Site URL",
    token: "{{ .SiteURL }}",
    description: "Site URL from Supabase Auth settings."
  }
] as const;

export const BUILDER_EMAIL_CONFIRMATION_URL_TOKEN = "{{ .ConfirmationURL }}";

export function resolveEmailMergeTokensForPreview(value: string): string {
  return String(value ?? "")
    .replace(/\{\{\s*\.ConfirmationURL\s*\}\}/gi, "https://example.supabase.co/auth/v1/verify?token=example&type=signup&redirect_to=https://normie.one/portal/auth/callback")
    .replace(/\{\{\s*\.Email\s*\}\}/gi, "player@example.com")
    .replace(/\{\{\s*\.SiteURL\s*\}\}/gi, "https://normie.one");
}
