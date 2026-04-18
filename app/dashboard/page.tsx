import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard Working ✅</h1>
        <p className="text-sm text-gray-600">
          You are successfully logged in.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Company Vault</h2>
          <p className="mt-2 text-sm text-gray-500">
            Ready for the next step.
          </p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Tenders</h2>
          <p className="mt-2 text-sm text-gray-500">
            Ready for the next step.
          </p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Compliance</h2>
          <p className="mt-2 text-sm text-gray-500">
            Ready for the next step.
          </p>
        </div>
      </div>
    </div>
  );
}
