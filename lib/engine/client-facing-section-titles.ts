/**
 * Canonical client-facing titles for the two proposal sections whose original
 * names were bid-desk vocabulary.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real submitted proposal shipped these two headings to the procuring
 * entity:
 *
 *   ## Section F: Evaluation Criteria Response Mirror
 *   ## Section G: Win Themes and Discriminators
 *
 * Both sections are legitimate and evaluators want what is inside them — a
 * map from each published criterion to where the proposal answers it, and a
 * map from each requirement to the capability that meets it. The *names* are
 * the problem. "Mirroring" the evaluator, "win themes" and "discriminators"
 * are how a bid desk talks about beating other bidders; printing them in the
 * client's copy tells the evaluator they are holding a scoring exercise.
 *
 * Four separate producers emitted these headings as literals
 * (win-themes-table, proposal-quality-repair, evaluator-mirror-builder and
 * the model prompt in lib/ai.ts), so a rename in one place left the others
 * disagreeing and the deduplicating heading matchers stopped recognising
 * their own section. The titles live here so every producer and every
 * detector reads the same string.
 *
 * The DETECTION patterns deliberately match the old names as well. Proposals
 * generated before this change, and any model output that still uses the
 * older vocabulary, must continue to be recognised as the same section —
 * otherwise a second copy is injected beneath the first.
 */

/** Section F: where each published evaluation criterion is answered. */
export const CLIENT_FACING_SECTION_F_HEADING = "Section F: Response to Evaluation Criteria";

/** Section G: requirement → capability → client benefit → evidence. */
export const CLIENT_FACING_SECTION_G_HEADING = "Section G: Why We Are Well Suited";

/**
 * Matches Section F under either its current client-facing name or the
 * older "Evaluation Criteria Response Mirror" name.
 */
export const SECTION_F_HEADING_RX =
  /(^|\n)\s*#{1,4}\s*(?:section\s*[F:.\-\s]*)?\s*(?:evaluation\s+criteria\s+response\s+mirror|response\s+to\s+evaluation\s+criteria|compliance\s+with\s+evaluation\s+criteria|evaluator\s+response\s+mirror)/i;

/**
 * Matches Section G under either its current client-facing name or the
 * older "Win Themes and Discriminators" name.
 */
export const SECTION_G_HEADING_RX =
  /(^|\n)\s*#{1,4}\s*(?:section\s*[G:.\-\s]*)?\s*(?:win\s+themes?(?:\s+(?:and|&)\s+(?:discriminators?|differentiators?))?|themes?\s+(?:and|&)\s+discriminators?|why\s+we\s+are\s+well\s+suited)/i;
