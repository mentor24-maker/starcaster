import type { BuilderEmailFunction } from "@/lib/builder-email-template";
import { getAuthEmailSiteUrl } from "@/lib/site-url";

export type SupabaseAuthEmailAction =
  | "signup"
  | "recovery"
  | "invite"
  | "magiclink"
  | "email_change"
  | "email_change_new"
  | "reauthentication";

export type SupabaseSendEmailPayload = {
  user: {
    email?: string;
    new_email?: string;
  };
  email_data: {
    token?: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: SupabaseAuthEmailAction | string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
    old_email?: string;
  };
};

const AUTH_EMAIL_SUBJECTS: Record<BuilderEmailFunction, string> = {
  signup_confirmation: "Confirm your Normie account",
  password_reset: "Reset your Normie password",
  admin_invite: "You have been invited to Normie",
  magic_link: "Your Normie sign-in link"
};

export function mapAuthEmailActionToFunction(action: string): BuilderEmailFunction | "" {
  const normalized = String(action ?? "").trim().toLowerCase();

  if (normalized === "signup") {
    return "signup_confirmation";
  }

  if (normalized === "recovery") {
    return "password_reset";
  }

  if (normalized === "invite") {
    return "admin_invite";
  }

  if (normalized === "magiclink") {
    return "magic_link";
  }

  return "";
}

export function getAuthEmailSubject(emailFunction: BuilderEmailFunction): string {
  return AUTH_EMAIL_SUBJECTS[emailFunction];
}

export function buildSupabaseConfirmationUrl(emailData: SupabaseSendEmailPayload["email_data"]): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  const verifyUrl = new URL("/auth/v1/verify", supabaseUrl);
  verifyUrl.searchParams.set("token", emailData.token_hash);
  verifyUrl.searchParams.set("type", emailData.email_action_type);
  verifyUrl.searchParams.set("redirect_to", emailData.redirect_to);

  return verifyUrl.toString();
}

export type AuthEmailMergeContext = {
  confirmationUrl: string;
  email: string;
  siteUrl: string;
};

export function buildAuthEmailMergeContext(payload: SupabaseSendEmailPayload): AuthEmailMergeContext {
  const recipient = payload.user.new_email || payload.user.email || "";

  return {
    confirmationUrl: buildSupabaseConfirmationUrl(payload.email_data),
    email: recipient,
    siteUrl: payload.email_data.site_url || getAuthEmailSiteUrl()
  };
}

export function applyAuthEmailMergeFields(html: string, context: AuthEmailMergeContext): string {
  return String(html ?? "")
    .replace(/\{\{\s*\.ConfirmationURL\s*\}\}/gi, context.confirmationUrl)
    .replace(/\{\{\s*\.Email\s*\}\}/gi, context.email)
    .replace(/\{\{\s*\.SiteURL\s*\}\}/gi, context.siteUrl);
}
