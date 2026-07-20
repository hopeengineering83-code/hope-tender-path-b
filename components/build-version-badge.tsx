"use client";

import { useEffect, useState } from "react";
import { WarningIcon, CheckIcon, CrossIcon, ChevronDownIcon } from "./icons";

const CLIENT_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "unavailable";
const CLIENT_ENV = process.env.NEXT_PUBLIC_BUILD_ENV ?? "development";
const CLIENT_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;

const ENVIRONMENT_LABELS: Record<string, string> = {
  production: "Production deployment",
  preview: "Preview deployment",
  ci: "CI validation build",
  "local-build": "Local production-mode build",
  development: "Development environment",
};

type VersionInfo = {
  ok: boolean;
  gitCommitSha: string;
  environment: string;
  buildTime: string | null;
  featureFlags: Record<string, boolean>;
};

function isKnownSha(sha: string | null | undefined) {
  return Boolean(sha && sha !== "dev" && sha !== "unavailable");
}

export function BuildVersionBadge() {
  const [serverSha, setServerSha] = useState<string | null>(null);
  const [serverEnvironment, setServerEnvironment] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/version")
      .then((response) => response.json())
      .then((data: VersionInfo) => {
        if (!data.ok) return;
        setServerSha(data.gitCommitSha);
        setServerEnvironment(data.environment);
        setFlags(data.featureFlags ?? {});
        if (
          isKnownSha(CLIENT_SHA) &&
          isKnownSha(data.gitCommitSha) &&
          CLIENT_SHA !== data.gitCommitSha
        ) {
          setStale(true);
        }
      })
      .catch(() => null);
  }, []);

  const environment = serverEnvironment ?? CLIENT_ENV;
  const environmentLabel = ENVIRONMENT_LABELS[environment] ?? `${environment} environment`;
  const effectiveSha = serverSha ?? CLIENT_SHA;
  const identityAvailable = isKnownSha(effectiveSha);
  const envColor =
    environment === "production"
      ? "text-emerald-600"
      : environment === "preview"
        ? "text-amber-600"
        : environment === "ci"
          ? "text-blue-600"
          : "text-slate-500";

  return (
    <div className="mt-1">
      {stale && (
        <div className="mb-1 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <WarningIcon className="inline h-4 w-4 shrink-0" />
          <span>
            Your browser may be showing a cached version (client: <code>{CLIENT_SHA}</code>, server: <code>{serverSha}</code>).{" "}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-medium underline hover:no-underline"
            >
              Hard refresh
            </button>{" "}
            or clear your browser cache.
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-left text-[10px] text-slate-400 transition-colors hover:text-slate-600"
        aria-expanded={open}
      >
        <span className={`font-medium ${envColor}`}>{environmentLabel}</span>
        <span> · {identityAvailable ? <>commit <code>{effectiveSha}</code></> : "commit unavailable"}</span>{" "}
        <ChevronDownIcon className={open ? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"} />
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600">
          <p><span className="font-medium">Deployment context:</span> {environmentLabel}</p>
          <p><span className="font-medium">Commit:</span> {identityAvailable ? effectiveSha : "Unavailable — deployment identity is incomplete"}</p>
          {CLIENT_TIME && (
            <p><span className="font-medium">Built:</span> {new Date(CLIENT_TIME).toLocaleString()}</p>
          )}
          {!identityAvailable && (
            <p className="text-amber-700">
              Commit identity is not configured. Vercel should provide VERCEL_GIT_COMMIT_SHA; non-Vercel builds should provide GIT_COMMIT_SHA.
            </p>
          )}
          {serverSha && isKnownSha(CLIENT_SHA) && isKnownSha(serverSha) && (
            <p>
              <span className="font-medium">Client/server:</span>{" "}
              {CLIENT_SHA === serverSha ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600"><CheckIcon className="inline h-3 w-3" /> in sync</span>
              ) : (
                <span className="inline-flex items-center gap-0.5 font-medium text-amber-600"><WarningIcon className="inline h-3 w-3" /> mismatch</span>
              )}
            </p>
          )}
          {Object.keys(flags).length > 0 && (
            <div className="mt-1 border-t border-slate-200 pt-1">
              <p className="mb-0.5 font-medium">Feature flags:</p>
              {Object.entries(flags).map(([key, enabled]) => (
                <p key={key}>
                  <span className="inline-flex items-center gap-1">
                    {enabled ? <CheckIcon className="inline h-3 w-3 text-emerald-600" /> : <CrossIcon className="inline h-3 w-3 text-red-500" />} {key}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
