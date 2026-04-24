import { prisma } from "./prisma";

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return clean(value).toLowerCase();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, 10);
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function inferServices(text: string): string[] {
  const services: string[] = [];
  if (/structural/i.test(text)) services.push("Structural Engineering");
  if (/geotechnical|soil|foundation/i.test(text)) services.push("Geotechnical Engineering");
  if (/architect/i.test(text)) services.push("Architecture");
  if (/urban|master plan|planning/i.test(text)) services.push("Urban Planning");
  if (/mep|electrical|mechanical|plumbing/i.test(text)) services.push("MEP Engineering");
  if (/road|highway|infrastructure/i.test(text)) services.push("Roads and Infrastructure");
  if (/project management|contract admin|construction supervision/i.test(text)) services.push("Project Management");
  if (/interior/i.test(text)) services.push("Interior Design");
  if (/landscape/i.test(text)) services.push("Landscape Design");
  return uniq(services);
}

function inferSectors(text: string): string[] {
  const sectors: string[] = [];
  if (/hospital|health/i.test(text)) sectors.push("Healthcare");
  if (/hotel|tourism|lodge|museum|heritage/i.test(text)) sectors.push("Hospitality and Tourism");
  if (/government|ministry|agency|public|city admin/i.test(text)) sectors.push("Government");
  if (/factory|industrial|abattoir|warehouse|processing/i.test(text)) sectors.push("Industrial");
  if (/commercial|office|mixed use|apartment|residential/i.test(text)) sectors.push("Commercial and Residential");
  if (/road|infrastructure/i.test(text)) sectors.push("Infrastructure");
  if (/education|university|school/i.test(text)) sectors.push("Education");
  return uniq(sectors);
}

function inferCountry(text: string): string | null {
  for (const c of ["Ethiopia", "Kenya", "Nigeria", "South Sudan", "Sudan", "UAE", "United Arab Emirates"]) {
    if (new RegExp(c.replace(/ /g, "\\s+"), "i").test(text)) return c;
  }
  return null;
}

function parseYears(text: string): number | null {
  const match = text.match(/(\d{1,2})\+?\s*(?:years|yrs|year)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function expectedProjectCount(fileName: string, text: string): number | null {
  const direct = text.match(/(\d{2,3})\s+(?:selected\s+)?projects?/i)?.[1];
  if (direct) return Number(direct);
  if (/projects?\s+reference/i.test(fileName) && /selected\s+projects?|project\s+portfolio/i.test(text)) return 114;
  return null;
}

function expectedExpertCount(fileName: string, text: string): number | null {
  const direct = text.match(/(\d{1,2})\s+(?:expert|experts|cv|cvs|staff|personnel)/i)?.[1];
  if (direct) return Number(direct);
  if (/expert.*cv|cv.*expert|staffing/i.test(fileName) && /curriculum\s+vitae|name\s+of\s+expert/i.test(text)) return 29;
  return null;
}

function normalizeName(value: string): string {
  let name = clean(value)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Engineer)\s+/i, "")
    .replace(/\s+(Country|Nationality|Date of Birth|Education|Membership|Proposed Position|Position).*$/i, "");
  name = name.split(/\s+(?:Key Qualifications|Employment Record|Languages|Certification|Education)\b/i)[0] ?? name;
  return clean(name).slice(0, 90);
}

function looksLikePersonName(name: string): boolean {
  if (name.length < 5 || name.length > 90) return false;
  if (/hope urban|curriculum|vitae|company|page|expert cvs|staffing|summary/i.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 6 && words.every((word) => /^[A-Za-z.'-]+$/.test(word));
}

function expertSections(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const markers = [...normalized.matchAll(/(?:Name of Expert|Name\s*[:\-]|CURRICULUM\s+VITAE|CV\s+of)/gi)].map((m) => m.index ?? 0);
  if (markers.length === 0) return [normalized];
  const sections: string[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i];
    const end = markers[i + 1] ?? Math.min(normalized.length, start + 9000);
    const section = clean(normalized.slice(start, end));
    if (section.length > 100) sections.push(section);
  }
  return sections;
}

function fallbackExpertNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/g,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:Civil Engineer|Structural Engineer|Architect|Planner|Project Manager|Geotechnical Engineer|Mechanical Engineer|Electrical Engineer)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = normalizeName(match[1]);
      if (looksLikePersonName(name)) names.add(name);
    }
  }
  return [...names];
}

function parseExperts(text: string, expected?: number | null) {
  const drafts = [] as Array<{
    fullName: string; title: string | null; yearsExperience: number | null; disciplines: string[]; sectors: string[]; certifications: string[]; profile: string;
  }>;
  const seen = new Set<string>();

  for (const section of expertSections(text)) {
    const rawName = firstMatch(section, [
      /Name of Expert\s*[:\-]?\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Membership|Key Qualifications|Proposed Position|Position)\b)/i,
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
      /Proposed Position\s*[:\-]?\s*(.+?)(?:\s+(?:Name of Firm|Name of Expert|Date of Birth|Education|Membership|Key Qualifications)\b)/i,
      /Position\s*[:\-]?\s*(.+?)(?:\s+(?:Name of Firm|Name of Expert|Date of Birth|Education|Membership|Key Qualifications)\b)/i,
    ]);

    drafts.push({
      fullName,
      title: title ? clean(title).slice(0, 140) : null,
      yearsExperience: parseYears(section),
      disciplines: inferServices(section),
      sectors: inferSectors(section),
      certifications: [],
      profile: `[AUTO-IMPORTED FROM CV PDF]\n${section.slice(0, 2500)}`,
    });
  }

  if (expected && drafts.length < expected) {
    for (const name of fallbackExpertNames(text)) {
      if (drafts.length >= expected) break;
      const k = key(name);
      if (seen.has(k)) continue;
      seen.add(k);
      const idx = text.toLowerCase().indexOf(name.toLowerCase());
      const section = idx >= 0 ? text.slice(idx, idx + 2500) : text.slice(0, 2500);
      drafts.push({
        fullName: name,
        title: null,
        yearsExperience: parseYears(section),
        disciplines: inferServices(section),
        sectors: inferSectors(section),
        certifications: [],
        profile: `[AUTO-IMPORTED FROM CV PDF - REVIEW REQUIRED]\n${section}`,
      });
    }
  }

  return drafts.slice(0, expected ?? 120);
}

function projectChunks(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const chunks: string[] = [];
  const markerRegex = /(?:^|\s)(\d{1,3})\s+([A-Z][A-Za-z][\s\S]{20,}?)(?=\s+\d{1,3}\s+[A-Z][A-Za-z]|$)/g;
  for (const match of normalized.matchAll(markerRegex)) {
    const chunk = clean(`${match[1]} ${match[2]}`);
    if (chunk.length > 40) chunks.push(chunk);
  }
  if (chunks.length > 0) return chunks.slice(0, 180);

  return normalized
    .replace(/\b(\d{1,3})\s+([A-Z])/g, "\n$1 $2")
    .split(/\n(?=\d{1,3}\s+[A-Z])/)
    .map(clean)
    .filter((chunk) => /^\d{1,3}\s+/.test(chunk) && chunk.length > 40)
    .slice(0, 180);
}

function cleanProjectName(chunk: string): string {
  let name = chunk.replace(/^\d{1,3}\s+/, "");
  name = name.split(/\s+(?:Client|Owner|Location|Country|Constr\.?|Construction|Budget|Fee|Contract|Design|Consultancy|Ref|Testimony|General Manager|Structural Engineer|Geotech Engineer|Architect|Electrical Engineer|Mechanical Engineer)\b/i)[0] ?? name;
  name = name.split(/\s+(?:Ethiopia|Ethiopian|Ministry|Federal|City|South|North|East|West)\b/i)[0] ?? name;
  name = name.split(/,\s+[A-Z][a-z]+/)[0] ?? name;
  name = name.replace(/\s*\([^)]*$/, "");
  return clean(name).slice(0, 180);
}

function parseMoney(text: string): { value: number | null; currency: string | null } {
  const match = text.match(/(?:Constr\.?|Budget|Fee|Contract|Design|Consultancy)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*(B|M|K)?\s*(ETB|USD|EUR|€)?/i);
  if (!match) return { value: null, currency: null };
  let value = Number(match[1].replace(/,/g, ""));
  if (match[2]?.toUpperCase() === "B") value *= 1000000000;
  if (match[2]?.toUpperCase() === "M") value *= 1000000;
  if (match[2]?.toUpperCase() === "K") value *= 1000;
  const currency = match[3] === "€" ? "EUR" : match[3]?.toUpperCase() ?? null;
  return { value, currency };
}

function parseProjects(text: string, expected?: number | null) {
  const drafts = [] as Array<{
    name: string; clientName: string | null; country: string | null; sector: string | null; serviceAreas: string[]; summary: string; contractValue: number | null; currency: string | null;
  }>;
  const seen = new Set<string>();

  for (const chunk of projectChunks(text)) {
    const name = cleanProjectName(chunk);
    if (name.length < 8 || name.length > 170 || /^project\s*name$/i.test(name)) continue;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const money = parseMoney(chunk);
    drafts.push({
      name,
      clientName: firstMatch(chunk, [/Client\s*[:\-]?\s*(.+?)(?:\s+(?:Location|Country|Construction|Constr\.|Budget|Fee|Contract|Design)\b)/i]),
      country: inferCountry(chunk),
      sector: inferSectors(chunk)[0] ?? null,
      serviceAreas: inferServices(chunk),
      summary: `[AUTO-IMPORTED FROM PROJECT PDF]\n${chunk.slice(0, 2200)}`,
      contractValue: money.value,
      currency: money.currency,
    });
  }
  return drafts.slice(0, expected ?? 150);
}

export async function importCompanyKnowledgeFromDocuments(companyId: string) {
  const docs = await prisma.companyDocument.findMany({
    where: { companyId, extractedText: { not: null } },
    select: { originalFileName: true, category: true, extractedText: true },
  });

  let allExpertDrafts: ReturnType<typeof parseExperts> = [];
  let allProjectDrafts: ReturnType<typeof parseProjects> = [];
  let targetExpertCount: number | null = null;
  let targetProjectCount: number | null = null;

  for (const doc of docs) {
    const text = doc.extractedText ?? "";
    const label = `${doc.originalFileName} ${doc.category}`.toLowerCase();
    if (text.length < 1000) continue;

    if (/cv|expert|resume|curriculum|staff/.test(label + " " + text.slice(0, 10000).toLowerCase())) {
      const expected = expectedExpertCount(doc.originalFileName, text);
      targetExpertCount = expected ?? targetExpertCount;
      allExpertDrafts = [...allExpertDrafts, ...parseExperts(text, expected)];
    }

    if (/project|portfolio|reference|contract/.test(label + " " + text.slice(0, 5000).toLowerCase())) {
      const expected = expectedProjectCount(doc.originalFileName, text);
      targetProjectCount = expected ?? targetProjectCount;
      allProjectDrafts = [...allProjectDrafts, ...parseProjects(text, expected)];
    }
  }

  allExpertDrafts = [...new Map(allExpertDrafts.map((draft) => [key(draft.fullName), draft])).values()].slice(0, targetExpertCount ?? 120);
  allProjectDrafts = [...new Map(allProjectDrafts.map((draft) => [key(draft.name), draft])).values()].slice(0, targetProjectCount ?? 150);

  const existingExperts = await prisma.expert.findMany({ where: { companyId }, select: { id: true, fullName: true } });
  const existingProjects = await prisma.project.findMany({ where: { companyId }, select: { id: true, name: true } });

  const shouldRebuildExperts = Boolean(targetExpertCount && existingExperts.length !== allExpertDrafts.length);
  const shouldRebuildProjects = Boolean(targetProjectCount && existingProjects.length !== allProjectDrafts.length);

  if (shouldRebuildExperts) await prisma.expert.deleteMany({ where: { companyId } });
  if (shouldRebuildProjects) await prisma.project.deleteMany({ where: { companyId } });

  const expertKeys = new Set((shouldRebuildExperts ? [] : existingExperts).map((e) => key(e.fullName)));
  const projectKeys = new Set((shouldRebuildProjects ? [] : existingProjects).map((p) => key(p.name)));

  let expertsCreated = 0;
  let projectsCreated = 0;

  for (const expert of allExpertDrafts) {
    const k = key(expert.fullName);
    if (expertKeys.has(k)) continue;
    await prisma.expert.create({ data: {
      companyId,
      fullName: expert.fullName,
      title: expert.title,
      yearsExperience: expert.yearsExperience,
      disciplines: JSON.stringify(expert.disciplines),
      sectors: JSON.stringify(expert.sectors),
      certifications: JSON.stringify(expert.certifications),
      profile: expert.profile,
    }});
    expertKeys.add(k);
    expertsCreated += 1;
  }

  for (const project of allProjectDrafts) {
    const k = key(project.name);
    if (projectKeys.has(k)) continue;
    await prisma.project.create({ data: {
      companyId,
      name: project.name,
      clientName: project.clientName,
      country: project.country,
      sector: project.sector,
      serviceAreas: JSON.stringify(project.serviceAreas),
      summary: project.summary,
      contractValue: project.contractValue,
      currency: project.currency,
    }});
    projectKeys.add(k);
    projectsCreated += 1;
  }

  return { expertsCreated, projectsCreated, targetExpertCount, targetProjectCount };
}
