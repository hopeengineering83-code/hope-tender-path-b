import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";

test("top-level pdfjs-dist stays aligned with pdf-parse worker dependency", () => {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const direct = lock.packages?.["node_modules/pdfjs-dist"]?.version;
  const transitive = lock.packages?.["node_modules/pdf-parse/node_modules/pdfjs-dist"]?.version;
  assert.equal(direct, "5.4.296");
  assert.equal(transitive, "5.4.296");
});

test("distinct beneficiary/employer/donor labels do not become client without explicit procuring entity", () => {
  const text = `Request for Proposals for Water Works\nReference No: RFP-2026-100\nBeneficiary: North Valley Farmers Union\nEmployer: Rural Works Owner Unit\nDonor Agency: World Bank\nImplementing Agency: Project Management Unit\nSubmission Deadline: 30 March 2027\n${"scope requirements ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.clientName, null);
});


test("explicit procuring entity label remains accepted on flattened one-line text", () => {
  const text = `Request for Proposals for Urban Planning Reference No: RFP-2026-101 Name of Procuring Entity: Capital City Procurement Authority Beneficiary: City Residents Donor Agency: Green Fund Submission Deadline: 30 March 2027 ${"technical requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.clientName, "Capital City Procurement Authority");
});
