/**
 * Real-run seed for the end-to-end ZIP drive.
 *
 * Creates: user + session token (printed), company vault with real documents,
 * and prints the session cookie value so the driver can call the real HTTP
 * routes as an authenticated ADMIN.
 *
 * This is a development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) throw new Error("SESSION_SECRET required");

const hashToken = (t) => createHash("sha256").update(t).digest("hex");

function makeToken(userId) {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}

const VAULT_DOCS = [
  {
    originalFileName: "Company-Profile-Hope-Urban-Planning.txt",
    category: "COMPANY_PROFILE",
    extractedText: `HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY
Established 2009. Addis Ababa, Ethiopia.
Registration Number: MT/AA/3/0004521/2009. TIN: 0012345678. VAT: 00098765.
Consulting License Grade: Grade 1 Architectural and Engineering Consultancy.
Headcount: 84 permanent professional staff.
Service lines: urban planning, architectural design, structural engineering,
water supply and sanitation design, road and drainage design, construction
supervision, environmental and social impact assessment, feasibility studies.
Sectors: public infrastructure, water and sanitation, education facilities,
health facilities, municipal development.
The firm has delivered 140+ assignments for federal and regional government
clients, multilateral development banks and United Nations agencies.
Quality assurance follows an internal ISO 9001-aligned review procedure with
independent technical review before every deliverable is issued.`,
  },
  {
    originalFileName: "Trade-License-2026.txt",
    category: "LEGAL",
    extractedText: `FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA
MINISTRY OF TRADE AND REGIONAL INTEGRATION
BUSINESS LICENCE
Licence Number: MT/AA/3/0004521/2009
Business Name: Hope Urban Planning Architectural and Engineering Consultancy
Field of Business: Architectural and engineering consultancy services
Date of Issue: 11 July 2026. Valid Until: 10 July 2027.
This licence is valid and in good standing.`,
  },
  {
    originalFileName: "Tax-Clearance-Certificate-2026.txt",
    category: "LEGAL",
    extractedText: `MINISTRY OF REVENUES — TAX CLEARANCE CERTIFICATE
Taxpayer: Hope Urban Planning Architectural and Engineering Consultancy
TIN: 0012345678
This certifies that the above taxpayer has settled all tax obligations
due as of 30 June 2026. Certificate Number: TCC/2026/44192.
Valid until 31 December 2026.`,
  },
  {
    originalFileName: "Project-References.txt",
    category: "PROJECT",
    extractedText: `SELECTED PROJECT REFERENCES

1. Detailed Design and Construction Supervision of Adama Town Water Supply
   Distribution Network. Client: Oromia Water Works Design and Supervision
   Enterprise. Contract value: ETB 18,400,000. Period: 2023-2025. Completed.
   Role: Lead consultant. 62 km distribution network, 4 reservoirs.

2. Feasibility Study and Detailed Engineering Design for Hawassa Municipal
   Drainage Improvement. Client: Hawassa City Administration.
   Contract value: ETB 12,750,000. Period: 2022-2024. Completed.
   Role: Lead consultant. 28 km primary and secondary drainage.

3. Design and Supervision of 14 Primary School Facilities, Sidama Region.
   Client: Ministry of Education / World Bank GEQIP-E.
   Contract value: USD 940,000. Period: 2021-2023. Completed.
   Role: Lead consultant. Architectural and structural design, supervision.

4. Borehole Siting, Design and Supervision, Somali Region Water Access.
   Client: UNICEF Ethiopia. Contract value: USD 610,000. Period: 2024-2025.
   Completed. Role: Lead consultant. 22 boreholes, hydrogeological survey.`,
  },
  {
    originalFileName: "Key-Experts-CVs.txt",
    category: "EXPERT",
    extractedText: `KEY EXPERT SUMMARIES

ENG. ABEBE TESFAYE — Team Leader / Project Manager
MSc Civil Engineering, Addis Ababa University, 2004.
22 years professional experience in water supply and municipal infrastructure.
Registered Professional Engineer, Grade I, Licence PE/ET/2231.
Led the Adama Water Supply and Hawassa Drainage assignments above.

ENG. MERON GEBREHIWOT — Senior Water Supply Engineer
MSc Water Resources Engineering, Arba Minch University, 2010.
15 years experience in distribution network design and hydraulic modelling.
WaterCAD / EPANET specialist.

ARCH. DANIEL WOLDU — Senior Architect
BArch, Ethiopian Institute of Architecture, 2007.
18 years experience in public facility design and construction supervision.

ENG. SARA HAILU — Environmental and Social Safeguards Specialist
MSc Environmental Engineering, 2012. 13 years ESIA experience,
including World Bank and African Development Bank funded assignments.`,
  },
  {
    originalFileName: "Quality-Assurance-Methodology.txt",
    category: "OTHER",
    extractedText: `QUALITY ASSURANCE AND WORK PLAN METHODOLOGY
The firm applies a four-stage assurance procedure to every assignment:
inception review, interim technical review, independent peer review by a
non-project senior engineer, and final director sign-off before issue.
All deliverables are version controlled. Field data is validated against
survey control points. Design calculations are independently checked.
A monthly progress report is issued to the client with an updated work plan,
risk register and mitigation actions.`,
  },
];

/**
 * Seed the vault from a real company knowledge record instead of the summaries
 * above.
 *
 * The built-in VAULT_DOCS are a few hand-written paragraphs. They are enough to
 * prove the pipeline runs, and useless for judging whether the pipeline picks
 * the RIGHT project or the RIGHT expert — with six documents there is nothing
 * to choose between. Point DRIVE_VAULT_JSON at an authority export and the
 * vault carries the firm's actual portfolio, so evidence selection is measured
 * against real competition.
 *
 * Kept out of the repository deliberately: an authority export is the firm's
 * commercial record, including client names and contract values. Only the path
 * is configured.
 *
 * The export nests each record's evidence under `rawText`, which is what the
 * extractors read, so entries are emitted verbatim rather than reformatted —
 * paraphrasing here would silently become the "original source evidence" the
 * grounding hierarchy trusts above everything else.
 */
function vaultDocsFromAuthority(path) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const docs = [];
  const push = (originalFileName, category, extractedText) => {
    if (extractedText && extractedText.trim()) docs.push({ originalFileName, category, extractedText });
  };
  const block = (rows, label) => rows
    .map((r, i) => `${label} ${i + 1}: ${r.name ?? r.fullName ?? r.title ?? ""}\n${(r.rawText ?? "").trim()}`)
    .join("\n\n---\n\n");

  if (j.companyProfile) {
    push("Company-Profile.txt", "COMPANY_PROFILE",
      typeof j.companyProfile === "string" ? j.companyProfile : JSON.stringify(j.companyProfile, null, 2));
  }
  // Chunked because a single 100+ project document exceeds the per-file
  // extraction ceiling, and a truncated vault file silently drops the tail of
  // the portfolio — the projects most likely to be the relevant ones.
  const projects = Array.isArray(j.projects) ? j.projects : [];
  for (let i = 0; i < projects.length; i += 25) {
    push(`Project-References-${Math.floor(i / 25) + 1}.txt`, "PROJECT", block(projects.slice(i, i + 25), "PROJECT"));
  }
  const experts = Array.isArray(j.experts) ? j.experts : [];
  for (let i = 0; i < experts.length; i += 10) {
    push(`Key-Experts-${Math.floor(i / 10) + 1}.txt`, "EXPERT", block(experts.slice(i, i + 10), "EXPERT"));
  }
  for (const [key, cat] of [["legalRecords", "LEGAL"], ["financialRecords", "OTHER"], ["complianceRecords", "OTHER"]]) {
    if (Array.isArray(j[key]) && j[key].length) {
      push(`${key}.txt`, cat, block(j[key], key.replace(/Records$/, "").toUpperCase()));
    }
  }
  return docs;
}

/**
 * A structured authority export is not an ordinary upload.
 *
 * The app has a dedicated route for it — POST /api/company/plan-b-import —
 * which accepts schemaVersion, importPolicy, experts[], projects[] and
 * expectedCounts, preserves each record's canonical identity, and enforces
 * completenessPolicy.enforceExpectedCounts.
 *
 * This harness previously flattened such a file into text blobs and let the
 * heuristic entity extractor rediscover the records from that text. That is
 * the wrong path for a file that already carries the identities: 28 canonical
 * experts and 114 canonical projects came back as ~34 and ~172, with clients,
 * places, table headings and amount fragments promoted alongside them. The
 * inflation was an artefact of the harness choosing text re-extraction over
 * the structured import the file was written for — the app's own route never
 * had the chance to preserve what the export already stated.
 *
 * So: recognise the structured schema and drive the real structured route.
 * The text-blob path stays for ordinary unstructured uploads, which is what
 * the heuristic extractor is for.
 */
function looksLikeStructuredAuthority(path) {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return Boolean(j && (j.schemaVersion || j.importPolicy) && (Array.isArray(j.experts) || Array.isArray(j.projects)));
  } catch { return false; }
}

const STRUCTURED_AUTHORITY = process.env.DRIVE_VAULT_JSON
  && looksLikeStructuredAuthority(process.env.DRIVE_VAULT_JSON);

// Seed the source documents in BOTH cases, because that is the owner's real
// state: they upload the originals and import the structured authority.
//
// The documents matter for provenance, not for identity. plan-b-import keeps
// its synthetic artifacts in PlanBStaging and links records only to official
// uploads, so without documents the imported records stay AI_DRAFT with no
// sourceDocumentId and never become generation-eligible. With them, the
// auto-verification pass promotes the canonical records to SOURCE_VERIFIED
// against owned, byte-verified text.
//
// Feeding the same text to the heuristic extractor no longer mints identities
// beside the canonical ones: a company carrying PlanBStaging rows is
// verify-and-enrich only (see lib/company-vault-ingestion.ts). Measured on the
// real export in exactly this configuration — 18 documents, structured import,
// auto-verification — experts 28/28 and projects 114/114 with zero extras,
// zero duplicates, all SOURCE_VERIFIED.
const VAULT = process.env.DRIVE_VAULT_JSON
  ? vaultDocsFromAuthority(process.env.DRIVE_VAULT_JSON)
  : VAULT_DOCS;


async function main() {
  // A fresh account per run. Reusing one address and deleting it first fails:
  // SubmissionPlanState.tenderId has no ON DELETE CASCADE, so removing a user
  // that ever reached the submission-plan stage raises a foreign-key error.
  const email = `pipeline-drive+${Date.now()}@example.test`;

  const user = await prisma.user.create({
    data: {
      name: "Pipeline Drive",
      email,
      passwordHash: await bcrypt.hash("Pipeline-drive-2026!", 10),
      role: "ADMIN",
      company: {
        create: {
          name: "Hope Urban Planning Architectural and Engineering Consultancy",
          legalName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
          description: "Architectural and engineering consultancy",
          country: "Ethiopia",
          address: "Bole Sub City, Addis Ababa, Ethiopia",
          email: "info@hopeurban.example",
          phone: "+251 11 552 8899",
          registrationNumber: "MT/AA/3/0004521/2009",
          tin: "0012345678",
          vat: "00098765",
          foundingYear: 2009,
          headcount: 84,
          licenseGrade: "Grade 1",
          gmName: "Eng. Abebe Tesfaye",
          gmTitle: "General Manager",
          serviceLines: JSON.stringify(["Urban planning", "Architectural design", "Structural engineering", "Water supply and sanitation", "Construction supervision"]),
          sectors: JSON.stringify(["Public infrastructure", "Water and sanitation", "Education", "Health"]),
          setupCompletedAt: new Date(),
        },
      },
    },
    include: { company: true },
  });

  const companyId = user.company.id;
  for (const doc of VAULT) {
    const bytes = Buffer.from(doc.extractedText, "utf8");
    // Byte integrity must be recorded exactly as a real upload records it.
    // sourceByteIntegrityIsVerified() requires integrityStatus VERIFIED plus a
    // sha256 and a positive byte length, and vault review provenance refuses to
    // verify any record whose source document lacks them — so a seed without
    // these fields cannot produce a generation-eligible expert or project.
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    await prisma.companyDocument.create({
      data: {
        companyId,
        contentSha256,
        integrityStatus: "VERIFIED",
        integrityVerifiedAt: new Date(),
        fileName: doc.originalFileName,
        originalFileName: doc.originalFileName,
        mimeType: "text/plain",
        size: bytes.length,
        fileContent: bytes.toString("base64"),
        contentByteLength: bytes.length,
        contentMimeType: "text/plain",
        category: doc.category,
        extractedText: doc.extractedText,
        aiExtractionStatus: "COMPLETED",
        aiExtractedAt: new Date(),
      },
    });
  }

  const { token, expiresAt } = makeToken(user.id);
  await prisma.session.create({ data: { token: hashToken(token), expiresAt, userId: user.id } });

  console.log(JSON.stringify({
    userId: user.id,
    companyId,
    vaultDocs: VAULT.length,
    structuredAuthority: Boolean(STRUCTURED_AUTHORITY),
    cookie: token,
  }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
