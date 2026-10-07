import { useState, useCallback } from "react";

/**
 * Período, busca e status dos relatórios.
 *
 * A barra de filtros do ReportShell era decorativa: escolher datas ou digitar em
 * "Buscar" não mudava nada na tela. O lojista que quisesse o fechamento de um mês
 * específico via sempre o período inteiro achando que era o do filtro.
 */
export function useReportFilters(statusInicial = "ativas") {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState(statusInicial);

  const noPeriodo = useCallback(
    (valor) => {
      if (!de && !ate) return true;
      const dia = paraDia(valor);
      if (!dia) return false;
      if (de && dia < de) return false;
      if (ate && dia > ate) return false;
      return true;
    },
    [de, ate],
  );

  const combina = useCallback(
    (...campos) => {
      const termo = busca.trim().toLowerCase();
      if (!termo) return true;
      return campos.some((c) => String(c ?? "").toLowerCase().includes(termo));
    },
    [busca],
  );

  return {
    de,
    setDe,
    ate,
    setAte,
    busca,
    setBusca,
    status,
    setStatus,
    noPeriodo,
    combina,
  };
}

/** Normaliza timestamp, Date ou "2026-09-16" para "YYYY-MM-DD" no fuso local. */
function paraDia(valor) {
  if (!valor) return null;
  if (typeof valor === "string") {
    const m = valor.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}
