import { NextRequest, NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { sendEmail } from "../../../../lib/email";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const urgentTenders = await prisma.tender.findMany({
    where: {
      status: { notIn: ["EXPORTED", "CLOSED"] },
      deadline: { gte: now, lte: in3Days },
    },
    select: {
      id: true,
      title: true,
      deadline: true,
      user: { select: { email: true, name: true } },
    },
  });

  let sent = 0;
  for (const tender of urgentTenders) {
    const daysLeft = Math.ceil((new Date(tender.deadline!).getTime() - Date.now()) / 86_400_000);
    const userName = tender.user.name ?? "there";
    const tenderTitle = tender.title ?? "Untitled Tender";
    await sendEmail({
      to: tender.user.email,
      subject: `⏰ Deadline alert: "${tenderTitle}" is due in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#1e293b">Submission deadline approaching</h2>
          <p>Hi ${userName},</p>
          <p>Your tender <strong>${tenderTitle}</strong> is due in <strong>${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong>.</p>
          <p>Make sure extraction, analysis, metadata, requirements, submission plan, and documents are all validated before export.</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://hopetender.com"}/dashboard/tenders/${tender.id}"
             style="display:inline-block;margin-top:16px;background:#0f172a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Open Tender Workspace →
          </a>
          <p style="margin-top:24px;font-size:12px;color:#94a3b8">Hope Tender · You're receiving this because you have an active tender with an approaching deadline.</p>
        </div>
      `,
    });
    sent++;
  }

  return NextResponse.json({ ok: true, sent, total: urgentTenders.length });
}
