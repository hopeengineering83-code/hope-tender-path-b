import { prisma } from "../lib/prisma";
import { classifyReferenceNumber, classifySubmissionMethod } from "../lib/engine/tender-facts-ledger";
import { createHash } from "node:crypto";

async function backfill() {
  const tenders = await prisma.tender.findMany({ include: { facts: true } });
  
  for (const tender of tenders) {
    const legacy = tender as any;
    const ops = [];

    if (legacy.reference && !tender.facts.some(f => f.semanticKey === "reference_number")) {
      const ref = classifyReferenceNumber(legacy.reference);
      if (ref.isValid) {
        ops.push(prisma.tenderFact.create({
          data: {
            tenderId: tender.id, semanticKey: "reference_number", displayLabel: "Reference Number",
            category: "tender_identity", valueType: "TEXT", normalizedValue: legacy.reference,
            authorityState: ref.state, rawSourceValue: legacy.reference,
            sourceHash: createHash("sha256").update(legacy.reference).digest("hex")
          }
        }));
      }
    }

    if (legacy.submissionMethod && !tender.facts.some(f => f.semanticKey === "submission_method")) {
      const method = classifySubmissionMethod(legacy.submissionMethod);
      if (method.isValid) {
        ops.push(prisma.tenderFact.create({
          data: {
            tenderId: tender.id, semanticKey: "submission_method", displayLabel: "Submission Method",
            category: "submission", valueType: "ENUM", normalizedValue: method.normalized,
            authorityState: method.state, rawSourceValue: legacy.submissionMethod
          }
        }));
      }
    }

    if (ops.length > 0) await prisma.$transaction(ops);
  }
  console.log("Backfill complete.");
}

backfill().catch(console.error);
