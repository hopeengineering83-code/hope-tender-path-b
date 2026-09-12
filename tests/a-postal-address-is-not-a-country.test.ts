import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  canonicaliseCountry,
  classifyCountryValue,
  findCountriesInText,
  isValidCountryValue,
  resolveProjectCountry,
} from "../lib/engine/country-reference";
import { extractProjectFacts, mergeProjectFacts } from "../lib/engine/project-fact-extractor";

/**
 * THE DEFECT
 * ----------
 * `Project.country` is a country column. Both ingestion paths wrote whatever
 * the source payload happened to put in that slot, and on the owner's own
 * portfolio not one of 114 records ended up holding a plain country: the
 * column carried postal addresses, "City, Region, Country" composites, client
 * names, floor-area figures and placeholder words. Three consumers read it as
 * a country anyway - the portfolio card renders it as the project LOCATION,
 * the tender/project matcher scores country agreement by substring, and the
 * writer context prints ", <country>" after every project name - which is how
 * "Abuja, Federal Capital Territory, Nigeria" reached the opening capability
 * paragraph of an Ethiopian bid.
 *
 * A second, quieter defect sat in the extractor: country knowledge was a
 * hand-written list of two dozen mostly East African names, scanned in list
 * order, so list order decided the answer. A project whose text mentioned a
 * head office in Addis Ababa came out as Ethiopia no matter where the work
 * actually was, and a project in Vietnam, Peru or Jordan came out as nothing
 * at all because those countries were not on the list.
 *
 * WHAT IS PINNED HERE
 * -------------------
 * That a country value is judged by what it is rather than by whether it is
 * non-empty; that a correction may only use the record's OWN evidence; that
 * ambiguity produces no answer instead of a plausible one; that no country
 * and no sector is privileged; and that both ingestion paths actually call the
 * resolver, because a helper the write path never invokes fixes nothing.
 */

describe("a value in the country column is judged by whether it is a country", () => {
  it("accepts plain countries from every region, in the spellings tenders actually use", () => {
    // No regional bias: if this list ever shrinks toward one continent, the
    // reference table has started to become region-shaped again.
    for (const value of [
      "Ethiopia", "Kenya", "Nigeria", "Ghana", "South Africa", "Egypt",
      "Vietnam", "Bangladesh", "Nepal", "Philippines", "Indonesia",
      "Peru", "Brazil", "Colombia", "Mexico",
      "Jordan", "Iraq", "Yemen", "Saudi Arabia",
      "Germany", "Portugal", "Poland", "Ireland", "Australia", "Canada",
      "Papua New Guinea", "Trinidad and Tobago", "Bosnia and Herzegovina",
    ]) {
      assert.equal(isValidCountryValue(value), true, `${value} should be a valid country`);
      assert.equal(canonicaliseCountry(value), value);
    }
  });

  it("accepts the aliases and casings the same country arrives under", () => {
    assert.equal(canonicaliseCountry("ethiopia"), "Ethiopia");
    assert.equal(canonicaliseCountry("ETHIOPIA"), "Ethiopia");
    assert.equal(canonicaliseCountry("  Kenya  "), "Kenya");
    assert.equal(canonicaliseCountry("United Republic of Tanzania"), "Tanzania");
    assert.equal(canonicaliseCountry("the netherlands"), "Netherlands");
    assert.equal(canonicaliseCountry("Czech Republic"), "Czechia");
    assert.equal(canonicaliseCountry("Ivory Coast"), "Cote d'Ivoire");
    assert.equal(canonicaliseCountry("Côte d'Ivoire"), "Cote d'Ivoire");
    assert.equal(canonicaliseCountry("Democratic Republic of the Congo"), "DRC");
    assert.equal(canonicaliseCountry("UAE"), "United Arab Emirates");
    assert.equal(canonicaliseCountry("UK"), "United Kingdom");
    assert.equal(canonicaliseCountry("USA"), "United States");
    assert.equal(canonicaliseCountry("Turkiye"), "Turkey");
  });

  it("rejects, with a reason, each malformed shape the live vault actually held", () => {
    const cases: Array<[string, string]> = [
      ["Abuja, Federal Capital Territory, Nigeria", "COMPOSITE_LOCATION"],
      ["Kigali, Rwanda", "COMPOSITE_LOCATION"],
      ["Plot 14, Ring Road, Accra, Ghana", "COMPOSITE_LOCATION"],
      ["Addis Ababa", "NOT_A_COUNTRY"],
      ["Oromia Region", "NOT_A_COUNTRY"],
      ["7,000 m2", "NOT_A_COUNTRY"],
      ["G+4 mixed-use building", "NOT_A_COUNTRY"],
      ["Pharo Foundation", "NOT_A_COUNTRY"],
      ["Ministry of Water and Energy", "NOT_A_COUNTRY"],
      ["Addis Ab", "NOT_A_COUNTRY"],
      ["None", "PLACEHOLDER"],
      ["N/A", "PLACEHOLDER"],
      ["Unknown", "PLACEHOLDER"],
      ["not specified", "PLACEHOLDER"],
      ["Bid-Team to confirm", "PLACEHOLDER"],
      ["Various", "PLACEHOLDER"],
      ["Kenya and Uganda", "MULTIPLE_COUNTRIES"],
      ["Ethiopia / Somalia cross-border", "MULTIPLE_COUNTRIES"],
    ];
    for (const [value, reason] of cases) {
      const classification = classifyCountryValue(value);
      assert.equal(classification.kind, "MALFORMED", `${value} should be malformed`);
      assert.equal(
        classification.kind === "MALFORMED" ? classification.reason : null,
        reason,
        `${value} should be malformed because ${reason}`,
      );
      assert.equal(isValidCountryValue(value), false);
    }
  });

  it("treats an empty column as empty rather than as a malformed value", () => {
    for (const value of ["", "   ", null, undefined]) {
      assert.equal(classifyCountryValue(value).kind, "EMPTY");
    }
  });
});

describe("countries are found in prose without one country outranking another", () => {
  it("reads the country out of tender and portfolio prose across sectors", () => {
    const cases: Array<[string, string[]]> = [
      ["Design and construction supervision of a 120-bed referral hospital in Bahir Dar, Ethiopia", ["Ethiopia"]],
      ["Feasibility study and detailed design for 42 km of rural access roads in Kajiado County, Kenya", ["Kenya"]],
      ["Water supply and sanitation master plan for three secondary towns in Rwanda", ["Rwanda"]],
      ["Resident engineer services for urban drainage works, Dar es Salaam, Tanzania", ["Tanzania"]],
      ["Expression of interest: geotechnical investigation for a port extension in Vietnam", ["Vietnam"]],
      ["Request for proposals - core banking software implementation and ICT infrastructure, Jordan", ["Jordan"]],
      ["Logistics and procurement support services framework, Peru", ["Peru"]],
      ["Structural and MEP design of an industrial cold store, Ho Chi Minh City, Vietnam", ["Vietnam"]],
      ["Contract administration for a mixed-use development in Accra, Ghana", ["Ghana"]],
      ["Urban planning and land-use study, Kathmandu valley, Nepal", ["Nepal"]],
    ];
    for (const [text, expected] of cases) {
      assert.deepEqual(findCountriesInText(text), expected, text);
    }
  });

  it("reports every country a text names, in the order they appear", () => {
    assert.deepEqual(
      findCountriesInText("Cross-border corridor linking Kenya and Tanzania, financed alongside a parallel package in Uganda"),
      ["Kenya", "Tanzania", "Uganda"],
    );
  });

  it("counts a long country name once rather than as its own shorter substring", () => {
    assert.deepEqual(findCountriesInText("Works in the Democratic Republic of Congo"), ["DRC"]);
    assert.deepEqual(findCountriesInText("Roads in Equatorial Guinea"), ["Equatorial Guinea"]);
    assert.deepEqual(findCountriesInText("A bridge in Papua New Guinea"), ["Papua New Guinea"]);
    assert.deepEqual(findCountriesInText("Irrigation in South Sudan"), ["South Sudan"]);
  });

  it("does not mistake a longer word that merely starts with a country name", () => {
    assert.deepEqual(findCountriesInText("Nigerian clients and Indianapolis offices and Omani partners"), []);
    assert.deepEqual(findCountriesInText("a chadic language survey"), []);
  });

  it("does not read a country out of a geographic feature that borrows its name", () => {
    // "Niger Delta" is in Nigeria; the "Congo Basin" spans six countries; the
    // "Jordan River" is a border. Each of these would put a wrong country in a
    // bid, which is exactly the harm this module exists to prevent.
    assert.deepEqual(findCountriesInText("Flood protection works in the Niger Delta"), []);
    assert.deepEqual(findCountriesInText("Forestry inventory across the Congo Basin"), []);
    assert.deepEqual(findCountriesInText("Irrigation intake on the Jordan River"), []);
    assert.deepEqual(findCountriesInText("Offshore survey in the Gulf of Mexico"), []);
    // The country itself still reads normally when it is the country.
    assert.deepEqual(findCountriesInText("Flood protection works in Niger"), ["Niger"]);
    assert.deepEqual(findCountriesInText("A hospital in Jordan"), ["Jordan"]);
  });

  it("does not read ordinary lowercase prose as a country abbreviation", () => {
    // "us", "uk" and similar are words. Only the capitalised abbreviation counts.
    assert.deepEqual(findCountriesInText("us and our partners provided all of the design work"), []);
    assert.deepEqual(findCountriesInText("Provided to US federal agencies"), ["United States"]);
  });

  it("gives no country precedence over any other, in either order", () => {
    // The old extractor walked a hand-written list and took the first hit, so
    // Ethiopia beat everything by sitting near the top of that list. Order of
    // mention must not decide, and neither must table order.
    const forward = "Site office in Addis Ababa, Ethiopia; the works themselves are in Ghana";
    const reverse = "The works themselves are in Ghana; site office in Addis Ababa, Ethiopia";
    assert.deepEqual(findCountriesInText(forward), ["Ethiopia", "Ghana"]);
    assert.deepEqual(findCountriesInText(reverse), ["Ghana", "Ethiopia"]);
    // And the extractor, which must decide a single value, refuses both ways.
    assert.equal(extractProjectFacts(forward).country, undefined);
    assert.equal(extractProjectFacts(reverse).country, undefined);
  });
});

describe("a country correction may only use the record's own evidence", () => {
  it("never touches a value that is already a country, whatever the source text says", () => {
    const resolution = resolveProjectCountry({
      storedCountry: "Kenya",
      sourceText: "Works executed in Uganda under a regional framework",
    });
    assert.equal(resolution.outcome, "PRESERVED_VALID");
    assert.equal(resolution.shouldWrite, false);
    assert.equal(resolution.country, "Kenya");
  });

  it("leaves a valid country in its stored spelling rather than renaming it", () => {
    const resolution = resolveProjectCountry({ storedCountry: "Democratic Republic of Congo", sourceText: "" });
    assert.equal(resolution.outcome, "PRESERVED_VALID");
    assert.equal(resolution.shouldWrite, false);
    assert.equal(resolution.country, "Democratic Republic of Congo");
  });

  it("takes the country out of a composite the record already stored", () => {
    const resolution = resolveProjectCountry({
      storedCountry: "Abuja, Federal Capital Territory, Nigeria",
      sourceText: "Consultancy services for a federal secretariat complex",
    });
    assert.equal(resolution.outcome, "RESOLVED_FROM_STORED_VALUE");
    assert.equal(resolution.shouldWrite, true);
    assert.equal(resolution.country, "Nigeria");
    // The displaced detail is reported, not silently discarded.
    assert.equal(resolution.displacedDetail, "Abuja, Federal Capital Territory, Nigeria");
  });

  it("falls back to the record's own source text when the stored value names no country", () => {
    for (const stored of [null, "", "None", "Unknown", "Addis Ab", "Ministry of Health"]) {
      const resolution = resolveProjectCountry({
        storedCountry: stored,
        sourceText: "Detailed design of a water treatment plant in Kigali, Rwanda. Construction Cost: 88,000,000.00 RWF",
      });
      assert.equal(resolution.outcome, "RESOLVED_FROM_SOURCE_TEXT", `stored=${String(stored)}`);
      assert.equal(resolution.shouldWrite, true);
      assert.equal(resolution.country, "Rwanda");
    }
  });

  it("refuses to choose when the record's own evidence names more than one country", () => {
    const fromStored = resolveProjectCountry({ storedCountry: "Kenya and Tanzania", sourceText: "" });
    assert.equal(fromStored.outcome, "UNRESOLVED_AMBIGUOUS");
    assert.equal(fromStored.shouldWrite, false);
    assert.equal(fromStored.country, "Kenya and Tanzania");

    const fromText = resolveProjectCountry({
      storedCountry: "None",
      sourceText: "Supervision of works in Ghana, coordinated from our office in Nigeria",
    });
    assert.equal(fromText.outcome, "UNRESOLVED_AMBIGUOUS");
    assert.equal(fromText.shouldWrite, false);
    assert.deepEqual([...fromText.candidates], ["Ghana", "Nigeria"]);
  });

  it("refuses to invent a country when the record's evidence names none", () => {
    const empty = resolveProjectCountry({ storedCountry: null, sourceText: "Structural design of a warehouse, 7,000 m2" });
    assert.equal(empty.outcome, "UNRESOLVED_NO_EVIDENCE");
    assert.equal(empty.shouldWrite, false);
    assert.equal(empty.country, null);

    const junk = resolveProjectCountry({ storedCountry: "7,000 m2", sourceText: "Structural design of a warehouse" });
    assert.equal(junk.outcome, "UNRESOLVED_NO_EVIDENCE");
    assert.equal(junk.shouldWrite, false);
    assert.equal(junk.country, "7,000 m2", "an unresolvable value is reported, not blanked");
  });

  it("always explains itself, whatever it decides", () => {
    for (const input of [
      { storedCountry: "Kenya", sourceText: "" },
      { storedCountry: "Kigali, Rwanda", sourceText: "" },
      { storedCountry: "None", sourceText: "Works in Peru" },
      { storedCountry: "Kenya and Uganda", sourceText: "" },
      { storedCountry: null, sourceText: "no place named" },
    ]) {
      const resolution = resolveProjectCountry(input);
      assert.ok(resolution.reason.length > 20, JSON.stringify(input));
    }
  });

  it("has no way to reach the tender, the company, or another project", () => {
    // Rule 4 of the owner's authorisation is a property of the signature, not
    // of a code path: the resolver takes a stored value and one record's text,
    // so there is nothing else it could consult.
    const source = readFileSync(path.join(__dirname, "..", "lib", "engine", "country-reference.ts"), "utf8");
    const resolver = source.slice(source.indexOf("export function resolveProjectCountry"));
    for (const name of ["tender", "company", "prisma", "fetch(", "process.env"]) {
      assert.equal(resolver.toLowerCase().includes(name), false, `the resolver must not reference ${name}`);
    }
  });
});

describe("the extractor no longer depends on a hand-written regional list", () => {
  it("recovers a country for projects outside the region the old list covered", () => {
    // None of these were in the old COUNTRY_TOKENS list, so every project
    // outside East and West Africa lost its country silently.
    const cases: Array<[string, string]> = [
      ["Detailed engineering design of a municipal wastewater plant in Hanoi, Vietnam", "Vietnam"],
      ["Construction supervision of a district hospital in Lima, Peru", "Peru"],
      ["Contract administration for a university campus in Amman, Jordan", "Jordan"],
      ["Feasibility study for a light rail extension in Manila, Philippines", "Philippines"],
      ["Geotechnical investigation for a hydropower headworks in Nepal", "Nepal"],
    ];
    for (const [summary, country] of cases) {
      assert.equal(extractProjectFacts(summary).country, country, summary);
    }
  });

  it("still leaves the merge fill-only, so a stored value is never overwritten by extraction", () => {
    const merged = mergeProjectFacts(
      { country: "Kenya" },
      { country: "Ethiopia" },
    );
    assert.equal(merged.country, undefined, "extraction must not overwrite a stored country");
  });
});

describe("both ingestion paths actually apply the resolver", () => {
  const read = (relative: string) => readFileSync(path.join(__dirname, "..", relative), "utf8");

  it("the bulk Plan-B import resolves the country before it decides trust", () => {
    const source = read("app/api/company/plan-b-import/route.ts");
    assert.ok(source.includes('import { resolveProjectCountry }'), "the bulk import must import the resolver");
    const call = source.indexOf("const countryResolution = resolveProjectCountry(");
    assert.ok(call > 0, "the bulk import must call the resolver");
    const trust = source.indexOf("const projectDecision = decidePlanBTrust(");
    assert.ok(trust > call, "the value that gets source-verified must be the value that gets stored");
    // The verbatim payload write this replaced must not come back.
    assert.equal(
      source.includes("const country = clean(project.country) || null;"),
      false,
      "the payload's country must not be written to the country column unexamined",
    );
  });

  it("the single-project route resolves the country too", () => {
    const source = read("app/api/company/projects/route.ts");
    assert.ok(source.includes('import { resolveProjectCountry }'));
    assert.ok(source.includes("resolveProjectCountry({"), "the single-project route must call the resolver");
  });

  it("reports how many countries it repaired and how many it refused to guess", () => {
    const source = read("app/api/company/plan-b-import/route.ts");
    assert.ok(source.includes("countryCorrected"), "an import must state what it changed");
    assert.ok(source.includes("countryUnresolved"), "an import must state what it left for review");
    assert.ok(
      /projects: \{[^}]*countryCorrected[^}]*countryUnresolved/.test(source),
      "both counts belong in the import response, not only in a log line",
    );
  });
});
