-- Richieste dal modulo di contatto di glevantis.it.
-- Contratto con suite-crm (import): non cambiare lo schema senza avvisare.
create table public.richieste_sito (
  id uuid primary key default gen_random_uuid(),
  creato_il timestamptz not null default now(),
  nome text not null,
  azienda text not null,
  email text not null,
  telefono text not null default '',
  messaggio text not null,
  pagina text not null default '',
  ip_hash text not null default '',
  importato_crm_il timestamptz null,
  crm_organizzazione_id integer null
);

-- RLS attiva senza policy: scrive/legge solo la service role.
alter table public.richieste_sito enable row level security;

create index richieste_sito_importato_crm_il_idx on public.richieste_sito (importato_crm_il);
create index richieste_sito_email_idx on public.richieste_sito (email);
-- Per il rate limit per IP
create index richieste_sito_ip_hash_creato_il_idx on public.richieste_sito (ip_hash, creato_il);
