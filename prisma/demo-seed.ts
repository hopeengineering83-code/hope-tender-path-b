/**
 * Demo data seeder — populates the seed admin user's company with a rich,
 * REVIEWED knowledge vault so the proposal generator can be tested
 * immediately. Generic "Acme Engineering" data (not based on any real
 * client) so it can be safely used for demos and dev work without
 * privacy concerns.
 *
 * Run: npm run db:demo-seed
 *
 * Idempotent: re-running re-creates the demo company / experts / projects
 * for the seeded admin user. Existing custom data is left intact unless
 * you delete the seed user first.
 */

import { prisma } from "../lib/prisma";

const DEMO_COMPANY = {
  name: "Acme Engineering and Design Consultancy",
  legalName: "Acme Engineering and Design Consultancy Ltd",
  description: "Multidisciplinary engineering and architectural consultancy serving healthcare, water infrastructure, and institutional building clients.",
  website: "https://acme-engineering.example.com",
  address: "Demo Plaza, Floor 3, Capital City",
  phone: "+1 555 0100 / +1 555 0101",
  email: "info@acme-engineering.example.com",
  country: "Demo Country",
  serviceLines: ["Architectural Design", "Structural Engineering", "MEP Design", "Geotechnical Investigation", "Construction Supervision", "Master Planning"],
  sectors: ["Healthcare", "Water Infrastructure", "Education", "Institutional Buildings", "Commercial"],
  profileSummary: "Acme Engineering is a Grade I licensed multidisciplinary consultancy with documented delivery across 100+ projects. The firm operates in-house geotechnical capability, an ISO 9001:2015-aligned quality management system, and maintains permanent staff across all proposed disciplines.",
  knowledgeMode: "PROFILE_FIRST",
  gmName: "Eng. Demo Director",
  gmTitle: "General Manager and Founder",
  gmLicense: "PE/DEMO/0001",
  foundingYear: 2018,
  headcount: 32,
  licenseGrade: "Grade I",
  registrationNumber: "BR-DEMO-100200",
  tin: "0000000001",
  vat: "VAT-DEMO-100200",
};

const DEMO_EXPERTS = [
  {
    fullName: "Eng. Demo Director",
    title: "Project Principal",
    yearsExperience: 14,
    disciplines: ["Civil Engineering", "Structural Engineering", "Project Leadership"],
    sectors: ["Healthcare", "Institutional", "Commercial"],
    certifications: ["PE/DEMO/0001 valid 2030", "BIM & Revit (2024)", "ISO 9001:2015 Lead Auditor"],
    profile: "B.Sc. Civil Engineering with 14 years of project delivery experience across healthcare, institutional, and commercial sectors. Has led structural design and project supervision on the firm's two largest hospital projects and multiple Grade I office complexes.",
    trustLevel: "REVIEWED",
  },
  {
    fullName: "Architect Demo Lead",
    title: "Lead Architect",
    yearsExperience: 11,
    disciplines: ["Architecture", "Healthcare Facility Design", "Clinical Workflow"],
    sectors: ["Healthcare", "Education", "Hospitality"],
    certifications: ["PA/DEMO/0023 valid 2026", "Revit Certified Professional", "LEED Green Associate"],
    profile: "M.Arch in Healthcare Design with extensive experience in clinical zoning, IPC-compliant layouts, and patient/staff/supply flow mapping. Lead architect on Acme's two completed hospital projects.",
    trustLevel: "REVIEWED",
  },
  {
    fullName: "Eng. Demo MEP",
    title: "MEP Lead, Electrical",
    yearsExperience: 10,
    disciplines: ["Electrical Engineering", "MEP Design", "Medical-Grade Power"],
    sectors: ["Healthcare", "Industrial", "Commercial"],
    certifications: ["Licensed Electrical Engineer (Demo Authority)", "ETAP Certified", "DIALux Evo"],
    profile: "M.Sc. Electrical Engineering with 10 years in MEP coordination for clinical facilities. Designed medical-grade power, UPS, generator backup, fire alarm, and BMS for two completed hospitals.",
    trustLevel: "REVIEWED",
  },
  {
    fullName: "Eng. Demo Structural",
    title: "Lead Structural Engineer",
    yearsExperience: 9,
    disciplines: ["Structural Engineering", "Seismic Design", "Foundation Engineering"],
    sectors: ["Healthcare", "Institutional", "Heritage Conservation"],
    certifications: ["PE/DEMO/0044 valid 2028", "ETABS / SAP2000 / SAFE", "EBCS-8 Seismic Detailing"],
    profile: "M.Sc. Structural Engineering. Lead designer on Acme's hospital structural packages from feasibility to working drawings. Hospital structural typology specialist.",
    trustLevel: "REVIEWED",
  },
  {
    fullName: "Eng. Demo Sanitary",
    title: "Lead Sanitary Engineer",
    yearsExperience: 9,
    disciplines: ["Sanitary Engineering", "Hydraulic Design", "Medical Waste Management"],
    sectors: ["Healthcare", "Water Infrastructure"],
    certifications: ["PSE/DEMO/0019 valid 2026", "WaterCAD", "EPANET"],
    profile: "B.Sc. Water Resources Engineering. Lead sanitary engineer on two hospital projects covering medical waste stream segregation, fire suppression, and IPC-compliant drainage.",
    trustLevel: "REVIEWED",
  },
  {
    fullName: "Eng. Demo Resident",
    title: "Senior Resident Engineer",
    yearsExperience: 8,
    disciplines: ["Construction Supervision", "Quality Control", "Contract Administration"],
    sectors: ["Healthcare", "Institutional", "Industrial"],
    certifications: ["PE/DEMO/0061 valid 2027", "ISO 9001:2015"],
    profile: "B.Sc. Civil Engineering with 8 years in field supervision under FIDIC contract discipline. Led site engineering on a USAID-funded health centre and two industrial complexes.",
    trustLevel: "REVIEWED",
  },
];

const DEMO_PROJECTS = [
  {
    name: "Demo General Hospital (G+5)",
    clientName: "Demo City Health Authority",
    country: "Demo Country",
    sector: "Healthcare",
    serviceAreas: ["Architectural Design", "Structural Design", "MEP Design", "Construction Supervision", "Geotechnical Investigation"],
    summary: "Complete new hospital design and supervision: feasibility, geotechnical investigation, architectural G+5 typology with all clinical departments (Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy), structural design, complete MEP, BOQ, tender documents, and three-year construction supervision.",
    contractValue: 480_000_000,
    currency: "USD",
    startDate: new Date("2018-06-01"),
    endDate: new Date("2022-04-30"),
    trustLevel: "REVIEWED",
  },
  {
    name: "Demo Specialty Medical Center Renovation",
    clientName: "Demo Regional Health Bureau",
    country: "Demo Country",
    sector: "Healthcare",
    serviceAreas: ["Renovation Design", "Structural Assessment", "MEP Modification", "Construction Supervision"],
    summary: "Hospital renovation and full modification design covering structural assessment using hammer-test methodology, architectural modification, complete MEP modification, BOQ, and site supervision. Demonstrates the firm's competency in assessing and adapting existing premises for healthcare use.",
    contractValue: 110_000_000,
    currency: "USD",
    startDate: new Date("2021-03-01"),
    endDate: new Date("2023-09-15"),
    trustLevel: "REVIEWED",
  },
  {
    name: "Demo Eco-Park Master Plan (95 Structures)",
    clientName: "Demo Heritage Trust",
    country: "Demo Country",
    sector: "Master Planning",
    serviceAreas: ["Master Planning", "Architectural Design", "Infrastructure Engineering", "Environmental Compliance"],
    summary: "1,300-hectare master plan with 95 structures including First Aid Centre, Wellness and Treatment Centres, water supply infrastructure, solar power installations, and emergency access routes. Delivered under World Bank ESF compliance.",
    contractValue: 24_500_000_000,
    currency: "USD",
    startDate: new Date("2024-01-15"),
    endDate: null,
    trustLevel: "REVIEWED",
  },
  {
    name: "Demo Industrial Plant Complex",
    clientName: "Demo Industrial PLC",
    country: "Demo Country",
    sector: "Industrial",
    serviceAreas: ["Architectural Design", "Structural Design", "MEP Design", "Construction Supervision"],
    summary: "Complete industrial design and supervision including sterile processing zones, controlled-environment ventilation, water supply and wastewater treatment. Sterile-zone architecture and waste management transferable to hospital laboratory and sterile supply design.",
    contractValue: 320_000_000,
    currency: "USD",
    startDate: new Date("2019-09-01"),
    endDate: new Date("2021-12-31"),
    trustLevel: "REVIEWED",
  },
  {
    name: "Demo Heritage Building Renovation",
    clientName: "Demo Cultural Foundation",
    country: "Demo Country",
    sector: "Heritage Conservation",
    serviceAreas: ["Structural Assessment", "Architectural Modification", "Interior Design", "Contract Administration"],
    summary: "Structural assessment of an existing heritage building, complete architectural and structural modification design, interior design, BOQ, and construction supervision. Direct evidence of the firm's competency in assessing and retrofitting existing premises for new functional use.",
    contractValue: 11_500_000,
    currency: "USD",
    startDate: new Date("2022-04-01"),
    endDate: new Date("2024-03-15"),
    trustLevel: "REVIEWED",
  },
  {
    name: "Demo School Campus (G+2 + Annex)",
    clientName: "Demo Education Bureau",
    country: "Demo Country",
    sector: "Education",
    serviceAreas: ["Architectural Design", "Structural Design", "MEP Design", "Site Supervision"],
    summary: "New campus design with classrooms, laboratories, library, administration block, sanitation (pupil-ratio compliant), and sports facilities. Climate-responsive design with natural ventilation, daylighting, and accessibility features throughout.",
    contractValue: 56_000_000,
    currency: "USD",
    startDate: new Date("2020-08-01"),
    endDate: new Date("2022-07-31"),
    trustLevel: "REVIEWED",
  },
];

async function main() {
  // Production guard (audit DB-001 / TEST-010, 2026-06-20). This seeder
  // destructively wipes Experts and Projects on the seed admin's company
  // (see `prisma.expert.deleteMany` / `prisma.project.deleteMany` below).
  // If an operator accidentally runs `npm run db:demo-seed` against a
  // production DATABASE_URL, real Experts and Projects are irrecoverably
  // deleted and replaced with "Acme Engineering" demo data.
  //
  // The guard refuses to run unless either:
  //   - NODE_ENV is "development" or "test", OR
  //   - the operator explicitly sets DEMO_SEED_ALLOWED=1 (escape hatch for
  //     staging environments that intentionally want demo data).
  const isDevOrTest = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const explicitAllow = ["1", "true", "yes"].includes((process.env.DEMO_SEED_ALLOWED || "").trim().toLowerCase());
  if (!isDevOrTest && !explicitAllow) {
    console.error(
      "Demo seeder REFUSED: NODE_ENV is not 'development'/'test' and DEMO_SEED_ALLOWED is not set.\n" +
      "This seeder destructively wipes Experts and Projects on the seed admin's company.\n" +
      "If you are sure you want to run it against this database, set DEMO_SEED_ALLOWED=1 and re-run.\n" +
      "Aborting to protect production data."
    );
    process.exit(2);
  }

  console.log("Demo seeder starting...");

  const adminEmail = "admin@hope.local";
  const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    console.error(`Demo seeder requires the seed admin user (${adminEmail}). Run \`npm run db:seed\` first.`);
    process.exit(1);
  }

  // Upsert the demo company onto the admin user.
  const existing = await prisma.company.findUnique({ where: { userId: admin.id } });
  const company = await prisma.company.upsert({
    where: { userId: admin.id },
    create: {
      ...DEMO_COMPANY,
      serviceLines: JSON.stringify(DEMO_COMPANY.serviceLines),
      sectors: JSON.stringify(DEMO_COMPANY.sectors),
      setupCompletedAt: new Date(),
      userId: admin.id,
    },
    update: {
      ...DEMO_COMPANY,
      serviceLines: JSON.stringify(DEMO_COMPANY.serviceLines),
      sectors: JSON.stringify(DEMO_COMPANY.sectors),
      setupCompletedAt: existing?.setupCompletedAt ?? new Date(),
    },
  });
  console.log(`Demo company: ${company.name} (${company.id})`);

  // Wipe existing demo experts and projects on the company so the seeder is idempotent.
  await prisma.expert.deleteMany({ where: { companyId: company.id } });
  await prisma.project.deleteMany({ where: { companyId: company.id } });

  for (const expert of DEMO_EXPERTS) {
    await prisma.expert.create({
      data: {
        ...expert,
        disciplines: JSON.stringify(expert.disciplines),
        sectors: JSON.stringify(expert.sectors),
        certifications: JSON.stringify(expert.certifications),
        companyId: company.id,
        reviewedAt: new Date(),
        reviewedBy: admin.id,
        reviewNotes: "Reviewed during demo seed.",
      },
    });
  }
  console.log(`Created ${DEMO_EXPERTS.length} REVIEWED experts.`);

  for (const project of DEMO_PROJECTS) {
    await prisma.project.create({
      data: {
        ...project,
        serviceAreas: JSON.stringify(project.serviceAreas),
        companyId: company.id,
        reviewedAt: new Date(),
        reviewedBy: admin.id,
        reviewNotes: "Reviewed during demo seed.",
      },
    });
  }
  console.log(`Created ${DEMO_PROJECTS.length} REVIEWED projects.`);

  // App settings — opt into branding by default for the demo so the proposal
  // demonstrates the per-page contact band and letterhead application path.
  await prisma.appSettings.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      defaultCurrency: "USD",
      aiStrictMode: true,
      allowBrandingDefault: true,
      allowSignatureDefault: true,
      allowStampDefault: true,
      exportFormat: "DOCX",
      pageNumbering: true,
      includeTableOfContents: true,
      language: "en",
    },
    update: {},
  });

  console.log("Demo seed complete.");
  console.log("");
  console.log("Login: admin@hope.local / Admin123!");
  console.log("Open: /dashboard/company  to see the populated knowledge vault");
  console.log("Open: /dashboard/tenders/new  to upload a tender and run the engine");
}

main()
  .catch((error) => {
    console.error("Demo seeder failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
