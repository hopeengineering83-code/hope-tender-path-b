import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/auth";
import { classifyReferenceNumber, classifySubmissionMethod } from "../../../../lib/engine/tender-facts-ledger";
import { createHash } from "node:crypto";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "PROPOSAL_MANAGER") {
    return NextResponse.json({ error: "Forbidden: Read-only role" }, { status: 403 });
  }

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: user.role === "ADMIN" ? undefined : user.id },
    include: { facts: true }
  });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const legacy = tender as any;
  const ops = [];

  if (legacy.reference && !tender.facts.some(f => f.semanticKey === "reference_number")) {
    const ref = classifyReferenceNumber(legacy.reference);
    if (ref.isValid) {
      ops.push(prisma.tenderFact.create({
        data: {
          tenderId: id, semanticKey: "reference_number", displayLabel: "Reference Number",
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
          tenderId: id, semanticKey: "submission_method", displayLabel: "Submission Method",
          category: "submission", valueType: "ENUM", normalizedValue: method.normalized,
          authorityState: method.state, rawSourceValue: legacy.submissionMethod
        }
      }));
    }
  }

  if (ops.length > 0) await prisma.$transaction(ops);
  return NextResponse.json({ success: true, repaired: ops.length });
}
