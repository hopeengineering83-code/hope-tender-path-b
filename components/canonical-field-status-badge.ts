// Shared canonical-field-status badge config.
//
// Originally this 16-entry Record<CanonicalFieldStatus, {label, classes}>
// was duplicated verbatim across 3 panel files. Two of those
// (metadata-truth-panel.tsx, metadata-completion-panel.tsx) were read-only
// summaries of the same snapshot.metadata.fields data that
// components/client-submission-details-panel.tsx fully subsumes (same
// fields, same badges, plus per-field editing/confirmation/source-quote
// review) and were deleted as superseded dead code.
//
// Centralising here guarantees every panel renders the same label + colour
// for the same status.
//
// This module is PURE data — no React — so it can be imported by both
// server components and client components without pulling in react/jsx.

import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";

export const CANONICAL_FIELD_STATUS_BADGE: Record<CanonicalFieldStatus, { label: string; classes: string }> = {
  EXTRACTED_AND_GROUNDED:                { label: "Extracted and grounded",             classes: "bg-emerald-100 text-emerald-700" },
  EXTRACTED_UNVERIFIED:                  { label: "Extracted — evidence review pending", classes: "bg-blue-100 text-blue-700" },
  MANUAL_OVERRIDE:                       { label: "Candidate value (non-critical)",      classes: "bg-indigo-100 text-indigo-700" },
  MANUAL_OVERRIDE_CONFIRMATION_REQUIRED: { label: "Candidate — final check pending",     classes: "bg-slate-100 text-slate-600" },
  NOT_FOUND_CONFIRMED:                   { label: "Confirmed — final evidence pending",  classes: "bg-amber-100 text-amber-700" },
  MANUAL_CONFIRMED:                      { label: "Confirmed — final evidence pending",  classes: "bg-amber-100 text-amber-700" },
  NOT_STATED:                            { label: "Not stated in tender",                classes: "bg-slate-100 text-slate-600" },
  NOT_APPLICABLE:                        { label: "Not applicable",                      classes: "bg-slate-100 text-slate-500" },
  AMBIGUOUS_DATE:                        { label: "Date ambiguous — confirm",            classes: "bg-orange-100 text-orange-700" },
  GENERIC_FIELD_LABEL:                   { label: "Invalid extracted value",             classes: "bg-red-100 text-red-700" },
  INTERNAL_PLACEHOLDER:                  { label: "Placeholder detected",                classes: "bg-red-100 text-red-700" },
  PORTAL_CONTAMINATION:                  { label: "Contaminated — review",               classes: "bg-red-100 text-red-700" },
  INVALID_FORMAT:                        { label: "Invalid format",                      classes: "bg-red-100 text-red-700" },
  SOURCE_CONFLICT:                       { label: "Source conflict — resolve",           classes: "bg-red-100 text-red-700" },
  INVALID:                               { label: "Not detected",                        classes: "bg-slate-100 text-slate-500" },
  BLOCKED:                               { label: "Final-check item",                    classes: "bg-slate-100 text-slate-600" },
};

// Convenience: the fallback entry (matches the prior `?? STATUS_BADGE.INVALID` pattern).
export const CANONICAL_FIELD_STATUS_BADGE_FALLBACK = CANONICAL_FIELD_STATUS_BADGE.INVALID;
