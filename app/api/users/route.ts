import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../lib/prisma";
import { requireRole, unauthorizedResponse, forbiddenResponse } from "../../../lib/auth";
import { logAction } from "../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../lib/rate-limit";

export async function GET() {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`user-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const { name, email, password, role } = body as { name?: string; email?: string; password?: string; role?: string };

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const validRoles = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"];
  if (role && !validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  await prismaReady;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: name || null, email, passwordHash, role: role || "PROPOSAL_MANAGER" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  await logAction({
    userId: actor.id,
    action: "CREATE",
    entityType: "User",
    entityId: user.id,
    description: `Admin created user ${email} with role ${user.role}`,
  });

  return NextResponse.json({ user }, { status: 201 });
}
