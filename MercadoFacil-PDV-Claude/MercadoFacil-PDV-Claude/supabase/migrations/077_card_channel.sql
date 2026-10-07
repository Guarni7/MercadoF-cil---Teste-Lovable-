-- Canal de processamento do cartão, por empresa.
--
-- Forma de pagamento (crédito/débito) e canal de processamento são coisas diferentes: o
-- crédito pode passar pela maquininha independente, pelo TEF/PIN pad ou pelo Smart POS
-- (ConnectTEF). Até aqui o checkout deduzia o canal ("tem Smart POS vinculado? senão TEF
-- ligado? senão maquininha"); agora ele é uma configuração explícita da empresa.
--
-- Esta migration só cria a coluna e preenche cada empresa com o canal que ela já usa hoje,
-- então nada muda de comportamento no dia da aplicação:
--   * Smart POS vinculado  -> 'smartpos'
--   * senão TEF ligado com endereço de agente -> 'tef'
--   * senão -> 'maquininha'   (também o padrão de empresa nova)
-- Quem escolhe o canal é o administrador, pela Edge Function save-payment-settings (a tabela
-- continua sem escrita direta do navegador).

alter table public.company_payment_settings
  add column if not exists card_channel text not null default 'maquininha';

-- Empresas com Smart POS vinculado e sem linha de configuração: a linha passa a existir, já
-- com o canal certo (os demais campos usam os mesmos padrões que o app já assume).
insert into public.company_payment_settings (company_id, card_channel)
select distinct p.company_id, 'smartpos'
from public.connecttef_smartpos p
where p.status = 'vinculado'
on conflict (company_id) do nothing;

-- Canal que cada empresa já usa hoje (mesma prioridade do checkout atual).
update public.company_payment_settings s
set card_channel = case
  when exists (
    select 1 from public.connecttef_smartpos p
    where p.company_id = s.company_id and p.status = 'vinculado'
  ) then 'smartpos'
  when s.tef_enabled is true and coalesce(btrim(s.tef_agent_url), '') <> '' then 'tef'
  else 'maquininha'
end;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_payment_settings_card_channel_check'
  ) then
    alter table public.company_payment_settings
      add constraint company_payment_settings_card_channel_check
      check (card_channel in ('maquininha', 'tef', 'smartpos'));
  end if;
end $$;
