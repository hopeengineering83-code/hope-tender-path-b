import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const CACHE_MS = 30_000;

type PublicHealthSnapshot = {
  ok: boolean;
  status: "ok" | "degraded";
  databaseReachable: boolean;
  timestamp: string;
};

const g = globalThis as unknown as {
  publicHealthSnapshot?: { at: number; value: PublicHealthSnapshot };
};

function snapshot(value: Omit<PublicHealthSnapshot, "timestamp">): PublicHealthSnapshot {
  return { ...value, timestamp: new Date().toISOString() };
}

export async function GET() {
  const cached = g.publicHealthSnapshot;
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.value, {
      status: cached.value.ok ? 200 : 503,
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
    });
  }

  let databaseReachable = false;
  try {
    await prismaReady;
    await prisma.$queryRawUnsafe("SELECT 1");
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }

  const value = snapshot({
    ok: databaseReachable,
    status: databaseReachable ? "ok" : "degraded",
    databaseReachable,
  });
  g.publicHealthSnapshot = { at: Date.now(), value };

  return NextResponse.json(value, {
    status: value.ok ? 200 : 503,
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
  });
}
