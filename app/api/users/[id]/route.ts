import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, requireUser, unauthorizedResponse, forbiddenResponse, destroyAllSessions } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { validatePassword } from "../../../../lib/password-policy";
import { canPerform } from "../../../../lib/security/rbac";
import { logger } from "../../../../lib/observability";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;

  if (!canPerform(actor.role as import("../../../../lib/auth").Role, "USER_ADMIN") && actor.id !== id) {
    return forbiddenResponse();
  }

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

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const { name, role, password, currentPassword } = body as { name?: string; role?: string; password?: string; currentPassword?: string };

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
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    // Non-admins changing own password must supply currentPassword
    if (isSelf && !isAdmin) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password is required" }, { status: 400 });
      }
      const ok = await bcrypt.compare(currentPassword, target.passwordHash ?? "");
      if (!ok) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  // SECURITY (ATOMIC): When a password is changed, the user.update AND the
  // session revocation MUST happen in the same transaction. Without this,
  // a transient DB failure between the update and session deletion would
  // leave old sessions active for up to SESSION_TTL_DAYS (14 days).
  let updated: { id: string; name: string | null; email: string; role: string; updatedAt: Date };
  if (data.passwordHash) {
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, updatedAt: true },
      });
      // Revoke all sessions inside the same transaction.
      await tx.session.deleteMany({ where: { userId: id } });
      return result;
    });
  } else {
    updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, updatedAt: true },
    });
  }

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
