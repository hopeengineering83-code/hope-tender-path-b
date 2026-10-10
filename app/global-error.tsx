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
        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", fontFamily: "Arial, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
          <section style={{ maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-flex", height: 48, width: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, background: "#0f172a", color: "#ffffff", fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
                H
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#0f172a" }}>Hope Tender</h1>
              <p style={{ marginTop: 4, fontSize: 14, color: "#64748b" }}>Hope Urban Planning Architectural and Engineering Consultancy</p>
            </div>
            <div style={{ padding: 32, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 24, display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: 0.08 }}>Application error</p>
                <h2 style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600, color: "#0f172a" }}>Something went wrong</h2>
                <p style={{ marginTop: 8, fontSize: 14, color: "#475569" }}>The application could not render this page.</p>
                {error?.digest ? <p style={{ marginTop: 16, color: "#64748b", fontSize: 12 }}>Error digest: {error.digest}</p> : null}
              </div>
              <button
                type="button"
                onClick={reset}
                style={{ border: 0, borderRadius: 12, background: "#0f172a", color: "#ffffff", padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
              >
                Try again
              </button>
            </div>
            <p style={{ textAlign: "center", fontSize: 12, color: "#94a3b8" }}>
              AI-powered tender proposal generation &amp; compliance engine
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
