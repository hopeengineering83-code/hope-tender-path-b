import { prisma } from "./prisma";

const DEFAULT_PROJECT_TARGET = 114;
const DEFAULT_EXPERT_TARGET = 29;
const IMPORT_VERSION = "knowledge-import-v4";

type SourceDoc = {
  id: string;
  originalFileName: string;
  category: string;
  extractedText?: string | null;
  updatedAt?: Date;
};

type Draft = { name: string; source: string; sourceFile: string };

type ImportOptions = { force?: boolean };

export type KnowledgeDiagnostics = {
  importVersion: string;
  fingerprint: string;
  documents: Array<{
    id: string;
    fileName: string;
    category: string;
    extractedChars: number;
    status: "EXTRACTED" | "EMPTY" | "WARNING";
    isExpertSource: boolean;
    isProjectSource: boolean;
  }>;
  totals: {
    documents: number;
    extractedDocuments: number;
    expertSourceDocuments: number;
    projectSourceDocuments: number;
    currentExperts: number;
    currentProjects: number;
    autoImportedExperts: number;
    autoImportedProjects: number;
    parsedExpertDrafts: number;
    parsedProjectDrafts: number;
    expectedExperts: number | null;
    expectedProjects: number | null;
  };
  gaps: Array<{ severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string; detail: string }>;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return clean(value).toLowerCase();
}

function extracted(text: string | null | undefined): boolean {
  if (!text || text.trim().length < 200) return false;
  if (/^\[(Scanned PDF|Extraction failed|Legacy \.doc|Image:)/i.test(text.trim())) return false;
  return true;
}

function extractionStatus(text: string | null | undefined): "EXTRACTED" | "EMPTY" | "WARNING" {
  if (!text?.trim()) return "EMPTY";
  if (!extracted(text)) return "WARNING";
  return "EXTRACTED";
}

function stableHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h) ^ value.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function fingerprintDocs(docs: SourceDoc[]): string {
  const payload = docs
    .map((d) => `${d.id}|${d.originalFileName}|${d.category}|${d.extractedText?.length ?? 0}|${d.extractedText?.slice(0, 80) ?? ""}|${d.extractedText?.slice(-80) ?? ""}`)
    .sort()
    .join("\n");
  return `${IMPORT_VERSION}:${stableHash(payload)}`;
}

function autoMarker(fingerprint: string): string {
  return `[AUTO-IMPORTED:${IMPORT_VERSION};FINGERPRINT:${fingerprint}]`;
}

function hasMarker(text: string | null | undefined): boolean {
  return Boolean(text?.includes("AUTO-IMPORTED"));
}

function markerMatches(text: string | null | undefined, fingerprint: string): boolean {
  return Boolean(text?.includes(`FINGERPRINT:${fingerprint}`));
}

function label(doc: SourceDoc): string {
  return `${doc.originalFileName} ${doc.category}`.toLowerCase();
}

function isExpertSource(doc: SourceDoc): boolean {
  const text = doc.extractedText ?? "";
  if (!extracted(text)) return false;
  if (/project_reference|project_contract|portfolio/i.test(doc.category)) return false;
  return /expert|cv|staff|resume|personnel/i.test(label(doc)) && /name\s+of\s+(?:expert|key\s+staff|personnel)|curriculum\s+vitae|proposed\s+position/i.test(text.slice(0, 80000));
}

function isProjectSource(doc: SourceDoc): boolean {
  const text = doc.extractedText ?? "";
  if (!extracted(text)) return false;
  if (/expert_cv/i.test(doc.category)) return false;
  return (
    /project|portfolio|reference|contract|experience/i.test(label(doc)) ||
    /project\s+name|client\s+name|selected\s+projects?|project\s+portfolio|assignment\s+name|name\s+of\s+assignment/i.test(text.slice(0, 100000))
  );
}

function expectedProjectCount(text: string): number | null {
  const direct = text.match(/(\d{2,3})\s+(?:selected\s+)?projects?/i)?.[1];
  if (direct) return Number(direct);
  return /selected\s+projects?|project\s+portfolio/i.test(text) ? DEFAULT_PROJECT_TARGET : null;
}

function expectedExpertCount(text: string): number | null {
  const direct = text.match(/(\d{1,2})\s+(?:experts|expert cvs|cv|cvs|staff|personnel)/i)?.[1];
  if (direct) return Number(direct);
  return /curriculum\s+vitae|name\s+of\s+expert/i.test(text) ? DEFAULT_EXPERT_TARGET : null;
}

function normalizePersonName(value: string): string {
  return clean(value)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Engineer)\s+/i, "")
    .replace(/\s+(Country|Nationality|Date of Birth|Education|Membership|Proposed Position|Position|Key Qualifications|Employment Record).*$/i, "")
    .slice(0, 90);
}

function looksLikePersonName(name: string): boolean {
  if (/hope urban|curriculum|vitae|company|staffing|summary|page|project|client|hospital|city|building|airport|university|factory|hotel|road|bridge/i.test(name)) return false;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every((p) => /^[A-Za-z.'-]+$/.test(p));
}

function parseExpertDraftsFromDoc(doc: SourceDoc): Draft[] {
  const text = doc.extractedText ?? "";
  const names = new Set<string>();
  const patterns = [
    /Name\s+of\s+(?:Expert|Key\s+Staff|Personnel)\s*[:\-]?\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Membership|Key Qualifications|Proposed Position|Position|Employment Record)\b)/gi,
    /(?:^|\s)(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})(?=\s+(?:Proposed Position|Position|Education|Key Qualifications|Civil Engineer|Architect|Planner|Engineer)\b)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = normalizePersonName(match[1]);
      if (looksLikePersonName(name)) names.add(name);
    }
  }

  const target = expectedExpertCount(text) ?? DEFAULT_EXPERT_TARGET;
  return [...names].slice(0, target).map((name) => {
    const idx = text.toLowerCase().indexOf(name.toLowerCase());
    const source = idx >= 0 ? text.slice(idx, idx + 3500) : text.slice(0, 3500);
    return { name, source, sourceFile: doc.originalFileName };
  });
}

function normalizeProjectText(text: string): string {
  return text
    .replace(/\[Page \d+\]/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function numberedProjectRows(text: string): string[] {
  const normalized = normalizeProjectText(text)
    .replace(/\s+(?=\d{1,3}\s+[A-Z][A-Za-z])+/g, "\n");
  const lines = normalized.split("\n").map(clean).filter(Boolean);
  const rows: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\d{1,3}\s+[A-Z][A-Za-z]/.test(line)) {
      const next = lines.slice(i + 1, i + 4).filter((candidate) => !/^\d{1,3}\s+[A-Z][A-Za-z]/.test(candidate)).join(" ");
      rows.push(clean(`${line} ${next}`).slice(0, 4500));
    }
  }

  if (rows.length > 0) return rows;
  const flat = text.replace(/\s+/g, " ");
  return [...flat.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Z][A-Za-z][\s\S]{35,}?)(?=\s+\d{1,3}\s+[A-Z][A-Za-z]|$)/g)]
    .map((m) => clean(`${m[1]} ${m[2]}`).slice(0, 4500));
}

function titledProjectRows(text: string): string[] {
  const rows: string[] = [];
  const normalized = normalizeProjectText(text);
  const patterns = [
    /(?:Project\s+Name|Assignment\s+Name|Name\s+of\s+Assignment)\s*[:\-]?\s*(.+?)(?=\s+(?:Client|Owner|Location|Country|Period|Services|Description|Project\s+Name|Assignment\s+Name|Name\s+of\s+Assignment)\b|$)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const title = clean(match[1]);
      if (title.length >= 8) rows.push(title.slice(0, 1500));
    }
  }
  return rows;
}

function cleanProjectName(row: string): string {
  let name = row.replace(/^\d{1,3}\s+/, "");
  name = name.split(/\s+(?:Client|Owner|Location|Country|Constr\.?|Construction|Budget|Fee|Contract|Design|Consultancy|Ref|Testimony|General Manager|Structural Engineer|Geotech Engineer|Architect|Electrical Engineer|Mechanical Engineer|Period|Services|Description|Start Date|End Date)\b/i)[0] ?? name;
  name = name.split(/,\s+[A-Z][a-z]+/)[0] ?? name;
  name = name.replace(/\s*\([^)]*$/, "");
  return clean(name).slice(0, 180);
}

function looksLikeProjectName(name: string): boolean {
  if (name.length < 8 || name.length > 170) return false;
  if (/^(project|name|client|owner|location|country|period|services|description)$/i.test(name)) return false;
  if (/curriculum\s+vitae|name\s+of\s+expert|nationality|date\s+of\s+birth|proposed\s+position/i.test(name)) return false;
  return /[A-Za-z]/.test(name);
}

function parseProjectDraftsFromDoc(doc: SourceDoc): Draft[] {
  const text = doc.extractedText ?? "";
  const target = expectedProjectCount(text) ?? DEFAULT_PROJECT_TARGET;
  const rows = [...numberedProjectRows(text), ...titledProjectRows(text)];
  const drafts: Draft[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const name = cleanProjectName(row);
    if (!looksLikeProjectName(name)) continue;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    drafts.push({ name, source: row.slice(0, 3500), sourceFile: doc.originalFileName });
    if (drafts.length >= target) break;
  }

  return drafts;
}

async function getDiagnosticsAndDrafts(companyId: string) {
  const docs = await prisma.companyDocument.findMany({ where: { companyId, extractedText: { not: null } } }) as SourceDoc[];
  const fingerprint = fingerprintDocs(docs);

  const expertDocs = docs.filter(isExpertSource);
  const projectDocs = docs.filter(isProjectSource);
  const expertDrafts = [...new Map(expertDocs.flatMap(parseExpertDraftsFromDoc).map((d) => [key(d.name), d])).values()];
  const projectDrafts = [...new Map(projectDocs.flatMap(parseProjectDraftsFromDoc).map((d) => [key(d.name), d])).values()];
  const expectedExperts = expertDocs.map((d) => expectedExpertCount(d.extractedText ?? "")).find((n) => n && n > 0) ?? null;
  const expectedProjects = projectDocs.map((d) => expectedProjectCount(d.extractedText ?? "")).find((n) => n && n > 0) ?? null;

  const [experts, projects] = await Promise.all([
    prisma.expert.findMany({ where: { companyId }, select: { profile: true } }),
    prisma.project.findMany({ where: { companyId }, select: { summary: true } }),
  ]);
  const autoExperts = experts.filter((e) => hasMarker(e.profile));
  const autoProjects = projects.filter((p) => hasMarker(p.summary));

  const gaps: KnowledgeDiagnostics["gaps"] = [];
  const extractedDocs = docs.filter((d) => extracted(d.extractedText)).length;
  if (docs.length === 0) gaps.push({ severity: "CRITICAL", title: "No extracted company documents", detail: "Upload company documents before running tender matching." });
  if (docs.length > 0 && extractedDocs === 0) gaps.push({ severity: "CRITICAL", title: "Documents exist but no usable extracted text", detail: "Re-upload files or convert scanned PDFs with OCR." });
  if (expertDocs.length === 0) gaps.push({ severity: "HIGH", title: "No expert source documents detected", detail: "Upload Expert CV files or mark CV documents as Expert CV." });
  if (projectDocs.length === 0) gaps.push({ severity: "HIGH", title: "No project source documents detected", detail: "Upload project references, portfolios, contracts, or experience sheets." });
  if (expertDocs.length > 0 && expertDrafts.length === 0) gaps.push({ severity: "HIGH", title: "Expert documents extracted but no expert names parsed", detail: "Use CVs with explicit 'Name of Expert' fields or add experts manually." });
  if (projectDocs.length > 0 && projectDrafts.length === 0) gaps.push({ severity: "HIGH", title: "Project documents extracted but no project rows parsed", detail: "Use numbered project rows, Project Name, Assignment Name, or add projects manually." });
  if (expectedExperts && expertDrafts.length < expectedExperts) gaps.push({ severity: "MEDIUM", title: "Parsed fewer experts than expected", detail: `Expected about ${expectedExperts}, parsed ${expertDrafts.length}. Review CV formatting or add missing experts manually.` });
  if (expectedProjects && projectDrafts.length < expectedProjects) gaps.push({ severity: "MEDIUM", title: "Parsed fewer projects than expected", detail: `Expected about ${expectedProjects}, parsed ${projectDrafts.length}. Review source snippets or add missing projects manually.` });

  const diagnostics: KnowledgeDiagnostics = {
    importVersion: IMPORT_VERSION,
    fingerprint,
    documents: docs.map((doc) => ({
      id: doc.id,
      fileName: doc.originalFileName,
      category: doc.category,
      extractedChars: doc.extractedText?.length ?? 0,
      status: extractionStatus(doc.extractedText),
      isExpertSource: isExpertSource(doc),
      isProjectSource: isProjectSource(doc),
    })),
    totals: {
      documents: docs.length,
      extractedDocuments: extractedDocs,
      expertSourceDocuments: expertDocs.length,
      projectSourceDocuments: projectDocs.length,
      currentExperts: experts.length,
      currentProjects: projects.length,
      autoImportedExperts: autoExperts.length,
      autoImportedProjects: autoProjects.length,
      parsedExpertDrafts: expertDrafts.length,
      parsedProjectDrafts: projectDrafts.length,
      expectedExperts,
      expectedProjects,
    },
    gaps,
  };

  return { diagnostics, expertDrafts, projectDrafts };
}

export async function analyzeCompanyKnowledgeGaps(companyId: string): Promise<KnowledgeDiagnostics> {
  return (await getDiagnosticsAndDrafts(companyId)).diagnostics;
}

export async function importCompanyKnowledgeFromDocuments(companyId: string, options: ImportOptions = {}) {
  const { diagnostics, expertDrafts, projectDrafts } = await getDiagnosticsAndDrafts(companyId);
  const fingerprint = diagnostics.fingerprint;

  const [existingExperts, existingProjects] = await Promise.all([
    prisma.expert.findMany({ where: { companyId }, select: { fullName: true, profile: true } }),
    prisma.project.findMany({ where: { companyId }, select: { name: true, summary: true } }),
  ]);

  const autoExperts = existingExperts.filter((e) => hasMarker(e.profile));
  const autoProjects = existingProjects.filter((p) => hasMarker(p.summary));
  const expertImportFresh = autoExperts.length > 0 && autoExperts.every((e) => markerMatches(e.profile, fingerprint));
  const projectImportFresh = autoProjects.length > 0 && autoProjects.every((p) => markerMatches(p.summary, fingerprint));

  const rebuildExperts = options.force || (expertDrafts.length > 0 && (!expertImportFresh || autoExperts.length !== expertDrafts.length));
  const rebuildProjects = options.force || (projectDrafts.length > 0 && (!projectImportFresh || autoProjects.length !== projectDrafts.length));

  if (rebuildExperts) await prisma.expert.deleteMany({ where: { companyId, profile: { contains: "AUTO-IMPORTED" } } });
  if (rebuildProjects) await prisma.project.deleteMany({ where: { companyId, summary: { contains: "AUTO-IMPORTED" } } });

  const afterExperts = rebuildExperts ? [] : existingExperts;
  const afterProjects = rebuildProjects ? [] : existingProjects;
  const expertKeys = new Set(afterExperts.map((item) => key(item.fullName)));
  const projectKeys = new Set(afterProjects.map((item) => key(item.name)));
  const marker = autoMarker(fingerprint);

  let expertsCreated = 0;
  let projectsCreated = 0;

  if (rebuildExperts) {
    for (const expert of expertDrafts) {
      const k = key(expert.name);
      if (expertKeys.has(k)) continue;
      await prisma.expert.create({ data: {
        companyId,
        fullName: expert.name,
        title: null,
        yearsExperience: null,
        disciplines: "[]",
        sectors: "[]",
        certifications: "[]",
        profile: `${marker}\n[AUTO-IMPORTED FROM CV PDF — REVIEW REQUIRED]\nSource file: ${expert.sourceFile}\nOnly the expert name is structured. Correct title, years, disciplines, sectors and certifications before using in final tender matching.\n\nSource snippet:\n${expert.source}`,
      }});
      expertKeys.add(k);
      expertsCreated += 1;
    }
  }

  if (rebuildProjects) {
    for (const project of projectDrafts) {
      const k = key(project.name);
      if (projectKeys.has(k)) continue;
      await prisma.project.create({ data: {
        companyId,
        name: project.name,
        clientName: null,
        country: null,
        sector: null,
        serviceAreas: "[]",
        summary: `${marker}\n[AUTO-IMPORTED FROM PROJECT DOCUMENT — REVIEW REQUIRED]\nSource file: ${project.sourceFile}\nOnly the project name is structured. Correct client, country, sector, services, value and dates before using in final tender matching.\n\nSource snippet:\n${project.source}`,
      }});
      projectKeys.add(k);
      projectsCreated += 1;
    }
  }

  return {
    expertsCreated,
    projectsCreated,
    expertsRebuilt: rebuildExperts,
    projectsRebuilt: rebuildProjects,
    diagnostics: await analyzeCompanyKnowledgeGaps(companyId),
  };
}
