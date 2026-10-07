-- Cupons/bônus promocionais e histórico de reajuste das assinaturas.
--
-- ESTRUTURA apenas (nada aqui muda preço nem cobra): nenhuma Edge Function usa estas tabelas ainda.
-- Os preços comerciais continuam em src/lib/plans.js e supabase/functions/_shared/plans.ts; cupom é um
-- desconto SEPARADO calculado a cada cobrança (supabase/functions/_shared/cupons.ts), nunca um preço novo.
-- Sem dados: nenhum cupom nem reajuste é criado aqui.
--
-- Segurança: mesmo padrão de connecttef_events (072) — tabelas da PLATAFORMA: RLS ligada, ZERO
-- policies e nenhum grant para anon/authenticated. Só o service role (Edge Functions) lê/escreve.

-- ---------------------------------------------------------------------------
-- 1. Cupons (catálogo)
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  -- 'percent': 0–100 (100 = grátis; "1º mês grátis" = percent 100, 1 ciclo)
  -- 'fixed': valor em R$ descontado por ciclo ("R$ 30 por 3 meses" = fixed 30, 3 ciclos)
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value >= 0),
  -- sobre o que incide: total (plano + adicionais), só o plano ou só os adicionais
  applies_to text not null default 'total' check (applies_to in ('total', 'plan', 'addons')),
  -- quantos ciclos de cobrança (30 dias) o benefício vale depois de resgatado
  cycles integer not null default 1 check (cycles >= 1),
  starts_at timestamptz,
  expires_at timestamptz,
  -- limite total de EMPRESAS que podem resgatar (null = sem limite) e quantas já resgataram
  max_redemptions integer check (max_redemptions is null or max_redemptions >= 1),
  redemptions_count integer not null default 0 check (redemptions_count >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percent_range check (discount_type <> 'percent' or discount_value <= 100),
  constraint coupons_period_order check (starts_at is null or expires_at is null or expires_at > starts_at)
);

-- código único sem diferenciar maiúscula/minúscula
create unique index if not exists coupons_code_upper_idx on public.coupons (upper(code));

alter table public.coupons enable row level security;
revoke all on public.coupons from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Resgates (uso por empresa)
-- ---------------------------------------------------------------------------
create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- TERMOS copiados do cupom no resgate: desativar, expirar ou editar o cupom depois NÃO muda o benefício já
  -- concedido (vale até cycles_used chegar a cycles_total)
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value >= 0),
  applies_to text not null check (applies_to in ('total', 'plan', 'addons')),
  cycles_total integer not null check (cycles_total >= 1),
  cycles_used integer not null default 0 check (cycles_used >= 0 and cycles_used <= cycles_total),
  redeemed_at timestamptz not null default now(),
  -- cada empresa resgata o mesmo cupom UMA vez
  unique (coupon_id, company_id),
  constraint coupon_redemptions_percent_range check (discount_type <> 'percent' or discount_value <= 100)
);

create index if not exists coupon_redemptions_company_idx on public.coupon_redemptions (company_id);

alter table public.coupon_redemptions enable row level security;
revoke all on public.coupon_redemptions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A cobrança guarda o preço-base e o desconto SEPARADOS (auditoria).
--    `amount` continua sendo o valor cobrado; sem cupom: base_amount = amount e desconto 0 (ou null em
--    cobranças antigas).
-- ---------------------------------------------------------------------------
alter table public.pix_charges
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists base_amount numeric(12,2),
  add column if not exists discount_amount numeric(12,2) not null default 0;

-- ---------------------------------------------------------------------------
-- 4. Resgatar um cupom (atômico: a trava na linha do cupom impede passar do limite sob concorrência)
--    Validações iguais a validarCupom() em _shared/cupons.ts. active = false, expires_at, starts_at e o limite
--    impedem NOVOS resgates; quem já resgatou segue com o benefício concedido (volta "already_redeemed").
-- ---------------------------------------------------------------------------
create or replace function public.redeem_coupon(
  p_code text,
  p_company_id uuid
)
returns table (
  r_redeemed boolean,
  r_reason text,
  r_coupon_id uuid,
  r_cycles_total integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_coupon record;
  v_exist record;
  v_now timestamptz := now();
begin
  if p_code is null or btrim(p_code) = '' or p_company_id is null then
    return query select false, 'invalid_coupon'::text, null::uuid, null::integer;
    return;
  end if;

  select * into v_coupon
  from public.coupons c
  where upper(c.code) = upper(btrim(p_code))
  for update;

  if not found then
    return query select false, 'invalid_coupon'::text, null::uuid, null::integer;
    return;
  end if;

  -- Já resgatado por esta empresa: idempotente (não conta de novo).
  select * into v_exist
  from public.coupon_redemptions r
  where r.coupon_id = v_coupon.id and r.company_id = p_company_id;
  if found then
    return query select true, 'already_redeemed'::text, v_coupon.id, v_exist.cycles_total;
    return;
  end if;

  if not v_coupon.active then
    return query select false, 'inactive'::text, v_coupon.id, null::integer;
    return;
  end if;
  if v_coupon.starts_at is not null and v_now < v_coupon.starts_at then
    return query select false, 'not_started'::text, v_coupon.id, null::integer;
    return;
  end if;
  if v_coupon.expires_at is not null and v_now >= v_coupon.expires_at then
    return query select false, 'expired'::text, v_coupon.id, null::integer;
    return;
  end if;
  if v_coupon.max_redemptions is not null and v_coupon.redemptions_count >= v_coupon.max_redemptions then
    return query select false, 'exhausted'::text, v_coupon.id, null::integer;
    return;
  end if;

  insert into public.coupon_redemptions (coupon_id, company_id, discount_type, discount_value, applies_to, cycles_total)
  values (v_coupon.id, p_company_id, v_coupon.discount_type, v_coupon.discount_value, v_coupon.applies_to, v_coupon.cycles);

  update public.coupons
  set redemptions_count = redemptions_count + 1, updated_at = v_now
  where id = v_coupon.id;

  return query select true, 'redeemed'::text, v_coupon.id, v_coupon.cycles;
end;
$$;

revoke all on function public.redeem_coupon(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_coupon(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Consumir UM ciclo do benefício (a ser chamado pela ativação, uma vez por cobrança paga).
--    Devolve quantos ciclos de benefício ainda restam; nunca passa de cycles_total.
-- ---------------------------------------------------------------------------
create or replace function public.consume_coupon_cycle(
  p_coupon_id uuid,
  p_company_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_left integer;
begin
  update public.coupon_redemptions r
  set cycles_used = r.cycles_used + 1
  where r.coupon_id = p_coupon_id
    and r.company_id = p_company_id
    and r.cycles_used < r.cycles_total
  returning r.cycles_total - r.cycles_used into v_left;

  -- null = não havia ciclo a consumir (resgate inexistente ou benefício já esgotado)
  return v_left;
end;
$$;

revoke all on function public.consume_coupon_cycle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_coupon_cycle(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Histórico de reajuste de preço (IPCA ou outro índice). Só REGISTRA; não altera preço.
--    Os preços vigentes estão no código (plans.js / _shared/plans.ts); reajustar = registrar aqui
--    e então mudar o preço lá, manualmente.
-- ---------------------------------------------------------------------------
create table if not exists public.price_adjustments (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('plan', 'addon')),
  -- mesmo id de src/lib/plans.js: 'mei', 'simples', 'pdv_pos', 'tef_sitef', 'whatsapp', 'nfse'
  item_id text not null,
  index_name text not null default 'IPCA',
  percent_applied numeric(8,4) not null check (percent_applied > -100),
  -- início do período acumulado do índice
  base_date date not null,
  applied_at timestamptz not null default now(),
  previous_price numeric(10,2) not null check (previous_price > 0),
  new_price numeric(10,2) not null check (new_price > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists price_adjustments_item_idx
  on public.price_adjustments (item_type, item_id, applied_at desc);

alter table public.price_adjustments enable row level security;
revoke all on public.price_adjustments from public, anon, authenticated;
