/* Pagina "Fantasquadre": le squadre della lega, i proprietari, le rose che si
   formano durante l'asta e i crediti che restano. Condivisa nel database. */
import { caricaDati, ricalcola, badgeRuolo, RUOLI } from './app.js';
import {
  avvia, configurato, collegato, utente, leggi, scrivi, osserva,
  montaAccesso, esc, quando,
} from './db.js';

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

async function salva() {
  if (!collegato()) {
    statoBarra = 'errore';
    messaggio = 'Per salvare devi entrare col tuo account qui sopra.';
    return disegnaBarra();
  }
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
    <span class="msg">${sporca ? 'Modifiche non ancora salvate. ' : ''}${esc(messaggio)}</span>
    <button class="btn" id="nuova">Nuova squadra</button>
    <button class="btn" id="salva"${collegato() ? '' : ' disabled title="Devi entrare"'}>Salva</button>
    <button class="chip" id="ricarica">Ricarica</button>`;
  b.querySelector('#salva').onclick = salva;
  b.querySelector('#ricarica').onclick = carica;
  b.querySelector('#nuova').onclick = nuovaSquadra;
}

/* ---------- operazioni ---------- */

function tocca(s) {
  s.quando = new Date().toISOString();
  s.chi = utente()?.nome || 'anonimo';
  sporca = true;
}

function nuovaSquadra() {
  const nome = window.prompt('Nome della fantasquadra');
  if (!nome || !nome.trim()) return;
  const prop = window.prompt('Chi la gestisce?', '') || '';
  const s = { id: nuovoId(), nome: nome.trim(), proprietario: prop.trim(), rosa: [] };
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
  const mio = (utente()?.nome || '').toLowerCase();

  if (!dati.squadre.length) {
    griglia.innerHTML = '<div class="vuotafs">Nessuna fantasquadra. Premi <strong>Nuova squadra</strong> per aggiungere la prima: nome, proprietario, e poi la rosa man mano che l\'asta procede.</div>';
    return disegnaRiepilogo();
  }

  griglia.innerHTML = dati.squadre.map(s => {
    const sp = speso(s);
    const residuo = cfg.crediti - sp;
    const mia = mio && (s.proprietario || '').toLowerCase() === mio;
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
          <button class="rimuovi" data-tolgi="${esc(s.id)}|${esc(g.id)}" title="Togli dalla rosa" aria-label="Togli ${esc(g.n)}">✕</button></div>`).join('')
      : '<div class="vuotafs">Rosa ancora vuota.</div>';

    const ricerca = apertaPerAggiunta === s.id
      ? `<div class="aggiungi" style="border-top:1px solid var(--line);border-bottom:0">
           <input type="search" class="cercaGioc" data-per="${esc(s.id)}" placeholder="Cerca il giocatore da assegnare…" aria-label="Cerca giocatore" style="flex:1 1 200px">
           <div class="sugg" data-sugg="${esc(s.id)}"></div></div>`
      : '';

    return `<div class="fscard${mia ? ' mia' : ''}">
      <div class="fshead">
        <span class="nome">${esc(s.nome)}</span>
        <span class="prop">${s.proprietario ? esc(s.proprietario) : 'senza proprietario'}</span>
        <span class="cr">${residuo}<small> di ${cfg.crediti} cr</small></span>
      </div>
      <div class="fsmeta">${meta}<span style="margin-left:auto">${(s.rosa || []).length}/${totSlot} slot</span></div>
      ${rosa}${ricerca}
      <div class="fsazioni">
        <button class="chip" data-aggiungi="${esc(s.id)}">${apertaPerAggiunta === s.id ? 'chiudi' : 'aggiungi giocatore'}</button>
        <button class="chip" data-modifica="${esc(s.id)}">rinomina</button>
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
    const nome = window.prompt('Nome della fantasquadra', s.nome);
    if (nome === null) return;
    const prop = window.prompt('Chi la gestisce?', s.proprietario || '');
    if (prop === null) return;
    s.nome = nome.trim() || s.nome;
    s.proprietario = prop.trim();
    tocca(s); disegnaBarra(); return disegna();
  }

  const bDel = e.target.closest('button[data-elimina]');
  if (bDel) {
    const s = trova(bDel.dataset.elimina);
    if (!window.confirm(`Elimino "${s.nome}"? Sparisce anche la sua rosa.`)) return;
    dati.squadre = dati.squadre.filter(x => x.id !== s.id);
    (dati._rimosse ||= []).push(s.id);
    sporca = true; disegnaBarra(); return disegna();
  }

  const bTolgi = e.target.closest('button[data-tolgi]');
  if (bTolgi) {
    const [sid, gid] = bTolgi.dataset.tolgi.split('|');
    const s = trova(sid);
    s.rosa = (s.rosa || []).filter(g => g.id !== gid);
    tocca(s); disegnaBarra(); return disegna();
  }

  const bScegli = e.target.closest('button[data-scegli]');
  if (bScegli) {
    const [sid, gid] = bScegli.dataset.scegli.split('~');
    const s = trova(sid);
    const p = perId[gid];
    if (!p) return;
    const prezzo = window.prompt(`A quanto è andato ${p.n}?`, String(p.max));
    if (prezzo === null) return;
    (s.rosa ||= []).push({ id: gid, n: p.n, sq: p.sq, r: p.r, prezzo: Math.max(0, parseInt(prezzo, 10) || 0) });
    tocca(s);
    apertaPerAggiunta = null;
    disegnaBarra(); return disegna();
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
