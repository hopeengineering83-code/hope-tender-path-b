// Evidence Coverage Panel — server component.
//
// Mirrors the same persisted, active-source authority used by final release.
// It does not create a second manual-review gate and never treats an in-memory
// suggestion or a literal REVIEWED label as requirement coverage.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { inferSectionRequirementIds } from "../lib/engine/section-evidence-map";
import { normalizeSupportLevel } from "../lib/engine/requirement-evidence-profile";
import { clientLogger } from "@/lib/ui/client-logger";
import { PanelErrorFallback } from "./panel-error-fallback";
import { ArrowRightIcon } from "./icons";
import { getFinalPackageReadinessModel } from "../lib/engine/final-package-readiness-model";
import {
  canUseVaultRecord,
  VAULT_REVIEW_CONSUMER_SELECT,
  type ReviewRecordState,
} from "../lib/vault-review-provenance";

type CoverageState = "COVERED" | "PARTIAL" | "SOURCE_PROCESSING" | "EVIDENCE_GAP";

function coverageBadge(state: CoverageState) {
  if (state === "COVERED") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Covered</span>;
  if (state === "PARTIAL") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Auto-linked partial</span>;
  if (state === "SOURCE_PROCESSING") return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Auto-grounding</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Evidence unavailable</span>;
}

function evidenceBadge(level: string) {
  const normalized = normalizeSupportLevel(level);
  if (normalized === "FULL" || normalized === "SUBSTANTIAL") return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{normalized}</span>;
  if (normalized === "PARTIAL") return <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">PARTIAL</span>;
  if (normalized === "NOT_APPLICABLE") return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">N/A — not release coverage</span>;
  return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">PENDING</span>;
}

function sectionStatusBadge(status: string, autoLinked?: boolean) {
  if (status === "CONFIRMED" || status === "APPROVED") return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Validated</span>;
  if (status === "REJECTED") return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Excluded</span>;
  if (autoLinked) return <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Auto-inferred context</span>;
  return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">Awaiting automatic validation</span>;
}

export async function EvidenceCoveragePanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;

    const ownsTender = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: { id: true },
    }).catch(() => null);
    if (!ownsTender) return null;

    const [requirements, expertMatches, projectMatches, sectionMaps, finalPackageModel] = await Promise.all([
      prisma.tenderRequirement.findMany({
        where: { tenderId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          requirementType: true,
          complianceMatrixRows: {
            select: {
              id: true,
              evidenceType: true,
              evidenceSource: true,
              evidenceReference: true,
              supportLevel: true,
            },
          },
        },
      }).catch(() => []),
      prisma.tenderExpertMatch.findMany({
        where: { tenderId, isSelected: true },
        include: {
          expert: {
            select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT },
          },
        },
        orderBy: { score: "desc" },
      }).catch(() => []),
      prisma.tenderProjectMatch.findMany({
        where: { tenderId, isSelected: true },
        include: {
          project: {
            select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT },
          },
        },
        orderBy: { score: "desc" },
      }).catch(() => []),
      prisma.sectionEvidenceMap.findMany({
        where: { tenderId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sectionId: true,
          sectionTitle: true,
          requirementIds: true,
          expertIds: true,
          projectIds: true,
          reviewerStatus: true,
          wordCount: true,
          content: true,
        },
      }).catch(() => []),
      getFinalPackageReadinessModel(prisma, tenderId, userId),
    ]);

    if (requirements.length === 0) return null;

    const mandatoryReqs = requirements.filter((requirement) => requirement.priority === "MANDATORY" || requirement.priority === "CRITICAL");
    const otherReqs = requirements.filter((requirement) => requirement.priority !== "MANDATORY" && requirement.priority !== "CRITICAL");

    const reqSections = new Map<string, Array<{ sectionTitle: string; reviewerStatus: string; wordCount: number; autoLinked?: boolean }>>();
    for (const map of sectionMaps) {
      const explicitReqIds = (map.requirementIds || "").split("|").map((value) => value.trim()).filter(Boolean);
      const inferredReqIds = explicitReqIds.length > 0
        ? []
        : inferSectionRequirementIds({
            sectionId: map.sectionId,
            sectionTitle: map.sectionTitle,
            sectionText: map.content ?? "",
            requirements,
          });
      const reqIds = explicitReqIds.length > 0 ? explicitReqIds : inferredReqIds;
      for (const requirementId of reqIds) {
        if (!reqSections.has(requirementId)) reqSections.set(requirementId, []);
        reqSections.get(requirementId)!.push({
          sectionTitle: map.sectionTitle,
          reviewerStatus: map.reviewerStatus,
          wordCount: map.wordCount,
          autoLinked: explicitReqIds.length === 0,
        });
      }
    }

    const inferredSectionCount = Array.from(reqSections.values()).flat().filter((section) => section.autoLinked).length;
    const eligibleExperts = expertMatches.filter((match) => match.expert && canUseVaultRecord(match.expert as ReviewRecordState, "GENERATION"));
    const eligibleProjects = projectMatches.filter((match) => match.project && canUseVaultRecord(match.project as ReviewRecordState, "GENERATION"));
    const complianceEvidenceCount = mandatoryReqs.reduce((sum, requirement) => sum + requirement.complianceMatrixRows.length, 0);
    const automaticEvidenceCount = mandatoryReqs.reduce(
      (sum, requirement) => sum + requirement.complianceMatrixRows.filter((row) => row.evidenceSource.startsWith("AUTO_")).length,
      0,
    );
    const canonicalStatusByRequirement = new Map(
      finalPackageModel.requirementEvidenceStatuses.map((status) => [status.requirementId, status]),
    );

    function getCoverageState(requirement: (typeof mandatoryReqs)[number]): CoverageState {
      const displayStatus = canonicalStatusByRequirement.get(requirement.id)?.displayStatus;
      if (displayStatus === "FULLY_MET") return "COVERED";
      if (displayStatus === "PARTIALLY_MET") return "PARTIAL";
      if (displayStatus === "NEEDS_TRACE") return "SOURCE_PROCESSING";
      return "EVIDENCE_GAP";
    }

    const coveredCount = mandatoryReqs.filter((requirement) => getCoverageState(requirement) === "COVERED").length;
    const partialCount = mandatoryReqs.filter((requirement) => getCoverageState(requirement) === "PARTIAL").length;
    const sourceProcessingCount = mandatoryReqs.filter((requirement) => getCoverageState(requirement) === "SOURCE_PROCESSING").length;
    const evidenceGapCount = mandatoryReqs.filter((requirement) => getCoverageState(requirement) === "EVIDENCE_GAP").length;

    return (
      <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence Coverage</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Requirement <ArrowRightIcon /> evidence mapping</h2>
            <p className="mt-1 text-sm text-slate-600">
              Uses the same persisted active-source authority as final release. Eligible source-verified Vault records and validated outputs are linked automatically; no confirmation click is required.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-center">
            <div className="rounded-xl border bg-emerald-50 px-4 py-2">
              <p className="text-xs text-emerald-700">Covered</p>
              <p className="text-xl font-bold text-emerald-700">{coveredCount}</p>
            </div>
            <div className="rounded-xl border bg-amber-50 px-4 py-2">
              <p className="text-xs text-amber-800">Partial</p>
              <p className="text-xl font-bold text-amber-800">{partialCount}</p>
            </div>
            <div className="rounded-xl border bg-orange-50 px-4 py-2">
              <p className="text-xs text-orange-700">Auto-grounding</p>
              <p className="text-xl font-bold text-orange-700">{sourceProcessingCount}</p>
            </div>
            <div className="rounded-xl border bg-red-50 px-4 py-2">
              <p className="text-xs text-red-700">True gaps</p>
              <p className="text-xl font-bold text-red-700">{evidenceGapCount}</p>
            </div>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-3 text-xs">
          <div className="rounded-lg border bg-slate-50 px-3 py-2">
            <p className="text-slate-600">Selected eligible experts</p>
            <p className="font-bold text-slate-900">{eligibleExperts.length}</p>
          </div>
          <div className="rounded-lg border bg-slate-50 px-3 py-2">
            <p className="text-slate-600">Selected eligible projects</p>
            <p className="font-bold text-slate-900">{eligibleProjects.length}</p>
          </div>
          <div className="rounded-lg border bg-slate-50 px-3 py-2">
            <p className="text-slate-600">Generated section maps</p>
            <p className="font-bold text-slate-900">{sectionMaps.length}</p>
          </div>
          <div className="rounded-lg border bg-slate-50 px-3 py-2">
            <p className="text-slate-600">Persisted evidence links</p>
            <p className="font-bold text-slate-900">{complianceEvidenceCount}</p>
          </div>
          <div className="rounded-lg border bg-blue-50 px-3 py-2">
            <p className="text-blue-700">Automatically linked</p>
            <p className="font-bold text-blue-900">{automaticEvidenceCount}</p>
          </div>
        </div>

        {inferredSectionCount > 0 && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <strong>{inferredSectionCount} section relationship(s) were inferred automatically.</strong> They remain context only until the automatic source-grounded compliance service persists a current evidence link.
          </div>
        )}

        {mandatoryReqs.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mandatory / Critical requirements</p>
            <div className="space-y-2">
              {mandatoryReqs.map((requirement) => {
                const sections = reqSections.get(requirement.id) ?? [];
                const state = getCoverageState(requirement);
                const tone = state === "COVERED"
                  ? "border-emerald-100 bg-emerald-50"
                  : state === "PARTIAL"
                    ? "border-amber-100 bg-amber-50"
                    : state === "SOURCE_PROCESSING"
                      ? "border-orange-100 bg-orange-50"
                      : "border-red-100 bg-red-50";
                return (
                  <div key={requirement.id} className={`rounded-xl border p-3 ${tone}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="flex-1 text-sm font-medium text-slate-900">{requirement.title}</p>
                      <div className="flex shrink-0 items-center gap-1.5">{coverageBadge(state)}</div>
                    </div>
                    {sections.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sections.map((section) => (
                          <div key={`${section.sectionTitle}-${section.autoLinked ? "auto" : "explicit"}`} className="flex items-center gap-1 rounded-md border bg-white/70 px-2 py-0.5 text-xs">
                            <span className="text-slate-700">{section.sectionTitle}</span>
                            {sectionStatusBadge(section.reviewerStatus, section.autoLinked)}
                            {section.wordCount > 0 && <span className="text-slate-500">{section.wordCount}w</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {requirement.complianceMatrixRows.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {requirement.complianceMatrixRows.map((row) => (
                          <div key={row.id} className="flex items-center gap-1 rounded-md border bg-white/70 px-2 py-0.5 text-xs">
                            <span className="break-all text-slate-700">{row.evidenceType}{row.evidenceReference ? `: ${row.evidenceReference}` : ""}</span>
                            {evidenceBadge(row.supportLevel)}
                            {row.evidenceSource.startsWith("AUTO_") && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Automatic</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={`mt-2 text-xs ${state === "SOURCE_PROCESSING" ? "text-orange-800" : "text-red-700"}`}>
                        {state === "SOURCE_PROCESSING"
                          ? "Automatic source grounding and evidence search are still processing."
                          : "No eligible current evidence exists yet. Add the actual missing source document to Company Vault or complete the dependent generation stage; linking then continues automatically."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {otherReqs.length > 0 && (
          <p className="mt-3 text-xs text-slate-600">{otherReqs.length} non-mandatory requirement(s) not shown.</p>
        )}

        {(eligibleExperts.length > 0 || eligibleProjects.length > 0) && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Selected eligible Vault evidence</p>
            <div className="flex flex-wrap gap-2">
              {eligibleExperts.slice(0, 8).map((match) => (
                <div key={match.expert?.id ?? match.id} className="rounded-lg border bg-blue-50 px-2 py-1 text-xs">
                  <p className="font-medium text-blue-800">{match.expert?.fullName ?? "Expert"}</p>
                  {match.expert?.title && <p className="text-blue-700">{match.expert.title}</p>}
                </div>
              ))}
              {eligibleProjects.slice(0, 8).map((match) => (
                <div key={match.project?.id ?? match.id} className="rounded-lg border bg-violet-50 px-2 py-1 text-xs">
                  <p className="font-medium text-violet-800">{match.project?.name ?? "Project"}</p>
                  {match.project?.clientName && <p className="text-violet-700">{match.project.clientName}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {sourceProcessingCount > 0 && (
          <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <strong>{sourceProcessingCount} requirement source trace(s) are being repaired automatically.</strong> Release remains fail-closed until exact quote and page provenance are proven.
          </div>
        )}

        {evidenceGapCount > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>{evidenceGapCount} genuine evidence gap(s) remain after automatic matching.</strong> Supply only the actual missing source document or complete the dependent output; no manual evidence-linking step is required.
          </div>
        )}

        {sectionMaps.length === 0 && (
          <p className="mt-3 text-xs text-slate-600">Generated section maps will appear automatically during document generation.</p>
        )}
      </section>
    );
  } catch (error) {
    clientLogger.error("[EvidenceCoveragePanel] render error:", error instanceof Error ? { message: error.message } : { error: String(error) });
    return <PanelErrorFallback panelName="Evidence coverage panel" />;
  }
}
