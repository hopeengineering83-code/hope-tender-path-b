// The order the proposed team is presented in.
//
// Every table, bio list and summary sentence prints the team in the order it
// arrives, and that order is the selection ranking — a relevance score, not a
// reporting line. Run 36074770709's local reproduction opened the team table,
// the bios and the Executive Summary ("Led by ... Senior Electrical
// Engineer") with whichever expert ranked first, while the firm's General
// Manager and the expert titled Project Manager sat further down. An
// evaluator reads the first name as the lead.
//
// So the team is presented as it is organised, from the records alone:
//   1. the one who holds an executive office of the firm (signatory.ts),
//   2. the one whose own title says Project Manager,
//   3. experts who lead a scope item, in the tender's scope order,
//   4. experts who support one, then everyone else,
// keeping the selection order within each group. Nobody is added or removed.

import { holdsExecutiveOffice } from "./signatory";
import { titleStatesRole } from "./requirement-constraints";
import { extractScopeItems, scopeRolesByExpert } from "./scope-delivery-plan";
import type { ExpertRecord } from "./benchmark-tables";

export function orderTeamForPresentation<T extends ExpertRecord>(experts: T[], tenderText: string | null | undefined): T[] {
  if (experts.length < 2) return experts;
  const roles = scopeRolesByExpert({ tenderText, experts });
  const scopeOrder = extractScopeItems(tenderText).map((item) => item.title);
  const firstIndex = (titles: string[]) => {
    const positions = titles.map((t) => scopeOrder.indexOf(t)).filter((i) => i >= 0);
    return positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
  };
  const executives = experts.filter((e) => holdsExecutiveOffice(e.title ?? ""));
  const rank = (e: T): [number, number] => {
    // Only a single executive is placed first; two would leave the record
    // silent on which of them leads, and selection order decides.
    if (executives.length === 1 && executives[0] === e) return [0, 0];
    if (titleStatesRole(e.title, "project manager")) return [1, 0];
    const r = roles.get(e.fullName);
    if (r && r.leads.length > 0) return [2, firstIndex(r.leads)];
    if (r && r.supports.length > 0) return [3, firstIndex(r.supports)];
    return [4, 0];
  };
  return experts
    .map((e, index) => ({ e, index, rank: rank(e) }))
    .sort((a, b) => (a.rank[0] - b.rank[0]) || (a.rank[1] - b.rank[1]) || (a.index - b.index))
    .map((x) => x.e);
}
