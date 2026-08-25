import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildProposalIntelligence } from "../lib/engine/proposal-intelligence";

// ─── What this file proves ───────────────────────────────────────────────────
//
// makeDifferentiators() took the raw tender text and used it for exactly one
// thing:
//
//     // Pharo-specific — claim, not instruction.
//     if (/pharo/i.test(tenderText)) {
//       items.push("Engagement model tuned to private-sector investor
//                   expectations: ...");
//     }
//
// Every neighbouring branch keys on a SOURCE-DERIVED THEME CODE (OIL_GAS,
// FINANCIAL_SERVICES, TELECOMS_BROADBAND). This one keyed on a customer's name,
// which is wrong three ways: a client's name implies nothing about their
// expectations, no evidence backs the claim, and no other client could ever
// receive the behaviour. A benchmark tender must never define the product.
//
// The parameter was removed along with the branch, so the function is now
// structurally incapable of keying on client identity.
//
// The fixtures below are deliberately NOT shaped like the benchmark tender:
// a municipal water-supply supervision assignment, and the same assignment for
// a private developer. Nothing here encodes the benchmark's vocabulary,
// sections, forms, counts or dates.

const company = {
  name: "Meridian Consulting Engineers",
  profileSummary: "Civil and water infrastructure design and construction supervision.",
  serviceLines: JSON.stringify(["Water supply", "Construction supervision", "Contract administration"]),
  sectors: JSON.stringify(["Water", "Municipal infrastructure"]),
};

const experts = [{
  fullName: "A. Okonjo",
  title: "Senior Water Engineer",
  disciplines: JSON.stringify(["Water supply engineering"]),
  sectors: JSON.stringify(["Water"]),
  certifications: JSON.stringify(["Chartered Engineer"]),
  profile: "Twenty years of potable water scheme design and supervision.",
}];

const projects = [{
  name: "Regional Potable Water Scheme — Phase II",
  clientName: "Regional Water Utility",
  sector: "Water",
  serviceAreas: JSON.stringify(["Design", "Supervision"]),
  summary: "Design and construction supervision of a municipal water supply scheme.",
}];

const requirements = [
  { title: "Construction supervision methodology", description: "Provide a supervision methodology and work plan.", priority: "MANDATORY", requirementType: "TECHNICAL" },
  { title: "Key personnel CVs", description: "Provide CVs for the proposed supervision team.", priority: "MANDATORY", requirementType: "PERSONNEL" },
];

/** Same assignment, same evidence — only the client identity differs. */
function intelligenceForClient(clientName: string, mentionInText: string) {
  return buildProposalIntelligence({
    tender: {
      title: "Consultancy Services for Construction Supervision of a Water Supply Scheme",
      clientName,
      procuringEntityName: clientName,
      country: "Kenya",
      description: `Construction supervision services. ${mentionInText}`,
      intakeSummary: `Supervision assignment issued by ${clientName}. ${mentionInText}`,
      submissionMethod: "Email",
    },
    company,
    requirements,
    experts,
    projects,
  });
}

describe("differentiators never depend on who the client is", () => {
  it("produces identical differentiators regardless of the client's name", () => {
    // This is the general invariant. Two structurally identical tenders that
    // differ ONLY in client identity must earn the same differentiators,
    // because a differentiator is a claim about the BIDDER's capability.
    const municipal = intelligenceForClient("Northern Municipal Water Board", "Issued by a public utility.");
    const priv = intelligenceForClient("Pharo Ventures", "Issued by a private investor.");

    assert.deepEqual(
      [...priv.differentiators].sort(),
      [...municipal.differentiators].sort(),
      "changing only the client name changed the differentiators",
    );
  });

  it("never emits the unearned private-investor claim for any client", () => {
    const unearned = /private-sector investor expectations/i;
    for (const clientName of ["Pharo Ventures", "Northern Municipal Water Board", "Pharos Lighthouse Authority"]) {
      const intel = intelligenceForClient(clientName, "Supervision of civil works.");
      for (const item of intel.differentiators) {
        assert.doesNotMatch(item, unearned, `client "${clientName}" received an unearned differentiator`);
      }
    }
  });

  it("still earns theme-driven differentiators from the source, not the client", () => {
    // The generalisation must not have been achieved by making the function
    // inert: a real, source-derived theme still produces content.
    const intel = intelligenceForClient("Northern Municipal Water Board", "Water supply and distribution works.");
    assert.ok(Array.isArray(intel.differentiators));
  });
});

describe("no production logic keys on a specific client identity", () => {
  it("makeDifferentiators no longer accepts raw tender text", () => {
    const source = readFileSync("lib/engine/proposal-intelligence.ts", "utf8");
    const start = source.indexOf("function makeDifferentiators(");
    assert.ok(start > 0, "makeDifferentiators must still exist");
    const signature = source.slice(start, source.indexOf("): string[] {", start));
    assert.doesNotMatch(
      signature,
      /tenderText/,
      "removing only the regex would leave the capability in place for the next shortcut",
    );
  });

  it("no executable branch anywhere in lib/, app/ or components/ tests a client name", () => {
    // Derived, not listed: a new hardcoded client shortcut fails this test
    // rather than shipping. Comments are excluded — the fix documents itself.
    const files = execSync(
      "grep -rlE '\\.test\\(' --include=*.ts --include=*.tsx lib app components || true",
      { encoding: "utf8" },
    ).split("\n").filter(Boolean);

    const offenders: string[] = [];
    for (const file of files) {
      for (const raw of readFileSync(file, "utf8").split("\n")) {
        const line = raw.trim();
        if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
        if (/\/[^/\n]*\b(pharo|tikur|adama)\b[^/\n]*\/i?\s*\.test\(/i.test(line)) {
          offenders.push(`${file}: ${line.slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(offenders, [], "production logic must not branch on a specific client's identity");
  });
});
