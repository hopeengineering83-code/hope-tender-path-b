import { getReleaseGuardianReport } from "../../../../lib/release-guardian";

export default async function ReleaseGuardianPage() {
  const report = await getReleaseGuardianReport();
  return (
    <div>
      <h1>System Safety Center</h1>
      <p>{report.safeToRelease ? "Ready" : "Blocked"}</p>
    </div>
  );
}
