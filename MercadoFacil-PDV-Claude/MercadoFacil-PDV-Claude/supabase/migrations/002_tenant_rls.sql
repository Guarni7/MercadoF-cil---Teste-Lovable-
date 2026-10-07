-- 002: RLS multi-tenant real (substitui policies permissivas do 001)
-- Rode no SQL Editor após 001.

-- Helper: company do usuário autenticado
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_company_id() from public;
grant execute on function public.current_company_id() to authenticated;

-- Remover policies permissivas
drop policy if exists "profiles_self" on public.profiles;
drop policy if exists "authenticated_all_companies" on public.companies;
drop policy if exists "authenticated_all_products" on public.products;
drop policy if exists "authenticated_all_customers" on public.customers;
drop policy if exists "authenticated_all_categories" on public.categories;
drop policy if exists "authenticated_all_brands" on public.brands;
drop policy if exists "authenticated_all_cash" on public.cash_registers;
drop policy if exists "authenticated_all_sales" on public.sales;
drop policy if exists "authenticated_all_bills" on public.bills;
drop policy if exists "authenticated_all_stock" on public.stock_movements;
drop policy if exists "authenticated_all_delivery" on public.delivery_orders;
drop policy if exists "authenticated_all_logs" on public.activity_logs;
drop policy if exists "authenticated_all_nfces" on public.nfces;

-- profiles: só o próprio usuário
create policy "profiles_select_self" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- companies: bootstrap (sem company ainda) + acesso à própria
create policy "companies_select_own" on public.companies
  for select to authenticated
  using (id = public.current_company_id());
create policy "companies_insert_bootstrap" on public.companies
  for insert to authenticated
  with check (public.current_company_id() is null);
create policy "companies_update_own" on public.companies
  for update to authenticated
  using (id = public.current_company_id())
  with check (id = public.current_company_id());

-- Função genérica de tenant para tabelas com company_id
-- products
create policy "products_tenant_select" on public.products
  for select to authenticated using (company_id = public.current_company_id());
create policy "products_tenant_insert" on public.products
  for insert to authenticated with check (company_id = public.current_company_id());
create policy "products_tenant_update" on public.products
  for update to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "products_tenant_delete" on public.products
  for delete to authenticated using (company_id = public.current_company_id());

-- customers
create policy "customers_tenant_select" on public.customers
  for select to authenticated using (company_id = public.current_company_id());
create policy "customers_tenant_insert" on public.customers
  for insert to authenticated with check (company_id = public.current_company_id());
create policy "customers_tenant_update" on public.customers
  for update to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "customers_tenant_delete" on public.customers
  for delete to authenticated using (company_id = public.current_company_id());

-- categories
create policy "categories_tenant_select" on public.categories
  for select to authenticated using (company_id = public.current_company_id());
create policy "categories_tenant_insert" on public.categories
  for insert to authenticated with check (company_id = public.current_company_id());
create policy "categories_tenant_update" on public.categories
  for update to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "categories_tenant_delete" on public.categories
  for delete to authenticated using (company_id = public.current_company_id());

-- brands
create policy "brands_tenant_select" on public.brands
  for select to authenticated using (company_id = public.current_company_id());
create policy "brands_tenant_insert" on public.brands
  for insert to authenticated with check (company_id = public.current_company_id());
create policy "brands_tenant_update" on public.brands
  for update to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "brands_tenant_delete" on public.brands
  for delete to authenticated using (company_id = public.current_company_id());

-- demais entidades (mesmo padrão; necessárias p/ app não quebrar sob RLS)
create policy "cash_tenant_all" on public.cash_registers
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "sales_tenant_all" on public.sales
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "bills_tenant_all" on public.bills
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "stock_tenant_all" on public.stock_movements
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "delivery_tenant_all" on public.delivery_orders
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "logs_tenant_all" on public.activity_logs
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
create policy "nfces_tenant_all" on public.nfces
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
