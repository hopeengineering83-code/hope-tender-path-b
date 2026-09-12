import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";
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
  // session revocation MUST happen in the same transaction. The previous
  // implementation called destroyAllSessions() AFTER the update, OUTSIDE any
  // transaction — if the DB had a transient failure between the two, the
  // password was changed but all sessions survived for up to SESSION_TTL_DAYS
  // (14 days), defeating the purpose of the reset.
  //
  // This mirrors the token-based password-reset flow in lib/secure-password-reset.ts
  // which wraps both operations in prisma.$transaction.
  //
  // Note: if the admin is changing their OWN password, their current session
  // is also revoked. This is correct — they will need to log in again with
  // the new password. The client-side auth context will detect the invalid
  // session and redirect to /login.
  let updated: { id: string; name: string | null; email: string; role: string; updatedAt: Date };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, updatedAt: true },
      });
      if (password) {
        // Delete ALL sessions for this user (including the caller's own
        // session if isSelf). This forces re-authentication with the new
        // password on every device.
        const deleted = await tx.session.deleteMany({ where: { userId: id } });
        logger.info(`[PUT /api/users/[id]] Password changed for user ${id} — revoked ${deleted.count} session(s)`);
      }
      return result;
    });
  } catch (e) {
    logger.error(`[PUT /api/users/[id]] Atomic password-change + session-revocation FAILED for user ${id}:`, { detail: e });
    return NextResponse.json(
      { error: "Failed to update user — the password was NOT changed and sessions were NOT revoked. Try again." },
      { status: 500 }
    );
  }

  await logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "User",
    entityId: id,
    description: `User ${updated.email} updated${role ? ` (role → ${role})` : ""}${password ? " (password changed — all sessions revoked atomically)" : ""}`,
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
  if (target.deletedAt) {
    return NextResponse.json({ error: "User is already deactivated" }, { status: 409 });
  }

  // Audit C-5: soft-delete instead of hard delete. Setting deletedAt:
  //   - preserves the User row (and therefore all FK references from Tender,
  //     AuditLog, DocumentReview, etc.)
  //   - causes getCurrentUser() to reject the user as no longer authenticated
  //   - is reversible (a future admin can clear deletedAt to restore access)
  // We also atomically revoke all active sessions so stolen cookies stop
  // working immediately. The Tender.user FK is now onDelete: Restrict, so
  // a direct prisma.user.delete() would throw if the user has tenders — the
  // soft-delete path sidesteps that constraint entirely.
  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: actor.id,
      },
    }),
    prisma.session.deleteMany({ where: { userId: id } }),
  ]);

  await logAction({
    userId: actor.id,
    action: "DELETE",
    entityType: "User",
    entityId: id,
    description: `Admin deactivated user ${target.email} (soft-delete — sessions revoked, records preserved)`,
    metadata: { deactivatedEmail: target.email, deactivatedBy: actor.id },
  });

  return NextResponse.json({ success: true });
}
