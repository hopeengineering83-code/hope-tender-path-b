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

/** The Project columns this service reads. Matches the Prisma row shape. */
export type EnrichableProject = {
  readonly id: string;
  readonly name: string;
  readonly clientName?: string | null;
  readonly country?: string | null;
  readonly sector?: string | null;
  readonly summary?: string | null;
  readonly contractValue?: number | null;
  readonly currency?: string | null;
  readonly startDate?: Date | null;
  readonly endDate?: Date | null;
  readonly trustLevel?: string | null;
};

/** The ten counts the owner asked a run to report, measured before and after. */
export type PortfolioFactCensus = {
  readonly totalProjects: number;
  readonly sourceVerified: number;
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
};

export function censusOf(projects: readonly EnrichableProject[]): PortfolioFactCensus {
  let sourceVerified = 0;
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

  let rowsModified = 0;
  let rowsSkippedForAmbiguity = 0;
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
      await input.client.update({ where: { id: project.id }, data: plan.update });
    }
    enriched.push({ ...project, ...plan.update } as EnrichableProject);
  }

  return {
    before,
    after: censusOf(enriched),
    rowsExamined: input.projects.length,
    rowsModified,
    rowsUnchanged: input.projects.length - rowsModified,
    rowsSkippedForAmbiguity,
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
  };
}
