/* Pagina "Fantasquadre": le squadre della lega, i proprietari, le rose che si
   formano durante l'asta e i crediti che restano. Condivisa nel database. */
import { caricaDati, ricalcola, badgeRuolo, asta, gestisce, RUOLI } from './app.js?v=14';
import {
  avvia, configurato, collegato, utente, leggi, scrivi, osserva,
  montaAccesso, esc, quando,
} from './db.js?v=14';
import { chiediCampi, conferma as chiediConferma, autosalva, toast } from './ui.js?v=14';

const CHIAVE = 'fantasquadre';
const VUOTO = { squadre: [] };

const { players, lega } = await caricaDati();

let cfg = lega;
try {
  const salvata = JSON.parse(localStorage.getItem('pianoAsta:cfg:v1') || 'null');
  if (salvata) cfg = { ...structuredClone(lega), ...salvata };
} catch { /* storage non disponibile */ }
ricalcola(players, cfg, cfg.piano);

const perId = Object.fromEntries(players.map(p => [`${p.r}|${p.n}|${p.sq}`, p]));

let dati = structuredClone(VUOTO);
let versione = 0, sporca = false, messaggio = '', statoBarra = '';
let apertaPerAggiunta = null;

await avvia();
montaAccesso(document.getElementById('accesso'), () => { disegnaBarra(); carica(); });

const nuovoId = () => 's' + Math.random().toString(36).slice(2, 9);

/* ---------- allineamento con "La mia rosa" e col listone ----------
   La fantasquadra vive nel database ed e' condivisa; "La mia rosa" e il
   listone leggono invece lo stato locale di questo browser. Ogni volta che
   qui dentro cambia una rosa, aggiorniamo anche quello: altrimenti togli un
   giocatore da qui e te lo ritrovi ancora fra i tuoi acquisti. */

let stato = asta.leggi();
let altrui = asta.leggiAltrui();

const miaSquadra = () => {
  const io = utente()?.nome || '';
  return io ? dati.squadre.find(s => gestisce(s.proprietario, io)) : null;
};

function segnaPreso(idSquadra, gid, prezzo) {
  if (miaSquadra()?.id === idSquadra) { stato[gid] = prezzo; altrui.delete(gid); }
  else { altrui.add(gid); delete stato[gid]; }
  asta.scrivi(stato); asta.scriviAltrui(altrui);
}

function segnaLibero(gid) {
  delete stato[gid];
  altrui.delete(gid);
  asta.scrivi(stato); asta.scriviAltrui(altrui);
}

/* Ogni modifica si salva da sola dopo un attimo di pausa: niente da ricordarsi. */
const auto = autosalva(() => salva(true));

function fondi(remoto, locale) {
  const uniti = new Map();
  for (const s of (remoto?.squadre || [])) uniti.set(s.id, s);
  for (const s of locale.squadre) {
    const e = uniti.get(s.id);
    if (!e || (s.quando || '') >= (e.quando || '')) uniti.set(s.id, s);
  }
  for (const id of (locale._rimosse || [])) uniti.delete(id);
  return { ...locale, squadre: [...uniti.values()] };
}

/* ---------- carica e salva ---------- */

async function carica() {
  if (!configurato()) {
    messaggio = 'Il database non è ancora configurato: vedi il README.';
    statoBarra = 'errore';
    return (disegnaBarra(), disegna());
  }
  /* Senza accesso il database non restituisce errore: restituisce zero righe.
     Senza questo controllo sembrerebbe che le fantasquadre non esistano, mentre
     sono li' e non le stiamo semplicemente vedendo. */
  if (!collegato()) {
    dati = structuredClone(VUOTO);
    versione = 0;
    sporca = false;
    statoBarra = 'sporca';
    messaggio = 'Entra col tuo account qui sopra per vedere le fantasquadre.';
    return (disegnaBarra(), disegna());
  }
  try {
    const r = await leggi(CHIAVE, structuredClone(VUOTO));
    dati = r.dati || structuredClone(VUOTO);
    dati.squadre ||= [];
    versione = r.versione;
    sporca = false;
    statoBarra = '';
    messaggio = r.nuovo
      ? 'Nessuna squadra ancora. Aggiungi la prima.'
      : `Ultimo salvataggio di ${esc(r.da || 'qualcuno')}, ${quando(r.aggiornato)}.`;
  } catch (e) {
    statoBarra = 'errore';
    messaggio = e.message;
  }
  disegnaBarra();
  disegna();
}

async function salva(automatico = false) {
  if (!collegato()) {
    statoBarra = 'errore';
    messaggio = 'Per salvare devi entrare col tuo account qui sopra.';
    return disegnaBarra();
  }
  if (automatico && !sporca) return;
  messaggio = 'Salvo…';
  statoBarra = '';
  disegnaBarra();
  try {
    const r = await scrivi(CHIAVE, dati, versione, fondi);
    versione = r.versione;
    if (r.fuso) { dati = r.dati; messaggio = 'Salvato, e ho unito le modifiche arrivate nel frattempo.'; }
    else messaggio = 'Salvato ' + quando(new Date().toISOString()) + '.';
    sporca = false;
    delete dati._rimosse;
  } catch (e) {
    statoBarra = 'errore';
    messaggio = e.message;
  }
  disegnaBarra();
  disegna();
}

function disegnaBarra() {
  const b = document.getElementById('barra');
  b.className = 'savebar' + (statoBarra ? ' ' + statoBarra : sporca ? ' sporca' : '');
  b.innerHTML = `<span class="dot"></span>
    <span class="msg">${sporca ? 'Salvo fra un istante… ' : ''}${esc(messaggio)}</span>
    <button class="btn" id="nuova">Nuova squadra</button>
    <button class="chip" id="salva"${collegato() ? '' : ' disabled title="Devi entrare"'}>Salva ora</button>
    <button class="chip" id="ricarica">Ricarica</button>`;
  b.querySelector('#salva').onclick = () => auto.subito();
  b.querySelector('#ricarica').onclick = carica;
  b.querySelector('#nuova').onclick = nuovaSquadra;
}

/* ---------- operazioni ---------- */

function tocca(s) {
  s.quando = new Date().toISOString();
  s.chi = utente()?.nome || 'anonimo';
  sporca = true;
  auto.tocca();
}

async function nuovaSquadra() {
  const r = await chiediCampi({
    titolo: 'Nuova fantasquadra',
    testo: 'Se è la tua, scrivi come allenatore lo stesso nome del tuo account: il sito la riconosce e la evidenzia. Puoi cambiare tutto anche dopo.',
    ok: 'Crea',
    campi: [
      { id: 'nome', etichetta: 'Nome della squadra', obbligatorio: true, placeholder: 'es. Bugnara FC' },
      { id: 'prop', etichetta: 'Allenatore (chi la gestisce)', valore: utente()?.nome || '', placeholder: 'es. Pierre' },
    ],
  });
  if (!r) return;
  const s = { id: nuovoId(), nome: r.nome, proprietario: r.prop, rosa: [] };
  tocca(s);
  dati.squadre.push(s);
  disegnaBarra();
  disegna();
}

const speso = s => (s.rosa || []).reduce((a, g) => a + (Number(g.prezzo) || 0), 0);
const contaRuolo = (s, r) => (s.rosa || []).filter(g => g.r === r).length;

/* ---------- disegno ---------- */

function disegna() {
  const griglia = document.getElementById('griglia');
  const mio = utente()?.nome || '';

  if (!dati.squadre.length) {
    griglia.innerHTML = collegato()
      ? '<div class="vuotafs">Nessuna fantasquadra. Premi <strong>Nuova squadra</strong> per aggiungere la prima: nome, allenatore, e poi la rosa man mano che l\'asta procede.</div>'
      : '<div class="vuotafs">Le fantasquadre stanno nel database condiviso, non in questo browser: sono le stesse che vedi da qualsiasi computer, tue e di Aurelio. Per vederle <strong>entra col tuo account</strong> nel riquadro qui sopra — è lo stesso indirizzo email che hai usato la prima volta.</div>';
    return disegnaRiepilogo();
  }

  griglia.innerHTML = dati.squadre.map(s => {
    const sp = speso(s);
    const residuo = cfg.crediti - sp;
    const mia = gestisce(s.proprietario, mio);
    const totSlot = RUOLI.reduce((a, r) => a + cfg.slot[r], 0);

    const meta = RUOLI.map(r => {
      const n = contaRuolo(s, r);
      const pieno = n >= cfg.slot[r];
      return `<span${pieno ? ' style="color:var(--acc)"' : ''}>${badgeRuolo(r)}<b>${n}</b>/${cfg.slot[r]}</span>`;
    }).join('');

    const rosa = (s.rosa || []).length
      ? [...s.rosa].sort((a, b) => RUOLI.indexOf(a.r) - RUOLI.indexOf(b.r) || (b.prezzo || 0) - (a.prezzo || 0))
        .map(g => `<div class="fsrow">${badgeRuolo(g.r)}<span>${esc(g.n)}</span>
          <span style="color:var(--ink3);font-weight:400">${esc(g.sq)}</span>
          <span class="pz">${Number(g.prezzo) || 0}</span>
          <button class="rimuovi" data-tolgi="${esc(g.id)}" data-da="${esc(s.id)}" title="Togli ${esc(g.n)} dalla rosa" aria-label="Togli ${esc(g.n)} dalla rosa">✕</button></div>`).join('')
      : '<div class="vuotafs">Rosa ancora vuota.</div>';

    const ricerca = apertaPerAggiunta === s.id
      ? `<div class="aggiungi" style="border-top:1px solid var(--line);border-bottom:0">
           <input type="search" class="cercaGioc" data-per="${esc(s.id)}" placeholder="Cerca il giocatore da assegnare…" aria-label="Cerca giocatore" style="flex:1 1 200px">
           <div class="sugg" data-sugg="${esc(s.id)}"></div></div>`
      : '';

    return `<div class="fscard${mia ? ' mia' : ''}">
      <div class="fshead">
        <span class="nome">${esc(s.nome)}</span>
        <button type="button" class="prop" data-modifica="${esc(s.id)}"
          title="Cambia nome e allenatore">${s.proprietario
            ? '👤 ' + esc(s.proprietario)
            : '👤 aggiungi allenatore'}</button>
        <span class="cr">${residuo}<small> di ${cfg.crediti} cr</small></span>
      </div>
      <div class="fsmeta">${meta}<span style="margin-left:auto">${(s.rosa || []).length}/${totSlot} slot</span></div>
      ${rosa}${ricerca}
      <div class="fsazioni">
        <button class="chip" data-aggiungi="${esc(s.id)}">${apertaPerAggiunta === s.id ? 'chiudi' : 'aggiungi giocatore'}</button>
        <button class="chip" data-modifica="${esc(s.id)}">nome e allenatore</button>
        <button class="chip" data-elimina="${esc(s.id)}">elimina</button>
        ${s.chi ? `<span class="firma" style="margin-left:auto;align-self:center">ultimo tocco: ${esc(s.chi)}${s.quando ? ' · ' + quando(s.quando) : ''}</span>` : ''}
      </div></div>`;
  }).join('');

  disegnaRiepilogo();
  if (apertaPerAggiunta) griglia.querySelector('.cercaGioc')?.focus();
}

function disegnaRiepilogo() {
  const presi = dati.squadre.reduce((a, s) => a + (s.rosa || []).length, 0);
  const spesoTot = dati.squadre.reduce((a, s) => a + speso(s), 0);
  const monte = cfg.crediti * dati.squadre.length;
  document.getElementById('totali').innerHTML = `
    <div class="lcell"><div class="k">Squadre</div><div class="n">${dati.squadre.length}<small> / ${cfg.squadre}</small></div></div>
    <div class="lcell"><div class="k">Giocatori assegnati</div><div class="n">${presi}</div></div>
    <div class="lcell"><div class="k">Crediti già spesi</div><div class="n">${spesoTot}<small> / ${monte}</small></div></div>
    <div class="lcell"><div class="k">Ancora sul mercato</div><div class="n">${monte - spesoTot}</div></div>`;
}

/* ---------- interazioni ---------- */

const griglia = document.getElementById('griglia');

griglia.addEventListener('click', e => {
  const trova = id => dati.squadre.find(x => x.id === id);

  const bAdd = e.target.closest('button[data-aggiungi]');
  if (bAdd) {
    apertaPerAggiunta = apertaPerAggiunta === bAdd.dataset.aggiungi ? null : bAdd.dataset.aggiungi;
    return disegna();
  }

  const bMod = e.target.closest('button[data-modifica]');
  if (bMod) {
    const s = trova(bMod.dataset.modifica);
    chiediCampi({
      titolo: 'Nome e allenatore',
      testo: 'Se la squadra è tua, scrivi come allenatore lo stesso nome del tuo account: il sito la riconosce e la evidenzia.',
      ok: 'Salva',
      campi: [
        { id: 'nome', etichetta: 'Nome della squadra', valore: s.nome, obbligatorio: true },
        { id: 'prop', etichetta: 'Allenatore (chi la gestisce)', valore: s.proprietario || '', placeholder: 'es. Aurelio' },
      ],
    }).then(r => {
      if (!r) return;
      s.nome = r.nome;
      s.proprietario = r.prop;
      // se questa squadra e' appena diventata (o non e' piu') la tua,
      // la sua rosa entra o esce da "La mia rosa"
      for (const g of (s.rosa || [])) segnaPreso(s.id, g.id, g.prezzo);
      tocca(s); disegnaBarra(); disegna();
    });
    return;
  }

  const bDel = e.target.closest('button[data-elimina]');
  if (bDel) {
    const s = trova(bDel.dataset.elimina);
    chiediConferma({
      titolo: `Elimino "${s.nome}"?`,
      testo: `Sparisce anche la sua rosa di ${(s.rosa || []).length} giocatori, che tornano liberi.`,
      ok: 'Sì, elimina', pericolo: true,
    }).then(si => {
      if (!si) return;
      for (const g of (s.rosa || [])) segnaLibero(g.id);
      dati.squadre = dati.squadre.filter(x => x.id !== s.id);
      (dati._rimosse ||= []).push(s.id);
      sporca = true; auto.tocca();
      disegnaBarra(); disegna();
    });
    return;
  }

  const bTolgi = e.target.closest('button[data-tolgi]');
  if (bTolgi) {
    /* attenzione: l'id del giocatore contiene già delle barrette (A|Malen|Roma),
       quindi squadra e giocatore viaggiano in due attributi separati. */
    const gid = bTolgi.dataset.tolgi;
    const s = trova(bTolgi.dataset.da);
    if (!s) return;
    const via = (s.rosa || []).find(g => g.id === gid);
    s.rosa = (s.rosa || []).filter(g => g.id !== gid);
    segnaLibero(gid);
    tocca(s); disegnaBarra(); disegna();
    if (via) toast(`${via.n} tolto da ${s.nome}: torna libero all'asta.`);
    return;
  }

  const bScegli = e.target.closest('button[data-scegli]');
  if (bScegli) {
    const [sid, gid] = bScegli.dataset.scegli.split('~');
    const s = trova(sid);
    const p = perId[gid];
    if (!p) return;
    chiediCampi({
      titolo: `${p.n} · ${p.sq}`,
      testo: `Va a ${s.nome}. Il tetto consigliato è ${p.max} crediti.`,
      ok: 'Aggiungi',
      campi: [{ id: 'prezzo', etichetta: 'Prezzo pagato', tipo: 'numero', valore: p.max, min: 0, max: cfg.crediti }],
    }).then(r => {
      if (!r) return;
      const prezzo = Math.max(0, r.prezzo);
      (s.rosa ||= []).push({ id: gid, n: p.n, sq: p.sq, r: p.r, prezzo });
      segnaPreso(s.id, gid, prezzo);
      tocca(s);
      apertaPerAggiunta = null;
      disegnaBarra(); disegna();
    });
    return;
  }
});

griglia.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList.contains('cercaGioc')) return;
  const sid = el.dataset.per;
  const box = griglia.querySelector(`[data-sugg="${sid}"]`);
  const s = el.value.trim().toLowerCase();
  if (s.length < 2) { box.innerHTML = ''; return; }

  const presiOvunque = new Set(dati.squadre.flatMap(x => (x.rosa || []).map(g => g.id)));
  const trovati = players.filter(p => p.n.toLowerCase().includes(s) || p.sq.toLowerCase().includes(s))
    .sort((a, b) => b.max - a.max).slice(0, 12);

  box.innerHTML = trovati.map(p => {
    const gid = `${p.r}|${p.n}|${p.sq}`;
    const preso = presiOvunque.has(gid);
    return `<button type="button" data-scegli="${esc(sid)}~${esc(gid)}"${preso ? ' disabled' : ''}>
      ${badgeRuolo(p.r)}<span>${esc(p.n)}</span>
      <span style="color:var(--ink3);font-weight:400">${esc(p.sq)}</span>
      ${preso ? '<span class="gia">già assegnato</span>' : `<span class="mx">${p.max}</span>`}</button>`;
  }).join('') || '<div style="padding:.7rem .8rem;color:var(--ink3);font-size:.85rem">Nessuno con questo nome.</div>';
});

osserva(CHIAVE, () => versione, r => {
  if (sporca) {
    statoBarra = 'sporca';
    messaggio = `${esc(r.da || 'Qualcuno')} ha salvato una versione più recente. Salvando, le due si uniscono.`;
    return disegnaBarra();
  }
  dati = r.dati || structuredClone(VUOTO);
  dati.squadre ||= [];
  versione = r.versione;
  messaggio = `Aggiornato: ${esc(r.da || 'qualcuno')} ha appena salvato.`;
  disegnaBarra();
  disegna();
});

await carica();
