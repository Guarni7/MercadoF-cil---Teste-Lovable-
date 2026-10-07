-- Correction to 037: the column-level GRANT for `authenticated` on
-- profiles/companies omitted `updated_at` — but every legitimate update path
-- (the app's generic entity API, register-company, etc.) always sets
-- updated_at alongside whatever else it's changing. Omitting it made every
-- otherwise-legitimate self-update fail with a table-level "permission
-- denied for table companies/profiles" (Postgres reports this generically
-- when ANY column in the UPDATE list isn't granted, not just the missing
-- one) — caught live testing register-company's normal (non-attack) path,
-- exactly the "owner legítimo executando operação legítima" test case.
-- updated_at is a timestamp, not a privilege field, so granting it back is
-- safe and was always the intent.

grant update (updated_at) on public.profiles to authenticated;
grant update (updated_at) on public.companies to authenticated;
