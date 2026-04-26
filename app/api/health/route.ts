import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // Bootstrap + raw query
  try {
    await prismaReady;
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.database = { ok: true, detail: "Connected" };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // Prisma ORM query — verifies generated client works against actual schema
  try {
    const userCount = await prisma.user.count();
    const adminExists = await prisma.user.findUnique({ where: { email: "admin@hope.local" }, select: { id: true } });
    checks.orm = { ok: true, detail: `user count: ${userCount}, admin seeded: ${adminExists ? "yes" : "no"}` };
  } catch (e) {
    checks.orm = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // Session secret
  checks.session = {
    ok: Boolean(process.env.SESSION_SECRET),
    detail: process.env.SESSION_SECRET
      ? `SESSION_SECRET set (${process.env.SESSION_SECRET.length} chars)`
      : "SESSION_SECRET missing",
  };

  // Required env vars (presence only — values are never returned)
  checks.env = {
    ok: Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET && process.env.GEMINI_API_KEY),
    detail: [
      process.env.DATABASE_URL ? "DATABASE_URL ✓" : "DATABASE_URL ✗",
      process.env.SESSION_SECRET ? "SESSION_SECRET ✓" : "SESSION_SECRET ✗",
      process.env.GEMINI_API_KEY ? "GEMINI_API_KEY ✓" : "GEMINI_API_KEY ✗",
    ].join(", "),
  };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok: allOk, checks }, { status: allOk ? 200 : 503 });
}
