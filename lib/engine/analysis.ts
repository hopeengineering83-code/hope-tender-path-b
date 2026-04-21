import { RequirementPriority, RequirementType } from "@prisma/client";
import type { AnalysisResult, RequirementDraft, TenderWithFiles } from "./types";

const sentenceSplit = /\n+|(?<=[.!?])\s+/g;

function inferPriority(text: string) {
  return /(must|mandatory|required|shall|attach|exact)/i.test(text)
    ? RequirementPriority.MANDATORY
    : /(score|weighted|points|evaluation)/i.test(text)
      ? RequirementPriority.SCORED
      : RequirementPriority.INFORMATIONAL;
}

function inferType(text: string) {
  if (/expert|key personnel|team leader|specialist/i.test(text)) return RequirementType.EXPERT;
  if (/project reference|similar experience|completed project|experience/i.test(text)) return RequirementType.PROJECT_EXPERIENCE;
  if (/declaration|undertaking|statement/i.test(text)) return RequirementType.DECLARATION;
  if (/annex/i.test(text)) return RequirementType.ANNEX;
  if (/schedule/i.test(text)) return RequirementType.SCHEDULE;
  if (/form|template/i.test(text)) return RequirementType.FORM;
  if (/financial|turnover|audit/i.test(text)) return RequirementType.FINANCIAL;
  if (/eligib|registration|certificate|license/i.test(text)) return RequirementType.ELIGIBILITY;
  if (/page limit|font|format|pdf|docx|naming|order/i.test(text)) return RequirementType.FORMAT;
  if (/submission|upload|portal|deadline|sealed/i.test(text)) return RequirementType.SUBMISSION_RULE;
  return RequirementType.TECHNICAL;
}

function inferQuantity(text: string) {
  const match = text.match(/(\d+)\s+(experts?|specialists?|projects?|references?|forms?|annexes?)/i);
  return match ? Number(match[1]) : null;
}

function inferFileName(text: string) {
  const quoted = text.match(/["“](.+?)["”]/);
  if (quoted) return quoted[1];
  const explicit = text.match(/file name\s*[:\-]\s*([A-Za-z0-9 _.-]+)/i);
  return explicit ? explicit[1].trim() : null;
}

function normalizeRequirement(line: string, index: number): RequirementDraft | null {
  const text = line.trim().replace(/^[-*\d.)\s]+/, "");
  if (text.length < 12) return null;

  const type = inferType(text);
  const priority = inferPriority(text);
  const quantity = inferQuantity(text);
  const exactFileName = inferFileName(text);

  return {
    title: `Requirement ${index + 1}`,
    description: text,
    requirementType: type,
    priority,
    requiredQuantity: quantity,
    exactFileName,
    restrictions: /(page limit|font|signature|stamp|letterhead|branding)/i.test(text) ? text : null,
  };
}

export function analyzeTender(tender: TenderWithFiles): AnalysisResult {
  const rawSource = [tender.intakeSummary, tender.description, ...tender.files.map((file) => `${file.originalFileName} ${file.classification ?? ""}`)]
    .filter(Boolean)
    .join("\n");

  const lines = rawSource
    .split(sentenceSplit)
    .map((part) => part.trim())
    .filter(Boolean);

  const requirements = lines
    .map((line, index) => normalizeRequirement(line, index))
    .filter((value): value is RequirementDraft => Boolean(value));

  const exactFileNaming = requirements
    .map((req) => req.exactFileName)
    .filter((value): value is string => Boolean(value));

  const exactFileOrder = exactFileNaming.length > 0 ? [...exactFileNaming] : [];

  const summary = requirements.length > 0
    ? `Engine extracted ${requirements.length} structured requirements from the tender intake and uploaded files.`
    : "Engine could not derive structured requirements yet. Add more tender detail or upload clearer tender files.";

  return {
    summary,
    requirements,
    exactFileNaming,
    exactFileOrder,
  };
}
