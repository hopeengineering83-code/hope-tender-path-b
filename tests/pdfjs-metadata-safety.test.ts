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

test("explicit donor implementing portal and email-subject labels are grounded while narrative mentions stay null", () => {
  const text = `[Page 1]\nRequest for Proposals for Water Works\nReference No: RFP-2026-102\nProcuring Entity: Ministry of Water Procurement Directorate\nDonor Agency: World Bank Group\nImplementing Agency: National Water PMU\nTender Portal: https://procurement.example.gov/tenders\nEmail Subject: RFP-2026-102 Technical Proposal\nBackground: This country has worked with UNDP and AfDB on prior unrelated projects. Consultant website: https://consultant.example.com\n${"technical requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.procuringEntityName, "Ministry of Water Procurement Directorate");
  assert.equal(metadata.donorAgency, "World Bank Group");
  assert.equal(metadata.implementingAgency, "National Water PMU");
  assert.equal(metadata.clientWebsite, "https://procurement.example.gov/tenders");
  assert.equal(metadata.submissionEmailSubject, "RFP-2026-102 Technical Proposal");
  assert.equal(metadata.contactDetailsSource?.donorAgency?.page, 1);
  assert.match(metadata.contactDetailsSource?.submissionEmailSubject?.quote ?? "", /Email Subject/i);
});

test("unlabelled donor names and first URLs are not persisted as tender metadata", () => {
  const text = `[Page 2]\nRequest for Proposals for Advisory Services\nReference No: RFP-2026-103\nProcuring Entity: Roads Procurement Authority\nBackground narrative mentions World Bank, UNDP, and AfDB from earlier assignments. See consultant profile at https://consultant.example.com and archived project at https://archive.example.org.\nSubmit proposals by email.\n${"scope requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.procuringEntityName, "Roads Procurement Authority");
  assert.equal(metadata.donorAgency, null);
  assert.equal(metadata.clientWebsite, null);
  assert.equal(metadata.submissionEmailSubject, null);
});
