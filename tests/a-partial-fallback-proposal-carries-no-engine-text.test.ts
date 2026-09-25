// A proposal whose sections are partly model-written and partly deterministic
// carries nothing of the engine that wrote it, and states no credential the
// firm's record does not hold.
//
// Preview run 36049851073 (2026-09-24) was the first to keep a model-written
// section beside deterministic ones: Section A came from a model, the other
// three from buildSectionFallback. It passed every gate at quality 95 and
// delivered:
//   - 22 pages of the writer's own contract, criterion graph and evidence
//     scores ("EXPERT-1 EXPERT TRANSFERABLE ... WEAKPROOFSIGNAL", "Block final
//     export until ..."), because the stripper only ever removed them by
//     accident of which top-level heading they sat under;
//   - "C.3.1 PROPOSAL INTELLIGENCE CONTRACT — obey before drafting:" as a
//     methodology heading, because the fallback read the contract block the
//     model's input carries as tender requirements;
//   - "Pharo Ventures requires Pharo Ventures", because the client-name
//     enforcer took the tender title in "Subject: Technical Proposal — <title>"
//     for a substituted client and replaced it everywhere;
//   - "founded in 2012", "a Grade A licence" and "ISO 45001 / ISO 14001" from
//     the model, against a record of 2019, Grade I and no such certificate.
// The fixtures are generic; nothing here is tied to that tender.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { appendEvaluatorResponseMatrix } from "../lib/engine/proposal-evaluator-matrix";
import { stripInternalReviewSections } from "../lib/engine/internal-review-stripper";
import { enforceClientName } from "../lib/engine/client-name-enforcer";
import { buildSectionFallback, comparableProjectAnchor } from "../lib/engine/proposal-sections";
import { stripAIWriterContractPromptBlock } from "../lib/engine/ai-writer-contract-prompt";
import { scrubUngroundedCompanyCredentials, ungroundedCredential } from "../lib/engine/company-credential-grounding";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";
import type { AIBidWriterInput } from "../lib/ai";
import type { ProposalSectionSpec } from "../lib/engine/proposal-sections";

const MATRIX_INPUT = {
  tenderTitle: "Design of a District Clinic",
  clientName: "County Health Office",
  requirements: ["MANDATORY: Valid business licence", "SCORED: Methodology and work plan", "SCORED: Key experts CVs"],
  expertLines: ["A. Person — Architect | Disciplines: Architecture"],
  projectLines: ["Clinic A | Kenya | Healthcare | USD 1.2M"],
  companyEvidenceLines: ["Business licence BL-1"],
  projectEvidenceLines: [],
  complianceLines: ["Submit by email"],
  differentiators: ["In-house laboratory"],
};

describe("the writer's working appendix never reaches the client", () => {
  it("is stripped by name even under a client top-level section", () => {
    const md = appendEvaluatorResponseMatrix("# Declaration\n\nWe declare.", MATRIX_INPUT);
    const out = stripInternalReviewSections(md).markdown;
    for (const heading of ["Proposal Intelligence Contract", "Source-Grounded Requirement Map", "Evidence Graph Selection Model", "Contract Export Gates", "Tender Form Strategy", "Tender Criterion Graph", "Tender Response Blueprint", "Tender Criteria Response Matrix", "Multi-Angle Proposal Quality Check", "Evidence Gaps and Anti-Hallucination Controls", "Win Themes and Differentiators"]) {
      assert.doesNotMatch(out, new RegExp(`^#+\\s+${heading}`, "m"), heading);
    }
    assert.doesNotMatch(out, /WEAKPROOFSIGNAL|NEVER invent facts|Block final export/i);
    assert.match(out, /^# Declaration/m);
    assert.match(out, /Section E: Compliance Matrix/, "client sections the matrix builds are kept");
  });

  it("is stripped after a later pass renumbers or restyles its headings", () => {
    // Run 36055406065: the evidence graph reached the client under a
    // renumbered heading the "## Name" patterns did not match.
    const md = [
      "# Section D: Additional Information",
      "## D.6 Evidence Graph Selection Model",
      "| EXPERT-1 | EXPERT | TRANSFERABLE | WEAK_PROOF_SIGNAL |",
      "### **Tender Form Strategy**",
      "Primary tender form: TECHNICAL_PROPOSAL.",
      "## 7. Proposal Intelligence Contract",
      "Contract: PIC-3.",
      "## D.7 Value to the Client",
      "Client text.",
    ].join("\n");
    const out = stripInternalReviewSections(md).markdown;
    assert.doesNotMatch(out, /WEAK_PROOF_SIGNAL|TECHNICAL_PROPOSAL|PIC-3|Evidence Graph|Tender Form Strategy/);
    assert.match(out, /## D\.7 Value to the Client\nClient text\./);
  });

  it("the final gate refuses engine text wherever it survives", () => {
    const base = "# Technical Proposal\n\nProposal for the district clinic.\n\n".repeat(20);
    for (const leak of ["EXPERT-1 EXPERT TRANSFERABLE 60% WEAKPROOFSIGNAL", "Evidence graph: directProjects=1; transferableProjects=2", "C.3.1 PROPOSAL INTELLIGENCE CONTRACT — obey before drafting:", "Block final export until this mandatory requirement is traced."]) {
      const result = assessGeneratedDocumentQuality({
        doc: { id: "x", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF" },
        visibleText: `${base}${leak}\n`,
      });
      const issue = result.issues.find((i) => i.code === "INTERNAL_TRACEABILITY");
      assert.ok(issue, leak);
      assert.equal(issue.severity, "HIGH");
    }
  });

  it("the last sweep before render removes every line, row and heading the gate would refuse", async () => {
    // Run 36066042996: every section passed its own guard, and the finalizer
    // still refused the rendered PDF for "WEAKPROOFSIGNAL" and for the
    // header of the owner's own company-profile upload. The sweep uses the
    // gate's own pattern list, so whatever builder emits such a line, it
    // never reaches the document.
    const { stripInternalDiagnosticContent } = await import("../lib/engine/internal-review-stripper");
    const client = "Proposal for the district clinic, delivered by a registered design team.";
    const md = [
      "# Technical Proposal",
      client,
      "## Tender Proposal AI-Ready Summary",
      "Prepared for AI-assisted tender proposal generation",
      "| Project | Class | Risks |",
      "|---|---|---|",
      "| PROJECT-2 | TRANSFERABLE | WEAK_PROOF_SIGNAL |",
      "| Riverside Clinic | Health | None |",
      "- Criterion TCG-4 mapped to SRC-REQ-12.",
      "Evidence graph: directProjects=1; transferableProjects=2.",
      "The design review runs weekly.",
    ].join("\n");
    const out = stripInternalDiagnosticContent(md).markdown;
    assert.doesNotMatch(out, /WEAK_PROOF_SIGNAL|AI-Ready|AI-assisted|TCG-4|directProjects/);
    assert.match(out, /\| Project \| Class \| Risks \|\n\|---\|---\|---\|\n\| Riverside Clinic \| Health \| None \|/);
    assert.match(out, /The design review runs weekly\./);
    const base = `${client}\n\n`.repeat(20);
    const result = assessGeneratedDocumentQuality({
      doc: { id: "x", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF" },
      visibleText: `${base}${out.replace(/_/g, "")}\n`,
    });
    assert.equal(result.issues.find((i) => i.code === "INTERNAL_TRACEABILITY"), undefined);
  });

  it("the gate and the sweep read one list of engine identifiers", () => {
    const gate = readFileSync("lib/engine/document-quality-gate.ts", "utf8");
    const sweep = readFileSync("lib/engine/internal-review-stripper.ts", "utf8");
    assert.match(gate, /\.\.\.ENGINE_IDENTIFIER_PATTERNS/);
    assert.match(sweep, /ENGINE_IDENTIFIER_PATTERNS\.some/);
    assert.match(sweep, /SOURCE_DOCUMENT_METADATA_PATTERNS\.some/);
  });
});

describe("the tender title is not a substituted client", () => {
  it("survives the enforcer when the subject line names it", () => {
    const title = "Architectural Design Services for the Riverside Community Health Centre";
    const md = [
      "# Cover Letter",
      `Subject: Technical Proposal — ${title}`,
      "To: County Health Office",
      `We submit this proposal for ${title}.`,
      "# Section C: Technical Approach",
      `County Health Office has invited proposals for **${title}**.`,
    ].join("\n");
    const out = enforceClientName(md, { canonicalClientName: "County Health Office", knownFirmClients: [], protectedNames: [title] });
    assert.equal(out.substitutionsMade, 0);
    assert.equal(out.markdown, md);
  });

  it("still replaces a genuinely substituted client", () => {
    const md = "# Cover Letter\nSubject: Technical Proposal — Old Client Ltd\nTo: Old Client Ltd";
    const out = enforceClientName(md, { canonicalClientName: "County Health Office", knownFirmClients: ["Old Client Ltd"], protectedNames: ["Design of a District Clinic"] });
    assert.doesNotMatch(out.markdown, /Old Client Ltd/);
  });
});

const CONTRACT_BLOCK = [
  "PROPOSAL INTELLIGENCE CONTRACT — obey before drafting:",
  "Tender form: PREQUALIFICATION.",
  "Criterion graph: 10 criteria; 0 critical; 0 high-risk; 0 missing evidence.",
  "Evidence graph: directProjects=1; transferableProjects=2; directExperts=0; transferableExperts=8; unsafeMismatches=0.",
  "Section writing plan:",
  "- Technical Proposal Response: TCG-2, TCG-6 | evidence=DIRECT | risk=LOW | Write directly",
  "Hard writing rules:",
  "- NEVER invent facts.",
].join("\n");

const TENDER = [
  "[Page 3] SCOPE OF SERVICES",
  "1. Site Assessment",
  "The consultant shall assess the candidate sites and prepare an assessment report.",
  "2. Detailed Design",
  "The consultant shall prepare detailed design drawings and specifications.",
  "3. Construction Supervision",
  "The consultant shall supervise the works for compliance with the approved design.",
  "[Page 4] EVALUATION CRITERIA",
].join("\n");

function writerInput(overrides: Partial<AIBidWriterInput> = {}): AIBidWriterInput {
  return {
    tenderTitle: "Design of a District Clinic",
    clientName: "County Health Office",
    tenderText: TENDER,
    analysisSummary: "",
    evaluationMethodology: "",
    submissionNotes: "",
    requirements: `${CONTRACT_BLOCK}\n\nMANDATORY: Valid business licence\nSCORED: Methodology and work plan for the clinic`,
    companyProfile: "",
    experts: "A. Person — Architect | Disciplines: Architecture\nB. Person — Senior Sanitary Engineer | Disciplines: Sanitary",
    projects: "Clinic A — County Council | Kenya | Healthcare | USD 1.2M | Construction value of works USD 1.2M | 2019-2021 | Services: Feasibility study, Architectural design, Structural design, MEP design, Construction supervision, Contract administration",
    compliance: `${CONTRACT_BLOCK}\n\nSubmit by email`,
    differentiators: "",
    companyVault: { name: "Firm PLC" },
    ...overrides,
  } as AIBidWriterInput;
}

const spec = (id: string) => ({ id } as unknown as ProposalSectionSpec);

describe("the per-section fallback writes tender content, not its prompt", () => {
  it("the contract block comes off the fields it was prepended to", () => {
    assert.equal(stripAIWriterContractPromptBlock(`${CONTRACT_BLOCK}\n\nSCORED: Methodology`), "SCORED: Methodology");
    assert.equal(stripAIWriterContractPromptBlock("SCORED: Methodology"), "SCORED: Methodology");
  });

  it("the technical approach names the tender's scope items and none of the contract", () => {
    const md = buildSectionFallback(spec("technical-approach"), writerInput());
    assert.doesNotMatch(md, /PROPOSAL INTELLIGENCE|Criterion graph|directProjects|TCG-\d|obey before drafting/);
    assert.match(md, /3 scope items: Site Assessment; Detailed Design; Construction Supervision/);
    assert.doesNotMatch(md, /Responsible expert:/, "no name is dealt out round-robin");
    assert.doesNotMatch(md, /requires \*\*/);
  });

  it("without listed scope items it falls back to requirement lines, still without the contract", () => {
    const md = buildSectionFallback(spec("technical-approach"), writerInput({ tenderText: "Design of a clinic." }));
    assert.doesNotMatch(md, /PROPOSAL INTELLIGENCE|Criterion graph|directProjects|TCG-\d/);
    assert.match(md, /Methodology and work plan for the clinic/);
  });

  it("the cover names a project by name, and a construction value under its own label", () => {
    const md = buildSectionFallback(spec("cover-and-summary"), writerInput());
    assert.match(md, /comparable experience includes Clinic A — County Council \(Kenya, construction value of works USD 1\.2M\)\./);
    assert.doesNotMatch(md, / \| /, "no pipe-joined record in prose");
    assert.doesNotMatch(md, /enclosed appendices|confirms full compliance|team availability|declaration of eligibility/i);
  });

  it("the anchor never cuts a service mid-word", () => {
    const anchor = comparableProjectAnchor("Clinic A | Kenya | Healthcare | ETB 5M | Services: Feasibility study, Geotechnical investigation, Archit");
    assert.ok(anchor);
    assert.doesNotMatch(anchor.services ?? "", /archit$/);
  });

  it("section D writes no ESG, safety or innovation pitch the tender did not ask for, and no bracketed signatory", () => {
    const md = buildSectionFallback(spec("additional-and-declaration"), writerInput());
    assert.doesNotMatch(md, /Environmental and Social Governance|Health and Safety|Innovation|no additional cost/);
    assert.doesNotMatch(md, /\[General Manager|YYYY-MM-DD|placeholder|Appendix Register/);
    assert.match(md, /^# Declaration/m);
    const asked = buildSectionFallback(spec("additional-and-declaration"), writerInput({ tenderText: `${TENDER}\nThe consultant shall submit a health and safety plan for site works.` }));
    assert.match(asked, /### Health and Safety/);
  });
});

describe("a model-written section states only the credentials the record holds", () => {
  const record = "Category 1 (Grade I) Ethiopian Construction Authority consultancy. Date of establishment | 05 November 2019 G.C. Training: ISO 9001:2008 Quality Management.";

  it("removes an invented founding year, licence grade and certificate, sentence by sentence", () => {
    const md = [
      "## A.1 Company Background",
      "The firm was founded in 2012 and operates under a Grade A licence. It has delivered 350 projects, worth ETB 694.0M in total.",
      "Certifications include ISO 9001 (quality), ISO 45001 and ISO 14001.",
      "| Record | Reference |",
      "| ISO 14001 certificate | EMS-1 |",
      "| Business licence | BL-1 |",
    ].join("\n");
    const out = scrubUngroundedCompanyCredentials(md, record);
    assert.doesNotMatch(out.markdown, /2012|Grade A|45001|14001/);
    assert.match(out.markdown, /It has delivered 350 projects, worth ETB 694\.0M in total\./, "the next sentence, decimals intact");
    assert.match(out.markdown, /\| Business licence \| BL-1 \|/);
    assert.equal(out.removed.length, 3);
  });

  it("keeps a credential the record states", () => {
    assert.equal(ungroundedCredential("The firm was established in 2019 as a Grade I consultancy.", record), null);
    assert.equal(ungroundedCredential("Its QMS follows ISO 9001.", record), null);
    assert.equal(ungroundedCredential("The design follows ISO 21542 for accessibility.", record), "ISO 21542");
  });

  it("leaves a section with no credential claim byte-for-byte unchanged", () => {
    const md = "## C.1 Approach\n\n  Indented line.  Two spaces here.\n| a | b |";
    assert.equal(scrubUngroundedCompanyCredentials(md, record).markdown, md);
  });
});

describe("tables state what each person's own record holds", () => {
  it("reads a professional registration from the CV, and not a reference-letter number", async () => {
    const { licencesNamedInCv } = await import("../lib/engine/cv-grounding");
    assert.deepEqual(licencesNamedInCv("Professional Reg. Practicing Professional Architect (PPA/1840) Valid until 2027"), ["Practicing Professional Architect (PPA/1840)"]);
    assert.deepEqual(licencesNamedInCv("Professional Reg. • Practicing Professional Engineer (PE) in Construction Management • Reg No: PEPCM/5718"), ["Practicing Professional Engineer (PE) in Construction Management (PEPCM/5718)"]);
    assert.deepEqual(licencesNamedInCv("Supervision: 120K ETB/month Ref No: DRE/021/25, Date: 2025"), []);
    assert.deepEqual(licencesNamedInCv(""), []);
  });

  it("the team table shows no firm-wide tags, and each person's scope items", async () => {
    const { buildProposedTeamTable } = await import("../lib/engine/benchmark-tables");
    const experts = [
      { fullName: "E. Volt", title: "Senior Electrical Engineer", disciplines: '["Architecture","Urban Planning","Electrical Engineering"]', sectors: '["Healthcare","Hospitality"]', certifications: '["—"]', yearsExperience: 11, profile: "" },
      { fullName: "A. Plan", title: "Senior Architect", disciplines: '["Architecture"]', sectors: '["Healthcare"]', certifications: "[]", profile: "Professional Reg. Practicing Professional Architect (PPA/1840)" },
    ] as never[];
    const roles = new Map([["A. Plan", { leads: ["Conceptual Design"], supports: ["Renovation Planning"] }]]);
    const md = buildProposedTeamTable(experts, "hint", roles);
    assert.doesNotMatch(md, /Urban Planning|Hospitality|\| — \|/);
    assert.match(md, /Practicing Professional Architect \(PPA\/1840\)/);
    assert.match(md, /Leads: Conceptual Design\. Supports: Renovation Planning\./);
    assert.match(md, /E\. Volt — Senior Electrical Engineer \| Not stated in CV \| 11 years \| Senior Electrical Engineer \|/);
  });

  it("a portfolio card's relevance is built from the record's fields, not its working summary", async () => {
    const { buildProjectPortfolioCards } = await import("../lib/engine/benchmark-tables");
    const md = buildProjectPortfolioCards([
      { name: "Clinic A", sector: "Healthcare", serviceAreas: '["Architectural design","MEP design"]', summary: "9 Clinic A / Council Testimony letter 1. Construction Cost: 18,900,000 USD 2. Design Cost: 945,000 USD" },
    ] as never, "Design of a District Clinic", "Healthcare / Medical Facility Design", [
      { title: "Architectural Design", description: "The consultant shall prepare the architectural design of the clinic." },
      { title: "Engineering Coordination", description: "The consultant shall coordinate mechanical, electrical and plumbing systems." },
      { title: "Site Supervision", description: "The consultant shall supervise the works." },
    ]);
    // The relevance row links the record's own services to the tender's own
    // scope items; it does not restate the services row above it.
    assert.match(md, /Same sector as this assignment \(Healthcare\)\. The firm's recorded services on this project correspond to these scope items of this tender: Architectural Design \(architectural design\) and Engineering Coordination \(MEP design\)\./);
    assert.doesNotMatch(md, /Services the firm provided/);
    assert.doesNotMatch(md, /Testimony letter|Design Cost: 945,000/);
  });

  it("project values are added only within one currency", async () => {
    const { computePortfolioMetrics, buildPortfolioMetricsBlock } = await import("../lib/engine/portfolio-metrics");
    const block = buildPortfolioMetricsBlock(computePortfolioMetrics({ experts: [] as never, projects: [
      { contractValue: 550_000_000, currency: "ETB" }, { contractValue: 125_000_000, currency: "ETB" }, { contractValue: 18_900_000, currency: "USD" },
    ] as never }), "Firm");
    assert.match(block, /\*\*ETB 675\.0M\*\* Aggregate Value of Projects Delivered \(ETB\)/);
    assert.match(block, /\*\*USD 18\.9M\*\* Aggregate Value of Projects Delivered \(USD\)/);
    assert.doesNotMatch(block, /693\.9|694\.0/);
  });
});

describe("a model-written section carries no figure the export gate refuses", () => {
  it("drops the firm's turnover sentence and keeps the rest of the paragraph", async () => {
    const { clientSafeModelSection } = await import("../lib/ai");
    const md = "## A.1 Company Background\nThe firm has delivered more than 350 projects. Annual turnover progressed from ETB 5.01M in 2020/21 to ETB 28.9M in 2024/25. It holds 29 key experts.";
    const r = clientSafeModelSection(md);
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.markdown, /turnover|5\.01M|28\.9M/);
    assert.match(r.markdown, /more than 350 projects\. It holds 29 key experts\./);
  });
});

describe("prose that states a project value states what the value is", () => {
  it("the why-us sentence labels the construction value, and the gate accepts it", async () => {
    const { containsPricingLeakage } = await import("../lib/engine/pricing-hygiene");
    const src = readFileSync("lib/engine/why-us-summary.ts", "utf8");
    assert.match(src, /\(construction value of works \$\{value\}\)/);
    const doc = { name: "Technical Proposal", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" } as const;
    assert.equal(containsPricingLeakage("Firm presents G+6 General Hospital (ETB 550,074,678) for Gimba City as a project record.", doc), true, "the unlabelled form is what the gate refused");
    assert.equal(containsPricingLeakage("Firm presents G+6 General Hospital (construction value of works ETB 550,074,678) for Gimba City as a project record.", doc), false);
  });

  it("the final sweep drops a refused sentence, keeps labelled rows, and blanks only an unlabelled money cell", async () => {
    const { scrubPricingLeakageSentences } = await import("../lib/ai");
    const md = [
      "Firm presents X (ETB 550,074,678) for Y. The team is ready.",
      "| Construction Value of Works | USD 18,900,000 |",
      "| Dessie Specialized Hospital | ETB 125M | Dessie City Admin |",
    ].join("\n");
    const out = scrubPricingLeakageSentences(md, { keepTableRows: true });
    // Run 36063806865: the gate reads a row as its cells joined with ", ".
    assert.equal(out, [
      "The team is ready.",
      "| Construction Value of Works | USD 18,900,000 |",
      "| Dessie Specialized Hospital | — | Dessie City Admin |",
    ].join("\n"));
  });

  it("an amount in a prose table cell keeps its label in the same cell, or goes", async () => {
    // Run 36068858534: the DOCX passed and its PDF did not. The PDF wraps each
    // cell over several lines and interleaves the columns, so the gate read
    // "... | Technical approach and | Hospital Project, USD 19M," as a price.
    const { scrubPricingLeakageSentences } = await import("../lib/ai");
    const md = [
      "| Criterion | Our response | Evidence |",
      "|---|---|---|",
      "| Experience | Technical approach and methodology addresses scope | Riverside Hospital Project, USD 19M, delivered design |",
      "| Value | Construction Value of Works | USD 18,900,000 |",
      "| Reference | Clinic (construction value of works ETB 550,074,678) | Design |",
    ].join("\n");
    const out = scrubPricingLeakageSentences(md, { keepTableRows: true });
    assert.equal(out, [
      "| Criterion | Our response | Evidence |",
      "|---|---|---|",
      "| Experience | Technical approach and methodology addresses scope | Riverside Hospital Project, delivered design |",
      "| Value | Construction Value of Works | USD 18,900,000 |",
      "| Reference | Clinic (construction value of works ETB 550,074,678) | Design |",
    ].join("\n"));
    const { containsPricingLeakage } = await import("../lib/engine/pricing-hygiene");
    const pdfDoc = { name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF" };
    assert.equal(containsPricingLeakage("methodology addresses | Technical approach and | Hospital Project, USD 19M,", pdfDoc), true, "the wrapped fragment the gate refused");
  });
});

describe("the delivered text reads as the firm's record, not a record dump", () => {
  // Run 36071201669 passed every gate and delivered: "aggregate value ETB
  // 693,974,678" (ETB 675,074,678 + USD 18,900,000); the firm's own past fees
  // from a raw record ("Supervision Cost: 110,000 ETB/month"); a why-us bullet
  // cut to "Three-stage" because "internal review" is AI-trace vocabulary a
  // repair pass removes; and a bare amount beside a project name.
  const projects = [
    { name: "District Hospital", clientName: "City Health Bureau", country: "Kenya", sector: "Healthcare", contractValue: 550_074_678, currency: "KES",
      summary: "Ref: 1591/18. 1. Construction Cost: 550,074,678 KES 2. Design Cost: 1,100,000 KES 3. Supervision Cost: 110,000 KES/month", serviceAreas: JSON.stringify(["Architectural design"]) },
    { name: "Regional Clinic", clientName: "County Office", country: "Uganda", sector: "Healthcare", contractValue: 18_900_000, currency: "USD", summary: "Testimony letter.", serviceAreas: JSON.stringify(["MEP design"]) },
    { name: "Health Post", clientName: "County Office", country: "Kenya", sector: "Healthcare", contractValue: 125_000_000, currency: "KES", summary: "", serviceAreas: "[]" },
  ];

  it("sums values per currency and never uses AI-trace vocabulary", async () => {
    const { buildWhyUsSummary } = await import("../lib/engine/why-us-summary");
    const { AI_TRACE_PATTERNS } = await import("../lib/engine/detection-patterns");
    const out = buildWhyUsSummary({ companyName: "Firm", clientName: "Client", experts: [{ fullName: "A. Lead", title: "Team Leader", yearsExperience: 11 }] as never, projects: projects as never, differentiators: [], primarySector: "Healthcare" }) ?? "";
    assert.match(out, /aggregate construction value of works of KES 675,074,678 and USD 18,900,000/);
    assert.doesNotMatch(out, /693,974,678/);
    assert.doesNotMatch(out, /same lead who has delivered/);
    for (const rx of AI_TRACE_PATTERNS) assert.doesNotMatch(out, rx);
  });

  it("no deterministic builder writes the phrase a repair pass cuts out", () => {
    for (const file of ["lib/engine/why-us-summary.ts", "lib/engine/benchmark-tables.ts", "lib/engine/risks-mitigations.ts", "lib/engine/understanding-and-value-added.ts"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /Three-stage internal review/i, file);
    }
  });

  it("a project reference carries its labelled value once and none of the raw record", async () => {
    const { projectReferenceLine, projectProofLine } = await import("../lib/engine/proposal-intelligence");
    const line = projectReferenceLine(projects[0] as never);
    assert.match(line, /Construction value of works KES 550,074,678|Construction value of works KES 550\.1M/);
    assert.doesNotMatch(line, /Supervision Cost|110,000|Ref: 1591/);
    assert.equal((line.match(/550/g) ?? []).length, 1, line);
    // The writer's proof line still carries the record for context.
    assert.match(projectProofLine(projects[0] as never), /Supervision Cost/);
  });

  it("the cover letter labels the value it names", async () => {
    const { buildCoverLetterOpener } = await import("../lib/engine/benchmark-tables");
    const out = buildCoverLetterOpener({ companyName: "Firm", clientName: "Client", tenderTitle: "Clinic Design", projects: projects as never });
    assert.match(out, /District Hospital \(construction value of works KES 550,074,678/);
  });
});

describe("a compliance number is not priced language", () => {
  it("keeps a VAT registration number and still rewrites a VAT rate", async () => {
    const { VAT_RATE_MENTION } = await import("../lib/engine/generate-elite");
    const row = "| VAT Registration | VAT 15480320805 | ACTIVE |";
    assert.equal(row.replace(VAT_RATE_MENTION, "tax compliance"), row);
    assert.equal("Registration no: VAT reg. no. 1548032080".replace(VAT_RATE_MENTION, "x"), "Registration no: VAT reg. no. 1548032080");
    assert.equal("VAT 15% applies".replace(VAT_RATE_MENTION, "tax compliance"), "tax compliance 15% applies");
  });
});

describe("the compliance matrix shows evidence, not the engine's record of it", () => {
  it("renders no evidence enum, drafting state or .txt extraction name", async () => {
    const { buildComplianceMatrixSection } = await import("../lib/engine/compliance-matrix-builder");
    const out = buildComplianceMatrixSection({
      requirements: [{ id: "r1", title: "Multidisciplinary Professional Team", priority: "MANDATORY" }],
      matrixRows: [
        { requirementId: "r1", evidenceType: "PROPOSAL_RESPONSE", evidenceSource: "Company Qualifications — CV evidence available for drafting", evidenceReference: "Expert CVS.pdf.txt", supportLevel: "DIRECT" },
        { requirementId: "r1", evidenceType: "GENERATED_DOCUMENT", evidenceSource: "AUTO_GENERATED_ARTIFACT", evidenceReference: "Technical Proposal.pdf", supportLevel: "DIRECT" },
      ],
      gaps: [],
    } as never) ?? "";
    assert.doesNotMatch(out, /PROPOSAL_?RESPONSE|GENERATED_?DOCUMENT|AUTO_?GENERATED|available for drafting|\.pdf\.txt/);
  });
});

describe("an eligibility requirement points at a section the proposal has", () => {
  it("names the Declaration, not a D.4 no builder writes", () => {
    // Run 36074770709's bid-compliance mapping sent "Valid Business License
    // and Registration" to "Section D.4 Declaration of Eligibility"; the
    // delivered proposal has a Declaration and no D.4.
    for (const file of ["lib/engine/bid-compliance-mapping.ts", "lib/engine/compliance-matrix-builder.ts"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /Section D\.4 Declaration of Eligibility/, file);
    }
  });
});

// Hosted run 36168535103 (per-section path) shipped the vault's profile digest
// as seven pages of A.1 — "Convenience digest ... for use in AI-assisted
// tender drafting. Use this summary to populate ..." — two "See deterministic
// ... table built downstream" lines, a second Client References section and
// a second certifications section.
describe("the per-section fallback ships neither the vault's drafting digest nor placeholders", () => {
  const digest = [
    "Firm PLC",
    "Company Profile Summary",
    "Purpose of this summary",
    "Convenience digest of the corporate profile for use in AI-assisted tender drafting.",
    "Use this summary to populate company background.",
    "Head office | Nairobi, Kenya",
    "Date of establishment | 12 March 2015",
  ].join("\n");

  it("A.1 carries the firm's own facts, not its profile document", () => {
    const md = buildSectionFallback(spec("company-and-experience"), writerInput({ companyVault: { name: "Firm PLC", profileSummary: digest } as AIBidWriterInput["companyVault"] }));
    assert.doesNotMatch(md, /AI-assisted|Use this summary|Convenience digest|Purpose of this summary/);
    assert.match(md, /\| Head office \| Nairobi, Kenya \|/);
    assert.match(md, /\| Date of establishment \| 12 March 2015 \|/);
  });

  it("leaves the portfolio and client references to their own builders", () => {
    const md = buildSectionFallback(spec("company-and-experience"), writerInput());
    assert.doesNotMatch(md, /built downstream|See deterministic/);
    assert.doesNotMatch(md, /Client References/);
  });

  it("leaves certifications to the record-based D.3 builder", () => {
    const md = buildSectionFallback(spec("additional-and-declaration"), writerInput());
    assert.doesNotMatch(md, /Professional Certifications and Affiliations/);
    assert.match(md, /# Declaration/);
  });
});
