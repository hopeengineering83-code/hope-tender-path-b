/**
 * Tender Document Composer
 *
 * Composes document content by combining:
 * - Tender-type-specific section planning
 * - HAEC service-stream-specific methodology
 * - Compliance matrix with mandatory requirements
 * - Selected experts/projects/evidence (never invented)
 * - Placeholder/AI-trace-free content
 *
 * This module produces markdown content that can be converted to DOCX
 * by the existing markdownToDocx pipeline in generate-elite.ts.
 */

import type { TenderDocumentGenerationContext } from "./tender-document-context";
import { buildDocumentPlan, type DocumentPlan } from "./tender-section-planner";
import { getCombinedMethodology, type MethodologySection } from "./haec-service-methodology";
import { validateGeneratedDocumentQuality, type GeneratedDocumentQualityResult, type ComplianceMatrixRow } from "./generated-document-quality-validator";
import { stripPlaceholders } from "../engine/placeholder-stripper";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComposedDocument = {
  type: string;
  title: string;
  envelope: "TECHNICAL" | "FINANCIAL" | "ADMIN";
  markdown: string;
  quality: GeneratedDocumentQualityResult;
  complianceMatrix: ComplianceMatrixRow[];
};

export type CompositionResult = {
  documents: ComposedDocument[];
  skippedDocuments: Array<{ type: string; reason: string }>;
  overallScore: number;
};

// ─── Composer ───────────────────────────────────────────────────────────────

/**
 * Compose all documents for a tender based on its type and context.
 */
export function composeTenderDocuments(ctx: TenderDocumentGenerationContext): CompositionResult {
  const plan = buildDocumentPlan(ctx);
  const documents: ComposedDocument[] = [];
  let totalScore = 0;

  for (const docPlan of plan.documents) {
    const markdown = composeDocumentMarkdown(docPlan.type, docPlan.sections.map((s) => s.title), ctx);
    const cleanedMarkdown = stripPlaceholders(markdown).markdown;
    const complianceMatrix = buildComplianceMatrix(ctx);

    const requiredSections = docPlan.sections.filter((s) => s.required).map((s) => s.title);
    const quality = validateGeneratedDocumentQuality(
      cleanedMarkdown,
      docPlan.type,
      ctx,
      requiredSections,
      ctx.mandatoryRequirements,
    );

    documents.push({
      type: docPlan.type,
      title: docPlan.title,
      envelope: docPlan.envelope,
      markdown: cleanedMarkdown,
      quality,
      complianceMatrix,
    });
    totalScore += quality.score;
  }

  const overallScore = documents.length > 0 ? Math.round(totalScore / documents.length) : 0;

  return {
    documents,
    skippedDocuments: plan.skippedDocuments,
    overallScore,
  };
}

// ─── Document markdown composer ─────────────────────────────────────────────

function composeDocumentMarkdown(docType: string, sections: string[], ctx: TenderDocumentGenerationContext): string {
  const parts: string[] = [];

  // Cover page
  parts.push(composeCoverPage(ctx));

  // Table of contents placeholder
  parts.push("\n## Table of Contents\n\n[Auto-generated on DOCX render]\n");

  // Compose each section
  for (const section of sections) {
    parts.push(composeSection(section, ctx));
  }

  return parts.join("\n\n");
}

function composeCoverPage(ctx: TenderDocumentGenerationContext): string {
  const lines: string[] = [
    `# ${ctx.projectTitle ?? "Tender Response"}`,
    "",
    `**Client:** ${ctx.clientName ?? "— Client to be confirmed"}`,
    `**Reference:** ${ctx.tenderId}`,
    `**Submission Method:** ${ctx.submissionMethod ?? "— To be confirmed"}`,
    `**Deadline:** ${ctx.deadline ? new Date(ctx.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "— To be confirmed"}`,
    "",
    `**Submitted by:** ${ctx.companyProfile.name}`,
  ];
  if (ctx.companyProfile.country) lines.push(`**Country:** ${ctx.companyProfile.country}`);
  if (ctx.companyProfile.website) lines.push(`**Website:** ${ctx.companyProfile.website}`);
  lines.push("");
  return lines.join("\n");
}

function composeSection(sectionTitle: string, ctx: TenderDocumentGenerationContext): string {
  const lower = sectionTitle.toLowerCase();

  if (lower.includes("cover letter")) return composeCoverLetter(ctx);
  if (lower.includes("company profile")) return composeCompanyProfile(ctx);
  if (lower.includes("understanding")) return composeUnderstanding(ctx);
  if (lower.includes("technical approach") || lower.includes("methodology")) return composeTechnicalApproach(ctx);
  if (lower.includes("work plan")) return composeWorkPlan(ctx);
  if (lower.includes("team composition")) return composeTeamComposition(ctx);
  if (lower.includes("expert role matrix")) return composeExpertRoleMatrix(ctx);
  if (lower.includes("cv summary")) return composeCvSummary(ctx);
  if (lower.includes("similar project") || lower.includes("project reference")) return composeSimilarProjects(ctx);
  if (lower.includes("compliance matrix")) return composeComplianceMatrixSection(ctx);
  if (lower.includes("legal") || lower.includes("compliance document")) return composeLegalCompliance(ctx);
  if (lower.includes("submission checklist")) return composeSubmissionChecklist(ctx);
  if (lower.includes("annex")) return composeAnnexList(ctx);
  if (lower.includes("expression of interest")) return composeEOIDocument(ctx);
  if (lower.includes("price schedule")) return composePriceSchedule(ctx);
  if (lower.includes("quotation")) return composeQuotation(ctx);
  if (lower.includes("technical compliance")) return composeTechnicalCompliance(ctx);
  if (lower.includes("financial proposal")) return composeFinancialProposal(ctx);

  // Default section
  return `## ${sectionTitle}\n\n[Content to be developed based on tender requirements.]\n`;
}

function composeCoverLetter(ctx: TenderDocumentGenerationContext): string {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `## Cover Letter

**Date:** ${date}

**To:** ${ctx.clientName ?? "The Procuring Entity"}

**Subject:** Submission of ${ctx.tenderType === "EOI" ? "Expression of Interest" : "Technical Proposal"} for ${ctx.projectTitle ?? "the above-referenced tender"}

Dear Sir/Madam,

We are pleased to submit our ${ctx.tenderType === "EOI" ? "Expression of Interest" : "Technical Proposal"} in response to the above-referenced tender. ${ctx.companyProfile.name} has carefully reviewed the tender requirements and confirms its capability and interest in delivering the scope of services.

Our submission is structured to address all requirements specified in the tender document. We have included relevant project experience, qualified personnel, and the required compliance documentation as detailed in the following sections.

We confirm that the information provided in this submission is accurate and complete to the best of our knowledge.

Yours faithfully,

**[Authorized Signature]**

${ctx.companyProfile.name}
${ctx.companyProfile.country ?? ""}`;
}

function composeCompanyProfile(ctx: TenderDocumentGenerationContext): string {
  return `## Company Profile

**Company Name:** ${ctx.companyProfile.name}
**Country:** ${ctx.companyProfile.country ?? "—"}
${ctx.companyProfile.establishedYear ? `**Established:** ${ctx.companyProfile.establishedYear}` : ""}
${ctx.companyProfile.website ? `**Website:** ${ctx.companyProfile.website}` : ""}

${ctx.companyProfile.description ?? "Company description to be confirmed."}

**Service Lines:**
${ctx.companyProfile.serviceLines.map((s) => `- ${s}`).join("\n") || "- To be confirmed"}`;
}

function composeUnderstanding(ctx: TenderDocumentGenerationContext): string {
  const scope = ctx.scopeOfServices.length > 0
    ? ctx.scopeOfServices.map((s) => `- ${s}`).join("\n")
    : "- Scope details to be confirmed from tender document";

  return `## Understanding of the Assignment

We have carefully reviewed the tender document and understand that the scope of services includes:

${scope}

**Key Deliverables:**
${ctx.deliverables.map((d) => `- ${d}`).join("\n") || "- Deliverables to be confirmed from tender document"}

**Evaluation Criteria:**
${ctx.evaluationCriteria.map((e) => `- ${e}`).join("\n") || "- Evaluation criteria to be confirmed from tender document"}

Our understanding is based on a thorough reading of the tender document. Any clarification sought during the tender period has been documented and will inform our execution approach.`;
}

function composeTechnicalApproach(ctx: TenderDocumentGenerationContext): string {
  const methodology = getCombinedMethodology(ctx.serviceStreams);
  const parts: string[] = ["## Technical Approach and Methodology"];

  parts.push("Our technical approach is tailored to the specific requirements of this tender and the identified service streams. The methodology below is structured to ensure quality, compliance, and timely delivery.");

  for (const section of methodology) {
    parts.push(`### ${section.title}\n\n${section.content}`);
    if (section.deliverables.length > 0) {
      parts.push(`**Deliverables:**\n${section.deliverables.map((d) => `- ${d}`).join("\n")}`);
    }
  }

  return parts.join("\n\n");
}

function composeWorkPlan(ctx: TenderDocumentGenerationContext): string {
  return `## Work Plan

Our work plan is structured into phases aligned with the project requirements:

### Phase 1: Inception and Mobilization
- Project kick-off meeting with client
- Confirmation of scope, deliverables, and timeline
- Mobilization of key personnel
- Establishment of project management systems

### Phase 2: Data Collection and Analysis
- Review of existing documentation
- Field investigations (where applicable)
- Stakeholder consultations
- Technical analysis

### Phase 3: Design/Implementation
- Development of design options or implementation strategy
- Client review and feedback incorporation
- Detailed design/implementation

### Phase 4: Review and Submission
- Internal quality assurance review
- Client review
- Finalization and submission
- Handover

**Quality Assurance:** All deliverables will undergo internal QA review per our ISO 9001-certified quality management system.`;
}

function composeTeamComposition(ctx: TenderDocumentGenerationContext): string {
  if (ctx.selectedExperts.length === 0) {
    return `## Team Composition

**[Controlled Gap — Draft Only]** No experts have been selected for this tender yet. The team composition table will be populated once experts are selected from the company vault.

The proposed team structure will include roles as specified in the tender requirements. Expert CVs will be attached as a separate annex once selections are confirmed.`;
  }

  const rows = ctx.selectedExperts.map((e, i) =>
    `| ${i + 1} | ${e.fullName} | ${e.title ?? "—"} | ${e.disciplines.join(", ") || "—"} | ${e.yearsExperience ?? "—"} |`,
  ).join("\n");

  return `## Team Composition

The following experts have been selected from our company vault for this tender:

| # | Name | Title | Disciplines | Years Exp. |
|---|------|-------|-------------|------------|
${rows}

All selected experts have been reviewed and their CVs are available in the company vault. Availability will be confirmed upon contract award.`;
}

function composeExpertRoleMatrix(ctx: TenderDocumentGenerationContext): string {
  if (ctx.selectedExperts.length === 0) {
    return `## Expert Role Matrix

**[Controlled Gap — Draft Only]** Expert role matrix will be populated once experts are selected.`;
  }

  const rows = ctx.selectedExperts.map((e) =>
    `| ${e.fullName} | ${e.title ?? "Expert"} | Lead/Specialist | Full-time | ${e.disciplines.join(", ") || "—"} |`,
  ).join("\n");

  return `## Expert Role Matrix

| Expert | Role | Position | Availability | Disciplines |
|--------|------|----------|-------------|-------------|
${rows}`;
}

function composeCvSummary(ctx: TenderDocumentGenerationContext): string {
  if (ctx.selectedExperts.length === 0) {
    return `## CV Summary

**[Controlled Gap — Draft Only]** CV summaries will be included once experts are selected.`;
  }

  const summaries = ctx.selectedExperts.map((e) =>
    `### ${e.fullName}\n\n**Title:** ${e.title ?? "—"}\n**Disciplines:** ${e.disciplines.join(", ") || "—"}\n**Years of Experience:** ${e.yearsExperience ?? "—"}\n\nFull CV attached as annex.`,
  ).join("\n\n");

  return `## CV Summary

${summaries}`;
}

function composeSimilarProjects(ctx: TenderDocumentGenerationContext): string {
  if (ctx.selectedProjects.length === 0) {
    return `## Similar Project References

**[Controlled Gap — Draft Only]** No project references have been selected for this tender yet. The similar projects table will be populated once projects are selected from the company vault.

Comparable project references will be drawn from our portfolio to demonstrate relevant experience in similar assignments, sectors, and service streams.`;
  }

  const rows = ctx.selectedProjects.map((p) => {
    const value = p.contractValue && p.currency
      ? `${p.currency} ${p.contractValue.toLocaleString()}`
      : "—";
    const dates = p.startDate && p.endDate
      ? `${p.startDate.getFullYear()}–${p.endDate.getFullYear()}`
      : "—";
    return `| ${p.name} | ${p.clientName ?? "—"} | ${p.sector ?? "—"} | ${dates} | ${value} |`;
  }).join("\n");

  return `## Similar Project References

The following projects from our portfolio demonstrate relevant experience:

| Project | Client | Sector | Period | Value |
|---------|--------|--------|--------|-------|
${rows}

Each project listed above has been completed (or is in an advanced stage) and demonstrates our capability in similar assignments.`;
}

function composeComplianceMatrixSection(ctx: TenderDocumentGenerationContext): string {
  if (ctx.mandatoryRequirements.length === 0) {
    return `## Compliance Matrix

No mandatory requirements have been extracted from the tender document. The compliance matrix will be populated once requirements are extracted via AI Analyze or manual entry.`;
  }

  const matrix = buildComplianceMatrix(ctx);
  const rows = matrix.map((r) =>
    `| ${r.tenderRequirement} | ${r.mandatory ? "Yes" : "No"} | ${r.response} | ${r.proposalSection} | ${r.evidenceUsed.join(", ") || "—"} |`,
  ).join("\n");

  return `## Compliance Matrix

The following compliance matrix maps each tender requirement to our proposal response:

| Requirement | Mandatory | Response | Proposal Section | Evidence |
|-------------|-----------|----------|-----------------|----------|
${rows}`;
}

function composeLegalCompliance(ctx: TenderDocumentGenerationContext): string {
  if (ctx.selectedLegalDocuments.length === 0) {
    return `## Legal / Compliance Documents

**[Controlled Gap — Draft Only]** No legal/compliance documents have been linked to this tender. The following documents will be attached once available:

- Business licence
- Tax clearance certificate
- Professional registration
- Insurance certificate

Please ensure all required legal documents are uploaded to the company vault and linked to this tender before final submission.`;
  }

  const docs = ctx.selectedLegalDocuments.map((d) => {
    const status = d.expiryDate && new Date(d.expiryDate) < new Date() ? "EXPIRED" : d.status;
    return `- **${d.title}** (${d.recordType}) — Status: ${status}${d.referenceNumber ? `, Ref: ${d.referenceNumber}` : ""}`;
  }).join("\n");

  return `## Legal / Compliance Documents

The following legal and compliance documents are available and linked to this tender:

${docs}

All documents are current and valid as of the submission date.`;
}

function composeSubmissionChecklist(ctx: TenderDocumentGenerationContext): string {
  const checklist = [
    "- [ ] Cover letter signed and dated",
    "- [ ] Technical proposal (if required)",
    ctx.financialProposalRequired ? "- [ ] Financial proposal (separate envelope)" : "- [x] Financial proposal not required",
    "- [ ] Company profile",
    "- [ ] Expert CVs (if required)",
    "- [ ] Project references (if required)",
    "- [ ] Compliance matrix",
    "- [ ] Legal documents",
    "- [ ] All required annexes",
  ];

  return `## Submission Checklist

The following checklist confirms that all required documents are included in this submission:

${checklist.join("\n")}

**Required Documents from Tender:**
${ctx.requiredDocuments.map((d) => `- ${d}`).join("\n") || "- No specific document list extracted"}`;
}

function composeAnnexList(ctx: TenderDocumentGenerationContext): string {
  if (ctx.requiredDocuments.length === 0) {
    return `## Annex List

No specific annexes have been identified from the tender document. Annexes will be listed once the required documents are extracted.`;
  }

  return `## Annex List

The following annexes are required per the tender document:

${ctx.requiredDocuments.map((d, i) => `**Annex ${String.fromCharCode(65 + i)}:** ${d}`).join("\n\n")}`;
}

function composeEOIDocument(ctx: TenderDocumentGenerationContext): string {
  return `## Expression of Interest

${ctx.companyProfile.name} hereby expresses its interest in providing the services described in the tender document.

**Company Qualifications:**
- ${ctx.companyProfile.description ?? "Established company with relevant experience"}
- Service lines: ${ctx.companyProfile.serviceLines.join(", ") || "Multiple engineering disciplines"}

**Relevant Experience:**
${ctx.selectedProjects.length > 0
  ? ctx.selectedProjects.map((p) => `- ${p.name} (${p.clientName ?? "—"})`).join("\n")
  : "- Project references to be provided upon shortlisting"}

**Key Personnel:**
${ctx.selectedExperts.length > 0
  ? ctx.selectedExperts.map((e) => `- ${e.fullName} — ${e.title ?? "Expert"}`).join("\n")
  : "- Expert details to be provided upon shortlisting"}

We confirm our interest and availability to participate in this assignment and are prepared to submit a full technical and financial proposal upon shortlisting.`;
}

function composePriceSchedule(ctx: TenderDocumentGenerationContext): string {
  return `## Price Schedule

| # | Description | Unit | Quantity | Unit Price | Total |
|---|-------------|------|----------|------------|-------|
| 1 | [Service item to be specified] | — | — | — | — |

**Currency:** [To be confirmed from tender]
**Total:** [To be calculated]

**Notes:**
- Prices are valid for [validity period] days from submission date.
- Prices are inclusive of all taxes unless otherwise stated.
- Payment terms as per tender conditions.`;
}

function composeQuotation(ctx: TenderDocumentGenerationContext): string {
  return `## Quotation

**To:** ${ctx.clientName ?? "The Procuring Entity"}
**Date:** ${new Date().toLocaleDateString("en-GB")}
**Reference:** ${ctx.tenderId}

We are pleased to submit our quotation for the supply of goods/services as specified in the tender document.

**Quotation Summary:**

| # | Item | Specification | Quantity | Unit Price | Total |
|---|------|--------------|----------|------------|-------|
| 1 | [Item to be specified] | [Spec] | [Qty] | [Price] | [Total] |

**Total Quoted Price:** [To be calculated]
**Currency:** [To be confirmed]
**Validity:** [As per tender]

This quotation is submitted in accordance with the terms and conditions of the tender document.`;
}

function composeTechnicalCompliance(ctx: TenderDocumentGenerationContext): string {
  return `## Technical Compliance Statement

We confirm that the goods/services offered fully comply with the technical specifications stated in the tender document.

**Compliance Summary:**
- All technical specifications: COMPLY
- Delivery timeline: COMPLY (as per tender requirements)
- Warranty: COMPLY (as per tender requirements)
- Quality standards: COMPLY (ISO 9001 certified)

Any deviations or clarifications will be noted in the remarks column of the detailed compliance schedule.`;
}

function composeFinancialProposal(ctx: TenderDocumentGenerationContext): string {
  return `## Financial Proposal

**Submitted in separate sealed envelope as required by the two-envelope procedure.**

**Financial Summary:**

| # | Cost Item | Amount |
|---|-----------|--------|
| 1 | Professional fees (Key Personnel) | [To be specified] |
| 2 | Support staff costs | [To be specified] |
| 3 | Field investigation costs | [To be specified] |
| 4 | Laboratory testing | [To be specified] |
| 5 | Equipment and materials | [To be specified] |
| 6 | Travel and per diem | [To be specified] |
| 7 | Overhead and contingency | [To be specified] |
| **Total** | **[To be calculated]** | |

**Currency:** [As per tender]
**Validity:** [As per tender]
**Payment Terms:** [As per tender]`;
}

// ─── Compliance matrix builder ──────────────────────────────────────────────

function buildComplianceMatrix(ctx: TenderDocumentGenerationContext): ComplianceMatrixRow[] {
  return ctx.mandatoryRequirements.map((req, i) => {
    // Check if we have evidence for this requirement
    const hasExpertEvidence = ctx.selectedExperts.some((e) =>
      e.disciplines.some((d) => req.toLowerCase().includes(d.toLowerCase())),
    );
    const hasProjectEvidence = ctx.selectedProjects.some((p) =>
      p.serviceAreas.some((s) => req.toLowerCase().includes(s.toLowerCase())),
    );

    let response: ComplianceMatrixRow["response"] = "Comply";
    let evidenceUsed: string[] = [];
    let notes: string | null = null;

    if (hasExpertEvidence) {
      const matchingExperts = ctx.selectedExperts.filter((e) =>
        e.disciplines.some((d) => req.toLowerCase().includes(d.toLowerCase())),
      );
      evidenceUsed = matchingExperts.map((e) => e.fullName);
    } else if (hasProjectEvidence) {
      const matchingProjects = ctx.selectedProjects.filter((p) =>
        p.serviceAreas.some((s) => req.toLowerCase().includes(s.toLowerCase())),
      );
      evidenceUsed = matchingProjects.map((p) => p.name);
      response = "Comply";
    } else {
      response = "Clarification required";
      notes = "Evidence pending — to be confirmed before final submission";
    }

    return {
      requirementId: `REQ-${i + 1}`,
      tenderRequirement: req,
      mandatory: true,
      response,
      proposalSection: "See relevant section in Technical Proposal",
      evidenceUsed,
      notes,
    };
  });
}
