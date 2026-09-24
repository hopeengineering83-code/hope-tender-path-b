import type { RequirementDraft } from "./types";
import { deriveDomainTags } from "./domain-signals";

export type RequirementConstraintProfile = {
  /**
   * The MINIMUM team size the requirements imply: the explicit count when the
   * tender states one, otherwise one person per role family it names. It is a
   * floor, never a cap. Selection reads `explicitExpertCount` for an exact
   * limit; see selectedLimit in ./matching.
   */
  expertCount: number;
  /** A head count the tender actually states ("minimum 5 key experts", requiredQuantity). 0 when it states none. */
  explicitExpertCount: number;
  projectCount: number;
  roleSignals: string[];
  strictDomain: boolean;
  domainTags: string[];
};

// One table, read two ways: `pattern` against the tender's requirement text
// (which roles does the tender ask for?) and `title` against an expert's own
// job title (which role does this person hold?). The title is the one field of
// an expert record that names the person's role; discipline and sector tags are
// often company-wide boilerplate copied onto every CV (measured: all 28 experts
// of one real vault carry "Architecture" and "Healthcare"), so they cannot say
// who the architect is.
const ROLE_PATTERNS: Array<{ role: string; pattern: RegExp; title: RegExp }> = [
  { role: "team_leader", pattern: /team\s+leader|project\s+manager|project\s+director/i, title: /team\s+leader|project\s+manager|project\s+director|project\s+principal|general\s+manager/i },
  { role: "architect", pattern: /architect|architectural/i, title: /architect/i },
  { role: "health_planner", pattern: /health\s+planner|hospital\s+planner|medical\s+planner/i, title: /health\s+planner|hospital\s+planner|medical\s+planner/i },
  { role: "biomedical", pattern: /biomedical|medical\s+equipment/i, title: /biomedical|medical\s+equipment/i },
  // MEP is three disciplines, not one: a team of two electrical engineers has
  // no plumbing engineer however well it "covers MEP". The acronym names all
  // three; a sanitary engineer is the plumbing discipline of a building team.
  { role: "electrical", pattern: /\bmep\b|electrical/i, title: /\bmep\b|electrical|electro-?mechanical/i },
  { role: "mechanical", pattern: /\bmep\b|mechanical|hvac|medical\s+gas/i, title: /\bmep\b|mechanical|hvac/i },
  { role: "plumbing", pattern: /\bmep\b|plumbing|sanitary/i, title: /\bmep\b|plumbing|sanitary/i },
  { role: "structural", pattern: /structural\s+engineer|structure\s+design/i, title: /structural/i },
  { role: "environmental", pattern: /environmental|esia|esmp/i, title: /environmental/i },
  { role: "geotechnical", pattern: /geotech|hydrogeolog|soil\s+investigation/i, title: /geotech|hydrogeolog/i },
  { role: "quantity_surveyor", pattern: /quantity\s+survey|bills?\s+of\s+quantit|\bboq\b|cost\s+estimat/i, title: /quantity\s+survey|cost\s+engineer|estimator/i },
  { role: "supervision", pattern: /resident\s+engineer|site\s+supervis|construction\s+supervis|supervis\w*\s+(?:of\s+)?(?:the\s+)?(?:\w+\s+)?works/i, title: /resident\s+engineer|site\s+engineer|supervis|construction\s+management/i },
];

/**
 * Whether a person's own job title states a role keyword ("architect",
 * "manager", "qs"). This is the only field a proposal may read when it names
 * somebody to a role: a delivered proposal called a Senior Electrical Engineer
 * its "Lead Architect" and an environmental expert its "Senior Healthcare
 * Architect" because the match read the firm-wide "Architecture" tag on every
 * CV. The keyword must start a word, so "pm" does not match "equipment".
 */
export function titleStatesRole(title: string | null | undefined, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}`, "i").test(String(title ?? ""));
}

/** The role families a person's own job title names (see ROLE_PATTERNS). */
export function expertTitleRoles(title: string | null | undefined): string[] {
  const text = String(title ?? "");
  if (!text.trim()) return [];
  return ROLE_PATTERNS.filter((entry) => entry.title.test(text)).map((entry) => entry.role);
}

function normalizeRequirementType(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase();
}

function parseCount(text: string, type: "EXPERT" | "PROJECT_EXPERIENCE"): number {
  const patterns = type === "EXPERT"
    ? [
      /(?:minimum|at\s+least|not\s+less\s+than|required)\s*(?:of\s+)?(\d{1,2})\s*(?:key\s+)?(?:experts?|specialists?|personnel|staff)\b/i,
      /(\d{1,2})\s*(?:key\s+)?(?:experts?|specialists?|personnel|staff)\b/i,
    ]
    : [
      /(?:minimum|at\s+least|not\s+less\s+than|required)\s*(?:of\s+)?(\d{1,2})\s*(?:similar\s+)?(?:[a-z]+\s+){0,3}?(?:projects?|assignments?|references?)\b/i,
      /(\d{1,2})\s*(?:similar\s+)?(?:[a-z]+\s+){0,3}?(?:projects?|assignments?|references?)\b/i,
    ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function deriveRequirementConstraintProfile(requirements: RequirementDraft[]): RequirementConstraintProfile {
  const text = requirements.map((r) => `${r.title} ${r.description}`).join("\n");
  const nonDomainRequirementTypes = new Set(["GENERAL", "COMPLIANCE", "FORM", "ANNEX", "SCHEDULE", "DECLARATION", "FORMAT", "SUBMISSION_RULE"]);
  const domainScopedText = requirements
    .filter((r) => !nonDomainRequirementTypes.has(normalizeRequirementType(r.requirementType)))
    .map((r) => `${r.title} ${r.description}`)
    .join("\n");
  const domainText = domainScopedText.trim().length > 0 ? domainScopedText : text;
  const roleSignals = ROLE_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.role);

  const expertFromQty = requirements
    .filter((r) => normalizeRequirementType(r.requirementType) === "EXPERT")
    .map((r) => r.requiredQuantity ?? 0)
    .filter((n) => n > 0);
  const projectFromQty = requirements
    .filter((r) => normalizeRequirementType(r.requirementType) === "PROJECT_EXPERIENCE")
    .map((r) => r.requiredQuantity ?? 0)
    .filter((n) => n > 0);

  const expertFromText = parseCount(text, "EXPERT");
  const projectFromText = parseCount(text, "PROJECT_EXPERIENCE");

  const explicitExpertCount = Math.max(expertFromText, expertFromQty.length > 0 ? Math.max(...expertFromQty) : 0);
  // Role families are a floor, not a head count. "Architects, engineers, a
  // biomedical engineer, MEP experts and other relevant specialists" names
  // three families and asks for more than three people; reading it as exactly
  // three fielded a three-person team from a 28-expert vault.
  const expertCount = Math.max(explicitExpertCount, roleSignals.length);
  const projectCount = Math.max(projectFromText, projectFromQty.length > 0 ? Math.max(...projectFromQty) : 0);

  // Domain signals live in ./domain-signals so this derivation and the matcher
  // that scores records against the result cannot drift apart. They did: the
  // two tables disagreed, and an unanchored "ore" tagged a borehole water
  // tender as mining, hard-excluding every water expert.
  const domainTags = deriveDomainTags(domainText);
  const strictDomain = domainTags.length > 0;

  return {
    expertCount,
    explicitExpertCount,
    projectCount,
    roleSignals,
    strictDomain,
    domainTags,
  };
}
