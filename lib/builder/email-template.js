"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/builder-client/builder-email-template.ts
var builder_email_template_exports = {};
__export(builder_email_template_exports, {
  BUILDER_EMAIL_CONFIRMATION_URL_TOKEN: () => BUILDER_EMAIL_CONFIRMATION_URL_TOKEN,
  BUILDER_EMAIL_FUNCTIONS: () => BUILDER_EMAIL_FUNCTIONS,
  BUILDER_EMAIL_MERGE_TOKENS: () => BUILDER_EMAIL_MERGE_TOKENS,
  getDefaultEmailTemplateName: () => getDefaultEmailTemplateName,
  getEmailFunctionLabel: () => getEmailFunctionLabel,
  normalizeEmailFunction: () => normalizeEmailFunction,
  resolveEmailMergeTokensForPreview: () => resolveEmailMergeTokensForPreview
});
module.exports = __toCommonJS(builder_email_template_exports);
var BUILDER_EMAIL_FUNCTIONS = [
  { value: "signup_confirmation", label: "Signup Confirmation" },
  { value: "password_reset", label: "Password Reset" },
  { value: "admin_invite", label: "Admin Invite" },
  { value: "magic_link", label: "Magic Link" }
];
function normalizeEmailFunction(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (BUILDER_EMAIL_FUNCTIONS.some((entry) => entry.value === text)) {
    return text;
  }
  return "";
}
function getEmailFunctionLabel(value) {
  if (!value) {
    return "\u2014";
  }
  return BUILDER_EMAIL_FUNCTIONS.find((entry) => entry.value === value)?.label ?? value;
}
function getDefaultEmailTemplateName(value) {
  const label = getEmailFunctionLabel(value);
  if (!label || label === "\u2014") {
    return "Untitled Email Template";
  }
  return `${label} Email`;
}
var BUILDER_EMAIL_MERGE_TOKENS = [
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
];
var BUILDER_EMAIL_CONFIRMATION_URL_TOKEN = "{{ .ConfirmationURL }}";
function resolveEmailMergeTokensForPreview(value) {
  return String(value ?? "").replace(/\{\{\s*\.ConfirmationURL\s*\}\}/gi, "https://example.supabase.co/auth/v1/verify?token=example&type=signup&redirect_to=https://normie.one/portal/auth/callback").replace(/\{\{\s*\.Email\s*\}\}/gi, "player@example.com").replace(/\{\{\s*\.SiteURL\s*\}\}/gi, "https://normie.one");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUILDER_EMAIL_CONFIRMATION_URL_TOKEN,
  BUILDER_EMAIL_FUNCTIONS,
  BUILDER_EMAIL_MERGE_TOKENS,
  getDefaultEmailTemplateName,
  getEmailFunctionLabel,
  normalizeEmailFunction,
  resolveEmailMergeTokensForPreview
});
