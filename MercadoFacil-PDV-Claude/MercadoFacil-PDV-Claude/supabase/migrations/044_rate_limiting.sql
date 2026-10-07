-- Priority 5 fix (Security Gate): no Edge Function had any rate limiting of
-- its own (only Supabase Auth's built-in, un-configurable limits on actual
-- GoTrue endpoints — signup/login — which don't cover any of the custom
-- functions). Simple fixed-window counter in Postgres — no external service
-- (Upstash/Redis) needed, keeps the whole stack inside Supabase.
--
-- check_rate_limit(key, max, window_seconds): increments the hit count for
-- `key` in the current window; resets the window when it has expired; returns
-- false (caller should respond 429) once `max` is exceeded within the window.
-- SECURITY DEFINER + service_role-only, same pattern as the other accessor
-- RPCs — Edge Functions call it, the table itself is never exposed to clients.

create table if not exists public.rate_limit_hits (
  key text primary key,
  window_start timestamptz not null default now(),
  hit_count int not null default 0
);
alter table public.rate_limit_hits enable row level security;
-- No policies — service_role only, same pattern as company_payment_secrets.

create or replace function public.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  row_now record;
begin
  insert into public.rate_limit_hits (key, window_start, hit_count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hit_count = case
          when public.rate_limit_hits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else public.rate_limit_hits.hit_count + 1
        end,
        window_start = case
          when public.rate_limit_hits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else public.rate_limit_hits.window_start
        end
  returning * into row_now;

  return row_now.hit_count <= p_max;
end;
$$;
revoke all on function public.check_rate_limit(text, int, int) from authenticated, anon, public;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- Housekeeping: old windows never get read again, so a periodic sweep keeps
-- the table small. Called opportunistically (cheap: indexed range delete),
-- not scheduled — pg_cron isn't wired up and forcing an extra dependency for
-- housekeeping alone isn't worth it here.
create or replace function public.cleanup_rate_limit_hits()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.rate_limit_hits where window_start < now() - interval '1 day';
$$;
revoke all on function public.cleanup_rate_limit_hits() from authenticated, anon, public;
grant execute on function public.cleanup_rate_limit_hits() to service_role;
