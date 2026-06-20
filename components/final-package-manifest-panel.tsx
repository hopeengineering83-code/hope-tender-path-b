"use client";

import React from "react";

export function FinalPackageManifestPanel({ tenderId }: { tenderId: string }) {
  return (
    <div className="p-4 border rounded-xl bg-slate-50">
      <h3 className="text-sm font-bold">Final Package Manifest</h3>
      <p className="text-xs text-slate-500">List of all documents included in the final submission.</p>
    </div>
  );
}
