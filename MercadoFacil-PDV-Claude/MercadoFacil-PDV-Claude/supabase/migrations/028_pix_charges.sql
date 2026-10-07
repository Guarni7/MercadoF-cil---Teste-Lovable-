-- Registro das cobranças PIX geradas.
--
-- O webhook do Mercado Pago chega sem sessão e só traz o id do pagamento. Ele
-- tentava localizar a venda por pix_payment_id, mas no PDV a venda só é criada
-- depois do pagamento confirmado — ou seja, nunca encontrava nada. Guardando a
-- cobrança no momento em que ela é gerada, o webhook descobre a loja pelo id do
-- pagamento e valida a assinatura com o segredo dela.

create table if not exists public.pix_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id text not null,
  external_reference text,
  amount numeric(12,2),
  description text,
  -- 'sale' cobra na conta do lojista; 'platform', na conta da plataforma
  -- (assinatura e add-ons). O webhook precisa saber qual credencial usar.
  purpose text not null default 'sale',
  status text default 'pending',
  sale_id uuid references public.sales(id) on delete set null,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists pix_charges_payment_id_idx
  on public.pix_charges (payment_id);
create index if not exists pix_charges_company_idx
  on public.pix_charges (company_id, created_at desc);

alter table public.pix_charges enable row level security;

drop policy if exists "pix_charges_tenant_select" on public.pix_charges;
create policy "pix_charges_tenant_select" on public.pix_charges
  for select to authenticated
  using (company_id = public.current_company_id());

-- Só as Edge Functions (service role) escrevem: o valor cobrado não pode ser
-- reescrito pelo navegador depois de gerado.
