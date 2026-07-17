"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckIcon, ChevronUpIcon, ChevronDownIcon } from "./icons";

const PREVIEW = 5;

export type VaultExpert = {
  id: string;
  fullName: string;
  title: string | null;
  disciplines: string[];
  trustLevel: string;
  isSelected: boolean;
  isMatched: boolean;
};

export type VaultProject = {
  id: string;
  name: string;
  clientName: string | null;
  sector: string | null;
  country: string | null;
  trustLevel: string;
  isSelected: boolean;
  isMatched: boolean;
};

function TrustBadge({ level }: { level: string }) {
  if (level === "REVIEWED")
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 text-green-700">REVIEWED</span>;
  if (level === "AI_DRAFT")
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">AI DRAFT</span>;
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">REGEX DRAFT</span>;
}

function SelectionDot({ selected }: { selected: boolean }) {
  if (selected)
    return (
      <span title="Selected for this tender" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
        <CheckIcon className="h-3 w-3" />
      </span>
    );
  return (
    <span
      title="Available — not yet selected for this tender"
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border-2 border-slate-300"
    />
  );
}

export function VaultExpertsList({
  experts,
  reviewedCount,
  aiDraftCount,
  regexDraftCount,
}: {
  experts: VaultExpert[];
  reviewedCount: number;
  aiDraftCount: number;
  regexDraftCount: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? experts : experts.slice(0, PREVIEW);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Experts
          <span className="ml-2 text-xs font-normal text-slate-400">
            ({reviewedCount} reviewed · {aiDraftCount} AI draft · {regexDraftCount} regex draft)
          </span>
        </h3>
      </div>

      {experts.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No reviewed experts yet.{" "}
          <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
            Review drafts to promote them.
          </Link>
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((expert) => (
              <li
                key={expert.id}
                className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
                  expert.isSelected
                    ? "bg-emerald-50 border border-emerald-100"
                    : expert.isMatched
                    ? "bg-slate-50 border border-slate-100"
                    : "bg-white border border-slate-100"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  <SelectionDot selected={expert.isSelected} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{expert.fullName}</p>
                  {expert.title && (
                    <p className="text-xs text-slate-500 truncate">{expert.title}</p>
                  )}
                  {expert.disciplines.length > 0 && (
                    <p className="mt-0.5 text-xs text-slate-400 truncate">
                      {expert.disciplines.slice(0, 2).join(" · ")}
                      {expert.disciplines.length > 2 && ` +${expert.disciplines.length - 2}`}
                    </p>
                  )}
                </div>
                <TrustBadge level={expert.trustLevel} />
              </li>
            ))}
          </ul>
          {experts.length > PREVIEW && (
            <div className="mt-2 pl-3">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                {showAll ? <><ChevronUpIcon /> Show fewer</> : <><ChevronDownIcon /> Show all {experts.length} reviewed experts</>}
              </button>
            </div>
          )}
        </>
      )}

      {(aiDraftCount > 0 || regexDraftCount > 0) && (
        <p className="mt-3 text-xs text-slate-400">
          {aiDraftCount + regexDraftCount} draft expert{aiDraftCount + regexDraftCount !== 1 ? "s" : ""} pending review — not eligible for generation.{" "}
          <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
            Review now
          </Link>
        </p>
      )}
    </>
  );
}

export function VaultProjectsList({
  projects,
  reviewedCount,
  aiDraftCount,
  regexDraftCount,
}: {
  projects: VaultProject[];
  reviewedCount: number;
  aiDraftCount: number;
  regexDraftCount: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? projects : projects.slice(0, PREVIEW);

  const sectorMap = new Map<string, VaultProject[]>();
  for (const p of visible) {
    const s = p.sector ?? "Unclassified";
    if (!sectorMap.has(s)) sectorMap.set(s, []);
    sectorMap.get(s)!.push(p);
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Projects
          <span className="ml-2 text-xs font-normal text-slate-400">
            ({reviewedCount} reviewed · {aiDraftCount} AI draft · {regexDraftCount} regex draft)
          </span>
        </h3>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No reviewed projects yet.{" "}
          <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
            Review drafts to promote them.
          </Link>
        </p>
      ) : (
        <>
          <div className="space-y-4">
            {Array.from(sectorMap.entries()).map(([sector, sectorProjects]) => (
              <div key={sector}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {sector}
                </p>
                <ul className="space-y-2">
                  {sectorProjects.map((project) => (
                    <li
                      key={project.id}
                      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
                        project.isSelected
                          ? "bg-emerald-50 border border-emerald-100"
                          : project.isMatched
                          ? "bg-slate-50 border border-slate-100"
                          : "bg-white border border-slate-100"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        <SelectionDot selected={project.isSelected} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 truncate">{project.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {[project.clientName, project.country].filter(Boolean).join(" · ") || "No client / country"}
                        </p>
                      </div>
                      <TrustBadge level={project.trustLevel} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {projects.length > PREVIEW && (
            <div className="mt-2 pl-3">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                {showAll ? <><ChevronUpIcon /> Show fewer</> : <><ChevronDownIcon /> Show all {projects.length} reviewed projects</>}
              </button>
            </div>
          )}
        </>
      )}

      {(aiDraftCount > 0 || regexDraftCount > 0) && (
        <p className="mt-3 text-xs text-slate-400">
          {aiDraftCount + regexDraftCount} draft project{aiDraftCount + regexDraftCount !== 1 ? "s" : ""} pending review — not eligible for generation.{" "}
          <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
            Review now
          </Link>
        </p>
      )}
    </>
  );
}
