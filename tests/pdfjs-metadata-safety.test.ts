import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";
import { extractClientName, cutAtNextFieldLabel } from "../lib/engine/tender-field-extractors";
import { isNonClientEntityLabel, nonClientEntityLabelPattern } from "../lib/engine/metadata-validators";

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

// ─── Fix A: Header fallback rejects non-client entity labels ────────────

test("Fix A: letterhead fallback rejects Implementing Partner label", () => {
  const text = `Implementing Partner: Global Health Agency\n\n${"scope requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.clientName, null, "Implementing Partner alone should not become clientName");
});

test("Fix A: letterhead fallback rejects Project Management Unit label", () => {
  const text = `Project Management Unit: Capital Works Authority\n\n${"scope requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.clientName, null, "Project Management Unit alone should not become clientName");
});

test("Fix A: letterhead fallback rejects Donor Agency label", () => {
  const text = `Donor Agency: African Development Bank\n\n${"scope requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.clientName, null, "Donor Agency alone should not become clientName");
});

test("Fix A: letterhead fallback rejects Employer label", () => {
  const text = `Employer: National Roads Authority\n\n${"scope requirement ".repeat(80)}`;
  const metadata = inferTenderMetadata(text, "rfp.pdf");
  assert.equal(metadata.clientName, null, "Employer alone should not become clientName");
});

// ─── Fix B: repair-metadata and upload extraction reject non-client labels ───

test("Fix B: extractClientName rejects Beneficiary as client", () => {
  const result = extractClientName({
    files: [
      { fileName: "test.pdf", extractedText: `Beneficiary: North Valley Farmers Union\n${"scope ".repeat(50)}` },
    ],
  });
  assert.equal(result.found, false, "Beneficiary alone should not extract as clientName");
});

test("Fix B: extractClientName rejects Employer as client", () => {
  const result = extractClientName({
    files: [
      { fileName: "test.pdf", extractedText: `Employer: Ministry of Labor\n${"scope ".repeat(50)}` },
    ],
  });
  assert.equal(result.found, false, "Employer alone should not extract as clientName");
});

test("Fix B: extractClientName rejects Donor Agency as client", () => {
  const result = extractClientName({
    files: [
      { fileName: "test.pdf", extractedText: `Donor Agency: World Bank\n${"scope ".repeat(50)}` },
    ],
  });
  assert.equal(result.found, false, "Donor Agency alone should not extract as clientName");
});

test("Fix B: extractClientName accepts explicit Procuring Entity", () => {
  const result = extractClientName({
    files: [
      { fileName: "test.pdf", extractedText: `Procuring Entity: Ministry of Health\n${"scope ".repeat(50)}` },
    ],
  });
  assert.equal(result.found, true);
  assert.equal(result.value, "Ministry of Health");
});

// ─── Fix C: Generic donor boundary cutting ───────────────────────────

test("Fix C: cutAtNextFieldLabel stops at generic 'Donor:'", () => {
  const raw = "Capital City Procurement Authority Donor: Green Fund Submission Deadline:";
  const cut = cutAtNextFieldLabel(raw);
  assert.equal(cut, "Capital City Procurement Authority");
});

test("Fix C: cutAtNextFieldLabel stops at 'Funder:'", () => {
  const raw = "Water Supply Authority Funder: USAID Email: contact@example.com";
  const cut = cutAtNextFieldLabel(raw);
  assert.equal(cut, "Water Supply Authority");
});

test("Fix C: cutAtNextFieldLabel stops at 'Funded By:'", () => {
  const raw = "Health Ministry Funded By: African Development Bank Contact: Jane";
  const cut = cutAtNextFieldLabel(raw);
  assert.equal(cut, "Health Ministry");
});

test("Fix C: cutAtNextFieldLabel stops at 'Implementing Partner:'", () => {
  const raw = "Roads Authority Implementing Partner: GHC PMU Project: Road Building";
  const cut = cutAtNextFieldLabel(raw);
  assert.equal(cut, "Roads Authority");
});

// ─── #793 salvage: additional non-client boundary labels ─────────────

test("boundary cut stops at 'Recipient:' (from #793)", () => {
  const raw = "National Health Ministry Recipient: District Clinics Deadline: 30 March";
  assert.equal(cutAtNextFieldLabel(raw), "National Health Ministry");
});

test("boundary cut stops at 'Grantee:' (from #793)", () => {
  const raw = "Water Authority Grantee: Rural Cooperative Email: a@b.com";
  assert.equal(cutAtNextFieldLabel(raw), "Water Authority");
});

test("boundary cut stops at 'Consultant:' (from #793)", () => {
  const raw = "City Procurement Office Consultant: ACME Advisors Reference: RFP-1";
  assert.equal(cutAtNextFieldLabel(raw), "City Procurement Office");
});

test("boundary cut stops at 'Financier:' (from #793)", () => {
  const raw = "Energy Authority Financier: Green Bank Country: Kenya";
  assert.equal(cutAtNextFieldLabel(raw), "Energy Authority");
});

test("Fix C: extractClientName correctly cuts flattened line at generic Donor", () => {
  const text = `Request for Proposals\nName of Procuring Entity: Capital City Procurement Authority Donor: Green Fund Submission Deadline: 30 March 2027 ${"scope ".repeat(60)}`;
  const result = extractClientName({
    files: [{ fileName: "test.pdf", extractedText: text }],
  });
  assert.equal(result.found, true);
  assert.equal(result.value, "Capital City Procurement Authority");
});

test("Fix C: extractClientName correctly cuts flattened line at Implementing Partner", () => {
  const text = `RFP for Services\nProcuring Entity: Water Supply Authority Implementing Partner: PMU Contact: Jane Smith ${"scope ".repeat(60)}`;
  const result = extractClientName({
    files: [{ fileName: "test.pdf", extractedText: text }],
  });
  assert.equal(result.found, true);
  assert.equal(result.value, "Water Supply Authority");
});

// ─── Helper function tests ─────────────────────────────────────────

test("isNonClientEntityLabel detects all non-client entity types", () => {
  assert.ok(isNonClientEntityLabel("beneficiary"));
  assert.ok(isNonClientEntityLabel("employer"));
  assert.ok(isNonClientEntityLabel("owner"));
  assert.ok(isNonClientEntityLabel("donor"));
  assert.ok(isNonClientEntityLabel("donor agency"));
  assert.ok(isNonClientEntityLabel("financing agency"));
  assert.ok(isNonClientEntityLabel("funded by"));
  assert.ok(isNonClientEntityLabel("financed by"));
  assert.ok(isNonClientEntityLabel("funder"));
  assert.ok(isNonClientEntityLabel("funding agency"));
  assert.ok(isNonClientEntityLabel("grant from"));
  assert.ok(isNonClientEntityLabel("loan from"));
  assert.ok(isNonClientEntityLabel("implementing agency"));
  assert.ok(isNonClientEntityLabel("implementing partner"));
  assert.ok(isNonClientEntityLabel("executing agency"));
  assert.ok(isNonClientEntityLabel("project management unit"));
});

test("nonClientEntityLabelPattern rejects headers starting with non-client labels", () => {
  const pattern = nonClientEntityLabelPattern();
  assert.ok(pattern.test("Beneficiary: North Valley Farmers"));
  assert.ok(pattern.test("Donor Agency: World Bank"));
  assert.ok(pattern.test("Implementing Partner: PMU Division"));
  assert.ok(pattern.test("Project Management Unit: Water PMU"));
  assert.ok(pattern.test("Funded By: AFD"));
});

test("nonClientEntityLabelPattern accepts headers starting with client labels", () => {
  const pattern = nonClientEntityLabelPattern();
  assert.ok(!pattern.test("Ministry of Health"));
  assert.ok(!pattern.test("Procuring Entity: Ministry"));
  assert.ok(!pattern.test("Federal Ministry of Water"));
});
