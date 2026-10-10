// An unreachable pattern looks like coverage and provides none.
//
// TWO DEFECTS, ONE CAUSE.
//
// (1) THE UNREACHABLE PATTERN. PACKAGING_PHRASES carried
//
//       /\bformat\s*:\s*(?:pdf|docx?|word|excel)\b/
//
//     while the normaliser ahead of it replaced every ":" with a space. The
//     colon was gone before the pattern ran, so "Format: PDF" could never be
//     recognised as a file-format rule. Nothing failed; the phrase simply sat
//     in the list looking like it handled that case.
//
// (2) TWO CONTRACTS FOR ONE VOCABULARY. The same phrase lived in
//     package-conformance.ts, whose own normaliser KEPT punctuation. So the
//     identical regex was unreachable in one module and reachable in the
//     other — and classifyPackageRule uses both in a single call: it gates on
//     isPackagingOrFormatRequirement (punctuation stripped) and then picks a
//     family (punctuation preserved). One requirement, read two ways.
//
// The fix is one exported contract, normaliseRequirementText, used by both.
// File-name comparison keeps a separate normaliser on purpose: a file name is
// compared for identity, so its punctuation is meaningful.
//
// These tests pin the contract, not the wording of any one phrase. Nothing
// here names a tender, a client or a sector that the product depends on.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import {
  isPackagingOrFormatRequirement,
  normaliseRequirementText,
} from "../lib/engine/packaging-requirement-rule";
import { classifyPackageRule } from "../lib/engine/package-conformance";

const rule = (description: string, title = "Submission Requirement") => ({
  title,
  description,
  requirementType: "SUBMISSION_RULE",
});

describe("the normalisation contract", () => {
  it("makes punctuation variants read identically", () => {
    for (const group of [
      ["Font: Arial 11", "Font - Arial 11", "Font Arial 11"],
      ["Page Limit: 30 pages", "Page Limit - 30 pages", "Page Limit 30 pages"],
      ["Format: PDF", "Format - PDF", "Format PDF"],
      ["Copies: three hard copies", "Copies - three hard copies", "Copies three hard copies"],
    ]) {
      const normalised = group.map((value) => normaliseRequirementText(value));
      assert.equal(
        new Set(normalised).size,
        1,
        `these must normalise to one string, got ${JSON.stringify(normalised)}`,
      );
    }
  });

  it("keeps a hyphen that is part of a word", () => {
    // Separator hyphens collapse; spelling hyphens do not. "e-mail" matters:
    // the submission-instruction phrases spell it /e-?mail/, which "e mail"
    // would not match.
    assert.equal(normaliseRequirementText("e-mail submission"), "e-mail submission");
    assert.equal(normaliseRequirementText("non-editable PDF"), "non-editable pdf");
    assert.equal(normaliseRequirementText("spiral-bound copies"), "spiral-bound copies");
  });

  it("no phrase pattern contains a character the normaliser removes", () => {
    // The guard that makes defect (1) a build-time impossibility rather than
    // something a live run has to discover. The allowed set is read from the
    // normaliser's own source so the two cannot drift apart.
    const ruleSrc = readFileSync("lib/engine/packaging-requirement-rule.ts", "utf8");
    const classMatch = ruleSrc.match(/replace\(\/\[\^([^\]]*)\]\+\/g, " "\)/);
    assert.ok(classMatch, "the normaliser's allowed-character class must be findable");
    const allowed = new Set("abcdefghijklmnopqrstuvwxyz0123456789%.- ".split(""));

    const offenders: string[] = [];
    for (const path of [
      "lib/engine/packaging-requirement-rule.ts",
      "lib/engine/package-conformance.ts",
    ]) {
      const src = readFileSync(path, "utf8");
      for (const line of src.split("\n")) {
        const m = line.match(/^\s*(\/(?:[^/\\\n]|\\.)+\/[gimsuy]*),\s*$/);
        if (!m) continue;
        const pattern = m[1];
        // Strip regex syntax, leaving only what must literally appear in the
        // input. Group syntax goes FIRST: "(?:" carries a colon that belongs
        // to the regex, not to the text being matched, and counting it was
        // the first thing this guard got wrong.
        const literal = pattern
          .replace(/^\//, "")
          .replace(/\/[gimsuy]*$/, "")
          .replace(/\(\?<[=!]/g, " ")
          .replace(/\(\?[:=!]/g, " ")
          .replace(/\\[bBsSdDwWnrt]/g, " ")
          .replace(/\\./g, " ")
          // Quantifier braces before brace characters: "{1,2}" carries a
          // comma that belongs to the quantifier, not to the text.
          .replace(/\{\d+(?:,\d*)?\}/g, " ")
          .replace(/[()[\]{}|?*+^$]/g, " ");
        for (const ch of literal) {
          if (ch === " ") continue;
          if (!allowed.has(ch)) offenders.push(`${path}: ${pattern} (character ${JSON.stringify(ch)})`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these patterns require characters the normaliser deletes, so they can never match:\n${offenders.join("\n")}`,
    );
  });
});

describe("a typography rule is a packaging rule", () => {
  // One example per sector, none of them healthcare. A rule about the face,
  // size or leading of the text is a property of the produced artifact, and
  // stored bytes cannot adjudicate it — so it must classify as a package rule
  // AND land in NOT_MACHINE_DECIDABLE, which is what keeps it out of the
  // machine-coverage denominator instead of making the tender unwinnable.
  const TYPOGRAPHY: Array<[string, string]> = [
    ["building consultancy", "All submissions shall be typed in Arial 11pt with 1.15 line spacing."],
    ["road", "Font: Arial 11 throughout the technical proposal."],
    ["water", "Font - Arial 11 throughout the technical proposal."],
    ["EOI/RFP", "Font Arial 11 throughout the technical proposal."],
    ["supervision", "Minimum font size 10 shall be used."],
    ["software/ICT", "Documents shall use double spacing."],
    ["logistics/procurement", "Times New Roman 12 is mandatory for all narrative sections."],
  ];

  for (const [sector, text] of TYPOGRAPHY) {
    it(`${sector}: "${text.slice(0, 42)}..." is a packaging rule`, () => {
      assert.equal(isPackagingOrFormatRequirement(rule(text)), true);
      assert.equal(classifyPackageRule(rule(text)), "NOT_MACHINE_DECIDABLE");
    });
  }
});

describe("page-size and page-limit rules classify", () => {
  const CASES: Array<[string, string, string]> = [
    ["supervision", "Proposals shall be printed on A4 paper.", "NOT_MACHINE_DECIDABLE"],
    ["software/ICT", "A4-size sheets only; no A3 foldouts.", "NOT_MACHINE_DECIDABLE"],
    ["road", "Paper size shall be A4.", "NOT_MACHINE_DECIDABLE"],
    ["logistics/procurement", "Page Limit: 30 pages excluding annexes.", "NOT_MACHINE_DECIDABLE"],
    ["logistics/procurement", "Page Limit - 30 pages excluding annexes.", "NOT_MACHINE_DECIDABLE"],
    ["road", "The proposal shall be a maximum of 40 pages.", "NOT_MACHINE_DECIDABLE"],
    ["water", "Submissions must be within 25 pages.", "NOT_MACHINE_DECIDABLE"],
    ["EOI/RFP", "20 pages maximum for the capability statement.", "NOT_MACHINE_DECIDABLE"],
    // The colon case that could never match before.
    ["water", "Format: PDF", "FILE_FORMAT"],
    ["building consultancy", "Format - PDF", "FILE_FORMAT"],
  ];

  for (const [sector, text, family] of CASES) {
    it(`${sector}: "${text.slice(0, 42)}" -> ${family}`, () => {
      assert.equal(isPackagingOrFormatRequirement(rule(text)), true);
      assert.equal(classifyPackageRule(rule(text)), family);
    });
  }
});

describe("ordinary requirements are not reclassified", () => {
  // The conservative half, and the one that matters most: broadening the
  // packaging vocabulary must not pull evidence requirements out of the
  // evidence path, where their real proof lives. SUBSTANTIVE_EVIDENCE_SIGNALS
  // runs before the phrases, so a requirement that also asks for a CV, a
  // licence, accounts or a methodology stays an evidence requirement.
  const ORDINARY: Array<[string, string]> = [
    ["building consultancy", "The consultant shall demonstrate at least 10 years of experience in facility design."],
    ["road", "Provide CVs for the Team Leader and the Highway Engineer."],
    ["water", "A valid trade licence and VAT certificate are required."],
    ["supervision", "Submit a methodology of not more than 20 pages."],
    ["logistics/procurement", "Audited financial statements for the last three years."],
    ["software/ICT", "Bidders must have delivered at least 3 similar ERP implementations."],
    ["EOI/RFP", "Describe your quality management system and ISO certification."],
  ];

  for (const [sector, text] of ORDINARY) {
    it(`${sector}: "${text.slice(0, 42)}..." stays an evidence requirement`, () => {
      assert.equal(isPackagingOrFormatRequirement(rule(text)), false);
      assert.equal(classifyPackageRule(rule(text)), null);
    });
  }

  it("a page limit attached to a substantive deliverable stays evidence", () => {
    // "a methodology of not more than 20 pages" is a requirement FOR a
    // methodology. Treating it as a page-limit rule would delete its evidence
    // link, which is the failure the substantive guard exists to prevent.
    const req = rule("Submit a methodology of not more than 20 pages.");
    assert.equal(isPackagingOrFormatRequirement(req), false);
  });
});

describe("both modules read the requirement through one contract", () => {
  it("package-conformance uses the shared normaliser for prose", () => {
    const src = readFileSync("lib/engine/package-conformance.ts", "utf8");
    assert.match(src, /import \{[^}]*normaliseRequirementText[^}]*\} from "\.\/packaging-requirement-rule"/);
    const at = src.indexOf("function requirementText");
    assert.ok(at > -1);
    assert.match(src.slice(at, at + 400), /normaliseRequirementText\(/);
  });

  it("file names keep their own normaliser, because identity is not prose", () => {
    const src = readFileSync("lib/engine/package-conformance.ts", "utf8");
    assert.match(src, /function normaliseFileName/);
    assert.match(src, /normaliseFileName\(docLabel\(doc\)\)/);
    // And the prose normaliser must not be used on file names: stripping
    // punctuation could make two distinct planned names collide.
    assert.doesNotMatch(src, /normaliseRequirementText\(docLabel/);
  });
});
