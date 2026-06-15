"use client";

import React from "react";
import { CANONICAL_STATUS_CONFIG, type CanonicalModuleStatus } from "../lib/engine/readiness/canonical-readiness-state";

type CanonicalStatusBadgeProps = {
  status: CanonicalModuleStatus;
  label?: string;
  size?: "sm" | "md";
  showIcon?: boolean;
};

export function CanonicalStatusBadge({ status, label, size = "md", showIcon = true }: CanonicalStatusBadgeProps) {
  const config = CANONICAL_STATUS_CONFIG[status];
  const displayLabel = label ?? config.label;
  const sizeClass = size === "sm"
    ? "px-2 py-0.5 text-[10px]"
    : "px-3 py-1 text-xs";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${sizeClass} ${config.textClass} ${config.bgClass} ${config.borderClass}`}>
      {showIcon && <span aria-hidden="true">{config.icon}</span>}
      {displayLabel}
    </span>
  );
}

type CanonicalStatusIconProps = {
  status: CanonicalModuleStatus;
};

export function CanonicalStatusIcon({ status }: CanonicalStatusIconProps) {
  const config = CANONICAL_STATUS_CONFIG[status];
  return (
    <span className={config.textClass} aria-label={config.label} title={config.label}>
      {config.icon}
    </span>
  );
}
