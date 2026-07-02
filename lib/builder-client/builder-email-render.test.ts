import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, createEmptyModule, createEmptySection } from "@/lib/builder-template";
import type { BuilderTemplateRecord } from "@/lib/builder-template";
import { renderBuilderEmailHtml, renderBuilderEmailHtmlWithFallback } from "@/lib/builder-email-render";
import { applyAuthEmailMergeFields } from "@/lib/supabase-auth-email";

describe("renderBuilderEmailHtml", () => {
  it("renders button href merge tokens and replaces them at send time", () => {
    const section = createEmptySection("single");
    section.modules = [
      {
        ...createEmptyModule("button", "main"),
        text: "Confirm Your Email",
        settings: {
          ...createEmptyModule("button", "main").settings,
          href: "{{ .ConfirmationURL }}",
          buttonColor: "#4cbb17",
          textColor: "#fff700"
        }
      }
    ];

    const template: BuilderTemplateRecord = {
      id: "template-1",
      name: "Signup Confirmation Email",
      templateKind: "email",
      emailFunction: "signup_confirmation",
      pageBackground: createDefaultBackgroundSettings(),
      layoutSections: [section],
      createdAt: "",
      updatedAt: ""
    };

    const html = renderBuilderEmailHtml(template, {
      confirmationUrl: "https://example.supabase.co/auth/v1/verify?token=abc&type=signup",
      email: "player@example.com",
      siteUrl: "https://normie.one"
    });

    expect(html).toContain("Confirm Your Email");
    expect(html).toContain("https://example.supabase.co/auth/v1/verify?token=abc&type=signup");
    expect(html).not.toContain("{{ .ConfirmationURL }}");
  });

  it("renders a styled password reset fallback when no builder template exists", () => {
    const html = renderBuilderEmailHtmlWithFallback(
      null,
      {
        confirmationUrl: "https://example.supabase.co/auth/v1/verify?token=abc&type=recovery",
        email: "player@example.com",
        siteUrl: "https://normie.one"
      },
      "password_reset"
    );

    expect(html).toContain("Reset your password");
    expect(html).toContain("Reset Password");
    expect(html).toContain("https://example.supabase.co/auth/v1/verify?token=abc&type=recovery");
    expect(html).toContain("/api/brand/logo");
    expect(html).not.toContain("{{ .ConfirmationURL }}");
  });
});

describe("applyAuthEmailMergeFields", () => {
  it("replaces Supabase merge tokens", () => {
    const html = applyAuthEmailMergeFields(
      "<a href=\"{{ .ConfirmationURL }}\">{{ .Email }}</a> {{ .SiteURL }}",
      {
        confirmationUrl: "https://confirm.test/link",
        email: "player@example.com",
        siteUrl: "https://normie.one"
      }
    );

    expect(html).toContain("https://confirm.test/link");
    expect(html).toContain("player@example.com");
    expect(html).toContain("https://normie.one");
  });
});
