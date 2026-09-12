import { prisma } from "./prisma";
import { logger } from "./observability";

export type NotificationType =
  | "TENDER_ANALYZED"
  | "TENDER_GENERATED"
  | "TENDER_DEADLINE_SOON"
  | "KNOWLEDGE_IMPORTED"
  | "BID_OUTCOME_RECORDED"
  | "COMPLIANCE_GAP_FOUND"
  | "SYSTEM";

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  link?: string;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        link: params.link ?? null,
      },
    });
  } catch (e) {
    // Notifications are non-critical — never crash the main flow — but surface
    // the failure so operators can detect notification-pipeline outages (e.g.
    // users silently missing deadline alerts). Previously bare `catch {}`.
    logger.warn("[notifications] createNotification failed", {
      detail: e,
      userId: params.userId,
      type: params.type,
    });
  }
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
