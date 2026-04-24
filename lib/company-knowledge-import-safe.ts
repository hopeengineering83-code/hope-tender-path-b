import { prisma } from "./prisma";

const PROJECT_TARGET = 114;
const EXPERT_TARGET = 29;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return clean(value).toLowerCase();
}

type SourceDoc = {
  originalFileName: string;
  category: string;
  extractedText?: string | null;
};

function extracted(text: string | null | undefined): boolean {
  if (!text || text.trim().length < 200) return false;
  if (/^\[(Scanned PDF|Extraction failed|Legacy \.doc|Image:)/i.test(text.trim())) return false;
  return true;
}

function hasProjectSource(doc: SourceDoc) {
  const text = doc.extractedText ?? "";
  if (!extracted(text)) return false;
  const label = `${doc.originalFileName} ${doc.category}`.toLowerCase();
  return (
    /project|portfolio|reference|contract|experience/.test(label) ||
    /project\s+name|client\s+name|selected\s+projects?|project\s+portfolio|assignment\s+name/i.test(text.slice(0, 20000))
  );
}

function hasExpertSource(doc: SourceDoc) {
  const text = doc.extractedText ?? "";
  if (!extracted(text)) return false;
  const label = `${doc.originalFileName} ${doc.category}`.toLowerCase();
  return /expert|cv|staff|resume|personnel/.test(label) && /name\s+of\s+(?:expert|key\s+staff|personnel)|curriculum\s+vitae/i.test(text);
}

function expectedProjectCount(text: string): number | null {
  const direct = text.match(/(\d{2,3})\s+(?:selected\s+)?projects?/i)?.[1];
  return direct ? Number(direct) : null;
}

function normalizePersonName(value: string): string {
  return clean(value)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Engineer)\s+/i, "")
    .replace(/\s+(Country|Nationality|Date of Birth|Education|Membership|Proposed Position|Position|Key Qualifications).*$/i, "")
    .slice(0, 90);
}

function looksLikePersonName(name: string): boolean {
  if (/hope urban|curriculum|vitae|company|staffing|summary|page|project|client|hospital|city|building|airport|university|factory|hotel|road|bridge/i.test(name)) return false;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every((p) => /^[A-Za-z.'-]+$/.test(p));
}

function parseExpertDrafts(text: string) {
  const names = new Set<string>();
  const expertPattern = /Name\s+of\s+(?:Expert|Key\s+Staff|Personnel)\s*[:\-]?\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Membership|Key Qualifications|Proposed Position|Position|Employment Record)\b)/gi;

  for (const match of text.matchAll(expertPattern)) {
    const name = normalizePersonName(match[1]);
    if (looksLikePersonName(name)) names.add(name);
  }

  return [...names].slice(0, EXPERT_TARGET).map((fullName) => {
    const idx = text.toLowerCase().indexOf(fullName.toLowerCase());
    const source = idx >= 0 ? text.slice(idx, idx + 3000) : text.slice(0, 3000);
    return { fullName, source };
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
    // Put every apparent numbered project on a new line. This is safer than one giant regex.
    .replace(/\s+(?=\d{1,3}\s+[A-Z][A-Za-z])+/g, "\n");

  const lines = normalized.split("\n").map(clean).filter(Boolean);
  const rows: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\d{1,3}\s+[A-Z][A-Za-z]/.test(line)) {
      const next = lines.slice(i + 1, i + 4).filter((candidate) => !/^\d{1,3}\s+[A-Z][A-Za-z]/.test(candidate)).join(" ");
      rows.push(clean(`${line} ${next}`).slice(0, 4000));
    }
  }

  if (rows.length > 0) return rows;

  // Fallback for PDFs that lost line breaks: capture chunks between numbered project markers.
  const flat = text.replace(/\s+/g, " ");
  return [...flat.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Z][A-Za-z][\s\S]{35,}?)(?=\s+\d{1,3}\s+[A-Z][A-Za-z]|$)/g)]
    .map((m) => clean(`${m[1]} ${m[2]}`).slice(0, 4000));
}

function titledProjectRows(text: string): string[] {
  const rows: string[] = [];
  const normalized = normalizeProjectText(text);
  const patterns = [
    /(?:Project\s+Name|Assignment\s+Name)\s*[:\-]?\s*(.+?)(?=\s+(?:Client|Owner|Location|Country|Period|Services|Description|Project\s+Name|Assignment\s+Name)\b|$)/gi,
    /(?:Name\s+of\s+Assignment)\s*[:\-]?\s*(.+?)(?=\s+(?:Client|Owner|Location|Country|Period|Services|Description|Name\s+of\s+Assignment)\b|$)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const title = clean(match[1]);
      if (title.length >= 8) rows.push(title.slice(0, 1200));
    }
  }
  return rows;
}

function cleanProjectName(row: string): string {
  let name = row.replace(/^\d{1,3}\s+/, "");
  name = name.split(/\s+(?:Client|Owner|Location|Country|Constr\.?|Construction|Budget|Fee|Contract|Design|Consultancy|Ref|Testimony|General Manager|Structural Engineer|Geotech Engineer|Architect|Electrical Engineer|Mechanical Engineer|Period|Services|Description)\b/i)[0] ?? name;
  name = name.split(/,\s+[A-Z][a-z]+/)[0] ?? name;
  name = name.replace(/\s*\([^)]*$/, "");
  return clean(name).slice(0, 180);
}

function looksLikeProjectName(name: string): boolean {
  if (name.length < 8 || name.length > 170) return false;
  if (/^(project|name|client|owner|location|country|period|services|description)$/i.test(name)) return false;
  if (/curriculum\s+vitae|name\s+of\s+expert|nationality|date\s+of\s+birth/i.test(name)) return false;
  return /[A-Za-z]/.test(name);
}

function parseProjectDrafts(text: string, target: number | null) {
  const seen = new Set<string>();
  const drafts: Array<{ name: string; source: string }> = [];
  const rows = [...numberedProjectRows(text), ...titledProjectRows(text)];
  const limit = target ?? PROJECT_TARGET;

  for (const row of rows) {
    const name = cleanProjectName(row);
    if (!looksLikeProjectName(name)) continue;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    drafts.push({ name, source: row.slice(0, 3000) });
    if (drafts.length >= limit) break;
  }

  return drafts;
}

export async function importCompanyKnowledgeFromDocuments(companyId: string) {
  const docs = await prisma.companyDocument.findMany({ where: { companyId, extractedText: { not: null } } });
  const expertText = docs.filter((d) => hasExpertSource(d)).map((d) => d.extractedText ?? "").join("\n\n");
  const projectDocs = docs.filter((d) => hasProjectSource(d));
  const projectText = projectDocs.map((d) => d.extractedText ?? "").join("\n\n");
  const projectTarget = projectDocs.map((d) => expectedProjectCount(d.extractedText ?? "")).find((count) => count && count > 0) ?? PROJECT_TARGET;

  const expertDrafts = expertText ? parseExpertDrafts(expertText) : [];
  const projectDrafts = projectText ? parseProjectDrafts(projectText, projectTarget) : [];

  // Remove only auto-imported drafts. Manual records must not be deleted.
  if (expertDrafts.length > 0) {
    await prisma.expert.deleteMany({ where: { companyId, profile: { contains: "AUTO-IMPORTED" } } });
  }
  if (projectDocs.length > 0) {
    await prisma.project.deleteMany({ where: { companyId, summary: { contains: "AUTO-IMPORTED" } } });
  }

  const existingExperts = await prisma.expert.findMany({ where: { companyId }, select: { fullName: true } });
  const existingProjects = await prisma.project.findMany({ where: { companyId }, select: { name: true } });
  const expertKeys = new Set(existingExperts.map((item) => key(item.fullName)));
  const projectKeys = new Set(existingProjects.map((item) => key(item.name)));

  let expertsCreated = 0;
  let projectsCreated = 0;

  for (const expert of expertDrafts) {
    const k = key(expert.fullName);
    if (expertKeys.has(k)) continue;
    await prisma.expert.create({ data: {
      companyId,
      fullName: expert.fullName,
      title: null,
      yearsExperience: null,
      disciplines: "[]",
      sectors: "[]",
      certifications: "[]",
      profile: `[AUTO-IMPORTED FROM CV PDF — REVIEW REQUIRED]\nOnly the expert name is structured. Correct title, years, disciplines, sectors and certifications before using in final tender matching.\n\nSource snippet:\n${expert.source}`,
    }});
    expertKeys.add(k);
    expertsCreated += 1;
  }

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
      summary: `[AUTO-IMPORTED FROM PROJECT PDF — REVIEW REQUIRED]\nOnly the project name is structured. Correct client, country, sector, services, value and dates before using in final tender matching.\n\nSource snippet:\n${project.source}`,
    }});
    projectKeys.add(k);
    projectsCreated += 1;
  }

  return { expertsCreated, projectsCreated, projectSourceDocuments: projectDocs.length, projectDrafts: projectDrafts.length };
}
