// AI Copilot Suggestions Panel — server component.
// Derives actionable suggestions from tender state without calling any AI API.
// Rule-based: fast, free, always available.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";

type Suggestion = { icon: string; title: string; detail: string; priority: "HIGH" | "MEDIUM" | "LOW" };

export async function AICopilotSuggestionsPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;

    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        analysisSummary: true,
        analysisExtractionStatus: true,
        metadataContaminated: true,
        clientName: true,
        country: true,
        deadline: true,
        currency: true,
        submissionMethod: true,
        submissionEmails: true,
        exactFileNaming: true,
        status: true,
        requirements: { select: { priority: true, sourceConfidence: true, sourcePageNumber: true }, take: 100 },
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          select: { generationStatus: true, validationStatus: true },
        },
        complianceGaps: { where: { isResolved: false }, select: { severity: true } },
        files: { select: { extractionScore: true, totalPages: true, extractedPages: true } },
      },
    }).catch(() => null);

    if (!tender) return null;

    const suggestions: Suggestion[] = [];

    // 1. No analysis yet
    if (!tender.analysisSummary) {
      suggestions.push({
        icon: "🔍",
        title: "Run AI Analyze",
        detail: "No analysis yet — AI Analyze extracts requirements, client details, and evaluation criteria automatically.",
        priority: "HIGH",
      });
    }

    // 2. Weak/partial extraction analysis
    if (
      tender.analysisExtractionStatus &&
      (tender.analysisExtractionStatus.includes("PARTIAL") || tender.analysisExtractionStatus.includes("WEAK"))
    ) {
      suggestions.push({
        icon: "⚠",
        title: "Re-run AI Analyze on weak extraction",
        detail: "Analysis ran on partial extraction. Re-uploading a cleaner PDF and re-running will improve requirement coverage.",
        priority: "HIGH",
      });
    }

    // 3. Missing/contaminated metadata
    if (tender.metadataContaminated || !(tender.clientName || (tender as Record<string, unknown>).procuringEntityName) || !tender.country || !tender.deadline) {
      suggestions.push({
        icon: "📋",
        title: "Complete missing metadata",
        detail: "Client name, country, or deadline is missing or contaminated. Fill these before building the submission plan.",
        priority: "HIGH",
      });
    }

    // 4. Mandatory requirements without source traceability > 30%
    if (suggestions.length < 6) {
      const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY");
      if (mandatoryReqs.length > 0) {
        const untraced = mandatoryReqs.filter(
          (r) => (r.sourceConfidence ?? 0) === 0 && r.sourcePageNumber == null,
        );
        const untracedCount = untraced.length;
        if (untracedCount / mandatoryReqs.length > 0.3) {
          suggestions.push({
            icon: "📌",
            title: "Improve requirement traceability",
            detail: `${untracedCount} mandatory requirement(s) lack source page/quote. Run AI Analyze again or use the repair tool.`,
            priority: "MEDIUM",
          });
        }
      }
    }

    // 5. No submission plan
    if (suggestions.length < 6) {
      const planIsEmpty =
        !tender.exactFileNaming ||
        tender.exactFileNaming.trim() === "" ||
        tender.exactFileNaming.trim() === "[]";
      if (planIsEmpty) {
        suggestions.push({
          icon: "📁",
          title: "Build your submission plan",
          detail: "No submission plan yet. Build Plan to define exactly which files to submit, in what format and order.",
          priority: "MEDIUM",
        });
      }
    }

    // 6. Low average extraction score
    if (suggestions.length < 6 && tender.files.length > 0) {
      const scores = tender.files
        .map((f) => f.extractionScore)
        .filter((s): s is number => s != null);
      if (scores.length > 0) {
        const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        if (avgScore < 60) {
          suggestions.push({
            icon: "📄",
            title: "Improve extraction quality",
            detail: `Average extraction score ${avgScore}/100. Consider enabling OCR or uploading a clearer scan.`,
            priority: "MEDIUM",
          });
        }
      }
    }

    // 7. Critical compliance gaps
    if (suggestions.length < 6) {
      const criticalGaps = tender.complianceGaps.filter((g) => g.severity === "CRITICAL").length;
      if (criticalGaps > 0) {
        suggestions.push({
          icon: "🚨",
          title: "Resolve critical compliance gaps",
          detail: `${criticalGaps} critical gap(s) will block export. Review and resolve them now.`,
          priority: "HIGH",
        });
      }
    }

    // 8. Generated docs not all validated
    if (suggestions.length < 6 && tender.generatedDocuments.length > 0) {
      const generatedDocs = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
      const unvalidated = generatedDocs.filter(
        (d) => !["PASSED", "VALIDATED", "APPROVED"].includes((d.validationStatus ?? "").toUpperCase()),
      );
      if (generatedDocs.length > 0 && unvalidated.length > 0) {
        suggestions.push({
          icon: "✅",
          title: "Validate generated documents",
          detail: "Documents are generated but not all have been reviewed and approved. Complete validation to unlock export.",
          priority: "MEDIUM",
        });
      }
    }

    // 9. Deadline within 7 days and tender not exported
    if (suggestions.length < 6 && tender.deadline && tender.status !== "EXPORTED" && tender.status !== "CLOSED") {
      const daysLeft = Math.ceil((new Date(tender.deadline).getTime() - Date.now()) / 86_400_000);
      if (daysLeft >= 0 && daysLeft <= 7) {
        suggestions.push({
          icon: "⏰",
          title: "Deadline approaching",
          detail: `Submission deadline is in ${daysLeft} day(s). Prioritize export readiness.`,
          priority: "HIGH",
        });
      }
    }

    if (suggestions.length === 0) return null;

    return (
      <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Copilot Suggestions</p>
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <div
              key={s.title}
              className={`flex items-start gap-3 rounded-xl p-3 ${
                s.priority === "HIGH"
                  ? "bg-red-50 border border-red-100"
                  : s.priority === "MEDIUM"
                  ? "bg-amber-50 border border-amber-100"
                  : "bg-slate-50 border border-slate-100"
              }`}
            >
              <span className="text-xl">{s.icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  } catch (err) {
    console.error("[AICopilotSuggestionsPanel] render error:", err);
    return null;
  }
}
