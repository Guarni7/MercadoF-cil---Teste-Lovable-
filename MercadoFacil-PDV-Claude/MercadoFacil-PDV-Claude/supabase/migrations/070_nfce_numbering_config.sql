-- Série e próximo número da NFC-e, configuráveis pela tela Fiscal > NFC-e.
--
-- A série escolhida fica em company_fiscal_settings.nfce_series. O número em si
-- continua em fiscal_document_series (uma linha por empresa/modelo/série/
-- ambiente), que é a única fonte da numeração oficial — current_number é o
-- ÚLTIMO número usado, então o "próximo número" da tela é current_number + 1.
--
-- A tela nunca escreve em fiscal_document_series: passa pela função abaixo, que
-- só roda como service role (Edge Function fiscal-nfce-config) e recusa um
-- próximo número que repetiria um número já registrado em fiscal_documents.

alter table public.company_fiscal_settings
  add column if not exists nfce_series integer not null default 1
    check (nfce_series between 1 and 999);

create or replace function public.set_fiscal_next_number(
  p_company_id uuid,
  p_model text,
  p_series integer,
  p_environment text,
  p_next bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max bigint;
begin
  if p_model not in ('55', '65', 'nfse') then
    raise exception 'modelo fiscal inválido: %', p_model;
  end if;
  if p_environment not in ('homologacao', 'producao') then
    raise exception 'ambiente inválido: %', p_environment;
  end if;
  if p_series is null or p_series < 1 or p_series > 999 then
    raise exception 'série deve estar entre 1 e 999';
  end if;
  if p_next is null or p_next < 1 then
    raise exception 'próximo número deve ser maior que zero';
  end if;

  -- Número já registrado (mesmo rejeitado, que também queima a posição) não
  -- pode se repetir: o autorizador recusaria por duplicidade.
  select coalesce(max(number), 0) into v_max
    from public.fiscal_documents
   where company_id = p_company_id
     and model = p_model
     and series = p_series
     and environment = p_environment;

  if p_next <= v_max then
    raise exception 'próximo número deve ser maior que o último já registrado (%)', v_max;
  end if;

  insert into public.fiscal_document_series (company_id, model, series, environment, current_number)
  values (p_company_id, p_model, p_series, p_environment, p_next - 1)
  on conflict (company_id, model, series, environment)
  do update set current_number = excluded.current_number, updated_at = now();

  return p_next;
end;
$$;

-- ALTER DEFAULT PRIVILEGES (migration 003) concede EXECUTE a authenticated/anon
-- em funções novas; revoke explícito, como em 067.
revoke all on function public.set_fiscal_next_number(uuid, text, integer, text, bigint)
  from public, anon, authenticated;
grant execute on function public.set_fiscal_next_number(uuid, text, integer, text, bigint)
  to service_role;
