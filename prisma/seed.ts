import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import {
  resolveRuntimeBootstrapAdminPolicy,
  BOOTSTRAP_ADMIN_EMAIL,
} from "../lib/bootstrap-admin-policy";

/**
 * Dev/CI seed for the bootstrap admin user.
 *
 * Requires explicit opt-in in EVERY environment: BOOTSTRAP_ADMIN_ENABLED=true
 * and a BOOTSTRAP_ADMIN_PASSWORD that is neither a banned default nor shorter
 * than the minimum. Without both, the seed exits cleanly and reports the
 * policy's own reason rather than guessing at one.
 *
 * This previously called the LOGIN-repair policy, which is permanently
 * disabled, so the seed could not provision an admin under any configuration —
 * it always skipped, and always blamed production opt-in even when running
 * locally with everything set correctly.
 *
 * An existing admin is never touched: the account is created only when absent,
 * so BOOTSTRAP_ADMIN_ENABLED can be turned off again once provisioning is done
 * and sign-in keeps working.
 *
 * Never logs the actual password.
 */
async function main() {
  const policy = resolveRuntimeBootstrapAdminPolicy();
  if (!policy.allowRepair) {
    console.warn(
      `[seed] Skipping bootstrap admin seed: ${policy.reason ?? "the policy refused to allow it"}`,
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
