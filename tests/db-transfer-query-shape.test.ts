import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tenderPage = fs.readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
const tenderApi = fs.readFileSync("app/api/tenders/[id]/route.ts", "utf8");
const tenderListApi = fs.readFileSync("app/api/tenders/route.ts", "utf8");
const analysisPanel = fs.readFileSync("components/analysis-quality-panel.tsx", "utf8");
const extractionPanel = fs.readFileSync("components/extraction-quality-panel.tsx", "utf8");
const extractionQualityApi = fs.readFileSync("app/api/tenders/[id]/extraction-quality/route.ts", "utf8");

const companyDocumentsApi = fs.readFileSync("app/api/company/documents/route.ts", "utf8");
const companyDashboardPage = fs.readFileSync("app/dashboard/company/page.tsx", "utf8");

describe("DB transfer query shape — dashboard metadata views", () => {
  it("tender detail page uses extracted-text metrics instead of selecting full extractedText", () => {
    assert.ok(!/select:\s*\{[^}]*extractedText:\s*true[^}]*\}/s.test(tenderPage));
    assert.match(tenderPage, /char_length\("extractedText"\)/);
    assert.match(tenderPage, /extractedTextLength/);
  });

  it("tender GET/PUT API responses do not select extractedText or generated fileContent for dashboard payloads", () => {
    // The DELETE handler legitimately selects fileContent — it must read the
    // rows before the transaction deletes them so it can clean up blob
    // storage afterwards. That select never reaches a dashboard payload, so
    // the negative pins apply to the GET/PUT (dashboard) portion only.
    const dashboardPortion = tenderApi.split("export async function DELETE")[0];
    assert.ok(!/extractedText:\s*true/.test(dashboardPortion));
    assert.ok(!/fileContent:\s*true/.test(dashboardPortion));
    assert.match(tenderApi, /generatedDocumentDashboardSelect/);
    assert.match(tenderApi, /extractedTextLength/);
  });

  it("tender list/create API omits extractedText from file metadata", () => {
    assert.ok(!/extractedText:\s*true/.test(tenderListApi));
    assert.ok(!/fileContent:\s*true/.test(tenderListApi));
  });

  it("analysis quality panel computes text length in SQL instead of pulling full tender text", () => {
    assert.ok(!/files:\s*\{\s*select:\s*\{\s*extractedText:\s*true/s.test(analysisPanel));
    assert.match(analysisPanel, /SUM\(char_length\("extractedText"\)\)/);
  });

  it("extraction quality panel samples extracted text without selecting full dashboard text or fileContent", () => {
    assert.ok(!/extractedText:\s*true/.test(extractionPanel));
    assert.ok(!/fileContent:\s*true/.test(extractionPanel));
    assert.match(extractionPanel, /LEFT\(COALESCE\("extractedText", ''\), 6000\)/);
    assert.match(extractionPanel, /char_length\("extractedText"\)/);
  });

  it("extraction-quality API samples extracted text without selecting full text or fileContent", () => {
    assert.ok(!/extractedText:\s*true/.test(extractionQualityApi));
    assert.ok(!/fileContent:\s*true/.test(extractionQualityApi));
    assert.match(extractionQualityApi, /LEFT\(COALESCE\("extractedText", ''\), 6000\)/);
    assert.match(extractionQualityApi, /char_length\("extractedText"\)/);
  });

  it("company document list views do not select or render full extractedText", () => {
    assert.ok(!/extractedText:\s*true/.test(companyDocumentsApi));
    assert.ok(!/doc\.extractedText(?!Length)/.test(companyDashboardPage));
    assert.match(companyDocumentsApi, /aiExtractionStatus:\s*true/);
  });

});
