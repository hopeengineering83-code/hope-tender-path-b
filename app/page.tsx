import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl border bg-white p-8 shadow-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Hope Tender Proposal Generator</h1>
          <p className="text-slate-600">Production-safe tender engine foundation.</p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Link className="rounded-xl bg-black text-white px-4 py-2" href="/login">
            Login
          </Link>
          <Link className="rounded-xl border px-4 py-2" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
