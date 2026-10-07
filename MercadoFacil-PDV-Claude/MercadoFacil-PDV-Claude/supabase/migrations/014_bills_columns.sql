-- Colunas de contas a pagar/receber usadas pela tela Financeiro.
-- Sem elas o PostgREST recusava o insert ("Could not find the 'paid' column")
-- e nenhuma conta podia ser criada nem baixada.
alter table public.bills
  add column if not exists supplier text,
  add column if not exists subcategory text,
  add column if not exists recurring boolean default false,
  add column if not exists paid boolean default false,
  add column if not exists paid_date date,
  add column if not exists notes text;
