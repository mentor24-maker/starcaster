import type { CSSProperties } from "react";
import {
  getBuilderBackgroundStyle,
  getLayoutColumns,
  type BackgroundSettings,
  type BuilderTemplateModule,
  type BuilderTemplateRecord,
  type BuilderTemplateSection
} from "@/lib/builder-template";
import { formatEmailRichTextContent } from "@/lib/email-rich-text";
import {
  getButtonModuleStyle,
  getHeadingModuleStyle,
  getModuleAlignment,
  getModuleMarginStyle,
  getSectionMarginStyle
} from "@/components/builder/builder-utils";
import { applyAuthEmailMergeFields, type AuthEmailMergeContext } from "@/lib/supabase-auth-email";
import type { BuilderEmailFunction } from "@/lib/builder-email-template";
import { toAbsoluteSiteUrl } from "@/lib/site-url";

function cssPropertiesToInline(style: CSSProperties | undefined): string {
  if (!style) {
    return "";
  }

  return Object.entries(style)
    .map(([key, value]) => {
      if (value == null || value === "") {
        return null;
      }

      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      return `${cssKey}:${String(value)}`;
    })
    .filter(Boolean)
    .join(";");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapBackgroundStyle(background: BackgroundSettings | undefined): string {
  return cssPropertiesToInline(getBuilderBackgroundStyle(background));
}

function renderEmailModule(module: BuilderTemplateModule): string {
  if (
    module.type === "navigation" ||
    module.type === "contact-form" ||
    module.type === "player-portal" ||
    module.type === "current-poll" ||
    module.type === "previous-results" ||
    module.type === "confetti" ||
    module.type === "headline-rotator" ||
    module.type === "poll-category-list" ||
    module.type === "slider" ||
    module.type === "social" ||
    module.type === "social-share" ||
    module.type === "table" ||
    module.type === "code" ||
    module.type === "merch" ||
    module.type === "video" ||
    module.type === "floating-image"
  ) {
    return "";
  }

  const marginStyle = cssPropertiesToInline(getModuleMarginStyle(module.settings));
  const alignment = getModuleAlignment(module.settings);
  const alignAttr = alignment === "center" ? "center" : alignment === "right" ? "right" : "left";

  if (module.type === "heading") {
    const level = module.settings.level || "h2";
    const style = cssPropertiesToInline(getHeadingModuleStyle(module.settings));

    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><${level} style="margin:0;font-family:Arial,Helvetica,sans-serif;${style}">${escapeHtml(module.text || "")}</${level}></td></tr>`;
  }

  if (module.type === "text") {
    const html = formatEmailRichTextContent(module.text);

    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#3d5a73;${marginStyle}">${html}</td></tr>`;
  }

  if (module.type === "speech-bubble") {
    const html = formatEmailRichTextContent(module.text);
    const backgroundColor = module.settings.backgroundColor || "#ffffff";
    const borderColor = module.settings.borderColor || "#9ed4ee";
    const borderThickness = Math.max(0, Number.parseInt(module.settings.borderThickness ?? "2", 10) || 2);
    const borderRadius = Math.max(0, Number.parseInt(module.settings.borderRadius ?? "40", 10) || 40);
    const textColor = module.settings.textColor || "#18324a";

    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><div style="display:inline-block;max-width:520px;padding:18px 22px;border:${borderThickness}px solid ${borderColor};border-radius:${borderRadius}px;background:${backgroundColor};color:${textColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;">${html}</div></td></tr>`;
  }

  if (module.type === "quote") {
    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><blockquote style="margin:0;padding:12px 16px;border-left:4px solid #12bdf4;color:#18324a;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(module.text || "")}</blockquote></td></tr>`;
  }

  if (module.type === "image") {
    const url = toAbsoluteSiteUrl(module.settings.url);

    if (!url) {
      return "";
    }

    const size = Number.parseInt(module.settings.size ?? "100", 10);
    const width = Number.isFinite(size) ? Math.min(Math.max(size, 10), 100) : 100;

    return `<tr><td align="${alignAttr}" style="padding:0 40px 12px;${marginStyle}"><img src="${escapeHtml(url)}" alt="${escapeHtml(module.settings.alt || module.name || "Image")}" width="${Math.round(600 * (width / 100))}" style="display:block;max-width:100%;height:auto;border:0;" /></td></tr>`;
  }

  if (module.type === "button") {
    const label = escapeHtml(module.text || "Continue");
    const href = escapeHtml(module.settings.href || "{{ .ConfirmationURL }}");
    const style = cssPropertiesToInline(getButtonModuleStyle(module.settings));

    return `<tr><td align="${alignAttr}" style="padding:12px 40px 24px;${marginStyle}"><a href="${href}" style="display:inline-block;text-decoration:none;font-family:Arial,Helvetica,sans-serif;${style}">${label}</a></td></tr>`;
  }

  return "";
}

function renderEmailSection(section: BuilderTemplateSection): string {
  const sectionStyle = cssPropertiesToInline(getSectionMarginStyle(section));
  const columns = getLayoutColumns(section.layout);
  const modules = columns.flatMap((column) =>
    section.modules.filter((module) => module.column === column)
  );

  const renderedModules = modules.map((module) => renderEmailModule(module)).join("");

  if (!renderedModules) {
    return "";
  }

  const sectionBackground = wrapBackgroundStyle(section.background);

  return `<tr><td style="${sectionStyle}${sectionBackground ? `;${sectionBackground}` : ""}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${renderedModules}</table></td></tr>`;
}

export function renderBuilderEmailHtml(
  template: BuilderTemplateRecord,
  mergeContext?: AuthEmailMergeContext
): string {
  const outerBackground = wrapBackgroundStyle(template.pageBackground);
  const bodyBackground =
    outerBackground ||
    "background:linear-gradient(160deg,#fff8dc 0%,#e8f4fc 45%,#fde8f2 100%);background-color:#e8f4fc;";
  const sectionsHtml = template.layoutSections.map((section) => renderEmailSection(section)).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(template.name || "StarCaster email")}</title>
  </head>
  <body style="margin:0;padding:0;${bodyBackground}">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="min-width:100%;${bodyBackground}">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:50px;border:1px solid #d9e4ef;overflow:hidden;box-shadow:0 18px 48px rgba(24,50,74,0.12);">
            ${sectionsHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return mergeContext ? applyAuthEmailMergeFields(html, mergeContext) : html;
}

const AUTH_EMAIL_SHELL_OPEN = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin: 0; padding: 0; background-color: #e8f4fc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: linear-gradient(160deg, #fff8dc 0%, #e8f4fc 45%, #fde8f2 100%); min-width: 100%;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 50px; border: 1px solid #d9e4ef; overflow: hidden; box-shadow: 0 18px 48px rgba(24, 50, 74, 0.12);">
            <tr>
              <td align="center" style="padding: 32px 36px 20px; background-color: #ffffff;">
                <img src="{{ .SiteURL }}/api/brand/logo" alt="StarCaster" width="200" height="62" style="display: block; width: 200px; max-width: 100%; height: auto; border: 0; margin: 0 auto;" />
              </td>
            </tr>`;

const AUTH_EMAIL_SHELL_CLOSE = `
            <tr>
              <td style="padding: 0 40px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0 0 10px; font-size: 13px; line-height: 1.5; color: #6b8499;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; word-break: break-all;">
                  <a href="{{ .ConfirmationURL }}" style="color: #12bdf4;">{{ .ConfirmationURL }}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 40px 28px; background-color: #f7fbff; border-top: 1px solid #eef4f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #6b8499; text-align: center;">
                  StarCaster · {{ .SiteURL }}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const AUTH_EMAIL_BUTTON =
  '<a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 16px 32px; background-color: #4cbb17; background-image: linear-gradient(180deg, #5fd428 0%, #4cbb17 55%, #3a9612 100%); color: #fff700; text-decoration: none; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: 800; letter-spacing: 0.02em; border-radius: 999px; border: 2px solid #2d7a0e; text-shadow: 1px 1px 0 #000000, 2px 2px 0 #000000, 3px 3px 6px rgba(0, 0, 0, 0.85); white-space: nowrap;">';

function buildAuthEmailFallbackHtml(emailFunction: BuilderEmailFunction): string {
  if (emailFunction === "password_reset") {
    return `${AUTH_EMAIL_SHELL_OPEN}
            <tr>
              <td style="padding: 8px 40px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0 0 12px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #5a7a94; font-weight: 700;">
                  Password reset
                </p>
                <h1 style="margin: 0 0 16px; font-size: 26px; line-height: 1.2; color: #18324a; font-weight: 800;">
                  Reset your password
                </h1>
                <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3d5a73;">
                  We received a request to reset the password for
                  <strong style="color: #18324a;">{{ .Email }}</strong>.
                  Use the button below to choose a new password. If you did not request this, you can ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 12px 40px 36px;">
                ${AUTH_EMAIL_BUTTON}Reset Password</a>
              </td>
            </tr>${AUTH_EMAIL_SHELL_CLOSE}`;
  }

  return `${AUTH_EMAIL_SHELL_OPEN}
            <tr>
              <td style="padding: 8px 40px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <p style="margin: 0 0 12px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #5a7a94; font-weight: 700;">
                  Player signup
                </p>
                <h1 style="margin: 0 0 16px; font-size: 26px; line-height: 1.2; color: #18324a; font-weight: 800;">
                  Welcome to StarCaster
                </h1>
                <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3d5a73;">
                  Thanks for signing up. Confirm your email address
                  <strong style="color: #18324a;">{{ .Email }}</strong> to finish creating your player account and start answering polls.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 12px 40px 36px;">
                ${AUTH_EMAIL_BUTTON}Confirm Your Email</a>
              </td>
            </tr>${AUTH_EMAIL_SHELL_CLOSE}`;
}

export function renderBuilderEmailHtmlWithFallback(
  template: BuilderTemplateRecord | null,
  mergeContext: AuthEmailMergeContext,
  emailFunction: BuilderEmailFunction = "signup_confirmation"
): string {
  if (template && template.layoutSections.length > 0) {
    return renderBuilderEmailHtml(template, mergeContext);
  }

  return applyAuthEmailMergeFields(buildAuthEmailFallbackHtml(emailFunction), mergeContext);
}
