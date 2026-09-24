/**
 * Scope-by-Scope Delivery Plan.
 *
 * An evaluator scores a technical approach against the tender's own scope of
 * services, item by item. The deterministic writer answered with sector themes
 * instead ("MEP, biomedical engineering and equipment integration", "Building
 * renovation, modification and adaptive reuse") that covered three of a
 * tender's six scope items and never named who does each one, what it takes
 * in, what it hands over, or how it is checked and approved.
 *
 * This builder reads the numbered scope items out of the tender text and
 * answers each in the tender's own words:
 *
 *   - the scope item, quoted from the tender;
 *   - the lead, named only when a proposed expert's own title holds the
 *     discipline the item calls for (otherwise the discipline is stated and
 *     nobody is named);
 *   - inputs, deliverables, quality check, approval and a key risk, stated as
 *     the proposed method. Where the tender itself lists the outputs ("prepare
 *     renovation drawings, technical specifications, cost estimates, and Bill
 *     of Quantities") those words are used.
 *
 * Nothing here is a claim about past performance, and nothing is tied to one
 * sector or tender: the vocabulary is the vocabulary of consultancy scopes.
 */

import type { ExpertRecord } from "./benchmark-tables";
import { expertTitleRoles } from "./requirement-constraints";

export interface ScopeItem {
  title: string;
  description: string;
}

const SCOPE_HEADING = /scope\s+of\s+(?:services|works?|the\s+(?:assignment|consultancy|services))|terms\s+of\s+reference|services\s+required|description\s+of\s+(?:the\s+)?services/gi;

// A scope item: an optional list number, a Title Case heading, then the duty
// sentence ("The consultant shall ..."), on one line or across a line break.
const DUTY_ITEM = /(?:^|\n)[ \t]*(?:\d{1,2}[.)][ \t]+|[-•*][ \t]+)?([A-Z][A-Za-z0-9,&'/()\- ]{2,100}?)[ \t]*(?:[:.\-–—][ \t]*|\n[ \t]*|[ \t]+)((?:The|the)\s+(?:consultant|contractor|firm|bidder|supplier|service\s+provider|consultancy)\s+(?:shall|will|must|is\s+(?:required|expected)\s+to)\b[^\n]*)/g;

// "1. Title: description" when there is no duty sentence.
const NUMBERED_ITEM = /(?:^|\n)[ \t]*\d{1,2}[.)][ \t]+([A-Z][^\n:–—]{2,90}?)[ \t]*[:–—][ \t]*([^\n]{20,})/g;

const MINOR_WORDS = new Set(["and", "or", "of", "the", "for", "to", "in", "on", "with", "a", "an", "&", "/"]);

function looksLikeHeading(title: string): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;
  if (/[.;]$/.test(title.trim())) return false;
  const significant = words.filter((w) => !MINOR_WORDS.has(w.toLowerCase()));
  if (significant.length === 0) return false;
  const capitalised = significant.filter((w) => /^[A-Z(]/.test(w)).length;
  return capitalised / significant.length >= 0.6;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "")).trim();
}

function itemsIn(zone: string): ScopeItem[] {
  const out: ScopeItem[] = [];
  const seen = new Set<string>();
  const push = (title: string, description: string) => {
    const t = title.replace(/\s+/g, " ").trim().replace(/[:\-–—]$/, "").trim();
    if (!looksLikeHeading(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: t, description: clip(description, 480) });
  };
  for (const m of zone.matchAll(DUTY_ITEM)) push(m[1], m[2]);
  if (out.length < 2) for (const m of zone.matchAll(NUMBERED_ITEM)) push(m[1], m[2]);
  return out.slice(0, 12);
}

/**
 * The scope items the tender lists, in order. Every "scope of services"
 * heading in the text is tried and the richest list wins, because the same
 * tender text carries the scope more than once (the file itself and the
 * analysis summary) and a passing mention of "the scope of services" in a
 * sentence has no list after it.
 */
export function extractScopeItems(tenderText: string | null | undefined): ScopeItem[] {
  const text = String(tenderText ?? "");
  if (!text.trim()) return [];
  let best: ScopeItem[] = [];
  for (const heading of text.matchAll(SCOPE_HEADING)) {
    const start = (heading.index ?? 0) + heading[0].length;
    let zone = text.slice(start, start + 6000);
    // The zone ends at the next page marker or the next all-capitals heading.
    const end = zone.search(/\n\s*#?\s*\[Page\s+\d+\]|\n#{1,2}\s|\n[A-Z][A-Z &/\-]{10,}\n/);
    if (end > 0) zone = zone.slice(0, end);
    const items = itemsIn(zone);
    if (items.length > best.length) best = items;
  }
  return best.length >= 2 ? best : [];
}

// ─── What each kind of scope item calls for ──────────────────────────────────

interface ScopeTraits {
  roles: string[];
  inputs: string[];
  deliverables: string[];
  risk: string;
  regulatory: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  team_leader: "Team Leader / Project Manager",
  architect: "Architect",
  electrical: "Electrical Engineer",
  mechanical: "Mechanical Engineer",
  plumbing: "Sanitary / Plumbing Engineer",
  structural: "Structural Engineer",
  quantity_surveyor: "Quantity Surveyor",
  supervision: "Resident / Supervising Engineer",
  environmental: "Environmental Specialist",
  geotechnical: "Geotechnical Engineer",
  biomedical: "Biomedical Engineer",
  health_planner: "Health Facility Planner",
};

type ScopeKind = "assessing" | "designing" | "structural" | "services" | "regulatory" | "supervising" | "closing";

// What kind of work a scope item is, read from its TITLE first: descriptions
// mention "the approved design" or "healthcare standards" in passing, and
// reading those as the item's own work put design deliverables under close-out
// and approval packages under concept design. The description decides only
// when the title names no kind of work.
const KINDS: Array<{ kind: ScopeKind; title: RegExp; description: RegExp }> = [
  { kind: "assessing", title: /identif|assess|feasib|survey|site\s+selection|due\s+diligence|investigation/, description: /\b(?:identify|assess|evaluate|survey)\b/ },
  { kind: "designing", title: /design|planning|layout|drawings?/, description: /\b(?:prepare|develop|produce)\b[^.]{0,40}\b(?:design|drawings?)\b/ },
  { kind: "structural", title: /structur/, description: /\bstructural\s+(?:design|analysis|assessment)/ },
  { kind: "services", title: /engineering\s+(?:coordination|services|systems)|services\s+coordination|mechanical|electrical|plumbing|\bmep\b|building\s+services/, description: /mechanical|electrical|plumbing|\bmep\b|medical\s+gas|hvac/ },
  { kind: "regulatory", title: /regulat|approv|complian|permit|licen[cs]/, description: /approval\s+process|regulat|permit/ },
  { kind: "supervising", title: /supervis|oversight|implementation|construction\s+(?:works|management)/, description: /\bsupervis/ },
  { kind: "closing", title: /close[-\s]?out|handover|hand[-\s]over|commission|final\s+inspection/, description: /final\s+inspection|handover/ },
];

function kindsOf(item: ScopeItem): ScopeKind[] {
  const title = item.title.toLowerCase();
  const fromTitle = KINDS.filter((k) => k.title.test(title)).map((k) => k.kind);
  if (fromTitle.length > 0) return fromTitle;
  const description = item.description.toLowerCase();
  return KINDS.filter((k) => k.description.test(description)).map((k) => k.kind);
}

// The outputs the tender itself names for the item ("prepare renovation
// drawings, technical specifications, cost estimates, and Bill of Quantities"),
// cut before any qualifier ("aligned with ...", "including ...").
function statedOutputs(description: string): string | null {
  const m = description.match(/\b(?:prepare|produce|provide|deliver|submit|develop)\s+([^.;]+?)(?:,?\s+(?:and\s+)?(?:supervise|support|ensure|coordinate)\b|\s+where\s+required|[.;]|$)/i);
  if (!m) return null;
  const phrase = m[1]
    .split(/\s+(?:aligned\s+with|in\s+accordance\s+with|in\s+line\s+with|including|covering|for\s+the|to\s+(?:the|meet))\b/i)[0]
    .replace(/,\s*$/, "")
    .trim()
    .replace(/^(?:the|all)\s+/i, "");
  if (phrase.split(/\s+/).length < 2) return null;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function traitsOf(item: ScopeItem): ScopeTraits {
  const kinds = kindsOf(item);
  const description = item.description.toLowerCase();
  const roles: string[] = [];
  const inputs: string[] = [];
  const deliverables: string[] = [];
  let risk = "";
  const add = (list: string[], ...values: string[]) => { for (const v of values) if (v && !list.includes(v)) list.push(v); };
  const stated = statedOutputs(item.description);
  if (stated) add(deliverables, stated);

  for (const kind of kinds) {
    if (kind === "assessing") {
      add(roles, "team_leader", "architect", "structural");
      add(inputs, "Client brief and functional requirements", "Candidate properties or sites, with access for inspection");
      if (!stated) add(deliverables, "Assessment report scoring each option against the stated requirements, with a recommended shortlist");
      risk ||= "An option proves unsuitable for the intended use after commitment — each option is scored against written suitability criteria before any recommendation.";
    } else if (kind === "designing") {
      add(roles, "architect");
      add(inputs, "Approved brief and accommodation schedule", "Findings of the preceding assessment");
      if (!stated) add(deliverables, /concept/.test(description) ? "Concept design report and drawings" : "", /detail/.test(description) ? "Detailed design drawings and specifications" : "Design drawings and specifications");
      risk ||= "Brief changes after design has progressed — the brief is frozen by client sign-off at concept stage and later changes are logged and agreed as variations.";
    } else if (kind === "structural") {
      add(roles, "structural");
      add(inputs, "Architectural layouts", "Site and ground information");
      if (!stated) add(deliverables, "Structural design calculations and drawings");
      risk ||= "Unforeseen existing conditions — structural survey and testing before design is fixed.";
    } else if (kind === "services") {
      add(roles, "electrical", "mechanical", "plumbing");
      add(inputs, "Architectural layouts", "Equipment and services requirements from the client");
      if (!stated) add(deliverables, "Coordinated engineering-services drawings and a coordination log");
      risk ||= "Clashes between services and the architecture — services are coordinated at every design stage and conflicts are closed before issue.";
    } else if (kind === "regulatory") {
      add(roles, "team_leader");
      add(inputs, "Design package", "The standards and approval requirements that apply to the project");
      if (!stated) add(deliverables, "Compliance checklist against the applicable standards", "Approval submission package and comment-response log");
      risk ||= "Approval delays — requirements are checked against the design before submission, and comments are tracked to close-out.";
    } else if (kind === "supervising") {
      add(roles, "supervision");
      add(inputs, "Approved design and specifications", "Contractor programme and submittals");
      add(deliverables, "Site inspection reports and a non-conformance log");
      risk ||= "Works departing from the approved design — inspection hold points before work is covered, and non-conformances closed before the next stage.";
    } else if (kind === "closing") {
      add(roles, "team_leader", "supervision");
      add(inputs, "As-built records", "Inspection and test results");
      if (!stated) add(deliverables, "Final inspection report", "Handover documentation and an operational-readiness checklist");
      risk ||= "Incomplete handover records — the handover checklist is agreed at the start of the works and tracked to completion.";
    }
  }
  // Cost estimates and quantities need a quantity surveyor whatever the item
  // is called.
  if (/cost\s+estimat|bills?\s+of\s+quantit|\bboq\b/.test(description)) {
    add(roles, "quantity_surveyor");
    add(inputs, "Issued drawings and specifications");
  }

  return {
    roles: roles.length > 0 ? roles : ["team_leader"],
    inputs: inputs.length > 0 ? inputs : ["The tender brief and the outputs of the preceding scope item"],
    deliverables,
    risk: risk || "Scope misunderstanding — the item's requirements are confirmed with the client at inception and tracked in the deliverables register.",
    regulatory: kinds.includes("regulatory"),
  };
}

function leadFor(roles: string[], experts: ExpertRecord[], used: Map<string, number>): { lead: ExpertRecord | null; support: ExpertRecord[]; discipline: string } {
  const holders = (role: string) => experts
    .filter((e) => expertTitleRoles(e.title).includes(role))
    .sort((a, b) => ((used.get(a.fullName) ?? 0) - (used.get(b.fullName) ?? 0)) || ((b.yearsExperience ?? 0) - (a.yearsExperience ?? 0)));
  let lead: ExpertRecord | null = null;
  let discipline = ROLE_LABEL[roles[0]] ?? roles[0];
  for (const role of roles) {
    const h = holders(role)[0];
    if (h) { lead = h; discipline = ROLE_LABEL[role] ?? role; break; }
  }
  const support: ExpertRecord[] = [];
  for (const role of roles) {
    for (const h of holders(role)) {
      if (h === lead || support.includes(h)) continue;
      support.push(h);
      break;
    }
    if (support.length >= 3) break;
  }
  if (lead) used.set(lead.fullName, (used.get(lead.fullName) ?? 0) + 1);
  return { lead, support, discipline };
}

function person(e: ExpertRecord): string {
  return `${e.fullName}${e.title ? ` (${e.title})` : ""}`;
}

function cell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").trim() || "—";
}

interface PlannedScopeItem {
  item: ScopeItem;
  traits: ScopeTraits;
  lead: ExpertRecord | null;
  support: ExpertRecord[];
  discipline: string;
}

// One assignment of people to scope items, shared by the delivery plan and by
// every table that says what a team member does, so the two cannot disagree.
function planScopeItems(tenderText: string | null | undefined, experts: ExpertRecord[]): PlannedScopeItem[] {
  const used = new Map<string, number>();
  return extractScopeItems(tenderText).map((item) => {
    const traits = traitsOf(item);
    return { item, traits, ...leadFor(traits.roles, experts, used) };
  });
}

/**
 * The scope items each proposed expert leads and supports, keyed by full name,
 * in the tender's order. Empty when the tender lists no scope items.
 */
export function scopeRolesByExpert(opts: { tenderText: string | null | undefined; experts: ExpertRecord[] }): Map<string, { leads: string[]; supports: string[] }> {
  const roles = new Map<string, { leads: string[]; supports: string[] }>();
  const entry = (name: string) => {
    const existing = roles.get(name);
    if (existing) return existing;
    const created = { leads: [] as string[], supports: [] as string[] };
    roles.set(name, created);
    return created;
  };
  for (const planned of planScopeItems(opts.tenderText, opts.experts)) {
    if (planned.lead) entry(planned.lead.fullName).leads.push(planned.item.title);
    for (const member of planned.support) entry(member.fullName).supports.push(planned.item.title);
  }
  return roles;
}

export function buildScopeDeliveryPlan(opts: { tenderText: string | null | undefined; experts: ExpertRecord[] }): string {
  const planned = planScopeItems(opts.tenderText, opts.experts);
  if (planned.length === 0) return "";
  const blocks: string[] = [
    "## C.3 Scope-by-Scope Delivery Plan",
    "",
    "Each item of the tender's scope of services is answered below in the tender's own order: who leads it, what it takes in, what it hands over, how it is checked and approved, and the main risk it manages.",
    "",
  ];
  planned.forEach(({ item, traits, lead, support, discipline }, index) => {
    const rows: Array<[string, string]> = [
      ["Lead", lead ? person(lead) : `${discipline} (discipline lead)`],
    ];
    if (support.length > 0) rows.push(["Support", support.map(person).join("; ")]);
    rows.push(
      ["Inputs", traits.inputs.join("; ")],
      ["Deliverables", traits.deliverables.length > 0 ? traits.deliverables.join("; ") : "Item report issued to the client"],
      ["Quality check", `Reviewed by a second senior discipline lead against this scope item${traits.regulatory ? " and the applicable standards" : ""} before issue.`],
      ["Approval", `Client sign-off before the dependent item proceeds${traits.regulatory ? "; submission to the approving authority where the project requires it" : ""}.`],
      ["Key risk and mitigation", traits.risk],
    );
    blocks.push(`### ${index + 1}. ${item.title}`, "", `**Tender scope:** ${item.description}`, "", "| Element | Proposed delivery |", "|---|---|");
    for (const [k, v] of rows) blocks.push(`| ${k} | ${cell(v)} |`);
    blocks.push("");
  });
  return blocks.join("\n");
}
