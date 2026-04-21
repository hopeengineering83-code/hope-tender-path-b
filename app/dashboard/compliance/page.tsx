export default function CompliancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compliance Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Mandatory criteria, scored criteria, evidence support, and compliance gaps will be managed here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          This module is prepared for requirement-to-evidence mapping, severity-based compliance gaps,
          override history, and readiness indicators before generation and export.
        </p>
      </div>
    </div>
  );
}
