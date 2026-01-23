-- Enable extensions
create extension if not exists "uuid-ossp";

-- Users table
create table public.users (
  username text not null,
  blocked boolean default false,
  role text not null default 'User',
  forceLogout boolean default false,
  constraint users_pkey primary key (username)
);

-- Messages ID sequence
create sequence if not exists public.messages_id_seq;

-- Messages table
create table public.messages (
  id bigint not null default nextval('messages_id_seq'),
  username text not null,
  content text not null,
  ip text,
  inserted_at timestamptz default timezone('utc', now()),
  role text,
  is_pinned boolean default false,
  constraint messages_pkey primary key (id),
  constraint fk_messages_user
    foreign key (username)
    references public.users(username)
    on delete cascade
);

-- Reports table
create table public.reports (
  id uuid not null default uuid_generate_v4(),
  reporter text not null,
  reported_user text not null,
  message_id bigint,
  content text,
  reason text,
  created_at timestamptz default timezone('utc', now()),
  email_sent boolean default false,
  constraint reports_pkey primary key (id)
);
