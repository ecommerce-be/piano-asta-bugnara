/* Piano d'Asta — modello di prezzo e utility condivise.
   Nessuna dipendenza esterna. Tutto gira nel browser. */

export const RUOLI = ['P', 'D', 'C', 'A'];
export const NOME_RUOLO = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };

/** Carica listone + configurazione di lega. */
export async function caricaDati(base = 'assets/data/') {
  const [players, lega] = await Promise.all([
    fetch(base + 'players.json').then(r => r.json()),
    fetch(base + 'league.json').then(r => r.json()),
  ]);
  return { players, lega };
}

/**
 * Prezzo di mercato atteso.
 *
 * Il monte crediti della lega (squadre x crediti) viene ripartito fra i giocatori
 * che verranno effettivamente acquistati (squadre x slot per ruolo). Dentro ogni
 * reparto la spesa segue una curva sulla quotazione ufficiale: l'esponente alpha
 * concentra i crediti in alto, come succede alle aste vere. Ogni giocatore parte
 * comunque da 1 credito, perche' nessuno si compra a zero.
 *
 * quotaMercato descrive il CARATTERE della lega: quanto del monte crediti finisce
 * in ogni reparto. Una lega sbilanciata sull'attacco usa qualcosa come 5/12/28/55;
 * una equilibrata, 6/15/30/49.
 */
export function calcolaMercato(players, lega) {
  const monte = lega.crediti * lega.squadre;
  const perRuolo = {};
  for (const r of RUOLI) perRuolo[r] = players.filter(p => p.r === r).sort((a, b) => b.q - a.q);

  for (const r of RUOLI) {
    const presi = lega.squadre * lega.slot[r];
    const lista = perRuolo[r];
    const top = lista.slice(0, presi);
    const pesi = top.map(p => Math.pow(Math.max(p.q, 1), lega.alpha));
    const somma = pesi.reduce((a, b) => a + b, 0) || 1;
    const extra = monte * lega.quotaMercato[r] - presi;
    top.forEach((p, i) => { p.mkt = 1 + Math.max(extra, 0) * pesi[i] / somma; });
    lista.slice(presi).forEach(p => { p.mkt = 1; });
  }
  return players;
}

/**
 * Tetto personale = prezzo di mercato x coefficiente strategico, tagliato da un
 * massimo per reparto derivato dal piano di spesa. Il coefficiente e' un giudizio
 * (valore da modificatore, rigoristi, titolarita', infortuni), non un dato.
 */
export function calcolaTetti(players, lega, piano) {
  const tetto = {};
  for (const r of RUOLI) tetto[r] = Math.max(2, Math.round(piano[r] * lega.tettoFrazione[r]));

  for (const p of players) {
    const grezzo = p.mkt * (p.mult ?? 1);
    p.max = Math.min(tetto[p.r], Math.max(1, Math.round(grezzo)));
    if (p.q <= 1 && (p.mult ?? 1) <= 1) p.max = 1;

    const rapporto = p.max / Math.max(p.mkt, 0.5);
    if (p.max <= 2) p.v = (p.mult ?? 1) >= 1 ? 'JOLLY 1 CR' : 'IGNORA';
    else if (rapporto >= 1.22) p.v = 'TARGET';
    else if (rapporto < 0.85) p.v = 'LASCIA';
    else p.v = 'PREZZO GIUSTO';
  }

  const soglie = { P: [6, 12, 22], D: [10, 26, 56], C: [10, 26, 56], A: [8, 20, 42] };
  for (const r of RUOLI) {
    const lista = players.filter(p => p.r === r).sort((a, b) => b.max - a.max || b.q - a.q);
    const [s1, s2, s3] = soglie[r];
    lista.forEach((p, i) => { p.f = i < s1 ? 1 : i < s2 ? 2 : i < s3 ? 3 : 4; });
  }
  return { players, tetto };
}

/** Pipeline completa: mercato + tetti, in un colpo solo. */
export function ricalcola(players, lega, piano) {
  calcolaMercato(players, lega);
  return calcolaTetti(players, lega, piano || lega.piano);
}

/* ---------- modificatore di difesa ---------- */

/** Punti del modificatore per una media voto, secondo la tabella della lega. */
export function puntiModificatore(media, tabella) {
  let punti = 0;
  for (const [soglia, valore] of tabella) if (media >= soglia) punti = valore;
  return punti;
}

/**
 * Punti attesi a giornata, via Monte Carlo.
 * mediaDifensori: array di media voto attese (una per difensore schierato)
 * mediaPortiere:  media voto attesa del portiere
 * pSalta:         probabilita' che un titolare resti senza voto
 * copertura:      probabilita' che la panchina lo sostituisca con un voto valido
 */
export function simulaModificatore(mediaDifensori, mediaPortiere, mod, opts = {}) {
  const { pSalta = 0.05, copertura = 0.95, n = 20000, sdDif = 0.6, sdPor = 0.75 } = opts;
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const arrotonda = x => Math.round(x * 2) / 2;
  let somma = 0, azzerate = 0, almenoTre = 0;

  for (let i = 0; i < n; i++) {
    const voti = [];
    for (const mu of mediaDifensori) {
      if (Math.random() < pSalta) {
        if (Math.random() < copertura) voti.push(arrotonda(6.05 + gauss() * sdDif));
      } else {
        voti.push(arrotonda(mu + gauss() * sdDif));
      }
    }
    if (voti.length < mod.minDifensori) { azzerate++; continue; }
    voti.sort((a, b) => b - a);
    const migliori = voti.slice(0, mod.migliori);
    const portiere = arrotonda(mediaPortiere + gauss() * sdPor);
    const pezzi = mod.includiPortiere ? migliori.concat([portiere]) : migliori;
    const media = pezzi.reduce((a, b) => a + b, 0) / pezzi.length;
    const punti = puntiModificatore(media, mod.tabella);
    somma += punti;
    if (punti >= 3) almenoTre++;
  }
  return {
    perGiornata: somma / n,
    stagione: (somma / n) * 38,
    quotaAlmenoTre: almenoTre / n,
    quotaAzzerate: azzerate / n,
  };
}

/* ---------- stato dell'asta (locale e condivisibile) ---------- */

const CHIAVE_MIA = 'pianoAsta:v1';        // { "D|Bremer|Juventus": 22 }  quanto ho pagato io
const CHIAVE_ALTRUI = 'pianoAsta:altrui:v1';  // [ "A|Malen|Roma", ... ]  chi se lo e' preso un avversario

function leggiJSON(chiave, vuoto) {
  try { return JSON.parse(localStorage.getItem(chiave) || 'null') ?? vuoto; } catch { return vuoto; }
}
function scriviJSON(chiave, valore) {
  try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch { /* storage non disponibile */ }
}

/**
 * Questa fantasquadra la gestisco io?
 * Confronto tollerante: nel campo "allenatore" si scrive di tutto —
 * "Pierre", "pierre", "Pierre e Aurelio", "Pierre (capitano)". Basta che il
 * nome del mio account compaia come parola intera.
 */
export function gestisce(proprietario, nome) {
  const io = (nome || '').trim().toLowerCase();
  if (!io) return false;
  const parole = (proprietario || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return parole.includes(io);
}

export const asta = {
  id(p) { return `${p.r}|${p.n}|${p.sq}`; },

  leggi() { return leggiJSON(CHIAVE_MIA, {}); },
  scrivi(stato) { scriviJSON(CHIAVE_MIA, stato); },

  leggiAltrui() { return new Set(leggiJSON(CHIAVE_ALTRUI, [])); },
  scriviAltrui(insieme) { scriviJSON(CHIAVE_ALTRUI, [...insieme]); },

  /** Un giocatore e' fuori dal mercato se l'ho preso io o se se l'e' preso un altro. */
  disponibile(p, stato, altrui) {
    return !(stato[asta.id(p)] > 0) && !altrui.has(asta.id(p));
  },

  /** Riepilogo per reparto: speso, residuo, slot liberi, sforamenti. */
  riepilogo(players, stato, lega, piano) {
    const out = { reparti: {}, spesoTot: 0, presiTot: 0, sopraTetto: 0 };
    for (const r of RUOLI) {
      const presi = players.filter(p => p.r === r && stato[asta.id(p)] > 0);
      const speso = presi.reduce((a, p) => a + stato[asta.id(p)], 0);
      out.reparti[r] = {
        presi: presi.length, slot: lega.slot[r], speso,
        residuo: piano[r] - speso, liberi: lega.slot[r] - presi.length,
      };
      out.spesoTot += speso;
      out.presiTot += presi.length;
      out.sopraTetto += presi.filter(p => stato[asta.id(p)] > p.max).length;
    }
    out.residuoTot = lega.crediti - out.spesoTot;
    return out;
  },

  /**
   * Quanti giocatori restano liberi, per ruolo e per fascia.
   * Con la chiamata random e' l'informazione che decide se rilanciare: se in
   * prima fascia restano due portieri e cinque squadre sono ancora senza, il
   * prezzo del prossimo estratto sale, non scende.
   */
  scorte(players, stato, altrui) {
    const out = {};
    for (const r of RUOLI) {
      out[r] = { 1: { liberi: 0, tot: 0 }, 2: { liberi: 0, tot: 0 }, 3: { liberi: 0, tot: 0 }, 4: { liberi: 0, tot: 0 } };
      for (const p of players.filter(x => x.r === r)) {
        const f = out[r][p.f];
        if (!f) continue;
        f.tot++;
        if (asta.disponibile(p, stato, altrui)) f.liberi++;
      }
    }
    return out;
  },
};

/* Serializza tutto lo stato (mio + avversari) in una stringa da incollare. */
export function esportaStato(stato, altrui) {
  const pacco = { v: 2, mia: stato, altrui: [...(altrui || [])] };
  return btoa(unescape(encodeURIComponent(JSON.stringify(pacco))));
}

export function importaStato(testo) {
  const dati = JSON.parse(decodeURIComponent(escape(atob(testo.trim()))));
  // il formato vecchio era la sola mappa dei miei acquisti
  if (dati && dati.v === 2) return { mia: dati.mia || {}, altrui: new Set(dati.altrui || []) };
  return { mia: dati || {}, altrui: new Set() };
}

/* ---------- utility ---------- */

export function toast(messaggio) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = messaggio;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 2200);
}

/** Pallino colorato col ruolo, come su LegheFantacalcio. */
export function badgeRuolo(r) {
  return `<span class="rb rb-${r}" aria-hidden="true">${r}</span>`;
}

export const CLASSE_VERDETTO = {
  'TARGET': 'p-t', 'LASCIA': 'p-l', 'JOLLY 1 CR': 'p-j', 'PREZZO GIUSTO': 'p-g', 'IGNORA': 'p-g',
};

/** Media voto attesa di partenza, dedotta dalla fascia. E' una stima, va corretta a mano. */
export function mvStimata(p) {
  if (p.r === 'P') return { 1: 6.30, 2: 6.15, 3: 6.00, 4: 5.90 }[p.f] ?? 6.0;
  return { 1: 6.30, 2: 6.20, 3: 6.08, 4: 6.00 }[p.f] ?? 6.05;
}
