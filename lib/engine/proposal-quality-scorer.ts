/**
 * Proposal Quality Scorer — produces a deterministic quality score
 * over the final markdown. Used to surface output quality to the user
 * so they can decide whether to regenerate, manually edit, or accept.
 *
 * Scoring axes (each 0–10, weighted equally):
 *   - structureCompleteness: presence of required sections (Cover Letter, ES, A–D)
 *   - evidenceDensity: ratio of paragraphs containing specific evidence
 *     (project names, ETB values, license numbers, dates) to total
 *   - tableCoverage: count of distinct table-style sections present
 *   - sectorVocabulary: ratio of expected sector terms present
 *   - throughlineConsistency: top 1–2 projects appear in CL, ES, B
 *   - aiTraceFreedom: absence of forbidden phrases
 *   - complianceMatrixCoverage: Section E (Compliance Matrix) is present and
 *     populated with FULLY MET / PARTIALLY MET / NOT MET status cells
 *   - evaluatorMirrorCoverage: Section F (Evaluation Criteria Response Mirror)
 *     is present and echoes evaluator language with weight + section pointer
 *   - winThemesPresence: Section G (Win Themes & Discriminators) has both a
 *     framing paragraph and a discriminator-vs-criterion table
 *   - selfScorePresence: Section H (Proposal Self-Score) has 0–10 scoring
 *     against criteria with rationale and predicted overall score
 *
 * Returns score (0–100) and a list of weak axes for transparency. Total is
 * normalised: 10 axes × 10 max = 100 raw, so the score IS the percentage.
 *
 * The four new axes (complianceMatrixCoverage, evaluatorMirrorCoverage,
 * winThemesPresence, selfScorePresence) verify that the four mandatory
 * output sections introduced in PR #228 are actually produced. Without
 * these axes the AI could silently skip them and the deficiency would not
 * surface to the refinement loop.
 *
 * NOTE: This is computed at generation time and embedded in the
 * GeneratedDocument.contentSummary field for surfacing in the UI.
 * It does not auto-repair; that is the job of the throughline
 * enforcer, vocabulary enricher, and refinement pass.
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
    complianceMatrixCoverage: number;
    evaluatorMirrorCoverage: number;
    winThemesPresence: number;
    selfScorePresence: number;
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

// ─── Sector vocabulary with word-boundary-safe abbreviations ────────
// Every 2-4 char abbreviation has \b around it. Without these:
//   bare /IPC/i  matched "particIPC" / "principle" / "antIPCipate"
//   bare /CBR/i  matched anywhere "cbr" appears as a substring
//   bare /GIS/i  matched "GISt" / "longISt"
//   bare /ESF/i  matched "ESFsf" / "esther's friend"
//   bare /API/i  matched "rapid" / "happy" / "scaping"
//   bare /UAT/i  matched "evaluation" / "situation" / "graduate"
//   bare /SLA/i  matched "Islamabad" / "isolate" / "translation"
// Over-scoring sector vocabulary on totally unrelated tenders.
const SECTOR_VOCAB: Record<string, RegExp[]> = {
  healthcare: [/\bIPC\b/i, /\bPACS\b/i, /\bHEPA\b/i, /medical gas/i, /lead.*shield/i, /Legionella/i],
  water: [/\bEPANET\b/i, /WaterCAD/i, /yield test/i, /\bEBCS\b/i, /chlorination/i],
  road: [/\bESAL\b/i, /\bCBR\b/i, /Marshall/i, /\bFIDIC\b/i, /\bAASHTO\b/i],
  urban: [/\bGIS\b/i, /land.use zoning/i, /phasing strategy/i, /stakeholder consultation/i],
  environmental: [/\bESF\b/i, /\bESMP\b/i, /mitigation hierarchy/i, /baseline data/i, /grievance/i],
  ict: [/\bAPI\b/i, /\bUAT\b/i, /\bRBAC\b/i, /\bSLA\b/i, /backup|\bRTO\b|\bRPO\b/i],
  education: [/pupil.ratio/i, /accessible/i, /climate.responsive/i, /fire egress/i],
  energy: [/load forecast/i, /HOMER/i, /SCADA/i, /grid code/i, /single.line diagram/i, /generation.capacity/i],
  agriculture: [/agronomic/i, /irrigation scheme/i, /drip.*irrigation/i, /value.chain/i, /FAO/i, /yield model/i],
  mining: [/geotechnical/i, /slope stability/i, /JORC/i, /tailings/i, /blast design/i, /ore body/i],
  transport: [/AADT/i, /level of service/i, /PCE/i, /berth/i, /container throughput/i, /AIS/i],
  building: [/BIM/i, /MEP/i, /fire compartment/i, /HVAC/i, /BOQ/i, /structural.*analysis/i],
  oil_gas: [/P&ID/i, /HAZOP/i, /wellhead/i, /pipeline integrity/i, /API\s+\d/i, /HSE.*plan/i],
  institutional: [/Theory of Change/i, /organisational design/i, /capacity assessment/i, /HMIS/i, /MoU/i, /change management/i],
  financial: [/KYC/i, /AML/i, /Basel/i, /credit risk/i, /IFRS/i, /prudential/i, /core banking/i, /MFI/i],
  telecoms: [/spectrum/i, /base station/i, /LTE|5G|4G/i, /backhaul/i, /last.mile/i, /MVNO/i, /core network/i],
  port: [/berth.*design|quay/i, /draft.*vessel/i, /harbor|harbour/i, /pilotage/i, /port master plan/i, /ship.*manifest/i, /terminal.*handling/i],
};

// Keep this list aligned with hasForbiddenWeakness() in proposal-benchmark-guard.ts.
// The guard normalises/strips these; the scorer reports them as a quality penalty.
const FORBIDDEN_PHRASES = [
  /as an ai/i,
  /\blanguage model\b/i,
  /chatgpt/i,
  /openai/i,
  /lorem ipsum/i,
  /\bplaceholder\b/i,
  /sample text/i,
  /\btodo\b/i,
  /\btbd\b/i,
  /to be determined/i,
  /n\/a \(pending\)/i,
  /committed to excellence/i,
  /leading firm in the region/i,
  /team of qualified professionals/i,
  /we look forward to the opportunity/i,
  /\[INSERT[^\]]*\]/i,
  /\[(?:PLACEHOLDER|NAME|DATE|TBD|ADD|ENTER|SPECIFY|YOUR)[^\]]{0,60}\]/i,
  /\bworld[\s-]class\b/i,
  /\binnovative solutions?\b/i,
  /\bstreamlined operations?\b/i,
  /\benhanced efficiency\b/i,
  /\bbest practices\b/i,
  /\bstate[\s-]of[\s-]the[\s-]art\b/i,
  /\bsecond to none\b/i,
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
  if (/energy|power|solar|wind|grid|generation|transmission/.test(s)) return "energy";
  if (/agri|farm|crop|irrigation|livestock|rural develop/.test(s)) return "agriculture";
  if (/mining|mineral|quarry|extracti/.test(s)) return "mining";
  if (/transport|port|logistic|shipping|aviation|rail/.test(s)) return "transport";
  if (/building|construct|architect|structure|facility|facilities/.test(s)) return "building";
  if (/oil|gas|petroleum|refinery|pipeline/.test(s)) return "oil_gas";
  if (/institution|reform|governance|capacity|public sector|ministry/.test(s)) return "institutional";
  if (/finance|bank|micro.?finance|insurance|credit|lending|investment fund/.test(s)) return "financial";
  if (/telecom|broadband|spectrum|mobile network|isp|telecommunications/.test(s)) return "telecoms";
  if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(s)) return "port";
  return "generic";
}

/**
 * Measure the depth of a section identified by its heading pattern.
 * Returns a 0–1 multiplier: 1.0 when the section has substantive
 * body content, falling toward 0 when the body is empty, just a
 * heading, or contains only filler.
 *
 * Closes audit gap #7 (structureCompleteness is gameable — counts
 * section presence, not depth). A section with just "# Section A\n\n
 * TBD" used to score the same as a fully-developed section.
 */
function sectionDepthMultiplier(markdown: string, headingPattern: RegExp): number {
  const headingMatch = markdown.match(headingPattern);
  if (!headingMatch) return 0;
  // Determine the heading level (# count) immediately preceding the
  // match. The body of this section runs until the next heading at
  // the SAME or HIGHER level — sub-headings (deeper #) belong to
  // this section and must be counted as part of its body.
  const matchIndex = headingMatch.index ?? 0;
  const lineStart = markdown.lastIndexOf("\n", matchIndex - 1) + 1;
  const linePrefix = markdown.slice(lineStart, matchIndex);
  const headingLevelMatch = linePrefix.match(/^(#{1,6})\s+$/);
  const headingLevel = headingLevelMatch ? headingLevelMatch[1].length : 1;
  const startOffset = matchIndex + headingMatch[0].length;
  const rest = markdown.slice(startOffset);
  // Match a heading at level 1..headingLevel — sub-headings (level > headingLevel) are body content.
  const siblingHeadingPattern = new RegExp(`\\n#{1,${headingLevel}}\\s+\\w`);
  const nextHeadingMatch = rest.match(siblingHeadingPattern);
  const body = nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index ?? rest.length) : rest;
  const cleaned = body
    .replace(/\|[^\n]*\|/g, " ")     // strip table rows for "prose body" assessment
    .replace(/^\s*[-*]\s+/gm, "")    // strip list bullets
    .replace(/\s+/g, " ")
    .trim();
  // Filler-only bodies (TBD, To be confirmed, Bid-Team Action, etc.) don't count.
  const fillerOnly = /^(?:tbd|to be (?:determined|confirmed|advised|added)|bid[\s-]team action[^.]*\.?|n\/a|none|placeholder|\[insert[^\]]*\])\s*\.?$/i.test(cleaned);
  if (fillerOnly) return 0;
  const length = cleaned.length;
  if (length < 60) return 0;                   // single-sentence-or-less stub
  if (length < 200) return 0.5;                // shallow body
  if (length < 600) return 0.85;               // moderate body
  return 1;                                    // substantive body
}

/**
 * Count "substantive" table rows. Closes audit gap #7
 * (tableCoverage counts tables, not whether they're useful).
 *
 * A row is substantive when at least 2 of its cells have >3 chars
 * of non-filler content. The header row (separator row
 * `|---|---|`) and rows containing only TBD / N/A / placeholders
 * don't count toward useful coverage.
 */
function substantiveTableRowCount(markdown: string): number {
  const rows = markdown.match(/^\|[^\n]+\|$/gm) ?? [];
  let substantive = 0;
  for (const row of rows) {
    // Skip Markdown table separator rows (|---|---|).
    if (/^\|\s*:?-{3,}/.test(row)) continue;
    const cells = row.slice(1, -1).split("|").map((c) => c.trim());
    let goodCells = 0;
    for (const cell of cells) {
      if (cell.length < 3) continue;
      if (/^(?:tbd|n\/a|none|to be (?:determined|confirmed|advised)|placeholder|-+|—|–|x{2,})$/i.test(cell)) continue;
      goodCells += 1;
      if (goodCells >= 2) break;
    }
    if (goodCells >= 2) substantive += 1;
  }
  return substantive;
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
    /\b(?:in|since|from|between|during|throughout|across|within|after|prior|completed|delivered|signed|awarded|established|founded|certified|originally|initially)\s+(?:19|20)\d{2}\b/i,
    // Named asset (e.g., "Hospital A", "Project Pharo", "Adama Water Supply Scheme")
    /\b(Hospital|Project|Centre|Center|Plant|Park|Building|School|University|Bridge|Road|Scheme|Corridor|Zone|Facility|System|Network|Hub|Complex|Institute|Authority|Programme|Program|Rehabilitation|Upgrade|Extension|Expansion|Pipeline|Station|Terminal|Port|Dam|Reservoir|Canal|Substation) [A-Z]/,
    // Contract value without currency unit (e.g., "45 million", "2.3 billion")
    /\b\d+(?:\.\d+)?\s*(?:million|billion)\b/i,
    // Percentage-completion or specification metrics (e.g., "98% uptime", "DN300")
    /\bDN\d{2,4}\b|\bPN\d{1,3}\b|\bNPS\s*\d+\b/,
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
  // Depth-weighted (gap #7): each present section contributes 0–1
  // based on the actual body content. A section with only a heading
  // or filler counts as 0; substantive prose counts as 1.
  const sectionDepthMultipliers = REQUIRED_SECTIONS.map((re) => sectionDepthMultiplier(md, re));
  const depthSum = sectionDepthMultipliers.reduce((sum, m) => sum + m, 0);
  const structureCompleteness = Math.round((depthSum / REQUIRED_SECTIONS.length) * 10);
  const presentSections = sectionDepthMultipliers.filter((m) => m > 0).length;
  const shallowSections = sectionDepthMultipliers.filter((m) => m > 0 && m < 1).length;
  if (structureCompleteness < 7) {
    weakAxes.push("structureCompleteness");
    const shallowNote = shallowSections > 0 ? ` (${shallowSections} present but shallow)` : "";
    notes.push(`Only ${presentSections} of ${REQUIRED_SECTIONS.length} required sections present with substantive content${shallowNote}.`);
  }

  // 2. Evidence density (0–10)
  const paragraphs = md
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 80 && !p.startsWith("|") && !p.startsWith("#"));
  const withEvidence = paragraphs.filter(paragraphHasEvidence).length;
  // Floor at 4 when fewer than 6 paragraphs exist — a short but focused
  // proposal should not be penalised the same as a long evidence-thin one,
  // but an evidence-free short proposal should still score below passing.
  const evidenceDensity = paragraphs.length === 0
    ? 5
    : paragraphs.length < 6
      ? Math.max(4, Math.round((withEvidence / paragraphs.length) * 10))
      : Math.round((withEvidence / paragraphs.length) * 10);
  if (evidenceDensity < 4) {
    weakAxes.push("evidenceDensity");
    notes.push(`Only ${withEvidence} of ${paragraphs.length} substantive paragraphs cite specific evidence (projects/values/licenses).`);
  }

  // 3. Table coverage (0–10) — score by count of SUBSTANTIVE table
  // rows + numbered sections. Substantive (gap #7): row must have at
  // least 2 cells with non-filler content >3 chars. Header-only
  // tables and rows full of TBD/N/A no longer inflate this axis.
  const rawTableRowCount = (md.match(/^\|[^\n]+\|$/gm) ?? []).length;
  const substantiveTableRows = substantiveTableRowCount(md);
  const tableSections = (md.match(/^#{2,3}\s+(?:A\.\d|B\.\d|C\.\d|D\.\d|E\.\d)/gm) ?? []).length;
  // Section C sub-section count: minimum 6 C.2.x sub-sections are required.
  // Fewer than 6 indicates the methodology is incomplete vs. the tender scope.
  const sectionC2SubSections = (md.match(/^###\s+C\.2\.\d+/gm) ?? []).length;
  const subSectionBonus = sectionC2SubSections >= 6 ? 1 : 0;
  if (sectionC2SubSections > 0 && sectionC2SubSections < 6) {
    weakAxes.push("tableCoverage");
    notes.push(`Section C.2 has only ${sectionC2SubSections} sub-section(s) — minimum 6 required for benchmark quality.`);
  }
  // Divisor of 12 rows (was 20) — a well-structured proposal typically has 12+ rows
  // across A.2 corporate table, B.2/B.3 project cards, C.3 work plan, C.4 QA table.
  const tableCoverage = Math.min(10, Math.round((substantiveTableRows / 12) * 5 + (tableSections / 6) * 4) + subSectionBonus);
  if (tableCoverage < 5) {
    weakAxes.push("tableCoverage");
    const fillerNote = rawTableRowCount > substantiveTableRows
      ? ` (${rawTableRowCount - substantiveTableRows} additional row(s) ignored as filler/empty)`
      : "";
    notes.push(`Limited tabular evidence: ${substantiveTableRows} substantive table rows across ${tableSections} numbered sections${fillerNote}.`);
  }

  // 4. Sector vocabulary (0–10)
  // Improvements (PR #248):
  //   • For genuinely-generic sectors (no SECTOR_VOCAB entry), score
  //     10/10 instead of 8/10 — there is nothing to penalise. The
  //     prior 8/10 default capped the overall total at 98 even when
  //     every other axis was perfect, which hurt non-construction
  //     tenders disproportionately.
  //   • For sectors WITH a vocab entry, scan ALL sector vocabularies
  //     for partial matches and give credit when a different sector's
  //     vocab is present. Prevents penalising a multi-sector tender
  //     whose primary sector was set to one option but whose prose
  //     legitimately uses vocabulary from an adjacent sector.
  const sector = detectSector(opts.primarySector);
  const expectedTerms = SECTOR_VOCAB[sector] ?? [];
  const presentTerms = expectedTerms.filter((re) => re.test(md));
  let sectorVocabulary: number;
  if (expectedTerms.length === 0) {
    // Generic sector — score 10/10 if any sector vocab present (the
    // proposal is sector-aware in some way), else 8/10 neutral.
    const anySectorVocabHit = Object.values(SECTOR_VOCAB).some((terms) => terms.some((re) => re.test(md)));
    sectorVocabulary = anySectorVocabHit ? 10 : 8;
  } else {
    sectorVocabulary = Math.round((presentTerms.length / expectedTerms.length) * 10);
  }
  if (expectedTerms.length > 0 && sectorVocabulary < 6) {
    weakAxes.push("sectorVocabulary");
    notes.push(`Sector-specific vocabulary thin: only ${presentTerms.length} of ${expectedTerms.length} expected ${sector} terms present.`);
  }

  // 5. Throughline consistency (0–10)
  // When no reviewed projects exist, the throughline cannot be measured — there
  // is nothing to thread through CL/ES/B. Improvement (PR #248): instead of
  // hardcoding a neutral 5, give the proposal credit for ANY named asset that
  // appears in all three of CL/ES/B. The evidence-marker injector (also from
  // PR #248) frequently plants project anchors from the wider portfolio in
  // multiple sections, so this rewards proposals that achieve consistency
  // even without a formally-selected top project.
  const top = opts.topProjects.slice(0, 2);
  let throughlineConsistency: number;
  if (top.length === 0) {
    // Look for ANY repeated named-asset pattern across all three sections.
    // A proposal that names "Pharo Foundation Specialty Hospital" or
    // "Adama Water Supply Scheme" in CL + ES + B has a real throughline
    // even when no formal top project was selected.
    const sectionMd = (pattern: string) => {
      const sectionRegex = new RegExp(`#{1,3}\\s*(?:${pattern})[\\s\\S]{0,3000}`, "i");
      return md.toLowerCase().match(sectionRegex)?.[0] ?? "";
    };
    const cl = sectionMd("cover letter");
    const es = sectionMd("executive summary");
    const sb = sectionMd("section\\s*b(?:[^a-z]|$)|relevant experience|project portfolio");
    // Extract named-asset tokens (Hospital X, Project Y, Centre Z, etc.)
    // from the cover letter, then check whether any appear in ES and B.
    const namedAssetRe = /(hospital|project|centre|center|plant|park|building|school|university|bridge|road|scheme|corridor|zone|facility|system|network|hub|complex|institute|authority|programme|program|rehabilitation|dam|reservoir|canal|station|terminal|port|substation)\s+[A-Za-z0-9'+\-/]+/gi;
    const clAssets = (cl.match(namedAssetRe) ?? []).map((s) => s.trim().toLowerCase());
    const distinctClAssets = [...new Set(clAssets)];
    let crossSectionMatches = 0;
    for (const asset of distinctClAssets.slice(0, 3)) {
      if (es.includes(asset) && sb.includes(asset)) crossSectionMatches += 1;
    }
    if (crossSectionMatches > 0) {
      // 1 asset across all three = 8/10, 2 = 9/10, 3+ = 10/10
      throughlineConsistency = Math.min(10, 7 + crossSectionMatches);
      notes.push(`Throughline detected: ${crossSectionMatches} named asset(s) appear in Cover Letter + Executive Summary + Section B without formal project selection.`);
    } else {
      throughlineConsistency = 5;
      notes.push("Throughline axis is neutral (no reviewed projects available to anchor Cover Letter / Executive Summary / Section B).");
    }
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
        const sectionPattern = section === "section b"
          ? "section\\s*b(?:[^a-z]|$)|relevant experience|project portfolio"
          : section;
        const sectionRegex = new RegExp(`#{1,3}\\s*(?:${sectionPattern})[\\s\\S]{0,3000}`, "i");
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

  // 7. Compliance matrix coverage (0–10)
  // Section E (Compliance Matrix) requires: a section heading mentioning
  // "Compliance Matrix" AND at least one row with a FULLY/PARTIALLY/NOT MET
  // status cell. A missing or empty matrix is the single biggest reason
  // proposals score below the technical pass mark on regulated tenders.
  let complianceMatrixCoverage = 0;
  const matrixHeadingRe = /(^|\n)\s*#{1,4}\s*(?:section\s*[E:.\-\s]*)?\s*compliance\s+matrix/i;
  const hasMatrixHeading = matrixHeadingRe.test(md);
  const statusCellMatches = (md.match(/\b(FULLY MET|PARTIALLY MET|NOT MET|NOT_MET|FULLY_MET|PARTIALLY_MET)\b/gi) ?? []).length;
  if (hasMatrixHeading) complianceMatrixCoverage += 4;
  if (statusCellMatches >= 1) complianceMatrixCoverage += 2;
  if (statusCellMatches >= 5) complianceMatrixCoverage += 2;
  if (statusCellMatches >= 10) complianceMatrixCoverage += 2;
  complianceMatrixCoverage = Math.min(10, complianceMatrixCoverage);
  if (complianceMatrixCoverage < 6) {
    weakAxes.push("complianceMatrixCoverage");
    notes.push(`Compliance Matrix (Section E) ${hasMatrixHeading ? "heading present" : "MISSING"}; ${statusCellMatches} status cell(s) detected.`);
  }

  // 8. Evaluator mirror coverage (0–10)
  // Section F (Evaluation Criteria Response Mirror) requires: heading +
  // either a weight column OR a "where this proposal answers it" pointer.
  // The mirror is what gets the proposal scored on the evaluator's rubric
  // line by line — its absence costs points across every criterion.
  let evaluatorMirrorCoverage = 0;
  const mirrorHeadingRe = /(^|\n)\s*#{1,4}\s*(?:section\s*[F:.\-\s]*)?\s*(?:evaluation\s+criteria\s+response\s+mirror|evaluation\s+(?:criteria\s+)?response|evaluator(?:'s)?\s+mirror|evaluation\s+mirror)/i;
  const hasMirrorHeading = mirrorHeadingRe.test(md);
  const weightCellMatches = (md.match(/\b\d{1,2}\s*%(?:\s*\||\s*\n)/g) ?? []).length;
  // Only count section pointers that appear inside table cells (preceded and
  // followed by pipe characters) — prevents ordinary prose references like
  // "as detailed in Section B" from inflating the count.
  const sectionPointerMatches = (md.match(/\|\s*(?:Section|Sec\.?)\s*[A-H](?:\.\d)?\s*(?:\||$)/gim) ?? []).length;
  if (hasMirrorHeading) evaluatorMirrorCoverage += 5;
  if (weightCellMatches >= 2) evaluatorMirrorCoverage += 2;
  if (sectionPointerMatches >= 3) evaluatorMirrorCoverage += 3;
  evaluatorMirrorCoverage = Math.min(10, evaluatorMirrorCoverage);
  if (evaluatorMirrorCoverage < 6) {
    weakAxes.push("evaluatorMirrorCoverage");
    notes.push(`Evaluation Criteria Response Mirror (Section F) ${hasMirrorHeading ? "present" : "MISSING"}; ${weightCellMatches} weight cell(s), ${sectionPointerMatches} section pointer(s).`);
  }

  // 9. Win themes presence (0–10)
  // Section G (Win Themes & Discriminators) requires: heading + table with
  // Discriminator + Linked Evaluation Criterion columns, and at least one
  // framing paragraph. Themes without discriminator-vs-criterion mapping
  // are just marketing fluff.
  let winThemesPresence = 0;
  const themesHeadingRe = /(^|\n)\s*#{1,4}\s*(?:section\s*[G:.\-\s]*)?\s*(?:win\s+themes?|themes?\s+(?:and|&)\s+discriminators?)/i;
  const hasThemesHeading = themesHeadingRe.test(md);
  const discriminatorMentions = (md.match(/\bdiscriminator/gi) ?? []).length;
  const themeRowMatches = (md.match(/\|\s*[^|\n]{8,80}\s*\|\s*[^|\n]{12,160}\s*\|\s*[^|\n]{6,80}\s*\|/g) ?? []).length;
  if (hasThemesHeading) winThemesPresence += 5;
  if (discriminatorMentions >= 1) winThemesPresence += 2;
  if (themeRowMatches >= 2) winThemesPresence += 3;
  winThemesPresence = Math.min(10, winThemesPresence);
  if (winThemesPresence < 6) {
    weakAxes.push("winThemesPresence");
    notes.push(`Win Themes & Discriminators (Section G) ${hasThemesHeading ? "present" : "MISSING"}; ${discriminatorMentions} discriminator mention(s).`);
  }

  // 10. Self-score presence (0–10)
  // Section H (Proposal Self-Score) requires: heading + numeric scores
  // (X/10) + a "Predicted overall" or "Top three risks" closing line.
  // The self-score is what catches under-prepared submissions before
  // they reach the evaluator.
  let selfScorePresence = 0;
  const selfScoreHeadingRe = /(^|\n)\s*#{1,4}\s*(?:section\s*[H:.\-\s]*)?\s*(?:proposal\s+)?self.score/i;
  const hasSelfScoreHeading = selfScoreHeadingRe.test(md);
  const scoreCellMatches = (md.match(/\b(?:10|[0-9])\s*\/\s*10\b/g) ?? []).length;
  const overallScoreMatches = /(?:predicted\s+overall|overall\s+technical\s+score|top\s+three\s+risks?)/i.test(md);
  if (hasSelfScoreHeading) selfScorePresence += 4;
  if (scoreCellMatches >= 3) selfScorePresence += 3;
  if (overallScoreMatches) selfScorePresence += 3;
  selfScorePresence = Math.min(10, selfScorePresence);
  if (selfScorePresence < 6) {
    weakAxes.push("selfScorePresence");
    notes.push(`Proposal Self-Score (Section H) ${hasSelfScoreHeading ? "present" : "MISSING"}; ${scoreCellMatches} score cell(s); overall-score line ${overallScoreMatches ? "present" : "missing"}.`);
  }

  const axes = {
    structureCompleteness,
    evidenceDensity,
    tableCoverage,
    sectorVocabulary,
    throughlineConsistency,
    aiTraceFreedom,
    complianceMatrixCoverage,
    evaluatorMirrorCoverage,
    winThemesPresence,
    selfScorePresence,
  };
  // 10 axes × 10 max = 100 raw — the sum IS the percentage, no scaling needed.
  const total = axes.structureCompleteness + axes.evidenceDensity + axes.tableCoverage + axes.sectorVocabulary + axes.throughlineConsistency + axes.aiTraceFreedom + axes.complianceMatrixCoverage + axes.evaluatorMirrorCoverage + axes.winThemesPresence + axes.selfScorePresence;

  return { total, axes, weakAxes, notes };
}

export function formatQualityScoreSummary(score: QualityScore): string {
  const a = score.axes;
  const axes = `structure ${a.structureCompleteness}/10, evidence ${a.evidenceDensity}/10, tables ${a.tableCoverage}/10, vocabulary ${a.sectorVocabulary}/10, throughline ${a.throughlineConsistency}/10, ai-trace-free ${a.aiTraceFreedom}/10, compliance-matrix ${a.complianceMatrixCoverage}/10, evaluator-mirror ${a.evaluatorMirrorCoverage}/10, win-themes ${a.winThemesPresence}/10, self-score ${a.selfScorePresence}/10`;
  return `Quality score: ${score.total}/100 (${axes})${score.weakAxes.length > 0 ? `. Weak axes: ${score.weakAxes.join(", ")}` : ""}`;
}
