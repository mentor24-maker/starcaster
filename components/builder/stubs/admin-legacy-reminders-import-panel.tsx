/**
 * Stub for normie's legacy reminders import panel
 * (BUILDER_CAPABILITIES.legacyRemindersImport is off in starcaster).
 */
import type { BuilderPageRecord } from "@/lib/builder-template";

export function AdminLegacyRemindersImportPanel(_props: {
  pageSlug?: string;
  selectedPageId?: string;
  onPageImported?: (page: BuilderPageRecord) => void;
  [key: string]: unknown;
}) {
  return null;
}
