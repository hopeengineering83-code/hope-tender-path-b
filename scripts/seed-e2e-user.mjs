import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
if (!email || !password) throw new Error("Missing E2E settings");
const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({ where: { email }, update: { passwordHash }, create: { email, passwordHash } });
  console.log(user.id);
} finally {
  await prisma.$disconnect();
}
