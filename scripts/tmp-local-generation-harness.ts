// TEMPORARY local QA harness (PR #1175): runs the real deterministic
// generation end to end against the local CI database for a fictional tender
// and prints the delivered proposal text, so a whole document can be read
// without a hosted run. Fixtures are invented; nothing here touches Preview
// or Production. Usage:
//   DATABASE_URL=... RUN_DB_INTEGRATION=true npx tsx scripts/tmp-local-generation-harness.ts [out.txt]
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { prisma } from "../lib/prisma";
import { prepareCompanyVaultForEngine } from "../lib/engine/prepare-company-vault";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";
import { enqueueEngineJobForCurrentSources } from "../lib/engine/enqueue-engine-job";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { completeJob } from "../lib/ai-jobs";
import { runTenderEngine } from "../lib/engine/run-tender-engine";
import { buildAndVerifyBuildPlan } from "../lib/engine/automatic-build-plan";
import { generateTenderDocuments } from "../lib/engine/generate-elite";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function docxText(base64: string): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(base64, "base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

async function main() {
  const outPath = process.argv[2] ?? "harness-output.txt";
  const nonce = randomUUID();
  const user = await prisma.user.create({ data: { email: `harness-${nonce}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" } });
  try {
    const company = await prisma.company.create({ data: {
      userId: user.id, name: "Meridian Design Consultants", legalName: "Meridian Design Consultants PLC",
      country: "ET", address: "Bole Road, Meridian House, 3rd Floor, Addis Ababa", email: "bids@meridian.example", phone: "+251 900 000 000",
      website: "meridian.example", tin: "0011223344", gmName: "Liya Bekele", gmTitle: "Managing Director",
      sectors: JSON.stringify(["Commercial/office", "Education", "Hospitality/tourism"]),
      serviceLines: JSON.stringify(["Architectural design", "Interior design", "Space planning", "MEP design", "Construction supervision"]),
      description: "Meridian Design Consultants PLC is an architectural and interior design consultancy registered in Ethiopia.",
    } });
    const experts = [
      { fullName: "Liya Bekele", title: "Managing Director / Principal Architect", yearsExperience: 18, disciplines: ["Architecture"], profile: "Principal architect. Led Kality Logistics Office Fit-Out and Lakeview Secondary School design. Professional Architect, Reg. No. AR/1234." },
      { fullName: "Dawit Alemu", title: "Senior Interior Designer", yearsExperience: 12, disciplines: ["Interior Design"], profile: "Interior designer. Space planning and furniture layout on Kality Logistics Office Fit-Out." },
      { fullName: "Saba Girma", title: "MEP Engineer", yearsExperience: 9, disciplines: ["Electrical Engineering"], profile: "MEP engineer. Lighting and power design for Kality Logistics Office Fit-Out and Blue Nile Lodge." },
    ];
    const projects = [
      { name: "Kality Logistics Office Fit-Out", clientName: "Kality Logistics PLC", sector: "Commercial/office", serviceAreas: ["Interior design", "Space planning", "MEP design"], contractValue: 4_500_000, currency: "ETB", summary: "Interior design and space planning of 1,200 m² of open-plan office floors, meeting rooms and reception." },
      { name: "Lakeview Secondary School", clientName: "Bahir Dar City Education Office", sector: "Education", serviceAreas: ["Architectural design", "Construction supervision"], contractValue: 38_000_000, currency: "ETB", summary: "Architectural design and supervision of a 24-classroom secondary school." },
      { name: "Blue Nile Lodge", clientName: "Blue Nile Hospitality PLC", sector: "Hospitality/tourism", serviceAreas: ["Architectural design", "Interior design"], contractValue: 61_000_000, currency: "ETB", summary: "Design of a 40-room eco-lodge with restaurant." },
    ];
    const vaultText = [
      "MERIDIAN DESIGN CONSULTANTS — EXPERIENCE AND STAFF REGISTER",
      ...experts.flatMap((e) => [`Expert: ${e.fullName}`, `Title: ${e.title}`, `Years Experience: ${e.yearsExperience}`, `Discipline: ${e.disciplines[0]}`, e.profile]),
      ...projects.flatMap((p) => [`Project: ${p.name}`, `Client: ${p.clientName}`, "Country: Ethiopia", `Sector: ${p.sector}`, `Service Area: ${p.serviceAreas.join(", ")}`, `Contract Value: ${p.currency} ${p.contractValue.toLocaleString("en-US")}`, p.summary]),
      "This register is the company's retained source evidence.",
    ].join("\n");
    await prisma.companyDocument.create({ data: {
      companyId: company.id, fileName: "register.txt", originalFileName: "register.txt", mimeType: "text/plain",
      size: Buffer.byteLength(vaultText), storagePath: "", extractedText: vaultText, contentSha256: sha(vaultText),
      contentByteLength: Buffer.byteLength(vaultText), integrityStatus: "VERIFIED", category: "COMPANY_PROFILE",
    } });
    for (const e of experts) await prisma.expert.create({ data: {
      companyId: company.id, fullName: e.fullName, title: e.title, yearsExperience: e.yearsExperience, profile: e.profile,
      disciplines: JSON.stringify(e.disciplines), sectors: JSON.stringify(["Commercial/office"]), trustLevel: "AI_DRAFT",
    } });
    for (const p of projects) await prisma.project.create({ data: {
      companyId: company.id, name: p.name, clientName: p.clientName, country: "Ethiopia", sector: p.sector,
      serviceAreas: JSON.stringify(p.serviceAreas), contractValue: p.contractValue, currency: p.currency, summary: p.summary, trustLevel: "AI_DRAFT",
    } });

    const tenderText = [
      "[Page 1] REQUEST FOR QUOTATION RFQ No. LRI/2031-07",
      "Interior Architectural Design and Space Planning of Office Floors",
      "Issuing Authority: Lakeside Research Institute",
      "Lakeside Research Institute is a non-profit health research organization dedicated to advancing maternal and child health.",
      "The Institute invites qualified firms to provide interior architectural design, space planning, floor plans, furniture layout and 3D modelling for its new office floors of 900 sqm in Riverbend Town.",
      "[Page 2] Physical Address for Document Collection: Kebele 04, behind the Summit Hotel, Riverbend Town.",
      "Bidders shall submit a company profile, a litigation history disclosure and evidence of at least two similar office interior design assignments.",
      "The proposed team shall include a lead architect and an interior designer.",
      "Submission is by email to procurement@lakeside.example. Quotations shall remain valid for 90 days.",
      "Subject line: [RFQ No. LRI/2031-07 Your Company Name]",
    ].join("\n");
    const tender = await prisma.tender.create({ data: {
      userId: user.id, title: "Interior Architectural Design and Space Planning of Office Floors", clientName: "Lakeside Research Institute",
      reference: "RFQ No. LRI/2031-07", deadline: new Date("2031-09-30T12:00:00Z"), submissionMethod: "EMAIL",
      submissionEmails: "procurement@lakeside.example", submissionEmailSubject: "[RFQ No. LRI/2031-07 Your Company Name]",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED", analysisSummary: "Office interior design and space planning RFQ.", status: "AI_ANALYZED",
    } });
    const source = await prisma.tenderFile.create({ data: {
      tenderId: tender.id, fileName: "rfq.pdf", originalFileName: "rfq.pdf", mimeType: "application/pdf",
      size: Buffer.byteLength(tenderText), extractedText: tenderText, totalPages: 2, extractedPages: 2, failedPages: 0,
      extractionScore: 100, extractionMethod: "text", integrityStatus: "VERIFIED", contentSha256: sha(tenderText), contentByteLength: Buffer.byteLength(tenderText),
    } });
    await prisma.tender.update({ where: { id: tender.id }, data: {
      clientNameSourceFileId: source.id, clientNameSourcePage: 1, clientNameSourceQuote: "Issuing Authority: Lakeside Research Institute",
      submissionMethodSourceFileId: source.id, submissionMethodSourcePage: 2, submissionMethodSourceQuote: "Submission is by email",
      submissionEmailSourceFileId: source.id, submissionEmailSourcePage: 2, submissionEmailSourceQuote: "procurement@lakeside.example",
      deadlineSourceFileId: source.id, deadlineSourcePage: 1, deadlineSourceQuote: "RFQ No. LRI/2031-07",
      titleSourceFileId: source.id, titleSourcePage: 1, titleSourceQuote: "Interior Architectural Design and Space Planning of Office Floors",
      referenceSourceFileId: source.id, referenceSourcePage: 1, referenceSourceQuote: "RFQ No. LRI/2031-07",
    } });
    for (const r of [
      { title: "Company Profile", type: "COMPANY_PROFILE", quote: "Bidders shall submit a company profile", priority: "MANDATORY" },
      { title: "Litigation History Disclosure", type: "DECLARATION", quote: "a litigation history disclosure", priority: "MANDATORY" },
      { title: "Similar Office Interior Design Experience", type: "PROJECT_EXPERIENCE", quote: "evidence of at least two similar office interior design assignments", priority: "SCORED" },
      { title: "Lead Architect and Interior Designer", type: "EXPERT", quote: "The proposed team shall include a lead architect and an interior designer.", priority: "MANDATORY" },
    ]) await prisma.tenderRequirement.create({ data: {
      tenderId: tender.id, title: r.title, description: r.quote, requirementType: r.type, priority: r.priority, requiredQuantity: 1,
      sourceTenderFileId: source.id, sourcePageNumber: r.type === "EXPERT" ? 2 : 2, sourceExactQuote: r.quote, sourceConfidence: 1,
    } });

    const preflight = await prepareCompanyVaultForEngine(user.id);
    console.log("vault:", JSON.stringify(preflight?.sourceVerification ?? null));
    const hash = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tender.title, description: null, intakeSummary: null, files: [{ ...source, createdAt: source.createdAt }] }));
    await prisma.aiJob.create({ data: {
      userId: user.id, tenderId: tender.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", analysisInputHash: hash,
      promotedAt: new Date(), promotedBy: user.id, finishedAt: new Date(), output: JSON.stringify({ analysisSource: "AI" }), input: "{}",
    } });
    const job = await enqueueEngineJobForCurrentSources(prisma, { userId: user.id, tenderId: tender.id, companyId: company.id, manualRequested: true });
    await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false });
    await runTenderEngine(tender.id, user.id, undefined, { safe: true, skipAiRematch: true });
    if (job) await completeJob(job.job.id, { ok: true });
    const plan = await buildAndVerifyBuildPlan(prisma, tender.id, user.id, { reuseCurrent: false });
    console.log("plan:", plan.ok ? "ok" : `${plan.code}: ${plan.message}`);
    await generateTenderDocuments(tender.id, user.id);
    const docs = await prisma.generatedDocument.findMany({ where: { tenderId: tender.id }, orderBy: { createdAt: "asc" } });
    const parts: string[] = [];
    for (const d of docs) {
      parts.push(`===== ${d.name} (${d.format}) =====`);
      if (d.fileContent && d.format === "DOCX") parts.push(await docxText(d.fileContent));
    }
    writeFileSync(outPath, parts.join("\n"));
    console.log(`wrote ${outPath}: ${docs.map((d) => d.name).join(", ")}`);
  } finally {
    await prisma.tender.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.company.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
