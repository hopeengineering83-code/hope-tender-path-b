import type { PrismaClient } from "@prisma/client";

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: string): string {
  return clean(value).toLowerCase();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, 12);
}

function isExpertDoc(fileName: string, category: string): boolean {
  return /cv|expert|resume|curriculum|staff|personnel/i.test(`${fileName} ${category}`);
}

function isProjectDoc(fileName: string, category: string): boolean {
  return /project|portfolio|reference|contract|experience/i.test(`${fileName} ${category}`);
}

function inferServices(text: string): string[] {
  const s: string[] = [];
  if (/architect|architecture/i.test(text)) s.push("Architecture");
  if (/urban|master\s*plan|planning/i.test(text)) s.push("Urban Planning");
  if (/structural/i.test(text)) s.push("Structural Engineering");
  if (/civil\s+engineer|civil\s+engineering/i.test(text)) s.push("Civil Engineering");
  if (/geotechnical|soil|foundation/i.test(text)) s.push("Geotechnical Engineering");
  if (/electrical/i.test(text)) s.push("Electrical Engineering");
  if (/mechanical/i.test(text)) s.push("Mechanical Engineering");
  if (/sanitary|plumbing|water|drainage/i.test(text)) s.push("Sanitary / Water Engineering");
  if (/road|highway|transport|traffic/i.test(text)) s.push("Roads and Transport");
  if (/project\s+management|construction\s+supervision|contract\s+administration/i.test(text)) s.push("Project Management / Supervision");
  if (/quantity\s+survey|cost\s+estimat/i.test(text)) s.push("Quantity Surveying");
  if (/environment/i.test(text)) s.push("Environmental Engineering");
  return uniq(s);
}

function inferSectors(text: string): string[] {
  const s: string[] = [];
  if (/hospital|health|clinic/i.test(text)) s.push("Healthcare");
  if (/school|university|education/i.test(text)) s.push("Education");
  if (/government|ministry|municipal|city|public/i.test(text)) s.push("Government / Public Sector");
  if (/hotel|tourism|resort|lodge/i.test(text)) s.push("Hospitality and Tourism");
  if (/residential|apartment|housing/i.test(text)) s.push("Residential");
  if (/commercial|office|mixed\s*use/i.test(text)) s.push("Commercial");
  if (/road|infrastructure|bridge/i.test(text)) s.push("Infrastructure");
  if (/industrial|factory|warehouse/i.test(text)) s.push("Industrial");
  return uniq(s);
}

function parseYears(text: string): number | null {
  const matches = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs|year)\s+(?:of\s+)?(?:professional\s+)?experience/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n < 70);
  if (matches.length > 0) return Math.max(...matches);
  const loose = text.match(/experience[^\d]{0,30}(\d{1,2})/i)?.[1];
  const n = loose ? Number(loose) : null;
  return n && n > 0 && n < 70 ? n : null;
}

function parseTitle(text: string): string | null {
  const patterns = [
    /(?:Proposed\s+Position|Position|Title|Profession)\s*[:\-]?\s*([^\n\r:]{3,120})/i,
    /\b(Architect|Urban Planner|Civil Engineer|Structural Engineer|Electrical Engineer|Mechanical Engineer|Sanitary Engineer|Project Manager|Team Leader|Quantity Surveyor|Surveyor|Geotechnical Engineer)\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return clean(m[1]).replace(/\s+(Name|Date|Nationality|Education).*$/i, "").slice(0, 120);
  }
  return null;
}

function normalizeName(value: string): string {
  return clean(value)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Prof\.?)\s+/i, "")
    .replace(/[,;].*$/, "")
    .replace(/\s+(Nationality|Country|Date|Birth|Education|Position|Profession|Experience|Phone|Email).*$/i, "")
    .trim()
    .slice(0, 90);
}

// Job-level qualifiers that appear in positions but never in personal names
const POSITION_QUALIFIER_WORDS = new Set([
  "senior", "junior", "principal", "chief", "lead", "head", "associate",
  "assistant", "deputy", "registered", "certified", "licensed", "funded",
  "appointed", "proposed", "designated",
]);

// Geographic, organizational, and infrastructure words that are not name components
const NON_NAME_WORDS = new Set([
  // Organizational
  "bank", "world", "funded", "corporation", "ministry", "authority", "agency",
  "institute", "institution", "association", "foundation", "group", "company",
  "limited", "international", "national", "federal", "regional", "municipal",
  "university", "college", "hospital", "consulting", "consultant", "services",
  "development", "bureau", "office", "department",
  // Geographic directions / generic area words
  "south", "north", "east", "west", "central", "upper", "lower",
  "city", "county", "district", "zone", "region", "province", "state",
  // Ethiopian regions / zones most likely to appear in CV project lists
  "amhara", "oromia", "oromiya", "tigray", "afar", "somali", "gambella",
  "benishangul", "harari", "sidama", "wollo", "shewa", "gojjam", "gondar",
  "gimba", "jimma", "harar", "adama", "dire", "awash", "omo", "kafa",
  "wolega", "arsi", "bale", "borena", "guji",
  // Infrastructure / project-type words
  "water", "supply", "road", "bridge", "dam", "power", "energy", "solar",
  "housing", "construction", "building", "project", "scheme", "phase",
  "industrial", "commercial", "residential", "mixed", "urban", "rural",
  // Architecture / engineering discipline words
  "architecture", "engineering", "design", "planning", "survey", "management",
]);

function looksLikePersonName(name: string): boolean {
  if (!name || name.length < 5 || name.length > 90) return false;
  if (/hope|urban|planning|company|consultancy|curriculum|vitae|expert|staff|summary|project|client|hospital|document|page|table|ethiopia/i.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) return false;
  // Reject if the last word is a job-level qualifier (positions get appended to fragments)
  const lastWord = words[words.length - 1].toLowerCase();
  if (POSITION_QUALIFIER_WORDS.has(lastWord)) return false;
  // Reject if any word is a known geographic, organizational, or infrastructure term
  if (words.some((w) => NON_NAME_WORDS.has(w.toLowerCase()))) return false;
  return true;
}

function snippetAround(text: string, needle: string, radius = 900): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return clean(text.slice(0, radius));
  return clean(text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + radius)));
}

function extractExpertNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    // Structured name fields — allow up to 5 words (reliable source)
    /(?:Full\s+Name|Name\s+of\s+(?:Expert|Key\s+Staff|Personnel|Staff)|Expert\s+Name|Name)\s*[:\-]?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/gi,
    // Titled names (Mr/Dr/Eng prefix) — allow up to 5 words
    /(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Prof\.?)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/g,
    // Name before job title — max 3 words to reduce project-description false positives
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+(?:Architect|Urban Planner|Civil Engineer|Structural Engineer|Electrical Engineer|Mechanical Engineer|Sanitary Engineer|Project Manager|Team Leader|Quantity Surveyor|Surveyor|Geotechnical Engineer)\b/g,
    // Start-of-line capitalized name before job title — max 3 words
    /(?:^|\n|\r|\s\d{1,2}[.)]?\s+)([A-Z][a-z][A-Za-z.'-]+(?:\s+[A-Z][a-z][A-Za-z.'-]+){1,2})(?=\s+(?:Architect|Engineer|Planner|Manager|Surveyor|Specialist|Expert|Team Leader)\b)/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const name = normalizeName(m[1]);
      if (looksLikePersonName(name)) names.add(name);
    }
  }
  return [...names].slice(0, 150);
}

function projectNameLooksValid(name: string): boolean {
  if (name.length < 8 || name.length > 180) return false;
  if (/^(project|client|name|description|scope|services)$/i.test(name)) return false;
  return /[A-Za-z]/.test(name);
}

function extractProjectNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:Project\s+Name|Assignment\s+Name|Name\s+of\s+Assignment|Contract\s+Title)\s*[:\-]?\s*([^\n\r]{8,180})/gi,
    /(?:^|\n|\r)\s*\d{1,3}[.)]?\s+([A-Z][^\n\r]{8,170})(?=\s*(?:Client|Owner|Location|Country|Scope|Services|Contract|Budget|Period|Year|$))/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const raw = clean(m[1]).replace(/\s+(Client|Owner|Location|Country|Scope|Services|Contract|Budget|Period|Year).*$/i, "").slice(0, 180);
      if (projectNameLooksValid(raw)) names.add(raw);
    }
  }
  return [...names].slice(0, 250);
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return clean(m[1]).slice(0, 160);
  }
  return null;
}

export type SafetyImportResult = {
  docsScanned: number;
  expertsCreated: number;
  projectsCreated: number;
  expertNamesDetected: number;
  projectNamesDetected: number;
};

export async function runCompanyKnowledgeSafetyImport(client: PrismaClient, companyId: string): Promise<SafetyImportResult> {
  const docs = await client.companyDocument.findMany({
    where: { companyId, extractedText: { not: null } },
    select: { id: true, originalFileName: true, category: true, extractedText: true },
  });

  const existingExperts = await client.expert.findMany({ where: { companyId }, select: { fullName: true } });
  const existingProjects = await client.project.findMany({ where: { companyId }, select: { name: true } });
  const expertKeys = new Set(existingExperts.map((e) => key(e.fullName)));
  const projectKeys = new Set(existingProjects.map((p) => key(p.name)));

  let expertsCreated = 0;
  let projectsCreated = 0;
  let expertNamesDetected = 0;
  let projectNamesDetected = 0;

  for (const doc of docs) {
    const text = doc.extractedText ?? "";
    if (text.trim().length < 100) continue;
    if (/^\[(Scanned PDF|Extraction failed)/i.test(text.trim())) continue;

    const expertDoc = isExpertDoc(doc.originalFileName, doc.category);
    const projectDoc = isProjectDoc(doc.originalFileName, doc.category);

    if (expertDoc || (!expertDoc && !projectDoc)) {
      const names = extractExpertNames(text);
      expertNamesDetected += names.length;
      for (const fullName of names) {
        const k = key(fullName);
        if (expertKeys.has(k)) continue;
        const snippet = snippetAround(text, fullName);
        await client.expert.create({
          data: {
            companyId,
            fullName,
            title: parseTitle(snippet),
            yearsExperience: parseYears(snippet),
            disciplines: JSON.stringify(inferServices(snippet)),
            sectors: JSON.stringify(inferSectors(snippet)),
            certifications: JSON.stringify([]),
            profile: `[REGEX_DRAFT — REVIEW REQUIRED before use in proposals]\n\nDeterministic safety import from ${doc.originalFileName}.\n\nSource snippet:\n${snippet}`,
            trustLevel: "REGEX_DRAFT",
            sourceDocumentId: doc.id,
          },
        });
        expertKeys.add(k);
        expertsCreated++;
      }
    }

    if (projectDoc || (!expertDoc && !projectDoc)) {
      const names = extractProjectNames(text);
      projectNamesDetected += names.length;
      for (const name of names) {
        const k = key(name);
        if (projectKeys.has(k)) continue;
        const snippet = snippetAround(text, name);
        await client.project.create({
          data: {
            companyId,
            name,
            clientName: firstMatch(snippet, [/Client\s*[:\-]?\s*([^\n\r]{3,160})/i, /Owner\s*[:\-]?\s*([^\n\r]{3,160})/i]),
            country: firstMatch(snippet, [/Country\s*[:\-]?\s*([^\n\r]{3,80})/i, /Location\s*[:\-]?\s*([^\n\r]{3,120})/i]),
            sector: inferSectors(snippet)[0] ?? null,
            serviceAreas: JSON.stringify(inferServices(snippet)),
            summary: `[REGEX_DRAFT — REVIEW REQUIRED before use in proposals]\n\nDeterministic safety import from ${doc.originalFileName}.\n\nSource snippet:\n${snippet}`,
            trustLevel: "REGEX_DRAFT",
            sourceDocumentId: doc.id,
          },
        });
        projectKeys.add(k);
        projectsCreated++;
      }
    }
  }

  return { docsScanned: docs.length, expertsCreated, projectsCreated, expertNamesDetected, projectNamesDetected };
}
