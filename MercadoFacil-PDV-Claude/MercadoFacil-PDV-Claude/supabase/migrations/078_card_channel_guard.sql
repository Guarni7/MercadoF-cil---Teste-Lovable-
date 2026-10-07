-- Proteção no banco do canal do cartão (complementa a 077).
--
-- company_payment_settings tinha uma única política "payment_settings_tenant_write" (FOR ALL,
-- só conferia a empresa) e o papel authenticated tem INSERT/UPDATE/DELETE na tabela: quem
-- escrevesse direto, sem passar pela Edge Function save-payment-settings, contornava as
-- regras de card_channel. Agora o próprio banco recusa a escrita direta que:
--   * grave 'smartpos' sem existir Smart POS vinculado à empresa;
--   * grave 'tef' sem endereço do agente TEF.
-- Que card_channel seja maquininha, tef ou smartpos continua garantido pelo check da 077.
--
-- RLS basta: o app só lê a tabela pelo navegador e escreve pela Edge Function (service role,
-- que não passa por RLS e faz a mesma validação por conta própria). A política não enxerga
-- o valor antigo, então vale para o estado final da linha: se um dia o Smart POS deixar de
-- estar vinculado, escrita DIRETA na linha com canal 'smartpos' fica recusada até o canal
-- mudar (a Edge Function não é afetada).

drop policy if exists "payment_settings_tenant_write" on public.company_payment_settings;
drop policy if exists "payment_settings_tenant_insert" on public.company_payment_settings;
drop policy if exists "payment_settings_tenant_update" on public.company_payment_settings;
drop policy if exists "payment_settings_tenant_delete" on public.company_payment_settings;

create policy "payment_settings_tenant_insert" on public.company_payment_settings
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (
      card_channel <> 'smartpos'
      or exists (
        select 1 from public.connecttef_smartpos s
        where s.company_id = company_payment_settings.company_id and s.status = 'vinculado'
      )
    )
    and (card_channel <> 'tef' or btrim(coalesce(tef_agent_url, '')) <> '')
  );

create policy "payment_settings_tenant_update" on public.company_payment_settings
  for update to authenticated
  using (company_id = public.current_company_id())
  with check (
    company_id = public.current_company_id()
    and (
      card_channel <> 'smartpos'
      or exists (
        select 1 from public.connecttef_smartpos s
        where s.company_id = company_payment_settings.company_id and s.status = 'vinculado'
      )
    )
    and (card_channel <> 'tef' or btrim(coalesce(tef_agent_url, '')) <> '')
  );

create policy "payment_settings_tenant_delete" on public.company_payment_settings
  for delete to authenticated
  using (company_id = public.current_company_id());
