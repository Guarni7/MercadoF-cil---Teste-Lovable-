-- Configuração fiscal: gravação só para admin da empresa.
--
-- As policies de escrita de company_fiscal_settings, fiscal_document_series,
-- tax_rule_sets e tax_rules (migrations 030 e 032) checavam só a empresa
-- (FOR ALL ... company_id = current_company_id()), então QUALQUER usuário da
-- loja, inclusive o caixa, podia pelo navegador: trocar CNPJ, IE e ambiente
-- (inclusive ligar produção sem certificado — essa regra só existia na Edge
-- Function), mexer em CSC/validade do certificado, reescrever as regras
-- tributárias e fazer a numeração fiscal voltar (número repetido na SEFAZ).
--
-- Papel de empresa: current_company_role() (057) = coalesce(company_role, role),
-- o mesmo critério das Edge Functions (save-fiscal-settings, fiscal-nfce-config).
-- Admin = owner, admin ou platform_admin, igual a stock_settings_admin_write.
--
-- Leitura não muda (as policies de SELECT continuam como estavam).
--
-- fiscal_document_series fica SEM policy de escrita: a numeração só muda por
-- next_fiscal_number() (reserva na emissão) e set_fiscal_next_number()
-- (migration 070, chamada pela Edge Function fiscal-nfce-config, que exige admin
-- e recusa número já usado). Ambas são SECURITY DEFINER restritas a service
-- role, então a emissão e a tela de numeração não dependem de policy.

-- company_fiscal_settings: leitura = tenant_select (mantida); escrita = admin.
drop policy if exists "fiscal_settings_tenant_write" on public.company_fiscal_settings;
drop policy if exists "fiscal_settings_admin_write" on public.company_fiscal_settings;
create policy "fiscal_settings_admin_write" on public.company_fiscal_settings
  for all to authenticated
  using (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  )
  with check (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  );

-- fiscal_document_series: só leitura pelo cliente.
drop policy if exists "fiscal_series_tenant_write" on public.fiscal_document_series;

-- tax_rule_sets / tax_rules: leitura = *_read (base + da empresa, mantida);
-- escrita = admin, só nas linhas da própria empresa.
drop policy if exists "tax_rule_sets_write" on public.tax_rule_sets;
drop policy if exists "tax_rule_sets_admin_write" on public.tax_rule_sets;
create policy "tax_rule_sets_admin_write" on public.tax_rule_sets
  for all to authenticated
  using (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  )
  with check (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  );

drop policy if exists "tax_rules_write" on public.tax_rules;
drop policy if exists "tax_rules_admin_write" on public.tax_rules;
create policy "tax_rules_admin_write" on public.tax_rules
  for all to authenticated
  using (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  )
  with check (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  );
