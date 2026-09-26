/**
 * A tender that requires two documents must not receive the same one twice.
 *
 * Found by driving the real pipeline to a real ZIP. The archive contained
 * 02-Company-Profile.docx and 03-Capability-Statement.docx, both named by the
 * confirmed Build Plan as separate required deliverables — and their visible
 * text was byte-for-byte identical apart from the filename each echoed inside
 * itself. An evaluator opening the Capability Statement found the Company
 * Profile.
 *
 * The cause is one rule doing two jobs. "Capability Statement" is deliberately
 * an alias of "Company Profile" for CLASSIFICATION, and that is right: both are
 * written by the firm from its own evidence rather than being forms the client
 * issues. The section layout then keyed off classification alone, so the alias
 * that correctly answered "who writes this" also silently answered "what goes
 * in it".
 *
 * The classification rule must NOT be split to fix this — two separately
 * written copies of it disagreeing about which files are company-written is the
 * defect the normalizer's own note documents. Only the layout narrows.
 *
 * Names below are the ordinary forms tenders mandate; nothing is keyed to a
 * benchmark.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  isCapabilityStatementDocName,
  isCompanyProfileDocName,
} from "../lib/engine/document-type-normalizer";

describe("company profile and capability statement", () => {
  it("both remain company-written documents", () => {
    // Classification is unchanged: neither becomes a client-issued placeholder.
    for (const name of [
      "02-Company-Profile.docx",
      "03-Capability-Statement.docx",
      "Firm Profile.docx",
      "Organisational_Profile.docx",
      "About Us.docx",
    ]) {
      assert.equal(isCompanyProfileDocName(name), true, `${name} must stay company-written`);
    }
  });

  it("tells the two apart", () => {
    assert.equal(isCapabilityStatementDocName("03-Capability-Statement.docx"), true);
    assert.equal(isCapabilityStatementDocName("Capability_Statement.docx"), true);
    assert.equal(isCapabilityStatementDocName("capability statement.docx"), true);

    assert.equal(isCapabilityStatementDocName("02-Company-Profile.docx"), false);
    assert.equal(isCapabilityStatementDocName("Firm Profile.docx"), false);
    assert.equal(isCapabilityStatementDocName("About Us.docx"), false);
    // A word ending in "capability" is not the document.
    assert.equal(isCapabilityStatementDocName("Incapability.docx"), false);
  });

  it("gives each its own section layout", () => {
    const route = require("node:fs").readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const code = route
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

    const branch = code.slice(code.indexOf('kind === "COMPANY_PROFILE"'));
    const body = branch.slice(0, branch.indexOf('kind === "SECTOR_TECHNICAL_SCOPE"'));

    assert.match(body, /isCapabilityStatementDocName\(docName\)/);
    assert.match(body, /Demonstrated Capability/);
    assert.match(body, /Company Profile and Capability Statement — Tender Alignment/);
  });

  it("claims no evidence it does not have", () => {
    // The empty-evidence line must not assert that material is attached
    // elsewhere. Several sibling layouts do say "attached separately"; writing
    // that into a submitted document when nothing was linked is a fabricated
    // statement, which is the one thing this application must never produce.
    // Comments are stripped: the note explaining this rule names the very
    // phrase it forbids, and would otherwise be the thing that fails the test.
    const route = require("node:fs")
      .readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const branch = route.slice(route.indexOf('isCapabilityStatementDocName(docName)'));
    const body = branch.slice(0, branch.indexOf("Requirements This Capability Addresses"));
    assert.doesNotMatch(body, /attached separately/i);
    assert.match(body, /No source-verified expert or project evidence has been linked/);
  });
});
