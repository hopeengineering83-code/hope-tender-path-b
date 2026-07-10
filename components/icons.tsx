// Inline SVG icon set.
//
// The app previously rendered action-button icons as raw Unicode dingbat
// glyphs (✦ ✓ → ↓ ⚡ ▶ ↻ ⊘). Those code points are not present in every
// system font, so on many browsers/OS/font-stack combinations they render as
// blank space or "tofu" boxes — which is why AI Analyze / Validate / Approve
// icons looked "missing". Inline SVGs render identically everywhere because
// they do not depend on font glyph coverage.
//
// Every icon inherits the current text color (`stroke="currentColor"`) and
// scales with font size (1em), so they drop into existing buttons without
// layout changes.

import type { SVGProps } from "react";
import * as React from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function base(props: IconProps) {
  const { title, className, ...rest } = props;
  return {
    className: `inline-block shrink-0 ${className ?? ""}`.trim(),
    width: "1em",
    height: "1em",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
    focusable: false,
    ...rest,
  };
}

/** Sparkles — AI actions (AI Analyze, AI Proposal). Replaces ✦ */
export function SparklesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 3l1.8 4.6L18.4 9.4 13.8 11.2 12 15.8 10.2 11.2 5.6 9.4 10.2 7.6 12 3z" />
      <path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
    </svg>
  );
}

/** Lightning bolt — Generate Docs. Replaces ⚡ */
export function BoltIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13l0-8z" />
    </svg>
  );
}

/** Check mark — Validate / allowed actions. Replaces ✓ */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Cross — failed / not-ok status. Replaces ✗ */
export function CrossIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

/** Right arrow — status advance / intake. Replaces → */
export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Download (tray + down arrow) — ZIP / Proposal / Requirements. Replaces ↓ */
export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** Play / execute — Recovery Command Center Execute. Replaces ▶ */
export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M7 5l11 7-11 7V5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Circular refresh — re-check / refresh. Replaces ↻ */
export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Chevron — disclosure / expand-collapse. Rotate via className. Replaces ▼ ▲ ⌄ */
export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Hourglass / clock — cooldown / waiting. Replaces ⏳ */
export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Ban / blocked — blocked actions. Replaces ⊘ */
export function BanIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

/** Warning triangle — warnings. Replaces ⚠ */
export function WarningIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 3l9.5 16.5H2.5L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

/** Circle check — success / passed. */
export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

/** Circle alert — warning / partial. */
export function AlertCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16v.01" />
    </svg>
  );
}

/** Lock — blocked / locked. */
export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Lightbulb — tip / recommendation. */
export function LightbulbIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 18h6M12 2c-3.9 0-7 3.1-7 7 0 2.3.9 4.3 2.4 5.8.4.4.6.9.6 1.5v.4c0 .8.6 1.3 1.3 1.3h5.4c.7 0 1.3-.6 1.3-1.3v-.4c0-.6.2-1.1.6-1.5C18.1 13.3 19 11.3 19 9c0-3.9-3.1-7-7-7z" />
    </svg>
  );
}

/** Info circle — information. */
export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.01M12 12v4" />
    </svg>
  );
}

/** Upload (tray + up arrow) — attach / upload. */
export function UploadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 19V7M8 11l4-4 4 4" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** Share (node + arrows) — share tender. Replaces ↗ */
export function ShareIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

/** Document / list — Build Plan, submission plan, document-type rows. */
export function DocumentIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 2h8l6 6v14H6z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6M9 9h2" />
    </svg>
  );
}

/** Paperclip — attach existing file. */
export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M21 11.5l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
    </svg>
  );
}

/** Clipboard with check — validate / review complete. */
export function ClipboardCheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="6" y="4" width="12" height="18" rx="2" />
      <path d="M9 4V2h6v2" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  );
}

/** Settings / gear — configure. */
export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
