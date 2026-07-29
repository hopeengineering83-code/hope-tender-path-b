import { logger } from "../../../../lib/observability";
import { inspectActualFileBytes } from "../../../../lib/engine/persisted-byte-integrity";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { logAction } from "../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { completenessStats, deriveExpectedCounts, hasUsableText } from "./helpers";
import { sanitizeError } from "../../../../lib/sanitize-error";
import { safeParse } from "../../../../lib/safe-json";
import {
  buildReviewProvenance,
  expertReviewFields,
  projectReviewFields,
  legalReviewFields,
  financialReviewFields,
  complianceReviewFields,
  type ReviewSourceDocument,
} from "../../../../lib/vault-review-provenance";

// Vercel route timeout — plan-B import processes all uploaded documents.
// 60 = Hobby max; Pro applies its own plan limit when exceeded.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type TrustLevel = "REVIEWED" | "AI_DRAFT" | "REGEX_DRAFT";

type PlanBExpert = {
  fullName?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  yearsExperience?: number | null;
  disciplines?: string[];
  sectors?: string[];
  certifications?: string[];
  profile?: string | null;
  rawText?: string | null;
  sourceDocument?: string;
  sourcePages?: { start?: number; end?: number };
};

type PlanBProject = {
  name?: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  sectors?: string[];
  serviceAreas?: string[];
  contractValueSummary?: string | null;
  duration?: string | null;
  summary?: string | null;
  rawText?: string | null;
  sourceDocument?: string;
  sourceNo?: number | string;
  sourceEvidence?: string | null;
};

type PlanBCompanyProfile = {
  name?: string;
  legalName?: string | null;
  description?: string | null;
  website?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  country?: string | null;
  serviceLines?: string[];
  sectors?: string[];
  profileSummary?: string | null;
  knowledgeMode?: string | null;
};

type PlanBSourceDocument = {
  fileName?: string;
  title?: string;
  type?: string;
  category?: string;
  pages?: number;
  parsedExperts?: number;
  parsedProjects?: number;
  sha256?: string;
  rawText?: string | null;
};

type PlanBLegalRecord = {
  recordType?: string;
  title?: string;
  authority?: string | null;
  referenceNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
  sourceDocument?: string;
};

type PlanBFinancialRecord = {
  fiscalYear?: number;
  recordType?: string;
  currency?: string | null;
  amount?: number | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  sourceDocument?: string;
};

type PlanBComplianceRecord = {
  complianceType?: string;
  title?: string;
  status?: string;
  evidenceSummary?: string | null;
  referenceNumber?: string | null;
  expiryDate?: string | null;
  metadata?: Record<string, unknown>;
  sourceDocument?: string;
};

type PlanBPayload = {
  schemaVersion?: string;
  sourceDocuments?: PlanBSourceDocument[];
  companyProfile?: PlanBCompanyProfile;
  importPolicy?: { trustLevel?: TrustLevel; reviewNotes?: string; requireRawText?: boolean };
  experts?: PlanBExpert[];
  projects?: PlanBProject[];
  legalRecords?: PlanBLegalRecord[];
  financialRecords?: PlanBFinancialRecord[];
  complianceRecords?: PlanBComplianceRecord[];
  expectedCounts?: {
    experts?: number;
    projects?: number;
  };
  completenessPolicy?: {
    enforceExpectedCounts?: boolean;
  };
};

type PlanBDb = Pick<typeof prisma, "legalRecord" | "financialRecord" | "companyComplianceRecord">;

const planBExpertSchema = z.object({
  fullName: z.string().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  yearsExperience: z.number().nullable().optional(),
  disciplines: z.array(z.string()).optional(),
  sectors: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  profile: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  sourceDocument: z.string().optional(),
  sourcePages: z.object({ start: z.number().optional(), end: z.number().optional() }).optional(),
}).passthrough();

const planBProjectSchema = z.object({
  name: z.string().optional(),
  clientName: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  sectors: z.array(z.string()).optional(),
  serviceAreas: z.array(z.string()).optional(),
  contractValueSummary: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  sourceDocument: z.string().optional(),
  sourceNo: z.union([z.number(), z.string()]).optional(),
  sourceEvidence: z.string().nullable().optional(),
}).passthrough();

const planBPayloadSchema = z.object({
  schemaVersion: z.string().optional(),
  sourceDocuments: z.array(z.object({
    fileName: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    category: z.string().optional(),
    pages: z.number().optional(),
    parsedExperts: z.number().optional(),
    parsedProjects: z.number().optional(),
    sha256: z.string().optional(),
    rawText: z.string().nullable().optional(),
  }).passthrough()).max(2000).optional(),
  companyProfile: z.object({
    name: z.string().optional(),
    legalName: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    serviceLines: z.array(z.string()).optional(),
    sectors: z.array(z.string()).optional(),
    profileSummary: z.string().nullable().optional(),
    knowledgeMode: z.string().nullable().optional(),
  }).passthrough().optional(),
  importPolicy: z.object({
    trustLevel: z.enum(["REVIEWED", "AI_DRAFT", "REGEX_DRAFT"]).optional(),
    reviewNotes: z.string().optional(),
    requireRawText: z.boolean().optional(),
  }).optional(),
  experts: z.array(planBExpertSchema).max(5000).optional(),
  projects: z.array(planBProjectSchema).max(10000).optional(),
  legalRecords: z.array(z.object({
    recordType: z.string().optional(),
    title: z.string().optional(),
    authority: z.string().nullable().optional(),
    referenceNumber: z.string().nullable().optional(),
    issueDate: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    status: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sourceDocument: z.string().optional(),
  }).passthrough()).max(5000).optional(),
  financialRecords: z.array(z.object({
    fiscalYear: z.number().optional(),
    recordType: z.string().optional(),
    currency: z.string().nullable().optional(),
    amount: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sourceDocument: z.string().optional(),
  }).passthrough()).max(5000).optional(),
  complianceRecords: z.array(z.object({
    complianceType: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional(),
    evidenceSummary: z.string().nullable().optional(),
    referenceNumber: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sourceDocument: z.string().optional(),
  }).passthrough()).max(5000).optional(),
  expectedCounts: z.object({
    experts: z.number().int().min(0).optional(),
    projects: z.number().int().min(0).optional(),
  }).optional(),
  completenessPolicy: z.object({
    enforceExpectedCounts: z.boolean().optional(),
  }).optional(),
}).passthrough();

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function raw(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function arr(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(clean).filter(Boolean));
  if (typeof value === "string") return JSON.stringify(value.split(",").map(clean).filter(Boolean));
  return JSON.stringify([]);
}

function key(value: string): string {
  return clean(value).toLowerCase();
}

function sourceText(value: unknown): string | null {
  const text = raw(value);
  return text || null;
}

function normalizeDocumentCategory(doc: PlanBSourceDocument): string {
  const rawCategory = clean(doc.category || doc.type || doc.title || doc.fileName).toLowerCase();
  if (/company|profile|corporate|background/.test(rawCategory)) return "COMPANY_PROFILE";
  if (/legal|registration|license|licence|tin|vat|tax|certificate|competence|supplier/.test(rawCategory)) return "LEGAL_REGISTRATION";
  if (/financial|audit|turnover|asset|profit|statement/.test(rawCategory)) return "FINANCIAL_STATEMENT";
  if (/manual|quality|qa|qc|ethic|anti\s*-?corruption|compliance|policy|procedure|safety/.test(rawCategory)) return "MANUAL";
  if (/expert|cv|resume/.test(rawCategory)) return "EXPERT_CV";
  if (/project|portfolio|reference/.test(rawCategory)) return "PROJECT_REFERENCE";
  return "OTHER";
}

function requestedTrust(payload: PlanBPayload): TrustLevel {
  const requested = payload.importPolicy?.trustLevel;
  return requested === "AI_DRAFT" || requested === "REGEX_DRAFT" || requested === "REVIEWED" ? requested : "REVIEWED";
}

function reviewNotes(payload: PlanBPayload): string {
  return payload.importPolicy?.reviewNotes || "Plan-B exact structured import from externally extracted PDF/DOCX text. Full raw source text is preserved in the record narrative and should be used as the factual source.";
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function readPayload(req: Request): Promise<PlanBPayload> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No JSON file provided.");
    const text = await file.text();
    return planBPayloadSchema.parse(safeParse(text, null)) as PlanBPayload;
  }
  const rawJson = await req.json().catch(() => null);
  if (!rawJson) throw new Error("Request body must be valid JSON");
  return planBPayloadSchema.parse(rawJson) as PlanBPayload;
}

function sourceLine(item: { sourceDocument?: string; sourcePages?: { start?: number; end?: number }; sourceNo?: number | string }) {
  if (!item.sourceDocument && !item.sourcePages && !item.sourceNo) return null;
  const pages = item.sourcePages?.start ? ` pages ${item.sourcePages.start}-${item.sourcePages.end ?? item.sourcePages.start}` : "";
  const no = item.sourceNo ? ` record ${item.sourceNo}` : "";
  return `Source: ${item.sourceDocument ?? "uploaded extraction"}${pages}${no}.`;
}


type PlanBRecordTrustContext = {
  documentByFileName: Map<string, ReviewSourceDocument>;
  importTrust: TrustLevel;
  userId: string;
  now: Date;
  notes: string;
};

type PlanBRecordUpsertResult = { created: number; updated: number; skipped: number; evidenceDowngraded: number; warning: string | null };

// Same evidence gate as the Expert/Project loops above: importPolicy.trustLevel
// (default REVIEWED) is the CALLER's self-declared request, not an authority.
// A record only persists as REVIEWED when it links a real, persisted source
// document whose text genuinely contains the claimed field values
// (buildReviewProvenance's quote-containment check) — otherwise it is
// downgraded to AI_DRAFT regardless of what was requested. Before this fix,
// LegalRecord/FinancialRecord/CompanyComplianceRecord had no trustLevel
// concept at all, so every Plan-B import (fabricated or genuine) was fed
// directly into generation evidence with zero gating.
async function upsertLegalRecord(db: PlanBDb, companyId: string, record: PlanBLegalRecord, ctx: PlanBRecordTrustContext): Promise<PlanBRecordUpsertResult> {
  const title = clean(record.title);
  if (!title) return { created: 0, updated: 0, skipped: 1, evidenceDowngraded: 0, warning: null };
  const recordType = clean(record.recordType) || "LEGAL";
  const authority = clean(record.authority) || null;
  const referenceNumber = clean(record.referenceNumber) || null;
  const issueDate = parseDate(record.issueDate);
  const expiryDate = parseDate(record.expiryDate);
  const existing = await db.legalRecord.findFirst({ where: { companyId, title, recordType }, select: { id: true } });

  const linkedSourceDoc = record.sourceDocument ? ctx.documentByFileName.get(key(clean(record.sourceDocument))) ?? null : null;
  let effectiveTrust: TrustLevel = ctx.importTrust;
  let effectiveReviewNotes = ctx.notes;
  let evidenceDowngraded = 0;
  let warning: string | null = null;
  if (ctx.importTrust === "REVIEWED") {
    const provenance = buildReviewProvenance({
      recordType: "LEGAL",
      sourceDocument: linkedSourceDoc,
      fields: legalReviewFields({ recordType, title, authority, referenceNumber, issueDate, expiryDate }),
      reviewerId: ctx.userId,
      reviewedAt: ctx.now,
    });
    if (provenance.ok) {
      effectiveReviewNotes = provenance.serialized;
    } else {
      effectiveTrust = "AI_DRAFT";
      evidenceDowngraded = 1;
      warning = `Legal record "${title}" requested REVIEWED but lacks verifiable stored source evidence (${provenance.code}) — imported as AI_DRAFT instead. Complete a real review in the Review Inbox.`;
    }
  }

  const data = {
    recordType,
    title,
    authority,
    referenceNumber,
    issueDate,
    expiryDate,
    status: clean(record.status) || "ACTIVE",
    metadata: JSON.stringify(record.metadata ?? {}),
    sourceDocumentId: linkedSourceDoc?.id ?? null,
    trustLevel: effectiveTrust,
    reviewedBy: effectiveTrust === "REVIEWED" ? ctx.userId : null,
    reviewedAt: effectiveTrust === "REVIEWED" ? ctx.now : null,
    reviewNotes: effectiveTrust === "REVIEWED" ? effectiveReviewNotes : ctx.notes,
  };
  if (existing) {
    await db.legalRecord.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1, skipped: 0, evidenceDowngraded, warning };
  }
  await db.legalRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0, evidenceDowngraded, warning };
}

async function upsertFinancialRecord(db: PlanBDb, companyId: string, record: PlanBFinancialRecord, ctx: PlanBRecordTrustContext): Promise<PlanBRecordUpsertResult> {
  const recordType = clean(record.recordType) || "FINANCIAL";
  const fiscalYear = Number(record.fiscalYear || 0);
  if (!fiscalYear) return { created: 0, updated: 0, skipped: 1, evidenceDowngraded: 0, warning: null };
  const currency = clean(record.currency) || "ETB";
  const amount = typeof record.amount === "number" ? record.amount : null;
  const notesText = sourceText(record.notes);
  const existing = await db.financialRecord.findFirst({ where: { companyId, recordType, fiscalYear }, select: { id: true } });

  const linkedSourceDoc = record.sourceDocument ? ctx.documentByFileName.get(key(clean(record.sourceDocument))) ?? null : null;
  let effectiveTrust: TrustLevel = ctx.importTrust;
  let effectiveReviewNotes = ctx.notes;
  let evidenceDowngraded = 0;
  let warning: string | null = null;
  if (ctx.importTrust === "REVIEWED") {
    const provenance = buildReviewProvenance({
      recordType: "FINANCIAL",
      sourceDocument: linkedSourceDoc,
      fields: financialReviewFields({ fiscalYear, recordType, currency, amount, notes: notesText }),
      reviewerId: ctx.userId,
      reviewedAt: ctx.now,
    });
    if (provenance.ok) {
      effectiveReviewNotes = provenance.serialized;
    } else {
      effectiveTrust = "AI_DRAFT";
      evidenceDowngraded = 1;
      warning = `Financial record "${recordType} ${fiscalYear}" requested REVIEWED but lacks verifiable stored source evidence (${provenance.code}) — imported as AI_DRAFT instead. Complete a real review in the Review Inbox.`;
    }
  }

  const data = {
    fiscalYear,
    recordType,
    currency,
    amount,
    notes: notesText,
    metadata: JSON.stringify(record.metadata ?? {}),
    sourceDocumentId: linkedSourceDoc?.id ?? null,
    trustLevel: effectiveTrust,
    reviewedBy: effectiveTrust === "REVIEWED" ? ctx.userId : null,
    reviewedAt: effectiveTrust === "REVIEWED" ? ctx.now : null,
    reviewNotes: effectiveTrust === "REVIEWED" ? effectiveReviewNotes : ctx.notes,
  };
  if (existing) {
    await db.financialRecord.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1, skipped: 0, evidenceDowngraded, warning };
  }
  await db.financialRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0, evidenceDowngraded, warning };
}

async function upsertComplianceRecord(db: PlanBDb, companyId: string, record: PlanBComplianceRecord, ctx: PlanBRecordTrustContext): Promise<PlanBRecordUpsertResult> {
  const title = clean(record.title);
  if (!title) return { created: 0, updated: 0, skipped: 1, evidenceDowngraded: 0, warning: null };
  const complianceType = clean(record.complianceType) || "COMPLIANCE";
  const referenceNumber = clean(record.referenceNumber) || null;
  const expiryDate = parseDate(record.expiryDate);
  const evidenceSummary = sourceText(record.evidenceSummary);
  const existing = await db.companyComplianceRecord.findFirst({ where: { companyId, title, complianceType }, select: { id: true } });

  const linkedSourceDoc = record.sourceDocument ? ctx.documentByFileName.get(key(clean(record.sourceDocument))) ?? null : null;
  let effectiveTrust: TrustLevel = ctx.importTrust;
  let effectiveReviewNotes = ctx.notes;
  let evidenceDowngraded = 0;
  let warning: string | null = null;
  if (ctx.importTrust === "REVIEWED") {
    const provenance = buildReviewProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: linkedSourceDoc,
      fields: complianceReviewFields({ complianceType, title, referenceNumber, expiryDate }),
      reviewerId: ctx.userId,
      reviewedAt: ctx.now,
    });
    if (provenance.ok) {
      effectiveReviewNotes = provenance.serialized;
    } else {
      effectiveTrust = "AI_DRAFT";
      evidenceDowngraded = 1;
      warning = `Compliance record "${title}" requested REVIEWED but lacks verifiable stored source evidence (${provenance.code}) — imported as AI_DRAFT instead. Complete a real review in the Review Inbox.`;
    }
  }

  const data = {
    complianceType,
    title,
    status: clean(record.status) || "ACTIVE",
    evidenceSummary,
    referenceNumber,
    expiryDate,
    metadata: JSON.stringify(record.metadata ?? {}),
    sourceDocumentId: linkedSourceDoc?.id ?? null,
    trustLevel: effectiveTrust,
    reviewedBy: effectiveTrust === "REVIEWED" ? ctx.userId : null,
    reviewedAt: effectiveTrust === "REVIEWED" ? ctx.now : null,
    reviewNotes: effectiveTrust === "REVIEWED" ? effectiveReviewNotes : ctx.notes,
  };
  if (existing) {
    await db.companyComplianceRecord.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1, skipped: 0, evidenceDowngraded, warning };
  }
  await db.companyComplianceRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0, evidenceDowngraded, warning };
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }
  const userId = actor.id;

  // Resource guarding: reject oversized payloads before parsing to prevent OOM/DoS.
  // 10MB is a generous cap for structured JSON (≈1000 experts + 1000 projects).
  const contentLength = Number(req.headers.get("content-length"));
  if (contentLength > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Payload too large", detail: "Plan B JSON import is capped at 10MB." },
      { status: 413 }
    );
  }

  const rl = await rateLimitPersistent(`plan-b-import:${userId}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  try {
    const payload = await readPayload(req);
    const experts = Array.isArray(payload.experts) ? payload.experts : [];
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    const sourceDocuments = Array.isArray(payload.sourceDocuments) ? payload.sourceDocuments : [];
    const legalRecords = Array.isArray(payload.legalRecords) ? payload.legalRecords : [];
    const financialRecords = Array.isArray(payload.financialRecords) ? payload.financialRecords : [];
    const complianceRecords = Array.isArray(payload.complianceRecords) ? payload.complianceRecords : [];
    const importTrust = requestedTrust(payload);
    const requireRawText = payload.importPolicy?.requireRawText !== false;
    const enforceExpectedCounts = payload.completenessPolicy?.enforceExpectedCounts === true;
    const notes = reviewNotes(payload);
    const now = new Date();

    const warnings: string[] = [];
    // Preflight completeness audit before any write operations (hard enforcement-safe).
    const uniqueExpertKeys = new Set<string>();
    const uniqueProjectKeys = new Set<string>();
    let invalidExperts = 0;
    let invalidProjects = 0;
    for (const expert of experts) {
      const fullName = clean(expert.fullName);
      const expertKey = key(fullName);
      const exactRawText = sourceText(expert.rawText ?? expert.profile);
      if (!fullName || fullName.length < 3 || !hasUsableText(exactRawText, requireRawText)) { invalidExperts += 1; continue; }
      if (uniqueExpertKeys.has(expertKey)) warnings.push(`Duplicate expert in payload (by normalized name): ${fullName}. Last record will be applied.`);
      uniqueExpertKeys.add(expertKey);
    }
    for (const project of projects) {
      const name = clean(project.name);
      const projectKey = key(name);
      const exactRawText = sourceText(project.rawText ?? project.summary ?? project.sourceEvidence);
      if (!name || name.length < 3 || !hasUsableText(exactRawText, requireRawText)) { invalidProjects += 1; continue; }
      if (uniqueProjectKeys.has(projectKey)) warnings.push(`Duplicate project in payload (by normalized name): ${name}. Last record will be applied.`);
      uniqueProjectKeys.add(projectKey);
    }
    const expectedCounts = deriveExpectedCounts(payload, sourceDocuments);
    const preflightImportedExperts = uniqueExpertKeys.size;
    const preflightImportedProjects = uniqueProjectKeys.size;
    const preflightExpertCompleteness = completenessStats(expectedCounts.experts ?? null, preflightImportedExperts);
    const preflightProjectCompleteness = completenessStats(expectedCounts.projects ?? null, preflightImportedProjects);
    if (preflightExpertCompleteness && !preflightExpertCompleteness.matched) warnings.push(`Expert completeness mismatch: expected ${preflightExpertCompleteness.expected}, importable ${preflightExpertCompleteness.imported}, missing ${preflightExpertCompleteness.missing}, excess ${preflightExpertCompleteness.excess}.`);
    if (preflightProjectCompleteness && !preflightProjectCompleteness.matched) warnings.push(`Project completeness mismatch: expected ${preflightProjectCompleteness.expected}, importable ${preflightProjectCompleteness.imported}, missing ${preflightProjectCompleteness.missing}, excess ${preflightProjectCompleteness.excess}.`);
    if (enforceExpectedCounts && !expectedCounts.experts && !expectedCounts.projects) {
      const failure = {
        error: "Plan B completeness enforcement requires expectedCounts.experts and/or expectedCounts.projects.",
        expectedCounts,
        importedCounts: { experts: preflightImportedExperts, projects: preflightImportedProjects },
        missingCounts: {
          experts: preflightExpertCompleteness?.missing ?? null,
          projects: preflightProjectCompleteness?.missing ?? null,
        },
        preflightInvalid: { experts: invalidExperts, projects: invalidProjects },
        completeness: { experts: preflightExpertCompleteness, projects: preflightProjectCompleteness },
        warnings: warnings.slice(0, 50),
      };
      await logAction({
        userId,
        action: "COMPANY_KNOWLEDGE_REPAIR_BLOCKED",
        entityType: "Company",
        entityId: company.id,
        description: "Plan-B exact JSON import blocked: strict completeness enabled without expected counts.",
        metadata: { ...failure, blocked: true, enforceExpectedCounts, requireRawText },
      });
      return NextResponse.json(failure, { status: 422 });
    }
    if (enforceExpectedCounts && ((expectedCounts.experts && preflightImportedExperts !== expectedCounts.experts) || (expectedCounts.projects && preflightImportedProjects !== expectedCounts.projects))) {
      const failure = {
        error: "Plan B completeness enforcement failed. Importable counts do not match expected counts.",
        expectedCounts,
        importedCounts: { experts: preflightImportedExperts, projects: preflightImportedProjects },
        missingCounts: {
          experts: preflightExpertCompleteness?.missing ?? null,
          projects: preflightProjectCompleteness?.missing ?? null,
        },
        preflightInvalid: { experts: invalidExperts, projects: invalidProjects },
        completeness: { experts: preflightExpertCompleteness, projects: preflightProjectCompleteness },
        warnings: warnings.slice(0, 50),
      };
      await logAction({ userId, action: "COMPANY_KNOWLEDGE_REPAIR_BLOCKED", entityType: "Company", entityId: company.id, description: "Plan-B exact JSON import blocked by strict completeness policy before writes.", metadata: { ...failure, blocked: true, enforceExpectedCounts, requireRawText } });
      return NextResponse.json(failure, { status: 422 });
    }

    let companyProfileUpdated = false;
    let documentsCreated = 0;
    let documentsUpdated = 0;
    let documentsSkipped = 0;
    // Maps each source document's declared fileName to the real, persisted
    // CompanyDocument row it produced, so experts/projects that claim
    // "REVIEWED" can be checked against genuine stored evidence (the same
    // buildReviewProvenance gate the interactive Review Inbox uses) instead
    // of trusting the caller's self-declared trustLevel outright.
    const documentByFileName = new Map<string, ReviewSourceDocument>();
    let evidenceDowngraded = 0;
    let expertsCreated = 0;
    let expertsUpdated = 0;
    let expertsSkipped = 0;
    let projectsCreated = 0;
    let projectsUpdated = 0;
    let projectsSkipped = 0;
    const legal = { created: 0, updated: 0, skipped: 0 };
    const financial = { created: 0, updated: 0, skipped: 0 };
    const compliance = { created: 0, updated: 0, skipped: 0 };

    await prisma.$transaction(async (tx) => {
    if (payload.companyProfile) {
      const profile = payload.companyProfile;
      await tx.company.update({
        where: { id: company.id },
        data: {
          name: clean(profile.name) || company.name,
          legalName: clean(profile.legalName) || company.legalName,
          description: sourceText(profile.description) || company.description,
          website: clean(profile.website) || company.website,
          address: clean(profile.address) || company.address,
          phone: clean(profile.phone) || company.phone,
          email: clean(profile.email) || company.email,
          country: clean(profile.country) || company.country,
          serviceLines: Array.isArray(profile.serviceLines) ? JSON.stringify(profile.serviceLines.map(clean).filter(Boolean)) : company.serviceLines,
          sectors: Array.isArray(profile.sectors) ? JSON.stringify(profile.sectors.map(clean).filter(Boolean)) : company.sectors,
          profileSummary: sourceText(profile.profileSummary) || company.profileSummary,
          knowledgeMode: clean(profile.knowledgeMode) || company.knowledgeMode,
        },
      });
      companyProfileUpdated = true;
    }

    for (const doc of sourceDocuments) {
      const fileName = clean(doc.fileName || doc.title);
      const exactText = sourceText(doc.rawText);
      if (!fileName) { documentsSkipped += 1; continue; }
      if (requireRawText && (!exactText || exactText.length < 50)) { documentsSkipped += 1; continue; }
      const category = normalizeDocumentCategory(doc);
      const artifactFileName = `${fileName.replace(/\.[a-z0-9]{2,5}$/i, "")}.plan-b.json`;
      const artifactBytes = Buffer.from(JSON.stringify({
        sourceFileName: fileName,
        sourceType: doc.type,
        sourceCategory: doc.category,
        rawText: exactText,
        parsedExperts: doc.parsedExperts,
        parsedProjects: doc.parsedProjects,
        suppliedSha256: doc.sha256,
      }), "utf8");
      const artifactContent = artifactBytes.toString("base64");
      const integrity = inspectActualFileBytes({
        bytes: artifactBytes,
        filename: artifactFileName,
        claimedMimeType: "application/json",
      });
      if (integrity.integrityStatus !== "VERIFIED") {
        documentsSkipped += 1;
        warnings.push(`Skipped ${fileName}: Plan B artifact integrity verification failed.`);
        continue;
      }
      const existing = await tx.companyDocument.findFirst({ where: { companyId: company.id, originalFileName: fileName }, select: { id: true } });
      const data = {
        fileName: artifactFileName,
        originalFileName: fileName,
        mimeType: "application/json",
        size: artifactBytes.length,
        fileContent: artifactContent,
        ...integrity,
        category,
        extractedText: exactText,
        aiExtractionStatus: exactText ? "EXTRACTED" : "FAILED",
        aiExtractedAt: exactText ? now : null,
        aiExtractionError: exactText ? null : "No rawText supplied in Plan B JSON",
        metadata: JSON.stringify({ planB: true, evidenceAuthority: "IMPORTED_JSON_DIAGNOSTIC", sourceType: doc.type, sourceCategory: doc.category, normalizedCategory: category, parsedExperts: doc.parsedExperts, parsedProjects: doc.parsedProjects, sha256: doc.sha256, reviewNotes: notes }),
      };
      let persistedDocId: string;
      if (existing) {
        await tx.companyDocument.update({ where: { id: existing.id }, data });
        persistedDocId = existing.id;
        documentsUpdated += 1;
      } else {
        const created = await tx.companyDocument.create({ data: { companyId: company.id, storagePath: "", ...data } });
        persistedDocId = created.id;
        documentsCreated += 1;
      }
      documentByFileName.set(key(fileName), {
        id: persistedDocId,
        companyId: company.id,
        extractedText: data.extractedText,
        contentSha256: data.contentSha256,
        contentByteLength: data.contentByteLength,
        integrityStatus: data.integrityStatus,
      });
    }

    const existingExperts = await tx.expert.findMany({ where: { companyId: company.id }, select: { id: true, fullName: true } });
    const existingProjects = await tx.project.findMany({ where: { companyId: company.id }, select: { id: true, name: true } });
    const expertMap = new Map(existingExperts.map((e) => [key(e.fullName), e]));
    const projectMap = new Map(existingProjects.map((p) => [key(p.name), p]));

    for (const expert of experts) {
      const fullName = clean(expert.fullName);
      const exactRawText = sourceText(expert.rawText ?? expert.profile);
      if (!fullName || fullName.length < 3) { expertsSkipped += 1; warnings.push("Skipped expert without fullName."); continue; }
      if (requireRawText && (!exactRawText || exactRawText.length < 50)) { expertsSkipped += 1; warnings.push(`Skipped expert ${fullName}: missing full raw CV text.`); continue; }
      const source = sourceLine(expert);
      const profile = [exactRawText, source].filter(Boolean).join("\n\n");
      const disciplines = arr(expert.disciplines);
      const sectors = arr(expert.sectors);
      const certifications = arr(expert.certifications);
      const title = clean(expert.title) || null;
      const yearsExperience = typeof expert.yearsExperience === "number" ? expert.yearsExperience : null;
      const linkedSourceDoc = expert.sourceDocument ? documentByFileName.get(key(clean(expert.sourceDocument))) ?? null : null;
      let effectiveTrust: TrustLevel = importTrust;
      let effectiveReviewNotes = notes;
      if (importTrust === "REVIEWED") {
        const provenance = buildReviewProvenance({
          recordType: "EXPERT",
          sourceDocument: linkedSourceDoc,
          fields: expertReviewFields({ fullName, title, yearsExperience, disciplines, sectors, certifications }),
          reviewerId: userId,
          reviewedAt: now,
        });
        if (provenance.ok) {
          effectiveReviewNotes = provenance.serialized;
        } else {
          effectiveTrust = "AI_DRAFT";
          evidenceDowngraded += 1;
          warnings.push(`Expert ${fullName} requested REVIEWED but lacks verifiable stored source evidence (${provenance.code}) — imported as AI_DRAFT instead. Complete a real review in the Review Inbox.`);
        }
      }
      const data = {
        fullName,
        title,
        email: clean(expert.email) || null,
        phone: clean(expert.phone) || null,
        yearsExperience,
        disciplines,
        sectors,
        certifications,
        profile: profile || null,
        sourceDocumentId: linkedSourceDoc?.id ?? null,
        trustLevel: effectiveTrust,
        reviewedBy: effectiveTrust === "REVIEWED" ? userId : null,
        reviewedAt: effectiveTrust === "REVIEWED" ? now : null,
        reviewNotes: effectiveTrust === "REVIEWED" ? effectiveReviewNotes : notes,
      };
      const existing = expertMap.get(key(fullName));
      if (existing) {
        await tx.expert.update({ where: { id: existing.id }, data });
        expertsUpdated += 1;
      } else {
        const created = await tx.expert.create({ data: { companyId: company.id, ...data } });
        expertMap.set(key(fullName), { id: created.id, fullName: created.fullName });
        expertsCreated += 1;
      }
    }

    for (const project of projects) {
      const name = clean(project.name);
      const exactRawText = sourceText(project.rawText ?? project.summary ?? project.sourceEvidence);
      if (!name || name.length < 3) { projectsSkipped += 1; warnings.push("Skipped project without name."); continue; }
      if (requireRawText && (!exactRawText || exactRawText.length < 50)) { projectsSkipped += 1; warnings.push(`Skipped project ${name}: missing full raw project text.`); continue; }
      const source = sourceLine(project);
      const summary = [exactRawText, project.contractValueSummary ? `Value / fee summary: ${clean(project.contractValueSummary)}` : null, project.duration ? `Duration: ${clean(project.duration)}` : null, source].filter(Boolean).join("\n\n");
      const serviceAreas = Array.isArray(project.serviceAreas) && project.serviceAreas.length > 0 ? project.serviceAreas : project.sectors;
      const clientName = clean(project.clientName) || null;
      const country = clean(project.country) || null;
      const sector = clean(project.sector || project.sectors?.[0]) || null;
      const serviceAreasJson = arr(serviceAreas);
      const linkedSourceDoc = project.sourceDocument ? documentByFileName.get(key(clean(project.sourceDocument))) ?? null : null;
      let effectiveTrust: TrustLevel = importTrust;
      let effectiveReviewNotes = notes;
      if (importTrust === "REVIEWED") {
        const provenance = buildReviewProvenance({
          recordType: "PROJECT",
          sourceDocument: linkedSourceDoc,
          fields: projectReviewFields({ name, clientName, country, sector, serviceAreas: serviceAreasJson }),
          reviewerId: userId,
          reviewedAt: now,
        });
        if (provenance.ok) {
          effectiveReviewNotes = provenance.serialized;
        } else {
          effectiveTrust = "AI_DRAFT";
          evidenceDowngraded += 1;
          warnings.push(`Project ${name} requested REVIEWED but lacks verifiable stored source evidence (${provenance.code}) — imported as AI_DRAFT instead. Complete a real review in the Review Inbox.`);
        }
      }
      const data = {
        name,
        clientName,
        country,
        sector,
        serviceAreas: serviceAreasJson,
        summary: summary || null,
        sourceDocumentId: linkedSourceDoc?.id ?? null,
        trustLevel: effectiveTrust,
        reviewedBy: effectiveTrust === "REVIEWED" ? userId : null,
        reviewedAt: effectiveTrust === "REVIEWED" ? now : null,
        reviewNotes: effectiveTrust === "REVIEWED" ? effectiveReviewNotes : notes,
      };
      const existing = projectMap.get(key(name));
      if (existing) {
        await tx.project.update({ where: { id: existing.id }, data });
        projectsUpdated += 1;
      } else {
        const created = await tx.project.create({ data: { companyId: company.id, ...data } });
        projectMap.set(key(name), { id: created.id, name: created.name });
        projectsCreated += 1;
      }
    }

    const recordTrustCtx: PlanBRecordTrustContext = { documentByFileName, importTrust, userId, now, notes };

    for (const record of legalRecords) {
      const r = await upsertLegalRecord(tx, company.id, record, recordTrustCtx);
      legal.created += r.created; legal.updated += r.updated; legal.skipped += r.skipped;
      evidenceDowngraded += r.evidenceDowngraded;
      if (r.warning) warnings.push(r.warning);
    }

    for (const record of financialRecords) {
      const r = await upsertFinancialRecord(tx, company.id, record, recordTrustCtx);
      financial.created += r.created; financial.updated += r.updated; financial.skipped += r.skipped;
      evidenceDowngraded += r.evidenceDowngraded;
      if (r.warning) warnings.push(r.warning);
    }

    for (const record of complianceRecords) {
      const r = await upsertComplianceRecord(tx, company.id, record, recordTrustCtx);
      compliance.created += r.created; compliance.updated += r.updated; compliance.skipped += r.skipped;
      evidenceDowngraded += r.evidenceDowngraded;
      if (r.warning) warnings.push(r.warning);
    }
    });

    const importedExperts = expertsCreated + expertsUpdated;
    const importedProjects = projectsCreated + projectsUpdated;
    const expertCompleteness = completenessStats(expectedCounts.experts ?? null, importedExperts);
    const projectCompleteness = completenessStats(expectedCounts.projects ?? null, importedProjects);

    const result = {
      success: true,
      schemaVersion: payload.schemaVersion ?? null,
      sourceDocuments: sourceDocuments.map((d) => ({ fileName: d.fileName, type: d.type, category: normalizeDocumentCategory(d) })),
      trustLevel: importTrust,
      // Individual records requesting REVIEWED without verifiable stored
      // source evidence (a real sourceDocument match + buildReviewProvenance
      // quote-containment check) are silently downgraded to AI_DRAFT rather
      // than trusting the caller's self-declared trustLevel — see the
      // per-record warnings for which ones were downgraded and why.
      evidenceDowngraded,
      requireRawText,
      enforceExpectedCounts,
      companyProfileUpdated,
      documents: { received: sourceDocuments.length, created: documentsCreated, updated: documentsUpdated, skipped: documentsSkipped },
      experts: { received: experts.length, created: expertsCreated, updated: expertsUpdated, skipped: expertsSkipped },
      projects: { received: projects.length, created: projectsCreated, updated: projectsUpdated, skipped: projectsSkipped },
      expectedCounts,
      missingCounts: {
        experts: expertCompleteness?.missing ?? null,
        projects: projectCompleteness?.missing ?? null,
      },
      preflightInvalid: { experts: invalidExperts, projects: invalidProjects },
      completeness: {
        experts: expertCompleteness,
        projects: projectCompleteness,
      },
      legalRecords: { received: legalRecords.length, ...legal },
      financialRecords: { received: financialRecords.length, ...financial },
      complianceRecords: { received: complianceRecords.length, ...compliance },
      warnings: warnings.slice(0, 50),
    };

    await logAction({
      userId,
      action: "COMPANY_KNOWLEDGE_REPAIR_SUCCESS",
      entityType: "Company",
      entityId: company.id,
      description: `Plan-B exact JSON import: companyProfile=${companyProfileUpdated}, documents ${documentsCreated}/${documentsUpdated}, experts ${expertsCreated}/${expertsUpdated}, projects ${projectsCreated}/${projectsUpdated}, legal ${legal.created}/${legal.updated}, financial ${financial.created}/${financial.updated}, compliance ${compliance.created}/${compliance.updated}`,
      metadata: result,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("[plan-b-import] failed:", { detail: error });
    if (error instanceof ZodError) {
      return NextResponse.json({
        error: "Invalid Plan-B payload. Please correct the JSON schema and retry.",
        validationIssues: error.issues.slice(0, 100).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      }, { status: 400 });
    }
    return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
  }
}
