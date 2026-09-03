/* Pagina "La mia lega": è qui che si decide cosa vedi in tutto il resto del sito.
 *
 * Tre passaggi, in quest'ordine, e nessuno si può saltare:
 *   1. entri col tuo account
 *   2. entri in una lega — creandola, o col codice che ti ha dato chi l'ha creata
 *   3. dici quale squadra gestisci
 *
 * Il terzo è quello che la gente dimentica, ed è quello che conta: il piano di
 * spesa e la bozza appartengono alla SQUADRA, non a te. Finché non l'hai
 * scelta il sito non sa di chi sono i tuoi dati, e te lo dice invece di
 * mostrarti pagine vuote.
 */
import {
  avvia, configurato, collegato, utente, montaAccesso, esc, quando,
  caricaContesto, mieLeghe, creaLega, entraInLega, scegliSquadra, cambiaLega,
  creaSquadra, rinominaSquadra,
  lega, squadra, squadreDellaLega, membriDellaLega, sonoAdmin, inLega,
} from './db.js?v=6824e6b7';
import { toast, conferma as chiediConferma } from './ui.js?v=2606df5a';
import { caricaAsta, quantiMovimenti, azzeraAsta, salvaAsta } from './astaLega.js?v=c262ae13';

await avvia();

let leghe = [];
let errore = '';

async function ricarica() {
  errore = '';
  if (collegato() && configurato()) {
    try {
      await caricaContesto();
      leghe = await mieLeghe();
    } catch (e) {
      errore = e.message;
      leghe = [];
    }
  } else {
    leghe = [];
  }
  disegna();
}

montaAccesso(document.getElementById('accesso'), ricarica);

/* ---------- i tre passaggi, disegnati come tali ---------- */

function passo(n, titolo, fatto, corpo) {
  return `<div class="rule"><div>
    <h3>${esc(titolo)} ${fatto ? '<span class="pill p-t">fatto</span>' : ''}</h3>
    ${corpo}</div></div>`;
}

function disegna() {
  const box = document.getElementById('passi');
  const u = utente();

  if (!configurato()) {
    box.innerHTML = `<div class="vuotafs">Il database non è collegato: manca
      <code>assets/data/supabase.json</code>. Senza, il sito funziona lo stesso ma
      resta tutto in questo browser e non c'è nessun accesso.</div>`;
    return;
  }

  const l = lega(), s = squadra();

  box.innerHTML = `<div class="rules">
    ${passo(1, 'Il tuo account', Boolean(u), u
    ? `<p>Sei <strong>${esc(u.nome)}</strong> (${esc(u.email)}). L'account è tuo e non si condivide:
       se giocate in due sulla stessa squadra, fatevene uno a testa e sceglietela entrambi al passo 3.</p>`
    : `<p>Entra o registrati con la barra qui sopra. Serve un account perché il sito possa sapere
       quali dati sono tuoi.</p>`)}

    ${passo(2, 'La lega', Boolean(l), !u
    ? '<p style="color:var(--ink3)">Prima entra col tuo account.</p>'
    : disegnaLega())}

    ${passo(3, 'La tua squadra', Boolean(s), !l
    ? '<p style="color:var(--ink3)">Prima entra in una lega.</p>'
    : disegnaSquadre())}
  </div>
  ${errore ? `<p style="color:var(--warn);margin-top:1rem">${esc(errore)}</p>` : ''}`;

  collega();
  disegnaChiCe();
  disegnaAzzera();      // non si aspetta: legge l'asta e si disegna da sola
}

function disegnaLega() {
  const l = lega();
  const altre = leghe.filter(x => x.id !== l?.id);

  if (l) {
    return `<p>Stai lavorando su <strong>${esc(l.nome)}</strong>${l.ruolo === 'admin' ? ' — l\'hai creata tu, quindi puoi aggiungere e rinominare le squadre' : ''}.</p>
      <p class="spiega" style="padding:0">Per far entrare qualcuno passagli questo codice:
        <strong><code id="codice">${esc(l.codice)}</code></strong>
        <button class="chip" id="copiaCodice">copia</button></p>
      ${altre.length ? `<p style="margin-top:.6rem">Sei anche in
        ${altre.map(x => `<button class="chip" data-vai="${esc(x.id)}">${esc(x.nome)}</button>`).join(' ')}</p>` : ''}
      <details class="adv" style="margin-top:.6rem;border:0">
        <summary>entra in un'altra lega</summary>${modulaEntra()}</details>`;
  }

  return `<p>Non sei ancora in nessuna lega. Se un amico ti ha dato un codice usa il primo riquadro;
    se la lega la fai tu, il secondo.</p>
    ${modulaEntra()}
    <form class="idbar" id="fCrea" style="align-items:flex-end;margin-top:.6rem">
      <div class="fld" style="flex:1 1 180px"><label for="nomeLega">Crea una lega — come si chiama</label>
        <input id="nomeLega" type="text" required placeholder="Lega Bugnara"></div>
      <div class="fld" style="flex:1 1 130px"><label for="codiceNuovo">Codice da dare agli amici</label>
        <input id="codiceNuovo" type="text" required minlength="4" placeholder="bugnara"></div>
      <button class="btn" type="submit">Crea la lega</button>
    </form>`;
}

const modulaEntra = () => `<form class="idbar" id="fEntra" style="align-items:flex-end">
  <div class="fld" style="flex:1 1 160px"><label for="codice">Ho un codice</label>
    <input id="codiceEntra" type="text" required minlength="4" placeholder="bugnara"></div>
  <button class="btn" type="submit">Entra nella lega</button>
</form>`;

function disegnaSquadre() {
  const s = squadra();
  const squadre = squadreDellaLega();
  const membri = membriDellaLega();
  const quanti = id => membri.filter(m => m.squadra_id === id).length;

  if (!squadre.length) {
    return `<p>Questa lega non ha ancora nessuna squadra.</p>
      ${sonoAdmin() ? modulaSquadra() : '<p style="color:var(--ink3)">Le crea chi ha fatto la lega.</p>'}`;
  }

  return `<p>${s
    ? `Gestisci <strong>${esc(s.nome)}</strong>. Il tuo piano di spesa e la tua bozza sono suoi: li vede
       chi sta in questa squadra, e nessun altro.`
    : '<strong style="color:var(--warn)">Non hai ancora scelto la squadra.</strong> Scegline una: finché non lo fai, le pagine che dipendono dal tuo piano non hanno di chi parlare.'}</p>
    <div class="sqscelta">
      ${squadre.map(x => `<button class="sqbtn" data-squadra="${esc(x.id)}" aria-pressed="${x.id === s?.id}">
        <b>${esc(x.nome)}</b>
        <span>${quanti(x.id) === 0 ? 'libera' : quanti(x.id) === 1 ? 'un gestore' : `${quanti(x.id)} gestori`}</span>
      </button>`).join('')}
    </div>
    <p class="spiega" style="padding:.6rem 0 0">Se giocate in due sulla stessa fantasquadra, sceglietela
    tutti e due: vedrete e modificherete le stesse cose.</p>
    ${sonoAdmin() ? modulaSquadra() : ''}`;
}

const modulaSquadra = () => `<form class="idbar" id="fSquadra" style="align-items:flex-end;margin-top:.6rem">
  <div class="fld" style="flex:1 1 180px"><label for="nomeSquadra">Aggiungi una squadra</label>
    <input id="nomeSquadra" type="text" required placeholder="Nome della fantasquadra"></div>
  <button class="chip" type="submit">Aggiungi</button>
</form>`;

/* ---------- chi c'è nella lega ---------- */

function disegnaChiCe() {
  const box = document.getElementById('chiCe');
  if (!inLega()) { box.innerHTML = ''; return; }
  const squadre = squadreDellaLega();
  const membri = membriDellaLega();
  const nome = id => squadre.find(x => x.id === id)?.nome || '—';

  box.innerHTML = `<div class="tblwrap" style="max-height:none"><table><thead><tr>
      <th>Chi</th><th>Squadra</th><th>Ruolo</th></tr></thead><tbody>
      ${membri.map(m => `<tr>
        <td>${esc(m.nome || 'senza nome')}${m.utente_id === utente()?.id ? ' <span class="pill p-t">tu</span>' : ''}</td>
        <td>${m.squadra_id ? esc(nome(m.squadra_id)) : '<span style="color:var(--warn)">non ha scelto</span>'}</td>
        <td>${m.ruolo === 'admin' ? 'ha creato la lega' : 'membro'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="spiega" style="padding:.6rem 0 0">${squadre.length} squadre, ${membri.length}
      ${membri.length === 1 ? 'persona' : 'persone'}. Le squadre senza nessuno esistono lo stesso: servono a
      registrare chi si aggiudica cosa all'asta anche se quel fantallenatore non usa il sito.</p>`;
}

/* ---------- azzerare l'asta prima di quella vera ----------
 *
 * Fino a ieri l'unico modo di ripulire era «Svuota la mia rosa», nel listone,
 * che pulisce solo la propria: le prove pero' le fa chi organizza, e le fa su
 * tutte le squadre. Cosi' il giorno dell'asta ci si ritrova crediti gia'
 * spesi e giocatori gia' assegnati, e ce ne si accorge a meta' serata.
 *
 * Lo vede solo chi ha creato la lega, dice esattamente cosa sta per
 * cancellare, e chiede conferma. Non e' un gesto da fare per sbaglio.
 */
let inCorsoAzzera = false;

async function disegnaAzzera() {
  const box = document.getElementById('azzera');
  const sez = document.getElementById('sezAzzera');
  if (!box || inCorsoAzzera) return;
  const mostra = v => { if (sez) sez.hidden = !v; };
  if (!inLega() || !sonoAdmin()) { box.innerHTML = ''; mostra(false); return; }

  inCorsoAzzera = true;
  let m = null;
  try { await caricaAsta(); m = quantiMovimenti(); }
  catch { box.innerHTML = ''; mostra(false); return; }
  finally { inCorsoAzzera = false; }
  mostra(true);

  if (!m.totale) {
    box.innerHTML = `<p class="spiega">L'asta della lega è vuota: nessun acquisto registrato.
      Siete pronti per quella vera.</p>`;
    return;
  }

  const righe = m.perSquadra.map(s => `${esc(s.nome)}: ${s.presi}`).join(' · ')
    + (m.senzaNome ? ` · ${m.senzaNome} segnati presi senza dire da chi` : '');

  box.innerHTML = `<p class="spiega">Nell'asta della lega ci sono <strong>${m.totale}</strong>
      ${m.totale === 1 ? 'aggiudicazione' : 'aggiudicazioni'} — ${righe}.
      Se sono le prove, toglile prima di cominciare: se no si parte con crediti già spesi.</p>
    <button class="btn pericolo" id="btnAzzera">Azzera l'asta di tutta la lega</button>`;

  document.getElementById('btnAzzera').onclick = async () => {
    const ok = await chiediConferma({
      titolo: 'Azzerare l\'asta di tutta la lega?',
      testo: `Vengono tolte tutte e ${m.totale} le aggiudicazioni, da ogni squadra, `
        + 'e ognuno torna con i crediti interi. Lo vedranno tutti quelli della lega, subito. '
        + 'Non si torna indietro.',
      ok: 'Sì, azzera',
      pericolo: true,
    });
    if (!ok) return;
    try {
      const quanti = azzeraAsta();
      await salvaAsta();
      toast(`${quanti} aggiudicazioni tolte: l'asta riparte da zero.`);
    } catch (e) {
      errore = e.message;
    }
    disegna();
    disegnaAzzera();
  };
}

/* ---------- comandi ---------- */

function collega() {
  const q = id => document.getElementById(id);

  q('fEntra')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await entraInLega(q('codiceEntra').value.trim());
      leghe = await mieLeghe();
      toast('Sei dentro. Adesso scegli la squadra.');
      disegna();
    } catch (err) { errore = err.message; disegna(); }
  });

  q('fCrea')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await creaLega(q('nomeLega').value.trim(), q('codiceNuovo').value.trim());
      leghe = await mieLeghe();
      toast('Lega creata. Ora aggiungi le squadre.');
      disegna();
    } catch (err) { errore = err.message; disegna(); }
  });

  q('fSquadra')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await creaSquadra(q('nomeSquadra').value.trim());
      toast('Squadra aggiunta.');
      disegna();
    } catch (err) { errore = err.message; disegna(); }
  });

  q('copiaCodice')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lega().codice);
      toast('Codice copiato: passalo a chi vuoi far entrare.');
    } catch { toast('Copialo a mano: ' + lega().codice); }
  });

  for (const b of document.querySelectorAll('[data-squadra]')) {
    b.onclick = async () => {
      try {
        await scegliSquadra(b.dataset.squadra);
        toast('Da adesso lavori per ' + squadra().nome + '.');
        disegna();
      } catch (err) { errore = err.message; disegna(); }
    };
  }

  for (const b of document.querySelectorAll('[data-vai]')) {
    b.onclick = async () => {
      try { await cambiaLega(b.dataset.vai); disegna(); }
      catch (err) { errore = err.message; disegna(); }
    };
  }
}

await ricarica();
