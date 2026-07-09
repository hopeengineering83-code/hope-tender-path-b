// GET /api/tenders/[id]/fact-parity
//
// Read-only diagnostic endpoint that compares what each layer considers
// the "effective" value for each tender fact. Used to detect contradictions
// between Tender Detail display, canonical readiness, analysis quality,
// and the effective facts authority.
//
// Returns a sanitized comparison — never exposes full source text, full
// source quotes, file bytes, provider keys, or secrets.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getEffectiveTenderFacts } from "../../../../../lib/engine/effective-tender-facts";
import { getTenderFactLedgerSnapshot } from "../../../../../lib/engine/tender-facts-ledger-service";
import { buildTenderFactSourceText, parseTenderDocumentIntelligence, normalizeEmailList } from "../../../../../lib/engine/source-driven-tender-text-parser";
import { resolveCanonicalFieldState } from "../../../../../lib/engine/canonical-field-state";

export const dynamic = "force-dynamic";

type FieldParity = {
  key: string;
  scalarValue: string | null;
  parserValue: string | null;
  ledgerValue: string | null;
  canonicalValue: string | null;
  effectiveValue: string | null;
  status: string;
  contradiction: boolean;
  contradictionReason: string | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  // Tenant ownership check
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: {
      id: true, title: true, reference: true, clientName: true, procuringEntityName: true,
      deadline: true, submissionMethod: true, submissionEmails: true, submissionAddress: true,
      submissionEmailSubject: true, country: true, evaluationMethodology: true, description: true,
      intakeSummary: true, analysisSummary: true, metadataContaminated: true,
      analysisExtractionStatus: true,
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true } },
    },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  // Load effective facts
  const effective = await getEffectiveTenderFacts(prisma, tenderId, actor.id).catch(() => null);

  // Load parser facts
  const sourceText = buildTenderFactSourceText({
    extractedText: tender.files?.map((f) => f.extractedText).filter(Boolean).join("\n\n") || null,
    intakeSummary: tender.intakeSummary,
    analysisSummary: tender.analysisSummary,
    description: tender.description,
    evaluationMethodology: tender.evaluationMethodology,
  });
  const intelligence = sourceText.trim()
    ? parseTenderDocumentIntelligence(sourceText, {
        tenderTitle: tender.title,
        tenderReference: tender.reference,
        tenderClientName: tender.clientName,
        tenderSubmissionMethod: tender.submissionMethod,
        tenderDeadline: tender.deadline,
        tenderSubmissionEmails: tender.submissionEmails,
        tenderSubmissionAddress: tender.submissionAddress,
      })
    : null;

  // Load ledger snapshot
  let ledgerSnapshot: Awaited<ReturnType<typeof getTenderFactLedgerSnapshot>> | null = null;
  try {
    ledgerSnapshot = await getTenderFactLedgerSnapshot(prisma, tenderId);
  } catch {
    ledgerSnapshot = null;
  }

  // Load canonical field state
  const canonicalState = resolveCanonicalFieldState({
    tender: tender as any,
    overrides: [],
    activeTenderFileIds: new Set(tender.files?.map((f) => f.id) ?? []),
    activeFiles: [],
    hasExtractedRequirements: true,
    ...(ledgerSnapshot ? { ledgerFacts: ledgerSnapshot.facts } : {}),
  });

  // Build parity comparison for each required key
  const keys = [
    "deadline", "submissionMethod", "submissionEmails", "submissionEmailSubject",
    "submissionAddress", "financialProposalRequired", "reference", "clientName",
    "country", "evaluationMethodology", "requiredDocuments",
  ];

  const fields: FieldParity[] = keys.map((key) => {
    // Scalar value
    const scalarValue = getScalarValue(tender, key);

    // Parser value
    const parserValue = getParserValue(intelligence, key);

    // Ledger value
    const ledgerFact = ledgerSnapshot?.facts.find((f) => f.semanticKey === key);
    const ledgerValue = ledgerFact?.normalizedValue ?? ledgerFact?.rawSourceValue ?? null;

    // Canonical value
    const canonicalField = canonicalState.fields.find((f) => f.fieldKey === key);
    const canonicalValue = canonicalField?.effectiveValue ?? null;

    // Effective value
    const effectiveValue = getEffectiveValue(effective, key);

    // Detect contradiction: scalar says null/missing but parser/effective has a value
    let contradiction = false;
    let contradictionReason: string | null = null;

    if (scalarValue === null && (parserValue !== null || effectiveValue !== null)) {
      contradiction = true;
      contradictionReason = `Scalar is null but parser/effective has a value`;
    }
    if (canonicalValue === null && effectiveValue !== null) {
      contradiction = true;
      contradictionReason = `Canonical is null but effective has a value`;
    }

    // Status
    let status = "missing";
    if (effectiveValue !== null) status = "resolved";
    else if (scalarValue !== null) status = "scalar_only";

    return { key, scalarValue, parserValue, ledgerValue, canonicalValue, effectiveValue, status, contradiction, contradictionReason };
  });

  const hasAnyContradiction = fields.some((f) => f.contradiction);

  return NextResponse.json({
    ok: true,
    tenderId,
    fields,
    hasContradiction: hasAnyContradiction,
  });
}

function getScalarValue(tender: any, key: string): string | null {
  switch (key) {
    case "deadline": return tender.deadline ? new Date(tender.deadline).toISOString() : null;
    case "submissionMethod": return tender.submissionMethod ?? null;
    case "submissionEmails": return tender.submissionEmails ?? null;
    case "submissionEmailSubject": return tender.submissionEmailSubject ?? null;
    case "submissionAddress": return tender.submissionAddress ?? null;
    case "financialProposalRequired": return null; // Not a scalar field
    case "reference": return tender.reference ?? null;
    case "clientName": return tender.clientName ?? tender.procuringEntityName ?? null;
    case "country": return tender.country ?? null;
    case "evaluationMethodology": return tender.evaluationMethodology ?? null;
    case "requiredDocuments": return null; // Not a scalar field
    default: return null;
  }
}

function getParserValue(intelligence: any, key: string): string | null {
  if (!intelligence) return null;
  switch (key) {
    case "deadline": return intelligence.submissionInstructions?.deadlineDisplay ?? null;
    case "submissionMethod": return intelligence.submissionInstructions?.method && intelligence.submissionInstructions.method !== "Unknown"
      ? intelligence.submissionInstructions.method : null;
    case "submissionEmails": return intelligence.submissionInstructions?.emails?.length
      ? intelligence.submissionInstructions.emails.join(", ") : null;
    case "submissionEmailSubject": return intelligence.submissionInstructions?.emailSubject ?? null;
    case "submissionAddress": return intelligence.submissionInstructions?.physicalAddress ?? null;
    case "financialProposalRequired": return intelligence.financialProposalRequired !== undefined
      ? String(intelligence.financialProposalRequired) : null;
    case "reference": return null;
    case "clientName": return intelligence.clientOrProcuringEntity ?? null;
    case "country": return null;
    case "evaluationMethodology": return intelligence.evaluationMethodology?.methodology ?? null;
    case "requiredDocuments": return intelligence.requiredDocuments?.length
      ? intelligence.requiredDocuments.map((d: any) => d.name).join(", ") : null;
    default: return null;
  }
}

function getEffectiveValue(effective: any, key: string): string | null {
  if (!effective) return null;
  switch (key) {
    case "deadline": return effective.deadlineDisplay ?? effective.deadlineIso ?? null;
    case "submissionMethod": return effective.submissionMethod && effective.submissionMethod !== "Unknown"
      ? effective.submissionMethod : null;
    case "submissionEmails": return effective.submissionEmails?.length
      ? effective.submissionEmails.join(", ") : null;
    case "submissionEmailSubject": return effective.submissionEmailSubject ?? null;
    case "submissionAddress": return effective.submissionAddress ?? null;
    case "financialProposalRequired": return effective.financialProposalRequired !== undefined
      ? String(effective.financialProposalRequired) : null;
    case "reference": return effective.referenceNumber ?? null;
    case "clientName": return effective.clientOrProcuringEntity ?? null;
    case "country": return effective.country ?? null;
    case "evaluationMethodology": return effective.evaluationMethodology ?? null;
    case "requiredDocuments": return effective.requiredDocuments?.length
      ? effective.requiredDocuments.join(", ") : null;
    default: return null;
  }
}
