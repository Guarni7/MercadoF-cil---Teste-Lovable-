export const formatBRL = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

// Arredondamento monetário padrão (2 casas, meio pra cima). Necessário pra
// itens com quantidade fracionária (produto pesável: 1,250 kg x R$7,90/kg =
// R$9,875) — sem isso o valor fica com mais de 2 casas decimais, que não
// existe em dinheiro real.
export const roundMoney = (value) => Math.round((value || 0) * 100) / 100;

/**
 * Datas puras ("2026-09-16", vencimento/nascimento) não têm hora: o `new Date`
 * as lê como meia-noite UTC e, no fuso do Brasil, exibia o dia anterior.
 */
export const formatDate = (date) => {
  if (typeof date === "string") {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return new Date(date).toLocaleDateString("pt-BR");
};

export const formatDateTime = (date) =>
  new Date(date).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });