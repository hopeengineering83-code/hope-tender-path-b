import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getReleaseGuardianReport } from "../../../../lib/release-guardian";

export default async function ReleaseGuardianPage() {
  // Dashboard layouts and pages may render concurrently. Do not rely on the
  // parent layout to win the race for anonymous requests: requireRole throws
  // an API-style Error which Next logs as a server failure before the layout's
  // redirect completes. Page authorization must use an explicit redirect.
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const report = await getReleaseGuardianReport();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">System Safety Center</h1>
      <p>{report.safeToRelease ? "No critical blockers" : "Critical blockers detected"}</p>
      <ul>
        {report.checks.map((check) => <li key={check.key}>{check.severity}: {check.title} — {check.detail}</li>)}
      </ul>
    </div>
  );
}
