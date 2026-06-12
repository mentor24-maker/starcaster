import type { ReactNode } from "react";

type RichTextToolbarIconProps = {
  className?: string;
};

function IconShell({ className, children }: RichTextToolbarIconProps & { children: ReactNode }) {
  return (
    <span aria-hidden="true" className={className ? `builder-rich-text-toolbar-glyph ${className}` : "builder-rich-text-toolbar-glyph"}>
      <svg fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
        {children}
      </svg>
    </span>
  );
}

export function RichTextBulletListIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <circle cx="3.25" cy="3.25" fill="currentColor" r="1.25" />
      <circle cx="3.25" cy="8" fill="currentColor" r="1.25" />
      <circle cx="3.25" cy="12.75" fill="currentColor" r="1.25" />
      <path d="M6.5 3.25h6.25M6.5 8h6.25M6.5 12.75h6.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </IconShell>
  );
}

export function RichTextOrderedListIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path
        d="M2.75 4.1h1.1c.45 0 .75.22.75.55 0 .28-.15.47-.4.57l.45.68H3.55V4.1Zm.55.82c.24 0 .38-.11.38-.28 0-.18-.15-.3-.38-.3H3.55v.58h.75ZM2.75 7.35h1.25c.5 0 .82.27.82.68 0 .29-.14.5-.38.6l.42.62H3.55V7.35Zm.58.84c.25 0 .4-.12.4-.3 0-.19-.16-.32-.4-.32H3.55v.62h.68ZM2.75 10.6h1.3c.56 0 .9.29.9.75 0 .33-.16.56-.44.67l.5.73H3.55v-2.15Zm.64.95c.27 0 .44-.13.44-.33 0-.21-.17-.35-.44-.35H3.55v.68h.74Z"
        fill="currentColor"
      />
      <path d="M6.5 3.25h6.25M6.5 8h6.25M6.5 12.75h6.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </IconShell>
  );
}

export function RichTextBlockquoteIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path
        d="M3.5 4.75c0-1.45 1.05-2.5 2.45-2.5 1.2 0 2.05.75 2.05 1.85 0 1.15-.95 1.55-1.55 2.35-.45.6-.7 1.2-.7 1.95h-1.45c0-1.15.35-1.85 1-2.55.55-.6.85-1 .85-1.65 0-.55-.4-.95-1-.95-.65 0-1.15.5-1.15 1.2H3.5Zm5.5 0c0-1.45 1.05-2.5 2.45-2.5 1.2 0 2.05.75 2.05 1.85 0 1.15-.95 1.55-1.55 2.35-.45.6-.7 1.2-.7 1.95H10.4c0-1.15.35-1.85 1-2.55.55-.6.85-1 .85-1.65 0-.55-.4-.95-1-.95-.65 0-1.15.5-1.15 1.2H9Z"
        fill="currentColor"
      />
    </IconShell>
  );
}

export function RichTextAlignLeftIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path d="M2.5 3.5h11M2.5 8h7.5M2.5 12.5h9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </IconShell>
  );
}

export function RichTextAlignCenterIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path d="M2.5 3.5h11M4.25 8h7.5M3.25 12.5h9.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </IconShell>
  );
}

export function RichTextAlignRightIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path d="M2.5 3.5h11M6.5 8h7.5M5.5 12.5h9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </IconShell>
  );
}

export function RichTextCodeIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path
        d="M5.35 5 2.9 8l2.45 3M10.65 5 13.1 8l-2.45 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </IconShell>
  );
}

export function RichTextClearIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </IconShell>
  );
}

export function RichTextShadowIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path
        d="M4.75 10.25h5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeOpacity="0.45"
        strokeWidth="1.2"
      />
      <path
        d="M5.25 6.75h5.5"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="0.35"
      />
    </IconShell>
  );
}

export function RichTextOutlineIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <circle cx="8" cy="8" r="3.35" stroke="currentColor" strokeWidth="1.35" />
    </IconShell>
  );
}

export function RichTextLinkIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <path
        d="M6.35 9.65a2.35 2.35 0 0 0 3.32 0l1.48-1.48a2.35 2.35 0 1 0-3.32-3.32L6.9 5.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path
        d="M9.65 6.35a2.35 2.35 0 0 0-3.32 0L4.85 7.83a2.35 2.35 0 1 0 3.32 3.32l1.03-1.03"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </IconShell>
  );
}

export function RichTextImageIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <rect height="7.5" rx="1.2" stroke="currentColor" strokeWidth="1.25" width="9.5" x="3.25" y="4.25" />
      <path
        d="M4.5 10.25 6.35 8.1l1.55 1.55L10.1 7.55 11.5 9.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <circle cx="6.1" cy="6.35" fill="currentColor" r="0.85" />
    </IconShell>
  );
}

export function RichTextEmojiIcon(props: RichTextToolbarIconProps) {
  return (
    <IconShell {...props}>
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="6.15" cy="7.1" fill="currentColor" r="0.75" />
      <circle cx="9.85" cy="7.1" fill="currentColor" r="0.75" />
      <path
        d="M6.1 10.1c.55.75 1.35 1.15 1.9 1.15s1.35-.4 1.9-1.15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.15"
      />
    </IconShell>
  );
}
