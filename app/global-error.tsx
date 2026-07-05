"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", padding: "64px 24px", fontFamily: "Arial, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
          <section style={{ maxWidth: 720, margin: "0 auto", padding: 32, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 24 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: 0.08 }}>Application error</p>
            <h1 style={{ margin: "12px 0 0", fontSize: 32, lineHeight: 1.1 }}>Something went wrong</h1>
            <p style={{ marginTop: 16, color: "#475569" }}>The application could not render this page.</p>
            {error?.digest ? <p style={{ marginTop: 16, color: "#64748b", fontSize: 12 }}>Error digest: {error.digest}</p> : null}
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 28, border: 0, borderRadius: 12, background: "#0f172a", color: "#ffffff", padding: "12px 18px", fontWeight: 700 }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
