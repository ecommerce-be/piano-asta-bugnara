-- Prova che le regole di sicurezza facciano davvero quello che promettono.
--
-- Perché serve. Le policy si scrivono una volta e poi ci si fida. Ma un errore
-- lì dentro non fa rumore: il sito continua a funzionare benissimo mentre uno
-- legge la bozza di un altro. L'unico modo di saperlo è provare a rubare i
-- dati e verificare che non ci si riesca.
--
-- COME SI USA
--   Incolla TUTTO questo file nell'SQL Editor di Supabase e premi Run, una
--   volta sola. L'ultima riga del file lancia già la prova, quindi non devi
--   fare altro.
--
-- Ti risponde con una tabella: una riga per prova, prima colonna OK o
-- FALLITO. Devono essere tutte OK.
--
-- Se in futuro vuoi solo rilanciarla, senza reincollare tutto, la funzione
-- resta definita e basta questa riga:
--     select * from public.prova_permessi();
--
-- Non tocca i tuoi dati: si crea da solo quattro utenti finti e una lega
-- finta, ci prova sopra, e alla fine cancella tutto — anche se qualcosa va
-- storto per strada.
--
-- (Le risposte arrivano come tabella e non come messaggi perché l'SQL Editor
-- di Supabase le `raise notice` non le mostra: finirebbero nei log del
-- database, dove non le andresti mai a cercare.)

create or replace function public.prova_permessi()
returns table (esito text, prova text)
language plpgsql as $prova$
declare
  anna    uuid := 'aaaa0000-0000-0000-0000-00000000000a';
  bruno   uuid := 'bbbb0000-0000-0000-0000-00000000000b';
  carla   uuid := 'cccc0000-0000-0000-0000-00000000000c';
  nessuno uuid := 'ffff0000-0000-0000-0000-00000000000f';
  lg      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  sq1     uuid := 'bbbbbbbb-0000-0000-0000-000000000001';   -- Anna e Bruno
  sq2     uuid := 'bbbbbbbb-0000-0000-0000-000000000002';   -- Carla
  n  int;
  ko int := 0;
  tot int := 0;

  /* segna l'esito di una prova e lo mette in coda al risultato */
  procedure_placeholder int;
begin
  -- ─────────────────────────────────────────────────────────────────────
  -- Preparazione. Gli utenti finti servono perché `leghe.creata_da` e
  -- `membri.utente_id` puntano a auth.users: senza, verrebbero respinti.
  -- ─────────────────────────────────────────────────────────────────────
  begin
    insert into auth.users (id) values (anna), (bruno), (carla), (nessuno)
    on conflict (id) do nothing;
  exception when others then
    esito := 'FALLITO'; prova := 'non riesco a creare gli utenti di prova: ' || sqlerrm;
    return next; return;
  end;

  delete from leghe where id = lg;

  insert into leghe (id, nome, codice, creata_da)
    values (lg, 'PROVA — si cancella da sola', 'prova-permessi-tmp', anna);

  insert into squadre (id, lega_id, nome) values
    (sq1, lg, 'Anna e Bruno FC'),
    (sq2, lg, 'Carla FC');

  insert into membri (lega_id, utente_id, squadra_id, ruolo, nome) values
    (lg, anna,  sq1, 'admin',  'Anna'),
    (lg, bruno, sq1, 'membro', 'Bruno'),
    (lg, carla, sq2, 'membro', 'Carla');

  insert into documenti (lega_id, squadra_id, chiave, dati) values
    (lg, null, 'impostazioni', '{"crediti":500}'),
    (lg, sq1,  'bozza', '{"di":"Anna e Bruno"}'),
    (lg, sq2,  'bozza', '{"di":"Carla"}');

  -- ─────────────────────────────────────────────────────────────────────
  -- Le prove. Ognuna finge di essere qualcuno e conta cosa riesce a vedere.
  -- ─────────────────────────────────────────────────────────────────────

  -- 1
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-00000000000a","role":"authenticated"}';
  select count(*) into n from documenti where lega_id = lg and chiave = 'bozza';
  reset role;
  tot := tot + 1; esito := case when n = 1 then 'OK' else 'FALLITO' end;
  prova := 'Anna vede una sola bozza, la sua' || case when n = 1 then '' else format(' — ne vede %s', n) end;
  if n <> 1 then ko := ko + 1; end if; return next;

  -- 2
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-00000000000b","role":"authenticated"}';
  select count(*) into n from documenti
    where lega_id = lg and chiave = 'bozza' and dati->>'di' = 'Anna e Bruno';
  reset role;
  tot := tot + 1; esito := case when n = 1 then 'OK' else 'FALLITO' end;
  prova := 'Bruno, stessa squadra di Anna, vede la sua bozza';
  if n <> 1 then ko := ko + 1; end if; return next;

  -- 3
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-00000000000b","role":"authenticated"}';
  update documenti set dati = '{"di":"Anna e Bruno"}'
    where lega_id = lg and squadra_id = sq1 and chiave = 'bozza';
  get diagnostics n = row_count;
  reset role;
  tot := tot + 1; esito := case when n = 1 then 'OK' else 'FALLITO' end;
  prova := 'Bruno può anche modificarla';
  if n <> 1 then ko := ko + 1; end if; return next;

  -- 4
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-00000000000c","role":"authenticated"}';
  select count(*) into n from documenti
    where lega_id = lg and chiave = 'bozza' and dati->>'di' = 'Anna e Bruno';
  reset role;
  tot := tot + 1; esito := case when n = 0 then 'OK' else 'FALLITO' end;
  prova := 'Carla, altra squadra, NON vede la bozza di Anna';
  if n <> 0 then ko := ko + 1; end if; return next;

  -- 5
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-00000000000c","role":"authenticated"}';
  select count(*) into n from documenti where lega_id = lg and chiave = 'impostazioni';
  reset role;
  tot := tot + 1; esito := case when n = 1 then 'OK' else 'FALLITO' end;
  prova := 'ma le impostazioni della lega sì: quelle sono di tutti';
  if n <> 1 then ko := ko + 1; end if; return next;

  -- 6
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-00000000000c","role":"authenticated"}';
  update documenti set dati = '{"rubato":true}' where lega_id = lg and squadra_id = sq1;
  get diagnostics n = row_count;
  reset role;
  tot := tot + 1; esito := case when n = 0 then 'OK' else 'FALLITO' end;
  prova := 'Carla NON riesce a scrivere nella squadra di Anna'
    || case when n = 0 then '' else format(' — ha scritto in %s documenti', n) end;
  if n <> 0 then ko := ko + 1; end if; return next;

  -- 7
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ffff0000-0000-0000-0000-00000000000f","role":"authenticated"}';
  select count(*) into n from documenti where lega_id = lg;
  reset role;
  tot := tot + 1; esito := case when n = 0 then 'OK' else 'FALLITO' end;
  prova := 'un estraneo alla lega non vede nessun documento';
  if n <> 0 then ko := ko + 1; end if; return next;

  -- 8
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ffff0000-0000-0000-0000-00000000000f","role":"authenticated"}';
  select count(*) into n from leghe where id = lg;
  reset role;
  tot := tot + 1; esito := case when n = 0 then 'OK' else 'FALLITO' end;
  prova := 'e non vede nemmeno che la lega esista';
  if n <> 0 then ko := ko + 1; end if; return next;

  -- 9
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ffff0000-0000-0000-0000-00000000000f","role":"authenticated"}';
  select count(*) into n from membri where lega_id = lg;
  reset role;
  tot := tot + 1; esito := case when n = 0 then 'OK' else 'FALLITO' end;
  prova := 'né chi ci gioca dentro';
  if n <> 0 then ko := ko + 1; end if; return next;

  -- 10
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-00000000000c","role":"authenticated"}';
  begin
    insert into squadre (lega_id, nome) values (lg, 'Furto FC');
    esito := 'FALLITO'; ko := ko + 1;
  exception when others then esito := 'OK';
  end;
  reset role;
  tot := tot + 1; prova := 'Carla non può creare squadre: non è lei che ha fatto la lega';
  return next;

  -- 11
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ffff0000-0000-0000-0000-00000000000f","role":"authenticated"}';
  begin
    perform entra_in_lega('codice-che-non-esiste');
    esito := 'FALLITO'; ko := ko + 1;
  exception when others then esito := 'OK';
  end;
  reset role;
  tot := tot + 1; prova := 'un codice inventato non fa entrare nessuno';
  return next;

  -- 12
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ffff0000-0000-0000-0000-00000000000f","role":"authenticated"}';
  begin
    perform entra_in_lega('PROVA-PERMESSI-TMP', 'Estraneo');
    esito := 'OK'; prova := 'col codice giusto si entra, maiuscole comprese';
  exception when others then
    esito := 'FALLITO'; ko := ko + 1;
    prova := 'col codice giusto non si entra: ' || sqlerrm;
  end;
  reset role;
  tot := tot + 1; return next;

  -- 13
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ffff0000-0000-0000-0000-00000000000f","role":"authenticated"}';
  select count(*) into n from documenti where lega_id = lg and chiave = 'bozza';
  reset role;
  tot := tot + 1; esito := case when n = 0 then 'OK' else 'FALLITO' end;
  prova := 'appena entrato, senza aver scelto la squadra, non vede bozze altrui';
  if n <> 0 then ko := ko + 1; end if; return next;

  -- ─────────────────────────────────────────────────────────────────────
  esito := case when ko = 0 then '— TUTTO OK —' else '— ATTENZIONE —' end;
  prova := case when ko = 0
    then format('%s prove su %s. Puoi aprire il sito agli amici.', tot, tot)
    else format('%s prove FALLITE su %s. Non aprire il sito finché non sono sistemate.', ko, tot) end;
  return next;

  -- Pulizia: la lega se ne va con squadre, membri e documenti (cascade),
  -- poi spariscono anche gli utenti finti.
  delete from leghe where id = lg;
  delete from auth.users where id in (anna, bruno, carla, nessuno);
  return;

exception when others then
  -- se qualcosa esplode a metà, si ripulisce lo stesso: non deve restare
  -- immondizia di prova nel database vero
  reset role;
  begin
    delete from leghe where id = lg;
    delete from auth.users where id in (anna, bruno, carla, nessuno);
  exception when others then null;
  end;
  esito := 'FALLITO'; prova := 'la prova si è interrotta: ' || sqlerrm;
  return next;
end;
$prova$;

-- Ed ecco la prova, lanciata subito: i risultati compaiono qui sotto.
select * from public.prova_permessi();
