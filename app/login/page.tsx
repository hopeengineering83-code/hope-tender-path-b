import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { LoginForm } from "../../components/login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Login</h1>
          <p className="text-slate-600">Sign in to continue.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
