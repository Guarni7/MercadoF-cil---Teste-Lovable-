-- Colunas do log de atividades que a UI já exibe (papel do usuário e troco).
-- Sem elas o PostgREST rejeitava todo insert de log e a tela de Log de
-- Atividades ficava vazia, com o erro engolido pelo try/catch do cliente.
alter table public.activity_logs
  add column if not exists user_role text,
  add column if not exists change_amount numeric default 0;
