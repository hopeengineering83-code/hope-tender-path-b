/**
 * Portfolio enrichment service — brings already-stored Project rows up to the
 * behaviour the ingestion paths now have.
 *
 * WHY A SERVICE RATHER THAN A SCRIPT
 * ----------------------------------
 * Two defects were fixed at the write paths: the bulk import never derived the
 * portfolio numbers that sit verbatim in each record's own reference text, and
 * neither path checked that the value going into `Project.country` was a
 * country. Fixing the write paths does nothing for rows already written, and
 * the rows already written are the ones the proposal writer reads. The logic
 * therefore lives here, where a test can execute it against a recording client
 * rather than only reading its source.
 *
 * WHAT IT MAY AND MAY NOT DO
 * --------------------------
 * It may fill an empty column from the record's own text, and it may replace a
 * `country` value that is demonstrably not a country. It may not blank a
 * populated column, overwrite a value that is already well-formed, move a value
 * between records, or decide a country the record's own evidence does not
 * settle. Every row it declines to touch is counted and reported, so a run
 * states what it repaired AND what it deliberately left alone.
 */

import { classifyCountryValue, resolveProjectCountry, type CountryResolutionOutcome } from "./country-reference";
import { extractProjectFacts, mergeProjectFacts } from "./project-fact-extractor";
import {
  buildPartialSourceVerificationProvenance,
  buildSourceVerificationProvenance,
  isDurablyReviewed,
  isDurablySourceVerified,
  projectReviewFields,
  type ReviewRecordState,
  type ReviewSourceDocument,
} from "../vault-review-provenance";

/**
 * The Project columns this service reads. Matches the Prisma row shape.
 *
 * The provenance fields are not decoration. A record's durable source
 * verification is a claim about a SET of fields, and filling a field the
 * provenance never assessed invalidates the whole claim — so enrichment cannot
 * be done without them. See reissueVerification below.
 */
export type EnrichableProject = {
  readonly id: string;
  readonly name: string;
  readonly clientName?: string | null;
  readonly country?: string | null;
  readonly sector?: string | null;
  readonly serviceAreas?: unknown;
  readonly summary?: string | null;
  readonly contractValue?: number | null;
  readonly currency?: string | null;
  readonly startDate?: Date | null;
  readonly endDate?: Date | null;
  readonly trustLevel?: string | null;
  readonly companyId?: string | null;
  readonly sourceDocumentId?: string | null;
  readonly sourceDocument?: ReviewSourceDocument | null;
  readonly reviewedBy?: string | null;
  readonly reviewedAt?: Date | null;
  readonly reviewNotes?: string | null;
};

/** The ten counts the owner asked a run to report, measured before and after. */
export type PortfolioFactCensus = {
  readonly totalProjects: number;
  /** What the trustLevel COLUMN claims. */
  readonly sourceVerified: number;
  /**
   * What the provenance still PROVES — the number every consumer actually
   * gates on. It is reported separately because the column claiming
   * SOURCE_VERIFIED on 114 rows is what hid the moment their provenance stopped
   * covering them: a census that reads only the column cannot see the damage a
   * write did.
   */
  readonly durablyVerified: number;
  readonly countryPopulated: number;
  readonly countryValid: number;
  readonly countryMalformed: number;
  readonly contractValuePopulated: number;
  readonly currencyPopulated: number;
  readonly startDatePopulated: number;
  readonly endDatePopulated: number;
  readonly bothDatesPopulated: number;
};

export type ProjectEnrichmentPlan = {
  readonly id: string;
  readonly name: string;
  /** Columns to write. Empty when the row needs nothing. */
  readonly update: Record<string, unknown>;
  readonly countryOutcome: CountryResolutionOutcome | "NOT_EVALUATED";
  readonly notes: readonly string[];
};

export type PortfolioEnrichmentResult = {
  readonly before: PortfolioFactCensus;
  readonly after: PortfolioFactCensus;
  readonly rowsExamined: number;
  readonly rowsModified: number;
  readonly rowsUnchanged: number;
  /** Rows whose country could not be settled from the record's own evidence. */
  readonly rowsSkippedForAmbiguity: number;
  /**
   * Rows left untouched because enriching them would have cost them their
   * durable verification. Populated columns are worth less than a record the
   * app can still prove, so these are reported rather than written.
   */
  readonly rowsSkippedToPreserveVerification: number;
  /** Rows whose verification provenance was re-issued to cover the new values. */
  readonly verificationReissued: number;
  readonly countryCorrected: number;
  readonly contractValueFilled: number;
  readonly currencyFilled: number;
  readonly startDateFilled: number;
  readonly endDateFilled: number;
  readonly clientNameFilled: number;
  readonly sectorFilled: number;
  readonly applied: boolean;
  readonly plans: readonly ProjectEnrichmentPlan[];
  readonly unresolvedCountries: ReadonlyArray<{ id: string; name: string; stored: string | null; reason: string }>;
  readonly verificationSkips: ReadonlyArray<{ id: string; name: string; reason: string }>;
};

export function censusOf(projects: readonly EnrichableProject[]): PortfolioFactCensus {
  let sourceVerified = 0;
  let durablyVerified = 0;
  let countryPopulated = 0;
  let countryValid = 0;
  let countryMalformed = 0;
  let contractValuePopulated = 0;
  let currencyPopulated = 0;
  let startDatePopulated = 0;
  let endDatePopulated = 0;
  let bothDatesPopulated = 0;

  for (const project of projects) {
    if (project.trustLevel === "SOURCE_VERIFIED") sourceVerified += 1;
    if (verificationState(project) !== "NONE") durablyVerified += 1;
    const classification = classifyCountryValue(project.country);
    if (classification.kind !== "EMPTY") countryPopulated += 1;
    if (classification.kind === "VALID") countryValid += 1;
    if (classification.kind === "MALFORMED") countryMalformed += 1;
    if (typeof project.contractValue === "number" && Number.isFinite(project.contractValue)) contractValuePopulated += 1;
    if ((project.currency ?? "").trim()) currencyPopulated += 1;
    if (project.startDate) startDatePopulated += 1;
    if (project.endDate) endDatePopulated += 1;
    if (project.startDate && project.endDate) bothDatesPopulated += 1;
  }

  return {
    totalProjects: projects.length,
    sourceVerified,
    durablyVerified,
    countryPopulated,
    countryValid,
    countryMalformed,
    contractValuePopulated,
    currencyPopulated,
    startDatePopulated,
    endDatePopulated,
    bothDatesPopulated,
  };
}

/** The minimum source text length worth running a regex extractor over. */
const MINIMUM_SOURCE_TEXT = 50;

/**
 * What this one row needs, deciding nothing it cannot justify from the row
 * itself. Pure: no client, no writes, so a test can enumerate cases cheaply.
 */
export function planProjectEnrichment(project: EnrichableProject): ProjectEnrichmentPlan {
  const notes: string[] = [];
  const sourceText = project.summary ?? "";
  const update: Record<string, unknown> = {};

  if (sourceText.trim().length >= MINIMUM_SOURCE_TEXT) {
    // Fill-only: mergeProjectFacts writes a column solely when it is empty.
    const filled = mergeProjectFacts(project, extractProjectFacts(sourceText, project.name));
    for (const [key, value] of Object.entries(filled)) {
      if (value === undefined) continue;
      update[key] = value;
      notes.push(`${key} derived from the record's own reference text`);
    }
  } else {
    notes.push("no usable reference text on this record; nothing derived");
  }

  // Country is the one column allowed to be REPLACED rather than only filled,
  // and only when what is stored is demonstrably not a country.
  const countryResolution = resolveProjectCountry({
    storedCountry: (update.country as string | null | undefined) ?? project.country,
    sourceText,
  });
  if (countryResolution.shouldWrite) {
    update.country = countryResolution.country;
    notes.push(countryResolution.reason);
  } else if (
    countryResolution.outcome === "UNRESOLVED_AMBIGUOUS" ||
    countryResolution.outcome === "UNRESOLVED_NO_EVIDENCE"
  ) {
    // Do not write a country, and do not let a fill from the extractor stand in
    // for one either — the extractor and the resolver must not disagree.
    delete update.country;
    notes.push(countryResolution.reason);
  }

  return { id: project.id, name: project.name, update, countryOutcome: countryResolution.outcome, notes };
}

/**
 * Whether this record's trust is a live, durable claim right now.
 *
 * Read from the provenance rather than from the trustLevel column: the column
 * says what was claimed, the provenance says whether the claim still holds.
 */
function verificationState(project: EnrichableProject): "HUMAN_REVIEWED" | "SOURCE_VERIFIED" | "NONE" {
  const record = project as unknown as ReviewRecordState;
  if (!project.sourceDocumentId || !project.sourceDocument) return "NONE";
  if (isDurablyReviewed(record)) return "HUMAN_REVIEWED";
  if (isDurablySourceVerified(record)) return "SOURCE_VERIFIED";
  return "NONE";
}

/**
 * Re-issue source-verification provenance so it covers the fields the
 * enrichment is about to write.
 *
 * THE DEFECT THIS EXISTS FOR, found on the live vault rather than in a test.
 * A record's durable source verification is a claim about a SET of fields, and
 * `provenanceMatchesCurrentRecord` deliberately refuses a record that has GROWN
 * since it was verified — a field the provenance never assessed is a claim
 * nothing checked, and it would otherwise ride into matching scores and client
 * documents inside a record the app labels verified. `normalizedEvidenceFields`
 * drops empty values, so a row imported with contractValue, currency and dates
 * all null was verified on name/clientName/sector alone. Filling those columns
 * made the record grow, and 114 SOURCE_VERIFIED projects stopped being durably
 * verified the moment they were enriched — which is how readiness came to
 * report "No verified, source-backed projects are available" over a vault of
 * 114 verified projects.
 *
 * The guard is correct and is not being relaxed. What was missing is the other
 * half: enrichment has to re-prove the record it changed. Full verification is
 * tried first; partial verification is the fallback, which keeps identity proven
 * and records the derived numbers as explicitly unverified — the same ladder the
 * import already climbs. A derived contract value is usually NOT verbatim in the
 * source text ("1,000,000.00 ETB" is not the string "1000000"), so partial is
 * the normal outcome and it is an honest one.
 */
function reissueVerification(
  project: EnrichableProject,
  update: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; reason: string } {
  if (!project.sourceDocument) {
    return { ok: false, reason: "the record has no linked source document to re-prove it against" };
  }
  const merged = { ...project, ...update } as EnrichableProject;
  const fields = projectReviewFields({
    name: merged.name,
    clientName: merged.clientName,
    country: merged.country,
    sector: merged.sector,
    serviceAreas: merged.serviceAreas,
    contractValue: merged.contractValue,
    currency: merged.currency,
  });

  // "DETERMINISTIC" is the truth about this re-verification: a regex extractor
  // derived the values and a deterministic matcher proved them. It claims no AI
  // involvement, and it does not inherit a method from the earlier provenance
  // that a different process performed.
  const full = buildSourceVerificationProvenance({
    recordType: "PROJECT",
    sourceDocument: project.sourceDocument,
    fields,
    verificationMethod: "DETERMINISTIC",
  });
  if (full.ok) {
    return { ok: true, data: { trustLevel: "SOURCE_VERIFIED", reviewedBy: null, reviewedAt: null, reviewNotes: full.serialized } };
  }

  const partial = buildPartialSourceVerificationProvenance({
    recordType: "PROJECT",
    sourceDocument: project.sourceDocument,
    fields,
    verificationMethod: "DETERMINISTIC",
  });
  if (partial.ok && partial.serialized) {
    return { ok: true, data: { trustLevel: "SOURCE_VERIFIED", reviewedBy: null, reviewedAt: null, reviewNotes: partial.serialized } };
  }

  return { ok: false, reason: `re-verification failed (${partial.code ?? full.code ?? "unknown"})` };
}

/** The write surface this service needs. Prisma's delegate satisfies it. */
export type ProjectUpdateClient = {
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
};

/**
 * Plan every row, optionally apply, and report the before/after census.
 *
 * `apply: false` is a true dry run: the client is never called, and `after` is
 * computed from the planned rows so a dry run predicts exactly what an applied
 * run would produce.
 */
export async function enrichProjectPortfolio(input: {
  projects: readonly EnrichableProject[];
  client?: ProjectUpdateClient;
  apply: boolean;
}): Promise<PortfolioEnrichmentResult> {
  const before = censusOf(input.projects);
  const plans: ProjectEnrichmentPlan[] = [];
  const enriched: EnrichableProject[] = [];
  const unresolvedCountries: Array<{ id: string; name: string; stored: string | null; reason: string }> = [];
  const verificationSkips: Array<{ id: string; name: string; reason: string }> = [];

  let rowsModified = 0;
  let rowsSkippedForAmbiguity = 0;
  let rowsSkippedToPreserveVerification = 0;
  let verificationReissued = 0;
  let countryCorrected = 0;
  let contractValueFilled = 0;
  let currencyFilled = 0;
  let startDateFilled = 0;
  let endDateFilled = 0;
  let clientNameFilled = 0;
  let sectorFilled = 0;

  for (const project of input.projects) {
    const plan = planProjectEnrichment(project);
    plans.push(plan);

    if (plan.countryOutcome === "UNRESOLVED_AMBIGUOUS" || plan.countryOutcome === "UNRESOLVED_NO_EVIDENCE") {
      rowsSkippedForAmbiguity += 1;
      unresolvedCountries.push({
        id: project.id,
        name: project.name,
        stored: (project.country ?? null) || null,
        reason: plan.notes[plan.notes.length - 1] ?? "unresolved",
      });
    }

    const keys = Object.keys(plan.update);
    if (keys.length === 0) {
      enriched.push(project);
      continue;
    }

    // A record the app can still prove is worth more than a populated column.
    //
    // Enriching a durably verified record changes the field set its provenance
    // covers, so the provenance has to be re-issued in the SAME write or the
    // record silently stops being verified. When it cannot be re-issued, the row
    // is left exactly as it is and reported.
    const trust = verificationState(project);
    let verificationFields: Record<string, unknown> = {};
    if (trust === "HUMAN_REVIEWED") {
      // Machine provenance must never overwrite a human review, and a human
      // review cannot cover values a machine derived afterwards. Leave it alone.
      rowsSkippedToPreserveVerification += 1;
      verificationSkips.push({
        id: project.id,
        name: project.name,
        reason: "the record is durably human-reviewed; enrichment would replace a human review with machine provenance",
      });
      enriched.push(project);
      continue;
    }
    if (trust === "SOURCE_VERIFIED") {
      const reissue = reissueVerification(project, plan.update);
      if (!reissue.ok) {
        rowsSkippedToPreserveVerification += 1;
        verificationSkips.push({ id: project.id, name: project.name, reason: reissue.reason });
        enriched.push(project);
        continue;
      }
      verificationFields = reissue.data;
      verificationReissued += 1;
    }

    if ("country" in plan.update) countryCorrected += 1;
    if ("contractValue" in plan.update) contractValueFilled += 1;
    if ("currency" in plan.update) currencyFilled += 1;
    if ("startDate" in plan.update) startDateFilled += 1;
    if ("endDate" in plan.update) endDateFilled += 1;
    if ("clientName" in plan.update) clientNameFilled += 1;
    if ("sector" in plan.update) sectorFilled += 1;
    rowsModified += 1;

    if (input.apply) {
      if (!input.client) throw new Error("enrichProjectPortfolio: apply was requested without a write client.");
      await input.client.update({ where: { id: project.id }, data: { ...plan.update, ...verificationFields } });
    }
    enriched.push({ ...project, ...plan.update, ...verificationFields } as EnrichableProject);
  }

  return {
    before,
    after: censusOf(enriched),
    rowsExamined: input.projects.length,
    rowsModified,
    rowsUnchanged: input.projects.length - rowsModified,
    rowsSkippedForAmbiguity,
    rowsSkippedToPreserveVerification,
    verificationReissued,
    countryCorrected,
    contractValueFilled,
    currencyFilled,
    startDateFilled,
    endDateFilled,
    clientNameFilled,
    sectorFilled,
    applied: input.apply,
    plans,
    unresolvedCountries,
    verificationSkips,
  };
}
