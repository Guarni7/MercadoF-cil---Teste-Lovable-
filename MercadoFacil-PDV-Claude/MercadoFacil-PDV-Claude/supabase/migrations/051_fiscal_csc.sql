-- CSC / ID CSC para QR Code da NFC-e (NT 2015.002).
--
-- O CSC (Código de Segurança do Contribuinte) é segredo: entra no hash do QR
-- Code mas nunca é transmitido nem exibido de volta — mesma regra do
-- certificado, então vai para o Vault (migration 039, corrigida em 046). O
-- ID CSC (idToken) não é segredo: aparece em texto puro no próprio QR Code
-- impresso no cupom, então fica em company_fiscal_settings junto do resto da
-- config fiscal visível à tela.
--
-- Homologação e produção têm CSC/idCSC distintos (o portal da SEFAZ gera um
-- par por ambiente), por isso duas colunas de cada, como o restante da config
-- fiscal já separa os dois ambientes.

alter table public.company_fiscal_secrets
  add column if not exists csc_homologacao_id uuid references vault.secrets(id),
  add column if not exists csc_producao_id uuid references vault.secrets(id);

alter table public.company_fiscal_settings
  add column if not exists csc_id_homologacao text,
  add column if not exists csc_id_producao text,
  add column if not exists csc_updated_at timestamptz;

-- Recria os acessores do Vault incluindo o CSC. Drop + create porque o
-- retorno de get_fiscal_secrets muda de forma (create or replace não permite
-- trocar as colunas de saída).
drop function if exists public.get_fiscal_secrets(uuid);

create or replace function public.get_fiscal_secrets(p_company_id uuid)
returns table (
  certificate_pfx text,
  certificate_password text,
  nfse_client_id text,
  nfse_client_secret text,
  csc_homologacao text,
  csc_producao text
)
language sql
security definer
set search_path to 'public'
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = s.certificate_pfx_id),
    (select decrypted_secret from vault.decrypted_secrets where id = s.certificate_password_id),
    s.nfse_client_id,
    (select decrypted_secret from vault.decrypted_secrets where id = s.nfse_client_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = s.csc_homologacao_id),
    (select decrypted_secret from vault.decrypted_secrets where id = s.csc_producao_id)
  from public.company_fiscal_secrets s
  where s.company_id = p_company_id;
$$;
revoke all on function public.get_fiscal_secrets(uuid) from public;
grant execute on function public.get_fiscal_secrets(uuid) to service_role;

-- Convenção idêntica à de set_payment_secrets/set_fiscal_secrets (046): NULL
-- = não mexe, '' = apaga (limpa a coluna antes de deletar o segredo, senão
-- viola a FK), valor = grava.
drop function if exists public.set_fiscal_secrets(uuid, text, text, text, text);

create or replace function public.set_fiscal_secrets(
  p_company_id uuid,
  p_certificate_pfx text,
  p_certificate_password text,
  p_nfse_client_id text,
  p_nfse_client_secret text,
  p_csc_homologacao text default null,
  p_csc_producao text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cur record;
  old_pfx_id uuid; old_pass_id uuid; old_secret_id uuid;
  old_csc_homolog_id uuid; old_csc_prod_id uuid;
begin
  select * into cur from public.company_fiscal_secrets where company_id = p_company_id;
  if not found then
    insert into public.company_fiscal_secrets (company_id) values (p_company_id);
    cur.certificate_pfx_id := null;
    cur.certificate_password_id := null;
    cur.nfse_client_secret_id := null;
    cur.csc_homologacao_id := null;
    cur.csc_producao_id := null;
  end if;

  if p_certificate_pfx = '' then
    old_pfx_id := cur.certificate_pfx_id;
    update public.company_fiscal_secrets set certificate_pfx_id = null where company_id = p_company_id;
    if old_pfx_id is not null then delete from vault.secrets where id = old_pfx_id; end if;
  elsif p_certificate_pfx is not null then
    if cur.certificate_pfx_id is not null then
      perform vault.update_secret(cur.certificate_pfx_id, p_certificate_pfx);
    else
      update public.company_fiscal_secrets
      set certificate_pfx_id = vault.create_secret(p_certificate_pfx, 'certificate_pfx:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_certificate_password = '' then
    old_pass_id := cur.certificate_password_id;
    update public.company_fiscal_secrets set certificate_password_id = null where company_id = p_company_id;
    if old_pass_id is not null then delete from vault.secrets where id = old_pass_id; end if;
  elsif p_certificate_password is not null then
    if cur.certificate_password_id is not null then
      perform vault.update_secret(cur.certificate_password_id, p_certificate_password);
    else
      update public.company_fiscal_secrets
      set certificate_password_id = vault.create_secret(p_certificate_password, 'certificate_password:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_nfse_client_secret = '' then
    old_secret_id := cur.nfse_client_secret_id;
    update public.company_fiscal_secrets set nfse_client_secret_id = null where company_id = p_company_id;
    if old_secret_id is not null then delete from vault.secrets where id = old_secret_id; end if;
  elsif p_nfse_client_secret is not null then
    if cur.nfse_client_secret_id is not null then
      perform vault.update_secret(cur.nfse_client_secret_id, p_nfse_client_secret);
    else
      update public.company_fiscal_secrets
      set nfse_client_secret_id = vault.create_secret(p_nfse_client_secret, 'nfse_client_secret:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_csc_homologacao = '' then
    old_csc_homolog_id := cur.csc_homologacao_id;
    update public.company_fiscal_secrets set csc_homologacao_id = null where company_id = p_company_id;
    if old_csc_homolog_id is not null then delete from vault.secrets where id = old_csc_homolog_id; end if;
  elsif p_csc_homologacao is not null then
    if cur.csc_homologacao_id is not null then
      perform vault.update_secret(cur.csc_homologacao_id, p_csc_homologacao);
    else
      update public.company_fiscal_secrets
      set csc_homologacao_id = vault.create_secret(p_csc_homologacao, 'csc_homologacao:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_csc_producao = '' then
    old_csc_prod_id := cur.csc_producao_id;
    update public.company_fiscal_secrets set csc_producao_id = null where company_id = p_company_id;
    if old_csc_prod_id is not null then delete from vault.secrets where id = old_csc_prod_id; end if;
  elsif p_csc_producao is not null then
    if cur.csc_producao_id is not null then
      perform vault.update_secret(cur.csc_producao_id, p_csc_producao);
    else
      update public.company_fiscal_secrets
      set csc_producao_id = vault.create_secret(p_csc_producao, 'csc_producao:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_nfse_client_id is not null then
    update public.company_fiscal_secrets set nfse_client_id = p_nfse_client_id where company_id = p_company_id;
  end if;

  update public.company_fiscal_secrets set updated_at = now() where company_id = p_company_id;
end;
$$;
revoke all on function public.set_fiscal_secrets(uuid, text, text, text, text, text, text) from authenticated, anon, public;
grant execute on function public.set_fiscal_secrets(uuid, text, text, text, text, text, text) to service_role;
