"use client";

import React, { useEffect, useState } from "react";
import { AIHealthTestButton } from "./ai-health-test-button";

interface ProviderCardData {
  key: string;
  label: string;
  rank: number;
  configured: boolean;
  model?: string;
  status: string;
  isAi: boolean;
  runtime: {
    coolingDown: boolean;
    lastSuccessAt: string | null;
    lastErrorCategory: string | null;
    cooldownUntil: string | null;
  };
}

function ProviderCard({ p }: { p: ProviderCardData }) {
  if (!p.isAi) {
    return (
      <div className="rounded-xl bg-slate-50 p-3 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-slate-900">{p.label}</p>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Final fallback (non-AI)</span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Fallback rank {p.rank}</p>
        <p className="mt-1 text-xs text-slate-600">Deterministic draft fallback.</p>
        <p className="mt-1 text-xs text-slate-500">Runs only after every configured AI provider has failed.</p>
      </div>
    );
  }

  const pill = p.status === "not_configured"
    ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Not configured</span>
    : p.status === "generation_verified"
      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Generation verified</span>
      : p.status === "analysis_verified"
        ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Analysis verified</span>
        : p.status === "runtime_verified"
          ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Runtime verified</span>
          : p.status === "rate_limited"
            ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Rate-limited</span>
            : p.status === "unauthorized"
              ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Unauthorized</span>
              : p.status === "timeout"
                ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Timeout</span>
                : p.status === "unavailable"
                  ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Unavailable</span>
                  : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Configured</span>;

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-900">{p.label}</p>
        {pill}
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">Fallback rank {p.rank}</p>
      {p.configured && <p className="mt-1 text-xs text-slate-600">Model: {p.model ?? "default"}</p>}
      {p.runtime.lastSuccessAt && <p className="mt-1 text-xs text-slate-500">Last success: {new Date(p.runtime.lastSuccessAt).toLocaleTimeString()}</p>}
      {p.runtime.coolingDown && p.runtime.cooldownUntil && (
        <p className="mt-1 text-xs text-amber-700">Cooling down until {new Date(p.runtime.cooldownUntil).toLocaleTimeString()}</p>
      )}
    </div>
  );
}

export function AIHealthPanel() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    fetch("/api/ai/health")
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(console.error);
  }, []);

  if (!health) return <div className="animate-pulse h-48 bg-slate-50 rounded-2xl border" />;

  const aiProviders = (health.providers || []).filter((p: any) => p.isAi);
  const configured = aiProviders.filter((p: any) => p.configured).length;
  const verified = aiProviders.filter((p: any) => p.status === "runtime_verified" || p.status === "analysis_verified" || p.status === "generation_verified").length;
  const rateLimited = aiProviders.filter((p: any) => p.status === "rate_limited").length;

  return (
    <section className="mb-4 rounded-2xl border p-5 shadow-sm bg-white">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI provider health</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-900">Configured:</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-700">{configured}/8</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-900">Verified:</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono font-bold text-emerald-700">{verified}/8</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-900">Rate-limited:</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 font-mono font-bold text-amber-700">{rateLimited}/8</span>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-xs text-slate-500 italic">Configured is not healthy. Successful real responses are required for verification. Connectivity probes do not verify tender analysis capability.</p>
        </div>
        <AIHealthTestButton />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(health.providers || []).map((p: any) => <ProviderCard key={p.key} p={p} />)}
      </div>
    </section>
  );
}
