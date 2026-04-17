-- Non-destructive migration for per-server settings, per-server word filters,
-- custom emoji access flags, and supporting performance indexes.

create table if not exists public.server_settings (
  server_id uuid primary key references public.servers(id) on delete cascade,
  bad_word_filter_enabled boolean not null default false,
  admin_only_custom_emojis boolean not null default false,
  allow_plaintext_links boolean not null default false,
  allow_everyone_mentions boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.server_settings (server_id)
select s.id
from public.servers s
on conflict (server_id) do nothing;

create table if not exists public.server_word_filters (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  word text not null,
  replacement text not null default '****',
  is_active boolean not null default true,
  created_by text references public.users(username),
  created_at timestamptz not null default now()
);

create unique index if not exists server_word_filters_server_word_uidx
  on public.server_word_filters (server_id, word);

insert into public.server_word_filters (server_id, word, replacement, is_active, created_by, created_at)
select
  s.id as server_id,
  wf.word,
  coalesce(wf.replacement, '****') as replacement,
  coalesce(wf.is_active, true) as is_active,
  wf.created_by,
  coalesce(wf.created_at, now()) as created_at
from public.servers s
cross join public.word_filters wf
on conflict (server_id, word) do nothing;

alter table public.custom_emojis
  add column if not exists visibility text not null default 'everyone';

alter table public.custom_emojis
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'custom_emojis_visibility_check'
  ) then
    alter table public.custom_emojis
      add constraint custom_emojis_visibility_check
      check (visibility in ('everyone', 'admins', 'owner'));
  end if;
end $$;

create index if not exists idx_messages_channel_inserted_at
  on public.messages (channel_id, inserted_at desc);

create index if not exists idx_reactions_message_id
  on public.reactions (message_id);

create index if not exists idx_custom_emojis_server_active_name
  on public.custom_emojis (server_id, is_active, name);

create index if not exists idx_server_members_username_server
  on public.server_members (username, server_id);

create index if not exists idx_server_members_server_sort_username
  on public.server_members (server_id, sort_order, username);

create index if not exists idx_channels_server_sort
  on public.channels (server_id, sort_order);

create index if not exists idx_categories_server_sort
  on public.categories (server_id, sort_order);

create index if not exists idx_server_member_roles_server_member
  on public.server_member_roles (server_id, member_id);

create index if not exists idx_server_roles_server
  on public.server_roles (server_id);

create index if not exists idx_server_word_filters_server_active_word
  on public.server_word_filters (server_id, is_active, word);

create index if not exists idx_channel_presence_server_channel
  on public.channel_presence (server_id, channel_id);
