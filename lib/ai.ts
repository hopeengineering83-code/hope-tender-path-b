import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;

function getClient() {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

export function isAIEnabled() {
  return Boolean(apiKey);
}

export type AIRequirement = {
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  exactFileName?: string | null;
  requiredQuantity?: number | null;
};

export type AIAnalysisResult = {
  summary: string;
  requirements: AIRequirement[];
  exactFileNaming: string[];
  exactFileOrder: string[];
  evaluationMethodology: string;
  submissionNotes: string;
};

export async function analyzeWithAI(tenderContent: string): Promise<AIAnalysisResult> {
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a tender analysis engine. Analyze the following tender document and extract structured information.

Return a JSON object with this exact structure:
{
  "summary": "2-3 sentence executive summary of what this tender is about and key requirements",
  "requirements": [
    {
      "title": "short title",
      "description": "full requirement text",
      "requirementType": one of ["TECHNICAL","FINANCIAL","ELIGIBILITY","EXPERT","PROJECT_EXPERIENCE","FORMAT","SUBMISSION_RULE","DECLARATION","ANNEX","SCHEDULE","FORM"],
      "priority": one of ["MANDATORY","SCORED","INFORMATIONAL"],
      "exactFileName": "filename if explicitly named, else null",
      "requiredQuantity": number if specified, else null
    }
  ],
  "exactFileNaming": ["list of exact filenames required by the tender"],
  "exactFileOrder": ["files in submission order if specified"],
  "evaluationMethodology": "how proposals will be scored/evaluated",
  "submissionNotes": "key submission instructions, deadlines, portals"
}

Only return valid JSON. No explanation.

TENDER DOCUMENT:
${tenderContent.slice(0, 6000)}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI returned invalid JSON");
  return JSON.parse(jsonMatch[0]) as AIAnalysisResult;
}

export async function generateProposal(params: {
  tenderTitle: string;
  tenderDescription: string;
  requirements: string;
  companyName: string;
  companyProfile: string;
  serviceLines: string;
}): Promise<string> {
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a professional bid writer. Write a compelling tender proposal for the following opportunity.

TENDER: ${params.tenderTitle}
DESCRIPTION: ${params.tenderDescription}
KEY REQUIREMENTS: ${params.requirements}

COMPANY: ${params.companyName}
COMPANY PROFILE: ${params.companyProfile}
SERVICE LINES: ${params.serviceLines}

Write a professional proposal with these sections:
1. Executive Summary
2. Understanding of Requirements
3. Technical Approach
4. Company Qualifications
5. Why Choose Us

Use formal language. Be specific and reference the tender requirements directly.
Format with clear headings using ## for sections.`,
      },
    ],
  });

  return message.content[0].type === "text" ? message.content[0].text : "";
}
