/* Pagina "Impostazioni": le regole della lega, condivise nel database. */
import { caricaDati, caricaInfortuni, ricalcola, RUOLI, NOME_RUOLO } from './app.js?v=5df970e3';
import { leggiCfg, salvaCfg, salvaPiano, unisci } from './cfg.js?v=7661d252';
import { pronto, collegato, inLega, squadra, montaAccesso, esc, quando } from './db.js?v=6824e6b7';
import { toast, conferma as chiediConferma } from './ui.js?v=2606df5a';
import { valuta, tabellaModificatore, componiRosa, STRATEGIE, titolariDi } from './consiglio.js?v=6078dfa9';

const { players, lega } = await caricaDati();

/* Il carattere del mercato descrive gli avversari, non te: sono tre profili
   di lega, non tre strategie. Da tenere ben distinto dal piano di spesa. */
const MERCATI = {
  attacco: { P: 5, D: 12, C: 28.5, A: 54.5 },
  equilibrata: { P: 6, D: 15, C: 30, A: 49 },
  difesa: { P: 8, D: 20, C: 30, A: 42 },
};

let cfg, versione = 0, versionePiano = 0, origine = 'lega', originePiano = 'lega';
let messaggio = '', statoBarra = '';

await pronto();
montaAccesso(document.getElementById('accesso'), () => { carica(); });

/* Ogni campo della pagina: id, da dove si legge, dove si scrive. */
const CAMPI = [
  ['crediti', c => c.crediti, (c, v) => c.crediti = v],
  ['squadre', c => c.squadre, (c, v) => c.squadre = v],
  ['sP', c => c.slot.P, (c, v) => c.slot.P = v],
  ['sD', c => c.slot.D, (c, v) => c.slot.D = v],
  ['sC', c => c.slot.C, (c, v) => c.slot.C = v],
  ['sA', c => c.slot.A, (c, v) => c.slot.A = v],
  ['qP', c => c.quotaMercato.P * 100, (c, v) => c.quotaMercato.P = v / 100],
  ['qD', c => c.quotaMercato.D * 100, (c, v) => c.quotaMercato.D = v / 100],
  ['qC', c => c.quotaMercato.C * 100, (c, v) => c.quotaMercato.C = v / 100],
  ['qA', c => c.quotaMercato.A * 100, (c, v) => c.quotaMercato.A = v / 100],
  ['pP', c => c.piano.P, (c, v) => c.piano.P = v],
  ['pD', c => c.piano.D, (c, v) => c.piano.D = v],
  ['pC', c => c.piano.C, (c, v) => c.piano.C = v],
  ['pA', c => c.piano.A, (c, v) => c.piano.A = v],
];

async function carica() {
  const r = await leggiCfg(lega);
  cfg = r.cfg;
  versione = r.versione; origine = r.origine;
  versionePiano = r.versionePiano; originePiano = r.originePiano;
  statoBarra = '';
  messaggio = {
    database: `Impostazioni della lega${r.da ? `, ultimo cambio di ${esc(r.da)} ${quando(r.aggiornato)}` : ''}.`,
    browser: 'Impostazioni salvate solo in questo browser: entra col tuo account e premi «Salva per tutti» per condividerle con Aurelio.',
    lega: 'Valori di partenza della lega, mai modificati.',
  }[origine];
  if (origine !== 'database') statoBarra = 'sporca';
  riempi();
  disegnaBarra();
}

function riempi() {
  for (const [id, leggi] of CAMPI) {
    const el = document.getElementById(id);
    /* non riscrivo il campo su cui stai scrivendo: te lo vedresti cambiare
       sotto le dita a meta' numero */
    if (el && el !== document.activeElement) el.value = Math.round(leggi(cfg) * 100) / 100;
  }
  document.getElementById('modAttivo').value = cfg.modificatoreDifesa?.attivo === false ? '0' : '1';
  document.getElementById('moduloPref').value = cfg.modulo;
  document.getElementById('strategiaPref').value = cfg.strategia;
  aggiorna();
}

/* ---------- come giochi ---------- */

const selModulo = document.getElementById('moduloPref');
selModulo.innerHTML = lega.moduli.map(m => `<option value="${m}">${m}</option>`).join('');

const selStrategia = document.getElementById('strategiaPref');
selStrategia.innerHTML = Object.entries(STRATEGIE)
  .map(([k, s]) => `<option value="${k}">${esc(s.nome)} — ${esc(s.riga)}</option>`).join('');

selModulo.addEventListener('change', () => { cfg.modulo = selModulo.value; aggiorna(); });
selStrategia.addEventListener('change', () => { cfg.strategia = selStrategia.value; aggiorna(); });

function disegnaBarra() {
  const b = document.getElementById('barra-imp');
  b.className = 'savebar' + (statoBarra ? ' ' + statoBarra : '');
  b.innerHTML = `<span class="dot"></span><span class="msg">${esc(messaggio)}</span>`;
  const puoiLega = collegato() && inLega();
  const puoiPiano = puoiLega && Boolean(squadra());
  const bl = document.getElementById('salva');
  const bp = document.getElementById('salvaPiano');
  bl.disabled = !puoiLega;
  bl.title = puoiLega ? '' : 'Entra col tuo account e in una lega';
  bp.disabled = !puoiPiano;
  bp.title = puoiPiano ? '' : 'Serve una squadra: scegliela nella pagina «La mia lega»';

  const parola = {
    database: 'nel database',
    browser: 'solo in questo browser',
    lega: 'valori di partenza',
    'senza-squadra': 'nessuna squadra scelta',
  };
  document.getElementById('origine').textContent =
    `regole: ${parola[origine] || '—'} · piano: ${parola[originePiano] || '—'}`;
}

/** Ricalcola prezzi e avvisi ogni volta che tocchi un campo. */
function aggiorna() {
  const slotTot = RUOLI.reduce((a, r) => a + cfg.slot[r], 0);
  document.getElementById('monte').textContent = `${cfg.crediti * cfg.squadre} crediti`;
  document.getElementById('slotTot').textContent = slotTot;
  document.getElementById('tuoiCrediti').textContent = cfg.crediti;

  const somma = RUOLI.reduce((a, r) => a + cfg.quotaMercato[r], 0);
  document.getElementById('avvisoQuote').innerHTML = Math.abs(somma - 1) > 0.005
    ? `<strong style="color:var(--warn)">Le quote sommano a ${(somma * 100).toFixed(1)}% invece di 100%.</strong>`
    : '';

  const piano = RUOLI.reduce((a, r) => a + cfg.piano[r], 0);
  document.getElementById('avvisoPiano').innerHTML = piano !== cfg.crediti
    ? `<strong style="color:var(--warn)">Il piano somma a ${piano} invece di ${cfg.crediti}.</strong>`
    : '';

  /* avviso quando il modulo scelto spegne il modificatore: e' la conseguenza
     piu' costosa di questa pagina, e non deve restare nascosta */
  const t = titolariDi(cfg.modulo);
  const md = cfg.modificatoreDifesa;
  document.getElementById('notaModulo').innerHTML = md?.attivo && t.D < md.minDifensori
    ? `<strong style="color:var(--warn)">Col ${esc(cfg.modulo)} schieri ${t.D} difensori e il modificatore
       non scatta: ne servono almeno ${md.minDifensori}.</strong>`
    : '';

  /* anteprima: i prezzi si ricalcolano su una copia, per non sporcare il listone */
  const copia = players.map(p => ({ ...p }));
  ricalcola(copia, cfg, cfg.piano);
  document.getElementById('anteprima').innerHTML = RUOLI.map(r => {
    const top = copia.filter(p => p.r === r).sort((a, b) => b.mkt - a.mkt)[0];
    return `<div class="lcell" data-r="${r}"><div class="k">${NOME_RUOLO[r]} · il più caro</div>
      <div class="n">${top ? Math.round(top.mkt) : 0}<small> cr · ${esc(top ? top.n : '')}</small></div></div>`;
  }).join('') + `<div class="lcell"><div class="k">Tetto più alto</div>
      <div class="n">${Math.max(...copia.map(p => p.max))}<small> cr</small></div></div>`;
}

for (const [id, , scrivi] of CAMPI) {
  const el = document.getElementById(id);
  if (!el) continue;
  /* Il monte crediti fa un lavoro in piu': riscala il piano di spesa, che
     altrimenti resterebbe tarato sul budget vecchio. Ma lo fa solo quando hai
     finito di scrivere ("change"), non a ogni tasto: digitando "700" il campo
     passa da 7 a 70 a 700, e riscalare su "7" azzererebbe il piano. */
  const applica = (fine) => {
    const v = parseFloat(el.value);
    if (!isFinite(v) || v <= 0) return;
    if (id === 'crediti') {
      if (!fine) return;                       /* aspetto che tu abbia finito */
      if (cfg.crediti > 0 && v !== cfg.crediti) {
        const f = v / cfg.crediti;
        for (const r of RUOLI) cfg.piano[r] = Math.max(1, Math.round(cfg.piano[r] * f));
      }
      scrivi(cfg, v);
      return riempi();
    }
    scrivi(cfg, v);
    aggiorna();
  };
  el.addEventListener('input', () => applica(false));
  el.addEventListener('change', () => applica(true));
}

document.getElementById('modAttivo').addEventListener('change', e => {
  cfg.modificatoreDifesa = { ...cfg.modificatoreDifesa, attivo: e.target.value === '1' };
  aggiorna();
});

/* ---------- i tre profili di lega ---------- */

for (const b of document.querySelectorAll('[data-mercato]')) {
  b.onclick = () => {
    const q = MERCATI[b.dataset.mercato];
    for (const r of RUOLI) cfg.quotaMercato[r] = q[r] / 100;
    riempi();
    toast('Carattere del mercato aggiornato. Ricordati di salvare.');
  };
}

/* ---------- il piano di spesa, calcolato dal consigliere ---------- */

/* Le valutazioni costano qualche decimo di secondo e la tabella del
   modificatore un po' di piu': si preparano alla prima richiesta e poi restano.
   La tabella va rifatta se cambi l'interruttore del modificatore. */
const infortuni = await caricaInfortuni();
let valutato = false;
let tabella = null, tabellaPer = null;

function preparaModello() {
  if (!valutato) { valuta(players, infortuni.per); valutato = true; }
  const chiave = JSON.stringify(cfg.modificatoreDifesa);
  if (tabellaPer !== chiave) { tabella = tabellaModificatore(cfg.modificatoreDifesa); tabellaPer = chiave; }
  return tabella;
}

document.getElementById('calcolaPiano').onclick = async () => {
  const esito = document.getElementById('esitoPiano');
  const bottone = document.getElementById('calcolaPiano');
  bottone.disabled = true;
  esito.textContent = 'Compongo la rosa migliore per il ' + cfg.modulo + '…';
  /* un giro di disegno prima di bloccare il filo di esecuzione, altrimenti il
     messaggio comparirebbe solo a conti finiti */
  await new Promise(requestAnimationFrame);

  try {
    /* i prezzi devono essere quelli delle impostazioni attuali, non quelli
       caricati all'apertura della pagina */
    ricalcola(players, cfg, cfg.piano);
    const r = componiRosa({
      players, cfg, modulo: cfg.modulo, strategia: cfg.strategia, tab: preparaModello(),
    });

    /* la spesa del consigliere non fa mai la cifra tonda: il resto va al
       reparto che ne ha assorbito di piu', cosi' il piano somma ai crediti */
    const nuovo = {};
    for (const x of RUOLI) nuovo[x] = Math.max(1, Math.round(r.reparti[x].spesa));
    const scarto = cfg.crediti - RUOLI.reduce((a, x) => a + nuovo[x], 0);
    const grosso = RUOLI.slice().sort((a, b) => nuovo[b] - nuovo[a])[0];
    nuovo[grosso] = Math.max(1, nuovo[grosso] + scarto);

    cfg.piano = nuovo;
    riempi();
    esito.textContent = `${RUOLI.map(x => `${x} ${nuovo[x]}`).join(' · ')} — ricordati di salvare.`;
    toast('Piano di spesa calcolato sul ' + cfg.modulo);
  } catch (e) {
    esito.textContent = 'Non ci sono riuscito: ' + e.message;
  } finally {
    bottone.disabled = false;
  }
};

/* Due salvataggi, perche' sono due cose diverse con due proprietari diversi:
   le regole le vedono tutti quelli della lega, il piano solo la tua squadra.
   Un pulsante solo avrebbe nascosto proprio la distinzione che conta. */
document.getElementById('salva').onclick = async () => {
  messaggio = 'Salvo le regole della lega…'; statoBarra = ''; disegnaBarra();
  try {
    versione = await salvaCfg(cfg, versione);
    origine = 'database';
    messaggio = 'Regole salvate: valgono per tutti quelli che giocano questa lega.';
    toast('Regole della lega aggiornate');
  } catch (e) {
    statoBarra = 'errore';
    messaggio = e.message;
  }
  disegnaBarra();
};

document.getElementById('salvaPiano').onclick = async () => {
  messaggio = 'Salvo il tuo piano…'; statoBarra = ''; disegnaBarra();
  try {
    versionePiano = await salvaPiano(cfg, versionePiano);
    originePiano = 'database';
    messaggio = 'Piano salvato. Lo vede solo chi gestisce la tua squadra.';
    toast('Piano di spesa salvato');
  } catch (e) {
    statoBarra = 'errore';
    messaggio = e.message;
  }
  disegnaBarra();
};

document.getElementById('ricarica').onclick = carica;

document.getElementById('reset').onclick = async () => {
  const si = await chiediConferma({
    titolo: 'Torno ai valori di partenza?',
    testo: 'Rimette crediti, squadre, slot, quote e piano com\'erano all\'inizio. Non salva: dopo devi premere «Salva per tutti» se vuoi che valga anche per Aurelio.',
    ok: 'Sì, ripristina',
  });
  if (!si) return;
  cfg = unisci(lega, null, null);
  riempi();
  statoBarra = 'sporca';
  messaggio = 'Valori di partenza ripristinati, non ancora salvati.';
  disegnaBarra();
};

await carica();
