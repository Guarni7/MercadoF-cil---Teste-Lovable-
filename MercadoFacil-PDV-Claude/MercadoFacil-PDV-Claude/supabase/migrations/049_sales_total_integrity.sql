-- CRÍTICO (auditoria adversarial 2026-09-18): sales.subtotal/total eram
-- calculados no browser (PDV.jsx) e gravados sem nenhuma verificação
-- server-side — sales_tenant_all (002_tenant_rls.sql) só valida company_id,
-- nunca o valor. Um operador autenticado podia adulterar o total via
-- devtools/console antes do checkout e registrar a venda por qualquer valor,
-- dentro da própria empresa. `items` (jsonb, cada item já com `.total`
-- líquido — mesma fórmula usada em PDV.jsx: max(0, price*quantity -
-- itemDiscount)) é a única fonte objetivamente verificável no banco; vira o
-- cálculo de referência. item_discount não existe como coluna própria (nem
-- em items[], nem em sales) — está absorvido em items[].total desde sempre,
-- então o desconto por item continua sendo aceito como o cliente manda
-- (nenhuma regra nova de desconto é criada aqui); só o AGREGADO (subtotal,
-- total) deixa de ser confiável do cliente e passa a ser a soma dos itens
-- menos o desconto geral da venda (sales.discount, já existente).
--
-- cash_registers.sales_total/sales_count tinham o mesmo problema: PDV.jsx
-- incrementava com o total do cliente (linha ~298-303), e o sync offline
-- fazia o mesmo via sales_total_delta (src/lib/syncService.js, não alterado
-- por esta migration). Cancelamento de venda (Sales.jsx, status='cancelada')
-- nunca decrementava esses campos — CashDialog.jsx já contornava isso na
-- hora de fechar caixa, recalculando os totais por forma de pagamento a
-- partir das vendas reais (mesma exclusão de canceladas usada aqui); mas o
-- campo salvo em cash_registers ficava divergente e era usado direto em
-- CaixaReport.jsx e CashRegister.jsx.
--
-- Estratégia — dois triggers, nenhum SECURITY DEFINER: rodam com o
-- privilégio de quem disparou a operação (SECURITY INVOKER, padrão do
-- Postgres). RLS de sales/cash_registers (cash_tenant_all, sales_tenant_all)
-- já restringe tudo à própria empresa, então não é preciso privilégio
-- elevado — e não cria nenhuma superfície nova de escalonamento (ver
-- observações de segurança no PR). Funciona idêntico para venda online e
-- para venda sincronizada depois do offline: os dois caminhos passam pelo
-- mesmo INSERT (api.entities.Sale.create → supabase.from("sales").insert()),
-- então o mesmo trigger cobre ambos sem tocar em Dexie/sync_queue/
-- syncService.js/localdb.js/service worker.

-- 1) sales: subtotal/total sempre recalculados a partir de items + discount,
--    nunca aceitos como o cliente enviou.
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
  new.total := greatest(v_subtotal - coalesce(new.discount, 0), 0);
  return new;
end;
$$;

drop trigger if exists trg_sales_recompute_totals on public.sales;
create trigger trg_sales_recompute_totals
  before insert or update on public.sales
  for each row
  execute function public.sales_recompute_totals();

-- 2) cash_registers: sales_total/sales_count nunca aceitos do cliente —
--    sempre recomputados a partir das vendas reais da própria empresa, com a
--    mesma regra que o fechamento de caixa já usa (exclui status='cancelada',
--    igual a CashDialog.jsx:75). Dispara em QUALQUER update na linha, então
--    neutraliza tanto o incremento direto (removido do PDV.jsx nesta mudança)
--    quanto o delta do sync offline (syncUpdateCashRegister, não alterado) —
--    não importa a ordem em que cada um chega, o valor final é sempre a
--    soma real.
create or replace function public.cash_registers_enforce_sales_totals()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.sales_total := coalesce((
    select sum(s.total) from public.sales s
    where s.cash_register_id = new.id::text
      and s.status is distinct from 'cancelada'
  ), 0);
  new.sales_count := coalesce((
    select count(*) from public.sales s
    where s.cash_register_id = new.id::text
      and s.status is distinct from 'cancelada'
  ), 0);
  return new;
end;
$$;

drop trigger if exists trg_cash_registers_enforce_sales_totals on public.cash_registers;
create trigger trg_cash_registers_enforce_sales_totals
  before update on public.cash_registers
  for each row
  execute function public.cash_registers_enforce_sales_totals();

-- 3) sales: toda vez que uma venda for criada/alterada/excluída, "toca" o
--    cash_registers correspondente para o trigger acima recalcular na hora.
--    Sem isso, uma venda não dispararia nenhum UPDATE em cash_registers (o
--    incremento direto do PDV.jsx foi removido) e o totalizador ficaria
--    parado em 0 até a próxima operação manual no caixa.
create or replace function public.sales_touch_cash_register()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ids text[];
  v_id text;
begin
  v_ids := array_remove(array[
    case when tg_op in ('INSERT', 'UPDATE') then new.cash_register_id end,
    case when tg_op in ('UPDATE', 'DELETE') then old.cash_register_id end
  ], null);

  foreach v_id in array v_ids loop
    if v_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      update public.cash_registers
        set updated_at = now()
        where id = v_id::uuid;
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sales_touch_cash_register on public.sales;
create trigger trg_sales_touch_cash_register
  after insert or update or delete on public.sales
  for each row
  execute function public.sales_touch_cash_register();
