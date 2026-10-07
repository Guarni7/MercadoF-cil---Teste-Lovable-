// Dados do fechamento de caixa: vendas e totais do caixa aberto, do servidor e do banco local.
import { supabase } from "@/lib/supabase";
import { api } from "@/api/dataClient";
import { isOnline, loadLocalSales } from "@/lib/dataLayer";
import { unirVendas, lerTodasAsPaginas } from "@/lib/cashClose";

/** Todas as vendas do caixa no servidor (paginado: um caixa pode passar de mil vendas). */
const vendasDoServidor = (registerId) =>
  lerTodasAsPaginas(async (de, ate) => {
    const { data, error } = await supabase
      .from("sales")
      .select("id, client_id, status, total, payment_method, payments, cash_register_id")
      .eq("cash_register_id", registerId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate);
    if (error) throw error;
    return data;
  });

/**
 * Vendas do caixa: servidor (online) + vendas deste terminal ainda sem sincronizar.
 * Online e sem conseguir ler o servidor → lança erro (nunca fecha com total parcial).
 * Offline usa só o banco local.
 */
export async function carregarVendasDoCaixa(register) {
  const locais = (await loadLocalSales()).filter((s) => String(s.cash_register_id) === String(register.id));
  if (!isOnline()) return locais;
  return unirVendas(await vendasDoServidor(register.id), locais);
}

const IDS_POR_CONSULTA = 50; // ids no filtro "in" (a URL do PostgREST tem limite de tamanho)

/**
 * Vendas de VÁRIAS sessões de uma vez (relatório): uma consulta paginada por lote de 50 ids,
 * nunca uma por sessão. Devolve Map(cash_register_id → vendas). Toda sessão pedida tem entrada
 * no mapa (vazia se não teve venda). Lança erro se qualquer lote falhar — sem total parcial.
 */
export async function carregarVendasDasSessoes(registerIds) {
  const ids = [...new Set((registerIds || []).map(String))];
  const porCaixa = new Map(ids.map((id) => [id, []]));
  const lotes = [];
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) lotes.push(ids.slice(i, i + IDS_POR_CONSULTA));
  await Promise.all(
    lotes.map(async (lote) => {
      const vendas = await lerTodasAsPaginas(async (de, ate) => {
        const { data, error } = await supabase
          .from("sales")
          .select("id, client_id, status, total, payment_method, payments, cash_register_id")
          .in("cash_register_id", lote)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate);
        if (error) throw error;
        return data;
      });
      for (const v of vendas) porCaixa.get(String(v.cash_register_id))?.push(v);
    }),
  );
  return porCaixa;
}

/** Vendas + caixa atualizado, juntos: tudo o que resumoDoCaixa precisa. Lança erro se não conseguir ler as vendas. */
export async function carregarDadosDoCaixa(register) {
  const [sales, caixa] = await Promise.all([carregarVendasDoCaixa(register), recarregarCaixa(register)]);
  return { sales, caixa };
}

/** Caixa com os totais de sangria/suprimento/devolução atuais (a tela pode estar desatualizada). */
export async function recarregarCaixa(register) {
  if (!isOnline() || String(register.id).startsWith("local_")) return register;
  try {
    return (await api.entities.CashRegister.get(register.id)) || register;
  } catch {
    return register;
  }
}
