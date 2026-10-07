-- Venda com devolução registrada não pode ser cancelada.
--
-- Sales.jsx já bloqueia isso na tela, mas qualquer outro caminho (API direta, outro
-- cliente, script) podia marcar a venda como 'cancelada'. Cancelar uma venda que teve
-- devolução (parcial ou total) devolve ao estoque tudo de novo e deixa o dinheiro já
-- estornado descontado do caixa mesmo com a venda fora dos totais. O inverso já existe:
-- sale_returns_validate (054/055) recusa devolução de venda cancelada.
--
-- SECURITY INVOKER (padrão): quem muda a venda é da mesma empresa que as devoluções dela,
-- então o RLS de sale_returns já deixa o trigger enxergá-las; o service role enxerga tudo.
create or replace function public.sales_block_cancel_with_returns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelada'
     and old.status is distinct from 'cancelada'
     and exists (select 1 from public.sale_returns r where r.sale_id = new.id) then
    raise exception 'Venda com devolução registrada não pode ser cancelada';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_block_cancel_with_returns on public.sales;
create trigger trg_sales_block_cancel_with_returns
  before update of status on public.sales
  for each row
  execute function public.sales_block_cancel_with_returns();
