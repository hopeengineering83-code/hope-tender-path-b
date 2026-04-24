import { prisma } from "./prisma";

const PROJECT_TARGET = 114;
const EXPERT_TARGET = 29;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return clean(value).toLowerCase();
}

function hasProjectSource(name: string, text: string) {
  return /project|portfolio|reference/i.test(name) && text.length > 5000;
}

function hasExpertSource(name: string, text: string) {
  return /expert|cv|staff|resume/i.test(name) && /name\s+of\s+(?:expert|key\s+staff|personnel)|curriculum\s+vitae/i.test(text);
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

function projectChunks(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const rows = [...normalized.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Z][A-Za-z][\s\S]{35,}?)(?=\s+\d{1,3}\s+[A-Z][A-Za-z]|$)/g)]
    .map((m) => clean(`${m[1]} ${m[2]}`));
  return rows.filter((row) => /^\d{1,3}\s+/.test(row)).slice(0, PROJECT_TARGET);
}

function cleanProjectName(row: string): string {
  let name = row.replace(/^\d{1,3}\s+/, "");
  name = name.split(/\s+(?:Client|Owner|Location|Country|Constr\.?|Construction|Budget|Fee|Contract|Design|Consultancy|Ref|Testimony|General Manager|Structural Engineer|Geotech Engineer|Architect|Electrical Engineer|Mechanical Engineer)\b/i)[0] ?? name;
  name = name.split(/,\s+[A-Z][a-z]+/)[0] ?? name;
  return clean(name).replace(/\s*\([^)]*$/, "").slice(0, 180);
}

function parseProjectDrafts(text: string) {
  const seen = new Set<string>();
  const drafts: Array<{ name: string; source: string }> = [];
  for (const row of projectChunks(text)) {
    const name = cleanProjectName(row);
    if (name.length < 8 || name.length > 170) continue;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    drafts.push({ name, source: row.slice(0, 3000) });
    if (drafts.length >= PROJECT_TARGET) break;
  }
  return drafts;
}

export async function importCompanyKnowledgeFromDocuments(companyId: string) {
  const docs = await prisma.companyDocument.findMany({ where: { companyId, extractedText: { not: null } } });
  const expertText = docs.filter((d) => hasExpertSource(d.originalFileName, d.extractedText ?? "")).map((d) => d.extractedText ?? "").join("\n\n");
  const projectText = docs.filter((d) => hasProjectSource(d.originalFileName, d.extractedText ?? "")).map((d) => d.extractedText ?? "").join("\n\n");

  const expertDrafts = expertText ? parseExpertDrafts(expertText) : [];
  const projectDrafts = projectText ? parseProjectDrafts(projectText) : [];

  // Remove only auto-imported drafts. Manual records must not be deleted.
  if (expertDrafts.length > 0) {
    await prisma.expert.deleteMany({ where: { companyId, profile: { contains: "AUTO-IMPORTED" } } });
  }
  if (projectDrafts.length > 0) {
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

  return { expertsCreated, projectsCreated };
}
