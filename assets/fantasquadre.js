/* Pagina "Fantasquadre": le squadre della lega, i proprietari, le rose che si
   formano durante l'asta e i crediti che restano. Condivisa nel database. */
import { caricaDati, ricalcola, badgeRuolo, RUOLI } from './app.js?v=46d08b41';
import {
  pronto, configurato, collegato, squadra, squadreDellaLega, membriDellaLega,
  montaAccesso, esc, quando,
} from './db.js?v=6824e6b7';
import {
  caricaAsta, salvaAsta, accetta, osservaAsta, documento, metaAsta,
  allineaAllaLega, assegna as aggiudica, libera as rimetti,
} from './astaLega.js?v=c262ae13';
import { chiediCampi, conferma as chiediConferma, autosalva, toast } from './ui.js?v=2606df5a';
import { leggiCfg } from './cfg.js?v=7661d252';

const { players, lega } = await caricaDati();

/* Le regole della lega arrivano dal database condiviso: vedi assets/cfg.js */
const { cfg } = await leggiCfg(lega);
ricalcola(players, cfg, cfg.piano);

const perId = Object.fromEntries(players.map(p => [`${p.r}|${p.n}|${p.sq}`, p]));

/* Le rose stanno in `astaLega.js`, insieme al resto dell'asta: questa pagina
   e il listone sono due modi di guardare lo stesso documento, non due
   archivi. Qui si tiene solo com'e' disegnata la pagina. */
let dati = documento();
let sporca = false, messaggio = '', statoBarra = '';
let apertaPerAggiunta = null;

await pronto();
montaAccesso(document.getElementById('accesso'), () => { disegnaBarra(); carica(); });

/* Quale di queste squadre e' la mia. Prima si indovinava confrontando il nome
   dell'allenatore con quello dell'account, ed era fragile: bastava scrivere
   "Pierre e Aurelio" e non funzionava piu'. Adesso lo dice il database:
   la squadra e' quella che hai scelto nella pagina "La mia lega". */
const miaSquadra = () => {
  const mia = squadra();
  return mia ? dati.squadre.find(s => s.id === mia.id) : null;
};

/* Ogni modifica si salva da sola dopo un attimo di pausa: niente da ricordarsi. */
const auto = autosalva(() => salva(true));

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
  try {
    await caricaAsta();
    dati = documento();
    allineaAllaLega(squadreDellaLega(), membriDellaLega());
    sporca = false;
    const m = metaAsta();
    if (m.assente) {
      statoBarra = 'sporca';
      messaggio = 'Entra col tuo account qui sopra per vedere le fantasquadre.';
    } else {
      statoBarra = '';
      messaggio = m.nuovo
        ? 'Nessun acquisto ancora. Le squadre arrivano dalla pagina «La mia lega».'
        : `Ultimo salvataggio di ${esc(m.da || 'qualcuno')}, ${quando(m.aggiornato)}.`;
    }
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
    const r = await salvaAsta();
    dati = documento();
    messaggio = r.fuso
      ? 'Salvato, e ho unito le modifiche arrivate nel frattempo.'
      : 'Salvato ' + quando(new Date().toISOString()) + '.';
    sporca = false;
  } catch (e) {
    statoBarra = 'errore';
    messaggio = e.message;
  }
  disegnaBarra();
  disegna();
}

function disegnaBarra() {
  const b = document.getElementById('barra-fs');
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

/* `astaLega` firma gia' la squadra con chi e quando: qui resta solo il
   promemoria che c'e' qualcosa da salvare. */
function tocca() {
  sporca = true;
  auto.tocca();
}

/* Le squadre si creano e si rinominano nella pagina "La mia lega": la' c'e'
   la tabella vera, quella su cui il database decide chi vede cosa. Farlo in
   due posti vorrebbe dire due elenchi che prima o poi divergono. */
function nuovaSquadra() {
  toast('Le squadre si aggiungono nella pagina «La mia lega».');
}

const speso = s => (s.rosa || []).reduce((a, g) => a + (Number(g.prezzo) || 0), 0);
const contaRuolo = (s, r) => (s.rosa || []).filter(g => g.r === r).length;

/* ---------- disegno ---------- */

function disegna() {
  const griglia = document.getElementById('griglia');

  if (!dati.squadre.length) {
    griglia.innerHTML = collegato()
      ? '<div class="vuotafs">Nessuna fantasquadra. Premi <strong>Nuova squadra</strong> per aggiungere la prima: nome, allenatore, e poi la rosa man mano che l\'asta procede.</div>'
      : '<div class="vuotafs">Le fantasquadre stanno nel database condiviso, non in questo browser: sono le stesse che vedi da qualsiasi computer, tue e di Aurelio. Per vederle <strong>entra col tuo account</strong> nel riquadro qui sopra — è lo stesso indirizzo email che hai usato la prima volta.</div>';
    return disegnaRiepilogo();
  }

  griglia.innerHTML = dati.squadre.map(s => {
    const sp = speso(s);
    const residuo = cfg.crediti - sp;
    const mia = s.id === squadra()?.id;
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
  document.getElementById('totali-fs').innerHTML = `
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
    toast('Nome e gestori della squadra si cambiano nella pagina «La mia lega».');
    return;
  }

  const bDel = e.target.closest('button[data-elimina]');
  if (bDel) {
    toast('Le squadre si tolgono nella pagina «La mia lega».');
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
    rimetti(gid);
    tocca(); disegnaBarra(); disegna();
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
      aggiudica(gid, s.id, Math.max(0, r.prezzo), p);
      tocca();
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

osservaAsta(r => {
  if (sporca) {
    statoBarra = 'sporca';
    messaggio = `${esc(r.da || 'Qualcuno')} ha salvato una versione più recente. Salvando, le due si uniscono.`;
    return disegnaBarra();
  }
  accetta(r);
  dati = documento();
  allineaAllaLega(squadreDellaLega(), membriDellaLega());
  messaggio = `Aggiornato: ${esc(r.da || 'qualcuno')} ha appena salvato.`;
  disegnaBarra();
  disegna();
});

await carica();
