// Who signs the proposal, from the firm's own records — never invented.
//
// Run 36074770709 ended its cover letter "Sincerely, <firm>": both cover
// builders printed a signatory only when the company record carried a
// general-manager field, and this firm's record does not. Its general manager
// is nevertheless named in its own evidence — the proposed expert whose CV
// title reads "General Manager & Practicing Professional Engineer". A letter
// signed by nobody reads as unfinished; a letter signed by an invented name or
// title is worse. So the signatory is, in order:
//   1. the company record's general manager, when set;
//   2. otherwise the one proposed expert whose own title states an executive
//      office of the firm (general manager, managing director, chief
//      executive, managing partner) — exactly one, or nobody, because two
//      candidates means the record does not say which one signs;
//   3. otherwise no name at all: "For and on behalf of <firm>".
// A registration is printed only when the same record states one. No
// signature image, stamp or contact detail is produced here.

import { licencesNamedInCv } from "./cv-grounding";

export interface Signatory {
  name: string;
  title: string;
  registration: string | null;
}

interface SignatoryExpert {
  fullName?: string | null;
  title?: string | null;
  certifications?: string | null;
  profile?: string | null;
}

const EXECUTIVE_OFFICE = /\b(?:general\s+manager|managing\s+director|chief\s+executive(?:\s+officer)?|ceo|managing\s+partner)\b/i;
// A deputy, assistant or vice holder does not hold the office. The Pharo
// team carried both "General Manager & Practicing Professional Engineer" and
// "Deputy General Manager / Senior Civil Engineer"; counting both left the
// letter unsigned.
const SUBORDINATE_OFFICE = /\b(?:deputy|assistant|vice|acting|associate)\s+(?:general\s+manager|managing\s+director|chief\s+executive|ceo|managing\s+partner)\b/gi;

function holdsExecutiveOffice(title: string): boolean {
  return EXECUTIVE_OFFICE.test(title.replace(SUBORDINATE_OFFICE, " "));
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function storedCertifications(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let values: unknown = raw;
  try {
    values = JSON.parse(raw);
  } catch {
    values = raw.split(/[;\n]/);
  }
  const list = Array.isArray(values) ? values : [values];
  return list
    .map((v) => clean(String(v ?? "")))
    .filter((v) => v.length > 2 && !/^(?:[-—–]+|n\/?a|none|nil|not\s+(?:stated|available|applicable))$/i.test(v));
}

function registrationOf(expert: SignatoryExpert): string | null {
  const stored = storedCertifications(expert.certifications);
  const named = stored.length > 0 ? stored : licencesNamedInCv(expert.profile ?? "");
  return named[0] ?? null;
}

/**
 * Parse the writer's expert proof lines ("Name — Title | 11+ years | ...")
 * into the fields the resolver reads. The per-section writer receives the
 * experts only as these lines.
 */
export function signatoryExpertsFromProofLines(text: string | null | undefined): SignatoryExpert[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .map((line) => line.match(/^([^—|\n]{3,80}?)\s+—\s+([^|\n]{3,160})/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ fullName: clean(m[1]), title: clean(m[2]) }));
}

export function resolveSignatory(opts: {
  gmName?: string | null;
  gmTitle?: string | null;
  gmLicense?: string | null;
  experts?: SignatoryExpert[] | null;
}): Signatory | null {
  const gm = clean(opts.gmName);
  if (gm) {
    return { name: gm, title: clean(opts.gmTitle) || "General Manager", registration: clean(opts.gmLicense) || null };
  }
  const holders = (opts.experts ?? []).filter((e) => clean(e?.fullName) && holdsExecutiveOffice(clean(e?.title)));
  const distinct = new Map(holders.map((e) => [clean(e.fullName).toLowerCase(), e]));
  if (distinct.size !== 1) return null;
  const [expert] = distinct.values();
  return { name: clean(expert.fullName), title: clean(expert.title), registration: registrationOf(expert) };
}

/** The printed sign-off: closing, name, title, registration, on behalf of the firm. */
export function signOffLines(companyName: string, signatory: Signatory | null): string[] {
  const firm = clean(companyName) || "the firm";
  if (!signatory) return ["Sincerely,", "", `For and on behalf of ${firm}`];
  return [
    "Sincerely,",
    "",
    `**${signatory.name}**`,
    signatory.title,
    ...(signatory.registration ? [signatory.registration] : []),
    `For and on behalf of ${firm}`,
  ];
}
