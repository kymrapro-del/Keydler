begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create type public.workspace_role as enum ('owner', 'editor', 'viewer');
create type public.connector_provider as enum ('openai', 'anthropic', 'gemini');
create type public.connector_status as enum ('disconnected', 'checking', 'connected', 'error');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id);

create function private.is_workspace_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members
    where workspace_id = target and user_id = auth.uid()
  );
$$;

create function private.can_edit_workspace(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members
    where workspace_id = target
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  );
$$;

create function private.is_workspace_owner(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspaces
    where id = target and owner_id = auth.uid()
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.can_edit_workspace(uuid) from public;
revoke all on function private.is_workspace_owner(uuid) from public;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.can_edit_workspace(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

create function private.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger workspace_owner_membership
after insert on public.workspaces
for each row execute function private.add_workspace_owner();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_profile
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  cloud_sync_enabled boolean not null default false,
  retention_days integer not null default 30 check (retention_days in (7, 30, 90, 365)),
  strict_agent_writes boolean not null default true check (strict_agent_writes),
  enabled_tools jsonb not null default '[]'::jsonb check (jsonb_typeof(enabled_tools) = 'array'),
  updated_at timestamptz not null default now()
);

create table public.task_snapshots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id text not null check (char_length(task_id) between 1 and 128),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  version integer not null check (version >= 1),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, task_id)
);

create index task_snapshots_updated_idx on public.task_snapshots(workspace_id, updated_at desc);

create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.connector_provider not null,
  label text not null check (char_length(label) between 1 and 80),
  status public.connector_status not null default 'checking',
  credential_ciphertext bytea,
  credential_iv bytea,
  credential_hint text check (credential_hint is null or char_length(credential_hint) <= 24),
  last_checked_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 240),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create index connectors_workspace_idx on public.connectors(workspace_id, provider);

create table private.connector_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index connector_attempts_limit_idx
on private.connector_attempts(user_id, workspace_id, attempted_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  operation text not null check (char_length(operation) between 1 and 80),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id text check (target_id is null or char_length(target_id) <= 128),
  outcome text not null check (outcome in ('applied', 'refused')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_workspace_idx on public.audit_events(workspace_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.task_snapshots enable row level security;
alter table public.connectors enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_select_member on public.workspaces
for select to authenticated using (private.is_workspace_member(id) or owner_id = auth.uid());
create policy workspaces_insert_owner on public.workspaces
for insert to authenticated with check (owner_id = auth.uid());
create policy workspaces_update_owner on public.workspaces
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy workspaces_delete_owner on public.workspaces
for delete to authenticated using (owner_id = auth.uid());

create policy members_select_member on public.workspace_members
for select to authenticated using (private.is_workspace_member(workspace_id));
create policy members_insert_owner on public.workspace_members
for insert to authenticated with check (private.is_workspace_owner(workspace_id));
create policy members_update_owner on public.workspace_members
for update to authenticated using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));
create policy members_delete_owner_or_self on public.workspace_members
for delete to authenticated using (
  private.is_workspace_owner(workspace_id)
  or (user_id = auth.uid() and role <> 'owner')
);

create policy settings_select_member on public.workspace_settings
for select to authenticated using (private.is_workspace_member(workspace_id));
create policy settings_insert_owner on public.workspace_settings
for insert to authenticated with check (private.is_workspace_owner(workspace_id));
create policy settings_update_owner on public.workspace_settings
for update to authenticated using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

create policy tasks_select_member on public.task_snapshots
for select to authenticated using (private.is_workspace_member(workspace_id));
create policy tasks_insert_editor on public.task_snapshots
for insert to authenticated with check (
  private.can_edit_workspace(workspace_id) and updated_by = auth.uid()
);
create policy tasks_update_editor on public.task_snapshots
for update to authenticated using (private.can_edit_workspace(workspace_id))
with check (private.can_edit_workspace(workspace_id) and updated_by = auth.uid());
create policy tasks_delete_editor on public.task_snapshots
for delete to authenticated using (private.can_edit_workspace(workspace_id));

create policy connectors_select_member on public.connectors
for select to authenticated using (private.is_workspace_member(workspace_id));

create policy audit_select_member on public.audit_events
for select to authenticated using (private.is_workspace_member(workspace_id));
create policy audit_insert_member on public.audit_events
for insert to authenticated with check (
  private.is_workspace_member(workspace_id) and actor_id = auth.uid()
);

revoke all on public.connectors from anon, authenticated;
grant select (id, workspace_id, provider, label, status, last_checked_at, last_error, created_at, updated_at)
on public.connectors to authenticated;

create function public.sync_task_snapshot(
  p_workspace_id uuid,
  p_task_id text,
  p_state jsonb,
  p_version integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  if not private.can_edit_workspace(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if p_version < 1 or char_length(p_task_id) not between 1 and 128 or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid task snapshot' using errcode = '22023';
  end if;

  insert into public.task_snapshots(workspace_id, task_id, state, version, updated_by)
  values (p_workspace_id, p_task_id, p_state, p_version, auth.uid())
  on conflict (workspace_id, task_id) do update
    set state = excluded.state,
        version = excluded.version,
        updated_by = auth.uid(),
        updated_at = now()
  where public.task_snapshots.version < excluded.version;

  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.audit_events(
      workspace_id, actor_id, operation, target_type, target_id, outcome, metadata
    ) values (
      p_workspace_id, auth.uid(), 'sync task', 'task', p_task_id, 'applied',
      jsonb_build_object('version', p_version)
    );
  end if;
  return changed > 0;
end;
$$;

revoke all on function public.sync_task_snapshot(uuid, text, jsonb, integer) from public;
grant execute on function public.sync_task_snapshot(uuid, text, jsonb, integer) to authenticated;

create function private.prune_expired_audit()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.audit_events event
  using public.workspace_settings settings
  where event.workspace_id = settings.workspace_id
    and event.created_at < now() - make_interval(days => settings.retention_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function private.prune_expired_audit() from public, anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.task_snapshots;
exception
  when duplicate_object then null;
end $$;

commit;
