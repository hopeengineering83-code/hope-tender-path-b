// Confirmed tender facts, as the proposal writer must see them.
//
// The app already has one authority for "what is this tender's client name,
// deadline, reference, submission method and submission endpoint":
// resolveEffectiveTenderFacts() in ./effective-tender-facts. It merges the raw
// extracted scalar with the owner's TenderMetadataOverride row so that a value
// the owner corrected or confirmed wins over whatever the parser pulled out of
// the PDF.
//
// Until this module existed, the readiness and export gates consulted that
// authority (via ./runtime-readiness-facts) and the WRITER did not. generate-elite
// did not even select the override rows, and buildProposalIntelligence read
// `tender.clientName || tender.procuringEntityName` straight from the columns.
// The override route never writes back to those columns — it says so in as many
// words. The result was that a corrected client name passed the export gate
// under its corrected form while the delivered document carried the
// uncorrected one, and the client-name enforcer then spread that uncorrected
// name across the whole proposal.
//
// This module is the join. It is deliberately narrow: it resolves through the
// canonical authority and overlays ONLY the facts the owner has actually
// confirmed or edited, leaving everything else byte-identical to what the
// caller loaded.

import { resolveEffectiveTenderFacts } from "./effective-tender-facts";

type OverrideRow = Parameters<typeof resolveEffectiveTenderFacts>[1][number];

/**
 * Overlay owner-confirmed tender facts onto a tender record before it reaches
 * the writer.
 *
 * Only HUMAN_CONFIRMED_OPERATIONAL facts — the USER_EDITED and USER_CONFIRMED
 * states — displace a raw value. In particular:
 *
 *   • REJECTED_CANDIDATE never becomes the value. Rejecting a candidate is the
 *     owner saying "not this one"; adopting it would invert the decision.
 *   • NOT_APPLICABLE and IGNORED_WITH_REASON do not blank the extracted value.
 *     They tell the GATES the source does not state the fact. Handing the
 *     writer an empty string instead is how "N/A" and "Bid-Team to confirm"
 *     reach a client-facing document, which the product forbids outright.
 *
 * The input record is not mutated: callers still read the raw row when they
 * report provenance, and a silent in-place edit would make those two readings
 * disagree.
 */
export function applyConfirmedFactsToWriterTender<T extends Record<string, unknown>>(
  tender: T,
  overrides: OverrideRow[],
): T {
  if (!overrides || overrides.length === 0) return tender;

  const resolved = resolveEffectiveTenderFacts(tender, overrides);
  const out: Record<string, unknown> = { ...tender };
  let changed = false;

  for (const [field, fact] of resolved.facts) {
    if (fact.authorityClass !== "HUMAN_CONFIRMED_OPERATIONAL") continue;
    if (fact.effectiveValue == null) continue;
    if (!(field in tender)) continue;

    // resolveEffectiveTenderFacts stringifies every value. A column the rest of
    // the pipeline reads as a Date has to go back as a Date, or downstream date
    // formatting silently changes shape.
    if (tender[field] instanceof Date) {
      const asDate = new Date(fact.effectiveValue);
      // A confirmed value that is not a date must not destroy a deadline the
      // source did supply. Leave the extracted one and let the gates, which
      // read the same override, be the ones to complain.
      if (Number.isNaN(asDate.getTime())) continue;
      if (asDate.getTime() === (tender[field] as Date).getTime()) continue;
      out[field] = asDate;
      changed = true;
      continue;
    }

    if (out[field] === fact.effectiveValue) continue;
    out[field] = fact.effectiveValue;
    changed = true;
  }

  return changed ? (out as T) : tender;
}

/**
 * The fields the owner has actually confirmed or edited, resolved through the
 * same authority.
 *
 * Callers need this wherever a raw value travels alongside its source quote.
 * formatSubmissionDeadline(), for instance, PREFERS a date parsed out of the
 * stored source quote over the deadline column — so an owner who corrects a
 * misread deadline would still see the misread one printed, because the quote
 * it came from is still attached. A quote documents the value that was
 * corrected away; once a fact is owner-confirmed, the quote must not be
 * allowed to speak for it.
 */
export function confirmedFactFields(
  tender: Record<string, unknown>,
  overrides: OverrideRow[],
): Set<string> {
  const confirmed = new Set<string>();
  if (!overrides || overrides.length === 0) return confirmed;
  for (const [field, fact] of resolveEffectiveTenderFacts(tender, overrides).facts) {
    if (fact.authorityClass === "HUMAN_CONFIRMED_OPERATIONAL" && fact.effectiveValue != null) {
      confirmed.add(field);
    }
  }
  return confirmed;
}
