-- Piano d'Asta — struttura del database condiviso.
-- Incolla tutto questo nell'SQL Editor di Supabase e premi Run.

create table if not exists public.documenti (
  chiave      text primary key,
  dati        jsonb       not null default '{}'::jsonb,
  versione    bigint      not null default 1,
  aggiornato  timestamptz not null default now(),
  da          text
);

comment on table public.documenti is
  'Blocchi di JSON condivisi: bozza, fantasquadre, stato asta. La colonna versione serve a non sovrascrivere il lavoro di chi ha salvato un istante prima.';

-- Row Level Security: senza questo chiunque conosca la chiave anon potrebbe
-- leggere e scrivere. Con questo, solo chi ha fatto l'accesso.
alter table public.documenti enable row level security;

drop policy if exists "leggono gli autenticati"   on public.documenti;
drop policy if exists "inseriscono gli autenticati" on public.documenti;
drop policy if exists "aggiornano gli autenticati"  on public.documenti;

create policy "leggono gli autenticati"
  on public.documenti for select
  to authenticated using (true);

create policy "inseriscono gli autenticati"
  on public.documenti for insert
  to authenticated with check (true);

create policy "aggiornano gli autenticati"
  on public.documenti for update
  to authenticated using (true) with check (true);

-- Nessuna policy di DELETE: i documenti non si cancellano dal sito.
