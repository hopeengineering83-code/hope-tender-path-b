"use client";

import { useEffect, useState } from "react";
import { WarningIcon, CheckIcon, CrossIcon, ChevronDownIcon } from "./icons";

const CLIENT_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";
const CLIENT_ENV = process.env.NEXT_PUBLIC_BUILD_ENV ?? "development";
const CLIENT_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;

type VersionInfo = {
  ok: boolean;
  gitCommitSha: string;
  environment: string;
  buildTime: string | null;
  featureFlags: Record<string, boolean>;
};

export function BuildVersionBadge() {
  const [serverSha, setServerSha] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.json())
      .then((data: VersionInfo) => {
        if (!data.ok) return;
        setServerSha(data.gitCommitSha);
        setFlags(data.featureFlags ?? {});
        if (
          CLIENT_SHA !== "dev" &&
          data.gitCommitSha !== "dev" &&
          CLIENT_SHA !== data.gitCommitSha
        ) {
          setStale(true);
        }
      })
      .catch(() => null);
  }, []);

  const envColor =
    CLIENT_ENV === "production"
      ? "text-emerald-600"
      : CLIENT_ENV === "preview"
        ? "text-amber-600"
        : "text-slate-500";

  return (
    <div className="mt-1">
      {stale && (
        <div className="mb-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
          <WarningIcon className="shrink-0 inline h-4 w-4" />
          <span>
            Your browser may be showing a cached version (client: <code>{CLIENT_SHA}</code>, server: <code>{serverSha}</code>).{" "}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="underline hover:no-underline font-medium"
            >
              Hard refresh
            </button>{" "}
            or clear your browser cache.
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
        aria-expanded={open}
      >
        {CLIENT_ENV !== "development" && (
          <span className={`font-medium ${envColor}`}>{CLIENT_ENV} </span>
        )}
        build <code>{CLIENT_SHA}</code> <ChevronDownIcon className={open ? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"} />
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600 space-y-0.5">
          <p><span className="font-medium">Commit:</span> {CLIENT_SHA}</p>
          <p><span className="font-medium">Environment:</span> {CLIENT_ENV}</p>
          {CLIENT_TIME && (
            <p><span className="font-medium">Built:</span> {new Date(CLIENT_TIME).toLocaleString()}</p>
          )}
          {serverSha && (
            <p>
              <span className="font-medium">Server SHA:</span> {serverSha}{" "}
              {CLIENT_SHA === serverSha ? (
                <span className="text-emerald-600 font-medium inline-flex items-center gap-0.5"><CheckIcon className="inline h-3 w-3" /> in sync</span>
              ) : (
                <span className="text-amber-600 font-medium inline-flex items-center gap-0.5"><WarningIcon className="inline h-3 w-3" /> mismatch</span>
              )}
            </p>
          )}
          {Object.keys(flags).length > 0 && (
            <div className="pt-1 border-t border-slate-200 mt-1">
              <p className="font-medium mb-0.5">Feature flags:</p>
              {Object.entries(flags).map(([k, v]) => (
                <p key={k}>
                  <span className="inline-flex items-center gap-1">{v ? <CheckIcon className="inline h-3 w-3 text-emerald-600" /> : <CrossIcon className="inline h-3 w-3 text-red-500" />} {k}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
