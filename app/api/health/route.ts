import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // Database
  try {
    await prismaReady;
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.database = { ok: true, detail: "Connected" };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

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
