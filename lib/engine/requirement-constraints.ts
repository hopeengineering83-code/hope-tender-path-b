import type { RequirementDraft } from "./types";

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
  const roleSignals = ROLE_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.role);

  const expertFromQty = requirements
    .filter((r) => r.requirementType === "EXPERT")
    .map((r) => r.requiredQuantity ?? 0)
    .filter((n) => n > 0);
  const projectFromQty = requirements
    .filter((r) => r.requirementType === "PROJECT_EXPERIENCE")
    .map((r) => r.requiredQuantity ?? 0)
    .filter((n) => n > 0);

  const expertFromText = parseCount(text, "EXPERT");
  const projectFromText = parseCount(text, "PROJECT_EXPERIENCE");

  const expertCount = Math.max(expertFromText, expertFromQty.length > 0 ? Math.max(...expertFromQty) : 0, roleSignals.length > 0 ? roleSignals.length : 0);
  const projectCount = Math.max(projectFromText, projectFromQty.length > 0 ? Math.max(...projectFromQty) : 0);

  const domainTags = [
    /hospital|healthcare|medical|clinic/i.test(text) ? "healthcare" : null,
    /telecom|telecommunication|fiber|broadband|5g|4g/i.test(text) ? "telecom" : null,
    /ict|digital|software|platform|information\s+system/i.test(text) ? "ict" : null,
    /mining|extractive|quarry|mineral|ore/i.test(text) ? "mining" : null,
    /school|education|university|college/i.test(text) ? "education" : null,
  ].filter((v): v is string => Boolean(v));
  const strictDomainTags = [
    /(?:hospital|healthcare|medical|clinic).{0,48}(?:design|construction|planning|engineering|services?|consult(?:ancy|ing)|specialist)/i.test(text)
      || /(?:design|construction|planning|engineering|services?|consult(?:ancy|ing)|specialist).{0,48}(?:hospital|healthcare|medical|clinic)/i.test(text)
      ? "healthcare"
      : null,
    /(?:telecom|telecommunication|fiber|broadband|5g|4g).{0,48}(?:network|infrastructure|deployment|implementation|design|engineering|services?)/i.test(text)
      || /(?:network|infrastructure|deployment|implementation|design|engineering|services?).{0,48}(?:telecom|telecommunication|fiber|broadband|5g|4g)/i.test(text)
      ? "telecom"
      : null,
    /\bict\b|information\s+system|software\s+(?:development|implementation|integration|engineering|architecture)|digital\s+(?:transformation|solution|system|infrastructure)|platform\s+(?:development|implementation|integration|architecture|engineering)/i.test(text)
      ? "ict"
      : null,
    /(?:mining|extractive|quarry|mineral|ore).{0,48}(?:operations?|engineering|planning|processing|infrastructure|services?)/i.test(text)
      || /(?:operations?|engineering|planning|processing|infrastructure|services?).{0,48}(?:mining|extractive|quarry|mineral|ore)/i.test(text)
      ? "mining"
      : null,
    /(?:school|education|university|college).{0,48}(?:design|construction|planning|engineering|services?|program|infrastructure)/i.test(text)
      || /(?:design|construction|planning|engineering|services?|program|infrastructure).{0,48}(?:school|education|university|college)/i.test(text)
      ? "education"
      : null,
  ].filter((v): v is string => Boolean(v));
  const strictDomain = strictDomainTags.length > 0;

  return {
    expertCount,
    projectCount,
    roleSignals,
    strictDomain,
    domainTags,
  };
}
