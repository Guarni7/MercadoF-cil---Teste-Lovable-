-- Numeração sequencial da venda no servidor.
-- Antes o número vinha do cliente: online duas caixas podiam gerar o mesmo
-- número, e offline a venda ficava com um timestamp que nunca era reconciliado.
create or replace function public.assign_sale_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.number is null and new.company_id is not null then
    -- Serializa a numeração por empresa dentro da transação.
    perform pg_advisory_xact_lock(hashtext(new.company_id::text));
    select coalesce(max(number), 0) + 1
      into new.number
      from public.sales
     where company_id = new.company_id
       -- Ignora números de timestamp gravados antes desta migração.
       and number < 1000000000000;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_assign_number on public.sales;
create trigger sales_assign_number
  before insert on public.sales
  for each row
  execute function public.assign_sale_number();
