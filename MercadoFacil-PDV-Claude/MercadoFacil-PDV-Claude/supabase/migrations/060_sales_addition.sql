-- Acréscimo (addition) da venda existe em CheckoutDialog.jsx (campo "+" ao
-- lado do desconto, soma em adjustedTotal) desde sempre, mas nunca teve
-- coluna própria em sales — PDV.jsx nunca gravava paymentData.addition. A
-- trigger de integridade (049_sales_total_integrity.sql) recalcula
-- new.total := subtotal - discount, sem acréscimo nenhum: qualquer venda com
-- addition > 0 grava total menor que o valor real cobrado, e a trigger de
-- payments (053_sales_payments.sql, que roda depois dessa por ordem
-- alfabética) rejeita porque a soma de payments[] (baseada no adjustedTotal
-- do cliente, com acréscimo) não bate mais com o total recém-recalculado
-- (sem acréscimo) — a venda falha no INSERT. Online isso bloqueia a venda;
-- offline a venda já foi salva local (dataLayer.js createSaleOffline) e fica
-- presa na fila de sincronização para sempre (erro não é conflito de
-- unicidade, sync nunca reconcilia).
--
-- Fix: acréscimo vira coluna própria, mesma tratativa que discount já tem —
-- aceito do cliente (não há nada a validar contra os itens, é um valor geral
-- da venda, igual discount) e entra na fórmula do total recalculado.
alter table public.sales
  add column if not exists addition numeric not null default 0;

create or replace function public.sales_recompute_totals()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric := 0;
begin
  select coalesce(sum(
    case
      when jsonb_typeof(item -> 'total') = 'number' then (item ->> 'total')::numeric
      else 0
    end
  ), 0)
  into v_subtotal
  from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) as item;

  new.subtotal := greatest(v_subtotal, 0);
  new.total := greatest(v_subtotal - coalesce(new.discount, 0) + coalesce(new.addition, 0), 0);
  return new;
end;
$$;
