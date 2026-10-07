-- Estorno financeiro da devolução: valor confiável (nunca aceito do
-- cliente) e impacto no caixa (dinheiro) / crediário.
--
-- 054 já recalculava sale_returns.total a partir da SOMA dos itens
-- enviados, mas confiava no unit_price/total de cada item como o cliente
-- mandou — um payload adulterado podia mandar quantity correta (validada
-- contra o saldo) e um total qualquer, inflando o valor a estornar sem
-- limite. Agora o valor de cada item é recalculado a partir do preço
-- unitário líquido da PRÓPRIA venda original (item.total / item.quantity,
-- mesmo cálculo que a tela já fazia no cliente) — mesmo raciocínio de
-- 049_sales_total_integrity.sql: agregado monetário nunca vem do cliente,
-- só o que é objetivamente verificável no banco (a venda original).
--
-- Caixa: sangria/suprimento (012/013) já são colunas agregadas em
-- cash_registers, atualizadas por leitura-e-escrita da tela (mesmo padrão
-- usado aqui) — returns_total segue o mesmo modelo, sem tabela nova, só para
-- devolução em dinheiro (é o único método que tira dinheiro físico do caixa).
alter table public.cash_registers
  add column if not exists returns_total numeric default 0;

create or replace function public.sale_returns_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sale record;
  v_item jsonb;
  v_product_id text;
  v_qty numeric;
  v_sold numeric;
  v_sold_total numeric;
  v_unit_net numeric;
  v_item_total numeric;
  v_returned numeric;
  v_sum numeric := 0;
begin
  select id, company_id, status, items into v_sale
  from public.sales where id = new.sale_id;

  if v_sale.id is null then
    raise exception 'Venda % não encontrada', new.sale_id;
  end if;
  if v_sale.company_id <> new.company_id then
    raise exception 'Devolução não pode apontar para venda de outra empresa';
  end if;
  if v_sale.status = 'cancelada' then
    raise exception 'Venda já está cancelada — não é possível registrar devolução';
  end if;

  if new.items is null or jsonb_array_length(new.items) = 0 then
    raise exception 'Devolução sem itens';
  end if;

  for v_item in select * from jsonb_array_elements(new.items) loop
    v_product_id := v_item ->> 'product_id';
    v_qty := case when jsonb_typeof(v_item -> 'quantity') = 'number'
                  then (v_item ->> 'quantity')::numeric end;

    if v_product_id is null or v_product_id = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Item de devolução inválido (product_id/quantity)';
    end if;

    select
      coalesce(sum(case when jsonb_typeof(i -> 'quantity') = 'number' then (i ->> 'quantity')::numeric else 0 end), 0),
      coalesce(sum(case when jsonb_typeof(i -> 'total') = 'number' then (i ->> 'total')::numeric else 0 end), 0)
    into v_sold, v_sold_total
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) as i
    where i ->> 'product_id' = v_product_id;

    if v_sold = 0 then
      raise exception 'Produto % não faz parte da venda original', v_product_id;
    end if;

    select coalesce(sum(
      case when jsonb_typeof(ri -> 'quantity') = 'number' then (ri ->> 'quantity')::numeric else 0 end
    ), 0)
    into v_returned
    from public.sale_returns sr
    cross join lateral jsonb_array_elements(sr.items) as ri
    where sr.sale_id = new.sale_id
      and ri ->> 'product_id' = v_product_id;

    if v_returned + v_qty > v_sold + 0.0001 then
      raise exception
        'Quantidade devolvida (%) excede o saldo disponível (%) do produto %',
        v_returned + v_qty, greatest(v_sold - v_returned, 0), v_product_id;
    end if;

    -- Preço unitário líquido vem da venda original, nunca do payload da
    -- devolução — é o que impede estornar mais do que o item realmente
    -- valeu (ex.: mandar quantity=1 válido com total=999999).
    v_unit_net := case when v_sold > 0 then v_sold_total / v_sold else 0 end;
    v_item_total := round(v_unit_net * v_qty, 2);
    v_sum := v_sum + v_item_total;
  end loop;

  -- total e refund_amount são sempre recalculados — nunca aceitos do
  -- cliente, mesmo que ele mande um valor "razoável".
  new.total := v_sum;
  new.refund_amount := v_sum;

  return new;
end;
$$;

drop trigger if exists trg_sale_returns_validate on public.sale_returns;
create trigger trg_sale_returns_validate
  before insert on public.sale_returns
  for each row
  execute function public.sale_returns_validate();
