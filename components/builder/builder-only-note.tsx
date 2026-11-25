"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * A note addressed to whoever is BUILDING the page — "set a Form ID in module
 * settings", "add tags in the Messaging section", "add posts in module
 * settings".
 *
 * It renders NOTHING on a live published page. A visitor has no module
 * settings, no Messaging section and no way to act on any of it, so the note
 * is at best noise and at worst reads as the site being broken. Dane reported
 * exactly that on 2026-09-03: "No tags found. Add tags in the Messaging
 * section." printed under a blog post on delraytennis.starcaster.pro, from a
 * module that reads the MESSAGING tag list and can never find a blog tag in
 * it. Six of these were shipping to visitors when he asked.
 *
 * Every builder-facing instruction goes through here, and
 * check_conventions.cjs fails the commit on a new one that does not — this
 * shape had already been fixed twice in two days (PR #576) and came back.
 */
export function BuilderOnlyNote({
  liveSite = false,
  className,
  style,
  children,
}: {
  liveSite?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (liveSite) return null;
  /*
   * A legible default, because this renders inside ARBITRARY tenant themes.
   * The two Messaging notes were pale grey italic with no background: perfectly
   * readable on white, and nearly invisible over the photo Delray uses behind
   * its pages — a note nobody can read is the same as no note (seen 2026-09-03).
   * A caller may still override any of it.
   */
  const base: CSSProperties = {
    padding: "0.75rem 1rem",
    border: "1px dashed #d1d5db",
    borderRadius: 6,
    background: "#f9fafb",
    color: "#4b5563",
    fontSize: "0.8125rem",
    lineHeight: 1.5,
  };
  return (
    <div
      className={`builder-only-note${className ? ` ${className}` : ""}`}
      style={{ ...base, ...style }}
    >
      {children}
    </div>
  );
}
