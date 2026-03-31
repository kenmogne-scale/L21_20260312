create table if not exists public.telegram_conversations (
  id text primary key,
  chat_id text not null unique,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_conversations_chat_id_idx
  on public.telegram_conversations (chat_id);
