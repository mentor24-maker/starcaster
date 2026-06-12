"use client";

import { useEffect, useMemo, useState } from "react";
import type { CurrentPoll } from "@/src/site/home/types";

export type SocialSharePlatformId =
  | "x"
  | "facebook"
  | "bluesky"
  | "reddit"
  | "linkedin"
  | "telegram"
  | "tiktok"
  | "instagram";

export type SocialSharePlatform = {
  id: SocialSharePlatformId;
  label: string;
  color: string;
  supportsText: boolean;
  supportsUrl: boolean;
  defaultEnabled: boolean;
};

export const SOCIAL_SHARE_PLATFORMS: SocialSharePlatform[] = [
  { id: "x", label: "X", color: "#000000", supportsText: true, supportsUrl: true, defaultEnabled: true },
  { id: "facebook", label: "Facebook", color: "#1877f2", supportsText: false, supportsUrl: true, defaultEnabled: true },
  { id: "bluesky", label: "Bluesky", color: "#0085ff", supportsText: true, supportsUrl: true, defaultEnabled: true },
  { id: "reddit", label: "Reddit", color: "#ff4500", supportsText: true, supportsUrl: true, defaultEnabled: true },
  { id: "linkedin", label: "LinkedIn", color: "#0a66c2", supportsText: false, supportsUrl: true, defaultEnabled: false },
  { id: "telegram", label: "Telegram", color: "#229ed9", supportsText: true, supportsUrl: true, defaultEnabled: false },
  { id: "tiktok", label: "TikTok", color: "#010101", supportsText: false, supportsUrl: true, defaultEnabled: false },
  { id: "instagram", label: "Instagram", color: "#e1306c", supportsText: false, supportsUrl: false, defaultEnabled: false }
];

const DEFAULT_SHARE_URL = "https://normie.one";
export const DEFAULT_SHARE_TEMPLATE = 'I just answered: "{pollQuestion}" What would you pick? {url}';

function getNumberSetting(settings: Record<string, string>, key: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(settings[key] || "", 10);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

function getPlatform(settings: Record<string, string>, id: SocialSharePlatformId) {
  return SOCIAL_SHARE_PLATFORMS.find((platform) => platform.id === id) ?? SOCIAL_SHARE_PLATFORMS[0];
}

export function getSocialSharePlatformEnabled(settings: Record<string, string>, id: SocialSharePlatformId) {
  const platform = getPlatform(settings, id);
  const value = settings[`share${id}Enabled`];

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return platform.defaultEnabled;
}

export function getEnabledSocialSharePlatforms(settings: Record<string, string>) {
  return SOCIAL_SHARE_PLATFORMS.filter((platform) => getSocialSharePlatformEnabled(settings, platform.id));
}

function getPlatformTemplate(settings: Record<string, string>, id: SocialSharePlatformId) {
  return settings[`share${id}Template`] || settings.shareTemplate || DEFAULT_SHARE_TEMPLATE;
}

function getShareOrigin(currentUrl: string) {
  try {
    return new URL(currentUrl || DEFAULT_SHARE_URL).origin;
  } catch {
    return DEFAULT_SHARE_URL;
  }
}

function getShareUrl(settings: Record<string, string>, currentUrl: string, poll: CurrentPoll | null | undefined) {
  if (settings.shareUrl) {
    return settings.shareUrl;
  }

  if (poll?.id) {
    return `${getShareOrigin(currentUrl)}/polls/share/${poll.id}`;
  }

  return currentUrl || DEFAULT_SHARE_URL;
}

function getQuestion(settings: Record<string, string>, poll: CurrentPoll | null | undefined) {
  return poll?.question || settings.shareFallbackQuestion || "Would you rather?";
}

function buildShareText({
  settings,
  platformId,
  poll,
  url
}: {
  settings: Record<string, string>;
  platformId: SocialSharePlatformId;
  poll?: CurrentPoll | null;
  url: string;
}) {
  const question = getQuestion(settings, poll);
  return getPlatformTemplate(settings, platformId)
    .replaceAll("{pollQuestion}", question)
    .replaceAll("{question}", question)
    .replaceAll("{url}", url)
    .replaceAll("{siteName}", settings.shareSiteName || "Normie");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripShareUrlFromText(text: string, url: string) {
  if (!url) {
    return text;
  }

  return text
    .replace(new RegExp(escapeRegExp(url), "g"), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function formatTweetText(text: string, url: string) {
  const message = stripShareUrlFromText(text, url);

  return message ? `${message}\n\n` : "";
}

function normalizeHashTags(value: string | undefined) {
  return (value || "")
    .split(/[,\s]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)
    .join(",");
}

export function buildSocialShareUrl({
  settings,
  platformId,
  poll,
  currentUrl
}: {
  settings: Record<string, string>;
  platformId: SocialSharePlatformId;
  poll?: CurrentPoll | null;
  currentUrl: string;
}) {
  const url = getShareUrl(settings, currentUrl, poll);
  const text = buildShareText({ settings, platformId, poll, url });
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(platformId === "x" ? formatTweetText(text, url) : text);
  const hashtags = normalizeHashTags(settings.shareHashtags);
  const via = (settings.shareVia || "").replace(/^@/, "").trim();

  switch (platformId) {
    case "x":
      return [
        `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
        hashtags ? `hashtags=${encodeURIComponent(hashtags)}` : "",
        via ? `via=${encodeURIComponent(via)}` : ""
      ]
        .filter(Boolean)
        .join("&");
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "bluesky":
      return `https://bsky.app/intent/compose?text=${encodedText}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`;
    case "tiktok":
      return `https://www.tiktok.com/share?url=${encodedUrl}`;
    case "instagram":
      return settings.shareInstagramUrl || "https://www.instagram.com/";
    default:
      return url;
  }
}

function PlatformIcon({ id }: { id: SocialSharePlatformId }) {
  if (id === "facebook") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
      </svg>
    );
  }

  if (id === "x") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }

  if (id === "bluesky") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
        <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 01-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" />
      </svg>
    );
  }

  if (id === "reddit") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701z" />
      </svg>
    );
  }

  if (id === "linkedin") {
    return <span aria-hidden="true">in</span>;
  }

  if (id === "telegram") {
    return <span aria-hidden="true">T</span>;
  }

  if (id === "tiktok") {
    return <span aria-hidden="true">♪</span>;
  }

  return <span aria-hidden="true">◎</span>;
}

export function SocialShareBar({
  settings,
  poll,
  preview = false
}: {
  settings: Record<string, string>;
  poll?: CurrentPoll | null;
  preview?: boolean;
}) {
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_SHARE_URL);
  const enabledPlatforms = useMemo(() => getEnabledSocialSharePlatforms(settings), [settings]);
  const label = settings.shareLabel || "Share this poll";
  const labelSize = getNumberSetting(settings, "shareLabelSize", 14, 8, 64);
  const iconSize = getNumberSetting(settings, "shareIconSize", 36, 20, 120);
  const glyphSize = getNumberSetting(settings, "shareGlyphSize", Math.round(iconSize * 0.56), 10, 96);
  const iconGap = getNumberSetting(settings, "shareIconGap", 12, 0, 64);
  const iconBackground = settings.shareIconBackground || "#ffffff";

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.href);
    }
  }, []);

  if (enabledPlatforms.length === 0) {
    return preview ? <div className="builder-module-preview-placeholder">Enable at least one share platform</div> : null;
  }

  return (
    <div className="poll-share-bar">
      {label ? <span className="poll-share-label" style={{ fontSize: `${labelSize}px` }}>{label}</span> : null}
      <div className="poll-share-icons" style={{ gap: `${iconGap}px` }}>
        {enabledPlatforms.map((platform) => (
          <a
            key={platform.id}
            href={buildSocialShareUrl({ settings, platformId: platform.id, poll, currentUrl })}
            target="_blank"
            rel="noopener noreferrer"
            className="poll-share-icon"
            title={`Share on ${platform.label}`}
            aria-label={`Share on ${platform.label}`}
            style={{
              color: settings[`share${platform.id}Color`] || platform.color,
              width: `${iconSize}px`,
              height: `${iconSize}px`,
              fontSize: `${glyphSize}px`,
              background: iconBackground
            }}
          >
            <PlatformIcon id={platform.id} />
          </a>
        ))}
      </div>
    </div>
  );
}
