import { safeParse, safeParseJsonArray } from "./safe-json-util";
/**
 * Proposal tools — closes audit gap #10 (no tool-use during
 * generation; Claude can't search evidence mid-write).
 *
 * Defines Anthropic-compatible tool schemas + pure executors that
 * search and inspect the company's evidence library (experts +
 * projects) without hitting the database. The evidence is pre-loaded
 * by the caller (typically the generation orchestrator) and the
 * executor operates purely over those in-memory arrays.
 *
 * This module is provider-agnostic — the tool definitions follow
 * Anthropic's `tools` parameter shape but the executors return
 * plain JavaScript objects, so the same tools can be wired to any
 * provider that supports function calling.
 *
 * Why in-memory rather than DB queries: tool-use loops can iterate
 * many times. Putting DB round-trips inside the loop would make
 * generation latency unpredictable and risk Vercel function
 * timeouts. The caller pays the DB cost once, up front, and the
 * tools operate on the snapshot.
 */

export type ToolEvidenceExpert = {
  id?: string | null;
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: string[] | string | null;
  sectors?: string[] | string | null;
  certifications?: string[] | string | null;
  profile?: string | null;
  trustLevel?: string | null;
};

export type ToolEvidenceProject = {
  id?: string | null;
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: string | null;
  summary?: string | null;
  contractValue?: number | null;
  currency?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  trustLevel?: string | null;
};

export type ToolEvidenceCompany = {
  name?: string | null;
  legalName?: string | null;
  country?: string | null;
  foundingYear?: number | null;
  headcount?: number | null;
  licenseGrade?: string | null;
  registrationNumber?: string | null;
  tin?: string | null;
  vat?: string | null;
  gmName?: string | null;
  gmTitle?: string | null;
  gmLicense?: string | null;
  serviceLines?: string[] | null;
  sectors?: string[] | null;
  profileSummary?: string | null;
};

export type ToolEvidenceLegalRecord = {
  /** "LICENSE" | "REGISTRATION" | "ISO_9001" | "TAX_CLEARANCE" | "INSURANCE" | etc. */
  recordType: string;
  title?: string | null;
  authority?: string | null;
  referenceNumber?: string | null;
  /** ISO date string. */
  issueDate?: string | null;
  /** ISO date string. */
  expiryDate?: string | null;
  status?: string | null;
};

export type ToolEvidenceRequirement = {
  /** Tender requirement code (e.g. "TR-01", "EXP-03"). May be undefined when the tender doesn't number requirements. */
  code?: string | null;
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  sectionReference?: string | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  exactFileName?: string | null;
  restrictions?: string | null;
};

export type ToolEvidenceInventory = {
  experts: ToolEvidenceExpert[];
  projects: ToolEvidenceProject[];
  /** Optional firm-level metadata. Surfaced via inspect_company_profile when present. */
  company?: ToolEvidenceCompany | null;
  /** Optional legal / regulatory records. Surfaced via lookup_legal_record when present. */
  legalRecords?: ToolEvidenceLegalRecord[];
  /** Optional tender requirements. Surfaced via inspect_tender_requirement when present. */
  requirements?: ToolEvidenceRequirement[];
};

/**
 * Anthropic tool definition shape. The schema is the JSON Schema
 * subset Anthropic's API accepts.
 */
export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const PROPOSAL_TOOL_DEFS: AnthropicToolDef[] = [
  {
    name: "search_company_knowledge",
    description: "Search the firm's evidence library (experts + projects) for records that match a free-text query. Use this when you need to verify that the firm has evidence for a specific technical skill, sector, or contract type before making a claim in the proposal.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query (e.g. 'EPANET hydraulic modelling', 'WASH project World Bank funded', 'team leader with PMP certification')." },
        type: { type: "string", enum: ["expert", "project", "both"], description: "Restrict search to experts only, projects only, or both. Default: both." },
        max_results: { type: "number", description: "Maximum results per category. Default 5, max 10." },
      },
      required: ["query"],
    },
  },
  {
    name: "inspect_expert",
    description: "Retrieve the full profile of a specific expert by name (or partial name). Use this when you want to verify an expert's exact qualifications, years of experience, certifications, or sectors before naming them in a section.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Expert's full name or a distinctive substring. Match is case-insensitive." },
      },
      required: ["name"],
    },
  },
  {
    name: "inspect_project",
    description: "Retrieve the full profile of a specific project by name (or partial name). Use this when you want to verify a project's exact client, contract value, sector, or scope before citing it as evidence.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name or a distinctive substring. Match is case-insensitive." },
      },
      required: ["name"],
    },
  },
  {
    name: "inspect_company_profile",
    description: "Retrieve the firm's institutional metadata: legal name, founding year, headcount, license grade, registration number, TIN, VAT, GM name + license, service lines, sectors, and profile summary. Use this BEFORE asserting any corporate fact in Sections A.1 / A.2 / D.4 so the values cited are exactly what the firm has on file. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "lookup_legal_record",
    description: "Retrieve the firm's legal / regulatory records (licenses, registrations, ISO certifications, tax clearances, insurance, etc.). Use this when the tender requires a specific certificate or license number and you need to verify the firm holds it, what its reference number is, and whether it's currently valid.",
    input_schema: {
      type: "object",
      properties: {
        recordType: { type: "string", description: "Optional filter — e.g. 'LICENSE', 'ISO_9001', 'TAX_CLEARANCE', 'REGISTRATION', 'INSURANCE'. Match is case-insensitive substring. Omit to list all records." },
      },
      required: [],
    },
  },
  {
    name: "inspect_tender_requirement",
    description: "Retrieve a specific tender requirement by its code (e.g. 'TR-01') or by a title substring (e.g. 'Team Leader CV'). Use this when you need to verify EXACTLY what the tender asks for before drafting a section response — the requirement's priority (MANDATORY vs SCORED), required quantity, page limit, exact-file-name rule, and any restrictions. Helps avoid paraphrasing the tender language and ensures every mandatory requirement is addressed.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Either an exact requirement code (e.g. 'TR-01', 'EXP-03') or a substring of the requirement title (e.g. 'Team Leader', 'audited financial')." },
        priorityFilter: { type: "string", enum: ["MANDATORY", "SCORED", "INFORMATIONAL", "ANY"], description: "Optional priority filter. Default: ANY." },
      },
      required: ["query"],
    },
  },
];

type ToolCallInput = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function joinList(value: string[] | string | null | undefined): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.join(", ");
  // Some records store the list as a JSON string ("[\"a\",\"b\"]").
  try {
    const parsed = safeParse(value, null);
    if (Array.isArray(parsed)) return parsed.join(", ");
  } catch {
    // Not JSON — fall through to plain string.
  }
  return value;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function expertMatchScore(expert: ToolEvidenceExpert, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = [
    expert.fullName,
    expert.title,
    String(expert.yearsExperience ?? ""),
    joinList(expert.disciplines),
    joinList(expert.sectors),
    joinList(expert.certifications),
    expert.profile ?? "",
  ].filter(Boolean).join(" ").toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits;
}

function projectMatchScore(project: ToolEvidenceProject, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = [
    project.name,
    project.clientName,
    project.country,
    project.sector,
    project.serviceAreas,
    project.summary,
  ].filter(Boolean).join(" ").toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits;
}

function summariseExpert(expert: ToolEvidenceExpert): Record<string, unknown> {
  return {
    name: expert.fullName,
    title: expert.title ?? null,
    yearsExperience: expert.yearsExperience ?? null,
    disciplines: joinList(expert.disciplines) || null,
    sectors: joinList(expert.sectors) || null,
    certifications: joinList(expert.certifications) || null,
    profile: (expert.profile ?? "").slice(0, 1200) || null,
    trustLevel: expert.trustLevel ?? null,
  };
}

function summariseProject(project: ToolEvidenceProject): Record<string, unknown> {
  return {
    name: project.name,
    clientName: project.clientName ?? null,
    country: project.country ?? null,
    sector: project.sector ?? null,
    serviceAreas: project.serviceAreas ?? null,
    contractValue: project.contractValue ?? null,
    currency: project.currency ?? null,
    startDate: project.startDate ? String(project.startDate).slice(0, 10) : null,
    endDate: project.endDate ? String(project.endDate).slice(0, 10) : null,
    summary: (project.summary ?? "").slice(0, 1200) || null,
    trustLevel: project.trustLevel ?? null,
  };
}

/**
 * Pure executor for the tool calls. Receives the tool name + input
 * + the evidence inventory, returns a JSON-serialisable object that
 * the caller wraps in a tool_result block.
 *
 * Throws (never silently fails) for an unknown tool name so the
 * caller can surface a clear error to the model.
 */
export function executeProposalTool(
  toolName: string,
  input: ToolCallInput,
  inventory: ToolEvidenceInventory,
): Record<string, unknown> {
  switch (toolName) {
    case "search_company_knowledge": {
      const query = asString(input.query);
      if (query.length === 0) {
        return { error: "query is required and must be a non-empty string" };
      }
      const type = asString(input.type) || "both";
      const maxResults = Math.min(10, Math.max(1, asNumber(input.max_results, 5)));
      const tokens = tokenize(query);
      const result: Record<string, unknown> = { query, tokensSearched: tokens };

      if (type === "expert" || type === "both") {
        const ranked = inventory.experts
          .map((e) => ({ score: expertMatchScore(e, tokens), expert: e }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);
        result.experts = ranked.map((r) => ({ matchScore: r.score, ...summariseExpert(r.expert) }));
      }
      if (type === "project" || type === "both") {
        const ranked = inventory.projects
          .map((p) => ({ score: projectMatchScore(p, tokens), project: p }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);
        result.projects = ranked.map((r) => ({ matchScore: r.score, ...summariseProject(r.project) }));
      }
      return result;
    }
    case "inspect_expert": {
      const name = asString(input.name);
      if (name.length === 0) return { error: "name is required" };
      const needle = name.toLowerCase();
      const matches = inventory.experts.filter((e) => e.fullName.toLowerCase().includes(needle));
      if (matches.length === 0) return { matchCount: 0, note: `No expert found matching "${name}". The firm's evidence library does not include this expert.` };
      return { matchCount: matches.length, experts: matches.slice(0, 3).map(summariseExpert) };
    }
    case "inspect_project": {
      const name = asString(input.name);
      if (name.length === 0) return { error: "name is required" };
      const needle = name.toLowerCase();
      const matches = inventory.projects.filter((p) => p.name.toLowerCase().includes(needle));
      if (matches.length === 0) return { matchCount: 0, note: `No project found matching "${name}". The firm's evidence library does not include this project.` };
      return { matchCount: matches.length, projects: matches.slice(0, 3).map(summariseProject) };
    }
    case "inspect_company_profile": {
      if (!inventory.company) {
        return { available: false, note: "No company profile was provided to the engine for this generation. Do not cite institutional metadata (TIN, VAT, license grade, founding year, GM name) — fall back to a 'Bid-Team Action: confirm X before submission.' note for any such fields." };
      }
      const c = inventory.company;
      return {
        available: true,
        company: {
          name: c.name ?? null,
          legalName: c.legalName ?? null,
          country: c.country ?? null,
          foundingYear: c.foundingYear ?? null,
          headcount: c.headcount ?? null,
          licenseGrade: c.licenseGrade ?? null,
          registrationNumber: c.registrationNumber ?? null,
          tin: c.tin ?? null,
          vat: c.vat ?? null,
          gmName: c.gmName ?? null,
          gmTitle: c.gmTitle ?? null,
          gmLicense: c.gmLicense ?? null,
          serviceLines: Array.isArray(c.serviceLines) ? c.serviceLines.slice(0, 30) : null,
          sectors: Array.isArray(c.sectors) ? c.sectors.slice(0, 30) : null,
          profileSummary: (c.profileSummary ?? "").slice(0, 2000) || null,
        },
      };
    }
    case "inspect_tender_requirement": {
      const query = asString(input.query);
      if (query.length === 0) return { error: "query is required (requirement code or title substring)" };
      const requirements = Array.isArray(inventory.requirements) ? inventory.requirements : [];
      if (requirements.length === 0) {
        return { available: false, note: "No tender requirements were supplied to the engine for this generation. The requirement-extraction step may have produced no rows, or the engine was invoked without requirements pre-loaded." };
      }
      const priorityFilter = asString(input.priorityFilter).toUpperCase();
      const validPriority = ["MANDATORY", "SCORED", "INFORMATIONAL"].includes(priorityFilter) ? priorityFilter : null;
      const needle = query.toLowerCase();
      const matches = requirements.filter((r) => {
        const codeHit = (r.code ?? "").toLowerCase().includes(needle);
        const titleHit = r.title.toLowerCase().includes(needle);
        const descHit = r.description.toLowerCase().includes(needle);
        const priorityOk = validPriority === null || r.priority === validPriority;
        return (codeHit || titleHit || descHit) && priorityOk;
      });
      if (matches.length === 0) {
        const priorityNote = validPriority ? ` with priority ${validPriority}` : "";
        return {
          available: true,
          matchCount: 0,
          note: `No tender requirement matches "${query}"${priorityNote}. Try a broader query, or list all requirements by omitting the priority filter.`,
        };
      }
      return {
        available: true,
        matchCount: matches.length,
        requirements: matches.slice(0, 8).map((r) => ({
          code: r.code ?? null,
          title: r.title,
          description: (r.description ?? "").slice(0, 800) || null,
          requirementType: r.requirementType,
          priority: r.priority,
          sectionReference: r.sectionReference ?? null,
          requiredQuantity: r.requiredQuantity ?? null,
          pageLimit: r.pageLimit ?? null,
          exactFileName: r.exactFileName ?? null,
          restrictions: r.restrictions ?? null,
        })),
      };
    }
    case "lookup_legal_record": {
      const records = Array.isArray(inventory.legalRecords) ? inventory.legalRecords : [];
      if (records.length === 0) {
        return { available: false, note: "No legal / regulatory records are available in this generation's evidence library. Do not cite specific certificate or license reference numbers — fall back to a 'Bid-Team Action: confirm X before submission.' note." };
      }
      const filter = asString(input.recordType).toLowerCase();
      const filtered = filter.length > 0
        ? records.filter((r) => (r.recordType ?? "").toLowerCase().includes(filter) || (r.title ?? "").toLowerCase().includes(filter))
        : records;
      if (filtered.length === 0) {
        return { available: true, matchCount: 0, note: `No legal record matches "${input.recordType}". Available record types: ${Array.from(new Set(records.map((r) => r.recordType))).slice(0, 10).join(", ")}.` };
      }
      return {
        available: true,
        matchCount: filtered.length,
        records: filtered.slice(0, 12).map((r) => ({
          recordType: r.recordType,
          title: r.title ?? null,
          authority: r.authority ?? null,
          referenceNumber: r.referenceNumber ?? null,
          issueDate: r.issueDate ?? null,
          expiryDate: r.expiryDate ?? null,
          status: r.status ?? null,
          // Inline computed: is the record currently valid?
          valid: r.expiryDate ? new Date(r.expiryDate) > new Date() : null,
        })),
      };
    }
    default:
      return { error: `Unknown tool: ${toolName}. Available tools: ${PROPOSAL_TOOL_DEFS.map((t) => t.name).join(", ")}.` };
  }
}

/**
 * Convenience helper for tests and call sites that don't need the
 * Anthropic tool_use protocol — directly run a tool with a typed
 * input object.
 */
export function searchCompanyKnowledge(query: string, inventory: ToolEvidenceInventory, opts?: { type?: "expert" | "project" | "both"; maxResults?: number }): Record<string, unknown> {
  return executeProposalTool("search_company_knowledge", {
    query,
    type: opts?.type ?? "both",
    max_results: opts?.maxResults ?? 5,
  }, inventory);
}
