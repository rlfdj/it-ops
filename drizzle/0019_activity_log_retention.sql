-- Activity log retention (owner rule): entries older than two years are deleted.
--
-- The log stays append-only for everything else: the trigger still refuses every UPDATE,
-- every TRUNCATE, and every DELETE except one made by prune_activity_log() (which sets
-- app.prune_activity_log for its own transaction) on a row older than two years.
-- Idempotent, and backward compatible: code that never calls prune_activity_log() sees
-- exactly the old behaviour.

create or replace function public.activity_log_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.prune_activity_log', true) = 'on'
     and old.at < now() - interval '2 years' then
    return old;
  end if;
  raise exception 'activity_log is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint

-- Deletes entries older than two years; returns how many. Called by the app now and then.
create or replace function public.prune_activity_log() returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  perform set_config('app.prune_activity_log', 'on', true);
  delete from public.activity_log where at < now() - interval '2 years';
  get diagnostics removed = row_count;
  perform set_config('app.prune_activity_log', 'off', true);
  return removed;
end;
$$;
--> statement-breakpoint

-- The app's own role may delete again; the trigger above is what limits it to old rows.
-- (update and truncate stay revoked.)
grant delete on public.activity_log to postgres;
