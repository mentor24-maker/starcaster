"use client";

import { useEffect, useState } from "react";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import {
  BUILDER_PREVIEW_DEVICE_STORAGE_KEY,
  BUILDER_PREVIEW_STORAGE_KEY,
  createDefaultBackgroundSettings,
  normalizeBuilderDocument
} from "@/lib/builder-template";

type PreviewDraft = {
  name: string;
  pageBackground: ReturnType<typeof createDefaultBackgroundSettings>;
  layoutSections: ReturnType<typeof normalizeBuilderDocument>["layoutSections"];
};

export function BuilderPreviewPage() {
  const [draft, setDraft] = useState<PreviewDraft | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile" | "email">("desktop");
  const isEmailPreview = previewDevice === "email";

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(BUILDER_PREVIEW_STORAGE_KEY);
      const storedDevice = window.localStorage.getItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY);

      if (storedDevice === "mobile" || storedDevice === "desktop" || storedDevice === "email") {
        setPreviewDevice(storedDevice);
      }

      if (!rawValue) {
        return;
      }

      const parsed = JSON.parse(rawValue) as {
        name?: unknown;
        pageBackground?: unknown;
        layoutSections?: unknown;
      };
      const document = normalizeBuilderDocument(parsed);
      setDraft({
        name: String(parsed.name ?? "").trim(),
        pageBackground: document.pageBackground,
        layoutSections: document.layoutSections
      });
    } catch {
      setDraft({
        name: "",
        pageBackground: createDefaultBackgroundSettings(),
        layoutSections: []
      });
    }
  }, []);

  return (
    <main className="admin-page">
      <section className="admin-shell admin-shell-wide">
        <div className="admin-header">
          <div className="admin-brand-copy">
            <div className="page-eyebrow">Builder Preview</div>
            <h1 className="admin-title">{draft?.name || "Unsaved Template Preview"}</h1>
            <p className="page-copy admin-copy">
              {isEmailPreview
                ? "This is the 600px email pod preview for the current Builder draft."
                : "This is the fully rendered page preview for the current Builder draft."}
            </p>
          </div>
          <div className="admin-actions">
            {isEmailPreview ? (
              <span className="builder-email-preview-badge">Email · 600px</span>
            ) : (
              <div className="builder-device-toggle" role="group" aria-label="Preview device">
                <button
                  className={previewDevice === "desktop" ? "submit-button" : "secondary-button"}
                  onClick={() => {
                    setPreviewDevice("desktop");
                    window.localStorage.setItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY, "desktop");
                  }}
                  type="button"
                >
                  Browser
                </button>
                <button
                  className={previewDevice === "mobile" ? "submit-button" : "secondary-button"}
                  onClick={() => {
                    setPreviewDevice("mobile");
                    window.localStorage.setItem(BUILDER_PREVIEW_DEVICE_STORAGE_KEY, "mobile");
                  }}
                  type="button"
                >
                  Mobile
                </button>
              </div>
            )}
            <button className="secondary-button" onClick={() => window.close()} type="button">
              Close Preview
            </button>
          </div>
        </div>

        {draft && draft.layoutSections.length > 0 ? (
          <div className={`builder-preview-device-frame builder-preview-device-${previewDevice}`}>
            {isEmailPreview ? (
              <div className="builder-email-workspace-pod builder-email-preview-pod">
                <BuilderTemplatePreview
                  emailPreview
                  layoutSections={draft.layoutSections}
                  pageBackground={draft.pageBackground}
                  showShell={false}
                />
              </div>
            ) : (
              <BuilderTemplatePreview
                layoutSections={draft.layoutSections}
                pageBackground={draft.pageBackground}
                previewMode
                showShell={false}
              />
            )}
          </div>
        ) : (
          <section className="admin-section">
            <div className="panel-label">Preview</div>
            <h2>No preview content found</h2>
            <p className="page-copy admin-copy">
              Open this page from the Builder using the `Preview` button so the current draft can be loaded here.
            </p>
          </section>
        )}
      </section>
    </main>
  );
}
