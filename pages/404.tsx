export default function Custom404() {
  return (
    <main style={{ minHeight: "100vh", padding: "64px 24px", fontFamily: "Arial, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: 32, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 24 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>404</p>
        <h1 style={{ margin: "12px 0 0", fontSize: 32, lineHeight: 1.1 }}>Page not found</h1>
        <p style={{ marginTop: 16, color: "#475569" }}>The page you requested does not exist.</p>
      </section>
    </main>
  );
}
