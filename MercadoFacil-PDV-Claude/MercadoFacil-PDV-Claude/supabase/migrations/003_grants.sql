-- 003: grants padrão Supabase (corrige "permission denied for table …")
-- Cole no SQL Editor e Run (depois de 001; 002 pode já ter rodado).

grant usage on schema public to postgres, anon, authenticated, service_role;

grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant execute on all functions in schema public to postgres, anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to postgres, anon, authenticated, service_role;
