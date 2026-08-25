/* Pagina "La mia rosa": cosa hai comprato, l'undici titolare e il simulatore
   del modificatore di difesa sui difensori che possiedi davvero. */
import {
  caricaDati, ricalcola, asta, simulaModificatore, badgeRuolo, mvStimata,
  RUOLI, NOME_RUOLO,
} from './app.js';

const { players, lega } = await caricaDati();

let cfg = lega;
try {
  const salvata = JSON.parse(localStorage.getItem('pianoAsta:cfg:v1') || 'null');
  if (salvata) cfg = { ...structuredClone(lega), ...salvata };
} catch { /* storage non disponibile */ }

ricalcola(players, cfg, cfg.piano);

const stato = asta.leggi();
const perId = Object.fromEntries(players.map(p => [asta.id(p), p]));
const miei = Object.keys(stato)
  .map(id => perId[id] && { ...perId[id], pagato: stato[id] })
  .filter(Boolean)
  .sort((a, b) => b.pagato - a.pagato);

const mieiPerRuolo = Object.fromEntries(RUOLI.map(r => [r, miei.filter(p => p.r === r)]));

/* ---------- riepilogo ---------- */

const r = asta.riepilogo(players, stato, cfg, cfg.piano);
document.getElementById('ledger').innerHTML =
  RUOLI.map(x => `<div class="lcell${r.reparti[x].residuo < 0 ? ' over' : ''}" data-r="${x}">
    <div class="k">${NOME_RUOLO[x]} ${r.reparti[x].presi}/${r.reparti[x].slot}</div>
    <div class="n">${r.reparti[x].speso}<small> di ${cfg.piano[x]} cr</small></div></div>`).join('')
  + `<div class="lcell"><div class="k">Speso</div><div class="n">${r.spesoTot}<small> / ${cfg.crediti}</small></div></div>`
  + `<div class="lcell"><div class="k">Tesoretto</div><div class="n">${r.residuoTot}</div></div>`;

/* ---------- rosa per reparto ---------- */

document.getElementById('reparti').innerHTML = RUOLI.map(x => {
  const lista = mieiPerRuolo[x];
  const speso = lista.reduce((a, p) => a + p.pagato, 0);
  const righe = lista.length
    ? lista.map(p => `<div class="repitem">${badgeRuolo(p.r)}<span>${p.n}</span>
        <span class="sq" style="color:var(--ink3)">${p.sq}</span>
        <span class="pz${p.pagato > p.max ? ' maxc' : ''}" ${p.pagato > p.max ? 'style="color:var(--warn)"' : ''}>${p.pagato}</span></div>`).join('')
    : '<div class="vuoto">Ancora nessuno. Segna gli acquisti nel listone.</div>';
  return `<div class="repbox"><div class="rephead" data-r="${x}">${badgeRuolo(x)}${NOME_RUOLO[x]}
    <span class="sp">${lista.length}/${cfg.slot[x]} · ${speso} cr</span></div>
    <div class="replist">${righe}</div></div>`;
}).join('');

/* ---------- undici titolare ---------- */

const selModulo = document.getElementById('modulo');
for (const m of lega.moduli) {
  const o = document.createElement('option');
  o.value = o.textContent = m;
  if (m === '4-5-1') o.selected = true;
  selModulo.appendChild(o);
}

function disegnaCampo() {
  const [nD, nC, nA] = selModulo.value.split('-').map(Number);
  const scelti = {
    P: mieiPerRuolo.P.slice(0, 1), D: mieiPerRuolo.D.slice(0, nD),
    C: mieiPerRuolo.C.slice(0, nC), A: mieiPerRuolo.A.slice(0, nA),
  };
  const riga = lista => `<div class="prow">${lista.map(p =>
    `<div class="pp">${p.n}</div>`).join('') || '<div class="pp" style="opacity:.45">—</div>'}</div>`;

  document.getElementById('campo').innerHTML =
    `<div class="pitch">${riga(scelti.P)}${riga(scelti.D)}${riga(scelti.C)}${riga(scelti.A)}</div>`;

  const mancano = RUOLI.filter(x => scelti[x].length < { P: 1, D: nD, C: nC, A: nA }[x]);
  const avvisi = [];
  if (mancano.length) avvisi.push(`Ti mancano giocatori in ${mancano.map(x => NOME_RUOLO[x].toLowerCase()).join(', ')} per completare questo modulo.`);
  if (nD < lega.modificatoreDifesa.minDifensori) {
    avvisi.push(`Con ${nD} difensori il modificatore non si applica: ne servono almeno ${lega.modificatoreDifesa.minDifensori}.`);
  }
  document.getElementById('avvisoCampo').textContent = avvisi.join(' ');
}
selModulo.addEventListener('change', disegnaCampo);
disegnaCampo();

/* ---------- simulatore del modificatore ---------- */

const mod = lega.modificatoreDifesa;
const MAX_DIF = 5;
const sceltiSim = { P: null, D: [] };
const mv = {};   // media voto per giocatore, modificabile coi cursori

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
      return `<button type="button" data-id="${id}" data-ruolo="${ruolo}" aria-pressed="${on}">${p.n}</button>`;
    }).join('');
  }
  document.getElementById('contaD').textContent =
    `— scegline da ${mod.minDifensori} a ${MAX_DIF} (${sceltiSim.D.length} selezionati)`;
}

function disegnaCursori() {
  const ids = [sceltiSim.P, ...sceltiSim.D].filter(Boolean);
  document.getElementById('cursori').innerHTML = ids.map(id => {
    const p = perId[id];
    return `<div class="simrow">
      <span class="blab">${badgeRuolo(p.r)}${p.n}</span>
      <input type="range" min="5.6" max="7" step="0.05" value="${mv[id]}" data-mv="${id}"
             aria-label="Media voto attesa di ${p.n}">
      <span class="simout" data-out="${id}">${mv[id].toFixed(2)}</span></div>`;
  }).join('');
}

function simula() {
  const box = document.getElementById('risultato');
  if (!sceltiSim.P || sceltiSim.D.length < mod.minDifensori) {
    box.innerHTML = `<div style="grid-column:1/-1"><div class="k">In attesa</div>
      <div class="n" style="font-size:1rem;font-weight:600">Scegli un portiere e almeno ${mod.minDifensori} difensori</div></div>`;
    return;
  }
  const res = simulaModificatore(sceltiSim.D.map(id => mv[id]), mv[sceltiSim.P], mod);
  box.innerHTML = `
    <div><div class="k">Punti a giornata</div><div class="n">${res.perGiornata.toFixed(2)}</div></div>
    <div><div class="k">In una stagione</div><div class="n">${Math.round(res.stagione)}</div></div>
    <div><div class="k">Giornate con +3 o più</div><div class="n">${Math.round(res.quotaAlmenoTre * 100)}%</div></div>
    <div><div class="k">Modificatore azzerato</div><div class="n">${(res.quotaAzzerate * 100).toFixed(1)}%</div></div>`;
}

document.getElementById('pickP').addEventListener('click', e => scegli(e));
document.getElementById('pickD').addEventListener('click', e => scegli(e));

function scegli(e) {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const { id, ruolo } = b.dataset;
  if (!(id in mv)) mv[id] = mvStimata(perId[id]);
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
  document.querySelector(`[data-out="${el.dataset.mv}"]`).textContent = mv[el.dataset.mv].toFixed(2);
  simula();
});

/* preselezione: portiere e primi difensori che hai in rosa */
const primoP = candidati('P')[0];
if (primoP) { sceltiSim.P = asta.id(primoP); mv[sceltiSim.P] = mvStimata(primoP); }
for (const p of candidati('D').slice(0, 4)) {
  const id = asta.id(p);
  sceltiSim.D.push(id);
  mv[id] = mvStimata(p);
}
// i candidati "di riserva" non sono in perId? lo sono: perId copre tutto il listone
disegnaScelte(); disegnaCursori(); simula();
