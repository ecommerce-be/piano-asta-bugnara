/* Pagina "Listone e asta live": parametri di lega, filtri, tracker crediti,
   scorte per fascia e segnalazione dei giocatori finiti agli avversari. */
import {
  caricaDati, ricalcola, asta,
  toast, badgeRuolo, caricaInfortuni, classeGravita, RUOLI, NOME_RUOLO, CLASSE_VERDETTO,
} from './app.js?v=36';
import {
  pronto, configurato, collegato, inLega, squadreDellaLega, membriDellaLega,
  montaAccesso, esc, quando,
} from './db.js?v=36';
import {
  caricaAsta, salvaAsta, accetta, osservaAsta, statoAsta, possessore,
  miaSquadra, squadreAsta, allineaAllaLega, assegna as aggiudica, libera as rimetti,
  segnaFuori, svuota, metaAsta, daRecuperare, recupera, scordaVecchi,
} from './astaLega.js?v=36';
import { chiediCampi, conferma as chiediConferma, avvisa } from './ui.js?v=36';
import { leggiCfg as leggiCfgCondivisa } from './cfg.js?v=36';

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

/* Le regole della lega stanno nel database e si cambiano nella pagina
   Impostazioni: qui le leggiamo e basta. */
let cfg = (await leggiCfgCondivisa(lega)).cfg;

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

/* ---------- stato ----------
 *
 * `stato` e `altrui` non sono piu' archivi: sono la fotografia dell'asta della
 * lega, ricalcolata da `statoAsta()` a ogni cambiamento. Non c'e' niente da
 * tenere allineato perche' non c'e' un secondo posto dove la stessa cosa
 * possa essere scritta diversamente. */

let stato = {}, altrui = new Set();

function rileggiStato() {
  const s = statoAsta();
  stato = s.mia;
  altrui = s.altrui;
}

/* Chi e' fermo: la pastiglia accanto al nome serve proprio qui, durante la
   chiamata, quando hai due secondi per decidere se rilanciare. */
const infortuni = await caricaInfortuni();
const segnale = p => {
  const v = infortuni.per.get(asta.id(p));
  if (!v) return '';
  const sigla = v.tipo === 'infortunio' ? 'KO' : v.tipo === 'squalifica' ? 'SQ' : 'DIFF';
  const dettaglio = [v.tipo, v.rientro && `rientro ${v.rientro}`, v.desc].filter(Boolean).join(' — ');
  return `<span class="ko ${classeGravita(v)}" title="${esc(dettaglio)}">${sigla}</span>`;
};

const perId = Object.fromEntries(players.map(p => [asta.id(p), p]));

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
      <td><span class="gioc">${badgeRuolo(p.r)}<span class="testo"><span class="nm">${esc(p.n)}${segnale(p)}</span>
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
  if (!pronta()) return;

  const opzioni = squadreAsta().map(sq => {
    const speso = sq.rosa.reduce((a, g) => a + (Number(g.prezzo) || 0), 0);
    return { v: sq.id, t: `${sq.nome} — ${cfg.crediti - speso} cr disponibili` };
  });
  opzioni.push({ v: '__fuori', t: 'Fuori mercato (non registro a chi)' });

  const mia = miaSquadra();
  const r = await chiediCampi({
    titolo: `${p.n} · ${p.sq}`,
    testo: `Il tuo tetto è ${p.max} crediti, il mercato lo stima intorno a ${Math.round(p.mkt)}.`,
    ok: 'Assegna',
    campi: [
      { id: 'squadra', etichetta: 'A quale fantasquadra', tipo: 'scelta', opzioni, valore: mia?.id },
      { id: 'prezzo', etichetta: 'Prezzo pagato', tipo: 'numero', valore: p.max, min: 0, max: cfg.crediti,
        aiuto: 'Quanto è costato all\'asta, non il tuo tetto.' },
    ],
  });
  if (!r) return;

  if (r.squadra === '__fuori') segnaFuori(id);
  else aggiudica(id, r.squadra, Math.max(0, r.prezzo), p);
  await salva();
}

async function libera(id) {
  if (!pronta()) return;
  const q = rimetti(id);
  await salva();
  if (q) toast(`${id.split('|')[1]} torna libero: era di ${q.squadra.nome}.`);
}

/* ---------- l'asta condivisa ----------
 *
 * Un archivio solo, nel database della lega. Ogni gesto aggiorna subito lo
 * schermo e parte il salvataggio: se nel frattempo ha salvato l'altro, le due
 * versioni si uniscono giocatore per giocatore invece di sovrascriversi.
 * Ogni otto secondi si controlla se e' cambiato qualcosa, cosi' durante la
 * chiamata vedete gli acquisti dell'altro comparire da soli. */

function statoSync(msg) {
  const el = document.getElementById('sync');
  if (el) el.textContent = msg;
}

/** Si puo' toccare l'asta? Se no, lo dice e basta: niente clic a vuoto. */
function pronta() {
  if (!configurato()) { statoSync('Database non configurato: l\'asta non si può registrare.'); return false; }
  if (!collegato()) { statoSync('Entra col tuo account qui sopra per segnare gli acquisti.'); return false; }
  if (!inLega()) {
    avvisa({
      titolo: 'Non sei in nessuna lega',
      testo: 'L\'asta appartiene alla lega. Entra nella tua dalla pagina «La mia lega», poi torna qui.',
      ok: 'Vado',
    }).then(() => { location.href = 'lega.html'; });
    return false;
  }
  if (!squadreAsta().length) {
    avvisa({
      titolo: 'Questa lega non ha ancora squadre',
      testo: 'Le squadre si creano nella pagina «La mia lega»: senza, non c\'è a chi assegnare i giocatori.',
      ok: 'Vado',
    }).then(() => { location.href = 'lega.html'; });
    return false;
  }
  return true;
}

async function salva() {
  aggiorna();
  statoSync('Salvo…');
  try {
    const r = await salvaAsta();
    rileggiStato();
    aggiorna();
    statoSync(r.fuso ? 'Salvato, e ho unito quello che aveva segnato l\'altro.' : 'Salvato.');
  } catch (e) {
    statoSync('Non ho potuto salvare: ' + e.message);
  }
}

async function caricaTutto() {
  await pronto();
  try {
    await caricaAsta();
  } catch (e) {
    return statoSync('Non riesco a leggere l\'asta: ' + e.message);
  }
  if (allineaAllaLega(squadreDellaLega(), membriDellaLega())) { /* nomi dalla lega */ }
  rileggiStato();
  aggiorna();
  const m = metaAsta();
  statoSync(m.assente
    ? 'Non collegato: entra col tuo account per vedere e segnare l\'asta della lega.'
    : m.nuovo ? 'Asta ancora vuota: il primo acquisto che segni la apre.'
      : `Ultimo movimento di ${m.da || 'qualcuno'}, ${quando(m.aggiornato)}.`);
  await proponiRecupero();
}

/* ---------- interazioni ---------- */

/* La colonna "preso a" e' la scorciatoia per i tuoi acquisti: scrivere un
   prezzo li' vuol dire «l'ho preso io a tanto», ed e' esattamente
   un'aggiudicazione alla tua squadra. Prima invece scriveva in un archivio
   suo, ed era da li' che nascevano le divergenze. */
corpo.addEventListener('change', async e => {
  const el = e.target;
  // solo il campo "preso a": il prezzo dell'assegnazione ha un suo pulsante,
  // e ridisegnare la tabella qui gli cancellerebbe il valore sotto le dita
  if (el.tagName !== 'INPUT' || !el.dataset.id) return;
  const id = el.dataset.id;
  const v = parseInt(el.value, 10);

  if (!pronta()) { disegnaTabella(); return; }
  const mia = miaSquadra();
  if (!mia) {
    disegnaTabella();
    return avvisa({
      titolo: 'Non hai ancora scelto la tua squadra',
      testo: 'La colonna «preso a» registra l\'acquisto nella squadra che gestisci. Scegli quale, dalla pagina «La mia lega».',
      ok: 'Vado',
    }).then(() => { location.href = 'lega.html'; });
  }

  if (!v || v <= 0) rimetti(id);
  else aggiudica(id, mia.id, v, players.find(x => asta.id(x) === id));
  await salva();
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

document.getElementById('ricarica').onclick = caricaTutto;

/* Non c'e' piu' un "azzera tutto": l'asta e' di tutta la lega, e un pulsante
   che cancella anche il lavoro degli altri e' un incidente che aspetta di
   succedere. Si svuota solo la propria rosa, e i giocatori tornano liberi. */
document.getElementById('reset').onclick = async () => {
  if (!pronta()) return;
  const mia = miaSquadra();
  if (!mia) return toast('Prima scegli la tua squadra, dalla pagina «La mia lega».');
  const si = await chiediConferma({
    titolo: `Svuoto la rosa di ${mia.nome}?`,
    testo: `I ${mia.rosa.length} giocatori che hai preso tornano liberi all'asta, per tutti. Le altre squadre e la bozza non si toccano.`,
    ok: 'Sì, svuota', pericolo: true,
  });
  if (!si) return;
  const quanti = svuota(mia.id);
  await salva();
  toast(`${quanti} giocatori rimessi sul mercato.`);
};

/* ---------- quello che c'era prima ---------- */

async function proponiRecupero() {
  const box = document.getElementById('recupero');
  if (!box) return;
  box.innerHTML = '';
  if (!collegato() || !inLega()) return;

  let r = null;
  try { r = await daRecuperare(); } catch { return; }
  if (!r) return;

  const quanti = r.acquisti.length + r.fuori.length;
  box.innerHTML = `<div class="idbar" style="border-color:var(--warn);margin-bottom:16px">
    <span class="idlab" style="color:var(--warn)">Da prima</span>
    <span style="flex:1 1 300px">Su questo browser ci sono <strong>${quanti}</strong>
      segn${quanti === 1 ? 'o' : 'i'} d'asta di quando l'asta non era ancora condivisa
      (${r.acquisti.length} tu${r.acquisti.length === 1 ? 'oi' : 'oi'}, ${r.fuori.length} fuori mercato).
      Li porto nell'asta della lega?</span>
    <button class="btn" id="recuperaSi">Portali dentro</button>
    <button class="chip" id="recuperaNo">Scartali</button></div>`;

  box.querySelector('#recuperaSi').onclick = async () => {
    try {
      const n = recupera(r, perId);
      await salva();
      scordaVecchi();
      box.innerHTML = '';
      toast(`${n} segni portati nell'asta della lega.`);
    } catch (e) { toast(e.message); }
  };
  box.querySelector('#recuperaNo').onclick = () => { scordaVecchi(); box.innerHTML = ''; };
}

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

/* Ogni otto secondi: se l'altro ha segnato qualcosa, compare qui da solo. */
osservaAsta(r => {
  accetta(r);
  allineaAllaLega(squadreDellaLega(), membriDellaLega());
  rileggiStato();
  aggiorna();
  statoSync(`${r.da || 'Qualcuno'} ha appena segnato un movimento.`);
});

riempiForm();
aggiorna();
montaAccesso(document.getElementById('accesso'), caricaTutto);
await caricaTutto();
