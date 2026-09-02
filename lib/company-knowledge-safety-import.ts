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
  trustLevel: "REGEX_DRAFT" | "AI_DRAFT" | "SOURCE_VERIFIED" | "REVIEWED";
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
  trustLevel: "REGEX_DRAFT" | "AI_DRAFT" | "SOURCE_VERIFIED" | "REVIEWED";
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
  // A qualifier commonly sits between "years" and "experience" — "13 years
  // ESIA experience", "15 years design experience", "8 years site experience".
  // Requiring only "professional" as the optional word missed those, and a
  // missing value is a person whose stated experience the app cannot see.
  // Bounded to two short words so it cannot run across a sentence.
  const values = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs|year)\s+(?:of\s+)?(?:[A-Za-z][\w-]{0,14}\s+){0,2}experience/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 70);
  return values.length ? Math.max(...values) : null;
}

function parseTitle(text: string): string | null {
  const patterns = [
    // \b on both sides: without the trailing boundary "Profession" matched
    // inside "professional", so "22 years professional experience in water
    // supply…" was stored as a named person's job title — "al experience in
    // water supply and municipal infrastructure. Registered".
    /\b(?:Proposed\s+Position|Position|Title|Profession)\b\s*[:\-]?\s*([^\n\r:]{3,120})/i,
    // Same role list the name-then-role pattern in extractExpertNames uses.
    // The two disagreeing left a person the extractor found by their role
    // ("Senior Water Supply Engineer") with no title at all.
    /\b(Architect|Urban Planner|Civil Engineer|Structural Engineer|Electrical Engineer|Mechanical Engineer|Sanitary Engineer|Water Supply Engineer|Project Manager|Team Leader|Quantity Surveyor|Surveyor|Geotechnical Engineer)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/\s+(Name|Date|Nationality|Education).*$/i, "").slice(0, 120);
  }
  return null;
}

function normalizeName(value: string): string {
  return clean(value)
    // Same set the extractor matches, or a title it recognises rides along
    // into the stored name — "ARCH. DANIEL WOLDU" instead of "DANIEL WOLDU".
    .replace(/^(Mr|Ms|Mrs|Dr|Eng|Ing|Prof|Arch)\.?\s+/i, "")
    .replace(/[,;].*$/, "")
    .replace(/\s+(Nationality|Country|Date|Birth|Education|Position|Profession|Experience|Phone|Email).*$/i, "")
    .slice(0, 90);
}

const NON_NAME_WORDS = new Set([
  "bank", "world", "corporation", "ministry", "authority", "agency", "institute", "association", "foundation", "group", "company", "limited", "international", "national", "federal", "regional", "municipal", "university", "college", "hospital", "consulting", "consultant", "services", "development", "bureau", "office", "department", "south", "north", "east", "west", "central", "city", "district", "zone", "region", "province", "state", "water", "supply", "road", "bridge", "dam", "power", "energy", "solar", "housing", "construction", "building", "project", "scheme", "phase", "industrial", "commercial", "residential", "mixed", "urban", "rural", "architecture", "engineering", "design", "planning", "survey", "management", "senior", "junior", "principal", "chief", "lead", "head", "associate", "assistant", "deputy", "registered", "certified", "licensed",
  // ── Words that mark an ORGANISATION, an AMOUNT, or a document label ──────
  //
  // Added after ingesting a real company authority export: 28 real experts
  // came back as 51, and the extra ~23 were not people. Every one came out of
  // genuine CV text, so no document-category filter could have stopped them:
  //
  //   "Hope Consultancy PLC"   "General Business PLC"  "Ethiopian Heritage Trust"
  //   "Million ETB"            "Billion ETB"           "ARCHITECTURAL AND"
  //   "Professional Reg."      "License Practicing"    "of Firm"
  //
  // They reached the vault as SOURCE_VERIFIED experts, which means automatic
  // matching could select them and a generated proposal could name a currency
  // fragment as a proposed team member. Fabricated people presented as
  // source-verified evidence is the failure this project's provenance rules
  // exist to prevent, and it silently caps evidence specificity and
  // expert-to-role mapping in every proposal built from this vault.
  //
  // These are generic entity/label markers, not geography and not
  // client-specific: no real person's name contains them, and the 28 genuine
  // names in that export are unaffected (measured, not assumed).
  "plc", "ltd", "llc", "inc", "corp", "trust", "enterprise", "enterprises", "holdings", "trading", "hotel", "business", "brothers", "firm", "consultancy", "consult", "general", "government", "permit", "control", "architectural",
  "practicing", "practising", "licence", "license", "registration", "reg", "curriculum", "vitae", "page", "tel", "fax", "email", "ref", "professional", "profession",
  "million", "billion", "thousand", "etb", "usd", "eur", "gbp", "birr",
  // Conjunctions and prepositions: a capitalised fragment carrying one is a
  // clipped line of prose ("ARCHITECTURAL AND", "of Firm"), never a name.
  "and", "or", "of", "the", "for",
  // Table column vocabulary. A reference table's header can reach the person
  // extractor too — "CLIENT ELECTRICAL" was filed as an expert — and the same
  // words never appear in someone's name.
  "client", "owner", "value", "activities", "performed", "material", "remark", "remarks", "status", "item", "qty", "quantity", "duration",
]);

function looksLikePersonName(name: string): boolean {
  if (!name || name.length < 5 || name.length > 90) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 &&
    words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word)) &&
    // Trailing punctuation is stripped before the lookup so an abbreviation
    // cannot slip past it: "Reg." must be rejected exactly as "reg" is.
    !words.some((word) => NON_NAME_WORDS.has(word.toLocaleLowerCase("en-US").replace(/[.'-]+$/, "")));
}

function snippetAround(text: string, needle: string, radius = 1200): string {
  const index = text.toLocaleLowerCase("en-US").indexOf(needle.toLocaleLowerCase("en-US"));
  if (index < 0) return clean(text.slice(0, radius));
  return clean(text.slice(Math.max(0, index - 240), Math.min(text.length, index + radius)));
}

/**
 * The part of a document that belongs to ONE named entry — a person in a
 * CV, a project in a reference list.
 *
 * A fixed radius around the name spans neighbouring entries — a 1200-character
 * window over a three-CV document reaches well into the next person's — so
 * every expert inherited the others' title, years, disciplines and sectors.
 * Attributes of a named individual, taken from a different individual's text,
 * in records that are matched against a tender and can be promoted into a
 * submission: values about a real person that the source does not support.
 *
 * The block therefore runs from this person's name to wherever the next one
 * starts, and only falls back to the radius window when no later name bounds
 * it. `others` are the remaining names extracted from the same document.
 */
/**
 * Find a name in the source even when the PDF wrapped it across lines.
 *
 * entryBlock located a record by plain indexOf, which works only while the
 * name appears contiguously. Recovered wrapped titles never do: the stored
 * name is "Entoto Eco-Park Master Planning & Feasibility" while the source
 * reads "Entoto Eco-Park Master\nPlanning & Feasibility". The lookup failed,
 * every such record fell back to the same opening window of the document, and
 * they all inherited whichever sectors happened to be described there.
 *
 * That is not cosmetic. A hotel that inherits "Healthcare" from a neighbouring
 * hospital entry scores as a healthcare comparable — measured, hotels reached
 * 1.000 against this tender while the real hospitals sat at 0.950 — so the
 * comparable-projects table of a medical-centre proposal would lead with
 * hotels. The capability scorer is not at fault: on the name alone it ranks
 * hotels 0.000-0.103 and hospitals highest, exactly as designed.
 *
 * Matching on the name's words in sequence, tolerating any whitespace between
 * them, restores the true position.
 */
function locateName(text: string, name: string): number {
  const direct = text.toLocaleLowerCase("en-US").indexOf(name.toLocaleLowerCase("en-US"));
  if (direct >= 0) return direct;
  const words = name.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return -1;
  return text.search(new RegExp(words.join("\\s+"), "i"));
}

function entryBlock(text: string, name: string, others: string[]): string {
  const start = locateName(text, name);
  if (start < 0) return snippetAround(text, name);
  // Begin slightly before the name so an honorific or heading on the same
  // line stays with the person it belongs to.
  const from = Math.max(0, text.lastIndexOf("\n", start) + 1);
  let to = text.length;
  for (const other of others) {
    if (other === name) continue;
    // Same whitespace tolerance for the boundary scan, so a wrapped
    // neighbour still bounds this record instead of being invisible.
    const tail = text.slice(start + name.length);
    const rel = locateName(tail, other);
    const at = rel < 0 ? -1 : start + name.length + rel;
    if (at > start && at < to) to = at;
  }
  const block = text.slice(from, Math.min(to, from + 1200));
  return clean(block.length >= 20 ? block : text.slice(from, Math.min(text.length, from + 1200)));
}

function extractExpertNames(text: string): string[] {
  const names = new Set<string>();
  // Every name capture below uses [ \t]+ between words, not \s+: a person's
  // name sits on one line, and \s+ crossed the line break to swallow the next
  // line's first capitalised word — "Eng. Abebe Tesfaye" followed by "Twenty
  // two years of experience" was filed as the person "Abebe Tesfaye Twenty".
  const patterns = [
    /(?:Full\s+Name|Name\s+of\s+(?:Expert|Key\s+Staff|Personnel|Staff)|Expert\s+Name|Name)\s*[:\-]?\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,4})/gi,
    // The honorific is matched in either case; the NAME capture stays
    // case-sensitive so the `i` flag cannot loosen it into ordinary prose.
    //
    // "ENG. ABEBE TESFAYE" — the way a CV actually writes it — matched
    // nothing, because only the title-case "Eng." was listed. A vault CV
    // document therefore yielded zero deterministic experts while the same
    // ingestion found projects, and the tender blocked on
    // NO_SELECTED_REVIEWED_EXPERTS with the evidence sitting in the vault.
    // normalizeName below already stripped honorifics case-insensitively, so
    // the module knew they arrive in any case; only the extractor did not.
    /(?:Mr|Ms|Mrs|Dr|Eng|Ing|Prof|Arch|MR|MS|MRS|DR|ENG|ING|PROF|ARCH)\.?\s+([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,4})/g,
    // A role usually follows the name across a separator — "Abebe Tesfaye —
    // Team Leader", "Daniel Woldu | Senior Architect", "Meron Gebrehiwot,
    // Civil Engineer" — not immediately after it. Requiring adjacency missed
    // every one of those and left this pattern matching only running prose.
    // An optional qualifier ("Senior", "Lead", "Principal"…) is allowed
    // between the separator and the role for the same reason.
    /([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,2})\s*(?:[\u2013\u2014|:,-]\s*)?(?:(?:Senior|Lead|Principal|Chief|Deputy|Assistant)\s+)?(?:Architect|Urban Planner|Civil Engineer|Structural Engineer|Electrical Engineer|Mechanical Engineer|Sanitary Engineer|Water Supply Engineer|Project Manager|Team Leader|Quantity Surveyor|Surveyor|Geotechnical Engineer)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = normalizeName(match[1]);
      if (!looksLikePersonName(name)) continue;
      if (namedAsOrganisationOrPlace(text, match.index ?? 0)) continue;
      names.add(name);
    }
  }
  return [...names].slice(0, 150);
}

/**
 * Capitalised words introduced by "… of" are the tail of an organisation or a
 * place, not a person.
 *
 * A real CV listed the engineer's registering authority as
 *
 *   City Government of
 *   Addis Ababa
 *   Construction Permit & Control Office
 *
 * and "Addis Ababa" was filed as an expert, because the loose name-then-role
 * pattern allows the role to sit on the following line — which is how CVs
 * genuinely lay out a person's name and title, so that latitude cannot simply
 * be removed without losing real people.
 *
 * The connector is the tell, and it is generic: "Government of", "City of",
 * "University of", "Ministry of", "Republic of", "Office of", "Bureau of".
 * No geography is hard-coded here; a place name is recognised by what
 * introduces it, not by being on a list of places.
 *
 * A labelled location field is the same tell in shorter form. A portfolio row
 * inside a CV reads
 *
 *   Entoto Eco-Park Project Client: EHT
 *   Loc: Addis Ababa
 *   Senior Sanitary Engineer:
 *
 * so the city sits between a location label and a role and was filed as a
 * person. "Loc:", "Location:", "Site:", "Address:", "City:" introduce a place,
 * never a member of staff.
 */
function namedAsOrganisationOrPlace(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
  return /\b(?:government|city|town|university|college|ministry|republic|office|bureau|authority|department|institute|state|region)\s+of\s*$/i.test(before)
    || /\b(?:loc|location|site|address|city|place|region|country|zone|woreda|kebele)\s*[:\-]\s*$/i.test(before);
}

/**
 * Column headings are not projects.
 *
 * A real portfolio export produced 18 project records of which 17 were table
 * headings lifted out of a reference table — "CLIENT / TYPE ELECTRICAL",
 * "LOCATION/VALUE ACTIVITIES PERFORMED", "CLIENT/LOCATION KEY MATERIAL",
 * "/ DESCRIPTION TYPE POSITION & ACTIVITIES PERFORMED". They were written to
 * the vault and auto-verified, so matching could select a column heading as a
 * comparable project and a generated proposal could cite it as experience.
 *
 * A heading is recognised by what it is made of: strip the table-label
 * vocabulary and the separators, and nothing identifying remains. A real
 * project name always carries something else — a place, a client, a facility,
 * a number of units.
 */
const TABLE_LABEL_WORDS = /\b(client|owner|location|country|region|value|type|role|position|activities|performed|description|key|material|scope|services|contract|budget|period|year|no|ref|date|status|remark|remarks|duration|cost|qty|quantity|unit|item|s\.?n|sr)\b/gi;

/**
 * A project name never opens with money.
 *
 * Recovering wrapped names also reaches the employment tables inside CVs,
 * where a row begins with the contract value and continues into the role:
 * "Million ETB Project Coordinator - Hospital renovation…". That is a job
 * held by a person, not a project the firm delivered, and citing it as
 * comparable experience would misrepresent the portfolio.
 */
function startsWithAmount(name: string): boolean {
  return /^\s*(?:[\d.,]+\s*)?(?:million|billion|thousand|ETB|USD|EUR|GBP|Birr)\b/i.test(name);
}

function looksLikeTableHeading(name: string): boolean {
  const residue = name
    .replace(TABLE_LABEL_WORDS, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  // Nothing but label vocabulary and punctuation was there.
  if (residue.length === 0) return true;
  // A lone stray token ("ELECTRICAL") is a column qualifier, not a project.
  return residue.split(/\s+/).filter(Boolean).length < 2 && residue.length < 14;
}

/**
 * A captured attribute that is really the table's column-header run.
 *
 * `looksLikeTableHeading` guards project NAMES, but the same header line also
 * reaches the attribute captures below, and there it survives: after the label
 * vocabulary is stripped the caption text ("with Area & Full Address",
 * "Testimony", "Supporting Doc") leaves a long residue, so the name-level
 * guard passes it. Measured on a real portfolio export, 187 project rows
 * stored
 *
 *   "/Location (with Area & Full Address) Testimony Details (Ref No, Date,
 *    Author) Project Cost Details Project Duration Comprehensive Service
 *    Details Supporting Doc"
 *
 * as the CLIENT (and its tail as the COUNTRY), because the header reads
 * "Client/Location (with Area …" and the Client capture ran into the next
 * column. Those rows were then auto-verified, so a generated proposal cited
 * "Approach demonstrated on Dessie Specialized Hospital (/Location (with Area
 * & Full Address) …)" to the evaluator.
 *
 * A client or a country is one name. A line that enumerates three or more
 * column labels is the header of the table those names live in — that is the
 * distinction, and it needs no vocabulary specific to any one export.
 */
function looksLikeColumnHeaderRun(value: string): boolean {
  const labels = value.match(TABLE_LABEL_WORDS);
  return (labels?.length ?? 0) >= 3;
}

/** Drop a captured attribute that is a column-header run rather than a value. */
function attributeOrNull(value: string | null): string | null {
  if (!value) return null;
  return looksLikeColumnHeaderRun(value) ? null : value;
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
      if (name.length >= 8 && /[A-Za-z]/.test(name) && !looksLikeTableHeading(name) && !startsWithAmount(name)) names.add(name);
    }
  }
  for (const name of wrappedProjectNames(text)) {
    if (name.length >= 8 && /[A-Za-z]/.test(name) && !looksLikeTableHeading(name) && !startsWithAmount(name)) names.add(name);
  }
  return [...names].slice(0, 250);
}

/**
 * Project names that a PDF wrapped across lines.
 *
 * The patterns above require the whole name to sit on ONE line. Extracted PDF
 * text does not oblige: a reference table wraps mid-title, so a real portfolio
 * reads
 *
 *   1 Entoto Eco-Park Master
 *   Planning & Feasibility /
 *   Ethiopian Heritage Trust
 *
 * and the single-line patterns matched none of it. Measured against a real
 * company export, they recovered 0 of 114 project names while filing 17 table
 * headings as projects — so comparable-project evidence was simultaneously
 * empty and contaminated, which caps evidence specificity and
 * comparable-project relevance in every proposal built from that vault
 * regardless of how well the writer performs.
 *
 * Continuation lines are joined until the entry's own delimiter — these tables
 * separate the title from the client with " / " — and never across a line that
 * starts a labelled field, so one entry cannot absorb the next. The same
 * heading guard still applies to the result. Recovery on that export: 114/114.
 */
function wrappedProjectNames(text: string): string[] {
  const WRAPPED = /(?:^|\n)\s*\d{1,3}\s+([A-Z][^\n]{2,120}(?:\n(?![ \t]*(?:Ref:|Budget:|Client|Date:|Testimony|Constr\.?:|Design:))[^\n]{1,120}){0,3})/g;
  const out: string[] = [];
  for (const match of text.matchAll(WRAPPED)) {
    const joined = clean((match[1] ?? "").replace(/\n+/g, " "));
    const name = joined.split(/\s\/\s|\s\/$/)[0].replace(/[,;\s]+$/, "").slice(0, 180);
    if (name) out.push(name);
  }
  return out;
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
      const allNames = extractExpertNames(text);
      for (const fullName of allNames) {
        // Bounded to this person's own entry, so no attribute is read from a
        // neighbouring CV.
        const snippet = entryBlock(text, fullName, allNames);
        experts.push({
          fullName,
          title: parseTitle(snippet),
          yearsExperience: parseYears(snippet),
          disciplines: inferServices(snippet),
          sectors: inferSectors(snippet),
          certifications: inferCertifications(snippet),
          // The person's own text, not a description of the extractor. The
          // previous value — "Deterministic extraction from <file>." — carried
          // none of the CV, so the tender matcher (which reads fullName,
          // title, profile, disciplines, sectors, certifications) scored every
          // extracted expert 0, selected none, and the tender blocked on
          // NO_SELECTED_REVIEWED_EXPERTS with the evidence sitting in the
          // vault. The document is still named, after the content rather than
          // instead of it.
          profile: `${snippet}\n\nSource: ${document.originalFileName}.`.slice(0, 4000),
          sourceSnippet: snippet,
          sourceDocumentId: document.id,
          sourceAuthority: expertAuthority,
          trustLevel: "REGEX_DRAFT",
        });
      }
    }

    const projectAuthority = projectCapability(document);
    if (projectAuthority > 0) {
      const allProjectNames = extractProjectNames(text);
      for (const name of allProjectNames) {
        // Bounded to this project's own entry, for the same reason experts
        // are: a fixed window spans the next project and mixes the two.
        const snippet = entryBlock(text, name, allProjectNames);
        const financial = parseContractValue(snippet);
        const sectors = inferSectors(snippet);
        projects.push({
          name,
          // Stops at the end of the client, not 160 characters later. The
          // open-ended capture ran straight through the sentence boundary and
          // stored "Hawassa City Administration. Contract value: ETB
          // 12,750,000." as the CLIENT — which then printed a contract value
          // into a technical-envelope document, the one thing a technical
          // envelope must never carry.
          clientName: attributeOrNull(firstMatch(snippet, [/Client\s*[:\-]?\s*([^\n\r.;]{3,160})/i, /Owner\s*[:\-]?\s*([^\n\r.;]{3,160})/i])),
          country: attributeOrNull(firstMatch(snippet, [/Country\s*[:\-]?\s*([^\n\r.;]{3,80})/i, /Location\s*[:\-]?\s*([^\n\r.;]{3,120})/i])),
          sector: sectors[0] ?? null,
          serviceAreas: inferServices(snippet),
          // The project's own entry, not a description of the extractor —
          // same reason as the expert profile: the tender matcher scores this
          // field, and a self-reference gives it nothing to score.
          summary: `${snippet}\n\nSource: ${document.originalFileName}.`.slice(0, 4000),
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

/**
 * Enrichment, not replacement.
 *
 * A record that already exists is updated from the heuristic pass, and the
 * update wrote every scalar unconditionally — so a pass that simply did not
 * find a client erased the one already stored. On a real authority export
 * declaring a client for 107 of its 114 projects, five survived: the header-run
 * guard correctly refused the table caption the extractor had been capturing,
 * and `clientName: null` then overwrote the canonical value. Before that guard
 * the same write replaced the canonical client with the caption, which is how
 * "Approach demonstrated on <hospital> (/Location (with Area & Full Address)
 * ...)" reached a client proposal. Both are the same defect: a weaker source
 * overwriting a stronger one.
 *
 * So: a blank never overwrites a stored value, and when the company's
 * identities are owned by a structured authority (authorityOwned), a stored
 * value is not replaced at all — the heuristic pass fills blanks and earns
 * provenance, which is exactly what "verify and enrich" means. An ordinary
 * unstructured vault keeps refresh-on-re-extraction, because there the
 * heuristic IS the source.
 */
function enrich<T>(candidateValue: T, storedValue: T, authorityOwned: boolean): T {
  const blank = candidateValue === null || candidateValue === undefined || candidateValue === "";
  const stored = storedValue !== null && storedValue !== undefined && storedValue !== "";
  if (blank && stored) return storedValue;
  if (authorityOwned && stored) return storedValue;
  return candidateValue;
}

/**
 * The same rule for the JSON-array columns.
 *
 * `enrich` cannot serve these: they are stored as JSON text, so an empty list
 * arrives as the non-empty string "[]" and reads as a value worth writing.
 * Measured on the real authority export through the real routes — structured
 * import, then the VAULT_INGEST worker — the scalar rule held (title 0,
 * yearsExperience 0, and every project field 0 lost) while the two list
 * columns did not:
 *
 *   experts whose stored value lost content vs the export:
 *     sectors 23 of 28, disciplines 25 of 28
 *
 * That is what emptied expert relevance. The export declares Healthcare among
 * the sectors of 22 of its 28 experts; after ingestion 5 still had it, 8 had no
 * sectors at all and 7 no disciplines. Expert matching scores exactly these
 * fields, so a hospital tender then found almost nothing to select — the vault
 * looked as if it had no healthcare people, when it had 22.
 */
function enrichList(candidateValue: string[], storedJson: string | null | undefined, authorityOwned: boolean): string {
  const stored = ((): string[] => {
    try {
      const parsed = JSON.parse(storedJson ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  })();
  if (stored.length === 0) return JSON.stringify(candidateValue);
  if (candidateValue.length === 0 || authorityOwned) return JSON.stringify(stored);
  return JSON.stringify(candidateValue);
}

async function persistOnce(
  client: PrismaClient,
  companyId: string,
  candidates: CompanyKnowledgeCandidates,
  options: { allowNewIdentities?: boolean } = {},
): Promise<Pick<SafetyImportResult, "expertsCreated" | "projectsCreated" | "expertsUpdated" | "projectsUpdated">> {
  const allowNewIdentities = options.allowNewIdentities !== false;
  // Identities owned by a structured authority: the same signal that stops new
  // records being minted also makes the stored attributes canonical, so the
  // heuristic pass fills blanks instead of replacing them.
  const authorityOwned = !allowNewIdentities;
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
        select: {
          id: true, trustLevel: true, title: true, yearsExperience: true,
          disciplines: true, sectors: true, certifications: true,
          sourceDocument: { select: { category: true } },
        },
      });
      if (existing?.trustLevel === "REVIEWED") continue;
      if (existing && sourceAuthority(existing.sourceDocument?.category, "EXPERT") > candidate.sourceAuthority) continue;

      const data = {
        fullName: candidate.fullName,
        title: enrich(candidate.title, existing?.title ?? null, authorityOwned),
        yearsExperience: enrich(candidate.yearsExperience, existing?.yearsExperience ?? null, authorityOwned),
        disciplines: enrichList(candidate.disciplines, existing?.disciplines, authorityOwned),
        sectors: enrichList(candidate.sectors, existing?.sectors, authorityOwned),
        certifications: enrichList(candidate.certifications, existing?.certifications, authorityOwned),
        profile: `[${candidate.trustLevel} — AUTOMATIC SOURCE VERIFICATION PENDING]\n\n${candidate.profile}\n\nSource snippet:\n${candidate.sourceSnippet}`,
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
        if (!allowNewIdentities) continue;
        await tx.expert.create({ data: { companyId, ...data } });
        expertsCreated += 1;
      }
    }

    for (const candidate of projectByKey.values()) {
      const existing = await tx.project.findFirst({
        where: { companyId, name: { equals: candidate.name, mode: "insensitive" }, deletedAt: null },
        select: {
          id: true, trustLevel: true, clientName: true, country: true, sector: true,
          serviceAreas: true, contractValue: true, currency: true,
          sourceDocument: { select: { category: true } },
        },
      });
      if (existing?.trustLevel === "REVIEWED") continue;
      if (existing && sourceAuthority(existing.sourceDocument?.category, "PROJECT") > candidate.sourceAuthority) continue;

      const data = {
        name: candidate.name,
        clientName: enrich(candidate.clientName, existing?.clientName ?? null, authorityOwned),
        country: enrich(candidate.country, existing?.country ?? null, authorityOwned),
        sector: enrich(candidate.sector, existing?.sector ?? null, authorityOwned),
        serviceAreas: enrichList(candidate.serviceAreas, existing?.serviceAreas, authorityOwned),
        summary: `[${candidate.trustLevel} — AUTOMATIC SOURCE VERIFICATION PENDING]\n\n${candidate.summary}\n\nSource snippet:\n${candidate.sourceSnippet}`,
        contractValue: enrich(candidate.contractValue, existing?.contractValue ?? null, authorityOwned),
        currency: enrich(candidate.currency, existing?.currency ?? null, authorityOwned),
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
        if (!allowNewIdentities) continue;
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
  options: { allowNewIdentities?: boolean } = {},
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await persistOnce(client, companyId, candidates, options);
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

  // A company whose knowledge came from a STRUCTURED authority import already
  // states its own expert and project identities. Heuristic extraction may
  // still verify and enrich those records from the uploaded source text — that
  // is how they earn provenance — but it must not mint NEW canonical
  // identities beside them.
  //
  // Measured on a real authority export (28 experts, 114 projects): letting
  // the heuristic create as well turned that into 35 and 177, adding clients
  // ("Dr Abdul Seid", who owns a hospital in a project row), places
  // ("Addis Ababa", from "Loc:" above a role line), partial aliases
  // ("Asamenew Alye" beside the canonical "Asamenew Alye Mohammed") and table
  // fragments — each then auto-verified to SOURCE_VERIFIED, so automatic
  // matching could select a client or a city as proposed HAEC staff.
  //
  // The marker is PlanBStaging, which the structured route writes for every
  // source document it accepts. It is durable, already in the schema, and
  // carries no counts or names, so nothing here is specific to one export.
  // A company that never used the structured route is unaffected: ordinary
  // unstructured uploads keep full heuristic extraction, which is what it is
  // for.
  const structuredAuthorityRows = await client.planBStaging.count({ where: { companyId } });
  const persisted = await persistCompanyKnowledgeCandidates(client, companyId, candidates, {
    allowNewIdentities: structuredAuthorityRows === 0,
  });
  return {
    docsScanned: documents.length,
    ...persisted,
    expertNamesDetected: candidates.experts.length,
    projectNamesDetected: candidates.projects.length,
  };
}
