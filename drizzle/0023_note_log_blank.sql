-- Notes: a note that has never had content is not logged (an accidental click on the board
-- adds one; deleting it again should leave no trace). Its first content is logged as the
-- note being added. Same function as 0022 otherwise.
create or replace function public.note_is_blank(r jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(r ->> 'text', ''), E' \n\r\t') = ''
     and not exists (
       select 1 from jsonb_array_elements(coalesce(r -> 'checklist', '[]'::jsonb)) e
        where btrim(coalesce(e ->> 'text', '')) <> '')
     and r ->> 'person_id' is null
     and r ->> 'po_id' is null
     and r ->> 'subscription_id' is null
     and r ->> 'task_id' is null
     and r ->> 'made_task_id' is null
$$;
--> statement-breakpoint
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
  v_action text := lower(tg_op);
begin
  -- Escape hatch used by the seed script, which writes curated history itself.
  if coalesce(current_setting('app.skip_activity_log', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'notes' then
    v_ignore := v_ignore || array['x', 'y', 'width', 'height', 'z_index'];
    -- A note that has never had content (an accidental click on the board) is not logged:
    -- not when it is added, recoloured or deleted. Its first content is logged as the note
    -- being added. Once a note is in the log, everything after is logged as usual.
    if not exists (
      select 1 from public.activity_log l
       where l.record_id = (v_row ->> 'id')::uuid and l.table_name = 'notes'
    ) then
      if tg_op = 'DELETE' or public.note_is_blank(v_new) then
        return null;
      end if;
      if tg_op = 'UPDATE' then
        -- Log it as added, with what it holds now.
        v_action := 'insert';
        v_old := null;
      end if;
    end if;
  end if;

  if v_action = 'update' then
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any (v_ignore)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    -- Nothing but timestamps (or a note's position and size) changed: don't log.
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    for v_key in select jsonb_object_keys(v_row) loop
      if not (v_key = any (v_ignore)) and jsonb_typeof(v_row -> v_key) <> 'null' then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          case when v_action = 'insert'
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
    when 'subscriptions' then 'Subscriptions'
    when 'subscription_invoices' then 'Subscriptions'
    when 'prorated_seats' then 'Subscriptions'
    when 'seat_assignments' then 'Subscriptions'
    when 'tasks' then 'Tasks'
    when 'people' then 'People'
    when 'checklists' then 'People'
    when 'checklist_items' then 'People'
    when 'notes' then 'Board'
    when 'documents' then
      case v_row ->> 'owner_type'
        when 'purchase_order' then 'Procurement'
        when 'note' then 'Board'
        else 'Subscriptions'
      end
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
    when 'subscriptions' then v_row ->> 'name'
    when 'subscription_invoices' then
      concat_ws(' · ',
        (select s.name from public.subscriptions s where s.id = (v_row ->> 'subscription_id')::uuid),
        v_row ->> 'period_label')
    when 'prorated_seats' then
      concat_ws(' · ',
        (select s.name from public.subscription_invoices i
           join public.subscriptions s on s.id = i.subscription_id
          where i.id = (v_row ->> 'invoice_id')::uuid),
        v_row ->> 'person_name')
    when 'seat_assignments' then
      concat_ws(' · ',
        (select s.name from public.subscriptions s where s.id = (v_row ->> 'subscription_id')::uuid),
        v_row ->> 'person_name')
    when 'checklists' then
      concat_ws(' · ',
        (select p.full_name from public.people p where p.id = (v_row ->> 'person_id')::uuid),
        v_row ->> 'kind')
    when 'checklist_items' then v_row ->> 'label'
    when 'tasks' then v_row ->> 'title'
    when 'notes' then left(
      coalesce(nullif(btrim(split_part(btrim(v_row ->> 'text', E' \n\r\t'), E'\n', 1)), ''), 'Empty note'),
      80)
  end;

  insert into public.activity_log (actor, action, table_name, record_id, record_label, module, changes)
  values (
    coalesce(nullif(current_setting('app.actor', true), ''), 'system'),
    v_action::public.log_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_label,
    v_module,
    v_changes
  );

  return null;
end;
$$;
