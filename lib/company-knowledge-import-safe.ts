/**
 * Company knowledge importer — three-tier trust model:
 *
 *   REGEX_DRAFT  — pattern-extracted, lowest trust (fallback when AI unavailable)
 *   AI_DRAFT     — Claude-extracted, medium trust (structured but unreviewed)
 *   REVIEWED     — human-verified, full trust (used authoritatively in proposals)
 *
 * Records are NEVER promoted to REVIEWED automatically. A human must review
 * them in the Knowledge Review dashboard before they can be used in generation.
 */

import { prisma } from "./prisma";
import { isAIEnabled } from "./ai";
import { extractCompanyKnowledgeWithAI } from "./company-knowledge-ai";

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

// ─── domain inference (regex fallback) ───────────────────────────────────────

function inferServices(text: string): string[] {
  const s: string[] = [];
  if (/structural/i.test(text)) s.push("Structural Engineering");
  if (/geotechnical|soil|foundation/i.test(text)) s.push("Geotechnical Engineering");
  if (/architect/i.test(text)) s.push("Architecture");
  if (/urban|master\s*plan|planning/i.test(text)) s.push("Urban Planning");
  if (/mep|electrical|mechanical|plumbing/i.test(text)) s.push("MEP Engineering");
  if (/road|highway|infrastructure/i.test(text)) s.push("Roads and Infrastructure");
  if (/project\s*management|construction\s*supervision/i.test(text)) s.push("Project Management");
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
  if (/hotel|tourism|lodge|museum/i.test(text)) s.push("Hospitality and Tourism");
  if (/government|ministry|agency|public/i.test(text)) s.push("Government");
  if (/factory|industrial|abattoir|warehouse/i.test(text)) s.push("Industrial");
  if (/commercial|office|mixed\s*use|residential/i.test(text)) s.push("Commercial and Residential");
  if (/road|infrastructure/i.test(text)) s.push("Infrastructure");
  if (/education|university|school/i.test(text)) s.push("Education");
  if (/energy|power|solar/i.test(text)) s.push("Energy");
  return uniq(s);
}

function inferCountry(text: string): string | null {
  const countries = ["Ethiopia","Kenya","Nigeria","South Sudan","Sudan","Rwanda","Uganda","Tanzania","UAE","United Arab Emirates","Saudi Arabia","Qatar","Egypt","Ghana","South Africa"];
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
  const m = text.match(/(?:Budget|Fee|Contract|Value)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*(B|M|K)?\s*(ETB|USD|EUR|GBP|AED|SAR|€)?/i);
  if (!m) return { value: null, currency: null };
  let value = Number(m[1].replace(/,/g, ""));
  if (m[2]?.toUpperCase() === "B") value *= 1_000_000_000;
  if (m[2]?.toUpperCase() === "M") value *= 1_000_000;
  if (m[2]?.toUpperCase() === "K") value *= 1_000;
  const currency = m[3] === "€" ? "EUR" : m[3]?.toUpperCase() ?? null;
  return { value, currency };
}

// ─── regex expert extraction (fallback) ──────────────────────────────────────

function normalizeName(v: string): string {
  return clean(v)
    .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?|Prof\.?)\s+/i, "")
    .replace(/\s+(Country|Nationality|Date of Birth|Education|Proposed Position|Position).*$/i, "")
    .slice(0, 90);
}

// Words that appear in job titles/positions but never in a person's name
const POSITION_QUALIFIER_WORDS = new Set([
  "senior", "junior", "principal", "chief", "lead", "head", "associate",
  "assistant", "deputy", "registered", "certified", "licensed", "funded",
  "appointed", "proposed", "designated",
]);

// Organizational, geographic, or institutional words that are not personal name components
const NON_NAME_WORDS = new Set([
  "bank", "world", "funded", "architecture", "corporation", "ministry",
  "authority", "agency", "institute", "institution", "association",
  "foundation", "group", "company", "limited", "international", "national",
  "federal", "regional", "municipal", "urban", "rural", "south", "north",
  "east", "west", "central", "city", "county", "district", "zone",
  "university", "college", "hospital", "project", "construction",
  "engineering", "consulting", "consultant", "services", "development",
]);

function looksLikePersonName(name: string): boolean {
  if (name.length < 5 || name.length > 90) return false;
  if (/hope urban|curriculum|vitae|company|page|staffing|project|client|hospital/i.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  if (!words.every((w) => /^[A-Za-z.'-]+$/.test(w))) return false;
  // Reject if last word is a job-level qualifier (context fragments append positions)
  const lastWord = words[words.length - 1].toLowerCase();
  if (POSITION_QUALIFIER_WORDS.has(lastWord)) return false;
  // Reject if any word is a known geographic, organizational, or institutional term
  if (words.some((w) => NON_NAME_WORDS.has(w.toLowerCase()))) return false;
  return true;
}

function expertSections(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const markers = [...normalized.matchAll(/(?:Name\s+of\s+(?:Expert|Key\s+Staff|Personnel)|CURRICULUM\s+VITAE|CV\s+of\b)/gim)].map((m) => m.index ?? 0);
  if (markers.length === 0) return [normalized];
  const sections: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i];
    const end = markers[i + 1] ?? Math.min(normalized.length, start + 12_000);
    const section = clean(normalized.slice(start, end));
    if (section.length > 100) sections.push(section);
  }
  return sections;
}

function fallbackExpertNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Eng\.?)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})/g,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:Civil Engineer|Structural Engineer|Architect|Urban Planner|Project Manager)/g,
  ];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const name = normalizeName(m[1]);
      if (looksLikePersonName(name)) names.add(name);
    }
  }
  return [...names];
}

type RegexExpert = { fullName: string; title: string | null; yearsExperience: number | null; disciplines: string[]; sectors: string[]; certifications: string[]; profile: string; sourceSnippet: string };

function regexExtractExperts(text: string): RegexExpert[] {
  const drafts: RegexExpert[] = [];
  const seen = new Set<string>();

  for (const section of expertSections(text)) {
    const rawName = firstMatch(section, [
      /Name\s+of\s+(?:Expert|Key\s+Staff|Personnel)\s*[:\-]?\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Proposed Position|Position)\b)/i,
      /Name\s*[:\-]\s*(.+?)(?:\s+(?:Country|Nationality|Date of Birth|Education|Proposed Position|Position)\b)/i,
      /CURRICULUM\s+VITAE\s+(.+?)(?:\s+(?:Position|Education)\b)/i,
      /CV\s+of\s+(.+?)(?:\s+(?:Position|Education)\b)/i,
    ]);
    if (!rawName) continue;
    const fullName = normalizeName(rawName);
    if (!looksLikePersonName(fullName)) continue;
    const k = key(fullName);
    if (seen.has(k)) continue;
    seen.add(k);
    const title = firstMatch(section, [/Proposed\s+Position\s*[:\-]?\s*(.+?)(?:\s+(?:Name of Firm|Date of Birth|Education|Key Qualifications)\b)/i, /Position\s*[:\-]?\s*(.+?)(?:\s+(?:Date of Birth|Education|Key Qualifications)\b)/i]);
    drafts.push({ fullName, title: title ? clean(title).slice(0, 140) : null, yearsExperience: parseYears(section), disciplines: inferServices(section), sectors: inferSectors(section), certifications: [], profile: `Regex-extracted CV record from ${new Date().toISOString().slice(0, 10)}.`, sourceSnippet: section.slice(0, 500) });
  }

  for (const name of fallbackExpertNames(text)) {
    if (drafts.length >= 120) break;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const idx = text.toLowerCase().indexOf(name.toLowerCase());
    const snippet = idx >= 0 ? text.slice(idx, idx + 500) : text.slice(0, 500);
    drafts.push({ fullName: name, title: null, yearsExperience: parseYears(snippet), disciplines: inferServices(snippet), sectors: inferSectors(snippet), certifications: [], profile: `Fallback regex-extracted from ${new Date().toISOString().slice(0, 10)}.`, sourceSnippet: snippet });
  }
  return drafts;
}

// ─── regex project extraction (fallback) ─────────────────────────────────────

type RegexProject = { name: string; clientName: string | null; country: string | null; sector: string | null; serviceAreas: string[]; summary: string; contractValue: number | null; currency: string | null; sourceSnippet: string };

function projectChunks(text: string): string[] {
  const normalized = text.replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
  const byNumber = [...normalized.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Z][A-Za-z][\s\S]{20,}?)(?=\s+\d{1,3}\s+[A-Z][A-Za-z]|$)/g)];
  if (byNumber.length > 0) return byNumber.map((m) => clean(`${m[1]} ${m[2]}`).slice(0, 2500)).filter((c) => c.length > 40).slice(0, 200);
  const titled: string[] = [];
  for (const m of normalized.matchAll(/(?:Project\s+Name|Assignment\s+Name)\s*[:\-]?\s*(.+?)(?=\s+(?:Client|Location|Period|Services|Project\s+Name|Assignment\s+Name)\b|$)/gi)) {
    const title = clean(m[1]);
    if (title.length >= 8) { const idx = normalized.indexOf(m[0]); titled.push(normalized.slice(idx, idx + 2500)); }
  }
  return titled.slice(0, 200);
}

function regexExtractProjects(text: string): RegexProject[] {
  const drafts: RegexProject[] = [];
  const seen = new Set<string>();
  for (const chunk of projectChunks(text)) {
    let name = chunk.replace(/^\d{1,3}\s+/, "");
    name = name.split(/\s+(?:Client|Owner|Location|Country|Construction|Budget|Fee|Contract|Period)\b/i)[0] ?? name;
    name = clean(name).slice(0, 180);
    if (name.length < 8 || /^(project|name|client)$/i.test(name)) continue;
    const k = key(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const money = parseMoney(chunk);
    drafts.push({ name, clientName: firstMatch(chunk, [/Client\s*[:\-]?\s*(.+?)(?:\s+(?:Location|Country|Budget|Fee|Period)\b)/i]), country: inferCountry(chunk), sector: inferSectors(chunk)[0] ?? null, serviceAreas: inferServices(chunk), summary: `Regex-extracted project from ${new Date().toISOString().slice(0, 10)}.`, contractValue: money.value, currency: money.currency, sourceSnippet: chunk.slice(0, 500) });
    if (drafts.length >= 200) break;
  }
  return drafts;
}

// ─── main export ──────────────────────────────────────────────────────────────

export type ImportResult = {
  docsProcessed: number;
  expertsCreated: number;
  projectsCreated: number;
  aiUsed: boolean;
  aiFailures: number;
};

export async function importCompanyKnowledgeFromDocuments(companyId: string): Promise<ImportResult> {
  const docs = await prisma.companyDocument.findMany({
    where: { companyId, extractedText: { not: null } },
    select: { id: true, originalFileName: true, category: true, extractedText: true, aiExtractionStatus: true },
  });

  const useAI = isAIEnabled();
  let aiFailures = 0;

  // Collect all drafts, tagged with source doc ID and trust level
  type ExpertDraft = RegexExpert & { sourceDocumentId: string; trustLevel: string };
  type ProjectDraft = RegexProject & { sourceDocumentId: string; trustLevel: string };

  const allExpertDrafts: ExpertDraft[] = [];
  const allProjectDrafts: ProjectDraft[] = [];

  // ── Classify documents by category for strict type separation ────────────
  // CV/staff docs → expertText only; project/portfolio docs → projectText only.
  // This prevents the AI from extracting project names as expert names or vice versa.

  type DocRecord = typeof docs[number];

  function isExpertDoc(doc: DocRecord): boolean {
    const label = `${doc.originalFileName} ${doc.category}`.toLowerCase();
    return /cv|expert|resume|curriculum|staff|personnel/.test(label);
  }

  function isProjectDoc(doc: DocRecord): boolean {
    const label = `${doc.originalFileName} ${doc.category}`.toLowerCase();
    return /project|portfolio|reference|contract/.test(label);
  }

  if (useAI) {
    // ── AI path: batch by category, category-enforced extraction ─────────────
    // Separate doc lists by type so each is only sent to the correct AI prompt.
    const expertDocs = docs.filter((d) => {
      const text = d.extractedText ?? "";
      return text.trim().length >= 100 && isExpertDoc(d) && !/^\[(Scanned PDF|Extraction failed)/i.test(text.trim());
    });
    const projectDocs = docs.filter((d) => {
      const text = d.extractedText ?? "";
      return text.trim().length >= 100 && isProjectDoc(d) && !/^\[(Scanned PDF|Extraction failed)/i.test(text.trim());
    });
    // Mixed docs (match both or neither) go through regex fallback only
    try {
      // Build combined text pools per category (truncated per doc to avoid token overrun).
      // Project text includes ALL extractable docs because CV documents also contain project
      // experience sections — restricting to only project-classified files would miss them entirely.
      const expertTextPool = expertDocs.map((d) => (d.extractedText ?? "").slice(0, 20_000)).join("\n\n--- NEXT DOCUMENT ---\n\n");
      const allExtractableDocs = docs.filter((d) => {
        const text = d.extractedText ?? "";
        return text.trim().length >= 100 && !/^\[(Scanned PDF|Extraction failed)/i.test(text.trim());
      });
      // Project sections are spread throughout large CV documents — use 100K per doc so
      // Gemini sees experience sections that lie past the first 20K chars.
      const projectTextPool = allExtractableDocs.map((d) => (d.extractedText ?? "").slice(0, 100_000)).join("\n\n--- NEXT DOCUMENT ---\n\n");

      const aiResult = await extractCompanyKnowledgeWithAI({
        expertText: expertTextPool,
        projectText: projectTextPool,
      });

      // ── Post-extraction category enforcement ────────────────────────────────
      // Requirement 6: Experts and projects cannot be mixed.
      // Even though the AI prompt is category-scoped, Claude occasionally extracts
      // cross-category records (e.g. a project entry from a CV document).
      // We drop them here and log a warning rather than silently corrupting the DB.
      const droppedExperts: string[] = [];
      const droppedProjects: string[] = [];

      // Map extracted experts back to the source document they most likely came from
      for (const e of aiResult.experts) {
        // Best-effort source attribution: find the expert doc whose text contains the sourceQuote
        const sourceDoc = expertDocs.find((d) =>
          e.sourceQuote && (d.extractedText ?? "").toLowerCase().includes(e.sourceQuote.slice(0, 60).toLowerCase()),
        ) ?? expertDocs[0];

        // Category guard: if this expert cannot be attributed to an expert document, drop it
        if (!sourceDoc) {
          droppedExperts.push(e.fullName);
          console.warn(`[company-knowledge-import] CATEGORY GUARD: Dropped expert "${e.fullName}" — no expert document source found (possible cross-category hallucination).`);
          continue;
        }
        // Extra guard: the source doc must be an expert doc (not a project doc)
        if (isProjectDoc(sourceDoc) && !isExpertDoc(sourceDoc)) {
          droppedExperts.push(e.fullName);
          console.warn(`[company-knowledge-import] CATEGORY GUARD: Dropped expert "${e.fullName}" — source document "${sourceDoc.originalFileName}" is classified as a project portfolio, not a CV.`);
          continue;
        }

        allExpertDrafts.push({
          fullName: e.fullName,
          title: e.title ?? null,
          yearsExperience: e.yearsExperience ?? null,
          disciplines: e.disciplines ?? [],
          sectors: e.sectors ?? [],
          certifications: e.certifications ?? [],
          profile: `AI-extracted CV record (confidence: ${Math.round((e.confidence ?? 0) * 100)}%). Source evidence: "${e.sourceQuote}"`,
          sourceSnippet: e.sourceQuote,
          sourceDocumentId: sourceDoc.id,
          trustLevel: "AI_DRAFT",
        });
      }

      for (const p of aiResult.projects) {
        // Attribution: search ALL extractable docs since project experience lives in CVs too
        const sourceDoc = allExtractableDocs.find((d) =>
          p.sourceQuote && (d.extractedText ?? "").toLowerCase().includes(p.sourceQuote.slice(0, 60).toLowerCase()),
        ) ?? allExtractableDocs[0];

        if (!sourceDoc) {
          droppedProjects.push(p.name);
          console.warn(`[company-knowledge-import] Dropped project "${p.name}" — no source document found.`);
          continue;
        }

        allProjectDrafts.push({
          name: p.name,
          clientName: p.clientName ?? null,
          country: p.country ?? null,
          sector: p.sector ?? null,
          serviceAreas: p.serviceAreas ?? [],
          summary: p.summary ?? `AI-extracted project (confidence: ${Math.round((p.confidence ?? 0) * 100)}%). Source evidence: "${p.sourceQuote}"`,
          contractValue: p.contractValue ?? null,
          currency: p.currency ?? null,
          sourceSnippet: p.sourceQuote,
          sourceDocumentId: sourceDoc.id,
          trustLevel: "AI_DRAFT",
        });
      }

      if (droppedExperts.length > 0 || droppedProjects.length > 0) {
        console.warn(
          `[company-knowledge-import] Category enforcement dropped ${droppedExperts.length} expert(s) and ` +
          `${droppedProjects.length} project(s) due to cross-category attribution failures. ` +
          `Check that CV documents are categorized as EXPERT/CV and portfolio documents as PROJECT_PORTFOLIO.`,
        );
      }
      // ── End category enforcement ─────────────────────────────────────────────

      // Mark expert and project docs as AI-extracted
      const allAIDocs = [...expertDocs, ...projectDocs];
      for (const doc of allAIDocs) {
        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: { aiExtractionStatus: "EXTRACTED", aiExtractedAt: new Date(), aiExtractionError: null },
        });
      }

      // Log any AI warnings
      if (aiResult.warnings.length > 0) {
        console.warn("[company-knowledge-import] AI extraction warnings:", aiResult.warnings);
      }
    } catch (err) {
      aiFailures++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[company-knowledge-import] AI extraction failed, falling back to regex:", errMsg);

      // Mark all AI-candidate docs as failed
      for (const doc of [...docs]) {
        const text = doc.extractedText ?? "";
        if (text.trim().length < 100) continue;
        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: { aiExtractionStatus: "FAILED", aiExtractionError: errMsg.slice(0, 500) },
        });

        // Regex fallback with category separation
        if (isExpertDoc(doc)) {
          for (const e of regexExtractExperts(text)) {
            allExpertDrafts.push({ ...e, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
          }
        } else if (isProjectDoc(doc)) {
          for (const p of regexExtractProjects(text)) {
            allProjectDrafts.push({ ...p, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
          }
        } else {
          // Mixed/unknown: attempt both but keep separate
          for (const e of regexExtractExperts(text)) {
            allExpertDrafts.push({ ...e, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
          }
          for (const p of regexExtractProjects(text)) {
            allProjectDrafts.push({ ...p, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
          }
        }
      }
    }

    // Regex-only fallback for mixed/unclassified docs not sent to AI
    for (const doc of docs.filter((d) => {
      const text = d.extractedText ?? "";
      return text.trim().length >= 100 && !isExpertDoc(d) && !isProjectDoc(d) &&
        !/^\[(Scanned PDF|Extraction failed)/i.test(text.trim());
    })) {
      const text = doc.extractedText ?? "";
      for (const e of regexExtractExperts(text)) {
        allExpertDrafts.push({ ...e, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
      }
      for (const p of regexExtractProjects(text)) {
        allProjectDrafts.push({ ...p, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
      }
    }
  } else {
    // ── Regex path — REGEX_DRAFT, category-separated ──────────────────────
    for (const doc of docs) {
      const text = doc.extractedText ?? "";
      if (text.trim().length < 100) continue;
      if (/^\[(Scanned PDF|Extraction failed)/i.test(text.trim())) continue;

      if (isExpertDoc(doc)) {
        // CV/staff documents: only extract experts
        for (const e of regexExtractExperts(text)) {
          allExpertDrafts.push({ ...e, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
        }
      } else if (isProjectDoc(doc)) {
        // Project/portfolio documents: only extract projects
        for (const p of regexExtractProjects(text)) {
          allProjectDrafts.push({ ...p, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
        }
      } else {
        // Unclassified: attempt both (lower confidence, regex only)
        for (const e of regexExtractExperts(text)) {
          allExpertDrafts.push({ ...e, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
        }
        for (const p of regexExtractProjects(text)) {
          allProjectDrafts.push({ ...p, sourceDocumentId: doc.id, trustLevel: "REGEX_DRAFT" });
        }
      }
    }
  }

  // Global dedup by normalised name
  const uniqueExperts = [...new Map(allExpertDrafts.map((d) => [key(d.fullName), d])).values()].slice(0, 150);
  const uniqueProjects = [...new Map(allProjectDrafts.map((d) => [key(d.name), d])).values()].slice(0, 250);

  // Fetch only REVIEWED records for dedup — drafts will be replaced atomically below
  const reviewedExperts = await prisma.expert.findMany({
    where: { companyId, trustLevel: { notIn: ["REGEX_DRAFT", "AI_DRAFT"] } },
    select: { fullName: true },
  });
  const reviewedProjects = await prisma.project.findMany({
    where: { companyId, trustLevel: { notIn: ["REGEX_DRAFT", "AI_DRAFT"] } },
    select: { name: true },
  });
  const expertKeys = new Set(reviewedExperts.map((e) => key(e.fullName)));
  const projectKeys = new Set(reviewedProjects.map((p) => key(p.name)));

  // Pre-build insert payloads with dedup (outside transaction for speed)
  const expertsPayload: {
    companyId: string; fullName: string; title?: string | null; yearsExperience?: number | null;
    disciplines: string; sectors: string; certifications: string; profile: string;
    trustLevel: string; sourceDocumentId?: string | null;
  }[] = [];
  for (const expert of uniqueExperts) {
    const k = key(expert.fullName);
    if (expertKeys.has(k)) continue;
    expertsPayload.push({
      companyId,
      fullName: expert.fullName,
      title: expert.title,
      yearsExperience: expert.yearsExperience,
      disciplines: JSON.stringify(expert.disciplines),
      sectors: JSON.stringify(expert.sectors),
      certifications: JSON.stringify(expert.certifications),
      profile: `[${expert.trustLevel} — REVIEW REQUIRED before use in proposals]\n\n${expert.profile}\n\nSource snippet:\n${expert.sourceSnippet}`,
      trustLevel: expert.trustLevel,
      sourceDocumentId: expert.sourceDocumentId,
    });
    expertKeys.add(k);
  }

  const projectsPayload: {
    companyId: string; name: string; clientName?: string | null; country?: string | null;
    sector?: string | null; serviceAreas: string; summary: string;
    contractValue?: number | null; currency?: string | null;
    trustLevel: string; sourceDocumentId?: string | null;
  }[] = [];
  for (const project of uniqueProjects) {
    const k = key(project.name);
    if (projectKeys.has(k)) continue;
    projectsPayload.push({
      companyId,
      name: project.name,
      clientName: project.clientName,
      country: project.country,
      sector: project.sector,
      serviceAreas: JSON.stringify(project.serviceAreas),
      summary: `[${project.trustLevel} — REVIEW REQUIRED before use in proposals]\n\n${project.summary}\n\nSource snippet:\n${project.sourceSnippet}`,
      contractValue: project.contractValue,
      currency: project.currency,
      trustLevel: project.trustLevel,
      sourceDocumentId: project.sourceDocumentId,
    });
    projectKeys.add(k);
  }

  // Atomic: delete all existing drafts then insert the new batch in one transaction.
  // This ensures records are never partially lost if the insert fails midway.
  await prisma.$transaction([
    prisma.expert.deleteMany({ where: { companyId, trustLevel: { in: ["REGEX_DRAFT", "AI_DRAFT"] } } }),
    prisma.project.deleteMany({ where: { companyId, trustLevel: { in: ["REGEX_DRAFT", "AI_DRAFT"] } } }),
    ...(expertsPayload.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? [prisma.expert.createMany({ data: expertsPayload as any, skipDuplicates: true })]
      : []),
    ...(projectsPayload.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? [prisma.project.createMany({ data: projectsPayload as any, skipDuplicates: true })]
      : []),
  ]);

  const expertsCreated = expertsPayload.length;
  const projectsCreated = projectsPayload.length;

  return { docsProcessed: docs.length, expertsCreated, projectsCreated, aiUsed: useAI, aiFailures };
}

export async function analyzeCompanyKnowledgeGaps(companyId: string) {
  const [docs, experts, projects] = await Promise.all([
    prisma.companyDocument.findMany({
      where: { companyId },
      select: { id: true, originalFileName: true, category: true, extractedText: true, aiExtractionStatus: true },
    }),
    prisma.expert.findMany({ where: { companyId }, select: { trustLevel: true } }),
    prisma.project.findMany({ where: { companyId }, select: { trustLevel: true } }),
  ]);

  const byTrust = (records: { trustLevel: string | null }[]) => ({
    REVIEWED: records.filter((r) => r.trustLevel === "REVIEWED").length,
    AI_DRAFT: records.filter((r) => r.trustLevel === "AI_DRAFT").length,
    REGEX_DRAFT: records.filter((r) => r.trustLevel === "REGEX_DRAFT" || !r.trustLevel).length,
  });

  return {
    totalDocuments: docs.length,
    extractedDocuments: docs.filter((d) => (d.extractedText ?? "").length >= 100).length,
    experts: byTrust(experts),
    projects: byTrust(projects),
    aiEnabled: isAIEnabled(),
    pendingReview: experts.filter((e) => e.trustLevel !== "REVIEWED").length + projects.filter((p) => p.trustLevel !== "REVIEWED").length,
  };
}
