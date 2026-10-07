-- 006: client_id para sync offline de catálogo (produtos/grupos/marcas)

alter table public.products add column if not exists client_id text;
alter table public.categories add column if not exists client_id text;
alter table public.brands add column if not exists client_id text;

create unique index if not exists products_client_id_uidx
  on public.products (client_id)
  where client_id is not null and length(trim(client_id)) > 0;

create unique index if not exists categories_client_id_uidx
  on public.categories (client_id)
  where client_id is not null and length(trim(client_id)) > 0;

create unique index if not exists brands_client_id_uidx
  on public.brands (client_id)
  where client_id is not null and length(trim(client_id)) > 0;
