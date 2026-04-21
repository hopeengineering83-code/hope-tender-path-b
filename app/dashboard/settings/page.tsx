export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Company behavior, branding defaults, export settings, and workflow guardrails will live here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          This page is prepared for AI strict mode, default branding permissions, export format controls,
          and future multilingual configuration.
        </p>
      </div>
    </div>
  );
}
