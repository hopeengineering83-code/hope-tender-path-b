// Differential classifier test: the COMPANY_PROFILE decision must be ONE rule.
//
// WHY THIS FILE EXISTS
// --------------------
// Known debt recorded in operator_handoff.md (inherited from the #1303
// review): "reconcile-generated-docs.ts carries its own COMPANY_PROFILE
// classifier separate from classifySupportDoc in the generate route — the
// same one-rule-in-two-places shape that produced the pricing-detector bug."
//
// The two rules disagreed on real names:
//
//   name                     reconciler (regex, \s+ only)   generate route (separator-normalised)
//   "Company Profile"        COMPANY_PROFILE                COMPANY_PROFILE
//   "Company-Profile"        — (hyphen defeats \s+)         COMPANY_PROFILE
//   "02-Company-Profile.docx"—                              COMPANY_PROFILE
//   "02_Company_Profile.docx"—                              COMPANY_PROFILE
//   "Firm Profile"           COMPANY_PROFILE                — GENERIC
//   "Organisational Profile" COMPANY_PROFILE                — GENERIC
//   "About Us"               COMPANY_PROFILE                — GENERIC
//   "Capability Statement"   —                              COMPANY_PROFILE
//
// A confirmed plan's Company Profile row could therefore reconcile one way
// and generate another. Per the release-closure instruction, the behaviour
// was first differentially compared (it disagreed), then centralised into
// ONE canonical predicate — COMPANY_PROFILE_DOC_NAME_RX /
// isCompanyProfileDocName in lib/engine/document-type-normalizer.ts — with
// the smallest safe diff: classification only decides WHICH producer writes
// the document (company evidence vs placeholder); no gate, envelope or
// integrity rule depends on it.
//
// Route files cannot export extra named functions (Next.js validates route
// exports at build time), so the generate route's side of the contract is
// pinned by source assertions in the same style as
// tests/auto-finalize-convergence-truth.test.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isCompanyProfileDocName, COMPANY_PROFILE_DOC_NAME_RX } from "../lib/engine/document-type-normalizer";
import { semanticCategory } from "../lib/engine/reconcile-generated-docs";

const GENERATE_ROUTE = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
const RECONCILER = readFileSync("lib/engine/reconcile-generated-docs.ts", "utf8");

const PROFILE_NAMES = [
  "Company Profile",
  "company profile",
  "COMPANY PROFILE",
  "Company-Profile",
  "company_profile",
  "Company.Profile",
  "02-Company-Profile.docx",
  "02_Company_Profile.docx",
  "03-Company-Profile.docx",
  "Firm Profile",
  "Firm-Profile.docx",
  "Organisational Profile",
  "Organizational Profile",
  "Organisational-Profile.docx",
  "About Us",
  "About-Us.docx",
  "Capability Statement",
  "Capability-Statement.docx",
  "03-Capability-Statement.docx",
  "company profile.pdf",
];

const NON_PROFILE_NAMES = [
  "Technical Proposal",
  "01-Technical-Proposal.docx",
  "Financial Proposal",
  "02-Financial-Proposal.docx",
  "Compliance Matrix",
  "04-Compliance-Matrix.docx",
  "Expert CVs",
  "Expression of Interest",
  "01-Expression-Of-Interest.docx",
];

describe("the ONE company-profile rule decides every name shape the same way", () => {
  for (const name of PROFILE_NAMES) {
    it(`predicate accepts: ${name}`, () => {
      assert.equal(isCompanyProfileDocName(name), true);
    });
  }

  for (const name of NON_PROFILE_NAMES) {
    it(`predicate rejects: ${name}`, () => {
      assert.equal(isCompanyProfileDocName(name), false);
    });
  }
});

describe("differential: reconciler and generate route agree through the shared rule", () => {
  it("the reconciler's COMPANY_PROFILE bucket IS the shared regex (not a private copy)", () => {
    assert.match(RECONCILER, /import \{ COMPANY_PROFILE_DOC_NAME_RX \} from "\.\/document-type-normalizer"/);
    assert.match(RECONCILER, /\{ id: "COMPANY_PROFILE",\s+test: COMPANY_PROFILE_DOC_NAME_RX \}/);
    // The old space-only pattern must not come back alongside the shared one.
    assert.doesNotMatch(RECONCILER, /company\\s\+profile\|firm\\s\+profile/);
  });

  it("the generate route's COMPANY_PROFILE branch IS the shared predicate", () => {
    // The property is that the classifier comes from the shared module, not
    // that the import statement has one name in it. A layout-only companion
    // predicate now travels with it, and pinning the exact statement text made
    // adding one look like a regression of a rule it does not touch.
    assert.match(
      GENERATE_ROUTE,
      /import \{[^}]*\bisCompanyProfileDocName\b[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/engine\/document-type-normalizer"/,
    );
    assert.match(GENERATE_ROUTE, /if \(isCompanyProfileDocName\(docName\)\) return "COMPANY_PROFILE"/);
    assert.doesNotMatch(GENERATE_ROUTE, /if \(`?\/company profile\|capability statement\/`?\.test\(name\)\) return "COMPANY_PROFILE"/);
  });

  it("semanticCategory resolves every profile name shape to COMPANY_PROFILE (behaviour, not source)", () => {
    for (const name of PROFILE_NAMES) {
      assert.equal(
        semanticCategory(name),
        "COMPANY_PROFILE",
        `reconciler must classify "${name}" as COMPANY_PROFILE`,
      );
    }
  });

  it("semanticCategory does not widen: non-profile names stay in their own buckets", () => {
    for (const name of NON_PROFILE_NAMES) {
      assert.notEqual(
        semanticCategory(name),
        "COMPANY_PROFILE",
        `"${name}" must not become COMPANY_PROFILE`,
      );
    }
  });

  it("the shared regex is the predicate's own regex (no second pattern)", () => {
    assert.equal(isCompanyProfileDocName("Company-Profile.docx"), COMPANY_PROFILE_DOC_NAME_RX.test("Company-Profile.docx"));
  });
});
