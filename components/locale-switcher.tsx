"use client";
import { useRouter } from "next/navigation";

export function LocaleSwitcher({ currentLocale }: { currentLocale: string }) {
  const router = useRouter();

  async function switchLocale(locale: string) {
    await fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <button
        onClick={() => switchLocale("en")}
        className={`px-2 py-1 rounded ${currentLocale === "en" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`}
      >
        EN
      </button>
      <button
        onClick={() => switchLocale("ar")}
        className={`px-2 py-1 rounded ${currentLocale === "ar" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`}
        dir="rtl"
      >
        ع
      </button>
    </div>
  );
}
