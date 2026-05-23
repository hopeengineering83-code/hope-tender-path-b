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

async function probeOpenAI(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, detail: "OPENAI_API_KEY not set" };
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
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

async function probeDeepSeek(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, detail: "DEEPSEEK_API_KEY not set" };
  try {
    const res = await fetch("https://api.deepseek.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
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
  // Production accepts ANY one of the four supported providers; PR #422
  // added OpenAI + DeepSeek to the fallback chain but the health
  // endpoint still reported only Anthropic/Gemini. Fixed here so the
  // live readiness signal reflects what the engine actually accepts.
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const hasAnyAIKey = hasAnthropic || hasGemini || hasOpenAI || hasDeepSeek;
  checks.env = {
    ok: Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET) && hasAnyAIKey,
    detail: [
      process.env.DATABASE_URL ? "DATABASE_URL ✓" : "DATABASE_URL ✗",
      process.env.SESSION_SECRET ? "SESSION_SECRET ✓" : "SESSION_SECRET ✗",
      hasAnthropic ? "ANTHROPIC_API_KEY ✓" : "ANTHROPIC_API_KEY ✗",
      hasGemini ? "GEMINI_API_KEY ✓" : "GEMINI_API_KEY ✗",
      hasOpenAI ? "OPENAI_API_KEY ✓" : "OPENAI_API_KEY ✗",
      hasDeepSeek ? "DEEPSEEK_API_KEY ✓" : "DEEPSEEK_API_KEY ✗",
      hasAnyAIKey ? "AI provider ✓" : "AI provider ✗ (set ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY)",
    ].join(", "),
  };

  // AI provider connectivity — lightweight model-list probes (read-only, no cost).
  // Skipped for providers without a key so we don't spam 401s in logs.
  const [anthropicResult, geminiResult, openaiResult, deepseekResult] = await Promise.all([
    hasAnthropic ? probeWithTimeout(probeAnthropic) : Promise.resolve({ ok: false, detail: "ANTHROPIC_API_KEY not set" }),
    hasGemini ? probeWithTimeout(probeGemini) : Promise.resolve({ ok: false, detail: "GEMINI_API_KEY not set" }),
    hasOpenAI ? probeWithTimeout(probeOpenAI) : Promise.resolve({ ok: false, detail: "OPENAI_API_KEY not set" }),
    hasDeepSeek ? probeWithTimeout(probeDeepSeek) : Promise.resolve({ ok: false, detail: "DEEPSEEK_API_KEY not set" }),
  ]);
  checks.anthropic = anthropicResult;
  checks.gemini = geminiResult;
  checks.openai = openaiResult;
  checks.deepseek = deepseekResult;

  // Overall: database + session + at least ONE configured AI provider reachable.
  const aiOk = anthropicResult.ok || geminiResult.ok || openaiResult.ok || deepseekResult.ok;
  const allOk = checks.database.ok && checks.session.ok && aiOk;
  // aiProvider reflects the first reachable provider in the canonical
  // fallback order: Claude → Gemini → OpenAI → DeepSeek.
  const aiProvider = anthropicResult.ok ? "anthropic"
    : geminiResult.ok ? "gemini"
    : openaiResult.ok ? "openai"
    : deepseekResult.ok ? "deepseek"
    : "none";
  return NextResponse.json(
    { ok: allOk, checks, aiProvider },
    { status: allOk ? 200 : 503 }
  );
}
