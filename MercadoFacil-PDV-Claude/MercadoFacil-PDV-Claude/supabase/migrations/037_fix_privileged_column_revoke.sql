-- Correction to 036: a table-wide `GRANT ALL ON ALL TABLES ... TO authenticated`
-- already exists from migration 003. In Postgres, a column-level REVOKE does
-- NOT override a broader table-level GRANT that already covers that column —
-- privileges are additive across grants, not hierarchical. Verified live:
-- has_column_privilege('authenticated','public.profiles','platform_admin','UPDATE')
-- still returned true after 036's column-level REVOKE.
--
-- Correct fix: revoke UPDATE on the whole table, then grant it back only on
-- the specific columns each role is allowed to self-edit.

revoke update on public.profiles from authenticated, anon;
grant update (full_name, email) on public.profiles to authenticated;

revoke update on public.companies from authenticated, anon;
grant update (
  trade_name, legal_name, document, phone, email, cep, address,
  address_number, complement, neighborhood, city, state, logo_url, instagram
) on public.companies to authenticated;
