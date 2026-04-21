import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Seed user already exists:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name: "Admin",
      email,
      passwordHash,
      role: UserRole.ADMIN,
      company: {
        create: {
          name: "Hope Urban Planning Architectural and Engineering Consultancy",
          legalName: "Hope Urban Planning Architectural and Engineering Consultancy",
          description: "Multidisciplinary consultancy workspace",
          knowledgeMode: "FULL_LIBRARY",
          serviceLines: ["Urban Planning", "Architecture", "Engineering Consultancy"],
          sectors: ["Urban Development", "Infrastructure", "Public Sector"],
          profileSummary: "Reusable company knowledge base for tender participation.",
        },
      },
    },
    include: { company: true },
  });

  if (user.company) {
    await prisma.expert.createMany({
      data: [
        {
          companyId: user.company.id,
          fullName: "Amina Hassan",
          title: "Urban Planning Specialist",
          yearsExperience: 14,
          disciplines: ["Urban Planning", "Master Planning"],
          sectors: ["Urban Development", "Municipal Planning"],
          certifications: ["MSc Urban Planning"],
          profile: "Lead planner with extensive strategic planning and public-sector tender experience.",
        },
        {
          companyId: user.company.id,
          fullName: "David Mensah",
          title: "Infrastructure Engineer",
          yearsExperience: 12,
          disciplines: ["Civil Engineering", "Infrastructure Design"],
          sectors: ["Infrastructure", "Transport"],
          certifications: ["PE Civil"],
          profile: "Infrastructure engineer focused on multidisciplinary technical proposal delivery.",
        },
      ],
    });

    await prisma.project.createMany({
      data: [
        {
          companyId: user.company.id,
          name: "Regional Urban Mobility Strategy",
          clientName: "City Development Authority",
          country: "Ghana",
          sector: "Transport",
          serviceAreas: ["Transport Planning", "Urban Planning"],
          summary: "Preparation of strategic mobility and corridor improvement plans.",
          contractValue: 850000,
          currency: "USD",
        },
        {
          companyId: user.company.id,
          name: "Integrated Municipal Infrastructure Plan",
          clientName: "Metropolitan Assembly",
          country: "Ghana",
          sector: "Infrastructure",
          serviceAreas: ["Infrastructure", "Engineering Consultancy"],
          summary: "Integrated municipal roads, drainage, and public facility planning assignment.",
          contractValue: 1250000,
          currency: "USD",
        },
      ],
    });
  }

  console.log("Created seed user:", user.email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
