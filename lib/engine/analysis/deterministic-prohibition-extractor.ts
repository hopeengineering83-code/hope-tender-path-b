/**
 * Deterministic prohibition extractor — pure-regex tender-text scan
 * that produces the same shape as the semantic comprehension's
 * `prohibitions` field. Designed to feed the existing constraint
 * validator (`validateConstraints` in lib/engine/constraint-validator.ts)
 * WITHOUT requiring deep-reasoning + Claude to be configured.
 *
 * Why this exists: the semantic prohibition extraction in
 * `evaluation-criteria-extractor.ts` is gated behind
 * TENDER_DEEP_REASONING + Claude. Users running the engine on
 * Hobby / without Claude keys had ZERO prohibition checking. Real
 * tenders routinely state "no joint ventures permitted", "no
 * subcontracting", "no advance payment" — these are catastrophic if
 * ignored. A regex scan of the tender body catches the high-confidence
 * cases and surfaces them in the standard validate.ts pipeline.
 *
 * Coverage: 8 prohibition families, each anchored to phrases real
 * tenders use:
 *
 *   - Joint venture / consortium / teaming arrangements forbidden
 *   - Subcontracting forbidden
 *   - Advance payment / mobilisation fee forbidden
 *   - Financial content in the technical envelope (two-envelope rule)
 *   - Contract assignment / transfer forbidden
 *   - Additional cost to client forbidden
 *   - Foreign-firm / foreign-ownership restriction
 *   - Bidder must be sole / sole prime required
 *
 * Each family carries multiple trigger patterns so wording variations
 * (USAID-style, EU-style, government-style) all hit. The scanner
 * returns DEDUPED prohibition strings (one per family, even when
 * multiple sentences trigger the same family).
 *
 * Limitations: this is a SIGNAL detector, not an interpretation
 * engine. It can't tell when a prohibition is being NEGATED ("we
 * accept joint ventures from regional firms"). Those edge cases
 * are intentionally accepted — over-triggering prohibitions errs on
 * the side of bidder caution, which is the safer default.
 */

import type { DeepTenderComprehension } from "./evaluation-criteria-extractor";

type ProhibitionPattern = {
  /** Canonical statement returned in the comprehension.prohibitions list. */
  canonical: string;
  /** One or more regex patterns; ANY match in the tender text triggers this prohibition. */
  triggers: RegExp[];
};

const PROHIBITION_PATTERNS: ProhibitionPattern[] = [
  {
    canonical: "No joint ventures / consortia / teaming arrangements permitted",
    triggers: [
      // "No joint ventures (are) permitted" — direct prohibition
      /(?:no|not|never)\s+(?:joint\s+ventures?|consorti(?:um|a)|\bjvs?\b)\s+(?:\w+\s+){0,3}?(?:are\s+|will\s+be\s+|may\s+be\s+)?(?:allowed|permitted|accepted)/i,
      // "Joint ventures (...) are not allowed" — keyword + optional noun + verb + negation. The
      //   intervening `(?:\w+\s+){0,3}?` allows wording like "Consortium arrangements are not allowed".
      /(?:joint\s+ventures?|consorti(?:um|a)|\bjvs?\b)\s+(?:\w+\s+){0,3}?(?:are|is|will\s+be|may\s+be)\s+(?:not\s+(?:allowed|permitted|accepted)|forbidden|prohibited|disallowed)/i,
      /(?:single|sole)\s+(?:firm|bidder|prime|entity)\s+(?:only|required|mandatory)/i,
    ],
  },
  {
    canonical: "Sub-contracting of core services is not permitted",
    triggers: [
      /(?:no|not|never)\s+sub[-\s]?contract(?:ing)?\s+(?:is\s+|are\s+|will\s+be\s+|may\s+be\s+)?(?:allowed|permitted|accepted)/i,
      /sub[-\s]?contract(?:ing|s|or)?\s+(?:is|are|will\s+be)\s+(?:not\s+(?:allowed|permitted|accepted)|forbidden|prohibited|disallowed)/i,
      /(?:bidder|firm|contractor)\s+(?:shall|must|may)\s+not\s+sub[-\s]?contract/i,
    ],
  },
  {
    canonical: "Advance payment / mobilisation fee is not permitted",
    triggers: [
      /(?:no|not|never)\s+advance\s+payments?\s+(?:will\s+be\s+|are\s+|may\s+be\s+)?(?:made|allowed|permitted|accepted)/i,
      /advance\s+payments?\s+(?:are|is|will\s+be)\s+(?:not\s+(?:allowed|permitted|accepted)|forbidden|prohibited)/i,
      /(?:no|not|never)\s+mobili(?:s|z)ation\s+(?:fee|advance|payment)/i,
    ],
  },
  {
    canonical: "Financial content must NOT appear in the technical envelope (two-envelope rule)",
    triggers: [
      /two[-\s]?envelopes?\s+(?:submission|bid|system|process)/i,
      /technical\s+(?:envelope|proposal)\s+(?:shall|must|will)\s+not\s+(?:contain|include|reference)\s+(?:any\s+)?(?:price|cost|financial|fee)/i,
      /(?:price|cost|financial|commercial)\s+(?:information|details?|content)\s+(?:shall|must|will)\s+(?:not\s+(?:appear|be\s+included)|be\s+excluded)\s+(?:from|in)\s+the\s+technical/i,
      /separate\s+(?:financial|price|cost|commercial)\s+envelope/i,
    ],
  },
  {
    canonical: "Contract assignment / transfer to a third party is not permitted",
    triggers: [
      /(?:contract|agreement)\s+(?:shall|may|must)\s+not\s+(?:be\s+)?(?:assigned|transferred|delegated)/i,
      /no\s+assignment\s+of\s+(?:the\s+)?contract/i,
      /assignment\s+(?:of\s+(?:the\s+)?contract\s+)?(?:is|are|will\s+be)\s+(?:not\s+(?:allowed|permitted)|forbidden|prohibited)/i,
    ],
  },
  {
    canonical: "No additional cost / purchase obligation may fall on the client",
    triggers: [
      /(?:no|not|never)\s+additional\s+(?:cost|fee|charge|payment|expense)\s+(?:to|for|on)\s+(?:the\s+)?client/i,
      /(?:client|customer)\s+(?:shall|must|may|will)\s+not\s+(?:be\s+(?:required|expected)\s+to\s+)?(?:purchase|procure|acquire|pay\s+for|license)/i,
      /all\s+(?:software|licences?|tools|equipment)\s+(?:shall|must)\s+be\s+(?:provided|included)\s+(?:at\s+no\s+(?:cost|charge|expense)\s+to\s+(?:the\s+)?client)/i,
    ],
  },
  {
    canonical: "Foreign-firm / foreign-ownership restrictions apply",
    triggers: [
      /(?:no|not|never)\s+foreign\s+(?:firms?|consultants?|companies|nationals?|entities)\s+(?:are\s+|will\s+be\s+|may\s+be\s+)?(?:allowed|permitted|accepted)/i,
      /foreign\s+(?:firms?|consultants?|companies|nationals?|entities)\s+(?:are|is|will\s+be)\s+(?:not\s+eligible|excluded|ineligible)/i,
      /(?:only|exclusively)\s+(?:domestic|local|national|indigenous)\s+(?:firms?|consultants?|companies|bidders?)/i,
    ],
  },
  {
    canonical: "Bidder must operate as sole prime contractor (no alliance / partnership arrangement)",
    triggers: [
      /(?:no|not|never)\s+(?:alliance|partnership|teaming)\s+(?:arrangements?|agreements?)\s+(?:are\s+|will\s+be\s+|may\s+be\s+)?(?:allowed|permitted|accepted)/i,
      /(?:alliance|partnership|teaming)\s+(?:arrangements?|agreements?)\s+(?:are|is|will\s+be)\s+(?:not\s+(?:allowed|permitted)|forbidden|prohibited)/i,
    ],
  },
];

export type DeterministicProhibitionResult = {
  prohibitions: string[];
  /** Per-prohibition trigger evidence (the matched substring), useful for diagnostics. */
  evidence: Array<{ canonical: string; trigger: string }>;
};

/**
 * Scan tender text and return matched prohibitions in dedupe order.
 * Pure function — no AI, no DB, no async.
 */
export function extractProhibitionsDeterministic(tenderText: string): DeterministicProhibitionResult {
  if (!tenderText || tenderText.trim().length === 0) {
    return { prohibitions: [], evidence: [] };
  }
  const seen = new Set<string>();
  const prohibitions: string[] = [];
  const evidence: Array<{ canonical: string; trigger: string }> = [];
  for (const pattern of PROHIBITION_PATTERNS) {
    for (const trigger of pattern.triggers) {
      const match = tenderText.match(trigger);
      if (match) {
        if (!seen.has(pattern.canonical)) {
          seen.add(pattern.canonical);
          prohibitions.push(pattern.canonical);
        }
        evidence.push({ canonical: pattern.canonical, trigger: match[0].slice(0, 200) });
        break; // one trigger per family is enough; move to the next family
      }
    }
  }
  return { prohibitions, evidence };
}

/**
 * Adapter that returns a DeepTenderComprehension-shaped object with
 * ONLY the prohibitions field populated. The constraint validator
 * (`validateConstraints` in lib/engine/constraint-validator.ts)
 * accepts this shape and will run its prohibition sweep against the
 * proposal markdown.
 *
 * Criteria + disqualifiers + reasoning are intentionally empty —
 * those genuinely require semantic understanding (weights, mandatory
 * vs preferred, evidence types) that regex can't deliver. The
 * deterministic path provides the high-signal prohibitions only.
 */
export function buildDeterministicComprehension(tenderText: string): DeepTenderComprehension | null {
  const result = extractProhibitionsDeterministic(tenderText);
  if (result.prohibitions.length === 0) return null;
  return {
    reasoning: `Deterministic regex scan detected ${result.prohibitions.length} prohibition pattern(s) in the tender text. Criteria / disqualifiers / weights are not extracted by this path — enable TENDER_DEEP_REASONING + an AI provider to get the full semantic comprehension.`,
    criteria: [],
    disqualifiers: [],
    prohibitions: result.prohibitions,
    totalWeightAccountedFor: null,
  };
}
