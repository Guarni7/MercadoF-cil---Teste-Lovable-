import React from "react";

/**
 * Rede de segurança para erro de render não tratado. Sem isto, um throw
 * dentro do React deixa a tela em branco — o operador do PDV vê uma tela
 * vazia sem saber o que aconteceu nem ter como sair dela.
 * Detalhe técnico só aparece em dev (import.meta.env.DEV); em produção a
 * mensagem é genérica, sem stack trace.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f8fafc" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#1e293b" }}>
            Algo deu errado
          </h1>
          <p style={{ color: "#64748b", marginBottom: 16 }}>
            Recarregue a página. Se o problema continuar, entre em contato com o suporte.
          </p>
          {import.meta.env.DEV && (
            <pre style={{ textAlign: "left", fontSize: 12, background: "#f1f5f9", padding: 12, borderRadius: 8, overflow: "auto", maxHeight: 240 }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: "8px 16px", borderRadius: 6, background: "#1e293b", color: "#fff", border: "none", cursor: "pointer" }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
