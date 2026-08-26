/* Pagina "Listone e asta live": parametri di lega, filtri, tracker crediti,
   scorte per fascia e segnalazione dei giocatori finiti agli avversari. */
import {
  caricaDati, ricalcola, asta, esportaStato, importaStato,
  toast, badgeRuolo, gestisce, RUOLI, NOME_RUOLO, CLASSE_VERDETTO,
} from './app.js?v=14';
import {
  avvia, configurato, collegato, utente, leggi as leggiDb, scrivi as scriviDb,
  montaAccesso, esc,
} from './db.js?v=14';
import { chiediCampi, conferma as chiediConferma, avvisa } from './ui.js?v=14';

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

/* fantasquadre condivise: servono per assegnare un giocatore a chi se l'e' preso */
let fsDati = { squadre: [] }, fsVer = 0, fsPronte = false;
let assegnando = null;   // id del giocatore per cui e' aperto il campo prezzo
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
      <td><span class="gioc">${badgeRuolo(p.r)}<span class="testo"><span class="nm">${esc(p.n)}</span>
        <span class="sq">${esc(p.sq)}</span></span></span></td>
      <td class="num mktc">${p.q}</td>
      <td class="num mktc">${Math.round(p.mkt)}</td>
      <td class="num maxc">${p.max}</td>
      <td class="num"><input type="number" min="0" max="${cfg.crediti}" value="${pagato}"
           data-id="${id}" aria-label="Prezzo pagato per ${p.n}"${via ? ' disabled' : ''}></td>
      <td>${cellaFuori(p, id, via)}</td>
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

/* ---------- assegnazione a una fantasquadra ---------- */

const miaSquadra = () => {
  const io = utente()?.nome || '';
  return io ? fsDati.squadre.find(s => gestisce(s.proprietario, io)) : null;
};

/** Chi possiede questo giocatore, secondo le fantasquadre. */
function possessore(id) {
  for (const s of fsDati.squadre) {
    const g = (s.rosa || []).find(x => x.id === id);
    if (g) return { squadra: s, prezzo: g.prezzo };
  }
  return null;
}

function cellaFuori(p, id, via) {
  const q = possessore(id);
  if (q) {
    return `<span class="assbox"><span class="propr">${esc(q.squadra.nome)} · ${q.prezzo} cr</span>
      <button class="bx" data-libera="${id}" title="Rimetti sul mercato">✕</button></span>`;
  }
  if (via) {
    return `<span class="assbox"><span class="propr">fuori mercato</span>
      <button class="bx" data-libera="${id}" title="Rimetti sul mercato">✕</button></span>`;
  }
  return `<span class="assbox">
    <button class="bx" data-assegna="${id}" title="Assegna a una fantasquadra, con il prezzo">Aggiungi a squadra</button>
  </span>`;
}

/** Apre la finestra di assegnazione e registra l'acquisto. */
async function apriAssegnazione(id) {
  const p = players.find(x => asta.id(x) === id);
  if (!p) return;

  if (!fsDati.squadre.length) {
    return avvisa({
      titolo: 'Non ci sono ancora fantasquadre',
      testo: 'Per assegnare i giocatori devi prima creare le squadre della lega, con nome e proprietario, nella pagina Fantasquadre.',
      ok: 'Vado a crearle',
    }).then(() => { location.href = 'fantasquadre.html'; });
  }

  const opzioni = fsDati.squadre.map(sq => {
    const speso = (sq.rosa || []).reduce((a, g) => a + (Number(g.prezzo) || 0), 0);
    return { v: sq.id, t: `${sq.nome} — ${cfg.crediti - speso} cr disponibili` };
  });
  opzioni.push({ v: '__fuori', t: 'Fuori mercato (non registro a chi)' });

  const r = await chiediCampi({
    titolo: `${p.n} · ${p.sq}`,
    testo: `Il tuo tetto è ${p.max} crediti, il mercato lo stima intorno a ${Math.round(p.mkt)}.`,
    ok: 'Assegna',
    campi: [
      { id: 'squadra', etichetta: 'A quale fantasquadra', tipo: 'scelta', opzioni },
      { id: 'prezzo', etichetta: 'Prezzo pagato', tipo: 'numero', valore: p.max, min: 0, max: cfg.crediti,
        aiuto: 'Quanto è costato all\'asta, non il tuo tetto.' },
    ],
  });
  if (!r) return;

  if (r.squadra === '__fuori') {
    altrui.add(id);
    delete stato[id];
    asta.scrivi(stato); asta.scriviAltrui(altrui);
    programmaSync(); aggiorna();
    return;
  }
  await assegna(id, r.squadra, Math.max(0, r.prezzo));
}

async function caricaFantasquadre() {
  if (!configurato()) return;
  try {
    const r = await leggiDb('fantasquadre', { squadre: [] });
    fsDati = r.dati || { squadre: [] };
    fsDati.squadre ||= [];
    fsVer = r.versione;
    fsPronte = true;
    disegnaTabella();
  } catch { /* senza accesso si usa solo "ad altri" */ }
}

function fondiFs(remoto, locale) {
  const uniti = new Map();
  for (const s of (remoto?.squadre || [])) uniti.set(s.id, s);
  for (const s of locale.squadre) {
    const e = uniti.get(s.id);
    if (!e || (s.quando || '') >= (e.quando || '')) uniti.set(s.id, s);
  }
  return { ...locale, squadre: [...uniti.values()] };
}

async function salvaFantasquadre() {
  if (!collegato()) { statoSync('Per assegnare devi entrare col tuo account.'); return; }
  try {
    const r = await scriviDb('fantasquadre', fsDati, fsVer, fondiFs);
    fsVer = r.versione;
    if (r.fuso) fsDati = r.dati;
    statoSync('Assegnazione salvata.');
  } catch (e) {
    statoSync('Non ho potuto salvare: ' + e.message);
  }
  disegnaTabella();
}

async function assegna(id, idSquadra, prezzo) {
  const p = players.find(x => asta.id(x) === id);
  const s = fsDati.squadre.find(x => x.id === idSquadra);
  if (!p || !s) return;
  (s.rosa ||= []).push({ id, n: p.n, sq: p.sq, r: p.r, prezzo });
  s.quando = new Date().toISOString();
  s.chi = utente()?.nome || 'anonimo';

  // se e' la mia squadra il giocatore entra nella mia rosa, altrimenti esce dal mercato
  if (miaSquadra()?.id === idSquadra) {
    stato[id] = prezzo;
    altrui.delete(id);
  } else {
    altrui.add(id);
    delete stato[id];
  }
  asta.scrivi(stato);
  asta.scriviAltrui(altrui);
  programmaSync();
  assegnando = null;
  aggiorna();
  await salvaFantasquadre();
}

async function libera(id) {
  const eraAssegnato = Boolean(possessore(id));
  for (const s of fsDati.squadre) {
    const prima = (s.rosa || []).length;
    s.rosa = (s.rosa || []).filter(g => g.id !== id);
    if ((s.rosa || []).length !== prima) {
      s.quando = new Date().toISOString();
      s.chi = utente()?.nome || 'anonimo';
    }
  }
  altrui.delete(id);
  delete stato[id];
  asta.scrivi(stato);
  asta.scriviAltrui(altrui);
  programmaSync();
  aggiorna();
  if (eraAssegnato) await salvaFantasquadre();
}

/* ---------- sincronizzazione con il database ---------- */
/* L'asta resta locale-first: ogni clic aggiorna subito lo schermo, e il
   salvataggio parte tre secondi dopo l'ultima modifica. Cosi' durante la
   chiamata random non aspetti mai la rete, ma ritrovi tutto sull'altro
   dispositivo. Ognuno ha il proprio documento: questo non e' condiviso. */

const CHIAVE_VER = 'pianoAsta:astaVer';
let chiaveAsta = null, verAsta = 0, timerSync = null;

function statoSync(msg) {
  const el = document.getElementById('sync');
  if (el) el.textContent = msg;
}

async function avviaSync() {
  await avvia();
  montaAccesso(document.getElementById('accesso'), avviaSync);
  if (!configurato() || !collegato()) {
    chiaveAsta = null;
    return statoSync(configurato()
      ? 'Non collegato: quello che segni resta solo su questo dispositivo.'
      : 'Database non configurato: quello che segni resta solo su questo dispositivo.');
  }
  chiaveAsta = 'asta:' + utente().id;
  caricaFantasquadre();
  let verLocale = 0;
  try { verLocale = Number(localStorage.getItem(CHIAVE_VER) || 0); } catch { /* ignora */ }
  try {
    const r = await leggiDb(chiaveAsta, null);
    verAsta = r.versione;
    if (r.dati && r.versione > verLocale) {
      stato = r.dati.mia || {};
      altrui = new Set(r.dati.altrui || []);
      asta.scrivi(stato);
      asta.scriviAltrui(altrui);
      try { localStorage.setItem(CHIAVE_VER, String(verAsta)); } catch { /* ignora */ }
      statoSync('Ripreso da dove avevi lasciato su un altro dispositivo.');
      aggiorna();
    } else {
      statoSync('Collegato: si salva da solo.');
    }
  } catch (e) {
    statoSync('Non riesco a sincronizzare: ' + e.message);
  }
}

function programmaSync() {
  if (!chiaveAsta) return;
  clearTimeout(timerSync);
  timerSync = setTimeout(async () => {
    try {
      const r = await scriviDb(chiaveAsta, { mia: stato, altrui: [...altrui] }, verAsta);
      verAsta = r.versione;
      try { localStorage.setItem(CHIAVE_VER, String(verAsta)); } catch { /* ignora */ }
      statoSync('Salvato.');
    } catch (e) {
      statoSync('Salvataggio non riuscito: ' + e.message);
    }
  }, 3000);
}

/* ---------- interazioni ---------- */

corpo.addEventListener('change', e => {
  const el = e.target;
  // solo il campo "preso a": il prezzo dell'assegnazione ha un suo pulsante,
  // e ridisegnare la tabella qui gli cancellerebbe il valore sotto le dita
  if (el.tagName !== 'INPUT' || !el.dataset.id) return;
  const v = parseInt(el.value, 10);
  if (!v || v <= 0) delete stato[el.dataset.id]; else stato[el.dataset.id] = v;
  asta.scrivi(stato);
  programmaSync();
  disegnaLedger();
  disegnaFasce();
  disegnaTabella();
});

corpo.addEventListener('click', e => {
  const apri = e.target.closest('button[data-assegna]');
  if (apri) { apriAssegnazione(apri.dataset.assegna); return; }

  const lib = e.target.closest('button[data-libera]');
  if (lib) { libera(lib.dataset.libera); return; }
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
    await chiediCampi({ titolo: 'Copia questo testo', testo: 'Mandalo al tuo socio: lo incollerà con "Incolla uno stato".',
      ok: 'Fatto', campi: [{ id: 'x', etichetta: 'Stato dell\'asta', valore: testo }] });
  }
};

document.getElementById('importa').onclick = async () => {
  const r = await chiediCampi({ titolo: 'Incolla uno stato ricevuto', ok: 'Importa',
    campi: [{ id: 'testo', etichetta: 'Testo ricevuto', obbligatorio: true }] });
  const testo = r?.testo;
  if (!testo) return;
  try {
    const dati = importaStato(testo);
    stato = dati.mia;
    altrui = dati.altrui;
    asta.scrivi(stato);
    asta.scriviAltrui(altrui);
    programmaSync();
    aggiorna();
    toast('Stato importato');
  } catch {
    toast('Non sono riuscito a leggere quel testo');
  }
};

document.getElementById('reset').onclick = async () => {
  const si = await chiediConferma({
    titolo: 'Azzero tutta l\'asta?',
    testo: 'Sparisce quello che hai segnato come comprato e chi è uscito dal mercato. Le fantasquadre e la bozza non vengono toccate.',
    ok: 'Sì, azzera', pericolo: true,
  });
  if (!si) return;
  stato = {};
  altrui = new Set();
  asta.scrivi(stato);
  asta.scriviAltrui(altrui);
  programmaSync();
  aggiorna();
  toast('Asta azzerata');
};

corpo.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.dataset.prezzo) return;
  e.preventDefault();
  corpo.querySelector(`button[data-conferma="${CSS.escape(e.target.dataset.prezzo)}"]`)?.click();
});

/* scorciatoia: "/" mette il cursore nella ricerca */
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    e.preventDefault();
    document.getElementById('q').focus();
  }
});

riempiForm();
aggiorna();
avviaSync();
