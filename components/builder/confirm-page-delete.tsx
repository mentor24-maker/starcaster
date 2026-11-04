"use client";

/**
 * Ask before deleting pages — naming every link that would be left pointing
 * at nothing (task 86bcxn69z).
 *
 * ONE function for both Pages screens: Builder › Pages, which is the frozen
 * vanilla table in public/js/builder.js (it reaches this as
 * `window.PageDeleteReact.confirm`, see builder-react-entry.tsx), and the
 * React page list inside the Builder editor. Two copies of "ask before
 * deleting" would be two answers.
 *
 *   nothing links to the pages → the same `window.confirm(question)` as always
 *   something does             → BuilderPageDeleteModal, "Delete Anyway" / Cancel
 *   the check itself failed    → `window.confirm`, saying it could not check —
 *                                never read as "nothing links here"
 *
 * Resolves true only when the operator chose to delete.
 */

import { createRoot } from "react-dom/client";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { BuilderPageDeleteModal, type PageDeleteLinks } from "./builder-page-delete-modal";

type InboundAnswer =
  | { ok: true; pages: PageDeleteLinks[] }
  | { ok: false; error: string };

export async function fetchPageDeleteLinks(
  pageIds: string[],
  nameOf: (pageId: string) => string
): Promise<InboundAnswer> {
  try {
    const response = await builderAdminFetch("/api/admin/page-links/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds })
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: { pages?: Record<string, Array<{ text: string }>> }; error?: { message?: string } | string }
      | null;
    if (!response.ok || !body?.ok) {
      const error = body?.error;
      return { ok: false, error: (typeof error === "string" ? error : error?.message) || `the server answered ${response.status}` };
    }
    const byPage = body.data?.pages ?? {};
    return {
      ok: true,
      pages: pageIds
        .filter((id) => (byPage[id] ?? []).length > 0)
        .map((id) => ({ pageId: id, pageName: nameOf(id) || `Page ${id}`, links: (byPage[id] ?? []).map((link) => link.text) }))
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function askWithModal(pages: PageDeleteLinks[], deleteCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const answer = (confirmed: boolean) => {
      root.unmount();
      host.remove();
      resolve(confirmed);
    };
    root.render(
      <BuilderPageDeleteModal
        pages={pages}
        deleteCount={deleteCount}
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    );
  });
}

export async function confirmPageDelete(
  pageIds: string[],
  question: string,
  nameOf: (pageId: string) => string
): Promise<boolean> {
  const ids = pageIds.map((id) => String(id));
  if (!ids.length) return false;
  const answer = await fetchPageDeleteLinks(ids, nameOf);
  if (!answer.ok) {
    const them = ids.length === 1 ? "it" : "them";
    return window.confirm(`${question}\n\nCould not check whether any buttons, menus or forms link to ${them} (${answer.error}).`);
  }
  if (!answer.pages.length) return window.confirm(question);
  return askWithModal(answer.pages, ids.length);
}
