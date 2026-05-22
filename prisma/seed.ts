import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import {
  resolveBootstrapAdminPolicy,
  BOOTSTRAP_ADMIN_EMAIL,
} from "../lib/bootstrap-admin-policy";

/**
 * Dev/CI seed for the bootstrap admin user.
 *
 * Production guard: when NODE_ENV=production the seed refuses to set the
 * built-in "Admin123!" default. The shared bootstrap-admin policy resolves
 * the safe password and exits cleanly if production has not opted in via
 * BOOTSTRAP_ADMIN_ENABLED=true + a secure BOOTSTRAP_ADMIN_PASSWORD.
 *
 * Never logs the actual password.
 */
async function main() {
  const policy = resolveBootstrapAdminPolicy();
  if (!policy.allowRepair) {
    console.warn(
      "[seed] Skipping bootstrap admin seed because the policy refused to allow it (production without BOOTSTRAP_ADMIN_ENABLED=true, or insecure BOOTSTRAP_ADMIN_PASSWORD).",
    );
    return;
  }

  const email = BOOTSTRAP_ADMIN_EMAIL;
  const password = policy.password;

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
      role: "ADMIN",
      company: {
        create: {
          name: "Hope Urban Planning Architectural and Engineering Consultancy",
          description: "AI-powered tender proposal generation workspace",
        },
      },
    },
  });

  console.log("Created seed user:", user.email);
  if (process.env.NODE_ENV !== "production") {
    // Dev convenience: surface the password only in non-production runs.
    console.log("Password:", password);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
