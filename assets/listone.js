/* Pagina "Listone e asta live": parametri di lega, filtri, tracker crediti,
   scorte per fascia e segnalazione dei giocatori finiti agli avversari. */
import {
  caricaDati, ricalcola, asta, esportaStato, importaStato,
  toast, badgeRuolo, RUOLI, NOME_RUOLO, CLASSE_VERDETTO,
} from './app.js';

const { players, lega } = await caricaDati();

/* ---------- configurazione modificabile, persistente ---------- */

const CHIAVE_CFG = 'pianoAsta:cfg:v1';
function leggiCfg() {
  try {
    const salvata = JSON.parse(localStorage.getItem(CHIAVE_CFG) || 'null');
    if (salvata) return { ...structuredClone(lega), ...salvata };
  } catch { /* storage non disponibile */ }
  return structuredClone(lega);
}
function scriviCfg(c) {
  try {
    localStorage.setItem(CHIAVE_CFG, JSON.stringify({
      crediti: c.crediti, squadre: c.squadre, slot: c.slot,
      quotaMercato: c.quotaMercato, piano: c.piano,
    }));
  } catch { /* storage non disponibile */ }
}

let cfg = leggiCfg();

const CAMPI = [
  ['cCrediti', c => c.crediti, (c, v) => c.crediti = v],
  ['cSquadre', c => c.squadre, (c, v) => c.squadre = v],
  ['sP', c => c.slot.P, (c, v) => c.slot.P = v], ['sD', c => c.slot.D, (c, v) => c.slot.D = v],
  ['sC', c => c.slot.C, (c, v) => c.slot.C = v], ['sA', c => c.slot.A, (c, v) => c.slot.A = v],
  ['qP', c => c.quotaMercato.P * 100, (c, v) => c.quotaMercato.P = v / 100],
  ['qD', c => c.quotaMercato.D * 100, (c, v) => c.quotaMercato.D = v / 100],
  ['qC', c => c.quotaMercato.C * 100, (c, v) => c.quotaMercato.C = v / 100],
  ['qA', c => c.quotaMercato.A * 100, (c, v) => c.quotaMercato.A = v / 100],
  ['pP', c => c.piano.P, (c, v) => c.piano.P = v], ['pD', c => c.piano.D, (c, v) => c.piano.D = v],
  ['pC', c => c.piano.C, (c, v) => c.piano.C = v], ['pA', c => c.piano.A, (c, v) => c.piano.A = v],
];

function riempiForm() {
  for (const [id, leggi] of CAMPI) {
    const el = document.getElementById(id);
    if (el) el.value = Math.round(leggi(cfg) * 100) / 100;
  }
  controllaCoerenza();
}

function controllaCoerenza() {
  const somma = RUOLI.reduce((a, r) => a + cfg.quotaMercato[r], 0);
  const piano = RUOLI.reduce((a, r) => a + cfg.piano[r], 0);
  const avvisi = [];
  if (Math.abs(somma - 1) > 0.005) avvisi.push(`Le quote di mercato sommano a ${(somma * 100).toFixed(1)}% invece di 100%.`);
  if (piano !== cfg.crediti) avvisi.push(`Il tuo piano somma a ${piano} invece di ${cfg.crediti}.`);
  const el = document.getElementById('avvisoQuote');
  if (el) el.innerHTML = avvisi.length ? ` <strong style="color:var(--warn)">${avvisi.join(' ')}</strong>` : '';
}

for (const [id, , scrivi] of CAMPI) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.addEventListener('change', () => {
    const v = parseFloat(el.value);
    if (!isFinite(v) || v <= 0) { riempiForm(); return; }
    if (id === 'cCrediti' && cfg.crediti > 0) {
      const fattore = v / cfg.crediti;
      for (const r of RUOLI) cfg.piano[r] = Math.max(1, Math.round(cfg.piano[r] * fattore));
    }
    scrivi(cfg, v);
    scriviCfg(cfg);
    riempiForm();
    aggiorna();
  });
}

/* ---------- stato ---------- */

let stato = asta.leggi();
let altrui = asta.leggiAltrui();
let filtroRuolo = 'ALL', soloMia = false, nascondiPresi = false, cerca = '';
let ordina = { k: 'max', dir: 'desc' };

const corpo = document.querySelector('#big tbody');
const ledger = document.getElementById('ledger');
const hint = document.getElementById('hint');
const boxFasce = document.getElementById('fasce');

const selSquadra = document.getElementById('fSquadra');
[...new Set(players.map(p => p.sq))].sort().forEach(sq => {
  const o = document.createElement('option');
  o.value = o.textContent = sq;
  selSquadra.appendChild(o);
});

/* ---------- riepilogo crediti ---------- */

function disegnaLedger() {
  const r = asta.riepilogo(players, stato, cfg, cfg.piano);
  let html = '';
  for (const ruolo of RUOLI) {
    const d = r.reparti[ruolo];
    html += `<div class="lcell${d.residuo < 0 ? ' over' : ''}" data-r="${ruolo}">
      <div class="k">${NOME_RUOLO[ruolo]} ${d.presi}/${d.slot}</div>
      <div class="n">${d.residuo}<small> / ${cfg.piano[ruolo]} cr</small></div></div>`;
  }
  const slotTot = RUOLI.reduce((a, x) => a + cfg.slot[x], 0);
  html += `<div class="lcell${r.residuoTot < 0 ? ' over' : ''}">
    <div class="k">Residuo totale</div><div class="n">${r.residuoTot}<small> / ${cfg.crediti}</small></div></div>`;
  html += `<div class="lcell"><div class="k">Rosa</div>
    <div class="n">${r.presiTot}<small> / ${slotTot}</small></div></div>`;
  ledger.innerHTML = html;

  const parti = [];
  if (r.sopraTetto) parti.push(`${r.sopraTetto} acquist${r.sopraTetto === 1 ? 'o' : 'i'} sopra il tetto`);
  const stretti = RUOLI.filter(x => r.reparti[x].liberi > 0 && r.reparti[x].residuo < r.reparti[x].liberi);
  if (stretti.length) parti.push(`in ${stretti.map(x => NOME_RUOLO[x].toLowerCase()).join(' e ')} non copri più gli slot liberi: da qui in poi si compra a 1-2 crediti`);
  hint.textContent = parti.length ? parti.join(' · ') : 'Tutto in linea con il piano.';
}

/* ---------- scorte per fascia ---------- */

const COLORE_RUOLO = { P: 'var(--rP)', D: 'var(--rD)', C: 'var(--rC)', A: 'var(--rA)' };

function disegnaFasce() {
  if (!boxFasce) return;
  const s = asta.scorte(players, stato, altrui);
  boxFasce.innerHTML = RUOLI.map(r => {
    const righe = [1, 2, 3].map(f => {
      const d = s[r][f];
      const perc = d.tot ? (d.liberi / d.tot * 100) : 0;
      const esaurita = d.liberi <= 2 ? ' esaurita' : '';
      return `<div class="fline${esaurita}">
        <span class="lab">${f}ª fascia</span>
        <span class="bar"><i style="width:${perc.toFixed(0)}%;background:${COLORE_RUOLO[r]}"></i></span>
        <span class="cnt">${d.liberi}/${d.tot}</span></div>`;
    }).join('');
    return `<div class="fbox"><h4>${badgeRuolo(r)}${NOME_RUOLO[r]} ancora liberi</h4>${righe}</div>`;
  }).join('');
}

/* ---------- tabella ---------- */

function disegnaTabella() {
  const s = cerca.toLowerCase();
  const sq = selSquadra.value;
  const verdetto = document.getElementById('fVerdetto').value;
  const fascia = document.getElementById('fFascia').value;

  const righe = players.filter(p =>
    (filtroRuolo === 'ALL' || p.r === filtroRuolo) &&
    (!soloMia || stato[asta.id(p)] > 0) &&
    (!nascondiPresi || asta.disponibile(p, stato, altrui) || stato[asta.id(p)] > 0) &&
    (!sq || p.sq === sq) &&
    (!verdetto || p.v === verdetto) &&
    (!fascia || String(p.f) === fascia) &&
    (!s || p.n.toLowerCase().includes(s) || p.sq.toLowerCase().includes(s))
  );

  const { k, dir } = ordina;
  const segno = dir === 'asc' ? 1 : -1;
  righe.sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === 'string') return segno * x.localeCompare(y, 'it');
    return segno * ((x ?? 0) - (y ?? 0));
  });

  corpo.innerHTML = righe.slice(0, 900).map(p => {
    const id = asta.id(p);
    const pagato = stato[id] || '';
    const via = altrui.has(id);
    const cls = via ? 'altrui' : pagato ? (pagato > p.max ? 'over' : 'taken') : '';
    return `<tr class="${cls}">
      <td>${badgeRuolo(p.r)}<span class="nm">${p.n}</span> <span class="sq">${p.sq}</span></td>
      <td class="num mktc">${p.q}</td>
      <td class="num mktc">${Math.round(p.mkt)}</td>
      <td class="num maxc">${p.max}</td>
      <td class="num"><input type="number" min="0" max="${cfg.crediti}" value="${pagato}"
           data-id="${id}" aria-label="Prezzo pagato per ${p.n}"${via ? ' disabled' : ''}></td>
      <td><button class="bx" data-via="${id}" aria-pressed="${via}"
           title="Segna che se l'è preso un avversario">${via ? 'venduto' : 'ad altri'}</button></td>
      <td><span class="pill ${CLASSE_VERDETTO[p.v] || 'p-g'}">${p.v}</span></td>
      <td class="note">${p.nota || ''}</td></tr>`;
  }).join('');

  if (righe.length > 900) {
    corpo.insertAdjacentHTML('beforeend',
      `<tr><td colspan="8" class="note" style="color:var(--ink3)">Mostrati i primi 900 di ${righe.length}. Restringi la ricerca per vedere gli altri.</td></tr>`);
  }
}

function aggiorna() {
  ricalcola(players, cfg, cfg.piano);
  controllaCoerenza();
  disegnaLedger();
  disegnaFasce();
  disegnaTabella();
}

/* ---------- interazioni ---------- */

corpo.addEventListener('change', e => {
  const el = e.target;
  if (el.tagName !== 'INPUT') return;
  const v = parseInt(el.value, 10);
  if (!v || v <= 0) delete stato[el.dataset.id]; else stato[el.dataset.id] = v;
  asta.scrivi(stato);
  disegnaLedger();
  disegnaFasce();
  disegnaTabella();
});

corpo.addEventListener('click', e => {
  const b = e.target.closest('button[data-via]');
  if (!b) return;
  const id = b.dataset.via;
  if (altrui.has(id)) {
    altrui.delete(id);
  } else {
    altrui.add(id);
    delete stato[id];        // se lo prende un altro, non è più mio
    asta.scrivi(stato);
  }
  asta.scriviAltrui(altrui);
  aggiorna();
});

document.getElementById('q').addEventListener('input', e => { cerca = e.target.value; disegnaTabella(); });
selSquadra.addEventListener('change', disegnaTabella);
document.getElementById('fVerdetto').addEventListener('change', disegnaTabella);
document.getElementById('fFascia').addEventListener('change', disegnaTabella);

document.querySelectorAll('.chip[data-r]').forEach(c => c.onclick = () => {
  filtroRuolo = c.dataset.r;
  document.querySelectorAll('.chip[data-r]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
  disegnaTabella();
});

document.getElementById('onlyTaken').onclick = e => {
  soloMia = !soloMia;
  e.currentTarget.setAttribute('aria-pressed', String(soloMia));
  disegnaTabella();
};

document.getElementById('hideGone').onclick = e => {
  nascondiPresi = !nascondiPresi;
  e.currentTarget.setAttribute('aria-pressed', String(nascondiPresi));
  disegnaTabella();
};

document.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
  const k = th.dataset.k;
  ordina = { k, dir: ordina.k === k && ordina.dir === 'desc' ? 'asc' : 'desc' };
  document.querySelectorAll('th.sortable').forEach(x => x.removeAttribute('data-dir'));
  th.dataset.dir = ordina.dir;
  disegnaTabella();
});

document.getElementById('esporta').onclick = async () => {
  const testo = esportaStato(stato, altrui);
  try {
    await navigator.clipboard.writeText(testo);
    toast('Stato copiato negli appunti');
  } catch {
    window.prompt('Copia questo testo e mandalo al tuo socio:', testo);
  }
};

document.getElementById('importa').onclick = () => {
  const testo = window.prompt('Incolla qui lo stato ricevuto:');
  if (!testo) return;
  try {
    const dati = importaStato(testo);
    stato = dati.mia;
    altrui = dati.altrui;
    asta.scrivi(stato);
    asta.scriviAltrui(altrui);
    aggiorna();
    toast('Stato importato');
  } catch {
    toast('Non sono riuscito a leggere quel testo');
  }
};

const btnReset = document.getElementById('reset');
let armato = false, timer;
btnReset.onclick = () => {
  if (!armato) {
    armato = true;
    btnReset.textContent = 'Sicuro? Clicca ancora';
    clearTimeout(timer);
    timer = setTimeout(() => { armato = false; btnReset.textContent = 'Azzera'; }, 3500);
    return;
  }
  armato = false;
  clearTimeout(timer);
  btnReset.textContent = 'Azzera';
  stato = {};
  altrui = new Set();
  asta.scrivi(stato);
  asta.scriviAltrui(altrui);
  aggiorna();
  toast('Asta azzerata');
};

/* scorciatoia: "/" mette il cursore nella ricerca */
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    e.preventDefault();
    document.getElementById('q').focus();
  }
});

riempiForm();
aggiorna();
