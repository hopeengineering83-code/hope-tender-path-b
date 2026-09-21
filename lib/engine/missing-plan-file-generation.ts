// Missing planned-file generation — shared implementation.
//
// Extracted from POST /api/tenders/[id]/generate-missing-plan-files so the
// route and the auto-finalize continuation worker run ONE implementation, the
// same way runSafeExportRepairs is shared with /repair-export-gaps.
//
// WHY: the workflow UI tells the owner that missing planned documents and safe
// repairs are handled automatically after Run Engine, but the automatic chain
// (lib/ai-jobs/auto-finalize-continuation-service.ts) only repaired, validated
// and finalised documents that ALREADY EXISTED. It reconciled the package
// against the confirmed plan and reported
// "package reconciliation incomplete — N of M required file(s) are not in the
// package" as a terminal blocker, while the only thing that could create those
// files was a button the owner had to find and press. The work the UI promises
// is automatic is now actually automatic.
//
// Every gate this path enforced as an HTTP 422 is preserved exactly and
// returned as a structured blocker instead: degraded/partial/weak analysis,
// missing client details, the central generation-and-export gate, a current
// source-verified confirmed Build Plan, and the SUPPORT_PACKAGE_GENERATION
// operation gate. Persistence still runs inside withTransactionalGenerationGate
// with the plan-fingerprint re-check and the P2002 convergence retry.
//
// It never invents a file the app must not produce: a tender-issued form, a
// priced financial proposal or an official original is written as a PLANNED row
// awaiting its original, exactly as before. A requirement that states a
// submission RULE rather than a deliverable is not in the confirmed plan at all
// (see lib/engine/financial-separation-rule.ts).

import { decideExistingArtifactRegeneration, withContractMarker } from "./generated-artifact-staleness";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { PrismaClient } from "@prisma/client";
import { logAction } from "../audit";
import { findMissingGeneratedDocuments } from "./submission-plan";
import { getCurrentConfirmedBuildPlan } from "./build-plan";
import { assertTenderReadyForGenerationAndExport } from "./generation-readiness-gate";
import { verifiedIntegrityDataFromBase64 } from "./persisted-byte-integrity";
import { resolveTenderOperationGate } from "./tender-operation-gate";
import {
  GenerationPersistenceBlockedError,
  withTransactionalGenerationGate,
} from "./transactional-generation-gate";
import { logger } from "../observability";
import { TECHNICAL_IN_FINANCIAL_RE } from "./document-quality-validator";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT } from "../vault-review-provenance";
import { cleanClientName } from "./proposal-labels";

export type MissingPlanFileGenerationResult = {
  ok: boolean;
  /** Blocker code when ok is false; absent on success. */
  code?: string;
  /** Human-readable blocker detail when ok is false. */
  error?: string;
  /** Suggested next step for the caller/UI when ok is false. */
  nextAction?: string;
  /** HTTP status the route should use. 200 on success. */
  status: number;
  created: string[];
  updated: string[];
  convertedFromPlanned: string[];
  /** Rows created as PLANNED because the file must arrive as an official original. */
  plannedCreated: string[];
  skipped: string[];
  /** True when there was nothing missing to begin with. */
  nothingMissing: boolean;
};

type RequirementLike = {
  title: string;
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
};

type PreparedDocument = {
  fileName: string;
  documentType: string;
  fileContent: string;
  format: string;
  validationStatus: string;
  reviewStatus: string;
  contentSummary: string;
  exactOrder?: number | null;
  plannedRowId?: string;
  keepPlanned?: boolean;
};

function clean(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function para(text: string, bold = false) {
  return new Paragraph({
    children: [new TextRun({ text: clean(text), bold, size: 22, font: "Calibri" })],
    spacing: { after: 120, line: 276 },
  });
}

function heading(text: string) {
  return new Paragraph({
    text: clean(text),
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 140 },
  });
}

function subheading(text: string) {
  return new Paragraph({
    text: clean(text),
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 100 },
  });
}

function bullet(text: string) {
  return new Paragraph({
    text: clean(text),
    bullet: { level: 0 },
    spacing: { after: 80, line: 260 },
  });
}

function documentTypeFor(fileName: string, fallback: string) {
  const label = fileName.toLowerCase();
  // Checked before the broader "financial" evidence match below: a financial
  // or commercial PROPOSAL (the firm's own priced offer — price schedule,
  // rate card, BoQ) is company-authored content, not a third-party original
  // like a bank statement or audited financial statement. The evidence
  // pattern's bare /financial/ would otherwise match "Financial-Proposal.docx"
  // first and misclassify it as FINANCIAL_EVIDENCE, which forces
  // needsOriginalReplacement/isNarrativeDraft to treat the firm's own price
  // envelope as a document that must be "replaced with the tender-issued
  // original" — and, downstream, the narrative quality gate's
  // FINANCIAL_OFFICIAL branch caps it at a permanent 60/NEEDS_REWRITE with no
  // stated reason, blocking export of an otherwise-clean document.
  // lib/engine/document-type-normalizer.ts already gets this ordering right;
  // this mirrors its FINANCIAL_PROPOSAL_PATTERNS.
  // Real tender/plan file names use hyphens and underscores as word
  // separators ("02-Financial-Proposal.docx"), not spaces, so the separator
  // class below has to accept those too or this never matches real files.
  if (/financial[\s._-]+proposal|commercial[\s._-]+proposal|price[\s._-]+schedule|rate[\s._-]+card|bill[\s._-]+of[\s._-]+quantities?|\bboq\b/.test(label)) return "FINANCIAL_PROPOSAL";
  if (/financial|audited|capacity|bank|turnover/.test(label)) return "FINANCIAL_EVIDENCE";
  if (/legal|eligibility|registration|licen[cs]ing|tax|certificate/.test(label)) return "LEGAL_EVIDENCE";
  if (/submission formatting|packaging rules|submission rules|delivery instruction|submission method|submission deadline/.test(label)) return "SUBMISSION_RULES";
  if (/\bform\b|template/.test(label)) return "FORM_OR_TEMPLATE";
  if (/submission|deadline|delivery|method|rules/.test(label)) return "SUBMISSION_RULES";
  return fallback || "TENDER_REQUIRED_FILE";
}

function needsOriginalReplacement(fileName: string, documentType: string) {
  const label = `${fileName} ${documentType}`.toLowerCase();
  const type = documentType.toUpperCase();
  if (["FINANCIAL_EVIDENCE", "LEGAL_EVIDENCE", "FORM_OR_TEMPLATE", "BID_FORM", "TENDER_FORM"].includes(type)) return true;
  return /\bform\b|template|annex\s*[a-z0-9]+\s*\(?official\)?|audited|financial\s+statement|tax\s+clearance|business\s+licen|trade\s+licen|registration\s+cert|tin\s+cert|vat\s+cert/i.test(label);
}

function isNarrativeDraft(fileName: string, documentType: string) {
  const label = `${fileName} ${documentType}`.toLowerCase();
  if (needsOriginalReplacement(fileName, documentType)) return false;
  if (/submission formatting|packaging rules|submission rules|delivery instruction|submission method|submission deadline/.test(label)) return false;
  // Company-produced narrative deliverables. The app already treats these as
  // documents it can write from vault evidence — COMPANY_PRODUCED_KINDS in the
  // generate route lists company profile, methodology, project references and
  // sector/technical scope — but this predicate did not, so a planned
  // "02-Company-Profile.docx" or "03-Capability-Statement.docx" fell through to
  // replacementControlContent and was packaged as a ~58-word "generated support
  // control" stub telling the operator to replace it, even though the vault
  // holds exactly the material those files need.
  return /technical|methodology|approach|work\s*plan|strategic|proposal|narrative|scope|requirement|company\s*[-_]?\s*profile|capability\s*[-_]?\s*statement|expression[-\s_]*of[-\s_]*interest|\beoi\b|experience|track\s*record|project\s*[-_]?\s*reference/.test(label);
}

/**
 * A cover/transmittal letter is a distinct genre from the generic
 * requirements-list narrative draft below: an evaluator expects a dated,
 * addressed business letter with a subject line, a salutation, and a
 * signed close — not a bulleted restatement of the tender's own requirements.
 * isNarrativeDraft still recognizes it as company-authored content (a bare
 * documentType of "TECHNICAL" matches its own "technical" pattern), so this
 * only needs to select the letter template within that branch.
 */
function isCoverLetter(fileName: string, documentType: string) {
  const label = `${fileName} ${documentType}`.toLowerCase();
  return /cover\s*[-_]?\s*letter|transmittal\s*letter|letter\s+of\s+transmittal/.test(label);
}

function matchingRequirements(fileName: string, requirements: RequirementLike[]) {
  const labelWords = new Set(
    fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length >= 4),
  );
  const scored = requirements
    .map((requirement) => {
      const text = `${requirement.title} ${requirement.description ?? ""} ${requirement.requirementType ?? ""}`.toLowerCase();
      const score = Array.from(labelWords).reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0)
        + ((requirement.priority ?? "").toUpperCase() === "MANDATORY" ? 1 : 0);
      return { requirement, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 8).map((entry) => entry.requirement);
  return picked.length > 0
    ? picked
    : requirements.filter((requirement) => (requirement.priority ?? "").toUpperCase() === "MANDATORY").slice(0, 8);
}

async function replacementControlContent(tenderTitle: string, fileName: string, replaceWithOriginal: boolean) {
  const children: Paragraph[] = [
    para(fileName, true),
    para(`Tender: ${tenderTitle}`),
    heading(replaceWithOriginal ? "Replacement control" : "Generated support control"),
  ];
  if (replaceWithOriginal) {
    children.push(
      bullet("Do not submit this generated control document as the final tender attachment."),
      bullet("Replace this record with the tender-issued original, signed/stamped/certified document, or verified source evidence before final export."),
      bullet("Keep the exact tender-required file name and order when replacing the file."),
    );
  } else {
    children.push(
      bullet("This package item was created from the tender submission plan so the missing file is visible in the generated document register."),
      bullet("Review and replace or complete this support document before final export if the tender requires a prescribed original/template."),
    );
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

/**
 * Source-verified company evidence for a document this function is about to
 * write, or an empty set when the vault holds none it may quote.
 *
 * The same guard the generate route uses — canUseVaultRecord(..., "GENERATION")
 * rather than a raw trustLevel check — so a stale or never-provenance-backed
 * record cannot be quoted as evidence in a submittable document, and a
 * soft-deleted one never surfaces at all.
 */
async function companyEvidenceFor(
  prisma: PrismaClient,
  tenderId: string,
): Promise<{ experts: string[]; projects: string[] }> {
  try {
    const tender = await prisma.tender.findUnique({
      where: { id: tenderId },
      select: {
        expertMatches: {
          where: { isSelected: true },
          include: { expert: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT, profile: true, deletedAt: true } } },
          orderBy: { score: "desc" },
        },
        projectMatches: {
          where: { isSelected: true },
          include: { project: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT, summary: true, deletedAt: true } } },
          orderBy: { score: "desc" },
        },
      },
    });
    if (!tender) return { experts: [], projects: [] };
    const experts = tender.expertMatches
      .filter((m) => m.expert && !m.expert.deletedAt && canUseVaultRecord(m.expert, "GENERATION"))
      .map((m) => `${m.expert!.fullName}${m.expert!.title ? ` — ${m.expert!.title}` : ""}${m.expert!.yearsExperience ? ` | ${m.expert!.yearsExperience}+ years` : ""}`);
    const projects = tender.projectMatches
      .filter((m) => m.project && !m.project.deletedAt && canUseVaultRecord(m.project, "GENERATION"))
      .map((m) => `${m.project!.name}${m.project!.clientName ? ` — ${m.project!.clientName}` : ""}${m.project!.country ? ` | ${m.project!.country}` : ""}`);
    return { experts, projects };
  } catch {
    // Evidence is additive here. A failure to read it must not stop the
    // automatic chain from producing the file the confirmed plan requires.
    return { experts: [], projects: [] };
  }
}

/**
 * A company-produced narrative file for the confirmed plan.
 *
 * This document ships. It used to carry an internal worksheet — "Draft
 * technical response … Proposed response structure … Reviewer completion
 * checklist … Replace this draft with the final generated narrative or
 * complete the draft manually before marking READY_FOR_EXPORT" — and on the
 * automatic path that text reached the procuring entity inside the Final ZIP,
 * proven by driving Run AI Analyze and Run Engine and downloading what came
 * out.
 *
 * The generate route already had this fixed for the path an owner clicks
 * through: it materialises the planned rows so they are written from vault
 * evidence, and its own comment calls the worksheet "worse than nothing". The
 * automatic chain calls this module directly and never reaches that code, so
 * the fix existed on one path and not on the one the owner contract makes
 * normal.
 *
 * Instructions addressed to the bid team or a reviewer are removed rather than
 * reworded: there is no version of "replace this draft" that belongs in a
 * document an evaluator opens. What remains is the tender's own requirements
 * and the company's own source-verified evidence — real content, or an honest
 * statement that a section has none yet.
 */
/**
 * Real business-letter body for a cover/transmittal letter — dated, addressed
 * to the tender's own client name, with a subject line naming the tender, a
 * salutation, evidence-anchored body paragraphs, and a signed close. No
 * signatory name is invented: the tender's own contact person is used only
 * when the source itself named one, otherwise the close names the role
 * ("Authorized Representative") the same way buildDeclaration in
 * benchmark-tables.ts signs without a confirmed name.
 */
function coverLetterContent(opts: {
  tenderTitle: string;
  clientName: string | null;
  companyName: string;
  reference: string | null;
  requirements: RequirementLike[];
  evidence: { experts: string[]; projects: string[] };
}): Paragraph[] {
  const client = clean(opts.clientName || "the Procuring Entity");
  const dateLine = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const subject = `Submission of Technical Proposal — ${clean(opts.tenderTitle)}${opts.reference ? ` (Ref: ${clean(opts.reference)})` : ""}`;

  const requirementTitles = opts.requirements.slice(0, 5).map((r) => clean(r.title)).filter(Boolean);
  const openingClause = requirementTitles.length > 0
    ? `in response to the requirements set out in the tender, including ${requirementTitles.slice(0, 3).join("; ")}`
    : "in response to the request for proposal issued for this assignment";

  const evidenceClause = opts.evidence.projects.length > 0
    ? `Our submission is supported by directly comparable project delivery experience, including ${opts.evidence.projects.slice(0, 2).join(" and ")}.`
    : null;
  const teamClause = opts.evidence.experts.length > 0
    ? `The proposed team is led by reviewed, source-verified specialists, including ${opts.evidence.experts.slice(0, 2).join(" and ")}.`
    : null;

  const bodyParagraphs = [
    `Dear Sir/Madam,`,
    `On behalf of ${opts.companyName}, we are pleased to submit our Technical Proposal for ${clean(opts.tenderTitle)} ${openingClause}.`,
    [evidenceClause, teamClause].filter(Boolean).join(" ") || `${opts.companyName} confirms its technical capacity and availability to deliver the full scope described in the tender.`,
    `This Technical Proposal, together with its supporting annexes, has been prepared strictly in accordance with the tender's stated submission instructions and remains valid for the acceptance period the tender specifies. We confirm our understanding of the scope of services and our commitment to the quality, schedule, and compliance standards required by ${client}.`,
    `Please direct any request for clarification regarding this submission to the contact details provided in the accompanying company documentation. We thank you for the opportunity to be considered for this assignment and look forward to the evaluation outcome.`,
  ];

  return [
    para(dateLine),
    para(""),
    para(client, true),
    para(`Re: ${clean(opts.tenderTitle)}`),
    para(""),
    para(`Subject: ${subject}`, true),
    para(""),
    ...bodyParagraphs.map((text) => para(text)),
    para(""),
    para("Sincerely,"),
    para(""),
    para("Authorized Representative", true),
    para(opts.companyName, true),
  ];
}


function isMethodologyNarrative(fileName: string, documentType: string): boolean {
  const label = `${fileName} ${documentType}`.toLowerCase();
  if (/financial[\s._-]+proposal|commercial[\s._-]+proposal|price[\s._-]+schedule|rate[\s._-]+card|\bboq\b/.test(label)) {
    return false;
  }
  return /methodology|technical[\s._-]+approach|work[\s._-]*plan/.test(label)
    || documentType.toUpperCase() === "METHODOLOGY";
}

/**
 * Build a complete standalone methodology/work-plan document for a confirmed
 * Build Plan item. This is deliberately deterministic and source-bounded: it
 * may organize the tender's extracted requirements and the firm's selected,
 * reviewed evidence, but it does not invent durations, certifications,
 * personnel, project experience, or client facts.
 *
 * The previous fallback used the generic narrative stub for methodology files.
 * That produced only a requirement list plus optional evidence (367 words in a
 * real acceptance run), while the quality gate correctly requires phases,
 * tasks, deliverables, schedule, QA and risk and at least 800 words.
 */
async function methodologyNarrativeContent(
  tenderTitle: string,
  fileName: string,
  requirements: RequirementLike[],
  evidence: { experts: string[]; projects: string[] } = { experts: [], projects: [] },
) {
  const related = matchingRequirements(fileName, requirements);
  const sourceRequirements = (related.length > 0 ? related : requirements).slice(0, 12);

  const children: Paragraph[] = [
    para("Technical Approach and Methodology", true),
    para(`Tender: ${clean(tenderTitle)}`),
    para(`Subject: Technical Approach and Methodology for ${clean(tenderTitle)}`, true),
    para(
      "This methodology translates the tender requirements into a controlled execution process from inception through final handover. The sequence is designed to keep scope, technical decisions, deliverables, schedule, quality assurance, and risk controls connected throughout delivery. Activities are advanced only after the information required for the next stage has been reviewed, and each deliverable is checked against the applicable tender requirement before issue. Where the tender does not prescribe a duration, quantity, format, or acceptance period, this methodology does not invent one; those details remain governed by the tender, the agreed inception programme, and subsequent client instructions."
    ),
    heading("Execution Phases"),
    subheading("Phase 1 — Inception, Mobilization and Requirement Confirmation"),
    para(
      "The assignment begins with a structured inception stage. The team reviews the tender scope, extracted requirements, required outputs, submission conditions, available background information, interfaces, and known constraints. The purpose is to establish one controlled interpretation of the assignment before technical production starts. The team confirms responsibilities, information needs, decision points, document-control rules, review routes, and the sequence in which technical inputs must be developed. Any ambiguity found in the tender is recorded for clarification rather than silently converted into an assumption."
    ),
    para(
      "The inception output is the working basis for delivery: a requirement register, responsibility allocation, information-request list, deliverable register, initial schedule logic, quality checkpoints, and risk register. These controls are maintained during the assignment so that later design or advisory work can be traced back to the requirement that triggered it."
    ),
    subheading("Phase 2 — Data Review, Investigation and Technical Baseline"),
    para(
      "The second phase establishes the technical baseline needed for the assignment. Existing documents and client-supplied information are reviewed for completeness, consistency, relevance, and currency. Where the scope requires field verification, surveys, consultations, investigations, measurements, or discipline inputs, those activities are planned around the tender requirements and coordinated so that one discipline does not proceed on information another discipline has not yet confirmed."
    ),
    para(
      "Findings are recorded in a controlled manner, including source, date, responsible reviewer, implication, and required action. Conflicts between source documents are elevated for resolution. The team separates verified facts from assumptions and avoids treating unconfirmed information as an approved design basis. This phase closes when sufficient information exists to begin the principal technical tasks without creating avoidable rework."
    ),
    subheading("Phase 3 — Technical Development and Coordination"),
    para(
      "Technical development proceeds through coordinated task packages rather than isolated discipline outputs. Each package identifies the requirement being addressed, the input information used, the responsible technical role, interfaces with other tasks, the expected output, and the review required before release. Alternatives are evaluated where the assignment requires options or professional judgement, with the preferred solution supported by the applicable technical criteria and the available project evidence."
    ),
    para(
      "Coordination reviews are used to identify clashes, omissions, duplicated scope, inconsistent assumptions, and downstream impacts before they become final deliverable defects. Comments are logged, assigned, resolved, and closed. A revised output is not treated as final merely because it has been edited; it must pass the defined quality review and remain consistent with the current requirement register."
    ),
    subheading("Phase 4 — Review, Consolidation and Client Interface"),
    para(
      "Draft outputs are consolidated into the format required by the tender and checked as one package. The review confirms that technical content, schedules, calculations or narratives, drawings or schedules where applicable, and supporting evidence tell the same story and do not contradict one another. Client comments and formal review comments are entered into a response register so that every material comment has an owner, action, disposition, and closure record."
    ),
    para(
      "Changes that affect another discipline, deliverable, milestone, or stated requirement are propagated through the package rather than corrected locally. This prevents a late change in one document from leaving stale information elsewhere in the submission or assignment outputs."
    ),
    subheading("Phase 5 — Finalization, Submission and Handover"),
    para(
      "Before final issue, the team performs a completion review against the deliverable register and the tender requirements. File names, formats, required signatures or approvals, cross-references, revision identifiers, and package completeness are checked together with technical content. Only the current approved revision is released. Handover includes the final deliverables required by the tender and the records needed to explain outstanding actions, if any, without presenting internal drafting notes as client-facing content."
    ),
    heading("Tasks and Execution Sequence"),
    para(
      "Tasks are sequenced by dependency. Requirement confirmation and baseline verification precede detailed technical development; discipline outputs that depend on common data use the same controlled baseline; coordination occurs before finalization; and final packaging occurs only after quality comments are closed. This dependency-based sequence is used even when activities overlap, so parallel working does not become uncontrolled working."
    ),
  ];

  if (sourceRequirements.length > 0) {
    children.push(subheading("Tender Requirements Addressed by the Tasks"));
    for (const requirement of sourceRequirements) {
      const description = requirement.description ? ` — ${clean(requirement.description).slice(0, 500)}` : "";
      children.push(bullet(`${clean(requirement.title)}${description}`));
    }
  } else {
    children.push(para(
      "No separate requirement rows are available in the current tender record. The task sequence therefore remains bounded by the confirmed Build Plan and the tender source; no additional scope is asserted in this document."
    ));
  }

  children.push(
    heading("Deliverables and Acceptance"),
    para(
      "Deliverables are controlled through a deliverable register that records the required output, source requirement, responsible preparer, reviewer, planned issue point, current revision, and acceptance status. A deliverable is considered complete only when its required content is present, its internal review is closed, its interfaces are coordinated, and its format is consistent with the tender instruction. Draft, review, and final states are kept distinct so that an intermediate document cannot be mistaken for an approved submission."
    ),
    para(
      "Where several outputs form one package, package-level consistency is checked in addition to document-level quality. Titles, terminology, project identifiers, client identifiers, dates, quantities, and references are reconciled across the package. If the tender calls for a prescribed original or form, the prescribed original remains authoritative and is not replaced by a generated approximation."
    ),
    heading("Schedule and Milestones"),
    para(
      "The schedule is developed from the dependency logic of the phases and from any dates or durations explicitly stated in the tender. Milestones are tied to measurable outputs: inception completion, baseline confirmation, technical review points, coordinated draft issue, comment closure, final quality review, and final submission or handover. Where the tender does not state a duration, this document does not fabricate calendar dates; the detailed programme is established at inception using the contractual time available and the confirmed information-release dates."
    ),
    para(
      "Progress control compares actual completion against the current approved programme, focusing on activities that govern downstream work. A delay is assessed by its effect on dependent tasks and deliverables, not only by percentage complete. Recovery actions may include resequencing independent work, resolving information constraints earlier, increasing review concurrency where technically safe, or escalating decisions that are holding the critical sequence. Any recovery measure remains subject to the same quality and coordination controls."
    ),
    heading("Quality Assurance (QA) and Quality Control"),
    para(
      "Quality assurance is embedded in the workflow rather than added at the end. Each technical output has a preparer and an independent reviewer appropriate to the task. Review checks address requirement compliance, technical correctness, completeness, internal consistency, interfaces, source traceability, calculations or assumptions where applicable, and presentation. Review comments are recorded and closed before an output advances to final status."
    ),
    para(
      "Quality control also applies to document production. The current revision is identified, obsolete working copies are prevented from entering the final package, and client-facing documents are checked for placeholders, drafting instructions, unsupported claims, inconsistent metadata, and accidental financial content in a technical envelope. Where evidence is cited, only selected source-verified company evidence is used. The final review is therefore both technical and submission-focused."
    ),
    heading("Risk Management"),
    para(
      "Risks are identified from the tender requirements, information dependencies, technical interfaces, approvals, site or stakeholder constraints where applicable, and delivery sequence. Each material risk is recorded with cause, potential effect, owner, mitigation action, trigger for escalation, and status. The register is reviewed at the main phase transitions and whenever a new issue could affect scope, quality, schedule, or deliverable acceptance."
    ),
    para(
      "Typical controls include early clarification of ambiguous requirements, validation of critical source information before dependent work proceeds, interface reviews between disciplines, protected review time before issue, controlled change management, and early escalation of decisions that affect multiple outputs. Risk treatment does not rely on optimistic assumptions: an uncertainty remains visible until evidence or an authorized decision closes it."
    ),
    heading("Team, Evidence and Responsibility"),
    para(
      "Responsibility follows the approved task allocation: the person preparing an output remains accountable for its technical completeness, while the designated reviewer is accountable for an independent check before release. Coordination responsibilities are explicit for tasks that cross disciplines or deliverables. This prevents gaps created by assuming that another team member has checked an interface."
    ),
  );

  if (evidence.experts.length > 0) {
    children.push(subheading("Selected Personnel Evidence"));
    for (const expert of evidence.experts.slice(0, 12)) children.push(bullet(expert));
  }
  if (evidence.projects.length > 0) {
    children.push(subheading("Selected Project Evidence"));
    for (const project of evidence.projects.slice(0, 12)) children.push(bullet(project));
  }
  if (evidence.experts.length === 0 && evidence.projects.length === 0) {
    children.push(para(
      "No source-verified personnel or project records are linked to this standalone methodology file at generation time. This methodology therefore makes no named personnel or past-project claims beyond the tender-controlled execution process described above."
    ));
  }

  children.push(
    heading("Methodology Control Summary"),
    para(
      `The methodology for ${clean(tenderTitle)} is therefore controlled through six connected elements: execution phases, dependency-based tasks, a deliverable and acceptance register, a milestone schedule, formal QA/QC, and an active risk register. These controls are maintained together so that progress cannot be reported as complete while required outputs, quality reviews, or unresolved risks remain open.`
    ),
  );

  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

async function narrativeDraftContent(
  tenderTitle: string,
  fileName: string,
  documentType: string,
  requirements: RequirementLike[],
  evidence: { experts: string[]; projects: string[] } = { experts: [], projects: [] },
  letterContext?: { clientName: string | null; companyName: string; reference: string | null },
) {
  if (letterContext && isCoverLetter(fileName, documentType)) {
    const buffer = await Packer.toBuffer(new Document({
      sections: [{ properties: {}, children: coverLetterContent({ tenderTitle, requirements, evidence, ...letterContext }) }],
    }));
    return buffer.toString("base64");
  }

  if (isMethodologyNarrative(fileName, documentType)) {
    return methodologyNarrativeContent(tenderTitle, fileName, requirements, evidence);
  }

  // A financial/commercial proposal must not carry "methodology"/"work plan"/
  // "technical approach" language — the same envelope-separation rule that
  // keeps pricing out of a technical document (see pricing-hygiene.ts and
  // document-quality-validator.ts's TECHNICAL_IN_FINANCIAL_RE check) applies
  // in reverse. Before the financial/commercial-proposal filename fix above,
  // a file like "02-Financial-Proposal.docx" was always misclassified as
  // FINANCIAL_EVIDENCE and never reached this branch at all, so none of this
  // was ever exercised for a financial envelope.
  const isFinancialProposal = /^FINANCIAL_PROPOSAL$/i.test(documentType) || /financial[\s._-]+proposal|commercial[\s._-]+proposal/i.test(fileName);

  // matchingRequirements() scores on shared generic words with the filename
  // ("proposal" is common to both "Financial Proposal" and "Technical
  // Proposal" requirement text), with no awareness of which submission
  // envelope a requirement belongs to. For a financial proposal that pulled
  // in unrelated technical requirements verbatim — "Technical approach and
  // methodology...", "Work plan, staffing schedule..." — and quoting them
  // into the "Tender requirements addressed" section reintroduced the exact
  // technical-envelope language the financial template below is written to
  // avoid, failing export with "Technical methodology content detected in a
  // FINANCIAL document" even after the template itself was fixed.
  const related = matchingRequirements(fileName, requirements)
    .filter((requirement) => !isFinancialProposal || !TECHNICAL_IN_FINANCIAL_RE.test(`${requirement.title} ${requirement.description ?? ""}`));

  const children: Paragraph[] = [
    para(fileName, true),
    para(`Tender: ${tenderTitle}`),
    subheading("Tender requirements addressed"),
  ];
  if (related.length === 0) {
    children.push(para("No requirement from the tender source is currently linked to this file."));
  } else {
    for (const requirement of related) {
      children.push(bullet(`${requirement.title}${requirement.description ? ` — ${requirement.description}` : ""}`.slice(0, 700)));
    }
  }
  if (evidence.experts.length > 0) {
    children.push(subheading("Key personnel"));
    for (const expert of evidence.experts.slice(0, 20)) children.push(bullet(expert));
  }
  if (evidence.projects.length > 0) {
    children.push(subheading("Relevant project experience"));
    for (const project of evidence.projects.slice(0, 20)) children.push(bullet(project));
  }
  if (evidence.experts.length === 0 && evidence.projects.length === 0) {
    children.push(para("No source-verified personnel or project evidence has been linked to this tender yet."));
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

/**
 * The format a still-planned row should declare.
 *
 * A planned row's identity is its required file name — that is what the tender
 * asked for and what finalization must produce. Declaring the format of the
 * interim body instead makes the row contradict itself while it is still empty.
 */
export function plannedRowFormat(fileName: string, contentFormat: string): string {
  if (contentFormat === "CONTROL") return contentFormat;
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (extension === "pdf") return "PDF";
  if (extension === "docx") return "DOCX";
  return contentFormat;
}

async function buildPlannedRowContent(args: {
  tenderTitle: string;
  fileName: string;
  documentType: string;
  requirements: RequirementLike[];
  evidence?: { experts: string[]; projects: string[] };
  letterContext?: { clientName: string | null; companyName: string; reference: string | null };
}) {
  const replaceWithOriginal = needsOriginalReplacement(args.fileName, args.documentType);
  const isSubmissionRules = args.documentType === "SUBMISSION_RULES"
    || /submission formatting|packaging rules|submission rules|delivery instruction/i.test(args.fileName);
  if (isNarrativeDraft(args.fileName, args.documentType)) {
    return {
      fileContent: await narrativeDraftContent(args.tenderTitle, args.fileName, args.documentType, args.requirements, args.evidence, args.letterContext),
      format: "DOCX",
      validationStatus: "NEEDS_REVALIDATION",
      reviewStatus: "NEEDS_REVIEW",
      contentSummary: `Generated narrative draft for tender-required file ${args.fileName}. Reviewer must validate and approve before export.`,
    };
  }
  return {
    fileContent: await replacementControlContent(args.tenderTitle, args.fileName, replaceWithOriginal),
    format: replaceWithOriginal || isSubmissionRules ? "CONTROL" : "DOCX",
    validationStatus: "PENDING",
    reviewStatus: replaceWithOriginal ? "REPLACE_WITH_ORIGINAL" : "PENDING",
    contentSummary: replaceWithOriginal
      ? `Replacement-control record for tender-required file ${args.fileName}. This internal control record is intentionally non-final and must be replaced with the original before export.`
      : `Generated support-control record for tender-required file ${args.fileName}. Review before final export.`,
  };
}

function planFingerprint(items: Array<Record<string, unknown>>) {
  return JSON.stringify(
    items
      .map((item) => ({
        exactFileName: String(item.exactFileName ?? ""),
        documentType: String(item.documentType ?? ""),
        exactOrder: Number(item.exactOrder ?? 0),
        required: Boolean(item.required ?? true),
      }))
      .sort((left, right) => left.exactOrder - right.exactOrder || left.exactFileName.localeCompare(right.exactFileName)),
  );
}
/**
 * Generate every planned file the confirmed Build Plan requires that the
 * package does not yet contain, and fill in rows still sitting at PLANNED.
 *
 * Returns a structured result rather than an HTTP response so the API route and
 * the auto-finalize continuation worker share one implementation and one set of
 * gates. `status` carries the HTTP status the route should use.
 */
export async function generateMissingPlanFiles(args: {
  prisma: PrismaClient;
  tenderId: string;
  userId: string;
  /** Label recorded in the audit entry — an email for a user action, a marker for automation. */
  actorLabel: string;
  requestId?: string;
}): Promise<MissingPlanFileGenerationResult> {
  const { prisma, tenderId, userId, actorLabel, requestId } = args;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true, generationStatus: true },
      },
    },
  });
  if (!tender) return {
      ok: false, status: 404,
      code: "TENDER_NOT_FOUND",
      error: "Tender not found",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };

  const analysisStatus = tender.analysisExtractionStatus;
  if (analysisStatus === "OCR_REQUIRED") {
    return {
      ok: false, status: 422,
      code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      error: "AI analysis was skipped due to corrupted extraction; re-run AI Analyze before generating plan files.",
      nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }
  if (analysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" || analysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    return {
      ok: false, status: 422,
      code: "ANALYSIS_FROM_WEAK_EXTRACTION",
      error: "AI analysis was produced from weak extraction; re-run AI Analyze before generating plan files.",
      nextAction: "RERUN_AI_ANALYZE",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }
  if (analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    return {
      ok: false, status: 422,
      code: "ANALYSIS_FROM_PARTIAL_EXTRACTION",
      error: "AI analysis ran on partial extraction; re-extract and re-run AI Analyze before generating plan files.",
      nextAction: "RERUN_AI_ANALYZE",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }
  if (!(tender.clientName || tender.procuringEntityName)) {
    return {
      ok: false, status: 422,
      code: "MISSING_CLIENT_DETAILS",
      error: "Document generation requires a client or procuring entity name. Run AI Analyze or enter the client name first.",
      nextAction: "EDIT_TENDER_METADATA",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const centralGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId: userId,
    purpose: "generate-missing-plan-files",
  });
  if (!centralGate.ok) {
    return {
      ok: false, status: 422,
      code: centralGate.blockerCode,
      error: centralGate.blockerDetail,
      nextAction: "Resolve the analysis readiness blocker before generating missing plan files.",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
  if (!confirmedPlan.ok) {
    return {
      ok: false, status: 422,
      code: "BUILD_PLAN_NOT_SOURCE_VERIFIED",
      error: `Automatic document generation is waiting for a current source-verified Build Plan: ${confirmedPlan.blocker}`,
      nextAction: "RUN_ENGINE",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const operationGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionEmails: tender.submissionEmails,
      submissionAddress: tender.submissionAddress,
      country: tender.country,
      metadataContaminated: tender.metadataContaminated,
      analysisExtractionStatus: tender.analysisExtractionStatus,
    },
    requirements: tender.requirements.map((requirement: any) => ({
      priority: requirement.priority,
      sourceTenderFileId: requirement.sourceTenderFileId,
    })),
    overrides: [],
    buildPlan: { ok: confirmedPlan.ok, items: confirmedPlan.items },
    operation: "SUPPORT_PACKAGE_GENERATION",
  });
  if (operationGate.warnings.length > 0) {
    logger.info(`[generate-missing-plan-files] tender=${tenderId} operation-gate warnings: ${operationGate.warnings.join("; ")}`);
  }
  if (operationGate.blockers.length > 0) {
    return {
      ok: false, status: 422,
      code: "OPERATION_GATE_BLOCKED",
      error: `Missing-plan generation blocked by operation gate (SUPPORT_PACKAGE_GENERATION): ${operationGate.blockers.join("; ")}`,
      nextAction: "RESOLVE_OPERATION_GATE_BLOCKERS",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const missing = findMissingGeneratedDocuments({ files: confirmedPlan.items }, tender.generatedDocuments);
  const plannedRows = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: "PLANNED" },
    select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true },
  });

  if (missing.length === 0 && plannedRows.length === 0) {
    await logAction({
      userId: userId,
      action: "DOCUMENT_GENERATE",
      entityType: "Tender",
      entityId: tenderId,
      description: `${actorLabel} checked missing planned files for "${tender.title}"; none were missing.`,
      metadata: { tenderId, created: 0, updated: 0, convertedFromPlanned: 0 },
      requestId,
    });
    return {
      ok: true, status: 200,
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [],
      nothingMissing: true,
    };
  }

  const preparedMissing: PreparedDocument[] = [];
  const skipped: string[] = [];
  // Read once for every file this run writes: a company-produced narrative
  // carries the firm's own source-verified personnel and project evidence,
  // which is the material those files exist to present.
  const evidence = await companyEvidenceFor(prisma, tenderId);
  // Read once for a cover/transmittal letter: the letter template needs the
  // tender's own client name and the submitting firm's name, neither of which
  // the generic narrative draft above required.
  const company = await prisma.company.findUnique({ where: { userId: tender.userId }, select: { name: true, legalName: true } }).catch(() => null);
  const letterContext = {
    clientName: cleanClientName(tender.clientName || tender.procuringEntityName, tender.description),
    companyName: company?.legalName || company?.name || "The Firm",
    reference: tender.reference ?? null,
  };
  for (const file of missing) {
    const documentType = documentTypeFor(file.exactFileName, file.documentType);
    const generated = await buildPlannedRowContent({
      tenderTitle: tender.title,
      fileName: file.exactFileName,
      documentType,
      requirements: tender.requirements,
      evidence,
      letterContext,
    });
    // A file the app must not invent — a priced financial proposal, a
    // tender-issued form — still needs a row, as PLANNED awaiting its official
    // original.
    //
    // This used to `continue`, creating nothing. The export gate then required
    // the file, generation reported it "skipped", and POST
    // .../documents/{id}/attach-original had no {id} to address because no row
    // existed: the owner was required to supply a document with nowhere to put
    // it. The already-PLANNED branch below has always handled this correctly
    // with keepPlanned; the missing-file branch simply did not, so whether the
    // tender could be finished depended on whether a row happened to exist
    // already.
    const requiresOriginal = generated.format !== "DOCX" || !file.exactFileName.toLowerCase().endsWith(".docx");
    preparedMissing.push({
      keepPlanned: requiresOriginal,
      fileName: file.exactFileName,
      documentType,
      exactOrder: file.exactOrder,
      ...generated,
    });
  }

  const preparedPlanned: PreparedDocument[] = [];
  for (const row of plannedRows) {
    const fileName = row.exactFileName ?? row.name ?? "Unnamed document";
    const documentType = documentTypeFor(fileName, row.documentType ?? "");
    const generated = await buildPlannedRowContent({
      tenderTitle: tender.title,
      fileName,
      documentType,
      requirements: tender.requirements,
      evidence,
      letterContext,
    });
    preparedPlanned.push({
      fileName,
      documentType,
      exactOrder: row.exactOrder,
      plannedRowId: row.id,
      keepPlanned: generated.format !== "DOCX" || !fileName.toLowerCase().endsWith(".docx"),
      ...generated,
    });
  }

  const expectedPlanFingerprint = planFingerprint(confirmedPlan.items as Array<Record<string, unknown>>);
  const created: string[] = [];
  const updated: string[] = [];
  const convertedFromPlanned: string[] = [];
  // Rows created as PLANNED because the file must be an official original.
  // Reported separately so "created" keeps meaning "produced bytes".
  const plannedCreated: string[] = [];

  const persistBatch = async () => {
    await prisma.$transaction(async (tx) => {
      await withTransactionalGenerationGate({
        prisma,
        tx,
        tenderId,
        userId: userId,
        purpose: "generate-missing-plan-files",
        write: async (lockedTx) => {
          const currentPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
          if (!currentPlan.ok || planFingerprint(currentPlan.items as Array<Record<string, unknown>>) !== expectedPlanFingerprint) {
            throw new GenerationPersistenceBlockedError("BUILD_PLAN_CHANGED_BEFORE_PERSISTENCE");
          }

          for (const document of preparedMissing) {
            const existing = await lockedTx.generatedDocument.findFirst({
              where: {
                tenderId,
                exactFileName: { equals: document.fileName, mode: "insensitive" },
                generationStatus: { not: "SUPERSEDED" },
              },
              orderBy: { updatedAt: "desc" },
              select: { id: true, generationStatus: true, reviewStatus: true, contentSummary: true },
            });
            // SELF-HEALING, NOT BLIND SKIPPING.
            //
            // Skipping every existing non-PLANNED row meant an artifact written
            // by an early generator stayed exactly as written, for ever. A
            // 367-word methodology stub kept failing the quality gate and kept
            // blocking the ZIP through the very run that shipped the repaired
            // generator. See ./generated-artifact-staleness for the contract.
            let regenerateExisting = false;
            if (existing && existing.generationStatus !== "PLANNED") {
              const decision = decideExistingArtifactRegeneration({
                generationStatus: existing.generationStatus,
                reviewStatus: existing.reviewStatus,
                contentSummary: existing.contentSummary,
              });
              if (!decision.regenerate) {
                skipped.push(`${document.fileName} (${decision.reason})`);
                continue;
              }
              regenerateExisting = true;
              logger.info(
                `[missing-plan-file-generation] regenerating ${document.fileName}: ${decision.reason}`,
              );
            }

            // Mirrors the already-PLANNED branch below: no bytes, integrity
            // explicitly unknown, and a failure code naming what is awaited, so
            // this row can never be mistaken for a finished document.
            const data = document.keepPlanned
              ? {
                name: document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
                documentType: document.documentType,
                // Declare the format the planned FILE NAME promises, not the
                // format of the body that could not be produced for it. A
                // planned "Technical Proposal.pdf" was written with format
                // DOCX, so the row contradicted itself before it held a single
                // byte, and every surface that compares name against declared
                // format reported an artifact-identity mismatch for a file that
                // did not exist yet.
                format: plannedRowFormat(document.fileName, document.format),
                exactFileName: document.fileName,
                exactOrder: document.exactOrder,
                fileContent: null,
                generationStatus: "PLANNED",
                validationStatus: "PENDING",
                reviewStatus: document.reviewStatus,
                reviewedBy: null,
                reviewedAt: null,
                // Record the generator contract this artifact was written to, so a
                // later run can tell a current artifact from one written to a
                // superseded contract -- and so THIS artifact is skipped next time.
                contentSummary: withContractMarker(
                  regenerateExisting
                    ? `${document.contentSummary} Regenerated in place: the stored artifact was written to a superseded generator contract.`
                    : document.contentSummary,
                ),
                integrityStatus: "UNKNOWN",
                integrityVerifiedAt: null,
                integrityFailureCode: "REQUIRES_ORIGINAL_OR_FORMAT_FINALIZATION",
                updatedAt: new Date(),
              }
              : {
                name: document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
                documentType: document.documentType,
                format: document.format,
                exactFileName: document.fileName,
                exactOrder: document.exactOrder,
                fileContent: document.fileContent,
                ...verifiedIntegrityDataFromBase64({
                  fileContent: document.fileContent,
                  filename: document.fileName,
                  claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                }),
                generationStatus: "GENERATED",
                validationStatus: document.validationStatus,
                reviewStatus: document.reviewStatus,
                reviewedBy: null,
                reviewedAt: null,
                // Record the generator contract this artifact was written to, so a
                // later run can tell a current artifact from one written to a
                // superseded contract -- and so THIS artifact is skipped next time.
                contentSummary: withContractMarker(
                  regenerateExisting
                    ? `${document.contentSummary} Regenerated in place: the stored artifact was written to a superseded generator contract.`
                    : document.contentSummary,
                ),
                updatedAt: new Date(),
              };
            if (existing) {
              await lockedTx.generatedDocument.update({ where: { id: existing.id }, data });
              if (document.keepPlanned) plannedCreated.push(document.fileName);
              else updated.push(document.fileName);
            } else {
              await lockedTx.generatedDocument.create({ data: { tenderId, ...data } });
              if (document.keepPlanned) plannedCreated.push(document.fileName);
              else created.push(document.fileName);
            }
          }

          for (const document of preparedPlanned) {
            const row = await lockedTx.generatedDocument.findFirst({
              where: { id: document.plannedRowId, tenderId, generationStatus: "PLANNED" },
              select: { id: true, name: true, exactFileName: true },
            });
            if (!row) continue;

            if (document.keepPlanned) {
              await lockedTx.generatedDocument.update({
                where: { id: row.id },
                data: {
                  generationStatus: "PLANNED",
                  validationStatus: "PENDING",
                  reviewStatus: document.reviewStatus,
                  reviewedBy: null,
                  reviewedAt: null,
                  fileContent: null,
                  contentSummary: document.contentSummary,
                  integrityStatus: "UNKNOWN",
                  integrityVerifiedAt: null,
                  integrityFailureCode: "REQUIRES_ORIGINAL_OR_FORMAT_FINALIZATION",
                  updatedAt: new Date(),
                },
              });
              skipped.push(`${document.fileName} (kept PLANNED; requires original or format-specific finalization)`);
              continue;
            }

            const integrity = verifiedIntegrityDataFromBase64({
              fileContent: document.fileContent,
              filename: document.fileName,
              claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
            await lockedTx.generatedDocument.update({
              where: { id: row.id },
              data: {
                name: row.name ?? document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
                exactFileName: row.exactFileName ?? document.fileName,
                documentType: document.documentType,
                format: document.format,
                fileContent: document.fileContent,
                ...integrity,
                generationStatus: "GENERATED",
                validationStatus: document.validationStatus,
                reviewStatus: document.reviewStatus,
                reviewedBy: null,
                reviewedAt: null,
                contentSummary: document.contentSummary,
                updatedAt: new Date(),
              },
            });
            convertedFromPlanned.push(document.fileName);
          }
        },
      });
    });
  };

  try {
    try {
      await persistBatch();
    } catch (createErr) {
      if ((createErr as { code?: string })?.code === "P2002") {
        // Converge by retrying the entire atomic batch after the competing
        // creator commits. The first transaction rolled back completely.
        const activeWinners = await prisma.generatedDocument.findMany({
          where: {
            tenderId,
            generationStatus: { not: "SUPERSEDED" },
            exactFileName: { in: preparedMissing.map((document) => document.fileName) },
          },
          select: { id: true },
        });
        if (activeWinners.length === 0) {
          throw new Error("P2002 convergence failed: winner deleted");
        }
        created.length = 0;
        updated.length = 0;
        convertedFromPlanned.length = 0;
        await persistBatch();
      } else {
        throw createErr;
      }
    }
  } catch (error) {
    if (error instanceof GenerationPersistenceBlockedError) {
      return {
        ok: false, status: 409,
        code: error.code,
        error: "Missing-plan generation readiness changed before persistence. No batch document writes were committed.",
        nextAction: "The durable worker will retry from current canonical state; intervene only if a specific fail-closed blocker appears.",
        created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
      };
    }
    throw error;
  }

  await logAction({
    userId: userId,
    action: "DOCUMENT_GENERATE",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actorLabel} generated ${created.length} and updated ${updated.length} missing planned file record(s), converted ${convertedFromPlanned.length} PLANNED rows, skipped ${skipped.length} duplicates, for "${tender.title}".`,
    metadata: {
      tenderId,
      createdCount: created.length,
      updatedCount: updated.length,
      created,
      updated,
      convertedFromPlanned,
      skipped,
      warning: "Narrative drafts and replacement controls are not final until validated and approved.",
    },
    requestId,
  });

  // A run that changed nothing is not a success.
  //
  // This response used to be unconditionally {success: true, created: 0,
  // updated: 0}, and the button rendered it as "0 missing planned file records
  // created/updated" — a cheerful message describing a complete no-op, with no
  // reason and nothing different to try. Clicking again produced the same
  // thing. When there were targets and none of them moved, say so and name the
  // reason for each, so the next step is a fact rather than another click.
  // Planning a row for a file that must arrive as an official original IS
  // progress: it is what gives the owner somewhere to upload it. Counting it
  // as "nothing changed" would fail the call that just created the only route
  // forward.
  const changedCount = created.length + updated.length + convertedFromPlanned.length + plannedCreated.length;
  if (changedCount === 0) {
    return {
      ok: false, status: 422,
      code: "NO_PLANNED_FILE_COULD_BE_GENERATED",
      error: skipped.length > 0
        ? `No planned file could be generated. ${skipped.length} target(s) were skipped, each for the reason listed.`
        : "No planned file could be generated, and no target reported a reason. Re-run the Engine to rebuild the submission plan.",
      nextAction: skipped.length > 0 ? "REVIEW_SKIPPED_TARGETS" : "RUN_ENGINE",
      created, updated, convertedFromPlanned, plannedCreated, skipped,
      nothingMissing: false,
    };
  }

  return {
    ok: true, status: 200,
    created, updated, convertedFromPlanned, plannedCreated, skipped,
    nothingMissing: false,
  };
}

export const __testing__ = {
  documentTypeFor,
  needsOriginalReplacement,
  isNarrativeDraft,
  narrativeDraftContent,
  isMethodologyNarrative,
  methodologyNarrativeContent,
};
