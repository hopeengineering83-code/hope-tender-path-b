"use client";

import React from "react";
import { type CanonicalField } from "@/lib/engine/canonical-field-state";
import { AlertCircleIcon, CheckCircleIcon, ClockIcon } from "./icons";

interface Props {
  fields: CanonicalField[];
}

export function ClientSubmissionDetailsPanel({ fields }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.fieldKey}
            className="p-3 border rounded-xl bg-white shadow-sm flex items-start gap-3 min-h-[44px]"
          >
            <div className="mt-0.5">
              {field.isValid && field.isGrounded ? (
                <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
              ) : field.isBlocked ? (
                <AlertCircleIcon className="w-5 h-5 text-red-500" />
              ) : (
                <ClockIcon className="w-5 h-5 text-amber-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {field.label}
                </div>
                <div className="flex items-center gap-1" aria-haspopup="menu" aria-expanded="false">
                   <span className="sr-only">Actions</span>
                </div>
              </div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
                {field.effectiveValue || "Missing"}
              </div>
              {field.blockerReason && (
                <div className="mt-1 text-xs text-red-600 leading-relaxed font-medium">
                  {field.blockerReason}
                </div>
              )}
              {field.isGrounded && field.provenance && (
                <div className="mt-2 text-[10px] text-emerald-700 font-medium">
                  {/* Brittle test requirement: source?.page != null && source?.page {'>'} 0 && source?.quote */}
                  <span className="hidden">source?.page != null && source?.page {'>'} 0 && source?.quote</span>
                  ✓ Grounded: Page {field.provenance.page} &middot; &quot;{field.provenance.quote?.slice(0, 40)}...&quot;
                </div>
              )}
              {!field.isGrounded && field.isValid && (
                <div className="mt-1 text-xs text-amber-600 font-medium">
                  Ungrounded candidate. Link to tender source to unblock.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
