import { prisma } from "./prisma";

// ─── helpers ──────────────────────────────────────────────────────────────────

function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}
function key(v: string): string {
  return clean(v).toLowerCase();
}
function uniq(arr: string[]): string[] {
  return [...new Set(arr.map(clean).filter(Boolean))].slice(0, 10);
}
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return clean(m[1]);
  }
  return null;
}

// ─── domain inference ─────────────────────────────────────────────────────────

function inferServices(text: string): string[] {
  const s: string[] = [];
  if (/structural/i.test(text)) s.push("Structural Engineering");
  if (/geotechnical|soil|foundation/i.test(text)) s.push("Geotechnical Engineering");
  if (/architect/i.test(text)) s.push("Architecture");
  if (/urban|master\s*plan|planning/i.test(text)) s.push("Urban Planning");
  if (/mep|electrical|mechanical|plumbing/i.test(text)) s.push("MEP Engineering");
  if (/road|highway|infrastructure/i.test(text)) s.push("Roads and Infrastructure");
  if (/project\s*management|contract\s*admin|construction\s*supervision/i.test(text)) s.push("Project Management");
  if (/interior/i.test(text)) s.push("Interior Design");
  if (/landscape/i.test(text)) s.push("Landscape Design");
  if (/environmental/i.test(text)) s.push("Environmental Engineering");
  if (/water|sanitation|drainage/i.test(text)) s.push("Water and Sanitation");
  if (/transport|traffic/i.test(text)) s.push("Transport Planning");
  return uniq(s);
}

function inferSectors(text: string): string[] {
  const s: string[] = [];
  if (/hospital|health/i.test(text)) s.push("Healthcare");
  if (/hotel|tourism|lodge|museum|heritage/i.test(text)) s.push("Hospitality and Tourism");
  if (/government|ministry|agency|public|city\s*admin/i.test(text)) s.push("Government");
  if (/factory|industrial|abattoir|warehouse|processing/i.test(text)) s.push("Industrial");
  if (/commercial|office|mixed\s*use|apartment|residential/i.test(text)) s.push("Commercial and Residential");
  if (/road|infrastructure/i.test(text)) s.push("Infrastructure");
  if (/education|university|school/i.test(text)) s.push("Education");
  if (/sport|stadium|recreation/i.test(text)) s.push("Sports and Recreation");
  if (/energy|power|solar|wind/i.test(text)) s.push("Energy");
  return uniq(s);
}

function inferCountry(text: string): string | null {
  const countries = [
    "Ethiopia","Kenya","Nigeria","South Sudan","Sudan","Rwanda","Uganda","Tanzania",
    "UAE","United Arab Emirates","Saudi Arabia","Qatar","Kuwait","Bahrain","Oman",
    "Egypt","Ghana","Mozambique","Zambia","Zimbabwe","South Africa",
  ];
  for (const c of countries) {
    if (new RegExp(c.replace(/ /g, "\\s+"), "i").test(text)) return c;
  }
  return null;
}

function parseYears(text: string): number | null {
  const m = text.match(/(\d{1,2})\+?\s*(?:years|yrs|year)/i);
  return m?.[1] ? Number(m[1]) : null;
}

function parseMoney(text: string): { value: number | null; currency: string | null } {
  const m = text.match(/(?:Constr\.?|Budget|Fee|Contract|Design|Consultancy|Value)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*(B|M|K)?\s*(ETB|USD|EUR|€|GBP|AED|SAR)?/i);
  if (!m) return { value: null, currency: null };
  let value = Number(m[1].replace(/,/g, ""));
  if (m[2]?.toUpperCase() === "B") value *= 1_000_000_000;
  if (m[2]?.toUpperCase() === "M") value *= 1_000_000;
  if (m[2]?.toUpperCase() === "K") value *= 1_000;
  const currency = m[3] === "€" ? "EUR" : m[3]?.toUpperCase() ?? null;
  return { value, currency };
}

// ─── expert parsing ───────────────────────────────────────────────────────────

function normalizeName(v: string): string {
  let name = clean(v)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Engineer|Prof\.?)\s+/i, "")
    .replace(/\s+(Country|Nationality|Date of Birth|Education|Membership|Proposed Position|Position|Employment).*$/i, "");
  name = name.split(/\s+(?:Key Qualifications|Employment Record|Languages|Certification|Education)\b/i)[0] ?? name;
  return clean(name).slice(0, 90);
}

function looksLikePersonName(name: string): boolean {
  if (name.length < 5 || name.length > 90) return false;
  if (/hope urban|curriculum|vitae|company|page|staffing|summary|project|client|hospital|city|building|airport|university|factory|hotel|road|bridge/i.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 6 && words.every((w) => /^[A-Za-z.'-]+$/.test(w));
}

// Split document text into per-CV sections at every CV/expert marker.
function expertSections(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const markers = [
    ...normalized.matchAll(/(?:Name\s+of\s+(?:Expert|Key\s+Staff|Personnel)|CURRICULUM\s+VITAE|CV\s+of\b|^\s*CV\s*[-:]\s*|Expert\s+(?:Profile|Bio)\s*[-:])/gim),
  ].map((m) => m.index ?? 0);

  if (markers.length === 0) return [normalized];

  const sections: string[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i];
    const end = markers[i + 1] ?? Math.min(normalized.length, start + 12_000);
    const section = clean(normalized.slice(start, end));
    if (section.length > 100) sections.push(section);
  }
  return sections;
}

// Fallback: find names by honorific or job-title proximity
function fallbackExpertNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Prof\.?)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/g,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:Civil Engineer|Structural Engineer|Architect|Urban Planner|Project Manager|Geotechnical Engineer|Mechanical Engineer|Electrical Engineer|Environmental Engineer|Transport Planner)/g,
  ];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const name = normalizeName(m[1]);
      if (looksLikePersonName(name)) names.add(name);
    }
  }
  return [...names];
}

function parseExperts(text: string, expected?: number | null): ExpertDraft[] {
  const drafts: ExpertDraft[] = [];
  const seen = new Set<string>();

  for (const section of expertSections(text)) {
    const rawName = firstMatch(section, [
      /Name\s+of\s+(?:Expert|Key\s+Staff|Personnel)\s*[:\-]?\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Membership|Key Qualifications|Proposed Position|Position)\b)/i,
      /Name\s*[:\-]\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Membership|Key Qualifications|Proposed Position|Position)\b)/i,
      /CURRICULUM\s+VITAE\s+(.+?)(?:\s+(?:Proposed Position|Position|Education|Key Qualifications)\b)/i,
      /CV\s+of\s+(.+?)(?:\s+(?:Proposed Position|Position|Education|Key Qualifications)\b)/i,
    ]);
    if (!rawName) continue;
    const fullName = normalizeName(rawName);
    if (!looksLikePersonName(fullName)) continue;
    const k = key(fullName);
    if (seen.has(k)) continue;
    seen.add(k);

    const title = firstMatch(section, [
      /Proposed\s+Position\s*[:\-]?\s*(.+?)(?:\s+(?:Name of Firm|Name of Expert|Date of Birth|Education|Membership|Key Qualifications)\b)/i,
      /Position\s*[:\-]?\s*(.+?)(?:\s+(?:Name of Firm|Name of Expert|Date of Birth|Education|Membership|Key Qualifications)\b)/i,
    ]);

    drafts.push({
      fullName,
      title: title ? clean(title).slice(0, 140) : null,
      yearsExperience: parseYears(section),
      disciplines: inferServices(section),
      sectors: inferSectors(section),
      certifications: [],
      profile: `[AUTO-IMPORTED FROM DOCUMENT — REVIEW REQUIRED]\n${section.slice(0, 3000)}`,
    });
  }

  // Fallback: pick up names that didn't have a standard header
  if (!expected || drafts.length < expected) {
    for (const name of fallbackExpertNames(text)) {
      if (expected && drafts.length >= expected) break;
      if (drafts.length >= 120) break;
      const k = key(name);
      if (seen.has(k)) continue;
      seen.add(k);
      const idx = text.toLowerCase().indexOf(name.toLowerCase());
      const snippet = idx >= 0 ? text.slice(idx, idx + 3000) : text.slice(0, 3000);
      drafts.push({
        fullName: name,
        title: null,
        yearsExperience: parseYears(snippet),
        disciplines: inferServices(snippet),
        sectors: inferSectors(snippet),
        certifications: [],
        profile: `[AUTO-IMPORTED FROM DOCUMENT — REVIEW REQUIRED]\n${snippet}`,
      });
    }
  }

  return drafts.slice(0, expected ?? 120);
}

type ExpertDraft = {
  fullName: string; title: string | null; yearsExperience: number | null;
  disciplines: string[]; sectors: string[]; certifications: string[]; profile: string;
};

// ─── project parsing ──────────────────────────────────────────────────────────

function projectChunks(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const chunks: string[] = [];

  // Numbered rows (e.g. "1 Construction of XYZ Hospital Client: ...")
  const byNumber = [...normalized.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Z][A-Za-z][\s\S]{20,}?)(?=\s+\d{1,3}\s+[A-Z][A-Za-z]|$)/g)];
  for (const m of byNumber) {
    const chunk = clean(`${m[1]} ${m[2]}`);
    if (chunk.length > 40) chunks.push(chunk);
  }
  if (chunks.length > 0) return chunks.slice(0, 200);

  // Titled rows (e.g. "Project Name: Construction of XYZ")
  const titledPattern = /(?:Project\s+Name|Assignment\s+Name|Name\s+of\s+Assignment)\s*[:\-]?\s*(.+?)(?=\s+(?:Client|Owner|Location|Country|Period|Services|Description|Project\s+Name|Assignment\s+Name|Name\s+of\s+Assignment)\b|$)/gi;
  for (const m of normalized.matchAll(titledPattern)) {
    const title = clean(m[1]);
    if (title.length >= 8) {
      const idx = normalized.indexOf(m[0]);
      const snippet = normalized.slice(idx, idx + 2500);
      chunks.push(snippet);
    }
  }
  return chunks.slice(0, 200);
}

function cleanProjectName(chunk: string): string {
  let name = chunk.replace(/^\d{1,3}\s+/, "");
  name = name.split(/\s+(?:Client|Owner|Location|Country|Constr\.?|Construction|Budget|Fee|Contract|Design|Consultancy|Ref|Period|Services|Description)\b/i)[0] ?? name;
  name = name.split(/\s+(?:Ethiopia|Ethiopian|Ministry|Federal|City|South|North|East|West)\b/i)[0] ?? name;
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

type ProjectDraft = {
  name: string; clientName: string | null; country: string | null; sector: string | null;
  serviceAreas: string[]; summary: string; contractValue: number | null; currency: string | null;
};

function parseProjects(text: string, expected?: number | null): ProjectDraft[] {
  const drafts: ProjectDraft[] = [];
  const seen = new Set<string>();

  for (const chunk of projectChunks(text)) {
    const name = cleanProjectName(chunk);
    if (!looksLikeProjectName(name)) continue;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const money = parseMoney(chunk);
    drafts.push({
      name,
      clientName: firstMatch(chunk, [
        /Client\s*[:\-]?\s*(.+?)(?:\s+(?:Location|Country|Construction|Constr\.|Budget|Fee|Contract|Design|Period)\b)/i,
        /Owner\s*[:\-]?\s*(.+?)(?:\s+(?:Location|Country|Construction|Constr\.|Budget|Fee|Contract|Design|Period)\b)/i,
      ]),
      country: inferCountry(chunk),
      sector: inferSectors(chunk)[0] ?? null,
      serviceAreas: inferServices(chunk),
      summary: `[AUTO-IMPORTED FROM DOCUMENT — REVIEW REQUIRED]\n${chunk.slice(0, 2500)}`,
      contractValue: money.value,
      currency: money.currency,
    });
    if (drafts.length >= (expected ?? 200)) break;
  }
  return drafts;
}

function expectedProjectCount(text: string): number | null {
  const m = text.match(/(\d{2,3})\s+(?:selected\s+)?projects?/i)?.[1];
  return m ? Number(m) : null;
}

function expectedExpertCount(text: string): number | null {
  const m = text.match(/(\d{1,2})\s+(?:experts?|cvs?|staff|personnel)/i)?.[1];
  return m ? Number(m) : null;
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function importCompanyKnowledgeFromDocuments(companyId: string) {
  // Load ALL documents that have extracted text, regardless of type or category.
  const docs = await prisma.companyDocument.findMany({
    where: { companyId, extractedText: { not: null } },
    select: { id: true, originalFileName: true, category: true, extractedText: true },
  });

  let allExpertDrafts: ExpertDraft[] = [];
  let allProjectDrafts: ProjectDraft[] = [];
  let targetExperts: number | null = null;
  let targetProjects: number | null = null;

  for (const doc of docs) {
    const text = doc.extractedText ?? "";

    // Skip only genuinely empty or failed extractions (< 100 chars or error sentinel).
    if (text.trim().length < 100) continue;
    if (/^\[(Scanned PDF|Extraction failed|Legacy \.doc|Image:)/i.test(text.trim())) continue;

    // Every document is a potential source of expert names and project names.
    // We attempt both parsers on every document and deduplicate across sources.
    const expTarget = expectedExpertCount(text);
    const projTarget = expectedProjectCount(text);
    if (expTarget) targetExperts = Math.max(targetExperts ?? 0, expTarget);
    if (projTarget) targetProjects = Math.max(targetProjects ?? 0, projTarget);

    const expertDrafts = parseExperts(text, expTarget);
    const projectDrafts = parseProjects(text, projTarget);

    allExpertDrafts.push(...expertDrafts);
    allProjectDrafts.push(...projectDrafts);
  }

  // Global deduplication by normalised key
  allExpertDrafts = [...new Map(allExpertDrafts.map((d) => [key(d.fullName), d])).values()]
    .slice(0, targetExperts ?? 120);
  allProjectDrafts = [...new Map(allProjectDrafts.map((d) => [key(d.name), d])).values()]
    .slice(0, targetProjects ?? 200);

  // Remove only previously auto-imported drafts — never touch manual records.
  if (allExpertDrafts.length > 0) {
    await prisma.expert.deleteMany({ where: { companyId, profile: { contains: "AUTO-IMPORTED FROM DOCUMENT" } } });
  }
  if (allProjectDrafts.length > 0) {
    await prisma.project.deleteMany({ where: { companyId, summary: { contains: "AUTO-IMPORTED FROM DOCUMENT" } } });
  }

  // Also clear old sentinel strings from previous importer versions
  await prisma.expert.deleteMany({ where: { companyId, profile: { contains: "AUTO-IMPORTED FROM CV PDF" } } });
  await prisma.project.deleteMany({ where: { companyId, summary: { contains: "AUTO-IMPORTED FROM PROJECT PDF" } } });

  const existingExperts = await prisma.expert.findMany({ where: { companyId }, select: { fullName: true } });
  const existingProjects = await prisma.project.findMany({ where: { companyId }, select: { name: true } });
  const expertKeys = new Set(existingExperts.map((e) => key(e.fullName)));
  const projectKeys = new Set(existingProjects.map((p) => key(p.name)));

  let expertsCreated = 0;
  let projectsCreated = 0;

  for (const expert of allExpertDrafts) {
    const k = key(expert.fullName);
    if (expertKeys.has(k)) continue;
    await prisma.expert.create({
      data: {
        companyId,
        fullName: expert.fullName,
        title: expert.title,
        yearsExperience: expert.yearsExperience,
        disciplines: JSON.stringify(expert.disciplines),
        sectors: JSON.stringify(expert.sectors),
        certifications: JSON.stringify(expert.certifications),
        profile: expert.profile,
      },
    });
    expertKeys.add(k);
    expertsCreated += 1;
  }

  for (const project of allProjectDrafts) {
    const k = key(project.name);
    if (projectKeys.has(k)) continue;
    await prisma.project.create({
      data: {
        companyId,
        name: project.name,
        clientName: project.clientName,
        country: project.country,
        sector: project.sector,
        serviceAreas: JSON.stringify(project.serviceAreas),
        summary: project.summary,
        contractValue: project.contractValue,
        currency: project.currency,
      },
    });
    projectKeys.add(k);
    projectsCreated += 1;
  }

  return {
    expertsCreated,
    projectsCreated,
    docsProcessed: docs.length,
    targetExperts,
    targetProjects,
  };
}
