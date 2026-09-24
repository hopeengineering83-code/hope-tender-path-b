/**
 * Does the tender ask for this?
 *
 * The engine can add a set of supplementary sections on its own: an ESG plan,
 * a health-and-safety plan, innovation proposals, local-content commitments,
 * an anti-bribery declaration, a no-conflict-of-interest declaration. Each one
 * makes commitments on the firm's behalf (KPIs, policies, sworn statements
 * such as "not under any debarment"), and none of them is backed by anything
 * the firm uploaded. A delivered proposal for a tender that mentions none of
 * these topics carried all of them, which is how its contents page reached 63
 * entries, and it declared facts about the firm the app cannot know.
 *
 * A supplementary section is now written only when the tender itself raises
 * its topic. When it does, the section answers the tender; when it does not,
 * the proposal answers what was asked. The signals are topic words, not any
 * one tender's phrasing.
 */

export type SupplementaryTopic =
  | "sustainability"
  | "health-safety"
  | "innovation"
  | "local-content"
  | "ethics-declaration"
  | "conflict-of-interest-declaration";

const TOPIC_SIGNALS: Record<SupplementaryTopic, RegExp> = {
  sustainability: /\bsustainab|\besg\b|environmental\s+(?:and|&)\s+social|\be\s*&\s*s\b|green\s+building|energy[-\s]efficien|climate|carbon|environmental\s+(?:management|impact|protection|safeguard)|effluent|emission/i,
  // "Safety requirements" in a building-regulation sentence is compliance
  // scope, not a request for an occupational health-and-safety plan.
  "health-safety": /health\s*(?:and|&)\s*safety|\bohs\b|\boh&s\b|\bosh\b|\bhse\b|safety\s+(?:plan|management|policy|officer|record)|occupational|site\s+safety/i,
  innovation: /\binnovat|value[-\s]engineering|alternative\s+(?:design|solution|proposal)s?\b|cost[-\s]saving/i,
  "local-content": /local\s+content|capacity[-\s]building|skills?\s+transfer|knowledge\s+transfer|technology\s+transfer|local\s+(?:labou?r|employment|firms?|staff|suppliers?)/i,
  "ethics-declaration": /brib|corrupt|\bethic|integrity|fraud|collusi/i,
  // Not a bare "suspension" or "sanction": a road tender's suspension bridge
  // or a planning sanction is not a request for a debarment declaration.
  "conflict-of-interest-declaration": /conflict\s+of\s+interest|\bdebar|suspended\s+from|sanctions?\s+list|ineligib|eligibility\s+declaration/i,
};

/**
 * True when the tender text raises the topic.
 *
 * `undefined` means the caller has no tender text at all (a unit caller or a
 * legacy path) and keeps the section, as before. An empty string is a tender
 * that says nothing, and asks for nothing.
 */
export function tenderAsksFor(topic: SupplementaryTopic, tenderText: string | null | undefined): boolean {
  if (tenderText === undefined) return true;
  return TOPIC_SIGNALS[topic].test(String(tenderText ?? ""));
}
