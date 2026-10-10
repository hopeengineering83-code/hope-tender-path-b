import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  censusOf,
  enrichProjectPortfolio,
  planProjectEnrichment,
  type EnrichableProject,
  type ProjectUpdateClient,
} from "../lib/engine/project-portfolio-enrichment";

/**
 * Fixing a write path does nothing for rows already written, and the rows
 * already written are the ones the proposal writer reads. This suite executes
 * the enrichment service against a recording client rather than reading its
 * source, because a helper nothing calls and a code path nothing executes are
 * the two ways this kind of fix has silently failed before.
 *
 * The fixture deliberately spans sectors and countries — hospital, road, water,
 * supervision, ICT — so no behaviour here can be satisfied by a healthcare- or
 * Ethiopia-shaped special case.
 */

function recordingClient(): { client: ProjectUpdateClient; writes: Array<{ id: string; data: Record<string, unknown> }> } {
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    writes,
    client: {
      async update(args) {
        writes.push({ id: args.where.id, data: args.data });
        return args;
      },
    },
  };
}

const FIXTURE: EnrichableProject[] = [
  {
    // Everything already right: must not be touched at all.
    id: "p1",
    name: "Regional referral hospital, design and supervision",
    clientName: "Ministry of Health",
    country: "Ethiopia",
    sector: "Healthcare",
    summary: "Design and construction supervision of a 120-bed referral hospital in Bahir Dar, Ethiopia. Construction Cost: 550,074,678.02 ETB. 2015-2018.",
    contractValue: 550074678.02,
    currency: "ETB",
    startDate: new Date("2015-06-30"),
    endDate: new Date("2018-06-30"),
    trustLevel: "SOURCE_VERIFIED",
  },
  {
    // The shape that reached a live bid: a postal address in the country column.
    id: "p2",
    name: "Federal secretariat complex, contract administration",
    country: "Abuja, Federal Capital Territory, Nigeria",
    summary: "Contract administration for a federal secretariat complex. Construction Cost: 1,200,000,000.00 NGN. 2019-2022.",
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    trustLevel: "SOURCE_VERIFIED",
  },
  {
    // Nothing parsed out of a record that carries all of it in its own text.
    id: "p3",
    name: "Rural access roads, feasibility and detailed design",
    country: null,
    summary: "Feasibility study and detailed design for 42 km of rural access roads in Kajiado County, Kenya. Construction Cost: 890,000,000.00 KES. 2021-2023.",
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    trustLevel: "SOURCE_VERIFIED",
  },
  {
    // A placeholder word occupying the column.
    id: "p4",
    name: "Secondary towns water supply master plan",
    country: "None",
    summary: "Water supply and sanitation master plan for three secondary towns in Rwanda. Construction Cost: 88,000,000.00 RWF. 2020-2021.",
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    trustLevel: "REVIEWED",
  },
  {
    // Genuinely ambiguous: two countries on the record. Must be left alone.
    id: "p5",
    name: "Cross-border corridor supervision",
    country: "Kenya and Tanzania",
    summary: "Resident engineer services for a cross-border corridor linking Kenya and Tanzania. Construction Cost: 2,400,000,000.00 KES. 2022-2024.",
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    trustLevel: "SOURCE_VERIFIED",
  },
  {
    // No country anywhere on the record, and a scale figure in the column.
    id: "p6",
    name: "Core banking platform implementation",
    country: "7,000 m2",
    summary: "Core banking software implementation and ICT infrastructure rollout across 34 branches for a commercial bank.",
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    trustLevel: "AI_DRAFT",
  },
];

describe("the census states what the portfolio actually holds", () => {
  it("counts each of the ten figures a run has to report", () => {
    const census = censusOf(FIXTURE);
    assert.equal(census.totalProjects, 6);
    assert.equal(census.sourceVerified, 4);
    assert.equal(census.countryPopulated, 5, "p3 stores no country");
    assert.equal(census.countryValid, 1, "only the hospital row holds a plain country");
    assert.equal(census.countryMalformed, 4);
    assert.equal(census.contractValuePopulated, 1);
    assert.equal(census.currencyPopulated, 1);
    assert.equal(census.startDatePopulated, 1);
    assert.equal(census.endDatePopulated, 1);
    assert.equal(census.bothDatesPopulated, 1);
  });
});

describe("enrichment repairs what it can prove and refuses the rest", () => {
  it("plans nothing for a row that is already correct", () => {
    const plan = planProjectEnrichment(FIXTURE[0]);
    assert.deepEqual(plan.update, {}, "a correct row must not be rewritten");
    assert.equal(plan.countryOutcome, "PRESERVED_VALID");
  });

  it("writes only the planned columns, and only once per row", async () => {
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: FIXTURE, client, apply: true });

    assert.equal(result.applied, true);
    assert.equal(writes.length, result.rowsModified, "one write per modified row");
    assert.deepEqual(
      writes.map((w) => w.id).sort(),
      ["p2", "p3", "p4", "p5", "p6"],
      "every row but the already-correct one has something derivable from its own text",
    );
    for (const write of writes) {
      assert.ok(Object.keys(write.data).length > 0, "no empty update is issued");
      for (const value of Object.values(write.data)) {
        assert.notEqual(value, null, "enrichment never blanks a column");
        assert.notEqual(value, "", "enrichment never blanks a column");
      }
    }
  });

  it("replaces a country only when what is stored is provably not a country", async () => {
    const { client, writes } = recordingClient();
    await enrichProjectPortfolio({ projects: FIXTURE, client, apply: true });
    const byId = new Map(writes.map((w) => [w.id, w.data]));

    assert.equal(byId.get("p2")?.country, "Nigeria", "the composite address yields its country");
    assert.equal(byId.get("p3")?.country, "Kenya", "an empty column is filled from the record's own text");
    assert.equal(byId.get("p4")?.country, "Rwanda", "a placeholder is replaced from the record's own text");
    assert.equal(byId.has("p1"), false, "a valid country is never rewritten");
    assert.equal("country" in (byId.get("p5") ?? {}), false, "an ambiguous record keeps its stored value");
    assert.equal("country" in (byId.get("p6") ?? {}), false, "a record naming no country gets no country");
  });

  it("fills the portfolio numbers that were sitting in each record's own text", async () => {
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: FIXTURE, client, apply: true });
    const byId = new Map(writes.map((w) => [w.id, w.data]));

    assert.equal(byId.get("p2")?.contractValue, 1200000000);
    assert.equal(byId.get("p2")?.currency, "NGN");
    assert.equal(byId.get("p3")?.contractValue, 890000000);
    assert.equal(byId.get("p3")?.currency, "KES");
    assert.ok(byId.get("p3")?.startDate instanceof Date);
    assert.ok(byId.get("p3")?.endDate instanceof Date);
    // The ambiguous row still gets its numbers — only its country is withheld.
    assert.equal(byId.get("p5")?.contractValue, 2400000000);
    assert.equal("country" in (byId.get("p5") ?? {}), false);

    assert.equal(result.contractValueFilled, 4);
    assert.equal(result.currencyFilled, 4);
    assert.equal(result.countryCorrected, 3);
  });

  it("never overwrites a populated number, even when the text says something else", async () => {
    const stubborn: EnrichableProject[] = [
      {
        id: "s1",
        name: "Hospital extension",
        clientName: "Ghana Health Service",
        country: "Ghana",
        sector: "Healthcare",
        summary: "Hospital extension in Accra, Ghana. Construction Cost: 400,000,000.00 GHS. 2018-2020.",
        contractValue: 12345,
        currency: "USD",
        startDate: new Date("2001-01-01"),
        endDate: new Date("2002-01-01"),
        trustLevel: "REVIEWED",
      },
    ];
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: stubborn, client, apply: true });
    assert.equal(writes.length, 0, "a fully populated row is left exactly as it is");
    assert.equal(result.rowsModified, 0);
    assert.equal(result.after.contractValuePopulated, 1);
  });

  it("counts and lists every row whose country it would not decide", async () => {
    const result = await enrichProjectPortfolio({ projects: FIXTURE, apply: false });
    assert.equal(result.rowsSkippedForAmbiguity, 2, "the cross-border row and the record with no country");
    assert.deepEqual(result.unresolvedCountries.map((r) => r.id).sort(), ["p5", "p6"]);
    for (const row of result.unresolvedCountries) {
      assert.ok(row.reason.length > 20, "each skipped row says why it was skipped");
    }
  });

  it("reports a before/after census that a dry run predicts exactly", async () => {
    const dry = await enrichProjectPortfolio({ projects: FIXTURE, apply: false });
    const { client } = recordingClient();
    const wet = await enrichProjectPortfolio({ projects: FIXTURE, client, apply: true });

    assert.deepEqual(dry.after, wet.after, "a dry run must predict what applying would produce");
    assert.equal(dry.before.countryValid, 1);
    assert.equal(dry.after.countryValid, 4, "three malformed countries become real ones");
    assert.equal(dry.after.countryMalformed, 2, "the two unresolvable rows keep their stored values");
    assert.equal(dry.before.contractValuePopulated, 1);
    assert.equal(dry.after.contractValuePopulated, 5);
    assert.equal(dry.after.sourceVerified, dry.before.sourceVerified, "enrichment claims no trust it did not have");
  });

  it("writes nothing at all on a dry run", async () => {
    const { client, writes } = recordingClient();
    const result = await enrichProjectPortfolio({ projects: FIXTURE, client, apply: false });
    assert.equal(writes.length, 0);
    assert.ok(result.rowsModified > 0, "a dry run still reports what it would change");
    assert.equal(result.applied, false);
  });

  it("refuses to apply without a write client rather than silently doing nothing", async () => {
    await assert.rejects(
      () => enrichProjectPortfolio({ projects: FIXTURE, apply: true }),
      /without a write client/,
    );
  });
});
