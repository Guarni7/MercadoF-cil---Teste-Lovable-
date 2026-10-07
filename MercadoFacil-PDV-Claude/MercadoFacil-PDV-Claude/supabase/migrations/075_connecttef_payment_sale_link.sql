-- Liga um pagamento do ConnectTEF (connecttef_payments) à venda que ele pagou.
--
-- O PDV só finaliza a venda com a operação 'aprovado' (conferido de novo no
-- servidor antes de criar a venda) e, logo depois de gravar a venda, chama
-- link_connecttef_payment_to_sale. Cada operação aprovada paga UMA venda: depois de
-- vinculada, não pode ser usada em outra — é o que impede finalizar duas vendas com
-- a mesma aprovação (duplo clique, retry).
--
-- A tela nunca escreve em connecttef_payments (sem policy de escrita): o vínculo
-- passa por esta função, que confere empresa, estado e valor.

alter table public.connecttef_payments
  add column if not exists sale_id uuid references public.sales(id) on delete set null,
  add column if not exists sale_linked_at timestamptz;

create index if not exists connecttef_payments_sale_idx
  on public.connecttef_payments (sale_id) where sale_id is not null;

-- Resultados: 'linked' (vinculou agora) | 'already_linked' (já estava nesta venda).
-- Qualquer outra situação levanta exceção, sem alterar nada:
--   sem empresa / pagamento ou venda de outra empresa / pagamento não aprovado /
--   pagamento já vinculado a OUTRA venda / valor do pagamento maior que o total da venda.
create or replace function public.link_connecttef_payment_to_sale(p_payment_id uuid, p_sale_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  pay public.connecttef_payments%rowtype;
  v_sale_company uuid;
  v_sale_total numeric;
begin
  if v_company is null then
    raise exception 'usuário sem empresa';
  end if;

  select * into pay from public.connecttef_payments where id = p_payment_id for update;
  if not found or pay.company_id <> v_company then
    raise exception 'pagamento não encontrado';
  end if;

  select company_id, total into v_sale_company, v_sale_total from public.sales where id = p_sale_id;
  if v_sale_company is null or v_sale_company <> v_company then
    raise exception 'venda não encontrada';
  end if;

  if pay.status <> 'aprovado' then
    raise exception 'pagamento não está aprovado (%)', pay.status;
  end if;

  if pay.sale_id is not null then
    if pay.sale_id = p_sale_id then
      return 'already_linked';
    end if;
    raise exception 'pagamento já vinculado a outra venda';
  end if;

  if v_sale_total is not null and pay.valor_centavos > round(v_sale_total * 100) then
    raise exception 'valor do pagamento maior que o total da venda';
  end if;

  update public.connecttef_payments
     set sale_id = p_sale_id, sale_linked_at = now(), updated_at = now()
   where id = pay.id;
  return 'linked';
end;
$$;

revoke all on function public.link_connecttef_payment_to_sale(uuid, uuid) from public, anon;
grant execute on function public.link_connecttef_payment_to_sale(uuid, uuid) to authenticated;
