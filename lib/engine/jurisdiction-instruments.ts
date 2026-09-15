/**
 * One authority for "may this proposal name that regulator, code or standard?".
 *
 * Deterministic builders used to hard-code Ethiopian instruments — EBCS, the
 * Ethiopian Health Authority, the Ethiopian EPA, AA City Authority, ERA — into
 * tables that any tender could reach. A Kenyan hospital tender was therefore
 * told its structural calculations go to a city authority in Addis Ababa, and a
 * Tanzanian road tender was promised pavement design "per ERA". Naming an
 * instrument that no source names is a fabricated legal claim, and the same
 * class of defect as printing an unstated currency as ETB.
 *
 * The rule is the one the writer prompts in `lib/ai.ts` already follow: name the
 * specific instrument only when a source names it, and otherwise describe the
 * instrument by its function so the sentence stays true in every jurisdiction.
 * The evidence patterns live here so the prompt side and the deterministic side
 * cannot drift apart.
 *
 * Usage in a builder that already holds the tender text:
 *
 *   const jurisdiction = jurisdictionFor(tenderText);
 *   `... analysis incorporating ${jurisdiction("SEISMIC_ZONE")} and wind loads`
 *
 * Nothing here is Ethiopia-specific by policy: Ethiopia is simply the
 * jurisdiction whose instruments were already written into the tables. A new
 * jurisdiction is added by adding an entry, not by changing a consumer.
 */

/**
 * What counts as a source naming each instrument. Deliberately matches the
 * patterns used at the writer-prompt sites in `lib/ai.ts` so one tender cannot
 * get the specific wording from the model and the generic wording from a table.
 */
export const JURISDICTION_EVIDENCE = {
  HEALTH_FACILITY_REGULATOR: /EBCS|Ethiopian Health Authority|\bEHA\b/i,
  SEISMIC_DESIGN_CODE: /EBCS|ES EN 199|Ethiopian seismic/i,
  MATERIALS_TESTING_STANDARD: /EBCS/i,
  ENVIRONMENTAL_REGULATOR: /Ethiopian EPA|\bEPA\b|WHO standard/i,
  BUILDING_APPROVAL_AUTHORITY: /AA City|Addis Ababa|Ethiopian/i,
  ROAD_DESIGN_STANDARD: /\bERA\b|Ethiopian Roads/i,
} as const satisfies Record<string, RegExp>;

export type JurisdictionEvidenceKey = keyof typeof JURISDICTION_EVIDENCE;

type InstrumentPhrase = {
  /** Which evidence must appear in a source before `specific` may be printed. */
  evidence: JurisdictionEvidenceKey;
  /** The named instrument. Printed only when the source names it. */
  specific: string;
  /**
   * The same instrument described by its function. This is not a hedge or a
   * placeholder — it is a true sentence in every jurisdiction, so it is safe to
   * deliver to a client.
   */
  generic: string;
};

/**
 * The phrases a deterministic builder may ask for by name. Prose register:
 * these go into delivered documents, not into prompts.
 */
export const JURISDICTION_PHRASES = {
  HEALTH_FACILITY_REGULATOR: {
    evidence: "HEALTH_FACILITY_REGULATOR",
    specific: "Ethiopian Health Authority",
    generic: "the health-facility licensing authority for the project location",
  },
  SEISMIC_ZONE: {
    evidence: "SEISMIC_DESIGN_CODE",
    specific: "the Ethiopian seismic zone",
    generic: "the seismic zone of the project location",
  },
  SEISMIC_DESIGN_CODE: {
    evidence: "SEISMIC_DESIGN_CODE",
    specific: "EBCS-8",
    generic: "the seismic design code in force at the project location",
  },
  SEISMIC_CODE_FAMILY: {
    evidence: "SEISMIC_DESIGN_CODE",
    specific: "EBCS / ES EN 1998",
    generic: "the seismic design code applicable to the project location",
  },
  MATERIALS_TESTING_STANDARD: {
    evidence: "MATERIALS_TESTING_STANDARD",
    specific: "EBCS / ASTM",
    generic: "the national materials standard for the project location, with ASTM methods where it defers to them",
  },
  EFFLUENT_STANDARD: {
    evidence: "ENVIRONMENTAL_REGULATOR",
    specific: "Ethiopian EPA / WHO standards",
    generic: "the national environmental authority's effluent standards for the project location, with WHO guidance where no national standard applies",
  },
  STRUCTURAL_APPROVAL_AUTHORITY: {
    evidence: "BUILDING_APPROVAL_AUTHORITY",
    specific: "AA City Authority",
    generic: "the municipal authority that reviews structural calculations for the project location",
  },
  ROAD_DESIGN_STANDARD: {
    evidence: "ROAD_DESIGN_STANDARD",
    // AASHTO is international, so it stays in both forms; only the national
    // manual is conditional.
    specific: "ERA / AASHTO",
    generic: "AASHTO, or the national road design manual where the tender names one",
  },
} as const satisfies Record<string, InstrumentPhrase>;

export type JurisdictionPhraseKey = keyof typeof JURISDICTION_PHRASES;

/** True when `sourceText` names the instrument behind `key`. */
export function sourceNamesInstrument(sourceText: string | null | undefined, key: JurisdictionEvidenceKey): boolean {
  if (!sourceText) return false;
  return JURISDICTION_EVIDENCE[key].test(sourceText);
}

/**
 * Bind the tender's own text once, then ask for phrases by name. An absent or
 * empty source resolves to the generic wording, so a builder that is not yet
 * plumbed degrades to a true sentence rather than to a false one.
 */
export function jurisdictionFor(sourceText: string | null | undefined): (key: JurisdictionPhraseKey) => string {
  return (key) => {
    const phrase = JURISDICTION_PHRASES[key];
    return sourceNamesInstrument(sourceText, phrase.evidence) ? phrase.specific : phrase.generic;
  };
}

const TOKEN = /\{\{JURISDICTION:([A-Z_]+)\}\}/g;

/**
 * Resolve `{{JURISDICTION:KEY}}` tokens embedded in a static table entry.
 *
 * Static tables cannot call `jurisdictionFor()` at module load, because the
 * tender is not known then. They carry the token instead, and whichever
 * function selects the entry — and therefore already holds the tender text —
 * resolves it. An unknown key resolves to nothing rather than leaving braces in
 * a client document; the regression test pins that no shipped table carries an
 * unknown key.
 */
export function resolveJurisdictionTokens(text: string, sourceText: string | null | undefined): string {
  const phrase = jurisdictionFor(sourceText);
  return text.replace(TOKEN, (_match, key: string) =>
    key in JURISDICTION_PHRASES ? phrase(key as JurisdictionPhraseKey) : "",
  );
}

/** Every `{{JURISDICTION:KEY}}` key used in `text`, for auditing static tables. */
export function jurisdictionTokenKeys(text: string): string[] {
  return Array.from(text.matchAll(TOKEN)).map((m) => m[1]);
}
