import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  JURISDICTION_PHRASES,
  jurisdictionFor,
  jurisdictionTokenKeys,
  resolveJurisdictionTokens,
  sourceNamesInstrument,
} from "../lib/engine/jurisdiction-instruments";
import { detectThemes } from "../lib/engine/proposal-intelligence";
import { selectSectorGuidance } from "../lib/engine/proposal-sections";
import { injectMethodologyTables } from "../lib/engine/methodology-tables";
import { injectBeyondSpecTables } from "../lib/engine/beyond-spec-tables";
import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import { enrichSectorVocabulary } from "../lib/engine/sector-vocabulary-enricher";
import { buildValueFrameworkTable } from "../lib/engine/benchmark-tables";
import { buildRisksMitigationsTable } from "../lib/engine/risks-mitigations";

/**
 * THE DEFECT.
 * -----------
 * A previous session made the WRITER PROMPTS in lib/ai.ts source-driven: an
 * Ethiopian instrument is named there only when a source names it. It left the
 * DETERMINISTIC builders alone, because those tables are static module
 * constants and the functions that emit them did not receive the tender text.
 *
 * So the same fabricated compliance claim kept shipping by the other route.
 * Whatever the tender's country, the delivered document could still say:
 *
 *   - "Ethiopian Health Authority licensing documentation" (theme bullet)
 *   - "seismic detailing to EBCS-8"                        (theme bullet)
 *   - "Ethiopian EPA/WHO standards"                        (theme bullet)
 *   - "rejected by AA City Authority"                      (risk register)
 *   - "within ERA spec"                                    (QA/ITP table)
 *   - "Pavement Design (AASHTO / ERA Standards)"           (scope items)
 *   - "Design to Ethiopian seismic zone requirements"      (sustainability)
 *
 * A Kenyan hospital bid was therefore told its structural calculations go to a
 * city authority in Addis Ababa. That is the same class of defect as printing
 * an unstated currency as ETB: a legal claim with no source behind it.
 *
 * THE FIX IS NOT DELETION — deleting EBCS would cost real technical depth on an
 * Ethiopian tender, where EBCS genuinely governs. The instrument is named only
 * when a source names it, and described by its function otherwise, so the
 * sentence stays true in every jurisdiction. The tables carry a
 * {{JURISDICTION:KEY}} token; whichever function selects the entry — and so
 * already holds the tender text — resolves it.
 *
 * Note what is NOT in scope: `triggers`, `proofTerms` and place-name tables
 * mention Ethiopian terms in order to RECOGNISE them in a source. Recognising a
 * term is the opposite of asserting it.
 */

// ── Fixtures: same discipline, two countries ─────────────────────────────────
/**
 * Comments are stripped before any source file is scanned. The catalogue's own
 * docstring carries a {{JURISDICTION:KEY}} example, and a module explaining the
 * defect quotes the strings the defect produced — this repository has more than
 * once had a test pass or fail on its own prose rather than on its code.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const ETHIOPIAN_HIGH_RISE = [
  "Design and supervision of a G+14 mixed-use tower in Addis Ababa, Ethiopia.",
  "Structural design shall comply with EBCS-8 / ES EN 1998 seismic provisions.",
  "Materials testing to EBCS standards. Hospital wing licensed by the Ethiopian Health Authority.",
  "Road access works: pavement design per the ERA design manual. Effluent to Ethiopian EPA standards.",
].join("\n");

const KENYAN_HIGH_RISE = [
  "Design and supervision of a G+14 mixed-use tower in Nairobi, Kenya.",
  "Structural design shall comply with the seismic provisions applicable in Kenya.",
  "Materials testing to the national standard. Hospital wing licensed by the health regulator.",
  "Road access works: pavement design for the access road. Effluent treatment for the site.",
].join("\n");

/** Instruments that must never appear unless a source named them. */
const NAMED_INSTRUMENTS = [
  /EBCS/,
  /ES EN 1998/,
  /Ethiopian Health Authority/,
  /Ethiopian EPA/,
  /Ethiopian seismic/,
  /AA City/,
  /Addis Ababa/,
  /\bERA\b/,
];

function assertNamesNoInstrument(text: string, where: string): void {
  for (const rx of NAMED_INSTRUMENTS) {
    assert.equal(rx.test(text), false, `${where} named ${rx} although no source named it:\n${text}`);
  }
}

function assertNoUnresolvedToken(text: string, where: string): void {
  assert.equal(/\{\{JURISDICTION:/.test(text), false, `${where} shipped an unresolved token:\n${text}`);
  assert.equal(/\{\{/.test(text), false, `${where} shipped stray braces:\n${text}`);
}

describe("a deterministic table names a regulator only when a source names it", () => {
  it("resolves each catalogued phrase both ways, and never leaves braces", () => {
    for (const [key, phrase] of Object.entries(JURISDICTION_PHRASES)) {
      // A source that names the instrument gets the specific wording.
      const named = jurisdictionFor(phrase.specific)(key as keyof typeof JURISDICTION_PHRASES);
      // A source that names nothing at all gets the functional description.
      const unnamed = jurisdictionFor("a tender in a country this catalogue has never heard of")(
        key as keyof typeof JURISDICTION_PHRASES,
      );
      assert.equal(named, phrase.specific, `${key}: a source naming the instrument must get it back`);
      assert.equal(unnamed, phrase.generic, `${key}: an unrelated source must get the generic wording`);
      assert.notEqual(phrase.specific, phrase.generic, `${key}: the two forms must actually differ`);
      // The generic form must be a true sentence fragment, not a placeholder.
      assert.equal(/unknown|N\/A|TBD|to be confirmed|not specified/i.test(phrase.generic), false, key);
    }
  });

  it("treats an absent source as 'not named', never as permission", () => {
    assert.equal(sourceNamesInstrument(undefined, "SEISMIC_DESIGN_CODE"), false);
    assert.equal(sourceNamesInstrument(null, "SEISMIC_DESIGN_CODE"), false);
    assert.equal(sourceNamesInstrument("", "SEISMIC_DESIGN_CODE"), false);
    assert.equal(
      resolveJurisdictionTokens("submit to {{JURISDICTION:STRUCTURAL_APPROVAL_AUTHORITY}}", undefined),
      `submit to ${JURISDICTION_PHRASES.STRUCTURAL_APPROVAL_AUTHORITY.generic}`,
    );
  });

  it("every token shipped in lib/ names a key the catalogue defines", () => {
    // A typo'd key would resolve to the empty string and silently delete a
    // clause from a delivered document. This is the guard that makes the token
    // indirection safe to use in static tables.
    const seen = new Map<string, string[]>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) {
          for (const key of jurisdictionTokenKeys(codeOnly(readFileSync(path, "utf8")))) {
            seen.set(key, [...(seen.get(key) ?? []), path]);
          }
        }
      }
    };
    walk("lib");
    walk("app");
    assert.ok(seen.size > 0, "expected the shipped tables to carry jurisdiction tokens");
    for (const [key, files] of seen) {
      assert.ok(key in JURISDICTION_PHRASES, `unknown token key ${key} in ${files.join(", ")}`);
    }
  });

  it("theme methodology bullets follow the tender's country", () => {
    const forSource = (tenderText: string) =>
      detectThemes(tenderText).flatMap((t) => t.methodologyBullets).join("\n");

    const ethiopian = forSource(ETHIOPIAN_HIGH_RISE);
    const kenyan = forSource(KENYAN_HIGH_RISE);

    // Zero depth traded on the tender that really is governed by EBCS.
    assert.match(ethiopian, /Ethiopian seismic zone/);
    assert.match(ethiopian, /EBCS \/ ES EN 1998/);
    assertNoUnresolvedToken(ethiopian, "Ethiopian theme bullets");

    assertNamesNoInstrument(kenyan, "Kenyan theme bullets");
    assertNoUnresolvedToken(kenyan, "Kenyan theme bullets");
    assert.match(kenyan, /seismic zone of the project location/);
  });

  it("sector guidance bullets follow the tender's country", () => {
    const bullets = (text: string) => selectSectorGuidance(text).map((e) => e.bullet).join("\n");
    const ethiopian = bullets(ETHIOPIAN_HIGH_RISE);
    const kenyan = bullets(KENYAN_HIGH_RISE);

    assert.match(ethiopian, /EBCS \/ ES EN 1998/);
    assert.match(ethiopian, /AA City Authority/);
    assertNoUnresolvedToken(ethiopian, "Ethiopian sector guidance");

    assertNamesNoInstrument(kenyan, "Kenyan sector guidance");
    assertNoUnresolvedToken(kenyan, "Kenyan sector guidance");
  });

  it("the risk register and ITP table follow the tender's country", () => {
    const tables = (sourceText: string, primarySector = "High-Rise & Multi-Storey Buildings") =>
      injectMethodologyTables("# Section C: Technical Approach\n\nbody\n", {
        primarySector,
        experts: [],
        projects: [],
        sourceText,
      }).markdown;

    const ethiopian = tables(ETHIOPIAN_HIGH_RISE);
    const kenyan = tables(KENYAN_HIGH_RISE);

    assert.match(ethiopian, /AA City Authority/);
    assert.match(ethiopian, /Ethiopian seismic zone/);
    assertNoUnresolvedToken(ethiopian, "Ethiopian methodology tables");

    assertNamesNoInstrument(kenyan, "Kenyan methodology tables");
    assertNoUnresolvedToken(kenyan, "Kenyan methodology tables");

    // The ITP table is reached through the road branch, which the high-rise
    // sector above never enters.
    const road = "Road / Bridge / Transport Infrastructure";
    assert.match(tables("pavement design per the ERA design manual", road), /ERA \/ AASHTO/);
    const kenyanRoad = tables("pavement design for the Nairobi access road", road);
    assertNamesNoInstrument(kenyanRoad, "Kenyan road tables");
    assertNoUnresolvedToken(kenyanRoad, "Kenyan road tables");
  });

  it("the canonical work plan follows the tender's country", () => {
    const deliverables = (sourceText?: string) =>
      canonicalWorkPlan({ sector: "Road / Bridge / Transport Infrastructure", sourceText })
        .map((p) => p.deliverables)
        .join("\n");

    assert.match(deliverables("pavement design per the ERA design manual"), /ERA \/ AASHTO/);
    const kenyan = deliverables("pavement design for the Nairobi access road");
    assertNamesNoInstrument(kenyan, "Kenyan work plan");
    assertNoUnresolvedToken(kenyan, "Kenyan work plan");
    // AASHTO is international, so it survives the generic form — the fix is
    // about the NATIONAL manual, not about stripping every standard.
    assert.match(kenyan, /AASHTO/);

    // An un-plumbed caller degrades to the true sentence, never to the false one.
    assertNamesNoInstrument(deliverables(undefined), "work plan with no source at all");
  });

  it("the sustainability table follows the tender's country", () => {
    const table = (sourceText: string) =>
      injectBeyondSpecTables("# Section C: Technical Approach\n\nbody\n", {
        primarySector: "High-rise building design",
        sourceText,
      }).markdown;

    assert.match(table(ETHIOPIAN_HIGH_RISE), /EBCS \/ ES EN 1998/);
    const kenyan = table(KENYAN_HIGH_RISE);
    assertNamesNoInstrument(kenyan, "Kenyan sustainability table");
    assertNoUnresolvedToken(kenyan, "Kenyan sustainability table");
  });

  it("the sector glossary and value framework follow the tender's country", () => {
    const glossary = (sourceText: string) =>
      enrichSectorVocabulary({ markdown: "# Proposal\n\nbody\n", primarySector: "Water & Sanitation Infrastructure", sourceText })
        .markdown;
    assert.match(glossary("Materials testing to EBCS standards for the borehole works"), /EBCS \/ ASTM/);
    const kenyanGlossary = glossary("Borehole and water supply works in Nairobi, Kenya");
    assertNamesNoInstrument(kenyanGlossary, "Kenyan glossary");
    assertNoUnresolvedToken(kenyanGlossary, "Kenyan glossary");

    const framework = (sourceText: string) =>
      buildValueFrameworkTable({ primarySector: "Road / Bridge / Transport Infrastructure", clientName: "Client", sourceText });
    assert.match(framework("pavement design per the ERA design manual"), /ERA \/ AASHTO/);
    const kenyanFramework = framework("pavement design for the Nairobi access road");
    assertNamesNoInstrument(kenyanFramework, "Kenyan value framework");
    assertNoUnresolvedToken(kenyanFramework, "Kenyan value framework");
  });

  it("the risk register mitigation and the geotech QA line follow the tender's country", () => {
    const risks = (sourceText: string) =>
      buildRisksMitigationsTable({ primarySector: "High-Rise & Multi-Storey Buildings", clientName: "Client", sourceText });
    assert.match(risks(ETHIOPIAN_HIGH_RISE), /EBCS \/ ES EN 1998/);
    const kenyanRisks = risks(KENYAN_HIGH_RISE);
    assertNamesNoInstrument(kenyanRisks, "Kenyan risk register");
    assertNoUnresolvedToken(kenyanRisks, "Kenyan risk register");

    // Where international standards are already named alongside it, only the
    // NATIONAL standard is conditional — ASTM and BS survive either way.
    const geo = (sourceText: string) =>
      resolveJurisdictionTokens("standards (ASTM / BS / {{JURISDICTION:NATIONAL_MATERIALS_STANDARD}})", sourceText);
    assert.equal(geo("testing to EBCS"), "standards (ASTM / BS / EBCS)");
    assert.equal(geo("testing in Nairobi"), "standards (ASTM / BS / the applicable national standard)");
  });

  it("no module in lib/ or app/ still asserts an instrument outside the catalogue", () => {
    // The point of the fix is that there is ONE place a jurisdiction instrument
    // is named. Checking only the builders the fixtures reach is how three more
    // sites — a risk mitigation, a geotech QA line, and a cover-page example
    // priming the writer with ETB and a national licensor — survived the first
    // pass of this work. So the whole tree is scanned as source text, with
    // comments stripped.
    //
    // lib/ai.ts is exempt from the STRING scan and checked separately below: it
    // holds the specific arms of its own instrument() calls, which are correct.
    const ASSERTIONS = [
      /"[^"]*Ethiopian (?:Health Authority|EPA|seismic|Building Code|Construction Authority)/,
      /"[^"]*AA City/,
      /"[^"]*EBCS-8/,
      /"[^"]*EBCS ?\/ ?(?:ASTM|ES EN|EN 199)/,
      /"[^"]*ERA ?\/ ?AASHTO/,
      /"[^"]*AASHTO ?\/ ?ERA/,
    ];
    const EXEMPT = new Set(["lib/engine/jurisdiction-instruments.ts", "lib/ai.ts"]);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|cjs)$/.test(entry.name) && !EXEMPT.has(path)) {
          const source = codeOnly(readFileSync(path, "utf8"));
          for (const rx of ASSERTIONS) {
            const hit = source.match(rx);
            if (hit) offenders.push(`${path}: ${hit[0].slice(0, 90)}`);
          }
        }
      }
    };
    walk("lib");
    // app/ as well: a route handler or a panel string can assert a regulator
    // just as easily as a table can, and nothing about the defect is confined
    // to lib/.
    walk("app");
    assert.deepEqual(offenders, [], `modules asserting a jurisdiction instrument directly:\n${offenders.join("\n")}`);
  });

  it("every instrument lib/ai.ts names sits behind its own source test", () => {
    // ai.ts is prompt register, not prose, so it keeps its own wordings — but
    // every Ethiopian instrument it names must be an argument to instrument(),
    // never a bare string. A cover-page EXAMPLE counts: showing the writer
    // "ETB 675M+" primes exactly the fabricated currency the rest of this work
    // exists to prevent.
    const source = codeOnly(readFileSync("lib/ai.ts", "utf8"));
    const NAMED = /(?:Ethiopian (?:Health Authority|EPA|seismic)|AA City|EBCS|\bERA\b|\bETB\b|EIASC)/g;
    const unguarded: string[] = [];
    for (const line of source.split("\n")) {
      if (!NAMED.test(line)) { NAMED.lastIndex = 0; continue; }
      NAMED.lastIndex = 0;
      // A line is guarded when the instrument sits inside an instrument(...)
      // call; when it is a DETECTION regex, which asserts nothing; or when it
      // is an enumerated multi-currency EXAMPLE LIST. That last exemption is
      // narrow and deliberate: "(e.g. USD, ETB, KES, NGN, TZS, INR, AED)" shows
      // the model the SHAPE of an ISO 4217 code across four continents, which
      // is the opposite of steering it toward one country's currency.
      const currencyExampleList = /ISO 4217[^"]*USD[^"]*KES/.test(line);
      const guarded = /instrument\(/.test(line)
        || currencyExampleList
        || /\/[^/]*\bi?\b[^/]*\/[gimsuy]*\.test|test\(|triggers:|proofTerms:|match\(|replace\(|\.exec\(/.test(line);
      if (!guarded) unguarded.push(line.trim().slice(0, 120));
    }
    assert.deepEqual(unguarded, [], `lib/ai.ts names an instrument outside instrument():\n${unguarded.join("\n")}`);
  });
});
