-- Ativação automática de assinatura paga (webhook Mercado Pago), substituindo
-- a dependência exclusiva de ativação manual de platform_admin para esse caso.
-- pix_charges já registra a cobrança; faltava saber QUAL plano/addons ela
-- representa e SE já foi processada (idempotência).
alter table public.pix_charges
  add column if not exists plan_id text,
  add column if not exists addon_ids text[] not null default '{}',
  add column if not exists activated_at timestamptz;

-- Addons contratados e ativos da empresa. companies.plan/plan_status/
-- plan_expires_at já existiam (001); isto só acrescenta o que faltava para
-- persistir os addons junto do plano. A revoke-then-allowlist de 037
-- (`revoke update on public.companies from authenticated`) já cobre esta
-- coluna nova por padrão — nenhum grant adicional necessário, só
-- service_role (dentro das Edge Functions) escreve aqui.
alter table public.companies
  add column if not exists plan_addons text[] not null default '{}';
