import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (process.env.VERCEL_ENV === "production") throw new Error("E2E seed cannot run in production");

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
if (!email || !password) throw new Error("Missing E2E settings");
if (password.length < 16) throw new Error("E2E password is too short");

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", name: "E2E User" },
    create: { email, passwordHash, role: "ADMIN", name: "E2E User" },
  });
  await prisma.company.upsert({
    where: { userId: user.id },
    update: { name: "E2E Company", setupCompletedAt: new Date() },
    create: { userId: user.id, name: "E2E Company", legalName: "E2E Company", setupCompletedAt: new Date() },
  });
  console.log(JSON.stringify({ seeded: true, userId: user.id }));
} finally {
  await prisma.$disconnect();
}
