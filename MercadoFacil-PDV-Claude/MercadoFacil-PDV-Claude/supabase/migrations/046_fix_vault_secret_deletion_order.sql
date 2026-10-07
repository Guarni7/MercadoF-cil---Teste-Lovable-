-- Correction to 045: certificate_pfx_id/etc are FK columns referencing
-- vault.secrets(id) — deleting the vault.secrets row BEFORE nulling the
-- referencing column violates the FK constraint (verified live: "update or
-- delete on table secrets violates foreign key constraint ...still
-- referenced"). Null the column first, then delete the now-unreferenced
-- vault row. Verified live afterwards: write 'x'/'y' -> read back 'x'/'y' ->
-- clear pfx only -> read back pfx=null, password='y' unchanged.

create or replace function public.set_payment_secrets(p_company_id uuid, p_mp_access_token text, p_mp_webhook_secret text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare cur record; old_token_id uuid; old_webhook_id uuid;
begin
  select * into cur from public.company_payment_secrets where company_id = p_company_id;
  if not found then
    insert into public.company_payment_secrets (company_id) values (p_company_id);
    cur.mp_access_token_id := null;
    cur.mp_webhook_secret_id := null;
  end if;

  if p_mp_access_token = '' then
    old_token_id := cur.mp_access_token_id;
    update public.company_payment_secrets set mp_access_token_id = null where company_id = p_company_id;
    if old_token_id is not null then delete from vault.secrets where id = old_token_id; end if;
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
    old_webhook_id := cur.mp_webhook_secret_id;
    update public.company_payment_secrets set mp_webhook_secret_id = null where company_id = p_company_id;
    if old_webhook_id is not null then delete from vault.secrets where id = old_webhook_id; end if;
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
declare cur record; old_pfx_id uuid; old_pass_id uuid; old_secret_id uuid;
begin
  select * into cur from public.company_fiscal_secrets where company_id = p_company_id;
  if not found then
    insert into public.company_fiscal_secrets (company_id) values (p_company_id);
    cur.certificate_pfx_id := null;
    cur.certificate_password_id := null;
    cur.nfse_client_secret_id := null;
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

  if p_nfse_client_id is not null then
    update public.company_fiscal_secrets set nfse_client_id = p_nfse_client_id where company_id = p_company_id;
  end if;

  update public.company_fiscal_secrets set updated_at = now() where company_id = p_company_id;
end;
$$;
revoke all on function public.set_fiscal_secrets(uuid, text, text, text, text) from authenticated, anon, public;
grant execute on function public.set_fiscal_secrets(uuid, text, text, text, text) to service_role;
