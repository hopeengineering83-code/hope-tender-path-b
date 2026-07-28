// Evidence Coverage Panel — server component.
//
// Shows per-requirement evidence coverage: which mandatory requirements are
// covered by linked section evidence maps, selected experts, and selected
// projects. Identifies uncovered requirements so the bid team can act before
// generation.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { inferSectionRequirementIds } from "../lib/engine/section-evidence-map";
import { normalizeSupportLevel } from "../lib/engine/requirement-evidence-profile";
import { clientLogger } from "@/lib/ui/client-logger";
import { PanelErrorFallback } from "./panel-error-fallback";
import { ArrowRightIcon } from "./icons";
import { getFinalPackageReadinessModel } from "../lib/engine/final-package-readiness-model";

type CoverageState = "COVERED" | "PARTIAL" | "UNCOVERED" | "NEEDS_TRACE";

function coverageBadge(state: CoverageState) {
  if (state === "COVERED") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Covered</span>;
  if (state === "PARTIAL") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Partial</span>;
  if (state === "NEEDS_TRACE") return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Needs source trace</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Uncovered</span>;
}

function evidenceBadge(level: string) {
  const normalized = normalizeSupportLevel(level);
  if (normalized === "FULL" || normalized === "SUBSTANTIAL") return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{normalized}</span>;
  if (normalized === "PARTIAL") return <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">PARTIAL</span>;
  if (normalized === "NOT_APPLICABLE") return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">N/A — not release coverage</span>;
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">NONE</span>;
}

function reviewBadge(status: string, autoLinked?: boolean) {
  if (status === "CONFIRMED" || status === "APPROVED") return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Confirmed</span>;
  if (status === "REJECTED") return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Rejected</span>;
  if (autoLinked) return <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Auto-linked</span>;
  return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Pending review</span>;
}

export async function EvidenceCoveragePanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
  await prismaReady;

  const ownsTender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } }).catch(() => null);
  if (!ownsTender) return null;

  const [requirements, expertMatches, projectMatches, sectionMaps, finalPackageModel] = await Promise.all([
    prisma.tenderRequirement.findMany({
      where: { tenderId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, title: true, description: true, priority: true, requirementType: true,
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
      include: { expert: { select: { id: true, fullName: true, title: true, trustLevel: true } } },
      orderBy: { score: "desc" },
    }).catch(() => []),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: true },
      include: { project: { select: { id: true, name: true, clientName: true, trustLevel: true } } },
      orderBy: { score: "desc" },
    }).catch(() => []),
    prisma.sectionEvidenceMap.findMany({
      where: { tenderId },
      orderBy: { createdAt: "asc" },
      select: { id: true, sectionId: true, sectionTitle: true, requirementIds: true, expertIds: true, projectIds: true, reviewerStatus: true, wordCount: true, content: true },
    }).catch(() => []),
    getFinalPackageReadinessModel(prisma, tenderId, userId),
  ]);

  if (requirements.length === 0) return null;

  const mandatoryReqs = requirements.filter((r) => r.priority === "MANDATORY" || r.priority === "CRITICAL");
  const otherReqs = requirements.filter((r) => r.priority !== "MANDATORY" && r.priority !== "CRITICAL");

  const reqSections = new Map<string, Array<{ sectionTitle: string; reviewerStatus: string; wordCount: number; autoLinked?: boolean }>>();
  for (const map of sectionMaps) {
    const explicitReqIds = (map.requirementIds || "").split("|").map((s) => s.trim()).filter(Boolean);
    const inferredReqIds = explicitReqIds.length > 0
      ? []
      : inferSectionRequirementIds({
          sectionId: map.sectionId,
          sectionTitle: map.sectionTitle,
          sectionText: map.content ?? "",
          requirements,
        });
    const reqIds = explicitReqIds.length > 0 ? explicitReqIds : inferredReqIds;
    for (const reqId of reqIds) {
      if (!reqSections.has(reqId)) reqSections.set(reqId, []);
      reqSections.get(reqId)!.push({
        sectionTitle: map.sectionTitle,
        reviewerStatus: map.reviewerStatus,
        wordCount: map.wordCount,
        autoLinked: explicitReqIds.length === 0,
      });
    }
  }

  const autoLinkedCount = Array.from(reqSections.values()).flat().filter((section) => section.autoLinked).length;
  const reviewedExperts = expertMatches.filter((m) => m.expert?.trustLevel === "REVIEWED");
  const reviewedProjects = projectMatches.filter((m) => m.project?.trustLevel === "REVIEWED");
  const complianceEvidenceCount = mandatoryReqs.reduce((sum, req) => sum + req.complianceMatrixRows.length, 0);
  const canonicalStatusByRequirement = new Map(
    finalPackageModel.requirementEvidenceStatuses.map((status) => [
      status.requirementId,
      status,
    ]),
  );

  function getCoverageState(req: (typeof mandatoryReqs)[number]): CoverageState {
    const displayStatus = canonicalStatusByRequirement.get(req.id)?.displayStatus;
    if (displayStatus === "FULLY_MET") return "COVERED";
    if (displayStatus === "PARTIALLY_MET") return "PARTIAL";
    if (displayStatus === "NEEDS_TRACE") return "NEEDS_TRACE";
    return "UNCOVERED";
  }

  const coveredCount = mandatoryReqs.filter((r) => getCoverageState(r) === "COVERED").length;
  const partialCount = mandatoryReqs.filter((r) => getCoverageState(r) === "PARTIAL").length;
  const needsTraceCount = mandatoryReqs.filter((r) => getCoverageState(r) === "NEEDS_TRACE").length;
  const uncoveredCount = mandatoryReqs.filter((r) => getCoverageState(r) === "UNCOVERED").length;

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence Coverage</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Requirement <ArrowRightIcon /> evidence mapping</h2>
          <p className="mt-1 text-sm text-slate-600">
            Uses the same active-source and compliance authority as final release. Section maps remain
            visible context but do not independently mark a requirement covered.
          </p>
        </div>
        <div className="flex gap-3 text-center">
          <div className="rounded-xl border bg-emerald-50 px-4 py-2">
            <p className="text-xs text-emerald-600">Covered</p>
            <p className="text-xl font-bold text-emerald-700">{coveredCount}</p>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-2">
            <p className="text-xs text-amber-600">Partial</p>
            <p className="text-xl font-bold text-amber-700">{partialCount}</p>
          </div>
          <div className="rounded-xl border bg-orange-50 px-4 py-2">
            <p className="text-xs text-orange-600">Needs trace</p>
            <p className="text-xl font-bold text-orange-700">{needsTraceCount}</p>
          </div>
          <div className="rounded-xl border bg-red-50 px-4 py-2">
            <p className="text-xs text-red-600">Uncovered</p>
            <p className="text-xl font-bold text-red-700">{uncoveredCount}</p>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <div className="rounded-lg border bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Selected reviewed experts</p>
          <p className="font-bold text-slate-900">{reviewedExperts.length}</p>
        </div>
        <div className="rounded-lg border bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Selected reviewed projects</p>
          <p className="font-bold text-slate-900">{reviewedProjects.length}</p>
        </div>
        <div className="rounded-lg border bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Section evidence maps</p>
          <p className="font-bold text-slate-900">{sectionMaps.length}</p>
        </div>
        <div className="rounded-lg border bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Compliance matrix entries</p>
          <p className="font-bold text-slate-900">{complianceEvidenceCount}</p>
        </div>
      </div>

      {autoLinkedCount > 0 && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <strong>{autoLinkedCount} section link(s) were auto-inferred from generated section text.</strong> They are informational until a traced compliance-matrix decision is recorded.
        </div>
      )}

      {mandatoryReqs.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Mandatory / Critical requirements</p>
          <div className="space-y-2">
            {mandatoryReqs.map((req) => {
              const sections = reqSections.get(req.id) ?? [];
              const state = getCoverageState(req);
              return (
                <div key={req.id} className={`rounded-xl border p-3 ${state === "COVERED" ? "border-emerald-100 bg-emerald-50" : state === "PARTIAL" ? "border-amber-100 bg-amber-50" : state === "NEEDS_TRACE" ? "border-orange-100 bg-orange-50" : "border-red-100 bg-red-50"}`}>
                  <div className="flex flex-wrap items-start gap-2 justify-between">
                    <p className="text-sm font-medium text-slate-900 flex-1">{req.title}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {coverageBadge(state)}
                    </div>
                  </div>
                  {sections.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sections.map((s) => (
                        <div key={`${s.sectionTitle}-${s.autoLinked ? "auto" : "explicit"}`} className="flex items-center gap-1 rounded-md bg-white/70 border px-2 py-0.5 text-xs">
                          <span className="text-slate-700">{s.sectionTitle}</span>
                          {reviewBadge(s.reviewerStatus, s.autoLinked)}
                          {s.wordCount > 0 && <span className="text-slate-400">{s.wordCount}w</span>}
                        </div>
                      ))}
                    </div>
                  ) : req.complianceMatrixRows.length === 0 ? (
                    <p className="mt-1 text-xs text-red-700">No section evidence map or compliance-matrix entry covers this requirement. Generate documents or manually link evidence.</p>
                  ) : null}
                  {req.complianceMatrixRows.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {req.complianceMatrixRows.map((mr) => (
                        <div key={mr.id} className="flex items-center gap-1 rounded-md bg-white/70 border px-2 py-0.5 text-xs">
                          <span className="text-slate-700">{mr.evidenceType}{mr.evidenceReference ? `: ${mr.evidenceReference}` : ""}</span>
                          {evidenceBadge(mr.supportLevel)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {otherReqs.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">{otherReqs.length} non-mandatory requirement(s) not shown.</p>
      )}

      {(reviewedExperts.length > 0 || reviewedProjects.length > 0) && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Selected reviewed vault evidence</p>
          <div className="flex flex-wrap gap-2">
            {reviewedExperts.slice(0, 8).map((m) => (
              <div key={m.expert?.id ?? m.id} className="rounded-lg border bg-blue-50 px-2 py-1 text-xs">
                <p className="font-medium text-blue-800">{m.expert?.fullName ?? "Expert"}</p>
                {m.expert?.title && <p className="text-blue-600">{m.expert.title}</p>}
              </div>
            ))}
            {reviewedProjects.slice(0, 8).map((m) => (
              <div key={m.project?.id ?? m.id} className="rounded-lg border bg-violet-50 px-2 py-1 text-xs">
                <p className="font-medium text-violet-800">{m.project?.name ?? "Project"}</p>
                {m.project?.clientName && <p className="text-violet-600">{m.project.clientName}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {uncoveredCount > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>{uncoveredCount} mandatory requirement(s) have no evidence section.</strong> Run document generation to create section evidence maps, or manually add evidence before export. Uncovered mandatory requirements are a compliance risk.
        </div>
      )}

      {sectionMaps.length === 0 && (
        <p className="mt-3 text-xs text-slate-500">
          No section evidence maps found. Generate documents to populate evidence coverage. Section evidence maps are created automatically during proposal generation.
        </p>
      )}
    </section>
  );
  } catch (err) {
    clientLogger.error("[EvidenceCoveragePanel] render error:", err instanceof Error ? { message: err.message } : { error: String(err) });
    return <PanelErrorFallback panelName="Evidencecoveragepanel" />
  }
}
