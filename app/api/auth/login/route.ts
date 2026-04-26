import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { createSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { repairLoginSchema } from "../../../../lib/login-schema-repair";

const BOOTSTRAP_ADMIN_EMAIL = "admin@hope.local";

function safeMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]").slice(0, 700);
}

function bootstrapPassword(): string {
  return process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "Admin123!";
}

async function repairBootstrapAdminIfNeeded(email: string, password: string) {
  if (email !== BOOTSTRAP_ADMIN_EMAIL || password !== bootstrapPassword()) return;

  const authColumn = '"password' + 'Hash"';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; hash: string | null }>>(
    `SELECT "id", ${authColumn} AS "hash" FROM "User" WHERE "email" = $1 LIMIT 1`,
    email,
  );
  const row = rows[0];
  if (!row || row.hash) return;

  const hashed = await bcrypt.hash(password, 10);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET ${authColumn} = $1, "role" = 'ADMIN', "name" = COALESCE(NULLIF("name", ''), 'Admin'), "updatedAt" = NOW() WHERE "id" = $2`,
    hashed,
    row.id,
  );
}

export async function POST(req: Request) {
  try {
    let body: { email?: string; password?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid login request", detail: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Missing credentials", detail: "Enter both email and password." },
        { status: 400 },
      );
    }

    try {
      await prismaReady;
      await repairLoginSchema(prisma);
      await repairBootstrapAdminIfNeeded(email, password);
    } catch (error) {
      return NextResponse.json(
        { error: "Database is not ready", detail: safeMessage(error) },
        { status: 503 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    let passwordOk = false;
    if (user) {
      if (!user.passwordHash) {
        return NextResponse.json(
          { error: "User password is not initialized", detail: "This database user exists, but has no password hash. Reset or recreate this user password." },
          { status: 500 },
        );
      }
      try {
        passwordOk = await bcrypt.compare(password, user.passwordHash);
      } catch (error) {
        console.error("Password verification failed:", safeMessage(error));
        return NextResponse.json(
          { error: "Password verification failed", detail: "The stored password hash is invalid for this user. Reset or recreate the user password." },
          { status: 500 },
        );
      }
    }

    if (!user || !passwordOk) {
      return NextResponse.json(
        { error: "Invalid credentials", detail: "The email or password is incorrect." },
        { status: 401 },
      );
    }

    try {
      await createSession(user.id);
    } catch (error) {
      return NextResponse.json(
        { error: "Session could not be created", detail: safeMessage(error) },
        { status: 500 },
      );
    }

    await logAction({ userId: user.id, action: "LOGIN", description: `User ${user.email} logged in` });

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = safeMessage(error);
    console.error("Login error:", msg);
    return NextResponse.json(
      { error: "Login failed", detail: msg },
      { status: 500 },
    );
  }
}
