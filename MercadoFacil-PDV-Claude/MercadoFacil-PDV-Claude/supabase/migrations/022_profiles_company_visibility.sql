-- Equipe da mesma empresa precisa se enxergar.
-- Com apenas `profiles_select_self`, a tela Usuários mostrava só o próprio
-- login (o operador recém-criado nunca aparecia) e o seletor de vendedor do
-- PDV ficava com uma opção só.
-- `current_company_id()` é security definer, então não recursa na policy.
drop policy if exists "profiles_select_same_company" on public.profiles;
create policy "profiles_select_same_company" on public.profiles
  for select to authenticated
  using (
    company_id is not null
    and company_id = public.current_company_id()
  );
