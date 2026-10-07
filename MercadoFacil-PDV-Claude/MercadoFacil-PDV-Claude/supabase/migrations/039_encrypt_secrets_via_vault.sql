-- Priority 4 fix (Security Gate): certificate_pfx, certificate_password,
-- mp_access_token, mp_webhook_secret, nfse_client_secret were plain `text`
-- columns — readable in cleartext by anyone with service_role/DB access
-- (backup leak, service_role key compromise, SQL access). RLS already
-- restricts these tables to service_role only; this adds encryption at rest
-- on top, using Supabase's own Vault (pgsodium-backed) rather than inventing
-- crypto. The encryption key never touches the data: Vault manages it
-- separately (KMS-derived root key), the app/frontend never sees it, and it
-- is not stored alongside the ciphertext.

-- 1) New vault-secret-id columns, alongside the old plaintext ones for now.
alter table public.company_payment_secrets
  add column if not exists mp_access_token_id uuid references vault.secrets(id),
  add column if not exists mp_webhook_secret_id uuid references vault.secrets(id);

alter table public.company_fiscal_secrets
  add column if not exists certificate_pfx_id uuid references vault.secrets(id),
  add column if not exists certificate_password_id uuid references vault.secrets(id),
  add column if not exists nfse_client_secret_id uuid references vault.secrets(id);

-- 2) Migrate existing plaintext data into Vault (preserves current secrets —
-- nothing is lost, this only moves where/how they're stored).
do $$
declare r record;
begin
  for r in select company_id, mp_access_token, mp_webhook_secret from public.company_payment_secrets loop
    if r.mp_access_token is not null then
      update public.company_payment_secrets
      set mp_access_token_id = vault.create_secret(r.mp_access_token, 'mp_access_token:' || r.company_id)
      where company_id = r.company_id;
    end if;
    if r.mp_webhook_secret is not null then
      update public.company_payment_secrets
      set mp_webhook_secret_id = vault.create_secret(r.mp_webhook_secret, 'mp_webhook_secret:' || r.company_id)
      where company_id = r.company_id;
    end if;
  end loop;

  for r in select company_id, certificate_pfx, certificate_password, nfse_client_secret from public.company_fiscal_secrets loop
    if r.certificate_pfx is not null then
      update public.company_fiscal_secrets
      set certificate_pfx_id = vault.create_secret(r.certificate_pfx, 'certificate_pfx:' || r.company_id)
      where company_id = r.company_id;
    end if;
    if r.certificate_password is not null then
      update public.company_fiscal_secrets
      set certificate_password_id = vault.create_secret(r.certificate_password, 'certificate_password:' || r.company_id)
      where company_id = r.company_id;
    end if;
    if r.nfse_client_secret is not null then
      update public.company_fiscal_secrets
      set nfse_client_secret_id = vault.create_secret(r.nfse_client_secret, 'nfse_client_secret:' || r.company_id)
      where company_id = r.company_id;
    end if;
  end loop;
end $$;

-- 3) Drop the plaintext columns now that everything is in Vault.
alter table public.company_payment_secrets drop column mp_access_token;
alter table public.company_payment_secrets drop column mp_webhook_secret;
alter table public.company_fiscal_secrets drop column certificate_pfx;
alter table public.company_fiscal_secrets drop column certificate_password;
alter table public.company_fiscal_secrets drop column nfse_client_secret;

-- 4) Read/write accessors — SECURITY DEFINER, service_role only. Edge
-- Functions call these instead of touching company_payment_secrets /
-- company_fiscal_secrets / vault.decrypted_secrets directly, so the vault
-- plumbing lives in one place. `set_*` upserts: update_secret() when a vault
-- id already exists for that field, create_secret() otherwise (a fresh id is
-- written back), so re-saving settings rotates neither key nor id needlessly.

create or replace function public.get_payment_secrets(p_company_id uuid)
returns table (mp_access_token text, mp_webhook_secret text)
language sql
security definer
set search_path to 'public'
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = s.mp_access_token_id),
    (select decrypted_secret from vault.decrypted_secrets where id = s.mp_webhook_secret_id)
  from public.company_payment_secrets s
  where s.company_id = p_company_id;
$$;
revoke all on function public.get_payment_secrets(uuid) from public;
grant execute on function public.get_payment_secrets(uuid) to service_role;

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

  if p_mp_access_token is not null then
    if cur.mp_access_token_id is not null then
      perform vault.update_secret(cur.mp_access_token_id, p_mp_access_token);
    else
      update public.company_payment_secrets
      set mp_access_token_id = vault.create_secret(p_mp_access_token, 'mp_access_token:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_mp_webhook_secret is not null then
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
revoke all on function public.set_payment_secrets(uuid, text, text) from public;
grant execute on function public.set_payment_secrets(uuid, text, text) to service_role;

create or replace function public.get_fiscal_secrets(p_company_id uuid)
returns table (certificate_pfx text, certificate_password text, nfse_client_id text, nfse_client_secret text)
language sql
security definer
set search_path to 'public'
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = s.certificate_pfx_id),
    (select decrypted_secret from vault.decrypted_secrets where id = s.certificate_password_id),
    s.nfse_client_id,
    (select decrypted_secret from vault.decrypted_secrets where id = s.nfse_client_secret_id)
  from public.company_fiscal_secrets s
  where s.company_id = p_company_id;
$$;
revoke all on function public.get_fiscal_secrets(uuid) from public;
grant execute on function public.get_fiscal_secrets(uuid) to service_role;

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

  if p_certificate_pfx is not null then
    if cur.certificate_pfx_id is not null then
      perform vault.update_secret(cur.certificate_pfx_id, p_certificate_pfx);
    else
      update public.company_fiscal_secrets
      set certificate_pfx_id = vault.create_secret(p_certificate_pfx, 'certificate_pfx:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_certificate_password is not null then
    if cur.certificate_password_id is not null then
      perform vault.update_secret(cur.certificate_password_id, p_certificate_password);
    else
      update public.company_fiscal_secrets
      set certificate_password_id = vault.create_secret(p_certificate_password, 'certificate_password:' || p_company_id)
      where company_id = p_company_id;
    end if;
  end if;

  if p_nfse_client_secret is not null then
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
revoke all on function public.set_fiscal_secrets(uuid, text, text, text, text) from public;
grant execute on function public.set_fiscal_secrets(uuid, text, text, text, text) to service_role;
