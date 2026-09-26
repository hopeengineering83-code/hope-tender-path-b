// Which of the tender's scope items a past project's recorded services answer.
//
// The portfolio card's "Relevance to This Assignment" row used to say "Same
// sector as this assignment (Healthcare). Services the firm provided: —." in
// run 36074770709 — the sector, then the services row above it again (blanked
// by the repetition guard). What an evaluator wants from that row is the link
// the card does not otherwise make: which parts of THIS tender's scope the
// project's services correspond to. Both sides are source text — the tender's
// own scope items and the project record's own service list.
//
// A service answers a scope item when both are the same kind of work
// (assessing, designing, structural, building services, regulatory,
// supervising, closing out — the kinds scope-delivery-plan.ts reads from the
// item's title), or when the service names the item's own subject
// ("Renovation design" for "Renovation Planning ..."). Matching words across
// the item's whole description linked "Laboratory testing" to an item that
// lists the hospital's laboratory department.

import { scopeKindsOf, type ScopeItem } from "./scope-delivery-plan";

export interface ScopeMatch {
  /** 1-based position of the scope item in the tender. */
  index: number;
  title: string;
  /** The project's own service labels that correspond to it. */
  services: string[];
}

const SERVICE_KINDS: Array<[RegExp, string]> = [
  [/feasib|assess|investigat|survey|geotech|site\s+(?:selection|analysis)|due\s+diligence/i, "assessing"],
  [/architect|interior|space\s+planning|master\s*plan|urban\s+design|(?:modification|renovation|conceptual|detailed)\s+design/i, "designing"],
  [/structur/i, "structural"],
  [/\bmep\b|mechanical|electrical|plumbing|sanitary|hvac|medical\s+gas|electro-?mechanical/i, "services"],
  [/approv|permit|regulat|licens/i, "regulatory"],
  [/supervis|contract\s+administration|oversight|inspection/i, "supervising"],
  [/handover|commission|close[-\s]?out|as[-\s]built/i, "closing"],
];

// Specifications, quantities and tender documents answer an item whose own
// words ask for them.
const DOCUMENTS_SERVICE = /specification|quantit|bill\s+of|tender\s+document/i;
const DOCUMENTS_ITEM = /specification|quantit|bill\s+of|tender\s+document/i;

const TITLE_STOP = new Set(["services", "service", "support", "project", "planning", "implementation", "detailed", "conceptual", "technical", "and", "the", "for", "of", "design"]);

function titleStems(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !TITLE_STOP.has(w)).map((w) => w.slice(0, 6)));
}

function recordedServices(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { list = raw.split(/[;,|]/); }
  }
  return (Array.isArray(list) ? list : [])
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 2 && !/^[-—–]+$/.test(v));
}

function serviceAnswers(service: string, item: ScopeItem, itemKinds: string[]): boolean {
  const kinds = SERVICE_KINDS.filter(([rx]) => rx.test(service)).map(([, kind]) => kind);
  if (kinds.some((k) => itemKinds.includes(k))) return true;
  if (DOCUMENTS_SERVICE.test(service) && DOCUMENTS_ITEM.test(`${item.title} ${item.description}`)) return true;
  const own = titleStems(item.title);
  return [...titleStems(service)].some((stem) => own.has(stem));
}

/** Scope items the project's services correspond to, in the tender's order. */
export function scopeItemsAnsweredByProject(serviceAreas: unknown, scopeItems: ScopeItem[]): ScopeMatch[] {
  const services = recordedServices(serviceAreas);
  if (services.length === 0 || scopeItems.length === 0) return [];
  const matches: ScopeMatch[] = [];
  scopeItems.forEach((item, i) => {
    const kinds = scopeKindsOf(item);
    // The most specific first: a service naming the item's own subject
    // ("renovation design" for renovation planning), then one of a narrower
    // kind than design, then the rest.
    const own = titleStems(item.title);
    const specificity = (service: string) =>
      [...titleStems(service)].some((stem) => own.has(stem)) ? 0 : /design/i.test(service) ? 2 : 1;
    const matched = services
      .filter((service) => serviceAnswers(service, item, kinds))
      .map((service, order) => ({ service, order, rank: specificity(service) }))
      .sort((a, b) => (a.rank - b.rank) || (a.order - b.order))
      .map((x) => x.service);
    if (matched.length > 0) matches.push({ index: i + 1, title: item.title, services: matched });
  });
  return matches;
}

/** One sentence naming the scope items a project's services answer, or "". */
export function scopeRelevanceSentence(serviceAreas: unknown, scopeItems: ScopeItem[]): string {
  const matches = scopeItemsAnsweredByProject(serviceAreas, scopeItems);
  if (matches.length === 0) return "";
  const label = (service: string) => (/^[A-Z]{2,}\b/.test(service) ? service : service.charAt(0).toLowerCase() + service.slice(1));
  const parts = matches.slice(0, 4).map((m) => `${m.title} (${m.services.slice(0, 2).map(label).join(", ")})`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join("; ")} and ${parts[parts.length - 1]}`;
  return `The firm's recorded services on this project correspond to ${matches.length === 1 ? "this tender's scope item" : "these scope items of this tender"}: ${list}.`;
}
