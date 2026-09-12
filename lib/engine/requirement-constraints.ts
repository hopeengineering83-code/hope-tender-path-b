import type { RequirementDraft } from "./types";
import { deriveDomainTags } from "./domain-signals";

export type RequirementConstraintProfile = {
  expertCount: number;
  projectCount: number;
  roleSignals: string[];
  strictDomain: boolean;
  domainTags: string[];
};

const ROLE_PATTERNS: Array<{ role: string; pattern: RegExp }> = [
  { role: "team_leader", pattern: /team\s+leader|project\s+manager/i },
  { role: "architect", pattern: /architect|architectural/i },
  { role: "health_planner", pattern: /health\s+planner|hospital\s+planner|medical\s+planner/i },
  { role: "biomedical", pattern: /biomedical|medical\s+equipment/i },
  { role: "mep", pattern: /mep|electrical|mechanical|hvac|medical\s+gas/i },
  { role: "structural", pattern: /structural\s+engineer|structure\s+design/i },
  { role: "environmental", pattern: /environmental|esia|esmp/i },
  { role: "geotechnical", pattern: /geotech|hydrogeolog|soil\s+investigation/i },
];

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

  const expertCount = Math.max(expertFromText, expertFromQty.length > 0 ? Math.max(...expertFromQty) : 0, roleSignals.length > 0 ? roleSignals.length : 0);
  const projectCount = Math.max(projectFromText, projectFromQty.length > 0 ? Math.max(...projectFromQty) : 0);

  // Domain signals live in ./domain-signals so this derivation and the matcher
  // that scores records against the result cannot drift apart. They did: the
  // two tables disagreed, and an unanchored "ore" tagged a borehole water
  // tender as mining, hard-excluding every water expert.
  const domainTags = deriveDomainTags(domainText);
  const strictDomain = domainTags.length > 0;

  return {
    expertCount,
    projectCount,
    roleSignals,
    strictDomain,
    domainTags,
  };
}
