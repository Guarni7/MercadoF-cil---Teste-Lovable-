// Configuração de estoque negativo por empresa.
//
// Estoque negativo fica bloqueado por padrão. A empresa só permite vender
// abaixo de zero se um admin/owner ligar isto explicitamente — RLS
// (057_stock_negative_guard.sql) recusa a escrita de qualquer outro papel,
// então o toggle na tela é só conveniência: quem realmente barra é o banco.
//
// Mesmo espelho em localStorage que fiscalConfig.js/paymentConfig.js usam: o
// PDV precisa saber offline se pode vender sem saldo, sem depender de rede
// no momento do checkout.
import { api } from "@/api/dataClient";
import { supabase } from "@/lib/supabase";

const ESPELHO = "stock_negative_allowed";

/** Config de estoque da empresa, direto do banco. */
export async function carregarConfigEstoque() {
  const rows = await api.entities.CompanyStockSettings.list("-updated_at"); // a tabela não tem created_at (list() sem ordem pede created_at)
  const config = rows?.[0] || null;
  espelharConfig(config);
  return config;
}

function espelharConfig(config) {
  try {
    localStorage.setItem(ESPELHO, JSON.stringify(!!config?.allow_negative_stock));
  } catch {}
}

/**
 * O PDV pergunta isso antes de finalizar a venda, inclusive sem rede. Ligar
 * isto aqui não permite nada por conta própria: quem decide de verdade é
 * apply_stock_movement no banco, que confere a mesma config de novo.
 */
export function estoqueNegativoPermitido() {
  try {
    return !!JSON.parse(localStorage.getItem(ESPELHO) || "false");
  } catch {
    return false;
  }
}

/** Atualiza o espelho a partir do banco, sem travar a tela se estiver offline. */
export async function sincronizarConfigEstoque() {
  try {
    await carregarConfigEstoque();
  } catch (e) {
    console.error("Não foi possível sincronizar a configuração de estoque:", e);
  }
  return estoqueNegativoPermitido();
}

/**
 * Grava direto (upsert por company_id) — a tabela usa company_id como chave
 * primária, como company_fiscal_settings/company_payment_settings, então não
 * há "id" para o wrapper genérico de update. RLS decide sozinha se quem está
 * chamando pode escrever; não admin recebe erro do Postgres, não um 200 falso.
 */
export async function salvarConfigEstoque(allowNegativeStock) {
  const me = await api.auth.me();
  if (!me?.company_id) throw new Error("Usuário sem empresa vinculada");

  const { data, error } = await supabase
    .from("company_stock_settings")
    .upsert(
      { company_id: me.company_id, allow_negative_stock: !!allowNegativeStock, updated_at: new Date().toISOString() },
      { onConflict: "company_id" }
    )
    .select()
    .single();

  if (error) throw error;
  espelharConfig(data);
  return data;
}
