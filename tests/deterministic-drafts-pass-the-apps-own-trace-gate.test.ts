/**
 * The app's own deterministic writers must not write what its own gates refuse.
 *
 * 2026-09-29, Preview, a new (architectural design) tender: AI Analyze, Run
 * Engine and Proposal Generation all succeeded, and auto-finalize then stopped
 * on "Technical Approach and Methodology.docx": "[AI_TRACE] AI-trace language
 * detected — internal review" plus an AUTHORITY "needs manual attention"
 * refusal. The document was not model-written. The planned-file methodology
 * draft says a deliverable is complete only when "its internal review is
 * closed", and AI_TRACE_PATTERNS (detection-patterns.ts) treats
 * "internal review" as bid-team working language. The Technical Proposal's
 * deterministic Section C fallback said "three-gate internal review cycle" and
 * "internal review at each gate" for the same reason.
 *
 * The detector is left as it is (it also guards against real bid-team notes
 * reaching the client); the writers say "quality review" / "peer review".
 * These tests pin the property, not the wording: whatever the deterministic
 * drafts say, the trace gate must pass them.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { AI_TRACE_PATTERNS } from "../lib/engine/detection-patterns";
import { __testing__ } from "../lib/engine/missing-plan-file-generation";

const { narrativeDraftContent, methodologyNarrativeContent, documentTypeFor } = __testing__;

async function docxVisibleText(base64: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(base64, "base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function traceHits(text: string): string[] {
  return AI_TRACE_PATTERNS.flatMap((re) => {
    const m = text.match(new RegExp(re.source, re.flags));
    return m ? [m[0]] : [];
  });
}

const REQUIREMENTS = [
  { title: "Technical Approach and Methodology", description: "Describe the approach to the architectural design, floor plan and 3D modelling of the office space." },
  { title: "Company Profile and Qualifications", description: "Provide the firm's profile, registration and relevant experience." },
  { title: "Project Team Qualifications", description: "CVs of the proposed architect and design team." },
];

describe("deterministic planned-file drafts pass the app's own AI-trace gate", () => {
  for (const fileName of [
    "Technical Approach and Methodology.docx",
    "Work Plan.docx",
    "Company Profile and Qualifications.docx",
    "Technical Proposal.docx",
    "Cover Letter.docx",
  ]) {
    it(`${fileName} carries no AI-trace phrase`, async () => {
      const type = documentTypeFor(fileName, "");
      const content = /methodology|work plan/i.test(fileName)
        ? await methodologyNarrativeContent("Office Fit-out Design Services", fileName, REQUIREMENTS, { experts: ["A. Architect — Lead Architect"], projects: ["Regional Office Building"] })
        : await narrativeDraftContent("Office Fit-out Design Services", fileName, type, REQUIREMENTS, { experts: ["A. Architect — Lead Architect"], projects: ["Regional Office Building"] }, { clientName: "Sample Agency", companyName: "Sample Consultants PLC", reference: "RFP-001" });
      const text = await docxVisibleText(content);
      assert.deepEqual(traceHits(text), [], `${fileName} would be refused by the gate that reads it`);
    });
  }
});

describe("deterministic proposal-section fallback prose carries no AI-trace phrase", () => {
  it("no string the Section C fallback writes matches AI_TRACE_PATTERNS", () => {
    const source = readFileSync("lib/engine/proposal-sections.ts", "utf8");
    // Only emitted text: template/string literals on non-comment lines.
    const emitted = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .flatMap((line) => line.match(/`[^`]*`|"[^"\n]*"/g) ?? [])
      .join("\n");
    const hits = traceHits(emitted).filter((hit) => /internal|bid[-\s]team/i.test(hit));
    assert.deepEqual(hits, []);
  });
});
