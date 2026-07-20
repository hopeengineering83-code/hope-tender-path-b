import Link from "next/link";

// P2 fix: Public landing page previously showed competing actions to unauthenticated users.
// to unauthenticated users. The latter two redirect to login anyway.
// Fix: Single primary "Sign in" CTA. Dashboard/tender creation shown only after auth.

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-slate-50 p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center">
        <div className="w-full rounded-2xl border bg-white p-8 shadow-sm space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Hope Tender Platform</p>
            <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Win-ready proposals, produced faster.</h1>
            <p className="max-w-2xl text-slate-600">
              Build stronger, evidence-backed tender responses with AI-assisted drafting, evaluator simulation, and
              export-ready quality controls.
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Link className="rounded-xl bg-black px-5 py-2.5 text-white font-medium" href="/login">
              Sign in
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">AI Tender Analysis</p>
              <p className="mt-1 text-sm text-slate-600">Extract requirements, scoring logic, and risks from uploaded packs.</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Evidence Mapping</p>
              <p className="mt-1 text-sm text-slate-600">Connect every claim to company projects, experts, and source proof.</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Export Readiness</p>
              <p className="mt-1 text-sm text-slate-600">Run compliance checks before final DOCX and PDF submission.</p>
            </div>
          </div>
        </div>
      </div>
      <footer className="mx-auto mt-6 w-full max-w-4xl shrink-0 px-4 pb-6">
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:text-left">
          <div className="text-xs text-slate-500">
            <span className="font-medium text-slate-700">Hope Tender</span>
            <span className="mx-2 text-slate-300">&middot;</span>
            Hope Urban Planning Architectural and Engineering Consultancy
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <Link href="/login" className="font-medium text-slate-700 hover:text-slate-900 hover:underline">
              Sign in
            </Link>
            <Link href="/forgot-password" className="font-medium text-slate-700 hover:text-slate-900 hover:underline">
              Forgot password
            </Link>
            <span className="text-slate-400">
              &copy; {new Date().getFullYear()}
            </span>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400 sm:text-left">
          AI-powered tender proposal generation &amp; compliance engine
        </p>
      </footer>
    </main>
  );
}
