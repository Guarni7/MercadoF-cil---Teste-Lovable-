-- Baixa de estoque + movimentação numa única transação.
-- Sem isso o sync offline podia baixar o estoque e falhar ao gravar a
-- movimentação, deixando a fila em erro e arriscando baixa dupla no retry.
create or replace function public.apply_stock_movement(
  p_client_id text,
  p_product_id uuid,
  p_quantity numeric,
  p_product_name text default null,
  p_type text default 'saida',
  p_reason text default 'venda',
  p_notes text default null,
  p_terminal_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid;
  v_delta numeric;
  v_stock numeric;
begin
  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'client_id obrigatório para movimentação idempotente';
  end if;

  select company_id, stock into v_company_id, v_stock
  from public.products
  where id = p_product_id;

  if v_company_id is null then
    raise exception 'Produto % não encontrado', p_product_id;
  end if;

  -- client_id tem índice único: se já existe, a operação já foi aplicada.
  if exists (select 1 from public.stock_movements where client_id = p_client_id) then
    return jsonb_build_object('applied', false, 'reason', 'already_applied', 'stock', v_stock);
  end if;

  insert into public.stock_movements (
    product_id, product_name, type, quantity, reason, notes,
    client_id, terminal_id, company_id
  )
  values (
    p_product_id::text, p_product_name, p_type, p_quantity, p_reason, p_notes,
    p_client_id, p_terminal_id, v_company_id
  );

  v_delta := case when p_type = 'entrada' then p_quantity else -p_quantity end;

  update public.products
  set stock = coalesce(stock, 0) + v_delta,
      updated_at = now()
  where id = p_product_id
  returning stock into v_stock;

  return jsonb_build_object('applied', true, 'stock', v_stock);
exception
  when unique_violation then
    -- Corrida entre dois terminais sincronizando o mesmo item.
    select stock into v_stock from public.products where id = p_product_id;
    return jsonb_build_object('applied', false, 'reason', 'already_applied', 'stock', v_stock);
end;
$$;

revoke all on function public.apply_stock_movement(
  text, uuid, numeric, text, text, text, text, text
) from public;
grant execute on function public.apply_stock_movement(
  text, uuid, numeric, text, text, text, text, text
) to authenticated;
