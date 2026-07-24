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

/** Chevron up — collapse / show fewer. Replaces ▲ */
export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

/** Chevron left — previous. Replaces ◀ */
export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/** Chevron right — next. Replaces ▶ */
export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Hollow circle — not yet run / not started. Replaces ○ */
export function CircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="8" />
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

/** Horizontal dash — explicitly not applicable / no value.
 *  Used by the canonical readiness model for the NOT_APPLICABLE module state
 *  so every state uses an inline SVG icon (no Unicode glyph dependency). */
export function DashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 12h12" />
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

/** Link / chain — link evidence, match evidence. */
export function LinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Code / brackets — diagnostics, JSON, technical detail. */
export function CodeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  );
}

/** List / bullet list — submission plan items, requirement lists. */
export function ListIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** Document with bolt — generate document action. */
export function DocumentGenerateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 2h8l6 6v14H6z" />
      <path d="M14 2v6h6" />
      <path d="M13 11l-3 4h3l-1 4 3-4h-3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Hourglass / waiting — pending, waiting on prior step. */
export function WaitingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 2h12M6 22h12" />
      <path d="M6 2v4c0 3 2 5 6 6 4-1 6-3 6-6V2" />
      <path d="M6 22v-4c0-3 2-5 6-6 4 1 6 3 6 6v4" />
    </svg>
  );
}

/** Search / magnifying glass — search, inspect, find. */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

// ─── Primary navigation icons ───────────────────────────────────────────────
// The main sidebar previously rendered its 17 nav items as raw emoji
// characters (🏠 📋 🕘 etc). Emoji rendering depends entirely on the
// *viewer's* OS/browser having a full-color emoji font installed — it is a
// client-side concern, not something a production deploy can fix server-side.
// Environments without one (many headless browsers, screenshot/automation
// tools, and some desktop Linux setups) show blank "tofu" boxes for every
// single nav item, on every single page. Same root cause already documented
// above for the dingbat action icons; these are the same failure mode.

/** House — dashboard overview / home. */
export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

/** Calendar — deadlines, dates. */
export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** Database / vault — company knowledge store. */
export function DatabaseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5" />
      <path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12" />
    </svg>
  );
}

/** Trending line — readiness / progress over time. */
export function TrendingUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 6h6v6" />
    </svg>
  );
}

/** Picture / image frame — brand assets. */
export function ImageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5.5-5.5a2 2 0 0 0-2.83 0L3 20" />
    </svg>
  );
}

/** Brain — AI-driven analysis. */
export function BrainIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 2.8V13a3 3 0 0 0 2 2.8V17a3 3 0 0 0 3 3" />
      <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 2.8V13a3 3 0 0 1-2 2.8V17a3 3 0 0 1-3 3" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}

/** Puzzle piece — matching. */
export function PuzzleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 4h4v2.2a1.8 1.8 0 0 0 3 1.3 1.8 1.8 0 0 1 3 1.3V13h-2.2a1.8 1.8 0 0 0 0 3.6H19v4h-4a1.8 1.8 0 0 0-3.6 0V20H7v-4.2a1.8 1.8 0 0 1-1.3-3 1.8 1.8 0 0 0-1.3-3H2V5.6A1.6 1.6 0 0 1 3.6 4H9z" />
    </svg>
  );
}

/** Shield — compliance. */
export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" />
    </svg>
  );
}

/** Package box — export bundle. */
export function PackageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 8l9-5 9 5-9 5-9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

/** Bar chart — analytics. */
export function BarChartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

/** Two people — user management. */
export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h4a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M16.5 5.3a3.2 3.2 0 0 1 0 6.1" />
      <path d="M21.5 20v-1.5a4.5 4.5 0 0 0-3.2-4.3" />
    </svg>
  );
}

/** Gauge / dial — system status. */
export function GaugeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15l4-5" />
      <path d="M12 15v.01" />
    </svg>
  );
}

/** Hamburger — open navigation drawer. Replaces ☰ */
export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

/** Trophy — bid outcome / win recorded. Replaces 🏆 */
export function TrophyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 5H5a3 3 0 0 0 3 5M16 5h3a3 3 0 0 1-3 5" />
      <path d="M12 13v3M9 20h6M10 16.5h4v3.5h-4z" />
    </svg>
  );
}

/** Bell — notifications. Replaces 🔔 */
export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** Single person — expert / individual record. Replaces 👤 */
export function PersonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20v-1a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

/** Folder — project portfolio / document group. Replaces 📁 */
export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" />
    </svg>
  );
}

/** Speech bubble — comment / clarification / chat. Replaces 💬 */
export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 5h16v10H8l-4 4V5z" />
    </svg>
  );
}

/** Question mark in a circle — question control. Replaces ❓ */
export function QuestionIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.7 1.2c0 1.6-2.2 1.8-2.2 3.3" />
      <path d="M12 17v.01" />
    </svg>
  );
}

/** Flag — milestone reached. Replaces 🏁 */
export function FlagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M5 21V4" />
      <path d="M5 5h13l-3 4 3 4H5" />
    </svg>
  );
}

/** Coin — commercial / pricing assumption. Replaces 💰 */
export function CoinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.3c0-1.3 1.2-2 2.5-2s2.5.7 2.5 1.9-1 1.6-2.5 1.8c-1.5.2-2.5.7-2.5 1.9S10.7 15 12 15s2.5-.6 2.5-1.9" />
    </svg>
  );
}

/**
 * Wrench — Repair / fix action. Distinct from RefreshIcon (which means
 * "retry the same operation"): Wrench means "fix the underlying input then
 * retry". Used by Extraction Quality "Repair Extraction" and any future
 * repair affordance, so "repair" never has to compete with "retry" for the
 * circular-arrow icon.
 */
export function WrenchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.4-.4-2.1 2.4-2.4z" />
    </svg>
  );
}
