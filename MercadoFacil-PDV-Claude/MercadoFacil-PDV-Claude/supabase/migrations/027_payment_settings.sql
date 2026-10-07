-- Configuração de pagamento por empresa.
--
-- O PIX era tratado como se existisse uma única conta Mercado Pago para o
-- sistema inteiro (MERCADO_PAGO_ACCESS_TOKEN nos Secrets). Em multi-loja isso
-- significa o pagamento de qualquer cliente cair sempre na mesma conta. Cada
-- lojista usa a conta dele, então o token pertence à empresa.
--
-- O resto da configuração (chave PIX manual, maquininha, TEF) só existia no
-- localStorage: trocar de terminal ou limpar o cache apagava tudo.

create table if not exists public.company_payment_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  pix_mode text not null default 'manual',
  pix_key text,
  pix_key_type text default 'email',
  merchant_name text,
  merchant_city text,
  card_provider text default 'mercadopago',
  card_model text,
  card_enabled boolean default true,
  tef_enabled boolean default false,
  tef_provider text,
  tef_agent_url text,
  tef_terminal_id text,
  -- Espelho seguro do segredo: diz se há token e mostra só o final, para a tela
  -- poder exibir "configurado" sem nunca receber o token.
  mp_token_hint text,
  mp_token_updated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.company_payment_settings enable row level security;

drop policy if exists "payment_settings_tenant_select" on public.company_payment_settings;
create policy "payment_settings_tenant_select" on public.company_payment_settings
  for select to authenticated
  using (company_id = public.current_company_id());

-- Gravação passa pela Edge Function (service role): ela valida se quem chamou é
-- admin da empresa antes de tocar no segredo.
drop policy if exists "payment_settings_tenant_write" on public.company_payment_settings;
create policy "payment_settings_tenant_write" on public.company_payment_settings
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Segredos: sem nenhuma policy. RLS ligada e zero policies = ninguém com a chave
-- anônima lê ou escreve, nem o dono da empresa. Só o service role das Edge
-- Functions, que nunca devolve o token para o navegador.
create table if not exists public.company_payment_secrets (
  company_id uuid primary key references public.companies(id) on delete cascade,
  mp_access_token text,
  mp_webhook_secret text,
  updated_at timestamptz default now()
);

alter table public.company_payment_secrets enable row level security;
revoke all on public.company_payment_secrets from anon, authenticated;
