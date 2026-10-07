-- Políticas do bucket "public" (logo da empresa, foto de produto, planilhas de
-- importação). O bucket existia, mas sem policy de INSERT: todo upload morria
-- com "new row violates row-level security policy".
--
-- Leitura é pública porque o app usa getPublicUrl nos recibos e no menu.
-- Escrita fica presa à pasta da empresa do usuário (primeiro nível do path).

drop policy if exists "public_bucket_read" on storage.objects;
create policy "public_bucket_read"
  on storage.objects for select
  using (bucket_id = 'public');

drop policy if exists "public_bucket_insert_own_company" on storage.objects;
create policy "public_bucket_insert_own_company"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'public'
    and (storage.foldername(name))[1] = (
      select company_id::text from public.profiles where id = auth.uid()
    )
  );

drop policy if exists "public_bucket_update_own_company" on storage.objects;
create policy "public_bucket_update_own_company"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'public'
    and (storage.foldername(name))[1] = (
      select company_id::text from public.profiles where id = auth.uid()
    )
  );

drop policy if exists "public_bucket_delete_own_company" on storage.objects;
create policy "public_bucket_delete_own_company"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'public'
    and (storage.foldername(name))[1] = (
      select company_id::text from public.profiles where id = auth.uid()
    )
  );
