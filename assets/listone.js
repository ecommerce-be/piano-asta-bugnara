/* Pagina "Listone e asta live": parametri di lega, filtri, tracker crediti,
   scorte per fascia e segnalazione dei giocatori finiti agli avversari. */
import {
  caricaDati, ricalcola, asta, AGGIORNATO_IL,
  toast, badgeRuolo, caricaInfortuni, classeGravita, RUOLI, NOME_RUOLO, CLASSE_VERDETTO,
  fuoriListone, percheFuori,
} from './app.js?v=46';
import {
  pronto, configurato, collegato, inLega, squadreDellaLega, membriDellaLega,
  montaAccesso, esc, quando,
} from './db.js?v=46';
import {
  caricaAsta, salvaAsta, accetta, osservaAsta, statoAsta, possessore,
  miaSquadra, squadreAsta, allineaAllaLega, assegna as aggiudica, libera as rimetti,
  segnaFuori, svuota, metaAsta, daRecuperare, recupera, scordaVecchi,
  alSalvataggio, inSospeso, ritentaOra, situazione, riagganciati,
} from './astaLega.js?v=46';
import { chiediCampi, conferma as chiediConferma, avvisa } from './ui.js?v=46';
import { leggiCfg as leggiCfgCondivisa } from './cfg.js?v=46';

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
/* Chi ha lasciato la Serie A non e' un giocatore «da valutare»: e' rumore in
   mezzo a cinquecento righe, e all'asta non verra' chiamato. Sta comunque nel
   file — serve a riconoscerlo se qualcuno lo nomina — ma per vederlo bisogna
   chiederlo. */
let mostraFuori = false;
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

/* ═══════════ chiamata rapida ═══════════
 *
 * All'asta random hai una decina di secondi fra il momento in cui il nome
 * viene chiamato e quello in cui devi decidere. Cercare il giocatore nella
 * tabella, aprire una finestra, scegliere la squadra da un elenco e scrivere
 * il prezzo sono quattro gesti: troppi, e infatti si finisce per segnare gli
 * acquisti dopo, a memoria, sbagliandoli.
 *
 * Qui sono due invii. Scrivi il nome, invio: compare la scheda con il tuo
 * tetto e — la cosa che conta davvero — chi altro può ancora rilanciare e
 * fino a quanto. Scrivi il prezzo, invio: registrato, e il cursore torna
 * subito nel campo del nome, pronto per la chiamata dopo.
 *
 * Tutto da tastiera, senza mai toccare il mouse.
 */

let chiamato = null;      // il giocatore scelto, in attesa del prezzo
let evidenziato = 0;      // quale suggerimento è selezionato

const inNome = document.getElementById('chiNome');
const boxSugg = document.getElementById('chiSugg');
const boxScheda = document.getElementById('chiScheda');

/** I candidati per quello che hai scritto: i più cari prima, i presi in fondo. */
function candidati(testo) {
  const s = testo.trim().toLowerCase();
  if (s.length < 2) return [];
  return players
    .filter(p => !fuoriListone(p) && (p.n.toLowerCase().includes(s) || p.sq.toLowerCase().includes(s)))
    .sort((a, b) => {
      const pa = Boolean(possessore(asta.id(a))), pb = Boolean(possessore(asta.id(b)));
      return (pa - pb) || b.max - a.max;
    })
    .slice(0, 7);
}

function disegnaSugg() {
  const lista = candidati(inNome.value);
  if (!lista.length || chiamato) { boxSugg.innerHTML = ''; return; }
  evidenziato = Math.min(evidenziato, lista.length - 1);
  boxSugg.innerHTML = lista.map((p, i) => {
    const q = possessore(asta.id(p));
    return `<button type="button" role="option" aria-selected="${i === evidenziato}"
      class="${i === evidenziato ? 'su' : ''}" data-i="${i}"${q ? ' disabled' : ''}>
      ${badgeRuolo(p.r)}<span class="nm">${esc(p.n)}</span>
      <span class="sq">${esc(p.sq)}</span>
      ${q ? `<span class="gia">già di ${esc(q.squadra.nome)}</span>` : `<span class="mx">tuo max ${p.max}</span>`}
    </button>`;
  }).join('');
}

/** Sceglie il giocatore e apre il campo del prezzo. */
function scegliChiamato(p) {
  if (!p || possessore(asta.id(p))) return;
  chiamato = p;
  boxSugg.innerHTML = '';
  disegnaScheda();
  boxScheda.querySelector('#chiPrezzo')?.focus();
}

function annullaChiamata() {
  chiamato = null;
  evidenziato = 0;
  inNome.value = '';
  boxSugg.innerHTML = '';
  boxScheda.innerHTML = '';
  inNome.focus();
}

function disegnaScheda() {
  if (!chiamato) { boxScheda.innerHTML = ''; return; }
  const p = chiamato;
  const mia = miaSquadra();

  /* Chi può ancora prendertelo, e fino a dove può spingersi: è l'unica cosa
     che serve sapere nei dieci secondi della chiamata. */
  const rivali = situazione(cfg)
    .filter(s => !s.mia && s.liberi[p.r] > 0 && !s.obbligata && !s.completa);
  const tetto = rivali[0]?.max ?? 0;

  const opzioni = squadreAsta().map(s =>
    `<option value="${esc(s.id)}"${s.id === mia?.id ? ' selected' : ''}>${esc(s.nome)}</option>`).join('');

  boxScheda.innerHTML = `
    <div class="chgioc">
      ${badgeRuolo(p.r)}<strong>${esc(p.n)}</strong>
      <span class="sq">${esc(p.sq)}</span>${segnale(p)}
      <span class="chnum">tuo max <b>${p.max}</b></span>
      <span class="chnum">mercato <b>${Math.round(p.mkt)}</b></span>
      <span class="pill ${CLASSE_VERDETTO[p.v] || 'p-g'}">${p.v}</span>
    </div>
    <div class="chriga">
      <input id="chiPrezzo" type="number" min="0" max="${cfg.crediti}" inputmode="numeric"
             placeholder="a quanto?" aria-label="Prezzo pagato">
      <select id="chiSquadra" aria-label="A quale fantasquadra">${opzioni}
        <option value="__fuori">— fuori mercato, non registro a chi</option></select>
      <button class="btn" id="chiOk">Registra</button>
      <button class="chip" id="chiNo">annulla <kbd>esc</kbd></button>
    </div>
    <div class="chrivali">${rivali.length
    ? `<strong>${rivali.length}</strong> ${rivali.length === 1 ? 'squadra può' : 'squadre possono'} ancora rilanciare
       — la più ricca arriva a <strong>${tetto}</strong>: ${rivali.slice(0, 4).map(s => `${esc(s.nome)} ${s.max}`).join(' · ')}`
    : 'Nessun altro ha bisogno di questo ruolo: qui non ti rilancia nessuno.'}</div>`;

  boxScheda.querySelector('#chiOk').onclick = registraChiamata;
  boxScheda.querySelector('#chiNo').onclick = annullaChiamata;
  boxScheda.querySelector('#chiPrezzo').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); registraChiamata(); }
    if (e.key === 'Escape') { e.preventDefault(); annullaChiamata(); }
  });
  boxScheda.querySelector('#chiSquadra').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); registraChiamata(); }
  });
}

async function registraChiamata() {
  if (!chiamato) return;
  if (!pronta()) return;
  const prezzo = parseInt(boxScheda.querySelector('#chiPrezzo').value, 10);
  const dove = boxScheda.querySelector('#chiSquadra').value;
  if (!(prezzo >= 0)) return boxScheda.querySelector('#chiPrezzo').focus();

  const p = chiamato;
  const gid = asta.id(p);
  if (dove === '__fuori') segnaFuori(gid);
  else aggiudica(gid, dove, prezzo, p);

  const nome = dove === '__fuori' ? 'fuori mercato'
    : squadreAsta().find(s => s.id === dove)?.nome || '';
  annullaChiamata();
  toast(`${p.n} → ${nome}${dove === '__fuori' ? '' : ` per ${prezzo}`}`);
  await salva();
}

inNome.addEventListener('input', () => { evidenziato = 0; disegnaSugg(); });

inNome.addEventListener('keydown', e => {
  const lista = candidati(inNome.value);
  if (e.key === 'ArrowDown') { e.preventDefault(); evidenziato = Math.min(evidenziato + 1, lista.length - 1); disegnaSugg(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); evidenziato = Math.max(evidenziato - 1, 0); disegnaSugg(); }
  else if (e.key === 'Enter') { e.preventDefault(); scegliChiamato(lista[evidenziato]); }
  else if (e.key === 'Escape') { e.preventDefault(); annullaChiamata(); }
});

boxSugg.addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (b) scegliChiamato(candidati(inNome.value)[Number(b.dataset.i)]);
});

/* ---------- quanto può ancora offrire ognuno ----------
 *
 * L'informazione che al tavolo decide se rilanciare, e che nessuno fa a mente.
 * Quando stai filtrando per ruolo mostra gli slot liberi in QUEL ruolo: è la
 * domanda vera durante la chiamata, cioè «chi altro deve ancora prendere un
 * portiere, e fino a quanto può spingersi». */

function disegnaAvversari() {
  const box = document.getElementById('avversari');
  const nota = document.getElementById('avvNota');
  if (!box) return;

  const tutti = situazione(cfg);
  if (!tutti.length) {
    box.innerHTML = '<div class="vuotafs">Le squadre arrivano dalla pagina «La mia lega».</div>';
    if (nota) nota.textContent = '';
    return;
  }

  const perRuolo = filtroRuolo !== 'ALL';
  const serve = s => (perRuolo ? s.liberi[filtroRuolo] : s.slotLiberi);
  /* chi quel ruolo ce l'ha già a posto non è concorrenza sulla chiamata */
  const rilevanti = tutti.filter(s => serve(s) > 0 && !s.mia);
  const pericolo = rilevanti.filter(s => !s.obbligata);

  if (nota) {
    nota.textContent = perRuolo
      ? `— ${pericolo.length} ${pericolo.length === 1 ? 'squadra può' : 'squadre possono'} ancora rilanciare su un ${NOME_RUOLO[filtroRuolo].toLowerCase().replace(/i$/, 'e')}`
      : `— ${pericolo.length} ${pericolo.length === 1 ? 'squadra' : 'squadre'} con crediti veri in mano`;
  }

  box.innerHTML = `<div class="avvgriglia">${tutti.map(s => {
    const n = serve(s);
    const fuoriGioco = s.completa || n === 0;
    const cls = [s.mia && 'mia', fuoriGioco && 'spenta', s.obbligata && !fuoriGioco && 'obbligata']
      .filter(Boolean).join(' ');
    const dettaglio = fuoriGioco
      ? (s.completa ? 'rosa completa' : `non gli serve ${perRuolo ? 'in questo ruolo' : ''}`)
      : s.obbligata
        ? 'obbligata a 1 credito'
        : `${s.residuo} cr · ${n} slot da riempire${perRuolo ? ' qui' : ''}`;
    return `<div class="avvcard ${cls}">
      <div class="avvn">${esc(s.nome)}${s.mia ? '<span class="pill p-t">tu</span>' : ''}</div>
      <div class="avvmax">${fuoriGioco ? '—' : s.max}<small>${fuoriGioco ? '' : ' max'}</small></div>
      <div class="avvd">${esc(dettaglio)}</div>
    </div>`;
  }).join('')}</div>
  <p class="spiega" style="padding:.6rem 0 0">Il <em>max</em> non sono i crediti che ha in cassa: sono
    quelli meno un credito per ogni altro slot che gli resta da riempire. È il massimo che può davvero
    offrire su un giocatore solo — oltre quello, non può rilanciare nemmeno volendo.</p>`;
}

/* ---------- tabella ---------- */

function disegnaTabella() {
  const s = cerca.toLowerCase();
  const sq = selSquadra.value;
  const verdetto = document.getElementById('fVerdetto').value;
  const fascia = document.getElementById('fFascia').value;

  const righe = players.filter(p =>
    (mostraFuori || !fuoriListone(p)) &&
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
    /* Le classi `c-*` non servono al colore: servono al telefono. Sotto i
       620px la tabella smette di essere una tabella e ogni riga diventa una
       scheda, e sono queste classi a dire a ogni cella dove andare a finire.
       Con :nth-child sarebbe bastato spostare una colonna per rompere tutto. */
    return `<tr class="${cls}${fuoriListone(p) ? ' fuorilista' : ''}">
      <td class="c-gioc"><span class="gioc">${badgeRuolo(p.r)}<span class="testo"><span class="nm">${esc(p.n)}${segnale(p)}${
  fuoriListone(p) ? `<span class="ko g-lunga" title="${esc(percheFuori(p))}">${p.fuori ? 'FUORI LISTA' : 'NON PIÙ QUOTATO'}</span>` : ''}</span>
        <span class="sq${p.sqFonte ? ' amano' : ''}"${p.sqFonte ? ` title="Squadra corretta a mano: Fantacalcio.it lo dà ancora al ${esc(p.sqFonte)}."` : ''}>${esc(p.sq)}</span></span></span></td>
      <td class="num mktc c-q" data-c="quot."><span>${p.q}</span></td>
      <td class="num mktc c-mkt" data-c="mercato"><span>${Math.round(p.mkt)}</span></td>
      <td class="num maxc c-max" data-c="tuo max"><span>${p.max}</span></td>
      <td class="num c-preso"><input type="number" min="0" max="${cfg.crediti}" value="${pagato}"
           data-id="${id}" placeholder="preso a" aria-label="Prezzo pagato per ${p.n}"${via ? ' disabled' : ''}></td>
      <td class="c-ass">${cellaFuori(p, id, via)}</td>
      <td class="c-verd"><span class="pill ${CLASSE_VERDETTO[p.v] || 'p-g'}">${p.v}</span></td>
      <td class="note c-nota">${p.nota || ''}</td></tr>`;
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
  disegnaAvversari();
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

/* La riga di stato dell'asta. Oltre a dire com'e' andata l'ultima cosa, deve
   dire in faccia se c'e' qualcosa che NON e' ancora arrivato al database:
   e' l'unica informazione che al tavolo non puo' restare implicita. */
let messaggioSync = '';

function statoSync(msg) { messaggioSync = msg; disegnaSync(); }

function disegnaSync() {
  const el = document.getElementById('sync');
  if (!el) return;
  const s = inSospeso();
  const avviso = s.quanti
    ? `<span class="nonsalvato">${s.inCorso ? 'sto salvando' : `${s.quanti} ${s.quanti === 1 ? 'gesto' : 'gesti'} non ancora salvat${s.quanti === 1 ? 'o' : 'i'}`}${
      s.errore && !s.inCorso ? ` — ${esc(s.errore)}` : ''}${
      s.ritentoFra ? ` · riprovo fra ${s.ritentoFra}s` : ''}</span>
       <button class="chip" id="ritenta">riprova ora</button>`
    : '';
  el.innerHTML = `<span>${esc(messaggioSync)}</span> ${avviso}`;
  el.querySelector('#ritenta')?.addEventListener('click', async () => {
    try { await ritentaOra(); statoSync('Salvato.'); }
    catch { /* lo dice gia' l'avviso */ }
  });
}

/* Appena cambia qualcosa nel salvataggio, la riga si riscrive da sola: non
   serve che ogni gesto si ricordi di aggiornarla. */
alSalvataggio(() => disegnaSync());

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

/* Prima si aggiorna lo schermo, poi si prova a mandare: al tavolo non devi
   mai aspettare la rete per vedere l'acquisto che hai appena segnato. Se il
   salvataggio non riesce ci pensa `astaLega` a ritentare da solo, e l'avviso
   arancione qui sotto dice quanti gesti sono ancora in canna. */
async function salva() {
  aggiorna();
  try {
    const r = await salvaAsta();
    rileggiStato();
    aggiorna();
    statoSync(r.fuso ? 'Salvato, e ho unito quello che aveva segnato l\'altro.' : 'Salvato.');
  } catch {
    statoSync('');   // il perché lo dice l'avviso, con quanti gesti mancano
  }
}

async function caricaTutto() {
  await pronto();
  try {
    await caricaAsta(players);
  } catch (e) {
    return statoSync('Non riesco a leggere l\'asta: ' + e.message);
  }
  if (allineaAllaLega(squadreDellaLega(), membriDellaLega())) { /* nomi dalla lega */ }
  rileggiStato();
  aggiorna();
  const m = metaAsta();
  /* Se qualcuno degli acquisti è stato riagganciato a una maglia nuova va
     detto: chi guarda vede il nome accanto a una squadra diversa da quella
     del giorno dell'asta, e senza una riga sembra un errore del sito. */
  const spostati = riagganciati();
  const trasferiti = spostati.length
    ? ` ${spostati.length} ${spostati.length === 1 ? 'giocatore ha cambiato' : 'giocatori hanno cambiato'} squadra dopo l'acquisto (`
      + spostati.slice(0, 3).map(x => `${x.n}: ${x.da} → ${x.a}`).join(', ')
      + `${spostati.length > 3 ? ', …' : ''}): restano tuoi.`
    : '';
  statoSync((m.assente
    ? 'Non collegato: entra col tuo account per vedere e segnare l\'asta della lega.'
    : m.nuovo ? 'Asta ancora vuota: il primo acquisto che segni la apre.'
      : `Ultimo movimento di ${m.da || 'qualcuno'}, ${quando(m.aggiornato)}.`) + trasferiti);
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
  disegnaAvversari();   // «chi può ancora rilanciare» dipende dal ruolo chiamato
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

document.getElementById('mostraFuori').onclick = e => {
  mostraFuori = !mostraFuori;
  e.currentTarget.setAttribute('aria-pressed', String(mostraFuori));
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

/* Scorciatoia: "/" porta alla chiamata, non alla ricerca nella tabella.
   All'asta il gesto che ripeti trenta volte e' registrare un acquisto.
   Il campo della chiamata e' l'unica casella dove "/" resta una scorciatoia:
   li' dentro premerlo vuol dire «ricomincia da capo», e se non lo prendessimo
   noi finirebbe scritto nel nome — che e' esattamente quello che succedeva. */
document.addEventListener('keydown', e => {
  if (e.key !== '/') return;
  const dove = document.activeElement;
  const inUnCampo = /^(INPUT|SELECT|TEXTAREA)$/.test(dove?.tagName) && dove !== inNome;
  if (inUnCampo) return;
  e.preventDefault();
  annullaChiamata();
});

/* Ogni otto secondi: se l'altro ha segnato qualcosa, compare qui da solo. */
osservaAsta(r => {
  accetta(r);
  allineaAllaLega(squadreDellaLega(), membriDellaLega());
  rileggiStato();
  aggiorna();
  statoSync(`${r.da || 'Qualcuno'} ha appena segnato un movimento.`);
});

/* Quanto sono vecchi i numeri che stai guardando: scritto dal file dei dati,
   non a mano. Nel footer c'era «infortuni aggiornati al 25 agosto 2026»,
   battuto a macchina, e cinque giorni dopo mentiva — proprio la cosa che
   all'asta ti fa fidare di una statistica vecchia di una giornata. */
{
  const el = document.getElementById('dataDati');
  if (el && AGGIORNATO_IL) {
    const giorni = Math.floor((Date.now() - new Date(AGGIORNATO_IL)) / 86400000);
    const quando = new Date(AGGIORNATO_IL)
      .toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    const eta = giorni <= 0 ? 'oggi stesso' : giorni === 1 ? 'ieri' : `${giorni} giorni fa`;
    el.innerHTML = giorni >= 2
      ? `<strong style="color:var(--warn)">Quotazioni, statistiche e infortuni sono aggiornati al
         ${esc(quando)}, cioè ${eta}</strong>: se nel frattempo si è giocato, questi numeri non
         tengono conto dell'ultima giornata. L'aggiornamento gira da solo ogni mattina alle 8; per
         lanciarlo subito, su GitHub → Actions → «Aggiorna dati giocatori» → Run workflow.`
      : `Quotazioni, statistiche e infortuni aggiornati al ${esc(quando)}, ${eta}.`;
  }
}

riempiForm();
aggiorna();
montaAccesso(document.getElementById('accesso'), caricaTutto);
await caricaTutto();
