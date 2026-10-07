-- CRÍTICO: public_bucket_update_own_company (021_storage_policies.sql) tinha
-- USING mas nenhum WITH CHECK. Postgres só valida USING contra a linha ANTES
-- do update em UPDATE — sem WITH CHECK, o valor NOVO de `name` nunca é
-- conferido. Um usuário dono de um objeto na própria pasta (passa no USING)
-- podia fazer UPDATE storage.objects SET name = '<outra_empresa>/x.png' e
-- mover/sobrescrever um caminho dentro da pasta de outra empresa no bucket
-- "public" — falha de isolamento multi-tenant.
--
-- Mesma regra que já existe em public_bucket_insert_own_company: primeira
-- pasta do path precisa ser o company_id do usuário autenticado, tanto na
-- linha antiga (USING) quanto na linha nova (WITH CHECK).
drop policy if exists "public_bucket_update_own_company" on storage.objects;
create policy "public_bucket_update_own_company"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'public'
    and (storage.foldername(name))[1] = (
      select company_id::text from public.profiles where id = auth.uid()
    )
  )
  with check (
    bucket_id = 'public'
    and (storage.foldername(name))[1] = (
      select company_id::text from public.profiles where id = auth.uid()
    )
  );
