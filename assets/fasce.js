/* Pagina "Fasce": tutti i giocatori di un ruolo, divisi per fascia, con il
   motivo per cui stanno dove stanno.

   La regola di questa pagina e' la stessa della guida: niente frasi scritte a
   mano su singoli giocatori, tranne le note del listone — quelle sono giudizi
   nostri e vanno mostrate per quello che sono. Tutto il resto lo deduco dai
   numeri, cosi' invecchia insieme ai dati invece che contro. */
import {
  caricaDati, caricaInfortuni, ricalcola, asta, badgeRuolo, classeGravita,
  gravita, giorniAlRientro, RUOLI, NOME_RUOLO, CLASSE_VERDETTO,
} from './app.js?v=34';
import { valuta, titolariDi } from './consiglio.js?v=34';
import { leggiCfg } from './cfg.js?v=34';
import { esc } from './db.js?v=34';

const { players, lega } = await caricaDati();
const { cfg } = await leggiCfg(lega);
ricalcola(players, cfg, cfg.piano);

const infortuni = await caricaInfortuni();
valuta(players, infortuni.per);

const stato = asta.leggi();
const altrui = asta.leggiAltrui();
const preso = id => stato[id] > 0 || altrui.has(id);

const prezzo = p => Math.max(1, Math.round(p.mkt));
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');

/* ---------- il rango dentro il ruolo ---------- */

const posizione = new Map();
for (const r of RUOLI) {
  players.filter(p => p.r === r).sort((a, b) => b.val - a.val || b.mkt - a.mkt)
    .forEach((p, i) => posizione.set(p, i + 1));
}

/* Quanti ne verranno comprati in tutto: serve a spiegare cosa vuol dire una
   fascia. Con dieci squadre e tre portieri a testa se ne comprano trenta, e
   chi resta fuori non lo vuole nessuno. */
const compratiPerRuolo = Object.fromEntries(
  RUOLI.map(r => [r, cfg.squadre * cfg.slot[r]]));

const mod = cfg.modificatoreDifesa;
const modAttivo = mod?.attivo !== false;
const titolari = titolariDi(cfg.modulo);

/* ---------- perché sta in questa fascia ---------- */

const ordinale = n => ['', 'primo', 'secondo', 'terzo', 'quarto', 'quinto',
  'sesto', 'settimo', 'ottavo', 'nono', 'decimo'][n] || `${n}°`;

/* Il nome del ruolo al singolare. Toglierlo dal plurale con una regex dava
   "centrocampiste": meglio scriverli. */
const UNO = { P: 'portiere', D: 'difensore', C: 'centrocampista', A: 'attaccante' };

/* "nel 92%" ma "nell'87%": in italiano l'elisione dipende da come si legge il
   numero, e i soli casi che capitano qui sono quelli che iniziano per otto o
   undici. */
const nelPercento = n => (/^(8|11$)/.test(String(n)) ? "nell'" : 'nel ') + n + '%';

/**
 * Una riga di fatti, costruita solo con quello che il modello sa davvero.
 * Niente aggettivi: numeri e conseguenze.
 */
function perche(p) {
  const pezzi = [];
  const pos = posizione.get(p);
  const quanti = players.filter(x => x.r === p.r).length;

  /* dove sta, e quanto rende: il numero che decide tutto il resto */
  pezzi.push(pos <= 10
    ? `<strong>Il ${ordinale(pos)} ${UNO[p.r]} del listone</strong> per punti attesi`
    : `<strong>${pos}° su ${quanti}</strong> nel ruolo per punti attesi`);
  pezzi.push(`${Math.round(p.val)} punti a stagione sopra un giocatore da un credito`);

  /* da cosa nascono quei punti */
  if (p.r === 'P' || p.r === 'D') {
    if (modAttivo) {
      pezzi.push(`media voto attesa <strong>${num(p.mvAtt)}</strong>, che è quello che conta per il modificatore`);
    } else {
      pezzi.push(`fantamedia attesa ${num(p.fmAtt)}`);
    }
  } else {
    pezzi.push(`fantamedia attesa <strong>${num(p.fmAtt)}</strong>, di cui ${num(p.bonusAtt)} di bonus`);
  }

  /* quanto lo avrai davvero in campo */
  const quota = Math.round(p.disp * 100);
  if (quota < 45) pezzi.push(`ma lo prevediamo in campo solo ${nelPercento(quota)} delle giornate`);
  else if (quota >= 80) pezzi.push(`e lo prevediamo in campo ${nelPercento(quota)} delle giornate`);

  return pezzi.join(', ') + '.';
}

/** Il verdetto sul prezzo, detto in italiano invece che in gergo. */
function sulPrezzo(p) {
  const margine = Math.round((p.max / Math.max(p.mkt, 0.5) - 1) * 100);
  if (p.max <= 2) {
    return `Vale un credito: se avanza uno slot, prendilo, ma non spenderci sopra.`;
  }
  if (p.v === 'TARGET') {
    return `Per te vale fino a <strong>${p.max}</strong> mentre al tavolo dovrebbe andare a ${prezzo(p)}:
      ${margine}% di margine. È qui che si guadagna.`;
  }
  if (p.v === 'LASCIA') {
    return `Il tuo tetto è ${p.max}, sotto i ${prezzo(p)} che costerà: lascialo agli altri e prendi i punti altrove.`;
  }
  return `Tetto ${p.max} contro ${prezzo(p)} di mercato: prezzo giusto, nessun affare né in un senso né nell'altro.`;
}

/* ---------- disegno ---------- */

let ruolo = 'D', cerca = '', soloLiberi = false;
try {
  const r = localStorage.getItem('pianoAsta:fasce');
  if (RUOLI.includes(r)) ruolo = r;
} catch { /* storage non disponibile */ }

/* Cosa vuol dire ogni fascia, detto in termini d'asta e non di numeri. */
function sensoFascia(f, n, comprati, slot) {
  const perSquadra = n / cfg.squadre;
  if (f === 1) {
    if (perSquadra < 1) {
      return `Ce n'è meno di uno a testa: qualcuno resterà senza, ed è per questo che qui parte la rissa.`;
    }
    if (n === cfg.squadre) {
      return `Esattamente uno a testa. Ce n'è per tutti, ma solo se nessuno ne prende due: chi ne compra un
        secondo lascia qualcun altro a mani vuote, e quello pagherà.`;
    }
    return `Ne bastano ${cfg.squadre} per una a testa e ce ne sono ${n}: non serve strapagare il primo estratto.`;
  }
  if (f === 2) return `La fascia dove si fanno gli affari: rendono quasi come la prima e costano molto meno.`;
  if (f === 3) return `Riempitivi buoni: da qui in giù l'unica cosa che conta davvero è che giochino.`;
  return `Gli ultimi slot, da chiudere a uno o due crediti. Nel ruolo se ne comprano ${comprati} in tutto, quindi di questa fascia ne resta sempre fuori parecchia: non affrettarti.`;
}

function filtra(lista) {
  const s = cerca.trim().toLowerCase();
  return lista.filter(p =>
    (!soloLiberi || !preso(asta.id(p))) &&
    (!s || p.n.toLowerCase().includes(s) || p.sq.toLowerCase().includes(s)));
}

function disegna() {
  const tutti = players.filter(p => p.r === ruolo).sort((a, b) => b.val - a.val || b.mkt - a.mkt);
  const comprati = compratiPerRuolo[ruolo];

  /* riepilogo in testa */
  const liberi = tutti.filter(p => !preso(asta.id(p)));
  document.getElementById('totali').innerHTML = [1, 2, 3, 4].map(f => {
    const dentro = tutti.filter(p => p.f === f);
    const ancora = dentro.filter(p => !preso(asta.id(p))).length;
    const spesa = dentro.length ? Math.round(dentro.reduce((a, p) => a + prezzo(p), 0) / dentro.length) : 0;
    return `<div class="lcell${f === 1 ? '' : ''}" data-r="${ruolo}"><div class="k">${f}ª fascia</div>
      <div class="n">${ancora}<small> / ${dentro.length} liberi · ~${spesa} cr</small></div></div>`;
  }).join('') + `<div class="lcell"><div class="k">Se ne comprano</div>
      <div class="n">${comprati}<small> su ${tutti.length}</small></div></div>`;

  const box = document.getElementById('elenco');
  const cercando = cerca.trim().length > 0;
  let html = '';

  for (const f of [1, 2, 3, 4]) {
    const dentro = filtra(tutti.filter(p => p.f === f));
    const totaleFascia = tutti.filter(p => p.f === f).length;
    if (!dentro.length) {
      html += `<div class="repbox"><div class="rephead" data-r="${ruolo}">${f}ª fascia
        <span class="sp">nessuno con questi filtri</span></div></div>`;
      continue;
    }

    /* Le fasce basse restano chiuse: la quarta da sola ha piu' di cento nomi,
       e aprirla tutta faceva una pagina lunga ventiquattromila pixel in cui
       non trovavi piu' niente. Quando cerchi qualcuno si aprono da sole,
       altrimenti il risultato resterebbe nascosto. */
    const aperta = f <= 2 || cercando;
    /* Per la quarta la descrizione lunga non aggiunge nulla: sono tutti
       riempitivi da un credito e direbbe la stessa cosa centotrenta volte. */
    const breve = f === 4 && !cercando;

    const righe = dentro.map(p => {
      const id = asta.id(p);
      const ko = infortuni.per.get(id);
      const mio = stato[id] > 0;
      const andato = altrui.has(id);
      const capo = `<div class="capo">
          <span class="gioc">${badgeRuolo(p.r)}<span class="testo"><span class="nm">${esc(p.n)}</span></span></span>
          <span class="sq" style="color:var(--ink3)">${esc(p.sq)}</span>
          ${ko ? `<span class="ko ${classeGravita(ko)}" title="${esc(ko.desc || '')}">${ko.tipo === 'infortunio' ? 'KO' : 'SQ'}</span>` : ''}
          <span class="pill ${CLASSE_VERDETTO[p.v] || 'p-g'}">${esc(p.v)}</span>
          ${mio ? '<span class="pill p-t">tuo</span>' : ''}
          ${andato ? '<span class="pill p-l">già andato</span>' : ''}
          <span class="firma" style="margin-left:auto">quot. ${p.q} · mercato ${prezzo(p)} · <strong>tuo max ${p.max}</strong></span>
        </div>`;
      if (breve) {
        return `<div class="infrow${mio ? ' mia' : ''}"${andato ? ' style="opacity:.5"' : ''}>${capo}</div>`;
      }
      return `<div class="infrow${mio ? ' mia' : ''}"${andato ? ' style="opacity:.5"' : ''}>${capo}
        <div class="perche">${perche(p)} ${sulPrezzo(p)}</div>
        ${p.nota ? `<div class="perche" style="color:var(--ink3);font-style:italic">Nota nostra: ${esc(p.nota)}</div>` : ''}
        ${ko ? `<div class="perche" style="color:var(--warn)">Fermo: ${esc(ko.desc || ko.motivo || ko.tipo)}</div>` : ''}
      </div>`;
    }).join('');

    const conta = `${dentro.length}${dentro.length !== totaleFascia ? ` di ${totaleFascia}` : ''} giocatori`;

    html += `<div class="repbox"><details class="fasciabox"${aperta ? ' open' : ''}>
      <summary class="rephead" data-r="${ruolo}">${f}ª fascia <span class="sp">${conta}</span></summary>
      <p class="spiega" style="padding:.5rem 1rem 0;margin:0">${sensoFascia(f, totaleFascia, comprati, cfg.slot[ruolo])}${breve ? ' <em>Qui mostro solo i numeri: cercane uno per nome se vuoi il ragionamento per esteso.</em>' : ''}</p>
      <div class="replist">${righe}</div></details></div>`;
  }

  box.innerHTML = html;

  document.getElementById('quanti').textContent =
    `${filtra(tutti).length} giocatori mostrati su ${tutti.length}, ${liberi.length} ancora liberi.`;
}

/* ---------- interazioni ---------- */

document.querySelectorAll('.chip[data-r]').forEach(c => c.onclick = () => {
  ruolo = c.dataset.r;
  document.querySelectorAll('.chip[data-r]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
  try { localStorage.setItem('pianoAsta:fasce', ruolo); } catch { /* ignora */ }
  disegna();
});

document.getElementById('q').addEventListener('input', e => { cerca = e.target.value; disegna(); });

document.getElementById('soloLiberi').onclick = e => {
  soloLiberi = !soloLiberi;
  e.currentTarget.setAttribute('aria-pressed', String(soloLiberi));
  disegna();
};

document.querySelectorAll('.chip[data-r]').forEach(c =>
  c.setAttribute('aria-pressed', String(c.dataset.r === ruolo)));

/* ---------- come nascono le fasce, detto in chiaro ---------- */

document.getElementById('comeNascono').innerHTML = `
  <p>Le fasce non sono un'opinione: dentro ogni ruolo i giocatori sono messi in fila per
  <strong>punti attesi in una stagione</strong> — quanto rendono in più di un giocatore da un credito — e
  tagliati in quattro gruppi. I tagli sono tarati sulla scarsità: la prima fascia è quella dove non ce n'è
  uno per tutte le ${cfg.squadre} squadre, ed è per questo che all'asta parte la rissa.</p>
  <p>I punti attesi vengono dalla fantamedia che il modello si aspetta, moltiplicata per le giornate in cui
  prevede di averlo in campo. Per portieri e difensori conta soprattutto la <em>media voto</em>, perché è
  quella che alimenta il modificatore; per centrocampisti e attaccanti contano i bonus. Ecco perché un
  difensore da 6,45 di media voto può stare in prima fascia con zero gol, e un attaccante no.</p>
  <p>La riga in corsivo, dove c'è, è un giudizio scritto a mano nel listone: rigoristi, ballottaggi,
  cambi di squadra. Il modello non la usa per ordinare — la vedi perché serve a te.</p>`;

/* Primo disegno. Senza questa riga la pagina restava vuota finche' non
   toccavi un filtro. */
disegna();
