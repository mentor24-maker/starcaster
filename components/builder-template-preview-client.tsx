"use client";

import dynamic from "next/dynamic";
import type { BackgroundSettings, BuilderTemplateSection } from "@/lib/builder-template";

type BuilderTemplatePreviewClientProps = {
  layoutSections: BuilderTemplateSection[];
  pageBackground: BackgroundSettings;
  showShell?: boolean;
};

const BuilderTemplatePreviewLazy = dynamic(
  () =>
    import("@/components/builder-template-preview").then((module) => ({
      default: module.BuilderTemplatePreview
    })),
  {
    ssr: false,
    loading: () => <div className="builder-preview-loading" aria-busy="true" aria-label="Loading page content" />
  }
);

export function BuilderTemplatePreviewClient(props: BuilderTemplatePreviewClientProps) {
  return <BuilderTemplatePreviewLazy {...props} />;
}
