/* Pagina "Bozza": la rosa ideale che costruite insieme.
   I dati stanno nel database condiviso, non nel browser. */
import { caricaDati, ricalcola, badgeRuolo, RUOLI, NOME_RUOLO } from './app.js?v=20';
import {
  avvia, configurato, collegato, utente, leggi, scrivi, osserva,
  montaAccesso, esc, quando,
} from './db.js?v=20';
import { autosalva, conferma as chiediConferma } from './ui.js?v=20';

const CHIAVE = 'bozza';
const VUOTA = { giocatori: [] };

const { players, lega } = await caricaDati();

let cfg = lega;
try {
  const salvata = JSON.parse(localStorage.getItem('pianoAsta:cfg:v1') || 'null');
  if (salvata) cfg = { ...structuredClone(lega), ...salvata };
} catch { /* storage non disponibile */ }
ricalcola(players, cfg, cfg.piano);

const perId = Object.fromEntries(players.map(p => [`${p.r}|${p.n}|${p.sq}`, p]));

let bozza = structuredClone(VUOTA);
let versione = 0;
let sporca = false;
let messaggio = '';
let statoBarra = '';

/* come nelle fantasquadre: si salva da solo poco dopo l'ultima modifica */
const auto = autosalva(() => salva(true));

await avvia();
montaAccesso(document.getElementById('accesso'), () => { disegnaBarra(); carica(); });

/* ---------- fusione, se due persone salvano insieme ---------- */

function fondi(remota, locale) {
  const uniti = new Map();
  for (const g of (remota?.giocatori || [])) uniti.set(g.id, g);
  for (const g of locale.giocatori) {
    const e = uniti.get(g.id);
    if (!e || (g.quando || '') >= (e.quando || '')) uniti.set(g.id, g);
  }
  for (const id of (locale._rimossi || [])) uniti.delete(id);
  return { ...locale, giocatori: [...uniti.values()] };
}

/* ---------- carica ---------- */

async function carica() {
  if (!configurato()) {
    messaggio = 'Il database non è ancora configurato: vedi il README.';
    statoBarra = 'errore';
    return (disegnaBarra(), disegna());
  }
  /* senza accesso il database restituisce zero righe, non un errore: senza
     questo controllo la bozza sembrerebbe vuota invece che nascosta */
  if (!collegato()) {
    bozza = structuredClone(VUOTA);
    versione = 0;
    sporca = false;
    statoBarra = 'sporca';
    messaggio = 'Entra col tuo account qui sopra per vedere la bozza.';
    return (disegnaBarra(), disegna());
  }
  try {
    const r = await leggi(CHIAVE, structuredClone(VUOTA));
    bozza = r.dati || structuredClone(VUOTA);
    bozza.giocatori ||= [];
    versione = r.versione;
    sporca = false;
    statoBarra = '';
    messaggio = r.nuovo
      ? 'Bozza ancora vuota. Aggiungi il primo giocatore.'
      : `Ultimo salvataggio di ${esc(r.da || 'qualcuno')}, ${quando(r.aggiornato)}.`;
  } catch (e) {
    statoBarra = 'errore';
    messaggio = e.message;
  }
  disegnaBarra();
  disegna();
}

/* ---------- salva ---------- */

async function salva(automatico = false) {
  if (automatico && !sporca) return;
  if (!collegato()) {
    statoBarra = 'errore';
    messaggio = 'Per salvare devi entrare col tuo account qui sopra.';
    return disegnaBarra();
  }
  messaggio = 'Salvo…';
  statoBarra = '';
  disegnaBarra();
  try {
    const r = await scrivi(CHIAVE, bozza, versione, fondi);
    versione = r.versione;
    if (r.fuso) { bozza = r.dati; messaggio = 'Salvato, e ho unito le modifiche arrivate nel frattempo.'; }
    else messaggio = 'Salvato ' + quando(new Date().toISOString()) + '.';
    sporca = false;
    delete bozza._rimossi;
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
    <button class="chip" id="salva"${collegato() ? '' : ' disabled title="Devi entrare"'}>Salva ora</button>
    <button class="chip" id="ricarica">Ricarica</button>`;
  b.querySelector('#salva').onclick = () => auto.subito();
  b.querySelector('#ricarica').onclick = carica;
}

/* ---------- disegno ---------- */

function disegna() {
  const box = document.getElementById('reparti');
  let totale = 0;

  box.innerHTML = RUOLI.map(r => {
    const lista = bozza.giocatori.filter(g => g.r === r).sort((a, b) => (b.prezzo || 0) - (a.prezzo || 0));
    const speso = lista.reduce((a, g) => a + (Number(g.prezzo) || 0), 0);
    totale += speso;
    const oltre = lista.length > cfg.slot[r];

    const righe = lista.length ? lista.map(g => {
      const p = perId[g.id];
      const sforato = p && Number(g.prezzo) > p.max;
      return `<div class="repitem${sforato ? ' sforato' : ''}">
        <span class="gioc">${badgeRuolo(g.r)}<span class="testo"><span class="nm">${esc(g.n)}</span>
          <span class="sq" style="color:var(--ink3)">${esc(g.sq)}</span></span></span>
        ${p ? `<span class="firma" title="Il tuo tetto">max ${p.max}</span>` : ''}
        <span class="firma">${esc(g.chi || '')}${g.quando ? ' · ' + quando(g.quando) : ''}</span>
        <input class="pz" type="number" min="0" max="${cfg.crediti}" value="${Number(g.prezzo) || 0}"
               data-prezzo="${esc(g.id)}" aria-label="Prezzo previsto per ${esc(g.n)}">
        <button class="rimuovi" data-rimuovi="${esc(g.id)}" title="Togli dalla bozza" aria-label="Togli ${esc(g.n)}">✕</button>
      </div>`;
    }).join('') : '<div class="vuoto">Nessuno ancora. Cercalo qui sopra e aggiungilo.</div>';

    return `<div class="repbox"><div class="rephead" data-r="${r}">${badgeRuolo(r)}${NOME_RUOLO[r]}
      <span class="sp"${oltre ? ' style="color:var(--warn)"' : ''}>${lista.length}/${cfg.slot[r]} · ${speso} di ${cfg.piano[r]} cr</span></div>
      <div class="replist">${righe}</div></div>`;
  }).join('');

  const slotTot = RUOLI.reduce((a, r) => a + cfg.slot[r], 0);
  document.getElementById('totali').innerHTML = `
    <div class="lcell"><div class="k">Giocatori</div><div class="n">${bozza.giocatori.length}<small> / ${slotTot}</small></div></div>
    <div class="lcell${totale > cfg.crediti ? ' over' : ''}"><div class="k">Totale previsto</div>
      <div class="n">${totale}<small> / ${cfg.crediti} cr</small></div></div>
    <div class="lcell"><div class="k">Restano</div><div class="n">${cfg.crediti - totale}</div></div>`;
}

/* ---------- aggiunta ---------- */

const campo = document.getElementById('cerca');
const sugg = document.getElementById('sugg');

campo.addEventListener('input', () => {
  const s = campo.value.trim().toLowerCase();
  if (s.length < 2) { sugg.innerHTML = ''; return; }
  const trovati = players.filter(p => p.n.toLowerCase().includes(s) || p.sq.toLowerCase().includes(s))
    .sort((a, b) => b.max - a.max).slice(0, 12);

  sugg.innerHTML = trovati.map(p => {
    const id = `${p.r}|${p.n}|${p.sq}`;
    const gia = bozza.giocatori.some(g => g.id === id);
    return `<button type="button" data-add="${esc(id)}"${gia ? ' disabled' : ''}>
      ${badgeRuolo(p.r)}<span>${esc(p.n)}</span>
      <span style="color:var(--ink3);font-weight:400">${esc(p.sq)}</span>
      ${gia ? '<span class="gia">già in bozza</span>' : `<span class="mx">${p.max}</span>`}</button>`;
  }).join('') || '<div style="padding:.7rem .8rem;color:var(--ink3);font-size:.85rem">Nessuno con questo nome.</div>';
});

sugg.addEventListener('click', e => {
  const b = e.target.closest('button[data-add]');
  if (!b) return;
  const p = perId[b.dataset.add];
  if (!p) return;
  bozza.giocatori.push({
    id: b.dataset.add, n: p.n, sq: p.sq, r: p.r, prezzo: p.max,
    chi: utente()?.nome || 'anonimo', quando: new Date().toISOString(),
  });
  sporca = true;
  auto.tocca();
  campo.value = '';
  sugg.innerHTML = '';
  disegnaBarra();
  disegna();
});

document.addEventListener('click', e => { if (!e.target.closest('.aggiungi')) sugg.innerHTML = ''; });

/* ---------- modifica e rimozione ---------- */

const reparti = document.getElementById('reparti');

reparti.addEventListener('change', e => {
  if (!e.target.dataset.prezzo) return;
  const g = bozza.giocatori.find(x => x.id === e.target.dataset.prezzo);
  if (!g) return;
  g.prezzo = Math.max(0, parseInt(e.target.value, 10) || 0);
  g.chi = utente()?.nome || 'anonimo';
  g.quando = new Date().toISOString();
  sporca = true;
  auto.tocca();
  disegnaBarra();
  disegna();
});

reparti.addEventListener('click', e => {
  const b = e.target.closest('button[data-rimuovi]');
  if (!b) return;
  bozza.giocatori = bozza.giocatori.filter(g => g.id !== b.dataset.rimuovi);
  (bozza._rimossi ||= []).push(b.dataset.rimuovi);
  sporca = true;
  auto.tocca();
  disegnaBarra();
  disegna();
});

/* ---------- tiene d'occhio le modifiche dell'altro ---------- */

osserva(CHIAVE, () => versione, r => {
  if (sporca) {
    statoBarra = 'sporca';
    messaggio = `${esc(r.da || 'Qualcuno')} ha salvato una versione più recente. Salvando, le due si uniscono.`;
    return disegnaBarra();
  }
  bozza = r.dati || structuredClone(VUOTA);
  bozza.giocatori ||= [];
  versione = r.versione;
  messaggio = `Aggiornato: ${esc(r.da || 'qualcuno')} ha appena salvato.`;
  disegnaBarra();
  disegna();
});

await carica();
