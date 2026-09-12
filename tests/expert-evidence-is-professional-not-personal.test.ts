// A proposal quotes an expert's capability, never their identity documents.
//
// WHY THIS FILE EXISTS
// --------------------
// expertProofLine hands the writer the text extracted from an expert's CV, and
// the writer copies it into the team table. The standard consultancy CV opens
// with a personnel form whose labels and values run together:
//
//   1. PERSONNEL INFORMATION Proposed Position Architect Name of Firm Hope
//   Urban Planning … Name of Expert Habib Ahmed Date of Birth 1997 G.C.
//   (Approx) Nationality Ethiopian Education B.Sc. in Architecture
//
// so a real client-facing Technical Proposal stated an employee's date of birth
// and nationality. Measured on the live Pharo run: "Date of Birth" and
// "1997 G.C." each appeared in the generated DOCX and the finalized PDF.
//
// The same line was cut by a raw `.slice(0, 600)`, so the document also shipped
// "… HOPE URBAN PLANNING ARCHI" and "… Engineering Consultan". A proposal that
// stops mid-word reads as broken, and no prompt quality can repair it because
// the damage happens before the writer sees the text.
//
// Both directions are asserted: personal fields must go, and the professional
// evidence beside them — position, firm, education, registration — must stay,
// because deleting that would make a worse proposal rather than a safer one.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  expertProofLine,
  truncateAtWordBoundary,
  withoutPersonalCvFields,
} from "../lib/engine/proposal-intelligence";

// The real extracted shape, verbatim from the Pharo run.
const REAL_CV_PROFILE =
  "HABIB AHMED ARCHITECT (B.SC.) HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC "
  + "1. PERSONNEL INFORMATION Proposed Position Architect Name of Firm Hope Urban Planning Architectural "
  + "and Engineering Consultancy PLC Name of Expert Habib Ahmed Date of Birth 1997 G.C. (Approx) "
  + "Nationality Ethiopian Education B.Sc. in Architecture Registered Architect Professional Reg. Licensed";

describe("personal data never leaves the company inside a proposal", () => {
  it("removes the personal fields of a real CV personnel form", () => {
    const redacted = withoutPersonalCvFields(REAL_CV_PROFILE);
    for (const field of ["Date of Birth", "1997 G.C.", "Nationality", "Ethiopian"]) {
      assert.equal(redacted.includes(field), false, `"${field}" survived redaction: ${redacted}`);
    }
  });

  it("keeps the professional fields an evaluator is meant to read", () => {
    const redacted = withoutPersonalCvFields(REAL_CV_PROFILE);
    assert.match(redacted, /Proposed Position Architect/);
    assert.match(redacted, /Name of Firm Hope Urban Planning/);
    assert.match(redacted, /Education B\.Sc\. in Architecture/);
    assert.match(redacted, /Registered Architect/);
  });

  it("removes by form field, so the professional field after a personal one survives", () => {
    const redacted = withoutPersonalCvFields("Name of Expert A B Date of Birth 1980 Nationality X Education B.Sc.");
    assert.equal(redacted.includes("1980"), false);
    assert.match(redacted, /Education B\.Sc\./, "the field after the personal run must not be swallowed");
  });

  it("covers the other identity categories, not only the two that leaked", () => {
    const redacted = withoutPersonalCvFields(
      "Name of Expert A B Passport Number AB123456 Marital Status Single Mobile +251900000000 Education B.Sc.",
    );
    for (const value of ["AB123456", "Single", "+251900000000"]) {
      assert.equal(redacted.includes(value), false, `${value} survived`);
    }
    assert.match(redacted, /Education B\.Sc\./);
  });

  it("carries the redaction into the writer context the proposal is built from", () => {
    const line = expertProofLine({
      fullName: "Habib Ahmed",
      title: "Architect",
      disciplines: JSON.stringify(["Architecture"]),
      sectors: JSON.stringify(["Healthcare"]),
      certifications: JSON.stringify(["Licensed Architect (Ethiopia)"]),
      yearsExperience: 4,
      profile: REAL_CV_PROFILE,
    } as never);
    assert.equal(line.includes("Date of Birth"), false, line);
    assert.equal(line.includes("Nationality"), false, line);
    assert.match(line, /Habib Ahmed/);
    assert.match(line, /Licensed Architect \(Ethiopia\)/);
  });
});

describe("evidence text is cut at a word boundary", () => {
  it("never ends mid-word", () => {
    const cut = truncateAtWordBoundary("HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING", 24);
    assert.equal(cut, "HOPE URBAN PLANNING…");
    assert.equal(/[A-Za-z]$/.test(cut), false);
  });

  it("leaves text within budget untouched", () => {
    assert.equal(truncateAtWordBoundary("short enough", 40), "short enough");
  });

  it("still cuts a single token longer than the whole budget", () => {
    assert.equal(truncateAtWordBoundary("Supercalifragilisticexpialidocious", 10), "Supercalif…");
  });

  it("does not leave dangling punctuation at the cut", () => {
    assert.equal(truncateAtWordBoundary("Design, supervision, and handover services", 20), "Design, supervision…");
  });
});
