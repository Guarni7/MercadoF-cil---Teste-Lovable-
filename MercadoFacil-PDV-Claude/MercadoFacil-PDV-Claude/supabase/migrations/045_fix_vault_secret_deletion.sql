-- Correction to 043: vault.delete_secret() does not exist in this project's
-- Vault version (confirmed live: only vault.create_secret/vault.update_secret
-- are exposed in the vault schema) — the "clear a secret" branch of
-- set_payment_secrets/set_fiscal_secrets would have thrown "function
-- vault.delete_secret does not exist" the first time anyone actually cleared
-- a token in the UI. Delete directly from the underlying vault.secrets table
-- instead (a real table, confirmed to exist).
--
-- NOTE: this version still deletes the vault.secrets row BEFORE nulling the
-- column that references it — violates the FK constraint added in 039
-- (verified live testing it, right after applying this). Kept here for an
-- honest history of what was actually run; see 046 for the corrected
-- ordering. Re-running this file's CREATE OR REPLACE is harmless (046
-- replaces the functions again with the fixed version), but do not treat
-- this file alone as the working implementation.

create or replace function public.set_payment_secrets(p_company_id uuid, p_mp_access_token text, p_mp_webhook_secret text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare cur record;
begin
  select * into cur from public.company_payment_secrets where company_id = p_company_id;
  if not found then
    insert into public.company_payment_secrets (company_id) values (p_company_id);
    cur.mp_access_token_id := null;
    cur.mp_webhook_secret_id := null;
  end if;

  if p_mp_access_token = '' then
    if cur.mp_access_token_id is not null then delete from vault.secrets where id = cur.mp_access_token_id; end if;
    update public.company_payment_secrets set mp_access_token_id = null where company_id = p_company_id;
  elsif p_mp_access_token is not null then
    if cur.mp_access_token_id is not null then
      perform vault.update_secret(cur.mp_access_token_id, p_mp_access_token);
    else
      update public.company_payment_secrets
      set mp_access_token_id = vault.create_secret(p_mp_access_token, 'mp_access_token:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_mp_webhook_secret = '' then
    if cur.mp_webhook_secret_id is not null then delete from vault.secrets where id = cur.mp_webhook_secret_id; end if;
    update public.company_payment_secrets set mp_webhook_secret_id = null where company_id = p_company_id;
  elsif p_mp_webhook_secret is not null then
    if cur.mp_webhook_secret_id is not null then
      perform vault.update_secret(cur.mp_webhook_secret_id, p_mp_webhook_secret);
    else
      update public.company_payment_secrets
      set mp_webhook_secret_id = vault.create_secret(p_mp_webhook_secret, 'mp_webhook_secret:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  update public.company_payment_secrets set updated_at = now() where company_id = p_company_id;
end;
$$;
revoke all on function public.set_payment_secrets(uuid, text, text) from authenticated, anon, public;
grant execute on function public.set_payment_secrets(uuid, text, text) to service_role;

create or replace function public.set_fiscal_secrets(
  p_company_id uuid, p_certificate_pfx text, p_certificate_password text,
  p_nfse_client_id text, p_nfse_client_secret text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare cur record;
begin
  select * into cur from public.company_fiscal_secrets where company_id = p_company_id;
  if not found then
    insert into public.company_fiscal_secrets (company_id) values (p_company_id);
    cur.certificate_pfx_id := null;
    cur.certificate_password_id := null;
    cur.nfse_client_secret_id := null;
  end if;

  if p_certificate_pfx = '' then
    if cur.certificate_pfx_id is not null then delete from vault.secrets where id = cur.certificate_pfx_id; end if;
    update public.company_fiscal_secrets set certificate_pfx_id = null where company_id = p_company_id;
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
    if cur.certificate_password_id is not null then delete from vault.secrets where id = cur.certificate_password_id; end if;
    update public.company_fiscal_secrets set certificate_password_id = null where company_id = p_company_id;
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
    if cur.nfse_client_secret_id is not null then delete from vault.secrets where id = cur.nfse_client_secret_id; end if;
    update public.company_fiscal_secrets set nfse_client_secret_id = null where company_id = p_company_id;
  elsif p_nfse_client_secret is not null then
    if cur.nfse_client_secret_id is not null then
      perform vault.update_secret(cur.nfse_client_secret_id, p_nfse_client_secret);
    else
      update public.company_fiscal_secrets
      set nfse_client_secret_id = vault.create_secret(p_nfse_client_secret, 'nfse_client_secret:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_nfse_client_id is not null then
    update public.company_fiscal_secrets set nfse_client_id = p_nfse_client_id where company_id = p_company_id;
  end if;

  update public.company_fiscal_secrets set updated_at = now() where company_id = p_company_id;
end;
$$;
revoke all on function public.set_fiscal_secrets(uuid, text, text, text, text) from authenticated, anon, public;
grant execute on function public.set_fiscal_secrets(uuid, text, text, text, text) to service_role;
