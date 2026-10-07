-- MercadoFácil PDV — schema inicial Supabase (substituindo Base44 entities)
-- Cole no SQL Editor do Supabase e execute.

create extension if not exists "pgcrypto";

-- Perfis (espelha User Base44 + auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'admin' check (role in ('admin', 'user')),
  company_id uuid,
  company_role text,
  platform_admin boolean default false,
  plan text,
  plan_status text default 'none',
  plan_expires_at timestamptz,
  trial_started_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  trade_name text,
  legal_name text,
  document text,
  phone text,
  email text,
  cep text,
  address text,
  address_number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  status text default 'active',
  plan text,
  plan_status text default 'trial',
  plan_expires_at timestamptz,
  trial_started_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles
  drop constraint if exists profiles_company_id_fkey;
alter table public.profiles
  add constraint profiles_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete set null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  barcode text,
  reference text,
  price numeric default 0,
  cost numeric default 0,
  average_cost numeric default 0,
  stock numeric default 0,
  min_stock numeric default 5,
  category text,
  subcategory text,
  brand text,
  channels text,
  unit text default 'UN',
  image_url text,
  notes text,
  promo boolean default false,
  fiscal_info text,
  active boolean default true,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  phone text,
  email text,
  birthday date,
  cep text,
  address text,
  address_number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  credit_limit numeric default 0,
  credit_balance numeric default 0,
  client_id text,
  notes text,
  nickname text,
  trade_name text,
  legal_name text,
  ie text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  status text default 'aberto',
  opening_balance numeric default 0,
  closing_balance numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  opened_by_name text,
  sales_total numeric default 0,
  sales_count numeric default 0,
  notes text,
  terminal_id text,
  terminal_name text,
  client_id text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  number bigint,
  items jsonb default '[]'::jsonb,
  subtotal numeric default 0,
  discount numeric default 0,
  total numeric not null default 0,
  payment_method text,
  amount_received numeric default 0,
  change numeric default 0,
  status text default 'concluida',
  pix_payment_id text,
  pix_external_reference text,
  customer_id text,
  customer_name text,
  cash_register_id text,
  client_id text,
  terminal_id text,
  terminal_name text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_date timestamptz default now()
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  description text,
  amount numeric default 0,
  due_date date,
  status text,
  type text,
  category text,
  payment_method text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id text,
  product_name text,
  type text,
  quantity numeric default 0,
  reason text,
  client_id text,
  terminal_id text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  created_date timestamptz default now()
);

create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  status text,
  customer_name text,
  customer_phone text,
  address text,
  items jsonb default '[]'::jsonb,
  subtotal numeric default 0,
  delivery_fee numeric default 0,
  discount numeric default 0,
  total numeric default 0,
  payment_method text,
  notes text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  type text,
  description text,
  severity text,
  amount numeric,
  discrepancy numeric,
  cash_register_id text,
  sale_number bigint,
  payment_method text,
  details text,
  user_name text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now(),
  created_date timestamptz default now()
);

create table if not exists public.nfces (
  id uuid primary key default gen_random_uuid(),
  sale_id text,
  status text,
  xml text,
  key text,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz default now()
);

-- Trigger: cria profile ao registrar usuário
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'admin'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS permissivo inicial (ajustar por company_id depois)
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.cash_registers enable row level security;
alter table public.sales enable row level security;
alter table public.bills enable row level security;
alter table public.stock_movements enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.activity_logs enable row level security;
alter table public.nfces enable row level security;

create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "authenticated_all_companies" on public.companies
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_products" on public.products
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_customers" on public.customers
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_categories" on public.categories
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_brands" on public.brands
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_cash" on public.cash_registers
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_sales" on public.sales
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_bills" on public.bills
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_stock" on public.stock_movements
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_delivery" on public.delivery_orders
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_logs" on public.activity_logs
  for all to authenticated using (true) with check (true);

create policy "authenticated_all_nfces" on public.nfces
  for all to authenticated using (true) with check (true);
