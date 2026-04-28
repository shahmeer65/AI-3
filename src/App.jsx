// src/App.jsx
//
// FRONTEND ONLY — No scoring weights, model data, API keys, or proprietary logic.
// All sensitive computation happens in /.netlify/functions/generate-report
// This file is safe to ship in any public bundle.

import { useState, useRef } from "react";
import "./App.css";

// ─── Markdown → HTML (lightweight, no dependency needed) ─────────────────────
function renderMarkdown(md) {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/^- (.+)$/gm,    "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[h|u|l])/gm, "")
    .replace(/\n/g, "<br/>")
    .trim();
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="spinner" aria-label="Generating report">
      <div /><div /><div /><div />
    </div>
  );
}

// ─── Report display ───────────────────────────────────────────────────────────
function Report({ markdown, address }) {
  const printRef = useRef();

  const handlePrint = () => {
    const win = window.open("", "_blank");
    win.document.write(`
      <html><head><title>Report — ${address}</title>
      <style>
        body { font-family: Georgia, serif; max-width: 720px; margin: 2rem auto; color: #1a1a1a; line-height: 1.7; }
        h1,h2,h3 { font-family: 'Courier New', monospace; }
        ul { padding-left: 1.4rem; }
        strong { font-weight: 700; }
      </style></head><body>
      ${printRef.current.innerHTML}
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="report-wrapper">
      <div className="report-header">
        <div className="report-meta">
          <span className="report-label">INVESTMENT BRIEF</span>
          <span className="report-address">{address}</span>
        </div>
        <button className="btn-ghost" onClick={handlePrint} title="Print report">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print
        </button>
      </div>
      <div
        ref={printRef}
        className="report-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [address,  setAddress]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [report,   setReport]   = useState(null);
  const [error,    setError]    = useState(null);
  const [searched, setSearched] = useState("");

  const isValid = address.trim().length >= 5;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    setReport(null);
    setError(null);
    setSearched(address.trim());

    try {
      const res = await fetch("/.netlify/functions/generate-report", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // ✅ Only sends the address — no model data, no weights, no secrets
        body: JSON.stringify({ address: address.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error (${res.status})`);
      }

      setReport(data.report);

    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setReport(null);
    setError(null);
    setAddress("");
    setSearched("");
  };

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-mark">▪</span>
            <span className="logo-text">SITE<em>IQ</em></span>
          </div>
          <p className="tagline">Proprietary Real Estate Screening</p>
        </div>
      </header>

      {/* ── Search panel ── */}
      <main className="app-main">
        <section className="search-section">
          <h1 className="search-headline">Screen any property.</h1>
          <p className="search-sub">
            Enter a full address to generate an institutional-grade investment brief.
          </p>

          <form className="search-form" onSubmit={handleSubmit}>
            <div className={`input-wrap ${loading ? "input-wrap--loading" : ""}`}>
              <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <input
                type="text"
                className="address-input"
                placeholder="123 Main St, Austin, TX 78701"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                disabled={loading}
                autoComplete="street-address"
                spellCheck={false}
              />
              {address && !loading && (
                <button
                  type="button"
                  className="input-clear"
                  onClick={handleReset}
                  aria-label="Clear"
                >
                  ×
                </button>
              )}
            </div>

            <button
              type="submit"
              className={`btn-primary ${!isValid || loading ? "btn-primary--disabled" : ""}`}
              disabled={!isValid || loading}
            >
              {loading ? "Analyzing…" : "Generate Report"}
            </button>
          </form>
        </section>

        {/* ── Loading state ── */}
        {loading && (
          <section className="loading-section">
            <Spinner />
            <p className="loading-text">Running proprietary scoring model…</p>
            <div className="loading-steps">
              <LoadingStep label="Geocoding address"       delay={0}    done />
              <LoadingStep label="Scoring 6 dimensions"   delay={600}  done={false} />
              <LoadingStep label="Projecting income"      delay={1200} done={false} />
              <LoadingStep label="Drafting brief"         delay={2000} done={false} />
            </div>
          </section>
        )}

        {/* ── Error state ── */}
        {error && !loading && (
          <section className="error-section">
            <div className="error-card">
              <span className="error-icon">⚠</span>
              <p className="error-msg">{error}</p>
              <button className="btn-ghost" onClick={handleReset}>Try again</button>
            </div>
          </section>
        )}

        {/* ── Report ── */}
        {report && !loading && (
          <section className="result-section">
            <Report markdown={report} address={searched} />
            <div className="result-actions">
              <button className="btn-ghost" onClick={handleReset}>
                ← Screen another property
              </button>
            </div>
          </section>
        )}

        {/* ── Empty state ── */}
        {!loading && !report && !error && (
          <section className="empty-state">
            <div className="empty-grid">
              {[
                { icon: "⬡", label: "Composite Score",    sub: "6-dimension weighted model" },
                { icon: "◈", label: "Income Projection",  sub: "NOI, cap rate, cash-on-cash" },
                { icon: "◉", label: "Risk Analysis",      sub: "Flags, overlays, adjustments" },
                { icon: "◫", label: "Buy / Watch / Avoid",sub: "Data-driven verdict" },
              ].map((f) => (
                <div key={f.label} className="empty-card">
                  <span className="empty-icon">{f.icon}</span>
                  <strong>{f.label}</strong>
                  <span>{f.sub}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>For informational purposes only. Not financial advice.</p>
      </footer>
    </div>
  );
}

// ─── Loading step sub-component ───────────────────────────────────────────────
function LoadingStep({ label, delay, done }) {
  const [visible, setVisible] = useState(delay === 0);

  // Reveal each step after its delay
  useState(() => {
    if (delay > 0) {
      const t = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(t);
    }
  }, [delay]);

  if (!visible) return null;
  return (
    <div className="loading-step">
      <span className={`step-dot ${done ? "step-dot--done" : "step-dot--pulse"}`} />
      <span>{label}</span>
    </div>
  );
}
