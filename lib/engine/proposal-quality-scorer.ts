/**
 * Proposal Quality Scorer — produces a deterministic quality score
 * over the final markdown. Used to surface output quality to the user
 * so they can decide whether to regenerate, manually edit, or accept.
 *
 * Scoring axes (each 0–10, weighted equally):
 *   - structureCompleteness: presence of required sections
 *   - evidenceDensity: ratio of paragraphs containing specific evidence
 *     (project names, ETB values, license numbers, dates) to total
 *   - tableCoverage: count of distinct table-style sections present
 *   - sectorVocabulary: ratio of expected sector terms present
 *   - throughlineConsistency: top 1–2 projects appear in CL, ES, B
 *   - aiTraceFreedom: absence of forbidden phrases
 *
 * Returns score (0–100) and a list of weak axes for transparency.
 *
 * NOTE: This is computed at generation time and embedded in the
 * GeneratedDocument.contentSummary field for surfacing in the UI.
 * It does not auto-repair; that is the job of the throughline
 * enforcer and vocabulary enricher.
 */

import type { ProjectRecord } from "./benchmark-tables";

export type QualityScore = {
  total: number; // 0–100
  axes: {
    structureCompleteness: number; // 0–10
    evidenceDensity: number;
    tableCoverage: number;
    sectorVocabulary: number;
    throughlineConsistency: number;
    aiTraceFreedom: number;
  };
  weakAxes: string[];
  notes: string[];
};

const REQUIRED_SECTIONS = [
  /cover letter/i,
  /executive summary/i,
  /(section a|company profile|corporate information)/i,
  /(section b|relevant experience|project portfolio)/i,
  /(section c|technical approach|methodology)/i,
  /(section d|additional information|value)/i,
  /declaration/i,
];

const SECTOR_VOCAB: Record<string, RegExp[]> = {
  healthcare: [/IPC/i, /PACS/i, /HEPA/i, /medical gas/i, /lead.*shield/i, /Legionella/i],
  water: [/EPANET/i, /WaterCAD/i, /yield test/i, /EBCS/i, /chlorination/i],
  road: [/ESAL/i, /CBR/i, /Marshall/i, /FIDIC/i, /AASHTO/i],
  urban: [/GIS/i, /land.use zoning/i, /phasing strategy/i, /stakeholder consultation/i],
  environmental: [/ESF/i, /ESMP/i, /mitigation hierarchy/i, /baseline data/i, /grievance/i],
  ict: [/API/i, /UAT/i, /RBAC/i, /SLA/i, /backup|RTO|RPO/i],
  education: [/pupil.ratio/i, /accessible/i, /climate.responsive/i, /fire egress/i],
};

const FORBIDDEN_PHRASES = [
  /as an ai/i,
  /chatgpt/i,
  /openai/i,
  /lorem ipsum/i,
  /\bplaceholder\b/i,
  /sample text/i,
  /committed to excellence/i,
  /leading firm in the region/i,
  /team of qualified professionals/i,
  /we look forward to the opportunity/i,
  /\[INSERT[^\]]*\]/i,
  /\bTBD\b/i,
];

function detectSector(primarySector: string): string {
  const s = primarySector.toLowerCase();
  if (/health|hospital|medical|clinic/.test(s)) return "healthcare";
  if (/water|borehole|hydraulic|sanitary/.test(s)) return "water";
  if (/road|bridge|highway|pavement/.test(s)) return "road";
  if (/urban|master plan|municipal/.test(s)) return "urban";
  if (/environmental|esia|esmp|safeguard/.test(s)) return "environmental";
  if (/ict|software|digital|mis|erp/.test(s)) return "ict";
  if (/school|university|campus|education/.test(s)) return "education";
  return "generic";
}

function paragraphHasEvidence(paragraph: string): boolean {
  // Specific evidence markers: ETB amounts, m² scale, license numbers, donor
  // names, dates with context, named assets. The year marker is intentionally
  // restrictive — a bare four-digit year alone (e.g., "in 2023") is too weak
  // a signal; we require the year to appear in a context that signals it is
  // a date marker rather than incidental text. This is paired with the
  // named-asset and dated-range markers so genuine date references in
  // evidence-rich paragraphs still match.
  const markers = [
    /\b(ETB|USD|EUR|GBP)\s*[\d,]+/i,
    /\b\d{1,3}(?:,\d{3})*\s*m[²2]/i,
    /\b(IPSTE|PPE|PSNE|PPECM|PPME|PPSTE|PEPCM|PAR|PPA)\/\d+/i,
    /\b(World Bank|UNDP|USAID|British Council|ESF|IFC|JICA|GIZ|KFW|ADB|AFDB|IGAD)\b/i,
    // Year ranges (e.g., 2018–2022, 2018-2022) — strong date evidence
    /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/,
    // Parenthesised year (e.g., "(2023)") — strong date evidence
    /\((?:19|20)\d{2}(?:[\/,;\s]|\b)/,
    // Year preceded by a date-marker preposition / verb (e.g., "in 2023",
    // "since 2018", "completed 2024", "delivered 2022")
    /\b(?:in|since|from|between|completed|delivered|signed|awarded|established|founded|certified)\s+(?:19|20)\d{2}\b/i,
    // Named asset (e.g., "Hospital A", "Project Pharo") — distinct from
    // generic capability talk
    /\b(Hospital|Project|Centre|Center|Plant|Park|Building|School|University|Bridge|Road) [A-Z]/,
  ];
  return markers.some((m) => m.test(paragraph));
}

export function scoreProposalQuality(opts: {
  markdown: string;
  primarySector: string;
  topProjects: ProjectRecord[];
}): QualityScore {
  const md = opts.markdown;
  const notes: string[] = [];
  const weakAxes: string[] = [];

  // 1. Structure completeness (0–10)
  const presentSections = REQUIRED_SECTIONS.filter((re) => re.test(md));
  const structureCompleteness = Math.round((presentSections.length / REQUIRED_SECTIONS.length) * 10);
  if (structureCompleteness < 7) {
    weakAxes.push("structureCompleteness");
    notes.push(`Only ${presentSections.length} of ${REQUIRED_SECTIONS.length} required sections present.`);
  }

  // 2. Evidence density (0–10)
  const paragraphs = md
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 80 && !p.startsWith("|") && !p.startsWith("#"));
  const withEvidence = paragraphs.filter(paragraphHasEvidence).length;
  const evidenceDensity = paragraphs.length > 0 ? Math.round((withEvidence / paragraphs.length) * 10) : 5;
  if (evidenceDensity < 5) {
    weakAxes.push("evidenceDensity");
    notes.push(`Only ${withEvidence} of ${paragraphs.length} substantive paragraphs cite specific evidence (projects/values/licenses).`);
  }

  // 3. Table coverage (0–10) — score by count of table heading prefixes
  const tableMatches = (md.match(/^\|[^\n]+\|$/gm) ?? []).length;
  const tableSections = (md.match(/^#{2,3}\s+(?:A\.\d|B\.\d|C\.\d|D\.\d|E\.\d)/gm) ?? []).length;
  const tableCoverage = Math.min(10, Math.round((tableMatches / 20) * 5 + (tableSections / 6) * 5));
  if (tableCoverage < 5) {
    weakAxes.push("tableCoverage");
    notes.push(`Limited tabular evidence: ${tableMatches} table rows across ${tableSections} numbered sections.`);
  }

  // 4. Sector vocabulary (0–10)
  const sector = detectSector(opts.primarySector);
  const expectedTerms = SECTOR_VOCAB[sector] ?? [];
  const presentTerms = expectedTerms.filter((re) => re.test(md));
  const sectorVocabulary = expectedTerms.length === 0
    ? 8 // generic sector — no terms required, neutral score
    : Math.round((presentTerms.length / expectedTerms.length) * 10);
  if (expectedTerms.length > 0 && sectorVocabulary < 6) {
    weakAxes.push("sectorVocabulary");
    notes.push(`Sector-specific vocabulary thin: only ${presentTerms.length} of ${expectedTerms.length} expected ${sector} terms present.`);
  }

  // 5. Throughline consistency (0–10)
  // When no reviewed projects exist, the throughline cannot be measured — there
  // is nothing to thread through CL/ES/B. Return a neutral 5 (matching the
  // pattern used by the sectorVocabulary axis when no expected terms apply)
  // and surface the underlying issue as a note. Returning 10 ("perfect") here
  // would mask the fact that the proposal has no project anchors at all.
  const top = opts.topProjects.slice(0, 2);
  let throughlineConsistency: number;
  if (top.length === 0) {
    throughlineConsistency = 5;
    notes.push("Throughline axis is neutral (no reviewed projects available to anchor Cover Letter / Executive Summary / Section B).");
  } else {
    const sections = ["cover letter", "executive summary", "section b"];
    let matches = 0;
    let total = 0;
    for (const project of top) {
      const projectKey = project.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!projectKey || projectKey.length < 4) continue;
      const tokens = projectKey.split(" ").filter((t) => t.length > 2);
      // Require at least 3 distinctive tokens before allowing a partial-name
      // match. Without this guard, single-token distinctives (e.g., "hospital"
      // for project name "G+6 Hospital") would over-match unrelated text.
      const distinctive = tokens.length >= 3 ? tokens.slice(0, 3).join(" ") : "";
      for (const section of sections) {
        total++;
        // crude: look at the rough region after each section heading
        const sectionRegex = new RegExp(`#${section}[\\s\\S]{0,3000}`, "i");
        const match = md.toLowerCase().match(sectionRegex)?.[0] ?? "";
        if (match.includes(projectKey) || (distinctive && match.includes(distinctive))) matches++;
      }
    }
    throughlineConsistency = total > 0 ? Math.round((matches / total) * 10) : 5;
    if (throughlineConsistency < 6) {
      weakAxes.push("throughlineConsistency");
      notes.push("Top reviewed projects do not consistently appear in Cover Letter, Executive Summary, and Section B.");
    }
  }

  // 6. AI-trace freedom (0–10)
  const traces = FORBIDDEN_PHRASES.filter((re) => re.test(md));
  const aiTraceFreedom = traces.length === 0 ? 10 : Math.max(0, 10 - traces.length * 2);
  if (aiTraceFreedom < 8) {
    weakAxes.push("aiTraceFreedom");
    notes.push(`AI / forbidden phrase trace detected: ${traces.length} hit(s).`);
  }

  const axes = {
    structureCompleteness,
    evidenceDensity,
    tableCoverage,
    sectorVocabulary,
    throughlineConsistency,
    aiTraceFreedom,
  };
  const total = Math.round(((axes.structureCompleteness + axes.evidenceDensity + axes.tableCoverage + axes.sectorVocabulary + axes.throughlineConsistency + axes.aiTraceFreedom) / 60) * 100);

  return { total, axes, weakAxes, notes };
}

export function formatQualityScoreSummary(score: QualityScore): string {
  const axes = `structure ${score.axes.structureCompleteness}/10, evidence ${score.axes.evidenceDensity}/10, tables ${score.axes.tableCoverage}/10, vocabulary ${score.axes.sectorVocabulary}/10, throughline ${score.axes.throughlineConsistency}/10, ai-trace-free ${score.axes.aiTraceFreedom}/10`;
  return `Quality score: ${score.total}/100 (${axes})${score.weakAxes.length > 0 ? `. Weak axes: ${score.weakAxes.join(", ")}` : ""}`;
}
