export default function NotFoundPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#173920", color: "#f5f5ef", fontFamily: "DM Sans, system-ui, sans-serif" }}>
      <section style={{ maxWidth: 620, padding: 40, borderRadius: 24, background: "#fbfcf8", color: "#173920", textAlign: "center" }}>
        <p style={{ color: "#a87c4f", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase" }}>Ecology Consulting</p>
        <h1 style={{ margin: "12px 0", fontFamily: "Playfair Display, Georgia, serif", fontSize: 48 }}>Page not found</h1>
        <p>The requested onboarding page is unavailable or the link has expired.</p>
      </section>
    </main>
  );
}
