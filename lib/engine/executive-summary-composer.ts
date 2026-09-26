// The Executive Summary of the deterministic proposal, composed from records.
//
// The summary run 36074770709 delivered was two sentences naming projects, a
// "Led by <first-ranked expert>" line, the tender's evaluation criteria as a
// bare list, and three generic differentiators ("The proposed disciplines are
// mapped to the tender's healthcare scope"). It answered none of the questions
// an evaluator brings to a summary: what does the client need, why is this
// firm relevant, what proves it, who does the work, how is it controlled.
//
// Each paragraph below answers one of those questions from a source:
//   need       — the tender's own scope items;
//   relevance  — which scope items each reference project's recorded services
//                correspond to (project-scope-relevance.ts);
//   team       — who leads the team and each scope item (the same plan
//                Section C prints), their CV-stated registrations, and which
//                reference projects their own CVs name. What a person is
//                proposed to do and what their CV says they have done are
//                stated separately and never merged;
//   approach   — what Section C sets out for every scope item;
//   standing   — the company record's own description and quality records.
// The "why this firm" thesis pairs each main scope item with its lead, the
// firm's recorded experience of that work, and the risk the plan controls.
// Nothing is stated that a record does not hold; a paragraph whose source is
// empty is left out rather than filled.

import type { ExpertRecord, ProjectRecord } from "./benchmark-tables";
import type { ScopeItem, ScopePlanEntry } from "./scope-delivery-plan";
import { scopeItemsAnsweredByProject } from "./project-scope-relevance";
import { recordedProjectServices } from "./project-fact-extractor";
import { licencesNamedInCv, projectsNamedInCv } from "./cv-grounding";
import { holdsExecutiveOffice } from "./signatory";
import { titleStatesRole } from "./requirement-constraints";
import { possessive } from "./possessive";
import { formatPersonWithCredential, formatRegistration } from "./credential-format";

export interface ExecutiveSummaryInput {
  companyName: string;
  clientName: string;
  tenderTitle: string;
  primarySector: string;
  location?: string | null;
  scopePlan: ScopePlanEntry[];
  /** Strongest first. */
  projects: ProjectRecord[];
  /** In presentation order (team-order.ts). */
  experts: ExpertRecord[];
  evaluationCriteriaCount: number;
  companyDescription?: string | null;
  qualityRecords?: Array<{ title?: string | null; referenceNumber?: string | null }>;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Lower-case a Title Case heading for use mid-sentence, keeping acronyms. */
export function midSentence(title: string): string {
  return clean(title).split(" ").map((w) => (/^[A-Z0-9]{2,}(?:[/-][A-Z0-9]+)*$/.test(w) ? w : w.toLowerCase())).join(" ");
}

function lowerFirst(text: string): string {
  const t = clean(text);
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function registration(e: ExpertRecord): string | null {
  let stored: string[] = [];
  try {
    const parsed = JSON.parse(String(e.certifications ?? "[]"));
    stored = (Array.isArray(parsed) ? parsed : []).map((v) => clean(String(v ?? ""))).filter((v) => v.length > 2);
  } catch { stored = []; }
  const raw = stored[0] ?? licencesNamedInCv(e.profile)[0] ?? null;
  return raw ? formatRegistration(raw) : null;
}

function person(e: ExpertRecord, withRegistration = true): string {
  return formatPersonWithCredential(e.fullName, e.title, withRegistration ? registration(e) : null);
}

function areaOf(project: ProjectRecord): string | null {
  const m = String(project.summary ?? "").match(/([\d,.]+)\s*m²/);
  return m ? `${m[1]} m²` : null;
}

function projectDetail(project: ProjectRecord): string {
  const parts = [clean(project.country), areaOf(project)].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function needParagraph(input: ExecutiveSummaryInput): string {
  const items = input.scopePlan.map((p) => p.item);
  const where = clean(input.location) ? ` in ${clean(input.location)}` : "";
  if (items.length < 2) return `${input.clientName} has invited proposals for ${input.tenderTitle}${where}.`;
  return `${input.clientName} has invited proposals for ${input.tenderTitle}${where}. The scope of services runs through ${items.length} items, from ${midSentence(items[0].title)} to ${midSentence(items[items.length - 1].title)}, and this proposal answers each of them in the tender's order.`;
}

interface ReferenceEvidence {
  project: ProjectRecord;
  services: string[];
  items: ScopeItem[];
}

/** The references whose recorded services answer at least one scope item, strongest first. */
function referenceEvidence(input: ExecutiveSummaryInput, items: ScopeItem[]): ReferenceEvidence[] {
  return input.projects.slice(0, 3).map((project) => {
    const matches = scopeItemsAnsweredByProject(recordedProjectServices(project), items);
    return {
      project,
      services: [...new Set(matches.flatMap((m) => m.services))].slice(0, 5).map(lowerFirst),
      items: matches.map((m) => items[m.index - 1]).filter(Boolean),
    };
  });
}

function coveredItems(evidence: ReferenceEvidence[]): ScopeItem[] {
  const seen = new Set<string>();
  const out: ScopeItem[] = [];
  for (const e of evidence) for (const item of e.items) if (!seen.has(item.title)) { seen.add(item.title); out.push(item); }
  return out;
}

// Each reference is named once with the services its record states; the
// scope items those services answer are listed once, for all of them. The
// paragraph used to repeat the same four scope-item titles after every
// project, so the one fact an evaluator needs — how much of THIS scope the
// firm has already done — was buried in the third repetition.
function relevanceParagraph(input: ExecutiveSummaryInput, items: ScopeItem[]): string {
  const evidence = referenceEvidence(input, items);
  if (evidence.length === 0) return "";
  const sector = clean(input.primarySector).split(/\s*\/\s*/)[0].toLowerCase() || "comparable";
  const sentences = evidence.map(({ project, services }) => services.length > 0
    ? `On ${clean(project.name)}${projectDetail(project)}, the firm's recorded services included ${list(services)}.`
    : `${clean(project.name)}${projectDetail(project)} is a further ${sector} reference.`);
  const covered = coveredItems(evidence);
  const lead = `${possessive(input.companyName)} closest references are ${evidence.length === 1 ? `one ${sector} project` : `${evidence.length} ${sector} projects`}.`;
  const coverage = covered.length >= 2 && items.length > 0
    ? ` Between them, these services already cover ${covered.length} of the ${items.length} scope items: ${list(covered.map((i) => midSentence(i.title)))}.`
    : "";
  return `${lead} ${sentences.join(" ")}${coverage}`;
}

function teamParagraph(input: ExecutiveSummaryInput): string {
  const team = input.experts.filter((e) => clean(e.fullName));
  if (team.length === 0) return "";
  const executives = team.filter((e) => holdsExecutiveOffice(e.title ?? ""));
  const principal = executives.length === 1 ? executives[0] : team[0];
  const pm = team.find((e) => e !== principal && titleStatesRole(e.title, "project manager"));
  const out: string[] = [`The proposed team of ${team.length} named experts is led by ${person(principal)}.`];
  if (pm) out.push(`${person(pm)} is proposed as Project Manager.`);
  const leads = input.scopePlan
    .filter((p) => p.lead && p.lead !== principal && p.lead !== pm)
    .map((p) => `${clean(p.lead!.fullName)} leads ${midSentence(p.item.title)}`);
  if (leads.length > 0) out.push(`${list(leads)}.`);
  const registered = team.filter((e) => registration(e)).length;
  if (registered > 0) out.push(`${registered} of the ${team.length} hold a professional registration stated in their own CV.`);
  // Past experience, as the CVs state it — kept apart from the proposed roles.
  for (const project of input.projects.slice(0, 3)) {
    const naming = team.filter((e) => projectsNamedInCv(e.profile, [project]).length > 0).map((e) => clean(e.fullName));
    if (naming.length > 0) {
      out.push(`${list(naming)} ${naming.length === 1 ? "names" : "name"} ${clean(project.name)} in ${naming.length === 1 ? "their own CV" : "their own CVs"}.`);
    }
  }
  return out.join(" ");
}

function approachParagraph(input: ExecutiveSummaryInput): string {
  if (input.scopePlan.length === 0) return "";
  return `For each scope item, Section C sets out the lead, the inputs, the deliverables, the quality check and the point at which ${input.clientName} approves the work before the dependent item proceeds. The work plan sequences the items as phases, each closing on ${possessive(input.clientName)} written sign-off.`;
}

function standingParagraph(input: ExecutiveSummaryInput): string {
  const out: string[] = [];
  const description = clean(input.companyDescription).replace(/\.$/, "");
  if (description && !/\b(?:AI|prompt|summary|use this)\b/i.test(description)) {
    const article = /^[aeiou]/i.test(description) ? "an" : "a";
    out.push(`${input.companyName} is ${article} ${lowerFirst(description)}.`);
  }
  const quality = (input.qualityRecords ?? [])
    .filter((r) => clean(r.title) && clean(r.referenceNumber))
    .slice(0, 2)
    .map((r) => `${clean(r.title)} (${clean(r.referenceNumber)})`);
  if (quality.length > 0) out.push(`Its design review and document control follow its ${list(quality)}.`);
  return out.join(" ");
}

function thesis(input: ExecutiveSummaryInput, items: ScopeItem[]): string {
  const bullets: Array<{ score: number; text: string }> = [];
  for (const entry of input.scopePlan) {
    if (!entry.lead) continue;
    const withExperience = input.projects.slice(0, 3)
      .map((project) => ({ project, match: scopeItemsAnsweredByProject(recordedProjectServices(project), items).find((m) => m.title === entry.item.title) }))
      .filter((x) => x.match);
    const experience = withExperience.length > 0
      ? ` The firm's recorded services on ${list(withExperience.map((x) => clean(x.project.name)))} include ${list([...new Set(withExperience.flatMap((x) => x.match!.services))].slice(0, 3).map(lowerFirst))}.`
      : "";
    const support = entry.support.length > 0 ? `, supported by ${list(entry.support.map((e) => clean(e.fullName)))}` : "";
    const risk = entry.risk && entry.control ? ` The plan controls its main risk — ${lowerFirst(entry.risk).replace(/\.$/, "")} — because ${lowerFirst(entry.control)}.` : "";
    bullets.push({ score: (withExperience.length > 0 ? 2 : 0) + (registration(entry.lead) ? 1 : 0), text: `- **${clean(entry.item.title)}.** Led by ${person(entry.lead)}${support}.${experience}${risk}` });
  }
  const ranked = bullets
    .map((b, i) => ({ ...b, i }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .slice(0, 3)
    .sort((a, b) => a.i - b.i);
  if (ranked.length < 2) return "";
  return [
    `## Why ${input.companyName} for This Assignment`,
    `For the parts of the scope where the most is at stake, the plan pairs a named lead with the firm's recorded experience of the same work:`,
    ...ranked.map((b) => b.text),
  ].join("\n\n");
}

/**
 * The body of the covering letter, from the same records as the Executive
 * Summary: what the firm understands the assignment to be, and the three
 * points of evidence the proposal rests on. Concise by design — the letter
 * introduces the proposal; the summary argues it.
 *
 * The letter this replaces said the firm "presents" two projects "as
 * relevant reference experience" and that "the applicable delivery lessons
 * inform the approach", then listed whatever differentiators the tender
 * analysis produced ("World Bank ESF and British Council records inform the
 * proposal's documentation ..."). Every sentence here is a record: a scope
 * item, a project and its services, a named person and their registration,
 * a quality document and its reference. A point with no record behind it is
 * left out.
 */
export function composeCoverLetterBody(input: ExecutiveSummaryInput): string {
  const items = input.scopePlan.map((p) => p.item);
  const where = clean(input.location) ? ` in ${clean(input.location)}` : "";
  const out: string[] = [
    `${input.companyName} is pleased to submit this Technical Proposal for ${input.tenderTitle}${where}, in response to the invitation issued by ${input.clientName}.`,
  ];
  if (items.length >= 2) {
    out.push(`We understand the assignment as ${items.length} linked services, from ${midSentence(items[0].title)} to ${midSentence(items[items.length - 1].title)}, each closing on ${possessive(input.clientName)} approval before the next proceeds. Our proposal answers each of them in the tender's own order.`);
  }
  const points: string[] = [];
  const evidence = referenceEvidence(input, items).filter((e) => e.services.length > 0);
  const covered = coveredItems(evidence);
  if (evidence.length > 0) {
    const names = evidence.slice(0, 2).map((e) => `${clean(e.project.name)}${projectDetail(e.project)}`);
    points.push(`**Comparable experience.** ${list(names)}${covered.length > 0 && items.length > 0 ? `, whose recorded services cover ${covered.length} of the ${items.length} scope items` : ""}.`);
  }
  const team = input.experts.filter((e) => clean(e.fullName));
  if (team.length > 0) {
    const executives = team.filter((e) => holdsExecutiveOffice(e.title ?? ""));
    const principal = executives.length === 1 ? executives[0] : team[0];
    const registered = team.filter((e) => registration(e)).length;
    points.push(`**A named, registered team.** ${team.length} experts led by ${person(principal)}${registered > 0 ? `; ${registered} of them hold a professional registration stated in their own CV` : ""}.`);
  }
  const quality = (input.qualityRecords ?? [])
    .filter((r) => clean(r.title) && clean(r.referenceNumber))
    .slice(0, 1)
    .map((r) => `${clean(r.title)} (${clean(r.referenceNumber)})`);
  if (items.length > 0) {
    points.push(`**Controlled delivery.** Every scope item has a named lead, a quality check and ${possessive(input.clientName)} sign-off before the dependent item proceeds${quality.length > 0 ? `, under the firm's ${quality[0]}` : ""}.`);
  }
  if (points.length > 0) {
    out.push("Our proposal rests on:");
    out.push(points.map((p) => `- ${p}`).join("\n"));
  }
  out.push(`We would welcome the opportunity to discuss this proposal with ${input.clientName} and remain available for any clarification the Evaluation Committee requires.`);
  return out.join("\n\n");
}

/**
 * The Executive Summary body (paragraphs and the "why this firm" thesis),
 * without its top-level heading. Empty when the records hold nothing to say.
 */
export function composeExecutiveSummary(input: ExecutiveSummaryInput): string {
  const items = input.scopePlan.map((p) => p.item);
  const paragraphs = [
    needParagraph(input),
    relevanceParagraph(input, items),
    teamParagraph(input),
    approachParagraph(input),
    standingParagraph(input),
    input.evaluationCriteriaCount > 0
      ? `Section F sets each of the tender's ${input.evaluationCriteriaCount} evaluation criteria beside the section and the evidence that answer it.`
      : "",
  ].filter(Boolean);
  const whyUs = thesis(input, items);
  return [...paragraphs, whyUs].filter(Boolean).join("\n\n");
}
