import Link from "next/link";
import { LoginForm } from "../../components/login-form";
import {
  isLoginPublicErrorCode,
  LoginRecoveryNote,
} from "../../components/login-recovery-note";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; recovered?: string }>;
}) {
  const params = await searchParams;
  const errorCode = isLoginPublicErrorCode(params?.error) ? params.error : null;
  const recovered = params?.recovered === "1";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white text-xl mb-4">
            H
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hope Tender</h1>
          <p className="mt-1 text-sm text-slate-700">Hope Urban Planning Architectural and Engineering Consultancy</p>
        </div>
        <LoginRecoveryNote errorCode={errorCode} recovered={recovered} />
        <div className="rounded-2xl border bg-white p-8 shadow-sm space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sign in to your workspace</h2>
            <p className="mt-0.5 text-sm text-slate-700">Enter your credentials to access the tender engine.</p>
          </div>
          <LoginForm />
          <p className="text-center text-xs text-slate-700">
            Already signed in? <Link href="/dashboard" className="font-medium text-slate-900 hover:underline">Open dashboard</Link>
          </p>
        </div>
        <p className="text-center text-xs text-slate-600">
          AI-powered tender proposal generation &amp; compliance engine
        </p>
      </div>
    </main>
  );
}
