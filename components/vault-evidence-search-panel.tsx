// Vault Evidence Search Panel — server component.
// Shows only selected evidence by default. Large reviewed vault lists are collapsed
// so the tender detail page stays compact on desktop, tablet, and mobile.

import { getSession } from "../lib/auth";
import { CheckIcon } from "./icons";
import { prisma, prismaReady } from "../lib/prisma";
import { ensureCompanyForUser } from "../lib/company-workspace";
import Link from "next/link";
import { clientLogger } from "@/lib/ui/client-logger";
import { PanelErrorFallback } from "./panel-error-fallback";
import {
  VAULT_REVIEW_CONSUMER_SELECT,
  canUseVaultRecord,
  effectiveReviewTrustLevel,
  type VaultExpertReviewConsumerRecord,
  type VaultProjectReviewConsumerRecord,
} from "../lib/vault-review-provenance";

interface Props {
  tenderId: string;
}

type ExpertRow = VaultExpertReviewConsumerRecord & { id: string };
type ProjectRow = VaultProjectReviewConsumerRecord & { id: string };

function TrustBadge({ level }: { level: string }) {
  if (level === "REVIEWED") {
    return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">HUMAN REVIEWED</span>;
  }
  if (level === "SOURCE_VERIFIED") {
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">SOURCE VERIFIED</span>;
  }
  if (level === "AI_DRAFT") {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">AI DRAFT</span>;
  }
  return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">REGEX DRAFT</span>;
}

function SelectionDot({ selected }: { selected: boolean }) {
  return selected ? (
    <span title="Selected for this tender" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckIcon /></span>
  ) : (
    <span title="Available — not yet selected for this tender" aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-slate-300" />
  );
}

function parseDisciplines(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return raw.split(/[;,|]/).map((v) => v.trim()).filter(Boolean);
  }
}

function ExpertList({ experts, selectedIds, matchedIds }: { experts: ExpertRow[]; selectedIds: Set<string>; matchedIds: Set<string> }) {
  if (experts.length === 0) return <p className="text-sm italic text-slate-400">No generation-eligible experts in this group.</p>;
  return (
    <ul className="space-y-2">
      {experts.map((expert) => {
        const disciplines = parseDisciplines(expert.disciplines);
        const isSelected = selectedIds.has(expert.id);
        const isMatched = matchedIds.has(expert.id);
        return (
          <li key={expert.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${isSelected ? "border-emerald-100 bg-emerald-50" : isMatched ? "border-slate-100 bg-slate-50" : "border-slate-100 bg-white"}`}>
            <div className="mt-0.5 shrink-0"><SelectionDot selected={isSelected} /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{expert.fullName}</p>
              {expert.title && <p className="truncate text-xs text-slate-500">{expert.title}</p>}
              {disciplines.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {disciplines.slice(0, 2).join(" · ")}{disciplines.length > 2 && ` +${disciplines.length - 2}`}
                </p>
              )}
            </div>
            <TrustBadge level={effectiveReviewTrustLevel(expert)} />
          </li>
        );
      })}
    </ul>
  );
}

function ProjectList({ projects, selectedIds, matchedIds }: { projects: ProjectRow[]; selectedIds: Set<string>; matchedIds: Set<string> }) {
  if (projects.length === 0) return <p className="text-sm italic text-slate-400">No generation-eligible projects in this group.</p>;
  return (
    <ul className="space-y-2">
      {projects.map((project) => {
        const isSelected = selectedIds.has(project.id);
        const isMatched = matchedIds.has(project.id);
        return (
          <li key={project.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${isSelected ? "border-emerald-100 bg-emerald-50" : isMatched ? "border-slate-100 bg-slate-50" : "border-slate-100 bg-white"}`}>
            <div className="mt-0.5 shrink-0"><SelectionDot selected={isSelected} /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{project.name}</p>
              <p className="truncate text-xs text-slate-500">{[project.clientName, project.country].filter(Boolean).join(" · ") || "No client / country"}</p>
              {project.sector && <p className="truncate text-xs text-slate-400">{project.sector}</p>}
            </div>
            <TrustBadge level={effectiveReviewTrustLevel(project)} />
          </li>
        );
      })}
    </ul>
  );
}

export default async function VaultEvidenceSearchPanel({ tenderId }: Props) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;
    const company = await ensureCompanyForUser(prisma, userId);

    const [allExperts, allProjects, expertMatches, projectMatches] = await Promise.all([
      prisma.expert.findMany({
        where: { companyId: company.id, deletedAt: null, isActive: true },
        select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT },
        orderBy: [{ trustLevel: "asc" }, { fullName: "asc" }],
        take: 100,
      }),
      prisma.project.findMany({
        where: { companyId: company.id, deletedAt: null },
        select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT },
        orderBy: [{ trustLevel: "asc" }, { name: "asc" }],
        take: 100,
      }),
      prisma.tenderExpertMatch.findMany({ where: { tenderId }, select: { expertId: true, isSelected: true } }),
      prisma.tenderProjectMatch.findMany({ where: { tenderId }, select: { projectId: true, isSelected: true } }),
    ]);

    const selectedExpertIds = new Set(expertMatches.filter((m) => m.isSelected).map((m) => m.expertId));
    const matchedExpertIds = new Set(expertMatches.map((m) => m.expertId));
    const selectedProjectIds = new Set(projectMatches.filter((m) => m.isSelected).map((m) => m.projectId));
    const matchedProjectIds = new Set(projectMatches.map((m) => m.projectId));

    const eligibleExperts = allExperts.filter((record) => canUseVaultRecord(record, "GENERATION")) as ExpertRow[];
    const eligibleProjects = allProjects.filter((record) => canUseVaultRecord(record, "GENERATION")) as ProjectRow[];
    const pendingExpertCount = allExperts.length - eligibleExperts.length;
    const pendingProjectCount = allProjects.length - eligibleProjects.length;

    const selectedExperts = eligibleExperts.filter((e) => selectedExpertIds.has(e.id));
    const selectedProjects = eligibleProjects.filter((p) => selectedProjectIds.has(p.id));
    const unselectedExperts = eligibleExperts.filter((e) => !selectedExpertIds.has(e.id));
    const unselectedProjects = eligibleProjects.filter((p) => !selectedProjectIds.has(p.id));

    const hasVaultContent = allExperts.length > 0 || allProjects.length > 0;
    if (!hasVaultContent) {
      return (
        <section id="vault-evidence-search" className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Vault Evidence — coverage for this tender</h2>
          <p className="mb-4 text-sm text-slate-500">No vault records found. Import CV documents and project references to build your evidence vault.</p>
          <Link href="/dashboard/company" className="inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Set up Vault</Link>
        </section>
      );
    }

    return (
      <section id="vault-evidence-search" className="rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Vault Evidence — coverage for this tender</h2>
            <p className="mt-0.5 text-xs text-slate-500">Selected evidence stays visible; long vault lists are collapsed.</p>
          </div>
          <Link href="/dashboard/company" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Manage Vault</Link>
        </div>

        <div className="grid grid-cols-2 gap-4 border-b px-6 py-4 sm:grid-cols-4">
          <div className="text-center"><p className="text-2xl font-bold text-slate-900">{eligibleExperts.length}</p><p className="text-xs text-slate-500">Generation-eligible experts</p></div>
          <div className="text-center"><p className="text-2xl font-bold text-slate-900">{eligibleProjects.length}</p><p className="text-xs text-slate-500">Generation-eligible projects</p></div>
          <div className="text-center"><p className="text-2xl font-bold text-emerald-600">{selectedExperts.length}</p><p className="text-xs text-slate-500">Experts selected</p></div>
          <div className="text-center"><p className="text-2xl font-bold text-emerald-600">{selectedProjects.length}</p><p className="text-xs text-slate-500">Projects selected</p></div>
        </div>

        {eligibleExperts.length > 0 && selectedExperts.length === 0 && (
          <div className="border-b bg-amber-50 px-6 py-3 text-sm font-medium text-amber-800">Coverage gap: {eligibleExperts.length} source-verifiable expert record(s) are eligible but none are selected for this tender.</div>
        )}
        {eligibleProjects.length > 0 && selectedProjects.length === 0 && (
          <div className="border-b bg-amber-50 px-6 py-3 text-sm font-medium text-amber-800">Coverage gap: {eligibleProjects.length} source-verifiable project record(s) are eligible but none are selected for this tender.</div>
        )}

        <div className="space-y-3 px-6 py-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Selected experts ({selectedExperts.length})</h3>
            <ExpertList experts={selectedExperts.slice(0, 3)} selectedIds={selectedExpertIds} matchedIds={matchedExpertIds} />
            {selectedExperts.length > 3 && (
              <details className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-emerald-700">Show all selected experts ({selectedExperts.length})</summary>
                <div className="mt-3"><ExpertList experts={selectedExperts} selectedIds={selectedExpertIds} matchedIds={matchedExpertIds} /></div>
              </details>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Selected projects ({selectedProjects.length})</h3>
            <ProjectList projects={selectedProjects.slice(0, 3)} selectedIds={selectedProjectIds} matchedIds={matchedProjectIds} />
            {selectedProjects.length > 3 && (
              <details className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-emerald-700">Show all selected projects ({selectedProjects.length})</summary>
                <div className="mt-3"><ProjectList projects={selectedProjects} selectedIds={selectedProjectIds} matchedIds={matchedProjectIds} /></div>
              </details>
            )}
          </div>

          {unselectedExperts.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              {/* Label and list must use the same count — this renders
                  unselectedExperts (eligible experts not yet selected for
                  this tender), not all vault experts, so the label counts
                  the same set instead of promising more than the list shows. */}
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show other eligible experts ({unselectedExperts.length})</summary>
              <div className="mt-3"><ExpertList experts={unselectedExperts} selectedIds={selectedExpertIds} matchedIds={matchedExpertIds} /></div>
            </details>
          )}

          {unselectedProjects.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show other eligible projects ({unselectedProjects.length})</summary>
              <div className="mt-3"><ProjectList projects={unselectedProjects} selectedIds={selectedProjectIds} matchedIds={matchedProjectIds} /></div>
            </details>
          )}

          {(pendingExpertCount > 0 || pendingProjectCount > 0) && (
            <p className="text-xs text-amber-800">{pendingExpertCount + pendingProjectCount} vault item(s) are not yet source-verified against current bytes and are excluded from generation. Run Engine verifies them automatically — no review step is required.</p>
          )}
        </div>

        <div className="rounded-b-2xl border-t bg-slate-50 px-6 py-3">
          <p className="text-xs text-slate-500">All vault records are eligible for proposal generation. <Link href="/dashboard/company" className="text-blue-600 hover:underline">Manage vault records</Link></p>
        </div>
      </section>
    );
  } catch (err) {
    clientLogger.error("[VaultEvidenceSearchPanel] render error:", err instanceof Error ? { message: err.message } : { error: String(err) });
    return <PanelErrorFallback panelName="Vaultevidencesearchpanel" />
  }
}
