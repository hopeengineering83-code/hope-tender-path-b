import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { LoginForm } from "../../components/login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white text-xl mb-4">
            H
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hope Tender</h1>
          <p className="mt-1 text-sm text-slate-500">Hope Urban Planning Architectural and Engineering Consultancy</p>
        </div>
        <div className="rounded-2xl border bg-white p-8 shadow-sm space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sign in to your workspace</h2>
            <p className="mt-0.5 text-sm text-slate-500">Enter your credentials to access the tender engine.</p>
          </div>
          <LoginForm />
        </div>
        <p className="text-center text-xs text-slate-400">
          AI-powered tender proposal generation &amp; compliance engine
        </p>
      </div>
    </main>
  );
}
