-- Custom SQL migration: functions, triggers, row level security and storage.
-- Hand-written; drizzle-kit does not generate any of this.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
--> statement-breakpoint

do $$
declare
  t text;
begin
  foreach t in array array[
    'vendors', 'people', 'purchase_orders', 'po_lines', 'documents', 'assets',
    'asset_events', 'subscriptions', 'subscription_invoices', 'checklists', 'checklist_items',
    'tasks', 'id_counters'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Allowed user (single-user app). Filled from ALLOWED_EMAIL by `pnpm db:config`.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_config (
  id smallint primary key default 1 check (id = 1),
  allowed_email text not null
);
--> statement-breakpoint

-- True only for a signed-in Supabase user whose email matches ALLOWED_EMAIL.
create or replace function public.is_allowed_user() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') = (select lower(allowed_email) from private.app_config where id = 1),
    false
  );
$$;
--> statement-breakpoint

revoke all on function public.is_allowed_user() from public, anon;
grant execute on function public.is_allowed_user() to authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create or replace function public.log_activity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_ignore text[] := array['id', 'created_at', 'updated_at'];
  v_key text;
  v_label text;
  v_module text;
begin
  -- Escape hatch used only by the seed script, which writes curated history itself.
  if coalesce(current_setting('app.skip_activity_log', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any (v_ignore)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    -- Nothing but timestamps changed: don't log.
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    for v_key in select jsonb_object_keys(v_row) loop
      if not (v_key = any (v_ignore)) and jsonb_typeof(v_row -> v_key) <> 'null' then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          case when tg_op = 'INSERT'
            then jsonb_build_object('old', null, 'new', v_row -> v_key)
            else jsonb_build_object('old', v_row -> v_key, 'new', null)
          end);
      end if;
    end loop;
  end if;

  v_module := case tg_table_name
    when 'purchase_orders' then 'Procurement'
    when 'po_lines' then 'Procurement'
    when 'vendors' then 'Procurement'
    when 'assets' then 'Assets'
    when 'asset_events' then 'Assets'
    when 'subscriptions' then 'Subscriptions'
    when 'subscription_invoices' then 'Subscriptions'
    when 'tasks' then 'Tasks'
    when 'people' then 'People'
    when 'checklists' then 'People'
    when 'checklist_items' then 'People'
    when 'documents' then
      case v_row ->> 'owner_type' when 'purchase_order' then 'Procurement' else 'Subscriptions' end
    else 'Settings'
  end;

  v_label := case tg_table_name
    when 'vendors' then v_row ->> 'name'
    when 'people' then v_row ->> 'full_name'
    when 'purchase_orders' then v_row ->> 'po_number'
    when 'po_lines' then
      concat_ws(' · ',
        (select po.po_number from public.purchase_orders po where po.id = (v_row ->> 'po_id')::uuid),
        v_row ->> 'description')
    when 'documents' then v_row ->> 'file_name'
    when 'assets' then v_row ->> 'tag'
    when 'asset_events' then
      (select a.tag from public.assets a where a.id = (v_row ->> 'asset_id')::uuid)
    when 'subscriptions' then v_row ->> 'name'
    when 'subscription_invoices' then
      concat_ws(' · ',
        (select s.name from public.subscriptions s where s.id = (v_row ->> 'subscription_id')::uuid),
        v_row ->> 'period_label')
    when 'checklists' then
      concat_ws(' · ',
        (select p.full_name from public.people p where p.id = (v_row ->> 'person_id')::uuid),
        v_row ->> 'kind')
    when 'checklist_items' then v_row ->> 'label'
    when 'tasks' then v_row ->> 'title'
  end;

  insert into public.activity_log (actor, action, table_name, record_id, record_label, module, changes)
  values (
    coalesce(nullif(current_setting('app.actor', true), ''), 'system'),
    lower(tg_op)::public.log_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_label,
    v_module,
    v_changes
  );

  return null;
end;
$$;
--> statement-breakpoint

do $$
declare
  t text;
begin
  foreach t in array array[
    'vendors', 'people', 'purchase_orders', 'po_lines', 'documents', 'assets',
    'asset_events', 'subscriptions', 'subscription_invoices', 'checklists', 'checklist_items',
    'tasks'
  ] loop
    execute format(
      'create trigger log_activity after insert or update or delete on public.%I
         for each row execute function public.log_activity()', t);
  end loop;
end;
$$;
--> statement-breakpoint

-- Append-only: block UPDATE, DELETE and TRUNCATE for everyone, including the table owner.
create or replace function public.activity_log_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'activity_log is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint

create trigger activity_log_no_update_delete before update or delete on public.activity_log
  for each row execute function public.activity_log_append_only();
--> statement-breakpoint

create trigger activity_log_no_truncate before truncate on public.activity_log
  for each statement execute function public.activity_log_append_only();
--> statement-breakpoint

revoke update, delete, truncate on public.activity_log
  from public, anon, authenticated, service_role, postgres;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Sequence counters (PO numbers, asset tags)
-- ---------------------------------------------------------------------------

-- Atomically claims the next number in a scope, e.g. next_counter('PO-2026') or next_counter('DP-LT').
create or replace function public.next_counter(p_scope text) returns integer
language sql
set search_path = ''
as $$
  insert into public.id_counters as c (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update set last_value = c.last_value + 1
  returning c.last_value;
$$;
--> statement-breakpoint

revoke all on function public.next_counter(text) from public, anon, authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create view public.po_totals with (security_invoker = true) as
select
  po.id as po_id,
  coalesce(sum(l.qty * l.unit_price_aed), 0)::numeric(12, 2) as total_aed,
  count(l.id)::integer as line_count,
  coalesce(sum(l.qty), 0)::integer as unit_count,
  coalesce(sum(l.qty) filter (where l.asset_type is not null), 0)::integer as tracked_units,
  coalesce(sum(l.registered_qty) filter (where l.asset_type is not null), 0)::integer as registered_units
from public.purchase_orders po
left join public.po_lines l on l.po_id = po.id
group by po.id;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row level security (defence in depth; the server-side session check is the real guard)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'vendors', 'people', 'purchase_orders', 'po_lines', 'documents', 'assets',
    'asset_events', 'subscriptions', 'subscription_invoices', 'checklists', 'checklist_items',
    'tasks', 'id_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy allowed_user_all on public.%I for all to authenticated
         using (public.is_allowed_user()) with check (public.is_allowed_user())', t);
  end loop;
end;
$$;
--> statement-breakpoint

alter table public.activity_log enable row level security;
create policy allowed_user_read on public.activity_log for select to authenticated
  using (public.is_allowed_user());
--> statement-breakpoint

-- The anon role never needs table access.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Storage: private `documents` bucket, served via short-lived signed URLs
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']
)
on conflict (id) do update set public = false;
--> statement-breakpoint

create policy "documents: allowed user select" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_allowed_user());
create policy "documents: allowed user insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_allowed_user());
create policy "documents: allowed user update" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.is_allowed_user())
  with check (bucket_id = 'documents' and public.is_allowed_user());
create policy "documents: allowed user delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_allowed_user());
