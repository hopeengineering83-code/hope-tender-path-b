import { safeParse, safeParseJsonArray } from "./safe-json-util";
/**
 * AI Multi-Perspective Matcher
 *
 * Uses reasoning-capable AI models to assess experts and projects against
 * tender requirements from multiple perspectives (Technical, Commercial,
 * Compliance, and Sector Fit).
 */

export interface MatchPerspective {
  perspective: string;
  score: number; // 0-10
  rationale: string;
}

export interface CandidateAssessment {
  id: string;
  name: string;
  overallScore: number;
  perspectives: MatchPerspective[];
  rationale: string;
  bestFitRole?: string;
}

export interface MatchAssessmentBatch {
  requirementId: string;
  experts: CandidateAssessment[];
  projects: CandidateAssessment[];
}

export interface ExpertCandidateInput {
  id: string;
  fullName: string;
  title: string | null;
  profile: string | null;
  disciplines: string[];
  sectors: string[];
  certifications: string[];
}

export interface ProjectCandidateInput {
  id: string;
  name: string;
  clientName: string | null;
  country: string | null;
  sector: string | null;
  summary: string | null;
  serviceAreas: string[];
}

function unwrapJson(text: string): string {
  return text.replace(/```json\s?|\s?```/g, "").trim();
}

/**
 * Robust JSON parse for AI outputs that may include trailing commas or truncated content.
 */
function robustParse<T>(raw: string, fallback: T): T {
  const cleaned = unwrapJson(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    try {
      // Try fixing trailing commas in arrays/objects
      const fixed = cleaned.replace(/,(\s*[\]}])/g, "");
      return JSON.parse(fixed) as T;
    } catch {
      console.warn("[robustParse] failed to parse AI JSON:", cleaned.slice(0, 100));
      return fallback;
    }
  }
}

export async function aiRematchExperts(
  requirement: string,
  candidates: ExpertCandidateInput[],
  options: { model?: string } = {}
): Promise<CandidateAssessment[]> {
  // Implementation would call AI model with a specialized prompt
  // for now returning a placeholder or calling the real engine
  return [];
}

export async function aiRematchProjects(
  requirement: string,
  candidates: ProjectCandidateInput[],
  options: { model?: string } = {}
): Promise<CandidateAssessment[]> {
  return [];
}

export function formatAssessmentRationale(assessment: CandidateAssessment): string {
  return assessment.rationale;
}
