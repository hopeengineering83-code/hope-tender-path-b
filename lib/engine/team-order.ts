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
import { expertTitleRoles, requirementRoleFamilies, titleStatesRole } from "./requirement-constraints";
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

/**
 * The team without the experts the tender gives nothing to do.
 *
 * Selection tops the pool up to a minimum size from experts outside the
 * tender's sector, and every one of them was printed as a team member. A
 * hospital renovation proposal listed a Senior Highway Engineer whose "Role
 * on This Assignment" was the expert's own job title, because no scope item
 * called for that discipline (2026-10-05, hands-off acceptance). An evaluator
 * reads that as padding.
 *
 * Only when the tender lists its scope, so "nothing to do" is known. Kept
 * regardless: the firm's executive, the project manager, anyone the scope plan
 * names as lead or support, and anyone whose title holds a role a personnel
 * requirement names. The team never falls below `minimum`.
 */
export function withoutUnassignedExperts<T extends ExpertRecord>(
  experts: T[],
  tenderText: string | null | undefined,
  opts: { personnelRequirementText?: readonly string[]; minimum?: number } = {},
): { team: T[]; dropped: T[] } {
  if (experts.length < 2 || extractScopeItems(tenderText).length < 2) return { team: experts, dropped: [] };
  const roles = scopeRolesByExpert({ tenderText, experts });
  const requiredFamilies = new Set((opts.personnelRequirementText ?? []).flatMap((text) => requirementRoleFamilies(text)));
  const keep = (e: T): boolean => {
    if (holdsExecutiveOffice(e.title ?? "") || titleStatesRole(e.title, "project manager")) return true;
    const r = roles.get(e.fullName);
    if (r && (r.leads.length > 0 || r.supports.length > 0)) return true;
    return expertTitleRoles(e.title).some((family) => requiredFamilies.has(family));
  };
  const minimum = Math.max(1, opts.minimum ?? 1);
  const team: T[] = [];
  const dropped: T[] = [];
  for (const e of experts) (keep(e) ? team : dropped).push(e);
  // Restore in presentation order until the floor is met.
  while (team.length < minimum && dropped.length > 0) team.push(dropped.shift()!);
  return { team, dropped };
}
