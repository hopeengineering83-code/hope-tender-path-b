type TenderOwnershipClient = {
  tender: {
    findFirst(args: {
      where: { id: string; userId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * Resolve tender ownership before any proposal-generation job row is created.
 *
 * A foreign or missing tender ID must be indistinguishable and must produce
 * zero AiJob side effects.
 */
export async function userOwnsTenderForProposalJob(
  prisma: TenderOwnershipClient,
  tenderId: string,
  userId: string,
): Promise<boolean> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: { id: true },
  });
  return Boolean(tender);
}
