// What the tender asks to be attached, and how the proposal speaks about it.
//
// 2026-10-05, hands-off acceptance: the tender asked for "a single electronic
// PDF file named 'Technical Proposal.pdf' containing all required sections and
// annexes" and to "attach supporting documents such as company profile,
// healthcare project references, professional CVs, licenses, and
// certificates". The proposal told the evaluator, five times, that copies
// "can be provided on request" — a reply to a tender that had already asked
// for them. The owner attaches the originals; the proposal's job is to say
// they are attached and to list them in the tender's order, so the owner and
// the evaluator read the same list.
//
// Nothing here claims a document exists. The list is the tender's, not the
// vault's, and it is printed only when the tender asks for attachments.

export type AnnexPolicy = { required: boolean; items: string[] };

const ATTACH_VERB = /\b(?:attach(?:ed|ing)?|enclos(?:e|ed|ing)|annex(?:ed|es)?|appendi(?:x|ces)|supporting\s+documents?|containing\s+all\s+required\s+sections\s+and\s+annexes)\b|\b(?:provide|submit)\s+(?:a\s+|the\s+)?(?:valid\s+|certified\s+)?(?:cop(?:y|ies)|evidence|proof)\s+of\b/i;

/** Annex kinds, tested against the tender's own wording; listed in the order the tender first names them. */
const ANNEX_KINDS: Array<{ name: string; test: RegExp }> = [
  { name: "Company profile", test: /\bcompany\s+profile\b/i },
  { name: "Business licence and registration certificates", test: /\bbusiness\s+licen[cs]e|\bcommercial\s+registration|\bregistration\s+certificate|\btrade\s+licen[cs]e/i },
  { name: "Tax clearance, VAT and TIN certificates", test: /\btax\s+clearance|\bVAT\b|\bTIN\b/ },
  { name: "Curricula vitae of the proposed experts", test: /\bCVs?\b|\bcurricul(?:um|a)\s+vita/i },
  { name: "Professional licences and certificates of the proposed experts", test: /\b(?:professional\s+)?licen[cs]es\b|\bcertificates\b|\bcertifications\b/i },
  { name: "Client reference and completion letters for the cited projects", test: /\b(?:project\s+)?references\b|\breference\s+letters?\b|\btestimon(?:y|ial)|\bcompletion\s+certificate/i },
  { name: "Audited financial statements", test: /\baudited\s+financial|\bfinancial\s+statements\b/i },
  { name: "Power of attorney", test: /\bpower\s+of\s+attorney\b/i },
];

/**
 * The tender's attachment requirement. `requirementTexts` are the extracted
 * requirement rows (title + description); only rows that ask to attach,
 * enclose or annex something are read for the list.
 */
export function tenderAnnexPolicy(requirementTexts: readonly string[]): AnnexPolicy {
  const attachRows = requirementTexts.filter((t) => ATTACH_VERB.test(t));
  if (attachRows.length === 0) return { required: false, items: [] };
  const text = attachRows.join("\n");
  const found = ANNEX_KINDS
    .map((kind) => ({ name: kind.name, at: text.search(kind.test) }))
    .filter((k) => k.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((k) => k.name);
  return { required: found.length > 0, items: found };
}

/**
 * The proposal as the tender's attachment rule requires it. Copies the tender
 * asks for are "listed in the Annex Schedule", not "available on request",
 * and the schedule names them in the tender's order before the declaration.
 *
 * It never says they are attached: the owner attaches the originals after the
 * app's package is built, so at generation time that would be a claim with no
 * package-level proof, which the document quality gate rightly refuses
 * (PHANTOM_ATTACHMENT_CLAIM). A first version said "attached as annexes" and
 * auto-finalize stopped on GENERATED_DOCUMENT_QUALITY_FAILED (2026-10-06).
 */
export function applyAnnexPolicy(markdown: string, policy: AnnexPolicy): string {
  if (!policy.required) return markdown;
  let out = markdown
    .replace(/\bcan be provided on request\b/gi, "are listed in the Annex Schedule")
    .replace(/\b(?:are\s+)?available on request\b/gi, "listed in the Annex Schedule");
  if (/^#\s+Annex Schedule\b/im.test(out)) return out;
  const list = [
    "# Annex Schedule",
    "",
    "The supporting documents the tender requires with this proposal, in the order the tender lists them:",
    "",
    ...policy.items.map((item, i) => `- Annex ${i + 1}: ${item}`),
    "",
  ].join("\n");
  const declaration = out.search(/^#\s+Declaration\b/im);
  out = declaration >= 0 ? `${out.slice(0, declaration)}${list}\n${out.slice(declaration)}` : `${out.trimEnd()}\n\n${list}`;
  return out;
}
