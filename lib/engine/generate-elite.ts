import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";
import { isAIEnabled, generateBenchmarkProposalWithAI } from "../ai";
import { exactSelectionLimit } from "./scope-policy";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";

function p(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold })], spacing: { after: 100 } });
}
function h1(text: string): Paragraph { return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }); }
function h2(text: string): Paragraph { return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 80 } }); }
function bullet(text: string): Paragraph { return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } }); }
function lv(label: string, value?: string | null): Paragraph | null { return value ? p(`${label}: ${value}`) : null; }
function clean(text?: string | null): string { return (text ?? "").replace(/\s+/g, " ").trim(); }
function firstSentence(text?: string | null): string { const c = clean(text); return c.split(/(?<=[.!?])\s+/)[0]?.slice(0, 420) || ""; }

function money(value?: number | null, currency?: string | null): string | null {
  if (!value) return null;
  const label = currency || "ETB";
  if (value >= 1_000_000_000) return `${label} ${(value / 1_000_000_000).toFixed(1)} billion`;
  if (value >= 1_000_000) return `${label} ${(value / 1_000_000).toFixed(1)} million`;
  return `${label} ${value.toLocaleString()}`;
}

function findHealthcareProjectCount(projects: Array<{ name: string; sector?: string | null; summary?: string | null }>): number {
  return projects.filter((project) => /hospital|health|medical|clinic|pharmacy|laboratory|radiology/i.test(`${project.name} ${project.sector ?? ""} ${project.summary ?? ""}`)).length;
}

function markdownToParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const rawLine of markdown.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^###\s+/.test(line)) paragraphs.push(h2(line.replace(/^###\s+/, "")));
    else if (/^##\s+/.test(line)) paragraphs.push(h1(line.replace(/^##\s+/, "")));
    else if (/^#\s+/.test(line)) paragraphs.push(h1(line.replace(/^#\s+/, "")));
    else if (/^[-*•]\s+/.test(line)) paragraphs.push(bullet(line.replace(/^[-*•]\s+/, "")));
    else if (/^\d+[.)]\s+/.test(line)) paragraphs.push(bullet(line.replace(/^\d+[.)]\s+/, "")));
    else paragraphs.push(p(line.replace(/\*\*/g, "")));
  }
  return paragraphs.length > 0 ? paragraphs : [p("AI proposal generation returned no usable content.")];
}

function proposalStrengthNarrative(params: { expertRequired: number; expertSelected: number; projectRequired: number; projectSelected: number; }): Paragraph[] {
  const out: Paragraph[] = [h2("Bid Compliance Strategy and Evidence Position")];
  out.push(p("The proposal is written as a senior bid-team response, not as a mechanical checklist. It uses the strongest available reviewed evidence, maps it to the evaluation criteria, and flags any remaining evidence balances for final bid review without weakening the technical narrative."));
  if (params.expertRequired > params.expertSelected) out.push(bullet(`Expert requirement interpretation: the tender appears to request ${params.expertRequired} experts and ${params.expertSelected} reviewed experts are selected. The proposal presents the reviewed core team, assigns each expert to a clear role, and recommends adding/substituting ${params.expertRequired - params.expertSelected} additional named expert(s) before final submission if the requirement is confirmed as mandatory.`));
  else if (params.expertSelected > 0) out.push(bullet(`Expert coverage: ${params.expertSelected} reviewed expert(s) are selected and mapped to the assignment methodology, risks, and deliverables.`));
  if (params.projectRequired > params.projectSelected) out.push(bullet(`Project reference interpretation: the tender appears to request ${params.projectRequired} project references and ${params.projectSelected} reviewed references are selected. The proposal leads with the closest, highest-value references and recommends adding ${params.projectRequired - params.projectSelected} further reference(s) or client testimony letters before final submission if strictly required.`));
  else if (params.projectSelected > 0) out.push(bullet(`Project evidence coverage: ${params.projectSelected} reviewed reference(s) are selected and positioned according to similarity of sector, service scope, technical systems, and delivery risk.`));
  return out;
}

async function buildEliteProposalDocx(tenderId: string, userId: string): Promise<{ buffer: Buffer; summary: string } | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      files: { select: { originalFileName: true, extractedText: true } },
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
      complianceGaps: { where: { isResolved: false }, orderBy: { severity: "asc" } },
      complianceMatrix: true,
    },
  });
  if (!tender) return null;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return null;

  const selectedExperts = tender.expertMatches.map((m) => m.expert).filter((expert) => expert.trustLevel === "REVIEWED");
  const selectedProjects = tender.projectMatches.map((m) => m.project).filter((project) => project.trustLevel === "REVIEWED");
  const expertRequired = exactSelectionLimit(tender.requirements, "EXPERT");
  const projectRequired = exactSelectionLimit(tender.requirements, "PROJECT_EXPERIENCE");

  const intelligence = buildProposalIntelligence({
    tender: { title: tender.title, reference: tender.reference, clientName: tender.clientName, country: tender.country, description: tender.description, intakeSummary: tender.intakeSummary, analysisSummary: tender.analysisSummary, evaluationMethodology: tender.evaluationMethodology, deadline: tender.deadline, submissionMethod: tender.submissionMethod, submissionAddress: tender.submissionAddress },
    company,
    requirements: tender.requirements,
    experts: selectedExperts,
    projects: selectedProjects,
  });

  const tenderText = [tender.title, tender.reference, tender.clientName, tender.description, tender.intakeSummary, tender.analysisSummary, tender.evaluationMethodology, ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`)].filter(Boolean).join("\n\n");
  const requirementsText = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${r.description}`).join("\n");
  const expertsText = selectedExperts.map((expert) => expertProofLine(expert)).join("\n");
  const projectsText = selectedProjects.map((project) => projectProofLine(project)).join("\n");
  const complianceText = [
    ...tender.complianceMatrix.map((m) => `${m.supportLevel}: ${m.requirementTitle} — ${m.evidenceSummary}`),
    ...tender.complianceGaps.map((g) => `${g.severity}: ${g.title} — ${g.mitigationPlan || g.description}`),
    ...proposalStrengthNarrative({ expertRequired, expertSelected: selectedExperts.length, projectRequired, projectSelected: selectedProjects.length }).map((x) => ""),
  ].join("\n");

  let children: Paragraph[];
  let aiUsed = false;
  let aiError: string | null = null;

  if (isAIEnabled()) {
    try {
      const aiMarkdown = await generateBenchmarkProposalWithAI({
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        tenderText,
        analysisSummary: tender.analysisSummary || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: tender.evaluationMethodology || intelligence.evaluationCriteria.join("; "),
        submissionNotes: [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n"),
        requirements: requirementsText,
        companyProfile: `${company.name}\n${company.legalName ?? ""}\n${company.profileSummary ?? company.description ?? ""}\nServices: ${safeParseArr(company.serviceLines).join(", ")}\nSectors: ${safeParseArr(company.sectors).join(", ")}`,
        experts: expertsText,
        projects: projectsText,
        compliance: complianceText,
        differentiators: intelligence.differentiators.join("\n"),
      });
      children = markdownToParagraphs(aiMarkdown);
      aiUsed = true;
    } catch (error) {
      aiError = error instanceof Error ? error.message : String(error);
      children = [];
    }
  } else {
    children = [];
  }

  if (children.length === 0) {
    const healthcareProjects = findHealthcareProjectCount(selectedProjects);
    const projectTotalValue = selectedProjects.reduce((sum, project) => sum + (project.contractValue ?? 0), 0);
    const serviceLines = safeParseArr(company.serviceLines).slice(0, 12);
    const sectors = safeParseArr(company.sectors).slice(0, 12);
    const unresolvedReviewItems = tender.complianceGaps.slice(0, 12);
    const supportedMatrix = tender.complianceMatrix.filter((m) => ["SUPPORTED", "PARTIAL", "EVIDENCE_PENDING_REVIEW"].includes(m.supportLevel)).length;

    const coverLetter = [h1("Cover Letter"), p(`To: ${intelligence.clientName}`), p(`Subject: Technical Proposal for ${tender.title}`, true), p(`We are pleased to submit this technical proposal for ${tender.title}. The proposal is prepared around the tender's actual evaluation logic, required sections, technical scope, submission rules, and evidence expectations.`), p(`This submission is positioned around ${company.name}'s most relevant proof: ${healthcareProjects || selectedProjects.length} reviewed project reference(s), ${selectedExperts.length} reviewed expert profile(s), multidisciplinary engineering capacity, and documented company systems.`), ...intelligence.submissionRules.map((rule) => bullet(rule))];
    const coverPage = [h1("Technical Proposal"), p(tender.title, true), ...[lv("Client", intelligence.clientName), lv("Reference", tender.reference), lv("Primary sector", intelligence.primarySector), lv("Prepared by", company.legalName || company.name)].filter(Boolean) as Paragraph[], p(`Prepared on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`)];
    const executiveSummary = [h1("Executive Summary"), p(`${company.name} understands this assignment as a ${intelligence.primarySector.toLowerCase()} consultancy requiring more than generic proposal writing: it requires evidence of comparable delivery, a credible professional team, regulatory understanding, and a technical methodology mapped directly to the client's scope.`), p(selectedProjects.length > 0 ? `The strongest evidence base selected for this tender includes ${selectedProjects.slice(0, 3).map((project) => project.name).join(", ")}. ${projectTotalValue > 0 ? `The selected reference portfolio includes work with a combined recorded value of approximately ${money(projectTotalValue, "ETB")}.` : ""}` : "The proposal should be strengthened by selecting reviewed project references before final submission."), p(selectedExperts.length > 0 ? `The proposed team is built from ${selectedExperts.length} reviewed experts, including ${selectedExperts.slice(0, 6).map((expert) => expert.fullName).join(", ")}.` : "The expert team section requires reviewed CV records before final submission."), p(`Evidence coverage: ${supportedMatrix}/${Math.max(tender.complianceMatrix.length, 1)} compliance-matrix item(s) are supportable by selected evidence, support documents, or generated proposal response.`), ...intelligence.differentiators.map((item) => bullet(item)), ...proposalStrengthNarrative({ expertRequired, expertSelected: selectedExperts.length, projectRequired, projectSelected: selectedProjects.length })];
    const toc = [h1("Table of Contents"), ...intelligence.requiredSections.map((section, index) => bullet(`${index + 1}. ${section}`)), bullet("Appendices: registration, testimony letters/contracts, CVs and credentials, photos/drawings, manuals and audited documents as required by the tender.")];
    const companyProfile = [h1("SECTION A: COMPANY PROFILE"), h2("A.1 Company Background"), p(company.profileSummary || company.description || `${company.name} is a multidisciplinary consultancy firm.`), ...[lv("Legal name", company.legalName), lv("Address", company.address), lv("Email", company.email), lv("Phone", company.phone), lv("Website", company.website)].filter(Boolean) as Paragraph[], h2("A.2 Core Areas of Expertise"), ...(serviceLines.length ? serviceLines.map((line) => bullet(line)) : [bullet("Architectural, engineering, MEP, geotechnical, environmental, supervision and contract administration services.")]), ...(sectors.length ? [h2("A.3 Sectors Served"), ...sectors.map((sector) => bullet(sector))] : [])];
    const team = [h2("A.4 Proposed Project Team"), p("The proposed team is selected for relevance to the tender scope, not as a generic staff list. Each member is mapped to the technical risks and evaluation criteria detected in the tender."), ...intelligence.topExperts.map((expert) => bullet(expertProofLine(expert)))];
    const experience = [h1("SECTION B: RELEVANT EXPERIENCE"), p("The portfolio below prioritizes similarity to the tender's sector, technical systems, service scope, regulatory environment, and implementation risk."), ...intelligence.topProjects.flatMap((project, index) => [h2(`B.${index + 1} ${project.name}`), p(projectProofLine(project)), ...(firstSentence(project.summary) ? [p(`Relevance to this assignment: ${firstSentence(project.summary)}`)] : [])])];
    const methodology = [h1("SECTION C: TECHNICAL APPROACH"), h2("C.1 Understanding of the Assignment"), p(tender.description || tender.intakeSummary || `The assignment requires a coordinated technical proposal for ${tender.title}.`), h2("C.2 Evaluation Criteria Response"), ...(intelligence.evaluationCriteria.length ? intelligence.evaluationCriteria.map((criterion) => bullet(`${criterion}: addressed through selected evidence, team composition, methodology, and appendix proof.`)) : [bullet("Evaluation criteria were not explicitly detected; the proposal is structured around experience, technical approach, team and compliance.")]), ...intelligence.themes.flatMap((theme, index) => [h2(`C.${index + 3} ${theme.label}`), ...theme.methodologyBullets.map((item) => bullet(item))]), h2("C. Quality Assurance and Reporting"), bullet("Project-specific quality plan, document control, design review milestones, interdisciplinary coordination and client review cycles."), bullet("Progress reporting aligned to the tender's required deliverables, submission format and approval workflow.")];
    const additional = [h1("SECTION D: ADDITIONAL INFORMATION"), h2("D.1 Value to the Client"), ...intelligence.differentiators.map((item) => bullet(item)), h2("D.2 Compliance and Submission Rules"), ...(intelligence.submissionRules.length ? intelligence.submissionRules.map((rule) => bullet(rule)) : [bullet("Final submission rules should be checked against the original tender before export.")]), h2("D.3 Senior Bid Review Items"), ...(unresolvedReviewItems.length ? unresolvedReviewItems.map((gap) => bullet(`${gap.severity}: ${gap.title} — ${gap.mitigationPlan || gap.description}`)) : [bullet("No unresolved compliance gap detected from the current engine run.")]), ...(expertRequired > selectedExperts.length ? [bullet(`Confirm whether ${expertRequired - selectedExperts.length} additional expert(s) must be named before submission, or whether the selected reviewed core team is acceptable for this stage.`)] : []), ...(projectRequired > selectedProjects.length ? [bullet(`Confirm whether ${projectRequired - selectedProjects.length} additional project reference(s) must be appended before submission.`)] : []), h2("D.4 Declaration"), p(`We confirm that this proposal has been prepared for ${tender.title} using reviewed company evidence and the tender requirements extracted from the uploaded tender documents.`)];
    children = [...coverLetter, ...coverPage, ...toc, ...executiveSummary, ...companyProfile, ...team, ...experience, ...methodology, ...additional];
    if (aiError) children.push(h1("AI Bid Writer Fallback Note"), p(`AI bid writer unavailable: ${aiError}. Deterministic benchmark generator used.`));
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1200, bottom: 900, left: 900, right: 900 } } }, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } });
  const summary = `${aiUsed ? "AI bid-writer" : "Deterministic benchmark"} technical proposal generated using ${intelligence.requiredSections.length} required section group(s), ${intelligence.themes.length} tender theme(s), ${selectedExperts.length} reviewed expert(s), ${selectedProjects.length} reviewed project(s), compliance narrative, and review actions.`;
  return { buffer: await Packer.toBuffer(doc), summary };
}

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<void> {
  const elite = await buildEliteProposalDocx(tenderId, userId);
  if (!elite) throw new Error("Document generation failed: tender/company data could not be loaded.");

  const target = await prisma.generatedDocument.findFirst({ where: { tenderId, documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] } }, orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] });
  const fileContent = elite.buffer.toString("base64");
  if (target) await prisma.generatedDocument.update({ where: { id: target.id }, data: { name: "AI Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", exactFileName: target.exactFileName || "Technical-Proposal.docx", fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: elite.summary, updatedAt: new Date() } });
  else await prisma.generatedDocument.create({ data: { tenderId, name: "AI Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", format: "DOCX", exactFileName: "Technical-Proposal.docx", exactOrder: 1, fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: elite.summary } });

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });
}
