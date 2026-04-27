import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { logAction } from "../../../../lib/audit";

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
};

type PlanBFinancialRecord = {
  fiscalYear?: number;
  recordType?: string;
  currency?: string | null;
  amount?: number | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

type PlanBComplianceRecord = {
  complianceType?: string;
  title?: string;
  status?: string;
  evidenceSummary?: string | null;
  referenceNumber?: string | null;
  expiryDate?: string | null;
  metadata?: Record<string, unknown>;
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
};

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
    return JSON.parse(text) as PlanBPayload;
  }
  return await req.json() as PlanBPayload;
}

function sourceLine(item: { sourceDocument?: string; sourcePages?: { start?: number; end?: number }; sourceNo?: number | string }) {
  if (!item.sourceDocument && !item.sourcePages && !item.sourceNo) return null;
  const pages = item.sourcePages?.start ? ` pages ${item.sourcePages.start}-${item.sourcePages.end ?? item.sourcePages.start}` : "";
  const no = item.sourceNo ? ` record ${item.sourceNo}` : "";
  return `Source: ${item.sourceDocument ?? "uploaded extraction"}${pages}${no}.`;
}

async function upsertLegalRecord(companyId: string, record: PlanBLegalRecord) {
  const title = clean(record.title);
  if (!title) return { created: 0, updated: 0, skipped: 1 };
  const recordType = clean(record.recordType) || "LEGAL";
  const existing = await prisma.legalRecord.findFirst({ where: { companyId, title, recordType }, select: { id: true } });
  const data = {
    recordType,
    title,
    authority: clean(record.authority) || null,
    referenceNumber: clean(record.referenceNumber) || null,
    issueDate: parseDate(record.issueDate),
    expiryDate: parseDate(record.expiryDate),
    status: clean(record.status) || "ACTIVE",
    metadata: JSON.stringify(record.metadata ?? {}),
  };
  if (existing) {
    await prisma.legalRecord.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1, skipped: 0 };
  }
  await prisma.legalRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0 };
}

async function upsertFinancialRecord(companyId: string, record: PlanBFinancialRecord) {
  const recordType = clean(record.recordType) || "FINANCIAL";
  const fiscalYear = Number(record.fiscalYear || 0);
  if (!fiscalYear) return { created: 0, updated: 0, skipped: 1 };
  const existing = await prisma.financialRecord.findFirst({ where: { companyId, recordType, fiscalYear }, select: { id: true } });
  const data = {
    fiscalYear,
    recordType,
    currency: clean(record.currency) || "ETB",
    amount: typeof record.amount === "number" ? record.amount : null,
    notes: sourceText(record.notes),
    metadata: JSON.stringify(record.metadata ?? {}),
  };
  if (existing) {
    await prisma.financialRecord.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1, skipped: 0 };
  }
  await prisma.financialRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0 };
}

async function upsertComplianceRecord(companyId: string, record: PlanBComplianceRecord) {
  const title = clean(record.title);
  if (!title) return { created: 0, updated: 0, skipped: 1 };
  const complianceType = clean(record.complianceType) || "COMPLIANCE";
  const existing = await prisma.companyComplianceRecord.findFirst({ where: { companyId, title, complianceType }, select: { id: true } });
  const data = {
    complianceType,
    title,
    status: clean(record.status) || "ACTIVE",
    evidenceSummary: sourceText(record.evidenceSummary),
    referenceNumber: clean(record.referenceNumber) || null,
    expiryDate: parseDate(record.expiryDate),
    metadata: JSON.stringify(record.metadata ?? {}),
  };
  if (existing) {
    await prisma.companyComplianceRecord.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1, skipped: 0 };
  }
  await prisma.companyComplianceRecord.create({ data: { companyId, ...data } });
  return { created: 1, updated: 0, skipped: 0 };
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const notes = reviewNotes(payload);
    const now = new Date();

    let companyProfileUpdated = false;
    if (payload.companyProfile) {
      const profile = payload.companyProfile;
      await prisma.company.update({
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

    let documentsCreated = 0;
    let documentsUpdated = 0;
    let documentsSkipped = 0;
    for (const doc of sourceDocuments) {
      const fileName = clean(doc.fileName || doc.title);
      const exactText = sourceText(doc.rawText);
      if (!fileName) { documentsSkipped += 1; continue; }
      if (requireRawText && (!exactText || exactText.length < 50)) { documentsSkipped += 1; continue; }
      const category = clean(doc.category || doc.type) || "PLAN_B_SUMMARY";
      const existing = await prisma.companyDocument.findFirst({ where: { companyId: company.id, originalFileName: fileName }, select: { id: true } });
      const data = {
        fileName,
        originalFileName: fileName,
        mimeType: "application/json",
        size: exactText?.length ?? 0,
        category,
        extractedText: exactText,
        aiExtractionStatus: exactText ? "EXTRACTED" : "FAILED",
        aiExtractedAt: exactText ? now : null,
        aiExtractionError: exactText ? null : "No rawText supplied in Plan B JSON",
        metadata: JSON.stringify({ planB: true, sourceType: doc.type, parsedExperts: doc.parsedExperts, parsedProjects: doc.parsedProjects, sha256: doc.sha256, reviewNotes: notes }),
      };
      if (existing) {
        await prisma.companyDocument.update({ where: { id: existing.id }, data });
        documentsUpdated += 1;
      } else {
        await prisma.companyDocument.create({ data: { companyId: company.id, storagePath: "", ...data } });
        documentsCreated += 1;
      }
    }

    const existingExperts = await prisma.expert.findMany({ where: { companyId: company.id }, select: { id: true, fullName: true } });
    const existingProjects = await prisma.project.findMany({ where: { companyId: company.id }, select: { id: true, name: true } });
    const expertMap = new Map(existingExperts.map((e) => [key(e.fullName), e]));
    const projectMap = new Map(existingProjects.map((p) => [key(p.name), p]));

    let expertsCreated = 0;
    let expertsUpdated = 0;
    let expertsSkipped = 0;
    let projectsCreated = 0;
    let projectsUpdated = 0;
    let projectsSkipped = 0;
    const warnings: string[] = [];

    for (const expert of experts) {
      const fullName = clean(expert.fullName);
      const exactRawText = sourceText(expert.rawText ?? expert.profile);
      if (!fullName || fullName.length < 3) { expertsSkipped += 1; warnings.push("Skipped expert without fullName."); continue; }
      if (requireRawText && (!exactRawText || exactRawText.length < 50)) { expertsSkipped += 1; warnings.push(`Skipped expert ${fullName}: missing full raw CV text.`); continue; }
      const source = sourceLine(expert);
      const profile = [exactRawText, source].filter(Boolean).join("\n\n");
      const data = {
        fullName,
        title: clean(expert.title) || null,
        email: clean(expert.email) || null,
        phone: clean(expert.phone) || null,
        yearsExperience: typeof expert.yearsExperience === "number" ? expert.yearsExperience : null,
        disciplines: arr(expert.disciplines),
        sectors: arr(expert.sectors),
        certifications: arr(expert.certifications),
        profile: profile || null,
        trustLevel: importTrust,
        reviewedBy: importTrust === "REVIEWED" ? userId : null,
        reviewedAt: importTrust === "REVIEWED" ? now : null,
        reviewNotes: notes,
      };
      const existing = expertMap.get(key(fullName));
      if (existing) {
        await prisma.expert.update({ where: { id: existing.id }, data });
        expertsUpdated += 1;
      } else {
        const created = await prisma.expert.create({ data: { companyId: company.id, ...data } });
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
      const data = {
        name,
        clientName: clean(project.clientName) || null,
        country: clean(project.country) || null,
        sector: clean(project.sector || project.sectors?.[0]) || null,
        serviceAreas: arr(serviceAreas),
        summary: summary || null,
        trustLevel: importTrust,
        reviewedBy: importTrust === "REVIEWED" ? userId : null,
        reviewedAt: importTrust === "REVIEWED" ? now : null,
        reviewNotes: notes,
      };
      const existing = projectMap.get(key(name));
      if (existing) {
        await prisma.project.update({ where: { id: existing.id }, data });
        projectsUpdated += 1;
      } else {
        const created = await prisma.project.create({ data: { companyId: company.id, ...data } });
        projectMap.set(key(name), { id: created.id, name: created.name });
        projectsCreated += 1;
      }
    }

    const legal = { created: 0, updated: 0, skipped: 0 };
    for (const record of legalRecords) {
      const r = await upsertLegalRecord(company.id, record);
      legal.created += r.created; legal.updated += r.updated; legal.skipped += r.skipped;
    }

    const financial = { created: 0, updated: 0, skipped: 0 };
    for (const record of financialRecords) {
      const r = await upsertFinancialRecord(company.id, record);
      financial.created += r.created; financial.updated += r.updated; financial.skipped += r.skipped;
    }

    const compliance = { created: 0, updated: 0, skipped: 0 };
    for (const record of complianceRecords) {
      const r = await upsertComplianceRecord(company.id, record);
      compliance.created += r.created; compliance.updated += r.updated; compliance.skipped += r.skipped;
    }

    const result = {
      success: true,
      schemaVersion: payload.schemaVersion ?? null,
      sourceDocuments: sourceDocuments.map((d) => ({ fileName: d.fileName, type: d.type, category: d.category })),
      trustLevel: importTrust,
      requireRawText,
      companyProfileUpdated,
      documents: { received: sourceDocuments.length, created: documentsCreated, updated: documentsUpdated, skipped: documentsSkipped },
      experts: { received: experts.length, created: expertsCreated, updated: expertsUpdated, skipped: expertsSkipped },
      projects: { received: projects.length, created: projectsCreated, updated: projectsUpdated, skipped: projectsSkipped },
      legalRecords: { received: legalRecords.length, ...legal },
      financialRecords: { received: financialRecords.length, ...financial },
      complianceRecords: { received: complianceRecords.length, ...compliance },
      warnings: warnings.slice(0, 50),
    };

    await logAction({
      userId,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: `Plan-B exact JSON import: companyProfile=${companyProfileUpdated}, documents ${documentsCreated}/${documentsUpdated}, experts ${expertsCreated}/${expertsUpdated}, projects ${projectsCreated}/${projectsUpdated}, legal ${legal.created}/${legal.updated}, financial ${financial.created}/${financial.updated}, compliance ${compliance.created}/${compliance.updated}`,
      metadata: result,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[plan-b-import] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Plan-B import failed" }, { status: 400 });
  }
}
