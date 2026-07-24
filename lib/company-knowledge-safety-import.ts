import type { Prisma, PrismaClient } from "@prisma/client";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "./company-document-durable-deletion";

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return clean(value).toLocaleLowerCase("en-US");
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, 12);
}

const DEDICATED_EXPERT_CATEGORIES = new Set(["EXPERT_CV"]);
const DEDICATED_PROJECT_CATEGORIES = new Set(["PROJECT_REFERENCE", "PROJECT_CONTRACT", "PORTFOLIO"]);

export type CompanyExpertCandidate = {
  fullName: string;
  title: string | null;
  yearsExperience: number | null;
  disciplines: string[];
  sectors: string[];
  certifications: string[];
  profile: string;
  sourceSnippet: string;
  sourceDocumentId: string;
  sourceAuthority: number;
  trustLevel: "REGEX_DRAFT" | "AI_DRAFT";
};

export type CompanyProjectCandidate = {
  name: string;
  clientName: string | null;
  country: string | null;
  sector: string | null;
  serviceAreas: string[];
  summary: string;
  contractValue: number | null;
  currency: string | null;
  sourceSnippet: string;
  sourceDocumentId: string;
  sourceAuthority: number;
  trustLevel: "REGEX_DRAFT" | "AI_DRAFT";
};

export type CompanyKnowledgeCandidates = {
  experts: CompanyExpertCandidate[];
  projects: CompanyProjectCandidate[];
};

export type SafetyImportResult = {
  docsScanned: number;
  expertsCreated: number;
  projectsCreated: number;
  expertsUpdated: number;
  projectsUpdated: number;
  expertNamesDetected: number;
  projectNamesDetected: number;
};

type SourceDocument = {
  id: string;
  originalFileName: string;
  category: string;
  extractedText: string | null;
};

function expertCapability(document: SourceDocument): number {
  if (DEDICATED_EXPERT_CATEGORIES.has(document.category)) return 3;
  const sample = `${document.originalFileName}\n${document.extractedText ?? ""}`;
  if (/curriculum\s+vitae|resume|name\s+of\s+(?:expert|key\s+staff|personnel)|proposed\s+position|professional\s+experience/i.test(sample)) return 2;
  if (/\b(?:architect|engineer|planner|surveyor|specialist|team\s+leader)\b.{0,80}\b(?:years?|education|certification|experience)\b/is.test(sample)) return 1;
  return 0;
}

function projectCapability(document: SourceDocument): number {
  if (DEDICATED_PROJECT_CATEGORIES.has(document.category)) return 3;
  const sample = `${document.originalFileName}\n${document.extractedText ?? ""}`;
  if (/project\s+name|assignment\s+name|name\s+of\s+assignment|contract\s+title|project\s+reference/i.test(sample)) return 2;
  if (/\b(?:client|owner|contract\s+value|scope\s+of\s+services|completion\s+date)\b/is.test(sample)) return 1;
  return 0;
}

function inferServices(text: string): string[] {
  const services: string[] = [];
  if (/architect|architecture/i.test(text)) services.push("Architecture");
  if (/urban|master\s*plan|planning/i.test(text)) services.push("Urban Planning");
  if (/structural/i.test(text)) services.push("Structural Engineering");
  if (/civil\s+engineer|civil\s+engineering/i.test(text)) services.push("Civil Engineering");
  if (/geotechnical|soil|foundation/i.test(text)) services.push("Geotechnical Engineering");
  if (/electrical/i.test(text)) services.push("Electrical Engineering");
  if (/mechanical/i.test(text)) services.push("Mechanical Engineering");
  if (/sanitary|plumbing|water|drainage/i.test(text)) services.push("Sanitary / Water Engineering");
  if (/road|highway|transport|traffic/i.test(text)) services.push("Roads and Transport");
  if (/project\s+management|construction\s+supervision|contract\s+administration/i.test(text)) services.push("Project Management / Supervision");
  if (/quantity\s+survey|cost\s+estimat/i.test(text)) services.push("Quantity Surveying");
  if (/environment/i.test(text)) services.push("Environmental Engineering");
  return uniq(services);
}

function inferSectors(text: string): string[] {
  const sectors: string[] = [];
  if (/hospital|health|clinic/i.test(text)) sectors.push("Healthcare");
  if (/school|university|education/i.test(text)) sectors.push("Education");
  if (/government|ministry|municipal|city|public/i.test(text)) sectors.push("Government / Public Sector");
  if (/hotel|tourism|resort|lodge/i.test(text)) sectors.push("Hospitality and Tourism");
  if (/residential|apartment|housing/i.test(text)) sectors.push("Residential");
  if (/commercial|office|mixed\s*use/i.test(text)) sectors.push("Commercial");
  if (/road|infrastructure|bridge/i.test(text)) sectors.push("Infrastructure");
  if (/industrial|factory|warehouse/i.test(text)) sectors.push("Industrial");
  if (/water\s+supply|borehole|hydraulic|\bWASH\b|sanitation|wastewater/i.test(text)) sectors.push("Water & Sanitation");
  if (/energy|power\s+plant|\bsolar\b|wind\s+farm|substation|hydropower|electrification/i.test(text)) sectors.push("Energy & Power");
  if (/irrigation|command\s*area|crop\s+water|agri/i.test(text)) sectors.push("Agriculture & Irrigation");
  if (/urban|master\s*plan|city\s+planning/i.test(text)) sectors.push("Urban Planning");
  if (/environment|esia|esmp|safeguard|biodiversity/i.test(text)) sectors.push("Environmental & Social");
  return uniq(sectors);
}

function inferCertifications(text: string): string[] {
  const certifications: string[] = [];
  const patterns = [
    /(?:certification|certificate|professional\s+license|registration)\s*[:\-]?\s*([^\n\r;]{3,120})/gi,
    /\b(?:PMP|LEED\s+AP|PE|RIBA|PRINCE2|ISO\s*\d{4,5})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) certifications.push(clean(match[1] ?? match[0]));
  }
  return uniq(certifications);
}

function parseYears(text: string): number | null {
  const values = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs|year)\s+(?:of\s+)?(?:professional\s+)?experience/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 70);
  return values.length ? Math.max(...values) : null;
}

function parseTitle(text: string): string | null {
  const patterns = [
    /(?:Proposed\s+Position|Position|Title|Profession)\s*[:\-]?\s*([^\n\r:]{3,120})/i,
    /\b(Architect|Urban Planner|Civil Engineer|Structural Engineer|Electrical Engineer|Mechanical Engineer|Sanitary Engineer|Project Manager|Team Leader|Quantity Surveyor|Surveyor|Geotechnical Engineer)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/\s+(Name|Date|Nationality|Education).*$/i, "").slice(0, 120);
  }
  return null;
}

function normalizeName(value: string): string {
  return clean(value)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Prof\.?)\s+/i, "")
    .replace(/[,;].*$/, "")
    .replace(/\s+(Nationality|Country|Date|Birth|Education|Position|Profession|Experience|Phone|Email).*$/i, "")
    .slice(0, 90);
}

const NON_NAME_WORDS = new Set([
  "bank", "world", "corporation", "ministry", "authority", "agency", "institute", "association", "foundation", "group", "company", "limited", "international", "national", "federal", "regional", "municipal", "university", "college", "hospital", "consulting", "consultant", "services", "development", "bureau", "office", "department", "south", "north", "east", "west", "central", "city", "district", "zone", "region", "province", "state", "water", "supply", "road", "bridge", "dam", "power", "energy", "solar", "housing", "construction", "building", "project", "scheme", "phase", "industrial", "commercial", "residential", "mixed", "urban", "rural", "architecture", "engineering", "design", "planning", "survey", "management", "senior", "junior", "principal", "chief", "lead", "head", "associate", "assistant", "deputy", "registered", "certified", "licensed",
]);

function looksLikePersonName(name: string): boolean {
  if (!name || name.length < 5 || name.length > 90) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 &&
    words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word)) &&
    !words.some((word) => NON_NAME_WORDS.has(word.toLocaleLowerCase("en-US")));
}

function snippetAround(text: string, needle: string, radius = 1200): string {
  const index = text.toLocaleLowerCase("en-US").indexOf(needle.toLocaleLowerCase("en-US"));
  if (index < 0) return clean(text.slice(0, radius));
  return clean(text.slice(Math.max(0, index - 240), Math.min(text.length, index + radius)));
}

function extractExpertNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:Full\s+Name|Name\s+of\s+(?:Expert|Key\s+Staff|Personnel|Staff)|Expert\s+Name|Name)\s*[:\-]?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/gi,
    /(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Prof\.?)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/g,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+(?:Architect|Urban Planner|Civil Engineer|Structural Engineer|Electrical Engineer|Mechanical Engineer|Sanitary Engineer|Project Manager|Team Leader|Quantity Surveyor|Surveyor|Geotechnical Engineer)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = normalizeName(match[1]);
      if (looksLikePersonName(name)) names.add(name);
    }
  }
  return [...names].slice(0, 150);
}

function extractProjectNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:Project\s+Name|Assignment\s+Name|Name\s+of\s+Assignment|Contract\s+Title)\s*[:\-]?\s*([^\n\r]{8,180})/gi,
    /(?:^|\n|\r)\s*\d{1,3}[.)]?\s+([A-Z][^\n\r]{8,170})(?=\s*(?:Client|Owner|Location|Country|Scope|Services|Contract|Budget|Period|Year|$))/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = clean(match[1]).replace(/\s+(Client|Owner|Location|Country|Scope|Services|Contract|Budget|Period|Year).*$/i, "").slice(0, 180);
      if (name.length >= 8 && /[A-Za-z]/.test(name)) names.add(name);
    }
  }
  return [...names].slice(0, 250);
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).slice(0, 160);
  }
  return null;
}

function parseContractValue(text: string): { value: number | null; currency: string | null } {
  const match = text.match(/(?:contract\s+value|project\s+value|budget|amount)\s*[:\-]?\s*(ETB|USD|EUR|GBP|CHF|KES|AED)?\s*([\d,.]+)\s*(ETB|USD|EUR|GBP|CHF|KES|AED)?/i);
  if (!match) return { value: null, currency: null };
  const value = Number((match[2] ?? "").replace(/,/g, ""));
  return {
    value: Number.isFinite(value) ? value : null,
    currency: clean(match[1] || match[3]).toUpperCase() || null,
  };
}

export function collectDeterministicCandidates(documents: SourceDocument[]): CompanyKnowledgeCandidates {
  const experts: CompanyExpertCandidate[] = [];
  const projects: CompanyProjectCandidate[] = [];

  for (const document of documents) {
    const text = document.extractedText ?? "";
    if (text.trim().length < 100 || /^\[(Scanned PDF|Extraction failed)/i.test(text.trim())) continue;

    const expertAuthority = expertCapability(document);
    if (expertAuthority > 0) {
      for (const fullName of extractExpertNames(text)) {
        const snippet = snippetAround(text, fullName);
        experts.push({
          fullName,
          title: parseTitle(snippet),
          yearsExperience: parseYears(snippet),
          disciplines: inferServices(snippet),
          sectors: inferSectors(snippet),
          certifications: inferCertifications(snippet),
          profile: `Deterministic extraction from ${document.originalFileName}.`,
          sourceSnippet: snippet,
          sourceDocumentId: document.id,
          sourceAuthority: expertAuthority,
          trustLevel: "REGEX_DRAFT",
        });
      }
    }

    const projectAuthority = projectCapability(document);
    if (projectAuthority > 0) {
      for (const name of extractProjectNames(text)) {
        const snippet = snippetAround(text, name);
        const financial = parseContractValue(snippet);
        const sectors = inferSectors(snippet);
        projects.push({
          name,
          clientName: firstMatch(snippet, [/Client\s*[:\-]?\s*([^\n\r]{3,160})/i, /Owner\s*[:\-]?\s*([^\n\r]{3,160})/i]),
          country: firstMatch(snippet, [/Country\s*[:\-]?\s*([^\n\r]{3,80})/i, /Location\s*[:\-]?\s*([^\n\r]{3,120})/i]),
          sector: sectors[0] ?? null,
          serviceAreas: inferServices(snippet),
          summary: `Deterministic extraction from ${document.originalFileName}.`,
          contractValue: financial.value,
          currency: financial.currency,
          sourceSnippet: snippet,
          sourceDocumentId: document.id,
          sourceAuthority: projectAuthority,
          trustLevel: "REGEX_DRAFT",
        });
      }
    }
  }

  return { experts, projects };
}

function sourceAuthority(category: string | null | undefined, kind: "EXPERT" | "PROJECT"): number {
  if (kind === "EXPERT" && category && DEDICATED_EXPERT_CATEGORIES.has(category)) return 3;
  if (kind === "PROJECT" && category && DEDICATED_PROJECT_CATEGORIES.has(category)) return 3;
  return 1;
}

async function persistOnce(
  client: PrismaClient,
  companyId: string,
  candidates: CompanyKnowledgeCandidates,
): Promise<Pick<SafetyImportResult, "expertsCreated" | "projectsCreated" | "expertsUpdated" | "projectsUpdated">> {
  return client.$transaction(async (tx) => {
    let expertsCreated = 0;
    let projectsCreated = 0;
    let expertsUpdated = 0;
    let projectsUpdated = 0;

    const expertByKey = new Map<string, CompanyExpertCandidate>();
    for (const candidate of candidates.experts) {
      const existing = expertByKey.get(key(candidate.fullName));
      if (!existing || candidate.sourceAuthority > existing.sourceAuthority ||
        (candidate.sourceAuthority === existing.sourceAuthority && candidate.trustLevel === "AI_DRAFT")) {
        expertByKey.set(key(candidate.fullName), candidate);
      }
    }

    const projectByKey = new Map<string, CompanyProjectCandidate>();
    for (const candidate of candidates.projects) {
      const existing = projectByKey.get(key(candidate.name));
      if (!existing || candidate.sourceAuthority > existing.sourceAuthority ||
        (candidate.sourceAuthority === existing.sourceAuthority && candidate.trustLevel === "AI_DRAFT")) {
        projectByKey.set(key(candidate.name), candidate);
      }
    }

    for (const candidate of expertByKey.values()) {
      const existing = await tx.expert.findFirst({
        where: { companyId, fullName: { equals: candidate.fullName, mode: "insensitive" }, deletedAt: null },
        select: { id: true, trustLevel: true, sourceDocument: { select: { category: true } } },
      });
      if (existing?.trustLevel === "REVIEWED") continue;
      if (existing && sourceAuthority(existing.sourceDocument?.category, "EXPERT") > candidate.sourceAuthority) continue;

      const data = {
        fullName: candidate.fullName,
        title: candidate.title,
        yearsExperience: candidate.yearsExperience,
        disciplines: JSON.stringify(candidate.disciplines),
        sectors: JSON.stringify(candidate.sectors),
        certifications: JSON.stringify(candidate.certifications),
        profile: `[${candidate.trustLevel} — REVIEW REQUIRED before final approval]\n\n${candidate.profile}\n\nSource snippet:\n${candidate.sourceSnippet}`,
        trustLevel: candidate.trustLevel,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        sourceDocumentId: candidate.sourceDocumentId,
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
      };
      if (existing) {
        await tx.expert.update({ where: { id: existing.id }, data });
        expertsUpdated += 1;
      } else {
        await tx.expert.create({ data: { companyId, ...data } });
        expertsCreated += 1;
      }
    }

    for (const candidate of projectByKey.values()) {
      const existing = await tx.project.findFirst({
        where: { companyId, name: { equals: candidate.name, mode: "insensitive" }, deletedAt: null },
        select: { id: true, trustLevel: true, sourceDocument: { select: { category: true } } },
      });
      if (existing?.trustLevel === "REVIEWED") continue;
      if (existing && sourceAuthority(existing.sourceDocument?.category, "PROJECT") > candidate.sourceAuthority) continue;

      const data = {
        name: candidate.name,
        clientName: candidate.clientName,
        country: candidate.country,
        sector: candidate.sector,
        serviceAreas: JSON.stringify(candidate.serviceAreas),
        summary: `[${candidate.trustLevel} — REVIEW REQUIRED before final approval]\n\n${candidate.summary}\n\nSource snippet:\n${candidate.sourceSnippet}`,
        contractValue: candidate.contractValue,
        currency: candidate.currency,
        trustLevel: candidate.trustLevel,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        sourceDocumentId: candidate.sourceDocumentId,
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
      };
      if (existing) {
        await tx.project.update({ where: { id: existing.id }, data });
        projectsUpdated += 1;
      } else {
        await tx.project.create({ data: { companyId, ...data } });
        projectsCreated += 1;
      }
    }

    return { expertsCreated, projectsCreated, expertsUpdated, projectsUpdated };
  }, { isolationLevel: "Serializable" });
}

export async function persistCompanyKnowledgeCandidates(
  client: PrismaClient,
  companyId: string,
  candidates: CompanyKnowledgeCandidates,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await persistOnce(client, companyId, candidates);
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      if (code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw lastError;
}

export async function runCompanyKnowledgeSafetyImport(client: PrismaClient, companyId: string): Promise<SafetyImportResult> {
  const documents = await client.companyDocument.findMany({
    where: {
      companyId,
      extractedText: { not: null },
      NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } },
    },
    select: { id: true, originalFileName: true, category: true, extractedText: true },
  });
  const candidates = collectDeterministicCandidates(documents);
  const persisted = await persistCompanyKnowledgeCandidates(client, companyId, candidates);
  return {
    docsScanned: documents.length,
    ...persisted,
    expertNamesDetected: candidates.experts.length,
    projectNamesDetected: candidates.projects.length,
  };
}
