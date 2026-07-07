import { prisma } from "../prisma";
import { createHash } from "node:crypto";

export interface EffectiveTenderContext {
  tenderId: string;
  facts: Record<string, any>;
  requirements: any[];
  submissionMethod: string | null;
  submissionEmails: { email: string; evidence?: any }[];
  submissionPortal: string | null;
  submissionAddress: string | null;
  deadline: Date | string | null;
  referenceNumber: string | null;
  title: string | null;
  clientName: string | null;
  snapshotRevision: string;
}

export async function resolveEffectiveTenderContext(tenderId: string): Promise<EffectiveTenderContext> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: { facts: true }
  });
  if (!tender) throw new Error("Tender not found");

  const requirements = await prisma.tenderRequirement.findMany({ where: { tenderId } });

  const factsMap: Record<string, any> = {};
  const emails: { email: string; evidence?: any }[] = [];
  let submissionMethod: string | null = null;
  let submissionPortal: string | null = null;
  let submissionAddress: string | null = null;
  let deadline: any = null;
  let referenceNumber: string | null = null;
  let title: string | null = null;
  let clientName: string | null = null;

  for (const fact of tender.facts) {
    if (fact.authorityState === "REJECTED_EXTRACTION") continue;
    
    factsMap[fact.semanticKey] = {
      value: fact.structuredValue ?? fact.normalizedValue,
      raw: fact.rawSourceValue,
      state: fact.authorityState,
      label: fact.displayLabel,
      category: fact.category,
      evidence: { fileId: fact.sourceFileId, page: fact.sourcePage, quote: fact.sourceQuote, hash: fact.sourceHash }
    };

    if (fact.semanticKey === "submission_method") submissionMethod = fact.normalizedValue;
    if (fact.semanticKey === "submission_email") {
      if (fact.structuredValue && Array.isArray(fact.structuredValue)) {
        emails.push(...fact.structuredValue.map((e: any) => typeof e === 'string' ? { email: e } : e));
      } else if (fact.normalizedValue) {
        emails.push(...fact.normalizedValue.split(',').map(e => ({ email: e.trim() })).filter(e => e.email));
      }
    }
    if (fact.semanticKey === "submission_portal") submissionPortal = fact.normalizedValue;
    if (fact.semanticKey === "submission_address") submissionAddress = fact.normalizedValue;
    if (fact.semanticKey === "deadline") deadline = fact.structuredValue || fact.normalizedValue;
    if (fact.semanticKey === "reference_number") referenceNumber = fact.normalizedValue;
    if (fact.semanticKey === "title") title = fact.normalizedValue;
    if (fact.semanticKey === "client_name") clientName = fact.normalizedValue;
  }

  const legacyTender = tender as any;
  if (!referenceNumber && legacyTender.reference) referenceNumber = legacyTender.reference;
  if (!title && legacyTender.title) title = legacyTender.title;
  if (!clientName && legacyTender.clientName) clientName = legacyTender.clientName;
  if (!submissionMethod && legacyTender.submissionMethod) submissionMethod = legacyTender.submissionMethod;
  if (emails.length === 0 && legacyTender.submissionAddress && submissionMethod === "EMAIL") {
    emails.push({ email: legacyTender.submissionAddress });
  }

  const snapshotData = { facts: tender.facts.map(f => f.updatedAt), reqs: requirements.map(r => r.updatedAt) };
  const snapshotRevision = createHash("sha256").update(JSON.stringify(snapshotData)).digest("hex").slice(0, 16);

  return {
    tenderId: tender.id, facts: factsMap, requirements, submissionMethod,
    submissionEmails: emails, submissionPortal, submissionAddress, deadline,
    referenceNumber, title, clientName, snapshotRevision,
  };
}
