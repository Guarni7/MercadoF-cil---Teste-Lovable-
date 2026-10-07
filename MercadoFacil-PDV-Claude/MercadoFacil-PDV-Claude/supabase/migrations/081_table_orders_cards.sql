-- Cartão/comanda físico reutilizável: separa o CARTÃO (card_number) da MESA (table_number).
--
-- Na 080 table_number identificava o atendimento (mesa) e era único entre os abertos. Com cartões, o atendimento é
-- identificado pelo cartão e a mesa vira informação opcional (o mesmo cartão pode ficar sem mesa, ir à Mesa 5 e,
-- depois de encerrado, à Mesa 2; duas comandas podem estar na mesma mesa). Por isso:
--   * card_number text        — número do cartão (ex.: "23" para o cartão 023). NULL = atendimento de mesa (modelo antigo).
--   * table_number            — passa a aceitar NULL; em atendimento de cartão é só a mesa informada (opcional).
--   * um atendimento aberto por MESA continua valendo, mas só para atendimentos SEM cartão;
--   * um atendimento aberto por CARTÃO por empresa (cartão em uso = existe atendimento aberto; encerrado = DISPONÍVEL).
-- Cartão não é apagado: o histórico (atendimento fechado + venda) permanece e o número volta a ser usado.
-- RLS inalterada (table_orders_tenant_all, por company_id). O token do QR é calculado no app; nada novo no banco.
-- A tabela está vazia em produção; idempotente.
alter table public.table_orders add column if not exists card_number text;
alter table public.table_orders alter column table_number drop not null;

alter table public.table_orders drop constraint if exists table_orders_mesa_ou_cartao_chk;
alter table public.table_orders
  add constraint table_orders_mesa_ou_cartao_chk check (table_number is not null or card_number is not null);

-- A regra "um aberto por mesa" passa a valer só para atendimento de mesa (sem cartão).
drop index if exists public.table_orders_open_uidx;
create unique index if not exists table_orders_open_uidx
  on public.table_orders (company_id, table_number) where status = 'aberta' and card_number is null;

create unique index if not exists table_orders_open_card_uidx
  on public.table_orders (company_id, card_number) where status = 'aberta' and card_number is not null;

create index if not exists table_orders_card_idx
  on public.table_orders (company_id, card_number, created_at desc) where card_number is not null;
