/**
 * Constraint validator — closes audit gap #4 (compliance reasoning
 * checks presence/absence only; no constraint-satisfaction or
 * prohibition parsing).
 *
 * Two complementary capabilities:
 *
 *   1. DETERMINISTIC SWEEP (`validateConstraints`). Pure function
 *      that scans the generated proposal markdown for canonical
 *      prohibition signals — JV mentions when no JVs are allowed,
 *      subcontracting mentions when subcontracting is forbidden,
 *      etc. Cheap, always-runnable, no AI cost.
 *
 *   2. CRITIC-PROMPT FORMATTERS (`formatConstraintsForCritique`,
 *      `formatViolationsForCritique`). Render the comprehension's
 *      disqualifiers + prohibitions (and any deterministic
 *      violations found) as a text block injected into the
 *      deep-reasoning critic prompt. The critic then verifies each
 *      rule against the proposal and the rewriter strips violations.
 *
 * Together they implement constraint satisfaction over the proposal:
 * the deterministic sweep catches obvious violations cheaply; the
 * critic-prompt formatters surface every rule to Claude so subtle
 * violations are caught semantically.
 *
 * The deterministic sweep is intentionally narrow. It only flags
 * HIGH-CONFIDENCE signals — phrases that are nearly always
 * disqualifying when prohibited. False positives here trigger
 * unnecessary refinement passes, which is more costly than missing
 * a subtle violation that the critic will catch anyway. The
 * conservative design errs toward letting the critic handle anything
 * non-obvious.
 */

import type { DeepTenderComprehension, DisqualifyingCondition } from "./evaluation-criteria-extractor";

export type ConstraintViolation = {
  /** Categorises the violation source. */
  type: "prohibition" | "disqualifier";
  /** The rule text from the comprehension (verbatim where possible). */
  rule: string;
  /** Up to ~200 chars of proposal text containing the violation signal. */
  evidence: string;
  /** Heading or line context where the evidence appeared. Null when the violation was found outside any heading. */
  location: string | null;
  /** Severity. CRITICAL violations should block export when surfaced through the validate pipeline. */
  severity: "CRITICAL" | "WARNING";
  /** One-sentence remediation hint for the rewriter. */
  suggestion: string;
};

export type ConstraintValidationResult = {
  violations: ConstraintViolation[];
  /** Rules that were checked deterministically and found clean. Useful for transparency. */
  cleared: string[];
  /** Rules that the deterministic sweep cannot meaningfully check (e.g. "Lead firm must have ≥5 years"); deferred to the critic. */
  deferredToCritic: string[];
};

const PROHIBITION_PATTERNS: Array<{
  /** Regex that matches the prohibition statement itself in the rule text. */
  matchesRule: RegExp;
  /** Regex that matches a likely VIOLATION in the proposal markdown. */
  matchesProposal: RegExp;
  /** Suggested remediation for the rewriter. */
  suggestion: string;
}> = [
  {
    // "No joint ventures permitted", "JV not allowed", "consortium prohibited"
    matchesRule: /(joint\s*ventures?|consorti(?:um|a)|\bjvs?\b)/i,
    // Triggers on PROPOSAL phrases like "joint venture with", "JV partner", "consortium of"
    matchesProposal: /(\bjoint\s+venture\b(?:\s+(?:with|partner|arrangement))|\bjv\s+(?:with|partner|arrangement)|consortium\s+of|consortium\s+with|consortium\s+partner|consortium\s+arrangement)/i,
    suggestion: "Remove every mention of a joint venture, JV partner, or consortium arrangement. State the firm bids as sole prime, in line with the tender's prohibition.",
  },
  {
    matchesRule: /(sub[-\s]?contract(?:ing)?|sub[-\s]?contractor)/i,
    matchesProposal: /(sub[-\s]?contract(?:ed|ing)?\s+(?:to|with|out|the)|sub[-\s]?contractor\s+(?:will|shall|to|delivering))/i,
    suggestion: "Remove proposed subcontracting arrangements; state that all scope is delivered by the firm's in-house team, in line with the tender's prohibition.",
  },
  {
    // "No blacklisted firms" — proposals never claim this, so checking is moot, but format included for completeness.
    matchesRule: /(blacklist|debar|sanction)/i,
    matchesProposal: /(blacklist(?:ed|ing)?|debar(?:red|ment)?|under\s+sanctions?)/i,
    suggestion: "Remove any language admitting blacklisting / debarment / sanctions; if applicable, this is a disqualifier and the bid should be withdrawn.",
  },
  {
    // "No foreign firms / nationals" — flag proposal language asserting foreign ownership when prohibited
    matchesRule: /(foreign\s+(?:firm|consultant|national|company|owned)|non[-\s]?domestic)/i,
    matchesProposal: /(foreign[-\s]?owned|wholly\s+foreign|foreign\s+(?:firm|parent|investor)|registered\s+abroad)/i,
    suggestion: "Remove or rephrase any assertion of foreign ownership; if the firm genuinely is foreign, this is a disqualifier and the bid should not proceed.",
  },
  {
    // "No price / cost in the technical envelope" — common two-envelope rule. A proposal mentioning
    // explicit currency amounts or "our price/fee is …" in a technical-only envelope is disqualifying.
    matchesRule: /(?:price|cost|financial|commercial)\s+(?:information|figures?|details?|envelope|content|amount)[\s\S]{0,40}?(?:not|forbidden|prohibited|excluded|separated|never)|technical\s+(?:only|envelope|envelope\s+only)|two[-\s]?envelope/i,
    matchesProposal: /(?:our\s+(?:price|cost|quote|fee|rate)\s+(?:is|will\s+be|of)|total\s+(?:price|cost|fee)\s+(?:is|of|amounts?\s+to|will\s+be)|\bETB\s*[\d,]+\s+(?:per|for|total)|\bUSD\s*[\d,]+\s+(?:per|for|total)|fee\s+schedule\s+attached|price\s+breakdown\s+below)/i,
    suggestion: "Strip every cost, price, fee, rate, and commercial figure from this technical envelope. The tender separates technical and financial submissions — keeping financial content here is automatically disqualifying.",
  },
  {
    // "No advance payment / mobilisation fee proposals"
    matchesRule: /(?:advance\s+payment|mobili(?:s|z)ation\s+(?:fee|advance|payment)|payment\s+in\s+advance)[\s\S]{0,40}?(?:not|forbidden|prohibited|excluded|allowed|permitted)/i,
    matchesProposal: /(?:we\s+(?:propose|request|seek|require)\s+(?:an\s+)?advance\s+payment|advance\s+payment\s+of\s+\d+\s*%|mobili(?:s|z)ation\s+(?:fee|advance)\s+of\s+\d)/i,
    suggestion: "Remove any proposed advance payment, mobilisation fee, or upfront-payment arrangement. The tender forbids it; offering it disqualifies the bid.",
  },
  {
    // "Independent / standalone delivery only — no alliances, no teaming"
    matchesRule: /(?:alliance|partnership|collaboration|teaming)\s+(?:with|arrangement|agreement)[\s\S]{0,40}?(?:not|forbidden|prohibited|excluded|allowed|permitted)|sole\s+(?:bidder|firm|prime)[\s\S]{0,30}?(?:required|mandatory)/i,
    matchesProposal: /(?:strategic|formal)\s+(?:alliance|partnership|teaming)\s+(?:with|agreement)|in\s+(?:strategic\s+)?partnership\s+with\s+[A-Z]/i,
    suggestion: "Remove every alliance, partnership, or teaming-arrangement reference. The tender requires sole delivery; assert that the firm bids and delivers as sole prime.",
  },
  {
    // "No additional cost-to-client" — flag proposals that require the client to buy / license something
    matchesRule: /(?:client\s+(?:shall\s+)?(?:not|never)\s+(?:purchase|procure|acquire|buy|pay\s+for|licence|license)|no\s+(?:additional|extra)\s+(?:purchase|cost|fee|charge)\s+(?:to|for|from)\s+(?:the\s+)?client)/i,
    matchesProposal: /(?:client\s+(?:will|shall|must|to|is\s+required\s+to)\s+(?:purchase|procure|acquire|buy|pay\s+for|license|licence)|the\s+(?:client|customer)\s+is\s+required\s+to\s+(?:purchase|procure|acquire))/i,
    suggestion: "Remove every claim that the client must purchase, procure, or license anything additional. All required software, licences, and tools must be included in the firm's scope at no extra cost.",
  },
  {
    // "No transfer / assignment of contract"
    matchesRule: /(?:contract\s+assignment|assignment\s+of\s+(?:the\s+)?contract|transfer\s+of\s+contract|assign\s+(?:the\s+)?contract)[\s\S]{0,40}?(?:not|forbidden|prohibited|excluded|allowed|permitted)/i,
    matchesProposal: /(?:we\s+(?:may|will|propose\s+to|reserve\s+the\s+right\s+to)\s+(?:assign|transfer|delegate)\s+(?:the\s+)?contract|contract\s+may\s+be\s+(?:assigned|transferred)\s+to\s+(?:another|a\s+third))/i,
    suggestion: "Remove every reference to contract assignment, transfer, or delegation. The tender prohibits it; assert that the firm will deliver the contract in its entirety.",
  },
  {
    // "Bespoke / no boilerplate" — flag obvious template / boilerplate language
    matchesRule: /(?:reuse|generic|template|boilerplate|copy[-\s]?paste|verbatim\s+(?:from|of))[\s\S]{0,40}?(?:not|forbidden|prohibited|excluded|allowed|permitted)|bespoke\s+(?:proposal|content|approach)[\s\S]{0,30}?(?:required|mandatory)/i,
    matchesProposal: /(?:standard\s+template\s+text|generic\s+(?:firm\s+)?profile|leading\s+firm\s+in\s+the\s+region|world[-\s]?class\s+expertise)/i,
    suggestion: "Replace every generic firm-boilerplate phrase with tender-specific content. The tender requires bespoke proposal text; generic / template / boilerplate language is non-responsive.",
  },
];

const SECTION_HEADING_REGEX = /^#{1,4}\s+(.+)$/;

function locationForOffset(markdown: string, offset: number): string | null {
  const before = markdown.slice(0, offset);
  // Walk backward through lines to find the nearest heading.
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(SECTION_HEADING_REGEX);
    if (match) return match[1].trim().slice(0, 120);
  }
  return null;
}

function excerpt(markdown: string, offset: number, length: number): string {
  const start = Math.max(0, offset - 40);
  const end = Math.min(markdown.length, offset + length + 80);
  return markdown.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 220);
}

/**
 * Heuristic check for disqualifier numeric-claim violations. Looks
 * at year-thresholds and value-thresholds the tender stated and
 * tries to find a contradicting claim in the proposal.
 *
 * Conservative: only flags claims that explicitly contradict the
 * stated threshold with a smaller value. Anything subtle (implied
 * dates, calculated tenure) is deferred to the critic.
 */
function checkDisqualifierThresholds(disqualifier: DisqualifyingCondition, markdown: string): ConstraintViolation | null {
  // Pattern 1: year-tenure threshold ("≥ N years" / "minimum N years")
  const yearMatch = disqualifier.rule.match(/(?:≥|>=|at\s+least|minimum\s+of|minimum)\s*(\d{1,3})\s*years?/i);
  if (yearMatch) {
    const threshold = Number(yearMatch[1]);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;
    // Look for proposal claims like "founded in YYYY" or "established in YYYY"
    const claimMatch = markdown.match(/(?:founded|established|incorporated|registered)\s+in\s+(\d{4})/i);
    if (claimMatch) {
      const foundedYear = Number(claimMatch[1]);
      if (Number.isFinite(foundedYear)) {
        const currentYear = new Date().getFullYear();
        const tenure = currentYear - foundedYear;
        if (tenure < threshold) {
          const offset = claimMatch.index ?? 0;
          return {
            type: "disqualifier",
            rule: disqualifier.rule,
            evidence: excerpt(markdown, offset, claimMatch[0].length),
            location: locationForOffset(markdown, offset),
            severity: "CRITICAL",
            suggestion: `Tender requires ≥${threshold} years of operating history; firm claims founding year ${foundedYear} (${tenure} years). Reconfirm the founding date OR mark the bid as non-responsive.`,
          };
        }
      }
    }
    return null;
  }

  // Pattern 2: minimum project / contract count
  // "at least N comparable projects" / "minimum N similar contracts"
  const projectCountMatch = disqualifier.rule.match(/(?:≥|>=|at\s+least|minimum\s+of|minimum)\s*(\d{1,3})\s*(?:comparable|similar|relevant)?\s*(?:project|contract|assignment|engagement)s?/i);
  if (projectCountMatch) {
    const threshold = Number(projectCountMatch[1]);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;
    // Count B.2 project portfolio cards (each "## B.2.N" or "### B.2.N" heading)
    // OR row count in a "Project portfolio" / "Project references" table.
    const portfolioCards = (markdown.match(/^#{2,4}\s+B\.2\.\d+/gm) ?? []).length;
    const referencesTableRows = (() => {
      const tableHeadingMatch = markdown.match(/^#{1,4}\s+(?:section\s+b\.?|b\.\d+|client references|project portfolio)/im);
      if (!tableHeadingMatch) return 0;
      const after = markdown.slice((tableHeadingMatch.index ?? 0) + tableHeadingMatch[0].length);
      const nextHeading = after.search(/\n#{1,4}\s+\w/);
      const slice = nextHeading > 0 ? after.slice(0, nextHeading) : after;
      // Count substantive table rows (non-separator, content > 5 chars total)
      const rows = (slice.match(/^\|[^\n]+\|$/gm) ?? []).filter((r) => !/^\|\s*:?-{3,}/.test(r));
      return rows.length;
    })();
    const evidenced = Math.max(portfolioCards, referencesTableRows);
    if (evidenced > 0 && evidenced < threshold) {
      return {
        type: "disqualifier",
        rule: disqualifier.rule,
        evidence: `Counted ${evidenced} project reference(s) in the proposal portfolio / Section B`,
        location: "Section B / Project portfolio",
        severity: "CRITICAL",
        suggestion: `Tender requires ≥${threshold} comparable projects but only ${evidenced} are evidenced. Add ${threshold - evidenced} additional project reference(s) from the firm's vault OR mark the bid as non-responsive.`,
      };
    }
    return null;
  }

  // Pattern 3: minimum financial turnover / annual revenue
  // Looks for a numeric threshold + currency + turnover/revenue keyword
  // anywhere in the rule text (the keyword may come BEFORE or AFTER
  // the number — real tenders write it both ways: "minimum turnover
  // of ETB 50M" and "ETB 50M minimum turnover").
  const hasTurnoverKeyword = /(?:turnover|revenue)/i.test(disqualifier.rule);
  const turnoverMatch = hasTurnoverKeyword
    ? disqualifier.rule.match(/([A-Z]{3}|\$|€|£)?\s*([\d,]+(?:\.\d+)?)\s*(million|billion|\bm\b|\bbn\b)?/i)
    : null;
  if (turnoverMatch) {
    // Parse threshold to a number in base units (rough; ignores currency).
    const rawValue = Number(turnoverMatch[2].replace(/,/g, ""));
    const multiplier = /million|^m$/i.test(turnoverMatch[3] ?? "") ? 1_000_000
      : /billion|^bn$/i.test(turnoverMatch[3] ?? "") ? 1_000_000_000
      : 1;
    const threshold = rawValue * multiplier;
    if (!Number.isFinite(threshold) || threshold <= 0) return null;
    // Look for any proposal claim like "annual turnover ETB X" /
    // "revenue of USD Y" / "turnover is ETB 12 million" — match the
    // keyword, then look for a numeric value within the next ~50
    // characters (real wording uses "is", "stands at", "of", etc.
    // between the keyword and the value).
    const claimMatch = markdown.match(/(?:turnover|revenue)[\s\S]{0,50}?([A-Z]{3}|\$|€|£)?\s*([\d,]+(?:\.\d+)?)\s*(million|billion|\bm\b|\bbn\b)?/i);
    if (claimMatch) {
      const claimRaw = Number(claimMatch[2].replace(/,/g, ""));
      const claimMult = /million|^m$/i.test(claimMatch[3] ?? "") ? 1_000_000
        : /billion|^bn$/i.test(claimMatch[3] ?? "") ? 1_000_000_000
        : 1;
      const claimValue = claimRaw * claimMult;
      if (Number.isFinite(claimValue) && claimValue > 0 && claimValue < threshold) {
        const offset = claimMatch.index ?? 0;
        return {
          type: "disqualifier",
          rule: disqualifier.rule,
          evidence: excerpt(markdown, offset, claimMatch[0].length),
          location: locationForOffset(markdown, offset),
          severity: "CRITICAL",
          suggestion: `Tender requires turnover ≥ ${turnoverMatch[2]}${turnoverMatch[3] ?? ""}; proposal claims ${claimMatch[2]}${claimMatch[3] ?? ""}. Reconfirm the turnover figure OR mark the bid as non-responsive.`,
        };
      }
    }
    return null;
  }

  // Pattern 4: license-grade threshold ("Grade I license required" /
  // "Class A engineering license") — match Grade/Class/Level + an
  // identifier (Roman numeral or A-Z letter). Don't require a
  // license/registration keyword in the rule itself; if the rule
  // doesn't mention licenses at all, the next regex below will
  // simply not fire on the proposal either.
  const licenseMatch = disqualifier.rule.match(/(?:grade|class|level)\s+([IVX]+|[A-Z])(?=[\s,.;:]|$)/i);
  if (licenseMatch) {
    const required = licenseMatch[1].toUpperCase();
    const requiredRank = (() => {
      // Both numeric (I/II/III) and letter (A/B/C) systems exist; conservatively
      // rank by string length then ASCII order (Grade I beats II/III; A beats B/C).
      const romanMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
      if (romanMap[required] !== undefined) return romanMap[required];
      return required.charCodeAt(0);
    })();
    // Look for the firm's actual grade claim. Matches "Grade III
    // license", "Class A engineering license", "Level B registration",
    // etc. The Roman/letter identifier must be followed by a word
    // boundary so "Grade I" doesn't match "Grade Important" etc.
    const claimMatch = markdown.match(/(?:grade|class|level)\s+([IVX]+|[A-Z])(?=[\s,.;:]|$)/i);
    if (claimMatch) {
      const claimed = claimMatch[1].toUpperCase();
      const romanMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
      const claimedRank = romanMap[claimed] !== undefined ? romanMap[claimed] : claimed.charCodeAt(0);
      // Lower rank number = higher grade (Grade I > Grade II). If the
      // firm's claimed grade is HIGHER NUMBER than required, it's
      // a violation. Skip the check entirely when rank systems differ
      // (numeric vs letter) to avoid false positives.
      const bothNumeric = romanMap[required] !== undefined && romanMap[claimed] !== undefined;
      const bothLetter = romanMap[required] === undefined && romanMap[claimed] === undefined;
      if ((bothNumeric || bothLetter) && claimedRank > requiredRank) {
        const offset = claimMatch.index ?? 0;
        return {
          type: "disqualifier",
          rule: disqualifier.rule,
          evidence: excerpt(markdown, offset, claimMatch[0].length),
          location: locationForOffset(markdown, offset),
          severity: "CRITICAL",
          suggestion: `Tender requires Grade ${required} license; firm claims Grade ${claimed}. Lower grade does not satisfy the threshold. Reconfirm the license grade OR mark the bid as non-responsive.`,
        };
      }
    }
    return null;
  }

  return null;
}

export function validateConstraints(
  comprehension: DeepTenderComprehension | null,
  proposalMarkdown: string,
): ConstraintValidationResult {
  const violations: ConstraintViolation[] = [];
  const cleared: string[] = [];
  const deferredToCritic: string[] = [];

  if (!comprehension) {
    return { violations, cleared, deferredToCritic };
  }

  // Prohibitions — match each rule to a pattern, then sweep the proposal.
  for (const prohibition of comprehension.prohibitions) {
    let matched = false;
    for (const pattern of PROHIBITION_PATTERNS) {
      if (!pattern.matchesRule.test(prohibition)) continue;
      const violationMatch = pattern.matchesProposal.exec(proposalMarkdown);
      if (violationMatch) {
        const offset = violationMatch.index;
        violations.push({
          type: "prohibition",
          rule: prohibition,
          evidence: excerpt(proposalMarkdown, offset, violationMatch[0].length),
          location: locationForOffset(proposalMarkdown, offset),
          severity: "CRITICAL",
          suggestion: pattern.suggestion,
        });
      } else {
        cleared.push(prohibition);
      }
      matched = true;
      break;
    }
    if (!matched) {
      // No known pattern — defer to the critic (it'll read the rule and check semantically).
      deferredToCritic.push(prohibition);
    }
  }

  // Disqualifiers — only the threshold checker is deterministic; everything else defers.
  for (const disqualifier of comprehension.disqualifiers) {
    const threshold = checkDisqualifierThresholds(disqualifier, proposalMarkdown);
    if (threshold) {
      violations.push(threshold);
    } else {
      deferredToCritic.push(disqualifier.rule);
    }
  }

  return { violations, cleared, deferredToCritic };
}

/**
 * Render every comprehension rule (prohibitions + disqualifiers) as
 * a checklist block that the critic prompt can iterate over. The
 * critic is instructed (via the system prompt + this block) to
 * verify each rule against the proposal and report any violation as
 * a defect entry.
 */
export function formatConstraintsForCritique(comprehension: DeepTenderComprehension | null): string {
  if (!comprehension) return "";
  if (comprehension.prohibitions.length === 0 && comprehension.disqualifiers.length === 0) return "";

  const lines: string[] = [];
  lines.push("## CONSTRAINT VERIFICATION CHECKLIST (every rule must be checked against the draft)");
  if (comprehension.prohibitions.length > 0) {
    lines.push("");
    lines.push("### Prohibitions (proposal must NOT propose any of these)");
    comprehension.prohibitions.forEach((p, i) => {
      lines.push(`P${i + 1}. ${p}`);
    });
  }
  if (comprehension.disqualifiers.length > 0) {
    lines.push("");
    lines.push("### Disqualifying conditions (proposal must explicitly satisfy each, or be marked non-responsive)");
    comprehension.disqualifiers.forEach((d, i) => {
      lines.push(`D${i + 1}. ${d.rule}`);
    });
  }
  return lines.join("\n");
}

/**
 * Render any deterministic violations as a block to inject into the
 * critique prompt — telling Claude up-front "these violations are
 * already known; produce a defect entry for each."
 */
export function formatViolationsForCritique(result: ConstraintValidationResult): string {
  if (result.violations.length === 0) return "";

  const lines: string[] = [];
  lines.push("## CONSTRAINT VIOLATIONS DETECTED (deterministic sweep — confirm and fix each)");
  result.violations.forEach((v, i) => {
    const where = v.location ? ` [in: ${v.location}]` : "";
    lines.push(`V${i + 1}. [${v.severity}] ${v.type.toUpperCase()}: ${v.rule}${where}`);
    lines.push(`     Evidence: "…${v.evidence}…"`);
    lines.push(`     Fix: ${v.suggestion}`);
  });
  return lines.join("\n");
}

/**
 * Convert violations into synthetic weak-axis identifiers so the
 * refinement loop's threshold check sees them as additional reasons
 * to refine. Used at the call site where qualityScore.weakAxes is
 * augmented before the deep refiner runs.
 */
export function violationsAsWeakAxes(result: ConstraintValidationResult): string[] {
  if (result.violations.length === 0) return [];
  // One synthetic axis per violation type. The refiner doesn't need
  // distinct axes per rule — the comprehension/violation blocks tell
  // it which specific rules to fix.
  const axes = new Set<string>();
  for (const v of result.violations) {
    axes.add(v.type === "prohibition" ? "constraintProhibition" : "constraintDisqualifier");
  }
  return Array.from(axes);
}

export const __testing__ = { PROHIBITION_PATTERNS };
