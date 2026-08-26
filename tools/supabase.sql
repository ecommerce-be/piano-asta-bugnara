-- Piano d'Asta — struttura del database.
--
-- Incolla tutto questo nell'SQL Editor di Supabase e premi Run. È scritto per
-- poter essere rilanciato più volte senza rompere niente: crea quello che
-- manca e lascia stare quello che c'è già.
--
-- ═══════════════════════════════════════════════════════════════════════
-- COSA CAMBIA RISPETTO A PRIMA, E PERCHÉ
--
-- Prima c'era una tabella sola, `documenti`, e una policy che diceva
-- `using (true)`: chiunque avesse fatto l'accesso poteva leggere e
-- SOVRASCRIVERE qualsiasi cosa. Finché gli account erano due e si
-- conoscevano andava bene. Con cinque amici dentro, no: uno sbaglio di
-- qualcuno cancella il lavoro di qualcun altro, e non c'è modo di accorgersene.
--
-- Adesso ci sono tre livelli, e ognuno vede quello che gli spetta:
--
--   LEGA      le regole (crediti, squadre, slot, carattere del mercato) e
--             chi si è aggiudicato chi all'asta. Le vede chi è nella lega.
--             Le aggiudicazioni sono pubbliche di proposito: al tavolo lo
--             sono comunque, e serve a farsi i conti su chi ha quanti
--             crediti in mano.
--
--   SQUADRA   il piano di spesa, il modulo, la strategia, la bozza. Li vede
--             SOLO chi sta in quella squadra. Una squadra può avere più
--             account: è il caso di chi gioca in due sulla stessa rosa.
--
--   UTENTE    nient'altro. Un account non possiede dati per conto suo:
--             possiede l'appartenenza a una squadra dentro una lega.
--
-- Il proprietario dei dati è la SQUADRA, non l'utente. È la conseguenza di
-- un requisito preciso: due persone che gestiscono la stessa fantasquadra
-- devono vedere le stesse cose, e nessun altro deve vederle.
-- ═══════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------- leghe

create table if not exists public.leghe (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  -- codice breve da passare agli amici per farli entrare
  codice     text not null unique,
  creata     timestamptz not null default now(),
  creata_da  uuid not null references auth.users on delete cascade
);

comment on table public.leghe is
  'Una lega di fantacalcio. Il codice serve a far entrare gli altri senza doverli invitare uno per uno.';

-- ------------------------------------------------------------- squadre

create table if not exists public.squadre (
  id       uuid primary key default gen_random_uuid(),
  lega_id  uuid not null references public.leghe on delete cascade,
  nome     text not null,
  ordine   int  not null default 0,
  creata   timestamptz not null default now()
);

create index if not exists squadre_lega on public.squadre (lega_id);

comment on table public.squadre is
  'Le fantasquadre di una lega. È l''unità di proprietà dei dati privati: chi sta nella squadra li vede, gli altri no.';

-- -------------------------------------------------------------- membri

create table if not exists public.membri (
  lega_id     uuid not null references public.leghe on delete cascade,
  utente_id   uuid not null references auth.users on delete cascade,
  squadra_id  uuid references public.squadre on delete set null,
  ruolo       text not null default 'membro',   -- 'admin' | 'membro'
  nome        text,
  entrato     timestamptz not null default now(),
  primary key (lega_id, utente_id)
);

create index if not exists membri_utente on public.membri (utente_id);
create index if not exists membri_squadra on public.membri (squadra_id);

comment on column public.membri.squadra_id is
  'Quale squadra gestisce. Due membri con la stessa squadra_id lavorano sulla stessa rosa e vedono le stesse cose.';

-- ----------------------------------------------------------- documenti

create table if not exists public.documenti (
  id          uuid primary key default gen_random_uuid(),
  lega_id     uuid not null references public.leghe on delete cascade,
  -- null = documento di lega, visibile a tutti i membri
  -- valorizzato = documento di squadra, visibile solo a chi ci sta dentro
  squadra_id  uuid references public.squadre on delete cascade,
  chiave      text not null,
  dati        jsonb not null default '{}'::jsonb,
  versione    bigint not null default 1,
  aggiornato  timestamptz not null default now(),
  da          text
);

-- Una chiave per lega (documenti di lega) e una per squadra (documenti di
-- squadra). L'indice usa un uuid tutto zeri al posto del null perché in
-- Postgres due null non sono considerati uguali, e senza questo trucco si
-- potrebbero creare due documenti di lega con la stessa chiave.
create unique index if not exists documenti_chiave
  on public.documenti (lega_id, coalesce(squadra_id, '00000000-0000-0000-0000-000000000000'::uuid), chiave);

create index if not exists documenti_lega on public.documenti (lega_id);

-- ═══════════════════════════════════════════════════════════════════════
-- FUNZIONI DI APPARTENENZA
--
-- Le policy qui sotto le usano al posto di ripetere la stessa sottoquery
-- dieci volte. Sono `security definer` perché devono poter leggere `membri`
-- anche mentre stanno decidendo se puoi leggere `membri` — senza, la policy
-- si chiamerebbe da sola all'infinito.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.e_membro(l uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membri m where m.lega_id = l and m.utente_id = auth.uid());
$$;

create or replace function public.e_admin(l uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membri m
    where m.lega_id = l and m.utente_id = auth.uid() and m.ruolo = 'admin');
$$;

create or replace function public.mia_squadra(l uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.squadra_id from membri m where m.lega_id = l and m.utente_id = auth.uid();
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- ENTRARE IN UNA LEGA
--
-- Non si può lasciare che un utente si inserisca da solo in `membri`:
-- potrebbe infilarsi in qualsiasi lega scrivendone l'id. Questa funzione
-- accetta il CODICE, che è l'unica cosa che chi ti invita ti ha dato, e
-- inserisce la riga per conto dell'utente. Se sei già dentro, non fa danni:
-- ti restituisce la lega e basta.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.entra_in_lega(codice_lega text, nome_membro text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l uuid;
begin
  if auth.uid() is null then
    raise exception 'Devi entrare col tuo account.';
  end if;

  select id into l from leghe where lower(codice) = lower(trim(codice_lega));
  if l is null then
    raise exception 'Codice non valido: controlla di averlo copiato per intero.';
  end if;

  insert into membri (lega_id, utente_id, ruolo, nome)
  values (l, auth.uid(), 'membro', nome_membro)
  on conflict (lega_id, utente_id) do update
    set nome = coalesce(excluded.nome, membri.nome);

  return l;
end;
$$;

-- Creare una lega: chi la crea diventa admin, e si crea anche le squadre.
create or replace function public.crea_lega(nome_lega text, codice_lega text, nome_membro text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l uuid;
begin
  if auth.uid() is null then
    raise exception 'Devi entrare col tuo account.';
  end if;
  if length(trim(coalesce(codice_lega, ''))) < 4 then
    raise exception 'Il codice deve essere di almeno quattro caratteri.';
  end if;

  insert into leghe (nome, codice, creata_da)
  values (trim(nome_lega), lower(trim(codice_lega)), auth.uid())
  returning id into l;

  insert into membri (lega_id, utente_id, ruolo, nome)
  values (l, auth.uid(), 'admin', nome_membro);

  return l;
end;
$$;

-- Scegliere (o cambiare) la propria squadra dentro la lega.
create or replace function public.scegli_squadra(l uuid, s uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not e_membro(l) then
    raise exception 'Non sei in questa lega.';
  end if;
  if s is not null and not exists (select 1 from squadre where id = s and lega_id = l) then
    raise exception 'Quella squadra non è di questa lega.';
  end if;
  update membri set squadra_id = s where lega_id = l and utente_id = auth.uid();
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Da qui in poi il database non si fida più di nessuno.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.leghe     enable row level security;
alter table public.squadre   enable row level security;
alter table public.membri    enable row level security;
alter table public.documenti enable row level security;

-- ---- leghe: vedi solo quelle di cui fai parte -------------------------

drop policy if exists "leghe: leggo le mie" on public.leghe;
create policy "leghe: leggo le mie" on public.leghe
  for select to authenticated using (e_membro(id));

drop policy if exists "leghe: le rinomina l'admin" on public.leghe;
create policy "leghe: le rinomina l'admin" on public.leghe
  for update to authenticated using (e_admin(id)) with check (e_admin(id));

-- Nessuna policy di INSERT: le leghe si creano solo con crea_lega(), che
-- si occupa anche di renderti admin. Nessuna di DELETE: non si cancellano.

-- ---- squadre: le vedono i membri della lega ---------------------------

drop policy if exists "squadre: leggo quelle della mia lega" on public.squadre;
create policy "squadre: leggo quelle della mia lega" on public.squadre
  for select to authenticated using (e_membro(lega_id));

drop policy if exists "squadre: le crea l'admin" on public.squadre;
create policy "squadre: le crea l'admin" on public.squadre
  for insert to authenticated with check (e_admin(lega_id));

drop policy if exists "squadre: le rinomina l'admin" on public.squadre;
create policy "squadre: le rinomina l'admin" on public.squadre
  for update to authenticated using (e_admin(lega_id)) with check (e_admin(lega_id));

drop policy if exists "squadre: le toglie l'admin" on public.squadre;
create policy "squadre: le toglie l'admin" on public.squadre
  for delete to authenticated using (e_admin(lega_id));

-- ---- membri: vedi chi c'è nella tua lega ------------------------------

drop policy if exists "membri: leggo quelli della mia lega" on public.membri;
create policy "membri: leggo quelli della mia lega" on public.membri
  for select to authenticated using (e_membro(lega_id));

-- Ognuno modifica la propria riga (il nome); la squadra si cambia con
-- scegli_squadra(), che controlla che sia una squadra della lega giusta.
drop policy if exists "membri: cambio la mia riga" on public.membri;
create policy "membri: cambio la mia riga" on public.membri
  for update to authenticated
  using (utente_id = auth.uid()) with check (utente_id = auth.uid());

drop policy if exists "membri: esco quando voglio" on public.membri;
create policy "membri: esco quando voglio" on public.membri
  for delete to authenticated using (utente_id = auth.uid() or e_admin(lega_id));

-- Nessuna policy di INSERT: si entra solo con entra_in_lega(codice).

-- ---- documenti: qui sta il cuore della faccenda -----------------------
--
-- squadra_id nullo  → documento di lega: lo vede e lo scrive ogni membro.
--                     Sono le regole della lega e le aggiudicazioni d'asta.
-- squadra_id pieno  → documento di squadra: lo vede e lo scrive solo chi
--                     gestisce quella squadra. Sono il piano di spesa e la
--                     bozza, cioè quello che non vuoi far leggere agli altri.

drop policy if exists "documenti: leggo" on public.documenti;
create policy "documenti: leggo" on public.documenti
  for select to authenticated using (
    e_membro(lega_id)
    and (squadra_id is null or squadra_id = mia_squadra(lega_id))
  );

drop policy if exists "documenti: creo" on public.documenti;
create policy "documenti: creo" on public.documenti
  for insert to authenticated with check (
    e_membro(lega_id)
    and (squadra_id is null or squadra_id = mia_squadra(lega_id))
  );

drop policy if exists "documenti: aggiorno" on public.documenti;
create policy "documenti: aggiorno" on public.documenti
  for update to authenticated using (
    e_membro(lega_id)
    and (squadra_id is null or squadra_id = mia_squadra(lega_id))
  ) with check (
    e_membro(lega_id)
    and (squadra_id is null or squadra_id = mia_squadra(lega_id))
  );

-- Nessuna DELETE: i documenti non si cancellano dal sito.

-- ═══════════════════════════════════════════════════════════════════════
-- MIGRAZIONE DEI DATI CHE HAI GIÀ
--
-- Serve solo se stai passando dalla vecchia struttura (una tabella
-- `documenti` con la chiave di testo). Questo file definisce la funzione che
-- fa il lavoro; tu non devi modificare niente qui dentro.
--
-- I passaggi, in quest'ordine:
--
--   1. metti da parte la vecchia tabella:
--        alter table public.documenti rename to documenti_vecchi;
--
--   2. lancia questo file per intero (crea tabelle, regole e la funzione qui
--      sotto);
--
--   3. lancia UNA riga sola, col tuo id utente al posto di quello di esempio.
--      L'id sta in Supabase, scheda Authentication → Users:
--        select public.migra_da_vecchia('a19743cd-95a9-44a1-8d1e-a575c02a56ef');
--
-- Perché l'id va passato a mano: nell'SQL Editor lavori come amministratore,
-- non come te stesso, quindi `auth.uid()` è vuoto e il database non ha modo
-- di sapere chi sei.
--
-- La funzione si può rilanciare senza paura: se la lega esiste già, non fa
-- niente e te lo dice.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.migra_da_vecchia(io uuid)
returns text language plpgsql security definer set search_path = public as $migra$
declare
  l uuid;
  s uuid;
  r record;
  rose jsonb := '{}'::jsonb;
  nuovo uuid;
begin
  if io is null then
    return 'Manca il tuo id utente. Prendilo da Authentication → Users e rilancia: select migra_da_vecchia(''il-tuo-id'');';
  end if;

  /* Un id sbagliato darebbe un errore di chiave esterna incomprensibile:
     meglio dirlo in italiano. */
  if not exists (select 1 from auth.users u where u.id = io) then
    return format('Nessun utente con id %s. Controlla di aver copiato quello giusto da Authentication → Users.', io);
  end if;

  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'documenti_vecchi') then
    return 'Non trovo la tabella documenti_vecchi. Se stai migrando, prima lancia: alter table public.documenti rename to documenti_vecchi;';
  end if;

  if exists (select 1 from leghe where codice = 'bugnara') then
    return 'La lega "bugnara" esiste già: migrazione già fatta, non la rifaccio.';
  end if;

  insert into leghe (nome, codice, creata_da) values ('Lega Bugnara', 'bugnara', io)
    returning id into l;
  insert into membri (lega_id, utente_id, ruolo) values (l, io, 'admin');

  -- Le squadre nascono dal vecchio documento fantasquadre. Le rose vanno
  -- riagganciate agli id nuovi: senza, resterebbero attaccate a squadre che
  -- non esistono più, e le perderesti tutte.
  for r in
    select value from documenti_vecchi d,
      lateral jsonb_array_elements(coalesce(d.dati->'squadre', '[]'::jsonb)) value
    where d.chiave = 'fantasquadre'
  loop
    insert into squadre (lega_id, nome) values (l, coalesce(r.value->>'nome', 'Squadra'))
      returning id into nuovo;
    rose := rose || jsonb_build_object(nuovo::text, jsonb_build_object(
      'id', nuovo::text,
      'nome', coalesce(r.value->>'nome', 'Squadra'),
      'proprietario', coalesce(r.value->>'proprietario', ''),
      'rosa', coalesce(r.value->'rosa', '[]'::jsonb),
      'quando', r.value->>'quando'));
  end loop;

  -- la tua squadra: la prima, tanto si cambia dal sito in un clic
  select id into s from squadre where lega_id = l order by creata limit 1;
  update membri set squadra_id = s where lega_id = l and utente_id = io;

  insert into documenti (lega_id, squadra_id, chiave, dati, versione, aggiornato, da)
  select l, null, 'impostazioni', d.dati, d.versione, d.aggiornato, d.da
  from documenti_vecchi d where d.chiave = 'impostazioni';

  if rose <> '{}'::jsonb then
    insert into documenti (lega_id, squadra_id, chiave, dati, versione, aggiornato, da)
    select l, null, 'fantasquadre',
           jsonb_build_object('squadre', (select jsonb_agg(value) from jsonb_each(rose))),
           d.versione, d.aggiornato, d.da
    from documenti_vecchi d where d.chiave = 'fantasquadre';
  end if;

  -- la bozza era di voi due: diventa della tua squadra
  insert into documenti (lega_id, squadra_id, chiave, dati, versione, aggiornato, da)
  select l, s, 'bozza', d.dati, d.versione, d.aggiornato, d.da
  from documenti_vecchi d where d.chiave = 'bozza';

  return format('Fatto: lega Bugnara (codice "bugnara") con %s squadre e %s documenti. Adesso apri il sito, entra col tuo account e scegli la squadra in «La mia lega».',
    (select count(*) from squadre where lega_id = l),
    (select count(*) from documenti where lega_id = l));
end;
$migra$;
