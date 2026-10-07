-- 007: remove policies permissivas que sobraram do 001 (OR com tenant = vazamento)

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
drop policy if exists "profiles_self" on public.profiles;
