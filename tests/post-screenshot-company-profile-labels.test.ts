import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const editor = readFileSync("app/dashboard/company/profile/page.tsx", "utf8");
const subnav = readFileSync("components/company-subnav.tsx", "utf8");

describe("screenshot-driven company profile field labels", () => {
  it("provides a dedicated labeled editor from the Company Vault navigation", () => {
    assert.match(subnav, /href: "\/dashboard\/company\/profile"/);
    assert.match(subnav, /Labeled Profile Editor/);
    // The "Company workspace" aria-label is passed through to the shared
    // SectionSubnav component, which renders it as aria-label={label}.
    assert.match(subnav, /label="Company workspace"/);
  });

  it("keeps visible labels for company identity and contact values", () => {
    for (const label of [
      "Company name *",
      "Legal registered name",
      "Contact email",
      "Phone number",
      "Website URL",
      "Registered address",
      "Knowledge mode",
    ]) {
      assert.ok(editor.includes(label), `missing visible label: ${label}`);
    }
  });

  it("keeps visible labels for proposal and institutional values", () => {
    for (const label of [
      "Company description",
      "Reviewed profile summary",
      "Service lines",
      "Sectors",
      "Authorising representative name",
      "Authorising representative title",
      "Representative license or registration",
      "Company license grade or category",
      "Business registration number",
      "Tax Identification Number (TIN)",
      "VAT registration number",
      "Founding year",
      "Permanent staff headcount",
    ]) {
      assert.ok(editor.includes(label), `missing visible label: ${label}`);
    }
  });

  it("associates labels, help text, errors, and success with accessible semantics", () => {
    assert.match(editor, /<label htmlFor=\{id\}/);
    assert.match(editor, /aria-describedby="profile-summary-help"/);
    assert.match(editor, /role="alert" aria-live="assertive"/);
    assert.match(editor, /role="status" aria-live="polite"/);
    assert.match(editor, /aria-busy=\{saving\}/);
  });

  it("validates numeric institutional facts before sending the update", () => {
    assert.match(editor, /Founding year must be a valid four-digit year/);
    assert.match(editor, /Permanent staff headcount must be zero or a positive whole number/);
    assert.match(editor, /Number\.isInteger\(foundingYear\)/);
    assert.match(editor, /Number\.isInteger\(headcount\)/);
  });
});
