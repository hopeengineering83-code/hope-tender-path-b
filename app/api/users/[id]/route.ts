import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;
  await prismaReady;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
  });

  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }

  const { id } = await params;
  const isSelf = actor.id === id;
  const isAdmin = actor.role === "ADMIN";

  if (!isSelf && !isAdmin) return forbiddenResponse();

  const body = await req.json();
  const { name, role, password } = body as { name?: string; role?: string; password?: string };

  await prismaReady;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only admins can change roles; non-admin can't promote themselves
  if (role !== undefined && !isAdmin) return forbiddenResponse();

  const validRoles = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"];
  if (role && !validRoles.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name || null;
  if (role !== undefined) data.role = role;
  if (password) {
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, updatedAt: true },
  });

  await logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "User",
    entityId: id,
    description: `User ${updated.email} updated${role ? ` (role → ${role})` : ""}`,
  });

  return NextResponse.json({ user: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;

  if (id === actor.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await prismaReady;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.user.delete({ where: { id } });

  await logAction({
    userId: actor.id,
    action: "DELETE",
    entityType: "User",
    entityId: id,
    description: `Admin deleted user ${target.email}`,
  });

  return NextResponse.json({ success: true });
}
