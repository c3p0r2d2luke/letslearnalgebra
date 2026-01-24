-- Required extension for UUIDs
create extension if not exists "uuid-ossp";

-- USERS must come first (FK dependency)
create table public.users (
  username text primary key,
  blocked boolean default false,
  role text not null default 'User',
  forceLogout boolean default false
);

-- Sequence for messages.id
create sequence if not exists messages_id_seq;

create table public.messages (
  id bigint primary key default nextval('messages_id_seq'),
  username text not null,
  content text not null,
  ip text,
  inserted_at timestamptz default timezone('utc', now()),
  role text,
  is_pinned boolean default false,
  constraint fk_messages_user
    foreign key (username)
    references public.users(username)
    on delete cascade
);

create table public.reports (
  id uuid primary key default uuid_generate_v4(),
  reporter text not null,
  reported_user text not null,
  message_id bigint,
  content text,
  reason text,
  created_at timestamptz default timezone('utc', now()),
  email_sent boolean default false
);
