"use client";

export function LogoutButton({ className }: { className?: string }) {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={handleLogout}
      className={className ?? "w-full text-left text-sm text-gray-500 hover:text-gray-900 py-2 px-3 rounded-lg hover:bg-gray-100 transition-colors"}
    >
      Sign Out
    </button>
  );
}
