export function LoginRecoveryNote({ error, detail }: { error?: string | null; detail?: string | null }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-800">
      <p className="font-semibold">Login page recovery mode</p>
      {error ? <p className="mt-1">{error}{detail ? ` — ${detail}` : ""}</p> : null}
      <p className="mt-1">
        If you recently saw an Application Error, close this tab completely, open a new tab, and reload this page. The app has been updated to clear old cached browser files.
      </p>
    </div>
  );
}
