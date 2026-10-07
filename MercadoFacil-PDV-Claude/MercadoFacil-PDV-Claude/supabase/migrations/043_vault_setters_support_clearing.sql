-- Correction to 039's set_payment_secrets/set_fiscal_secrets: the original
-- direct-column UPDATE let the caller explicitly clear a secret (empty string
-- -> column set to null). The vault-backed versions only had "not null ->
-- write" / "null -> skip", losing that ability. Add a 3-way convention used
-- consistently by both functions: NULL = don't touch (field wasn't part of
-- the request), '' = clear (delete the vault secret + null the id column),
-- non-empty = create/update.

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
    if cur.mp_access_token_id is not null then perform vault.delete_secret(cur.mp_access_token_id); end if;
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
    if cur.mp_webhook_secret_id is not null then perform vault.delete_secret(cur.mp_webhook_secret_id); end if;
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
    if cur.certificate_pfx_id is not null then perform vault.delete_secret(cur.certificate_pfx_id); end if;
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
    if cur.certificate_password_id is not null then perform vault.delete_secret(cur.certificate_password_id); end if;
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
    if cur.nfse_client_secret_id is not null then perform vault.delete_secret(cur.nfse_client_secret_id); end if;
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
