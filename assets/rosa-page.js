/* Pagina "La mia rosa": cosa hai comprato, l'undici titolare e il simulatore
   del modificatore di difesa sui difensori che possiedi davvero.

   Un archivio solo: la rosa e' quella della squadra che gestisci dentro
   l'asta della lega. Prima ce n'erano due — lo stato in questo browser e la
   fantasquadra nel database — e quando divergevano compariva il badge "non
   registrato". Adesso non possono piu' divergere: sono la stessa cosa. */
import {
  caricaDati, caricaInfortuni, ricalcola, asta, simulaModificatore, badgeRuolo,
  RUOLI, NOME_RUOLO,
} from './app.js?v=46';
import { pronto, collegato, esc } from './db.js?v=46';
import { caricaAsta, salvaAsta, statoAsta, miaSquadra, libera as rimetti } from './astaLega.js?v=46';
import { toast } from './ui.js?v=46';
import { leggiCfg } from './cfg.js?v=46';
import { valuta } from './consiglio.js?v=46';

const { players, lega } = await caricaDati();

/* Le regole della lega arrivano dal database condiviso: vedi assets/cfg.js */
const { cfg } = await leggiCfg(lega);

ricalcola(players, cfg, cfg.piano);

/* Attacca a ogni giocatore la media voto attesa (`mvAtt`). Prima il simulatore
   partiva da una stima per fascia, e usciva 6.30 identico per tutti: si vedeva
   un cursore che non diceva niente. Adesso ogni giocatore ha il suo numero,
   ricavato dalla sua posizione nel ruolo e corretto coi voti veri di questa
   stagione, quindi il simulatore ha qualcosa da simulare. */
const infortuni = await caricaInfortuni();
const info = valuta(players, infortuni.per);

const perId = Object.fromEntries(players.map(p => [asta.id(p), p]));

await pronto();
try { await caricaAsta(players); } catch { /* lo dice la pagina piu' sotto */ }
let { mia: stato } = statoAsta();

let miei = [], mieiPerRuolo = {};

function ricalcolaMiei() {
  miei = Object.keys(stato)
    .map(id => perId[id] && { ...perId[id], pagato: stato[id] })
    .filter(Boolean)
    .sort((a, b) => b.pagato - a.pagato);
  mieiPerRuolo = Object.fromEntries(RUOLI.map(r => [r, miei.filter(p => p.r === r)]));
}
ricalcolaMiei();

/* ---------- riepilogo ---------- */

function disegnaLedger() {
  const r = asta.riepilogo(players, stato, cfg, cfg.piano);
  document.getElementById('ledger').innerHTML =
    RUOLI.map(x => `<div class="lcell${r.reparti[x].residuo < 0 ? ' over' : ''}" data-r="${x}">
      <div class="k">${NOME_RUOLO[x]} ${r.reparti[x].presi}/${r.reparti[x].slot}</div>
      <div class="n">${r.reparti[x].speso}<small> di ${cfg.piano[x]} cr</small></div></div>`).join('')
    + `<div class="lcell"><div class="k">Speso</div><div class="n">${r.spesoTot}<small> / ${cfg.crediti}</small></div></div>`
    + `<div class="lcell"><div class="k">Tesoretto</div><div class="n">${r.residuoTot}</div></div>`;
}

/* ---------- rosa per reparto ---------- */

function disegnaReparti() {
  document.getElementById('reparti').innerHTML = RUOLI.map(x => {
    const lista = mieiPerRuolo[x];
    const speso = lista.reduce((a, p) => a + p.pagato, 0);
    const righe = lista.length
      ? lista.map(p => {
        const id = asta.id(p);
        return `<div class="repitem">${badgeRuolo(p.r)}<span>${esc(p.n)}</span>
          <span class="sq" style="color:var(--ink3)">${esc(p.sq)}</span>
          <span class="pz${p.pagato > p.max ? ' maxc' : ''}"${p.pagato > p.max ? ' style="color:var(--warn)"' : ''}>${p.pagato}</span>
          <button class="rimuovi" data-togli="${esc(id)}" title="Togli ${esc(p.n)} dalla rosa"
            aria-label="Togli ${esc(p.n)} dalla rosa">✕</button></div>`;
      }).join('')
      : '<div class="vuoto">Ancora nessuno. Segna gli acquisti nel listone.</div>';
    return `<div class="repbox"><div class="rephead" data-r="${x}">${badgeRuolo(x)}${NOME_RUOLO[x]}
      <span class="sp">${lista.length}/${cfg.slot[x]} · ${speso} cr</span></div>
      <div class="replist">${righe}</div></div>`;
  }).join('');
}

/* ---------- togliere un giocatore ----------
   Toglierlo dalla rosa vuol dire rimetterlo all'asta, per tutta la lega:
   c'e' un archivio solo, quindi non esiste piu' il caso "tolto qui ma non
   di la'". */

async function togli(id) {
  const p = perId[id];
  if (!p) return;
  const s = miaSquadra();
  if (!s) return toast('Scegli prima quale squadra gestisci, dalla pagina «La mia lega».');
  if (!collegato()) return toast('Entra col tuo account per cambiare la rosa.');

  rimetti(id);
  ridisegnaTutto(id);

  try {
    await salvaAsta();
    ridisegnaTutto();
    toast(`${p.n} torna libero all'asta.`);
  } catch (e) {
    toast('Non ho potuto salvare: ' + e.message);
  }
}

/** Rilegge la rosa dall'asta e ridisegna la pagina intera. */
function ridisegnaTutto(uscito = null) {
  stato = statoAsta().mia;
  // se lo stavo usando nel simulatore, esce anche da li'
  if (uscito) {
    if (sceltiSim.P === uscito) sceltiSim.P = null;
    sceltiSim.D = sceltiSim.D.filter(x => x !== uscito);
  }
  ricalcolaMiei();
  disegnaLedger(); disegnaReparti(); disegnaCampo();
  disegnaScelte(); disegnaCursori(); simula();
}

document.getElementById('reparti').addEventListener('click', e => {
  const b = e.target.closest('button[data-togli]');
  if (b) togli(b.dataset.togli);
});

/* ---------- undici titolare ---------- */

const selModulo = document.getElementById('modulo');
for (const m of lega.moduli) {
  const o = document.createElement('option');
  o.value = o.textContent = m;
  if (m === cfg.modulo) o.selected = true;
  selModulo.appendChild(o);
}

function disegnaCampo() {
  const [nD, nC, nA] = selModulo.value.split('-').map(Number);
  const scelti = {
    P: mieiPerRuolo.P.slice(0, 1), D: mieiPerRuolo.D.slice(0, nD),
    C: mieiPerRuolo.C.slice(0, nC), A: mieiPerRuolo.A.slice(0, nA),
  };
  const riga = lista => `<div class="prow">${lista.map(p =>
    `<div class="pp">${esc(p.n)}</div>`).join('') || '<div class="pp" style="opacity:.45">—</div>'}</div>`;

  document.getElementById('campo').innerHTML =
    `<div class="pitch">${riga(scelti.P)}${riga(scelti.D)}${riga(scelti.C)}${riga(scelti.A)}</div>`;

  const mancano = RUOLI.filter(x => scelti[x].length < { P: 1, D: nD, C: nC, A: nA }[x]);
  const avvisi = [];
  if (mancano.length) avvisi.push(`Ti mancano giocatori in ${mancano.map(x => NOME_RUOLO[x].toLowerCase()).join(', ')} per completare questo modulo.`);
  if (nD < cfg.modificatoreDifesa.minDifensori) {
    avvisi.push(`Con ${nD} difensori il modificatore non si applica: ne servono almeno ${cfg.modificatoreDifesa.minDifensori}.`);
  }
  document.getElementById('avvisoCampo').textContent = avvisi.join(' ');
}
selModulo.addEventListener('change', disegnaCampo);

/* ---------- simulatore del modificatore ---------- */

const mod = cfg.modificatoreDifesa;
const MAX_DIF = 5;
const sceltiSim = { P: null, D: [] };
const mv = {};   // media voto per giocatore, modificabile coi cursori

/** La media voto attesa del modello, arrotondata al passo del cursore. */
const stima = p => Math.round((p.mvAtt ?? 6.0) * 20) / 20;

function candidati(ruolo) {
  const lista = mieiPerRuolo[ruolo];
  if (lista.length) return lista;
  // se non hai ancora comprato nulla, proponi i migliori del listone per farti giocare col simulatore
  return players.filter(p => p.r === ruolo).sort((a, b) => b.max - a.max).slice(0, 8);
}

function disegnaScelte() {
  for (const ruolo of ['P', 'D']) {
    const box = document.getElementById('pick' + ruolo);
    box.innerHTML = candidati(ruolo).map(p => {
      const id = asta.id(p);
      const on = ruolo === 'P' ? sceltiSim.P === id : sceltiSim.D.includes(id);
      return `<button type="button" data-id="${esc(id)}" data-ruolo="${ruolo}" aria-pressed="${on}">${esc(p.n)}</button>`;
    }).join('');
  }
  document.getElementById('contaD').textContent =
    `— scegline da ${mod.minDifensori} a ${MAX_DIF} (${sceltiSim.D.length} selezionati)`;
}

function disegnaCursori() {
  const ids = [sceltiSim.P, ...sceltiSim.D].filter(Boolean);
  document.getElementById('cursori').innerHTML = ids.map(id => {
    const p = perId[id];
    if (!p) return '';
    return `<div class="simrow">
      <span class="blab">${badgeRuolo(p.r)}${esc(p.n)}</span>
      <input type="range" min="5.6" max="7" step="0.05" value="${mv[id]}" data-mv="${esc(id)}"
             aria-label="Media voto attesa di ${esc(p.n)}">
      <span class="simout" data-out="${esc(id)}">${mv[id].toFixed(2)}</span></div>`;
  }).join('');
}

/* Il metro di paragone: la stessa difesa presa a un credito. Senza, "80 punti"
   non dice niente — non si sa se sia tanto o poco. Il numero che conta e' il
   divario, perche' e' quello che stai comprando davvero. */
const RACCATTATA = 5.95;
let riferimento = null;

function simula() {
  const box = document.getElementById('risultato');
  const nota = document.getElementById('notaSim');

  if (!mod?.attivo) {
    box.innerHTML = `<div style="grid-column:1/-1"><div class="k">Modificatore spento</div>
      <div class="n" style="font-size:1rem;font-weight:600">Nelle impostazioni il modificatore di difesa
      risulta disattivato, quindi questa difesa non produce punti extra.</div></div>`;
    if (nota) nota.textContent = '';
    return;
  }
  if (!sceltiSim.P || sceltiSim.D.length < mod.minDifensori) {
    box.innerHTML = `<div style="grid-column:1/-1"><div class="k">In attesa</div>
      <div class="n" style="font-size:1rem;font-weight:600">Scegli un portiere e almeno ${mod.minDifensori} difensori</div></div>`;
    if (nota) nota.textContent = '';
    return;
  }

  const voti = sceltiSim.D.map(id => mv[id]);
  const res = simulaModificatore(voti, mv[sceltiSim.P], mod);

  riferimento ??= simulaModificatore(
    Array(Math.max(mod.minDifensori, voti.length)).fill(RACCATTATA), RACCATTATA, mod);
  const guadagno = res.stagione - riferimento.stagione;

  box.innerHTML = `
    <div><div class="k">Punti a giornata</div><div class="n">${res.perGiornata.toFixed(2)}</div></div>
    <div><div class="k">In una stagione</div><div class="n">${Math.round(res.stagione)}</div></div>
    <div><div class="k">In più di una difesa da 1 credito</div>
      <div class="n">${guadagno >= 0 ? '+' : ''}${Math.round(guadagno)}</div></div>
    <div><div class="k">Giornate con +3 o più</div><div class="n">${Math.round(res.quotaAlmenoTre * 100)}%</div></div>
    <div><div class="k">Modificatore azzerato</div><div class="n">${(res.quotaAzzerate * 100).toFixed(1)}%</div></div>`;

  /* Quanto costa o rende mezzo voto: e' la risposta alla domanda per cui il
     simulatore esiste, cioe' "vale la pena pagare di piu' quel difensore?" */
  if (nota) {
    const meglio = simulaModificatore(voti.map(v => v + 0.10), mv[sceltiSim.P] + 0.10, mod);
    nota.innerHTML = `Alzando di <strong>un decimo di voto</strong> tutti e ${voti.length + 1}
      — cioè comprando la versione migliore di ognuno — passeresti a
      <strong>${Math.round(meglio.stagione)} punti</strong>, ${Math.round(meglio.stagione - res.stagione)} in più.
      È quello che stai valutando quando decidi se rilanciare su un difensore.`;
  }
}

document.getElementById('pickP').addEventListener('click', e => scegli(e));
document.getElementById('pickD').addEventListener('click', e => scegli(e));

function scegli(e) {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const { id, ruolo } = b.dataset;
  if (!(id in mv)) mv[id] = stima(perId[id]);
  if (ruolo === 'P') {
    sceltiSim.P = sceltiSim.P === id ? null : id;
  } else if (sceltiSim.D.includes(id)) {
    sceltiSim.D = sceltiSim.D.filter(x => x !== id);
  } else if (sceltiSim.D.length < MAX_DIF) {
    sceltiSim.D.push(id);
  }
  disegnaScelte(); disegnaCursori(); simula();
}

document.getElementById('cursori').addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset.mv) return;
  mv[el.dataset.mv] = parseFloat(el.value);
  document.querySelector(`[data-out="${CSS.escape(el.dataset.mv)}"]`).textContent = mv[el.dataset.mv].toFixed(2);
  simula();
});

/* preselezione: portiere e primi difensori che hai in rosa */
const primoP = candidati('P')[0];
if (primoP) { sceltiSim.P = asta.id(primoP); mv[sceltiSim.P] = stima(primoP); }
for (const p of candidati('D').slice(0, 4)) {
  const id = asta.id(p);
  sceltiSim.D.push(id);
  mv[id] = stima(p);
}

disegnaLedger();
disegnaReparti();
disegnaCampo();
disegnaScelte(); disegnaCursori(); simula();
