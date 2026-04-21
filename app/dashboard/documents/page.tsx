import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export default async function DocumentsPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      generatedDocuments: { orderBy: [{ exactOrder: "asc" }, { createdAt: "desc" }] },
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Generated Documents</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review planned submission outputs, validation status, file ordering, and exact file names.
        </p>
      </div>

      <div className="space-y-4">
        {tenders.map((tender) => (
          <div key={tender.id} className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                <p className="text-sm text-slate-500">{tender.generatedDocuments.length} planned outputs</p>
              </div>
              <Link href={`/dashboard/tenders/${tender.id}`} className="text-sm text-blue-600 hover:underline">Open workspace</Link>
            </div>

            <div className="mt-4 space-y-2">
              {tender.generatedDocuments.slice(0, 8).map((doc) => (
                <div key={doc.id} className="rounded-xl border px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-900">{doc.exactFileName || doc.name}</p>
                    <span className="text-xs text-slate-500">Order {doc.exactOrder ?? "—"}</span>
                  </div>
                  <p className="mt-1 text-slate-600">{doc.documentType} · {doc.generationStatus} · {doc.validationStatus}</p>
                  {doc.contentSummary && <p className="mt-1 text-xs text-slate-500">{doc.contentSummary}</p>}
                </div>
              ))}
              {tender.generatedDocuments.length === 0 && <p className="text-sm text-slate-400">No document plan yet. Run the tender engine first.</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
