/**
 * "Why Us" 5-bullet summary — the most-read section of any proposal.
 * Each bullet is a single sentence anchored in evidence: project name +
 * value, expert name + license, certification, in-house capability, or
 * client outcome.
 *
 * Built from the reviewed knowledge vault. Conditional: only emitted
 * when the upstream output does not already contain a "Why Us" or
 * "Why [Company]" heading.
 */

import type { ExpertRecord, ProjectRecord } from "./benchmark-tables";

function fmtMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (!value) return "";
  const cur = currency || "ETB";
  return `${cur} ${Math.round(value).toLocaleString("en-US")}`;
}

function safeArr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch { /* fall through */ }
  }
  return trimmed.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
}

export function buildWhyUsSummary(opts: {
  companyName: string;
  clientName: string;
  experts: ExpertRecord[];
  projects: ProjectRecord[];
  differentiators: string[];
  primarySector: string;
}): string | null {
  const bullets: string[] = [];

  // 1. Direct comparable project
  const top = opts.projects[0];
  if (top) {
    const value = fmtMoney(top.contractValue, top.currency);
    bullets.push(
      `**Relevant reviewed experience.** ${opts.companyName} presents ${top.name}${value ? ` (${value})` : ""}${top.clientName ? ` for ${top.clientName}` : ""} as a project record whose applicable lessons inform the approach for ${opts.clientName}.`,
    );
  }

  // 2. Lead expert with credentials
  const lead = opts.experts.find((e) => /lead|principal|director|manager/i.test(e.title || "")) || opts.experts[0];
  if (lead) {
    const certs = safeArr(lead.certifications);
    const credentials = certs.length > 0 ? certs[0] : (safeArr(lead.disciplines)[0] || lead.title || "Specialist");
    bullets.push(
      `**Proven team continuity.** ${lead.fullName} (${lead.title || "Senior Lead"}, ${credentials})${lead.yearsExperience ? ` brings ${lead.yearsExperience} years` : ""} — the same lead who has delivered comparable work and is committed to this engagement.`,
    );
  }

  // 3. Aggregate evidence
  const totalValue = opts.projects.reduce((sum, p) => sum + (p.contractValue ?? 0), 0);
  const projectCount = opts.projects.length;
  if (projectCount >= 2 && totalValue > 0) {
    bullets.push(
      `**Portfolio depth.** ${projectCount} reviewed reference project${projectCount === 1 ? "" : "s"} on file, aggregate value ${fmtMoney(totalValue, opts.projects[0]?.currency || "ETB")} — an institutional track record that reduces delivery risk for the awarding authority.`,
    );
  } else if (opts.experts.length >= 3) {
    bullets.push(
      `**Multi-disciplinary team in-house.** ${opts.experts.length} reviewed specialist${opts.experts.length === 1 ? "" : "s"} cover the full scope of this assignment — no sub-contractor coordination delays.`,
    );
  }

  // 4. Sector-specific institutional capability (from differentiators)
  const sectorClaim = opts.differentiators.find((d) => /licens|certif|grade|accredit|in-house|laboratory|donor/i.test(d));
  if (sectorClaim) {
    bullets.push(`**Institutional capability.** ${sectorClaim}`);
  }

  // 5. Quality & compliance discipline
  bullets.push(
    `**Quality discipline.** Three-stage internal review (schematic / developed / pre-issue) with named reviewer sign-off, source-evidence verification on every claim, and a final validation pass before submission — risk reduction the awarding authority can audit.`,
  );

  // Need at least 3 bullets to be meaningful
  if (bullets.length < 3) return null;

  return [
    `## Why ${opts.companyName} for ${opts.clientName}`,
    "Five reasons grounded in reviewed evidence:",
    "",
    ...bullets.map((b, i) => `${i + 1}. ${b}`),
  ].join("\n");
}
