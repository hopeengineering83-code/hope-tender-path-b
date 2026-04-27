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

type PlanBPayload = {
  schemaVersion?: string;
  sourceDocuments?: Array<{ fileName?: string; type?: string; pages?: number; parsedExperts?: number; parsedProjects?: number; sha256?: string }>;
  importPolicy?: { trustLevel?: TrustLevel; reviewNotes?: string; requireRawText?: boolean };
  experts?: PlanBExpert[];
  projects?: PlanBProject[];
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
  return payload.importPolicy?.reviewNotes || "Plan-B exact structured import from externally extracted PDF text. Full raw source text is preserved in the record narrative and should be used as the factual source.";
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

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  try {
    const payload = await readPayload(req);
    const experts = Array.isArray(payload.experts) ? payload.experts : [];
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    const importTrust = requestedTrust(payload);
    const requireRawText = payload.importPolicy?.requireRawText !== false;
    const notes = reviewNotes(payload);
    const now = new Date();

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

    const result = {
      success: true,
      schemaVersion: payload.schemaVersion ?? null,
      sourceDocuments: payload.sourceDocuments ?? [],
      trustLevel: importTrust,
      requireRawText,
      experts: { received: experts.length, created: expertsCreated, updated: expertsUpdated, skipped: expertsSkipped },
      projects: { received: projects.length, created: projectsCreated, updated: projectsUpdated, skipped: projectsSkipped },
      warnings: warnings.slice(0, 50),
    };

    await logAction({
      userId,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: `Plan-B exact JSON import: ${expertsCreated} experts created, ${expertsUpdated} experts updated, ${projectsCreated} projects created, ${projectsUpdated} projects updated`,
      metadata: result,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[plan-b-import] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Plan-B import failed" }, { status: 400 });
  }
}
