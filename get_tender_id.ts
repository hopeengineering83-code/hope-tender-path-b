import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const tender = await prisma.tender.findFirst();
  console.log(tender?.id);
  await prisma.$disconnect();
}
main();
