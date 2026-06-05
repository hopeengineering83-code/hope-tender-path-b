// Vault Evidence Search Panel — server component.
// Shows available vault evidence (experts, projects) for the current tender.
// Surfaces coverage gaps: reviewed vault items not yet selected.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { ensureCompanyForUser } from "../lib/company-workspace";
import Link from "next/link";

interface Props {
  tenderId: string;
}

function TrustBadge({ level }: { level: string }) {
  if (level === "REVIEWED") {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 text-green-700">
        REVIEWED
      </span>
    );
  }
  if (level === "AI_DRAFT") {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">
        AI DRAFT
      </span>
    );
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">
      REGEX DRAFT
    </span>
  );
}

function SelectionDot({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <span
        title="Selected for this tender"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      title="Available — not yet selected for this tender"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-slate-400 text-[10px]"
    >
      ○
    </span>
  );
}

export default async function VaultEvidenceSearchPanel({ tenderId }: Props) {
  const userId = await getSession();
  if (!userId) return null;

  try {
  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  // Load experts grouped by trust level (active only, max 50 for server render)
  const [allExperts, allProjects, expertMatches, projectMatches] = await Promise.all([
    prisma.expert.findMany({
      where: { companyId: company.id, deletedAt: null, isActive: true },
      select: {
        id: true,
        fullName: true,
        title: true,
        disciplines: true,
        trustLevel: true,
      },
      orderBy: [{ trustLevel: "asc" }, { fullName: "asc" }],
      take: 50,
    }),
    prisma.project.findMany({
      where: { companyId: company.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        clientName: true,
        sector: true,
        country: true,
        trustLevel: true,
      },
      orderBy: [{ trustLevel: "asc" }, { name: "asc" }],
      take: 50,
    }),
    prisma.tenderExpertMatch.findMany({
      where: { tenderId },
      select: { expertId: true, isSelected: true },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId },
      select: { projectId: true, isSelected: true },
    }),
  ]);

  const selectedExpertIds = new Set(
    expertMatches.filter((m) => m.isSelected).map((m) => m.expertId)
  );
  const matchedExpertIds = new Set(expertMatches.map((m) => m.expertId));
  const selectedProjectIds = new Set(
    projectMatches.filter((m) => m.isSelected).map((m) => m.projectId)
  );
  const matchedProjectIds = new Set(projectMatches.map((m) => m.projectId));

  // Parse disciplines JSON (stored as JSON string in schema)
  function parseDisciplines(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const reviewedExperts = allExperts.filter((e) => e.trustLevel === "REVIEWED");
  const aiDraftExperts = allExperts.filter((e) => e.trustLevel === "AI_DRAFT");
  const regexDraftExperts = allExperts.filter((e) => e.trustLevel === "REGEX_DRAFT");

  const reviewedProjects = allProjects.filter((p) => p.trustLevel === "REVIEWED");
  const aiDraftProjects = allProjects.filter((p) => p.trustLevel === "AI_DRAFT");
  const regexDraftProjects = allProjects.filter((p) => p.trustLevel === "REGEX_DRAFT");

  const selectedReviewedExperts = reviewedExperts.filter((e) => selectedExpertIds.has(e.id)).length;
  const selectedReviewedProjects = reviewedProjects.filter((p) => selectedProjectIds.has(p.id)).length;

  const hasVaultContent = allExperts.length > 0 || allProjects.length > 0;

  if (!hasVaultContent) {
    return (
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-slate-900">
          Vault Evidence — coverage for this tender
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          No vault records found. Import CV documents and project references to build your evidence vault.
        </p>
        <Link
          href="/dashboard/company/review"
          className="inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Set up Vault
        </Link>
      </section>
    );
  }

  // Show max 10 REVIEWED items in the panel
  const displayExperts = reviewedExperts.slice(0, 10);
  const displayProjects = reviewedProjects.slice(0, 10);

  // Group projects by sector for display
  const sectorMap = new Map<string, typeof displayProjects>();
  for (const p of displayProjects) {
    const s = p.sector ?? "Unclassified";
    if (!sectorMap.has(s)) sectorMap.set(s, []);
    sectorMap.get(s)!.push(p);
  }

  return (
    <section className="rounded-2xl border bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Vault Evidence — coverage for this tender
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Reviewed vault items that can be used in proposal generation
          </p>
        </div>
        <Link
          href="/dashboard/company/review"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Manage Vault
        </Link>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-4 border-b px-6 py-4 sm:grid-cols-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-slate-900">{reviewedExperts.length}</p>
          <p className="text-xs text-slate-500">Reviewed experts</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-slate-900">{reviewedProjects.length}</p>
          <p className="text-xs text-slate-500">Reviewed projects</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{selectedReviewedExperts}</p>
          <p className="text-xs text-slate-500">Experts selected</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{selectedReviewedProjects}</p>
          <p className="text-xs text-slate-500">Projects selected</p>
        </div>
      </div>

      {/* Coverage gap alert */}
      {reviewedExperts.length > 0 && selectedReviewedExperts === 0 && (
        <div className="border-b bg-amber-50 px-6 py-3">
          <p className="text-sm font-medium text-amber-800">
            Coverage gap: {reviewedExperts.length} reviewed expert{reviewedExperts.length !== 1 ? "s" : ""} available but none selected for this tender.
            Run AI Match or manually select experts in the Matching panel.
          </p>
        </div>
      )}
      {reviewedProjects.length > 0 && selectedReviewedProjects === 0 && (
        <div className="border-b bg-amber-50 px-6 py-3">
          <p className="text-sm font-medium text-amber-800">
            Coverage gap: {reviewedProjects.length} reviewed project{reviewedProjects.length !== 1 ? "s" : ""} available but none selected for this tender.
            Run AI Match or manually select projects in the Matching panel.
          </p>
        </div>
      )}

      <div className="divide-y">
        {/* Experts section */}
        <div className="px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              Experts
              <span className="ml-2 text-xs font-normal text-slate-400">
                ({reviewedExperts.length} reviewed · {aiDraftExperts.length} AI draft · {regexDraftExperts.length} regex draft)
              </span>
            </h3>
          </div>

          {displayExperts.length === 0 ? (
            <p className="text-sm text-slate-400 italic">
              No reviewed experts yet.{" "}
              <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
                Review drafts to promote them.
              </Link>
            </p>
          ) : (
            <ul className="space-y-2">
              {displayExperts.map((expert) => {
                const disciplines = parseDisciplines(expert.disciplines as unknown as string);
                const isSelected = selectedExpertIds.has(expert.id);
                const isMatched = matchedExpertIds.has(expert.id);
                return (
                  <li
                    key={expert.id}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
                      isSelected
                        ? "bg-emerald-50 border border-emerald-100"
                        : isMatched
                        ? "bg-slate-50 border border-slate-100"
                        : "bg-white border border-slate-100"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      <SelectionDot selected={isSelected} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 truncate">{expert.fullName}</p>
                      {expert.title && (
                        <p className="text-xs text-slate-500 truncate">{expert.title}</p>
                      )}
                      {disciplines.length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-400 truncate">
                          {disciplines.slice(0, 2).join(" · ")}
                          {disciplines.length > 2 && ` +${disciplines.length - 2}`}
                        </p>
                      )}
                    </div>
                    <TrustBadge level={expert.trustLevel ?? "REGEX_DRAFT"} />
                  </li>
                );
              })}
              {reviewedExperts.length > 10 && (
                <li className="text-xs text-slate-400 pl-3">
                  + {reviewedExperts.length - 10} more reviewed experts in vault
                </li>
              )}
            </ul>
          )}

          {/* Draft counts as info */}
          {(aiDraftExperts.length > 0 || regexDraftExperts.length > 0) && (
            <p className="mt-3 text-xs text-slate-400">
              {aiDraftExperts.length + regexDraftExperts.length} draft expert{aiDraftExperts.length + regexDraftExperts.length !== 1 ? "s" : ""} pending review — not eligible for generation.{" "}
              <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
                Review now
              </Link>
            </p>
          )}
        </div>

        {/* Projects section */}
        <div className="px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              Projects
              <span className="ml-2 text-xs font-normal text-slate-400">
                ({reviewedProjects.length} reviewed · {aiDraftProjects.length} AI draft · {regexDraftProjects.length} regex draft)
              </span>
            </h3>
          </div>

          {displayProjects.length === 0 ? (
            <p className="text-sm text-slate-400 italic">
              No reviewed projects yet.{" "}
              <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
                Review drafts to promote them.
              </Link>
            </p>
          ) : (
            <div className="space-y-4">
              {Array.from(sectorMap.entries()).map(([sector, projects]) => (
                <div key={sector}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {sector}
                  </p>
                  <ul className="space-y-2">
                    {projects.map((project) => {
                      const isSelected = selectedProjectIds.has(project.id);
                      const isMatched = matchedProjectIds.has(project.id);
                      return (
                        <li
                          key={project.id}
                          className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
                            isSelected
                              ? "bg-emerald-50 border border-emerald-100"
                              : isMatched
                              ? "bg-slate-50 border border-slate-100"
                              : "bg-white border border-slate-100"
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            <SelectionDot selected={isSelected} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900 truncate">{project.name}</p>
                            <p className="text-xs text-slate-500 truncate">
                              {[project.clientName, project.country]
                                .filter(Boolean)
                                .join(" · ") || "No client / country"}
                            </p>
                          </div>
                          <TrustBadge level={project.trustLevel ?? "REGEX_DRAFT"} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {reviewedProjects.length > 10 && (
                <p className="text-xs text-slate-400 pl-3">
                  + {reviewedProjects.length - 10} more reviewed projects in vault
                </p>
              )}
            </div>
          )}

          {(aiDraftProjects.length > 0 || regexDraftProjects.length > 0) && (
            <p className="mt-3 text-xs text-slate-400">
              {aiDraftProjects.length + regexDraftProjects.length} draft project{aiDraftProjects.length + regexDraftProjects.length !== 1 ? "s" : ""} pending review — not eligible for generation.{" "}
              <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
                Review now
              </Link>
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="rounded-b-2xl border-t bg-slate-50 px-6 py-3">
        <p className="text-xs text-slate-500">
          Only <span className="font-semibold text-slate-700">REVIEWED</span> vault items are used in final proposal generation.{" "}
          <Link href="/dashboard/company/review" className="text-blue-600 hover:underline">
            Manage vault records
          </Link>
        </p>
      </div>
    </section>
  );
  } catch (err) {
    console.error("[VaultEvidenceSearchPanel] render error:", err);
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-semibold text-amber-700">Panel failed to load — data may be incomplete. Refresh to retry.</p>
      </section>
    );
  }
}
