import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { logAction } from "../../../../lib/audit";

// Vercel route timeout — Plan B import processes structured knowledge payloads.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type TrustLevel = "REVIEWED" | "AI_DRAFT" | "REGEX_DRAFT";
type DbClient = PrismaClient | Prisma.TransactionClient;

const stringish = z.union([z.string(), z.number(), z.boolean()]).optional().nullable();
const stringArray = z.array(z.string()).max(250).optional().default([]);
const metadataSchema = z.record(z.unknown()).optional().default({});

const sourcePagesSchema = z.object({ start: z.number().int().positive().optional(), end: z.number().int().positive().optional() }).partial().optional();

const expertSchema = z.object({
  fullName: z.string().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  yearsExperience: z.number().finite().min(0).max(80).nullable().optional(),
  disciplines: stringArray,
  sectors: stringArray,
  certifications: stringArray,
  profile: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  sourceDocument: z.string().optional(),
  sourcePages: sourcePagesSchema,
}).passthrough();

const projectSchema = z.object({
  name: z.string().optional(),
  clientName: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  sectors: stringArray,
  serviceAreas: stringArray,
  contractValueSummary: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  sourceDocument: z.string().optional(),
  sourceNo: stringish,
  sourceEvidence: z.string().nullable().optional(),
}).passthrough();

const sourceDocumentSchema = z.object({
  fileName: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  pages: z.number().int().nonnegative().optional(),
  parsedExperts: z.number().int().nonnegative().optional(),
  parsedProjects: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  rawText: z.string().nullable().optional(),
}).passthrough();

const companyProfileSchema = z.object({
  name: z.string().optional(),
  legalName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  serviceLines: stringArray,
  sectors: stringArray,
  profileSummary: z.string().nullable().optional(),
  knowledgeMode: z.string().nullable().optional(),
}).passthrough();

const legalRecordSchema = z.object({
  recordType: z.string().optional(),
  title: z.string().optional(),
  authority: z.string().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  status: z.string().optional(),
  metadata: metadataSchema,
}).passthrough();

const financialRecordSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2200).optional(),
  recordType: z.string().optional(),
  currency: z.string().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  notes: z.string().nullable().optional(),
  metadata: metadataSchema,
}).passthrough();

const complianceRecordSchema = z.object({
  complianceType: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  evidenceSummary: z.string().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  metadata: metadataSchema,
}).passthrough();

const payloadSchema = z.object({
  schemaVersion: z.string().optional(),
  sourceDocuments: z.array(sourceDocumentSchema).max(2000).optional().default([]),
  companyProfile: companyProfileSchema.optional(),
  importPolicy: z.object({
    trustLevel: z.enum(["REVIEWED", "AI_DRAFT", "REGEX_DRAFT"]).optional(),
    reviewNotes: z.string().max(4000).optional(),
    requireRawText: z.boolean().optional(),
  }).partial().optional().default({}),
  completenessPolicy: z.object({ enforceExpectedCounts: z.boolean().optional().default(false) }).partial().optional().default({}),
  expectedCounts: z.object({
    experts: z.number().int().nonnegative().optional(),
    projects: z.number().int().nonnegative().optional(),
    sourceDocuments: z.number().int().nonnegative().optional(),
    legalRecords: z.number().int().nonnegative().optional(),
    financialRecords: z.number().int().nonnegative().optional(),
    complianceRecords: z.number().int().nonnegative().optional(),
  }).partial().optional(),
  experts: z.array(expertSchema).max(5000).optional().default([]),
  projects: z.array(projectSchema).max(10000).optional().default([]),
  legalRecords: z.array(legalRecordSchema).max(2000).optional().default([]),
  financialRecords: z.array(financialRecordSchema).max(2000).optional().default([]),
  complianceRecords: z.array(complianceRecordSchema).max(3000).optional().default([]),
}).passthrough();

type PlanBPayload = z.infer<typeof payloadSchema>;
type PlanBExpert = z.infer<typeof expertSchema>;
type PlanBProject = z.infer<typeof projectSchema>;
type PlanBSourceDocument = z.infer<typeof sourceDocumentSchema>;
type PlanBLegalRecord = z.infer<typeof legalRecordSchema>;
type PlanBFinancialRecord = z.infer<typeof financialRecordSchema>;
type PlanBComplianceRecord = z.infer<typeof complianceRecordSchema>;

type CompletenessMetric = { expected: number | null; imported: number; missing: number; excess: number; matched: boolean };

type PreflightAudit = {
  expectedCounts: { experts: number | null; projects: number | null; sourceDocuments: number | null; legalRecords: number | null; financialRecords: number | null; complianceRecords: number | null };
  importedCounts: { experts: number; projects: number; sourceDocuments: number; legalRecords: number; financialRecords: number; complianceRecords: number };
  preflightInvalid: { experts: number; projects: number; sourceDocuments: number };
  completeness: { experts: CompletenessMetric; projects: CompletenessMetric; sourceDocuments: CompletenessMetric; legalRecords: CompletenessMetric; financialRecords: CompletenessMetric; complianceRecords: CompletenessMetric };
  duplicateCollisions: { experts: string[]; projects: string[] };
  warnings: string[];
};

function clean(value: unknown): string { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function raw(value: unknown): string { return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(); }
function arr(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(clean).filter(Boolean));
  if (typeof value === "string") return JSON.stringify(value.split(",").map(clean).filter(Boolean));
  return JSON.stringify([]);
}
function key(value: string): string { return clean(value).toLowerCase(); }
function sourceText(value: unknown): string | null { const text = raw(value); return text || null; }
function usableRawText(value: unknown, minChars = 50): boolean { return raw(value).length >= minChars; }

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
  const json = contentType.includes("multipart/form-data")
    ? await (async () => {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("No JSON file provided.");
        return JSON.parse(await file.text()) as unknown;
      })()
    : await req.json() as unknown;
  return payloadSchema.parse(json);
}

function sourceLine(item: { sourceDocument?: string; sourcePages?: { start?: number; end?: number }; sourceNo?: number | string | null }) {
  if (!item.sourceDocument && !item.sourcePages && !item.sourceNo) return null;
  const pages = item.sourcePages?.start ? ` pages ${item.sourcePages.start}-${item.sourcePages.end ?? item.sourcePages.start}` : "";
  const no = item.sourceNo ? ` record ${item.sourceNo}` : "";
  return `Source: ${item.sourceDocument ?? "uploaded extraction"}${pages}${no}.`;
}

function expectedFromDocuments(sourceDocuments: PlanBSourceDocument[], field: "parsedExperts" | "parsedProjects"): number | null {
  const values = sourceDocuments.map((doc) => typeof doc[field] === "number" ? doc[field] ?? 0 : null).filter((value): value is number => value !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function metric(expected: number | null, imported: number): CompletenessMetric {
  if (expected === null) return { expected, imported, missing: 0, excess: 0, matched: true };
  return { expected, imported, missing: Math.max(expected - imported, 0), excess: Math.max(imported - expected, 0), matched: imported === expected };
}

function duplicateKeys(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const k = key(value);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([value]) => value);
}

function computePreflightAudit(payload: PlanBPayload): PreflightAudit {
  const requireRawText = payload.importPolicy?.requireRawText !== false;
  const validExperts = payload.experts.filter((expert) => {
    const fullName = clean(expert.fullName);
    const text = expert.rawText ?? expert.profile;
    return fullName.length >= 3 && (!requireRawText || usableRawText(text));
  });
  const validProjects = payload.projects.filter((project) => {
    const name = clean(project.name);
    const text = project.rawText ?? project.summary ?? project.sourceEvidence;
    return name.length >= 3 && (!requireRawText || usableRawText(text));
  });
  const validDocs = payload.sourceDocuments.filter((doc) => {
    const fileName = clean(doc.fileName || doc.title);
    return Boolean(fileName) && (!requireRawText || usableRawText(doc.rawText));
  });
  const expectedCounts = {
    experts: payload.expectedCounts?.experts ?? expectedFromDocuments(payload.sourceDocuments, "parsedExperts"),
    projects: payload.expectedCounts?.projects ?? expectedFromDocuments(payload.sourceDocuments, "parsedProjects"),
    sourceDocuments: payload.expectedCounts?.sourceDocuments ?? null,
    legalRecords: payload.expectedCounts?.legalRecords ?? null,
    financialRecords: payload.expectedCounts?.financialRecords ?? null,
    complianceRecords: payload.expectedCounts?.complianceRecords ?? null,
  };
  const importedCounts = {
    experts: validExperts.length,
    projects: validProjects.length,
    sourceDocuments: validDocs.length,
    legalRecords: payload.legalRecords.filter((r) => clean(r.title)).length,
    financialRecords: payload.financialRecords.filter((r) => Number(r.fiscalYear || 0)).length,
    complianceRecords: payload.complianceRecords.filter((r) => clean(r.title)).length,
  };
  const duplicateCollisions = {
    experts: duplicateKeys(validExperts.map((expert) => clean(expert.fullName))),
    projects: duplicateKeys(validProjects.map((project) => clean(project.name))),
  };
  const completeness = {
    experts: metric(expectedCounts.experts, importedCounts.experts),
    projects: metric(expectedCounts.projects, importedCounts.projects),
    sourceDocuments: metric(expectedCounts.sourceDocuments, importedCounts.sourceDocuments),
    legalRecords: metric(expectedCounts.legalRecords, importedCounts.legalRecords),
    financialRecords: metric(expectedCounts.financialRecords, importedCounts.financialRecords),
    complianceRecords: metric(expectedCounts.complianceRecords, importedCounts.complianceRecords),
  };
  const warnings: string[] = [];
  for (const [name, item] of Object.entries(completeness)) {
    if (!item.matched && item.expected !== null) warnings.push(`${name}: expected ${item.expected}, importable ${item.imported}, missing ${item.missing}, excess ${item.excess}.`);
  }
  if (duplicateCollisions.experts.length > 0) warnings.push(`Duplicate expert keys detected: ${duplicateCollisions.experts.slice(0, 10).join(", ")}.`);
  if (duplicateCollisions.projects.length > 0) warnings.push(`Duplicate project keys detected: ${duplicateCollisions.projects.slice(0, 10).join(", ")}.`);
  return {
    expectedCounts,
    importedCounts,
    preflightInvalid: { experts: payload.experts.length - importedCounts.experts, projects: payload.projects.length - importedCounts.projects, sourceDocuments: payload.sourceDocuments.length - importedCounts.sourceDocuments },
    completeness,
    duplicateCollisions,
    warnings,
  };
}

function strictAuditFailed(audit: PreflightAudit): boolean {
  return [audit.completeness.experts, audit.completeness.projects].some((item) => item.expected !== null && !item.matched);
}

async function upsertLegalRecord(db: DbClient, companyId: string, record: PlanBLegalRecord) {
  const title = clean(record.title);
  if (!title) return { created: 0, updated: 0, skipped: 1 };
  const recordType = clean(record.recordType) || "LEGAL";
  const existing = await db.legalRecord.findFirst({ where: { companyId, title, recordType }, select: { id: true } });
  const data = { recordType, title, authority: clean(record.authority) || null, referenceNumber: clean(record.referenceNumber) || null, issueDate: parseDate(record.issueDate), expiryDate: parseDate(record.expiryDate), status: clean(record.status) || "ACTIVE", metadata: JSON.stringify(record.metadata ?? {}) };
  if (existing) { await db.legalRecord.update({ where: { id: existing.id }, data }); return { created: 0, updated: 1, skipped: 0 }; }
  await db.legalRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0 };
}

async function upsertFinancialRecord(db: DbClient, companyId: string, record: PlanBFinancialRecord) {
  const recordType = clean(record.recordType) || "FINANCIAL";
  const fiscalYear = Number(record.fiscalYear || 0);
  if (!fiscalYear) return { created: 0, updated: 0, skipped: 1 };
  const existing = await db.financialRecord.findFirst({ where: { companyId, recordType, fiscalYear }, select: { id: true } });
  const data = { fiscalYear, recordType, currency: clean(record.currency) || "ETB", amount: typeof record.amount === "number" ? record.amount : null, notes: sourceText(record.notes), metadata: JSON.stringify(record.metadata ?? {}) };
  if (existing) { await db.financialRecord.update({ where: { id: existing.id }, data }); return { created: 0, updated: 1, skipped: 0 }; }
  await db.financialRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0 };
}

async function upsertComplianceRecord(db: DbClient, companyId: string, record: PlanBComplianceRecord) {
  const title = clean(record.title);
  if (!title) return { created: 0, updated: 0, skipped: 1 };
  const complianceType = clean(record.complianceType) || "COMPLIANCE";
  const existing = await db.companyComplianceRecord.findFirst({ where: { companyId, title, complianceType }, select: { id: true } });
  const data = { complianceType, title, status: clean(record.status) || "ACTIVE", evidenceSummary: sourceText(record.evidenceSummary), referenceNumber: clean(record.referenceNumber) || null, expiryDate: parseDate(record.expiryDate), metadata: JSON.stringify(record.metadata ?? {}) };
  if (existing) { await db.companyComplianceRecord.update({ where: { id: existing.id }, data }); return { created: 0, updated: 1, skipped: 0 }; }
  await db.companyComplianceRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0 };
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  try {
    const payload = await readPayload(req);
    const importTrust = requestedTrust(payload);
    const requireRawText = payload.importPolicy?.requireRawText !== false;
    const notes = reviewNotes(payload);
    const audit = computePreflightAudit(payload);
    const enforceExpectedCounts = Boolean(payload.completenessPolicy?.enforceExpectedCounts);

    if (enforceExpectedCounts && strictAuditFailed(audit)) {
      const response = { success: false, error: "Plan-B import blocked: strict expected-count completeness check failed before database writes.", code: "PLAN_B_EXPECTED_COUNTS_MISMATCH", enforceExpectedCounts, ...audit };
      await logAction({ userId, action: "COMPANY_KNOWLEDGE_REPAIR", entityType: "Company", entityId: company.id, description: "Plan-B exact JSON import blocked by strict preflight completeness audit.", metadata: response });
      return NextResponse.json(response, { status: 422 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      let companyProfileUpdated = false;
      if (payload.companyProfile) {
        const profile = payload.companyProfile;
        await tx.company.update({ where: { id: company.id }, data: { name: clean(profile.name) || company.name, legalName: clean(profile.legalName) || company.legalName, description: sourceText(profile.description) || company.description, website: clean(profile.website) || company.website, address: clean(profile.address) || company.address, phone: clean(profile.phone) || company.phone, email: clean(profile.email) || company.email, country: clean(profile.country) || company.country, serviceLines: Array.isArray(profile.serviceLines) ? JSON.stringify(profile.serviceLines.map(clean).filter(Boolean)) : company.serviceLines, sectors: Array.isArray(profile.sectors) ? JSON.stringify(profile.sectors.map(clean).filter(Boolean)) : company.sectors, profileSummary: sourceText(profile.profileSummary) || company.profileSummary, knowledgeMode: clean(profile.knowledgeMode) || company.knowledgeMode } });
        companyProfileUpdated = true;
      }

      let documentsCreated = 0, documentsUpdated = 0, documentsSkipped = 0;
      for (const doc of payload.sourceDocuments) {
        const fileName = clean(doc.fileName || doc.title);
        const exactText = sourceText(doc.rawText);
        if (!fileName) { documentsSkipped += 1; continue; }
        if (requireRawText && (!exactText || exactText.length < 50)) { documentsSkipped += 1; continue; }
        const category = normalizeDocumentCategory(doc);
        const existing = await tx.companyDocument.findFirst({ where: { companyId: company.id, originalFileName: fileName }, select: { id: true } });
        const data = { fileName, originalFileName: fileName, mimeType: "application/json", size: exactText?.length ?? 0, category, extractedText: exactText, aiExtractionStatus: exactText ? "EXTRACTED" : "FAILED", aiExtractedAt: exactText ? now : null, aiExtractionError: exactText ? null : "No rawText supplied in Plan B JSON", metadata: JSON.stringify({ planB: true, sourceType: doc.type, sourceCategory: doc.category, normalizedCategory: category, parsedExperts: doc.parsedExperts, parsedProjects: doc.parsedProjects, sha256: doc.sha256, reviewNotes: notes }) };
        if (existing) { await tx.companyDocument.update({ where: { id: existing.id }, data }); documentsUpdated += 1; }
        else { await tx.companyDocument.create({ data: { companyId: company.id, storagePath: "", ...data } }); documentsCreated += 1; }
      }

      const existingExperts = await tx.expert.findMany({ where: { companyId: company.id }, select: { id: true, fullName: true } });
      const existingProjects = await tx.project.findMany({ where: { companyId: company.id }, select: { id: true, name: true } });
      const expertMap = new Map(existingExperts.map((e) => [key(e.fullName), e]));
      const projectMap = new Map(existingProjects.map((p) => [key(p.name), p]));
      let expertsCreated = 0, expertsUpdated = 0, expertsSkipped = 0, projectsCreated = 0, projectsUpdated = 0, projectsSkipped = 0;
      const warnings: string[] = [...audit.warnings];

      for (const expert of payload.experts) {
        const fullName = clean(expert.fullName);
        const exactRawText = sourceText(expert.rawText ?? expert.profile);
        if (!fullName || fullName.length < 3) { expertsSkipped += 1; warnings.push("Skipped expert without fullName."); continue; }
        if (requireRawText && (!exactRawText || exactRawText.length < 50)) { expertsSkipped += 1; warnings.push(`Skipped expert ${fullName}: missing full raw CV text.`); continue; }
        const source = sourceLine(expert);
        const profile = [exactRawText, source].filter(Boolean).join("\n\n");
        const data = { fullName, title: clean(expert.title) || null, email: clean(expert.email) || null, phone: clean(expert.phone) || null, yearsExperience: typeof expert.yearsExperience === "number" ? expert.yearsExperience : null, disciplines: arr(expert.disciplines), sectors: arr(expert.sectors), certifications: arr(expert.certifications), profile: profile || null, trustLevel: importTrust, reviewedBy: importTrust === "REVIEWED" ? userId : null, reviewedAt: importTrust === "REVIEWED" ? now : null, reviewNotes: notes };
        const existing = expertMap.get(key(fullName));
        if (existing) { await tx.expert.update({ where: { id: existing.id }, data }); expertsUpdated += 1; }
        else { const created = await tx.expert.create({ data: { companyId: company.id, ...data } }); expertMap.set(key(fullName), { id: created.id, fullName: created.fullName }); expertsCreated += 1; }
      }

      for (const project of payload.projects) {
        const name = clean(project.name);
        const exactRawText = sourceText(project.rawText ?? project.summary ?? project.sourceEvidence);
        if (!name || name.length < 3) { projectsSkipped += 1; warnings.push("Skipped project without name."); continue; }
        if (requireRawText && (!exactRawText || exactRawText.length < 50)) { projectsSkipped += 1; warnings.push(`Skipped project ${name}: missing full raw project text.`); continue; }
        const source = sourceLine(project);
        const summary = [exactRawText, project.contractValueSummary ? `Value / fee summary: ${clean(project.contractValueSummary)}` : null, project.duration ? `Duration: ${clean(project.duration)}` : null, source].filter(Boolean).join("\n\n");
        const serviceAreas = Array.isArray(project.serviceAreas) && project.serviceAreas.length > 0 ? project.serviceAreas : project.sectors;
        const data = { name, clientName: clean(project.clientName) || null, country: clean(project.country) || null, sector: clean(project.sector || project.sectors?.[0]) || null, serviceAreas: arr(serviceAreas), summary: summary || null, trustLevel: importTrust, reviewedBy: importTrust === "REVIEWED" ? userId : null, reviewedAt: importTrust === "REVIEWED" ? now : null, reviewNotes: notes };
        const existing = projectMap.get(key(name));
        if (existing) { await tx.project.update({ where: { id: existing.id }, data }); projectsUpdated += 1; }
        else { const created = await tx.project.create({ data: { companyId: company.id, ...data } }); projectMap.set(key(name), { id: created.id, name: created.name }); projectsCreated += 1; }
      }

      const legal = { created: 0, updated: 0, skipped: 0 };
      for (const record of payload.legalRecords) { const r = await upsertLegalRecord(tx, company.id, record); legal.created += r.created; legal.updated += r.updated; legal.skipped += r.skipped; }
      const financial = { created: 0, updated: 0, skipped: 0 };
      for (const record of payload.financialRecords) { const r = await upsertFinancialRecord(tx, company.id, record); financial.created += r.created; financial.updated += r.updated; financial.skipped += r.skipped; }
      const compliance = { created: 0, updated: 0, skipped: 0 };
      for (const record of payload.complianceRecords) { const r = await upsertComplianceRecord(tx, company.id, record); compliance.created += r.created; compliance.updated += r.updated; compliance.skipped += r.skipped; }

      return { success: true, schemaVersion: payload.schemaVersion ?? null, enforceExpectedCounts, expectedCounts: audit.expectedCounts, importedCounts: audit.importedCounts, preflightInvalid: audit.preflightInvalid, completeness: audit.completeness, duplicateCollisions: audit.duplicateCollisions, sourceDocuments: payload.sourceDocuments.map((d) => ({ fileName: d.fileName, type: d.type, category: normalizeDocumentCategory(d) })), trustLevel: importTrust, requireRawText, companyProfileUpdated, documents: { received: payload.sourceDocuments.length, created: documentsCreated, updated: documentsUpdated, skipped: documentsSkipped }, experts: { received: payload.experts.length, created: expertsCreated, updated: expertsUpdated, skipped: expertsSkipped }, projects: { received: payload.projects.length, created: projectsCreated, updated: projectsUpdated, skipped: projectsSkipped }, legalRecords: { received: payload.legalRecords.length, ...legal }, financialRecords: { received: payload.financialRecords.length, ...financial }, complianceRecords: { received: payload.complianceRecords.length, ...compliance }, warnings: warnings.slice(0, 100) };
    });

    await logAction({ userId, action: "COMPANY_KNOWLEDGE_REPAIR", entityType: "Company", entityId: company.id, description: `Plan-B exact JSON import: experts ${result.experts.created}/${result.experts.updated}, projects ${result.projects.created}/${result.projects.updated}, docs ${result.documents.created}/${result.documents.updated}`, metadata: result });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[plan-b-import] failed:", error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid Plan-B import payload", code: "PLAN_B_PAYLOAD_INVALID", issues: error.issues.slice(0, 30).map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Plan-B import failed" }, { status: 400 });
  }
}
