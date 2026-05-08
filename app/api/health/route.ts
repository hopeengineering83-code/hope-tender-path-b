import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";

const AI_PROBE_TIMEOUT_MS = 5_000;

async function probeWithTimeout(fn: () => Promise<{ ok: boolean; detail: string }>): Promise<{ ok: boolean; detail: string }> {
  return Promise.race([
    fn(),
    new Promise<{ ok: boolean; detail: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, detail: "Timed out after 5s" }), AI_PROBE_TIMEOUT_MS)
    ),
  ]);
}

async function probeAnthropic(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, detail: "ANTHROPIC_API_KEY not set" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (res.ok) {
      const data = await res.json() as { data?: unknown[] };
      return { ok: true, detail: `Reachable — ${Array.isArray(data.data) ? data.data.length : "?"} models available` };
    }
    return { ok: false, detail: `HTTP ${res.status} — ${res.statusText}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function probeGemini(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, detail: "GEMINI_API_KEY not set" };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (res.ok) {
      const data = await res.json() as { models?: unknown[] };
      return { ok: true, detail: `Reachable — ${Array.isArray(data.models) ? data.models.length : "?"} models available` };
    }
    return { ok: false, detail: `HTTP ${res.status} — ${res.statusText}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

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

  // Required env vars (presence only — values are never returned).
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasAnyAIKey = hasAnthropic || hasGemini;
  checks.env = {
    ok: Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET) && hasAnyAIKey,
    detail: [
      process.env.DATABASE_URL ? "DATABASE_URL ✓" : "DATABASE_URL ✗",
      process.env.SESSION_SECRET ? "SESSION_SECRET ✓" : "SESSION_SECRET ✗",
      hasAnthropic ? "ANTHROPIC_API_KEY ✓" : "ANTHROPIC_API_KEY ✗",
      hasGemini ? "GEMINI_API_KEY ✓" : "GEMINI_API_KEY ✗",
      hasAnyAIKey ? "AI provider ✓" : "AI provider ✗ (set ANTHROPIC_API_KEY or GEMINI_API_KEY)",
    ].join(", "),
  };

  // AI provider connectivity — lightweight model-list probes (read-only, no cost)
  [checks.anthropic, checks.gemini] = await Promise.all([
    probeWithTimeout(probeAnthropic),
    probeWithTimeout(probeGemini),
  ]);

  // Overall: database + session + at least one AI provider reachable
  const aiOk = checks.anthropic.ok || checks.gemini.ok;
  const allOk = checks.database.ok && checks.session.ok && aiOk;
  return NextResponse.json(
    { ok: allOk, checks, aiProvider: checks.anthropic.ok ? "anthropic" : checks.gemini.ok ? "gemini" : "none" },
    { status: allOk ? 200 : 503 }
  );
}
