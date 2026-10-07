-- Detalhamento de pagamentos mistos da venda (split-payment).
--
-- CheckoutDialog.jsx já monta payments[] (ex.: R$50 dinheiro + R$50 cartão),
-- mas PDV.jsx só gravava sales.payment_method (um único método) — o
-- detalhamento se perdia. items (jsonb, um array por linha) já é o padrão
-- deste projeto para isso (ver 001_initial_schema.sql); payments segue o
-- mesmo formato em vez de criar uma tabela nova, então herda a RLS de sales
-- de graça (sales_tenant_all, 002_tenant_rls.sql) e sincroniza offline pelo
-- mesmo caminho que items/payment_method já sincronizam (dataLayer.js
-- enqueue("CREATE_SALE", ...) espalha o objeto inteiro, sem whitelist de
-- campos — ver syncService.js:syncCreateSale).
--
-- Cada elemento: { method, amount, label?, transactionId?, pixPaymentId?,
-- pixConfirmationType? } — mesmo shape que CheckoutDialog.jsx já produz em
-- buildCurrentPayment(). transactionId (TEF) e pixPaymentId (Mercado Pago)
-- ficam preservados por linha, não só no nível da venda.
alter table public.sales
  add column if not exists payments jsonb not null default '[]'::jsonb;

-- Mesma estratégia de 049_sales_total_integrity.sql: trigger BEFORE INSERT OR
-- UPDATE, SECURITY INVOKER (roda com o privilégio de quem fez a operação —
-- RLS de sales já restringe à própria empresa, sem precisar de privilégio
-- elevado). Nome escolhido para ordenar depois de trg_sales_recompute_totals
-- (ordem alfabética de trigger — Postgres não usa ordem de criação): total
-- precisa já estar recalculado a partir de items antes de comparar com a
-- soma de payments, senão validaria contra um total ainda não confiável.
--
-- payments vazio (default) não é validado — venda simples sem detalhamento
-- continua funcionando exatamente como antes; a obrigação só existe quando o
-- cliente manda o array preenchido.
create or replace function public.sales_validate_payments()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sum numeric := 0;
  v_bad integer := 0;
begin
  if new.payments is null or jsonb_array_length(new.payments) = 0 then
    return new;
  end if;

  select
    coalesce(sum(
      case when jsonb_typeof(p -> 'amount') = 'number' then (p ->> 'amount')::numeric else 0 end
    ), 0),
    count(*) filter (
      where jsonb_typeof(p -> 'amount') is distinct from 'number'
         or coalesce(p ->> 'method', '') = ''
    )
  into v_sum, v_bad
  from jsonb_array_elements(new.payments) as p;

  if v_bad > 0 then
    raise exception 'payments[] tem lançamento sem method/amount válido';
  end if;

  if abs(v_sum - new.total) > 0.01 then
    raise exception 'Soma dos pagamentos (%) não confere com o total da venda (%)', v_sum, new.total;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sales_validate_payments on public.sales;
create trigger trg_sales_validate_payments
  before insert or update on public.sales
  for each row
  execute function public.sales_validate_payments();
