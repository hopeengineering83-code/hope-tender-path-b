import { requireRole } from "../../../../lib/auth";
import { getReleaseGuardianReport } from "../../../../lib/release-guardian";

export default async function ReleaseGuardianPage() {
  await requireRole("ADMIN");
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
