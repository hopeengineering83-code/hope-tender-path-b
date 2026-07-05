// Evidence graph (G2 fix)
//
// THE PROBLEM
// ───────────
// Before this module, the Tender AI Copilot returned `evidenceReferences`
// as free-form strings produced by Claude. They could read like:
//
//   "Selected expert Ahmed Kebede; Compliance Gap #3"
//
// Strings are easy to fabricate. The user couldn't click them, the server
// couldn't verify them, and prior projects' clients sometimes leaked
// in as the "client of THIS tender."
//
// THE FIX
// ───────
// 1. Build an in-memory evidence graph keyed by stable IDs:
//      requirementId      → TenderRequirement.id
//      tenderFileId       → TenderFile.id
//      companyDocumentId  → CompanyDocument.id
//      expertId           → Expert.id
//      projectId          → Project.id
//      projectEvidenceId  → ProjectEvidence.id
//      generatedDocumentId→ GeneratedDocument.id
//      complianceMatrixId → ComplianceMatrix.id
//      complianceGapId    → ComplianceGap.id
//
// 2. Force AI consumers (Copilot, evaluator, scorer) to return
//    `evidenceIds` arrays alongside any free-text references.
//
// 3. Server-side `verifyEvidenceIds()` filters out any ID the graph
//    doesn't contain BEFORE returning to the UI. Hallucinations vanish.
//
// 4. `expandEvidenceIds()` takes the verified IDs and returns the
//    full source object (kind, label, snippet, link) so the UI can
//    render "Evidence used" with click-through and exact snippet.
//
// This file does NOT do AI calls. It is pure: graph in / verified
// snippets out. The AI is asked for IDs and the server enforces
// integrity.

import { prisma, prismaReady } from "./prisma";

export type EvidenceKind =
  | "REQUIREMENT"
  | "TENDER_FILE"
  | "COMPANY_DOCUMENT"
  | "EXPERT"
  | "PROJECT"
  | "PROJECT_EVIDENCE"
  | "GENERATED_DOCUMENT"
  | "COMPLIANCE_MATRIX"
  | "COMPLIANCE_GAP";

export type EvidenceNode = {
  id: string;
  kind: EvidenceKind;
  label: string;
  // optional 0–500 char snippet — quoted verbatim from the source so
  // the UI can show "exact text from page 7" rather than an AI summary.
  snippet?: string;
  // optional URL/path that opens the source artefact (file, expert page,
  // project page, etc.). Always begins with "/" so it's relative.
  link?: string;
};

export type EvidenceGraph = {
  tenderId: string;
  byId: Map<string, EvidenceNode>;
  byKind: Map<EvidenceKind, EvidenceNode[]>;
};

/**
 * Builds the evidence graph for a tender. Idempotent and read-only.
 * Pull the related rows once, build a Map keyed by ID, return the graph.
 *
 * Performance note: each entity is selected with the smallest possible
 * column set so the graph fits comfortably even for tenders with hundreds
 * of compliance rows or thousands of expert evidences.
 */
export async function buildEvidenceGraph(tenderId: string, companyId: string | null): Promise<EvidenceGraph> {
  await prismaReady;

  const byId = new Map<string, EvidenceNode>();
  const byKind = new Map<EvidenceKind, EvidenceNode[]>();
  const push = (node: EvidenceNode) => {
    byId.set(node.id, node);
    const list = byKind.get(node.kind) ?? [];
    list.push(node);
    byKind.set(node.kind, list);
  };

  // Tender-level evidence
  const [requirements, tenderFiles, complianceRows, complianceGaps, generatedDocs] = await Promise.all([
    prisma.tenderRequirement.findMany({
      where: { tenderId },
      select: {
        id: true, code: true, title: true, description: true, priority: true,
        sourcePageNumber: true, sourceSectionHeading: true, sourceExactQuote: true, sourceTenderFileId: true,
      },
    }),
    prisma.tenderFile.findMany({
      where: { tenderId },
      select: { id: true, originalFileName: true, classification: true },
    }),
    prisma.complianceMatrix.findMany({
      where: { tenderId },
      select: { id: true, evidenceType: true, evidenceSource: true, evidenceReference: true, supportLevel: true },
    }),
    prisma.complianceGap.findMany({
      where: { tenderId },
      select: { id: true, severity: true, title: true, description: true },
    }),
    prisma.generatedDocument.findMany({
      where: { tenderId },
      select: { id: true, name: true, documentType: true, reviewStatus: true },
    }),
  ]);

  for (const r of requirements) {
    const headerBits: string[] = [];
    if (r.code) headerBits.push(r.code);
    if (r.priority) headerBits.push(r.priority);
    push({
      id: r.id,
      kind: "REQUIREMENT",
      label: `${headerBits.length ? `[${headerBits.join(" • ")}] ` : ""}${r.title}`,
      snippet: (r.sourceExactQuote ?? r.description ?? "").slice(0, 500),
      link: `/dashboard/tenders/${tenderId}/requirements#${r.id}`,
    });
  }
  for (const f of tenderFiles) {
    push({
      id: f.id,
      kind: "TENDER_FILE",
      label: `${f.originalFileName}${f.classification ? ` (${f.classification})` : ""}`,
      link: `/dashboard/tenders/${tenderId}/files#${f.id}`,
    });
  }
  for (const c of complianceRows) {
    push({
      id: c.id,
      kind: "COMPLIANCE_MATRIX",
      label: `${c.evidenceType} • ${c.supportLevel}`,
      snippet: (c.evidenceReference ?? c.evidenceSource ?? "").slice(0, 500),
    });
  }
  for (const g of complianceGaps) {
    push({
      id: g.id,
      kind: "COMPLIANCE_GAP",
      label: `[${g.severity}] ${g.title}`,
      snippet: g.description.slice(0, 500),
    });
  }
  for (const d of generatedDocs) {
    push({
      id: d.id,
      kind: "GENERATED_DOCUMENT",
      label: `${d.name} (${d.reviewStatus})`,
      link: `/dashboard/tenders/${tenderId}/documents#${d.id}`,
    });
  }

  // Company-level evidence (only if companyId is available)
  if (companyId) {
    const [experts, projects, projectEvidence, companyDocs] = await Promise.all([
      prisma.expert.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, fullName: true, title: true, profile: true },
      }),
      prisma.project.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, name: true, clientName: true, summary: true },
      }),
      prisma.projectEvidence.findMany({
        where: { project: { companyId } },
        select: { id: true, title: true, evidenceType: true, description: true, projectId: true },
      }),
      prisma.companyDocument.findMany({
        where: { companyId },
        select: { id: true, originalFileName: true, classification: true },
      }),
    ]);

    for (const e of experts) {
      push({
        id: e.id,
        kind: "EXPERT",
        label: `${e.fullName}${e.title ? ` — ${e.title}` : ""}`,
        snippet: (e.profile ?? "").slice(0, 500),
        link: `/dashboard/experts#${e.id}`,
      });
    }
    for (const p of projects) {
      push({
        id: p.id,
        kind: "PROJECT",
        label: `${p.name}${p.clientName ? ` — ${p.clientName}` : ""}`,
        snippet: (p.summary ?? "").slice(0, 500),
        link: `/dashboard/projects#${p.id}`,
      });
    }
    for (const pe of projectEvidence) {
      push({
        id: pe.id,
        kind: "PROJECT_EVIDENCE",
        label: `${pe.title} (${pe.evidenceType})`,
        snippet: (pe.description ?? "").slice(0, 500),
        link: `/dashboard/projects#${pe.projectId}`,
      });
    }
    for (const d of companyDocs) {
      push({
        id: d.id,
        kind: "COMPANY_DOCUMENT",
        label: `${d.originalFileName}${d.classification ? ` (${d.classification})` : ""}`,
        link: `/dashboard/documents#${d.id}`,
      });
    }
  }

  return { tenderId, byId, byKind };
}

/**
 * Filter a list of AI-claimed evidence IDs down to ones that exist in
 * the graph. Used by the Copilot route, evaluator simulator, and any
 * other AI consumer that should not be allowed to invent IDs.
 *
 * Returns an object split into verified (real IDs) and dropped (the IDs
 * the AI hallucinated). Logging the dropped list helps debug prompt
 * weaknesses over time.
 */
export function verifyEvidenceIds(graph: EvidenceGraph, claimedIds: string[]): { verified: EvidenceNode[]; dropped: string[] } {
  const verified: EvidenceNode[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of claimedIds) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = graph.byId.get(id);
    if (node) verified.push(node);
    else dropped.push(id);
  }
  return { verified, dropped };
}

/**
 * Build a context block string the AI prompt can include — gives the AI
 * the SHORT list of evidence IDs available to choose from, with a
 * 60-char label per ID. Capped to ~8K characters so it fits any prompt.
 *
 * The AI is instructed: "When you cite evidence, use the IDs from this
 * list. Do not invent IDs. Do not paraphrase the labels."
 */
export function buildEvidencePromptBlock(graph: EvidenceGraph, opts?: { maxPerKind?: number }): string {
  const max = opts?.maxPerKind ?? 30;
  const kinds: EvidenceKind[] = ["REQUIREMENT", "EXPERT", "PROJECT", "COMPLIANCE_GAP", "COMPLIANCE_MATRIX", "GENERATED_DOCUMENT", "TENDER_FILE", "PROJECT_EVIDENCE", "COMPANY_DOCUMENT"];
  const lines: string[] = ["EVIDENCE GRAPH — cite using these EXACT IDs only. Do NOT invent IDs."];
  for (const k of kinds) {
    const items = graph.byKind.get(k) ?? [];
    if (items.length === 0) continue;
    lines.push(`\n${k}:`);
    for (const n of items.slice(0, max)) {
      const labelShort = n.label.replace(/\s+/g, " ").slice(0, 80);
      lines.push(`  ${n.id} | ${labelShort}`);
    }
    if (items.length > max) lines.push(`  ... ${items.length - max} more not shown.`);
  }
  return lines.join("\n").slice(0, 8_000);
}

/**
 * Filter to just the IDs of one kind, e.g. `verifiedNodes.filter(n => n.kind === "EXPERT")`
 * helper so callers don't repeat that boilerplate.
 */
export function nodesByKind(nodes: EvidenceNode[], kind: EvidenceKind): EvidenceNode[] {
  return nodes.filter((n) => n.kind === kind);
}
