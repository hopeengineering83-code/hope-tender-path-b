/**
 * The proposal speaks to the client, not about its own evidence store.
 *
 * WHAT THE DELIVERED DOCUMENT SAID
 * --------------------------------
 * The word "reviewed" appears 28 times in the delivered PDF. Some are the
 * firm's real quality process — "peer-reviewed against the applicable
 * standards", "reviewed through three mandatory stages", "the risk register is
 * reviewed monthly" — and those are exactly right.
 *
 * The rest are this application's own vocabulary. Inside the engine, "reviewed"
 * means a record passed SOURCE_VERIFIED, and that distinction governs what may
 * be claimed. In front of an evaluator it means nothing, and it reads as a
 * bidder hedging its own track record:
 *
 *   "Hope ... has reviewed G+6 General Hospital as relevant reference
 *    experience."                       — the firm delivered it; it did not review it
 *   "brings relevant reviewed experience to this assignment"
 *   "Led by Ahmed Kebede Tekaw, whose reviewed record states 11+ years"
 *   "has 11 years experience recorded in the reviewed specialist record"
 *   "The proposed disciplines are mapped to the tender's healthcare scope;
 *    individual experience claims remain limited to each reviewed specialist
 *    record."                           — an internal provenance caveat, verbatim
 *
 * The last one is the clearest case: it is a statement about the app's own
 * confidence policy, addressed to nobody in the room.
 *
 * WHAT THIS PASS MAY AND MAY NOT DO
 * ---------------------------------
 * Every rewrite below states the SAME claim in the register a client document
 * uses. None of them makes a claim larger:
 *
 *   "whose reviewed record states 11+ years of professional experience"
 *     -> "with 11+ years of professional experience"     — same number, same source
 *   "has 11 years experience recorded in the reviewed specialist record"
 *     -> "has 11 years of experience"                    — same number
 *   "has reviewed X as relevant reference experience"
 *     -> "presents X as relevant reference experience"   — same relationship
 *
 * It removes hedging vocabulary, never a substantive qualification. A sentence
 * that limits scope — "only where the confirmed equipment brief and applicable
 * authority require them" — is a real constraint on a real claim and is not
 * touched. And none of this weakens a gate: the authority model, the
 * SOURCE_VERIFIED controls and the export gates are enforced in code and are
 * completely unaffected by the words the finished document uses.
 */

interface RegisterRule {
  readonly pattern: RegExp;
  readonly replacement: string;
  /** Why this rewrite cannot strengthen the claim it rewrites. */
  readonly rationale: string;
}

const RULES: readonly RegisterRule[] = [
  {
    pattern: /\bhas reviewed\b(?=[^.]*\bas (?:a )?relevant reference experience)/gi,
    replacement: "presents",
    rationale: "the firm delivered the project; 'presents' states the same relationship without claiming more",
  },
  {
    pattern: /\brelevant reviewed experience\b/gi,
    replacement: "relevant experience",
    rationale: "drops an internal verification adjective, not the claim",
  },
  {
    pattern: /,?\s*whose reviewed record states ([^,]+?),/gi,
    replacement: ", with $1,",
    rationale: "same figure, same source, without narrating where it was read",
  },
  {
    pattern: /\bhas (\d+\+?) years?(?: of)? experience recorded in the reviewed specialist record\b/gi,
    replacement: "has $1 years of experience",
    rationale: "same figure; the record remains its source, unstated",
  },
  {
    pattern: /\s*\bagainst the reviewed specialist record\b/gi,
    replacement: "",
    rationale: "removes a dangling provenance phrase that qualifies nothing",
  },
  {
    pattern: /\breviewed specialist disciplines\b/gi,
    replacement: "each specialist's disciplines",
    rationale: "same disciplines, named as the client would name them",
  },
  {
    pattern: /\bNot recorded in the reviewed specialist record\b/gi,
    replacement: "Not stated in the specialist's record",
    rationale: "states the same absence in plain words",
  },
  {
    pattern: /\ba reviewed project record\b/gi,
    replacement: "a completed project record",
    rationale: "'completed' is what the record is; 'reviewed' is how this app classified it",
  },
  {
    pattern: /\breviewed (hospital and medical-centre|project|company|specialist) records\b/gi,
    replacement: "$1 records",
    rationale: "drops the internal verification adjective only",
  },
];

/**
 * Whole sentences that say nothing to a client because they are about the
 * application's own confidence policy. Removed entire — never rewritten into a
 * stronger claim.
 */
const INTERNAL_CAVEAT_SENTENCES: readonly RegExp[] = [
  // The clause only; its sentence keeps its own terminal punctuation.
  /\s*(?:;|,)\s*individual experience claims remain limited to each reviewed specialist record\b/gi,
];

// NOT removed, deliberately: "each applicable standard remains subject to the
// tender and authority requirements". That reads like boilerplate but it is a
// real qualification — it says the firm's own standards do not override the
// tender's or the authority's. Deleting it would leave the World Bank ESF
// sentence claiming more than it currently does, which is the one thing this
// pass must never do.

export interface ClientRegisterResult {
  readonly text: string;
  /** How many rewrites fired, by rule index — for the generation log. */
  readonly rewrites: number;
  readonly caveatsRemoved: number;
}

/**
 * Bring client-facing prose into a client-facing register.
 *
 * Safe to run over the whole document: every pattern is anchored to the
 * provenance phrasing itself, so the firm's genuine review process — "the
 * deliverable is peer-reviewed", "reviewed through three mandatory stages",
 * "reviewed monthly" — is left exactly as written.
 */
export function applyClientRegister(text: string): ClientRegisterResult {
  let out = text;
  let rewrites = 0;
  let caveatsRemoved = 0;

  for (const rule of RULES) {
    out = out.replace(rule.pattern, (...args) => {
      rewrites += 1;
      // Build the replacement with $1 semantics preserved.
      const groups = args.slice(1, -2) as string[];
      return rule.replacement.replace(/\$(\d)/g, (_, index) => groups[Number(index) - 1] ?? "");
    });
  }

  for (const sentence of INTERNAL_CAVEAT_SENTENCES) {
    out = out.replace(sentence, () => {
      caveatsRemoved += 1;
      return "";
    });
  }

  // A removed clause can leave " ." or a doubled space behind.
  out = out.replace(/[ \t]+([.;,])/g, "$1").replace(/([^\S\n])[^\S\n]+/g, "$1");

  return { text: out, rewrites, caveatsRemoved };
}
