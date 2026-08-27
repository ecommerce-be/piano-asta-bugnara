/* Il consigliere: quanto vale davvero un giocatore, e quale rosa comprare.
   Sta in un file suo perche' e' l'unica parte del sito che fa un ragionamento
   invece che mostrare dati. Tre pezzi, in ordine:

     1. VALUTAZIONE  quanti punti a stagione ci aspettiamo da ciascuno;
     2. MODIFICATORE quanto rende la difesa, tabellato una volta sola;
     3. COMPOSIZIONE quali 28 comprare, dato il budget e una strategia.

   Nessuna dipendenza esterna: gira nel browser in qualche decimo di secondo. */
import { asta, simulaModificatore, RUOLI } from './app.js?v=34';

const GIORNATE = 38;

/* ═══════════════ 1. quanto vale un giocatore ═══════════════ */

/* Le tre curve del modello, per ruolo: {scarso, forte}. Si legge cosi': il
   peggior difensore del listone gira su 5,90 di media voto, il migliore su
   6,40, e in mezzo si interpola.

   Perche' una curva e non degli scaglioni: con quattro scaglioni tutti i
   difensori buoni finiscono sullo stesso numero, il modificatore si appiattisce
   e l'ottimizzatore non ha nessun motivo per preferire Bremer a un difensore
   qualunque di prima fascia. La realta' e' continua, e serve che lo sia anche
   il modello, altrimenti non sa cosa consigliare. */
const CURVE = {
  //      media voto        bonus per presenza      quota di giornate giocate
  P: { mv: [5.82, 6.46], bonus: [0.00, 0.12], gioca: [0.04, 0.92] },
  D: { mv: [5.88, 6.48], bonus: [0.02, 0.45], gioca: [0.10, 0.90] },
  C: { mv: [5.95, 6.32], bonus: [0.05, 1.00], gioca: [0.10, 0.90] },
  A: { mv: [5.95, 6.28], bonus: [0.10, 1.90], gioca: [0.10, 0.88] },
};

/** Interpolazione fra i due estremi di una curva. */
const fra = ([a, b], t) => a + (b - a) * t;

/**
 * Dove si colloca ciascun giocatore nel suo ruolo, da 0 (l'ultimo) a 1 (il
 * primo). Usiamo la quotazione ufficiale perche' e' l'unico giudizio che non
 * abbiamo scritto noi, e perche' incorpora gia' quello che il mercato sa.
 */
function rangoPerRuolo(players) {
  const rango = new Map();
  for (const r of RUOLI) {
    const lista = players.filter(p => p.r === r).sort((a, b) => a.q - b.q || a.mkt - b.mkt);
    lista.forEach((p, i) => rango.set(p, lista.length > 1 ? i / (lista.length - 1) : 1));
  }
  return rango;
}

/** Quante giornate si sono giocate finora: serve a pesare i dati veri. */
export function giornateGiocate(players) {
  return players.reduce((m, p) => Math.max(m, p.pg || 0), 0);
}

/**
 * Quanto pesano i numeri veri rispetto alla stima di partenza.
 *
 * Alla prima giornata la fantamedia non dice niente — Malen ha 17,5 dopo una
 * tripletta, non e' un giocatore da 17,5 a partita. Serve una media pesata che
 * parta dalla stima e ci si allontani man mano che le partite si accumulano.
 * A 8 giornate i due pesano uguale, a 20 comandano i dati.
 */
const peso = pg => (pg || 0) / ((pg || 0) + 8);

/** Quante giornate salta chi e' fermo, secondo i tempi di rientro. */
function giornatePerse(voce) {
  if (!voce) return 0;
  if (voce.tipo === 'squalifica') return 1;
  if (voce.tipo === 'diffida') return 0.3;
  if (!voce.quando) return 2;            // "da valutare": prudenza, due turni
  const giorni = (new Date(voce.quando) - new Date()) / 86400000;
  return Math.max(0, Math.min(GIORNATE, giorni / 7));
}

/**
 * Attacca a ogni giocatore la sua valutazione. Modifica l'array in posto.
 *
 *   mvAtt   media voto attesa          (serve al modificatore di difesa)
 *   fmAtt   fantamedia attesa          (media voto + bonus attesi)
 *   disp    quota di giornate in cui lo avremo davvero
 *   val     PUNTI SOPRA IL RINCALZO in una stagione
 *
 * L'ultimo e' il numero che conta. Non ha senso dire che un giocatore "vale
 * 240 punti": quei punti li faresti in parte anche schierando un uomo qualsiasi
 * da un credito. Quello che compri davvero e' la differenza.
 */
export function valuta(players, infortuni = new Map()) {
  const giornate = giornateGiocate(players);
  const w = peso(giornate);
  const rango = rangoPerRuolo(players);

  for (const p of players) {
    const c = CURVE[p.r] || CURVE.C;
    const t = rango.get(p) ?? 0.5;

    /* Il coefficiente `mult` e' il giudizio che abbiamo scritto noi nel listone:
       "questo vale piu' di quanto dice la quotazione". Nasce da ragionamenti che
       la quotazione non contiene — la difesa di Gasperini, un rigorista, un
       titolare inamovibile — quindi merita di contare, ma poco: mezzo voto al
       massimo, altrimenti il modello smette di guardare i fatti e guarda noi. */
    const giudizio = 0.06 * Math.max(-0.5, Math.min(1.5, (p.mult ?? 1) - 1));
    const mvVero = (p.pg > 0 && p.mv != null) ? p.mv : null;
    const mvBase = fra(c.mv, t) + giudizio;
    p.mvAtt = mvVero == null ? mvBase : mvBase * (1 - w) + mvVero * w;

    const bonusVero = (p.pg > 0 && p.fm != null && p.mv != null) ? p.fm - p.mv : null;
    p.bonusAtt = bonusVero == null ? fra(c.bonus, t) : fra(c.bonus, t) * (1 - w) + bonusVero * w;

    p.fmAtt = p.mvAtt + p.bonusAtt;
    p.rango = t;

    const perse = giornatePerse(infortuni.get(asta.id(p)));
    p.perse = perse;
    const affidabile = 1 + 0.12 * Math.max(-0.5, Math.min(1.5, (p.mult ?? 1) - 1));
    p.disp = Math.max(0, Math.min(0.95, fra(c.gioca, t) * affidabile) * (GIORNATE - perse) / GIORNATE);
  }

  /* Il "rincalzo" non e' un numero inventato: e' la fantamedia tipica di chi
     compreresti a un credito in quel ruolo. La misuriamo sui giocatori veri. */
  const rincalzo = {};
  for (const r of RUOLI) {
    const scarsi = players.filter(p => p.r === r && (p.rango ?? 1) <= 0.25)
      .map(p => p.fmAtt).sort((a, b) => a - b);
    rincalzo[r] = scarsi.length ? scarsi[Math.floor(scarsi.length / 2)] : 6;
  }

  for (const p of players) {
    p.val = Math.max(0, (p.fmAtt - rincalzo[p.r]) * p.disp * GIORNATE);
  }
  return { rincalzo, giornate, peso: w };
}

/* ═══════════════ 2. il modificatore, tabellato ═══════════════ */

/**
 * Il simulatore Monte Carlo e' preciso ma lento: rifarlo a ogni tentativo
 * dell'ottimizzatore vorrebbe dire aspettare minuti. Lo giriamo UNA volta su
 * una griglia di medie voto e poi interpoliamo: l'ottimizzatore fa migliaia di
 * letture istantanee.
 *
 * L'approssimazione: alimentiamo la simulazione con quattro difensori tutti
 * alla media del gruppo, invece che con i loro voti singoli. Poiche' il
 * modificatore guarda comunque la media dei migliori tre piu' il portiere,
 * l'errore e' piccolo — e la funzione `erroreTabella` qui sotto lo misura.
 */
export function tabellaModificatore(mod, n = 6000) {
  const da = 5.5, fino = 7.3, passo = 0.05, spread = 0.15;
  const tabelle = {};

  /* Costruita alla prima richiesta e poi tenuta: servono 300ms per ogni
     numero di difensori, e in una sessione se ne usano uno o due, non tre. */
  function costruisci(nDif) {
    const punti = [];
    for (let m = da; m <= fino + 1e-9; m += passo) {
      // una difesa vera non ha quattro difensori identici: diamo un minimo di
      // dispersione attorno alla media, che e' quello che si osserva davvero
      const dif = Array.from({ length: nDif }, (_, i) =>
        m + spread * (1 - 2 * i / Math.max(1, nDif - 1)));
      punti.push(simulaModificatore(dif, m, mod, { n }).perGiornata);
    }
    return punti;
  }

  return {
    da, passo, tabelle,
    /**
     * Punti a giornata, data la MEDIA DI TUTTI i difensori schierati piu' il
     * portiere. Che sia la media di tutti e non dei migliori tre non e' un
     * dettaglio: misurato sulle difese vere, l'errore passa da 0,30 a 0,05
     * punti a giornata. Il modificatore guarda i migliori tre, ma chi resta
     * fuori conta lo stesso, perche' e' la riserva che copre gli assenti.
     */
    perGiornata(media, nDif = 4) {
      const k = Math.min(5, Math.max(3, nDif));
      const punti = tabelle[k] || (tabelle[k] = costruisci(k));
      if (!(media > 0)) return 0;
      const x = (media - da) / passo;
      if (x <= 0) return punti[0];
      if (x >= punti.length - 1) return punti[punti.length - 1];
      const i = Math.floor(x), f = x - i;
      return punti[i] * (1 - f) + punti[i + 1] * f;
    },
  };
}

/** Di quanto sbaglia la tabella rispetto alla simulazione vera? Per i test. */
export function erroreTabella(tab, mod, gruppi, n = 60000) {
  let massimo = 0;
  for (const g of gruppi) {
    const media = (g.dif.reduce((a, b) => a + b, 0) + g.por) / (g.dif.length + 1);
    const vero = simulaModificatore(g.dif, g.por, mod, { n }).perGiornata;
    massimo = Math.max(massimo, Math.abs(vero - tab.perGiornata(media, g.dif.length)));
  }
  return massimo;
}

/* ═══════════════ 3. quale rosa comprare ═══════════════ */

/**
 * Le strategie.
 *
 * Ognuna ha due leve, e servono a cose diverse.
 *
 *   `peso` e `pesoMod` cambiano il GIUDIZIO: quanto conta un punto fatto da un
 *   difensore rispetto a uno fatto da un attaccante. Sono ritocchi fini, e da
 *   soli non bastano: i centrocampisti del listone Classic valgono cosi' tanti
 *   punti — sono trequartisti travestiti — che qualunque peso ragionevole
 *   lasciava il grosso dei crediti a centrocampo. Il risultato era che
 *   «Modificatore di difesa» spendeva il 43% a centrocampo e il 21% dietro,
 *   cioe' l'opposto di quello che prometteva l'etichetta.
 *
 *   `tetto` cambia le REGOLE: e' la quota massima di budget che un reparto
 *   puo' assorbire. Non e' un ritocco, e' un vincolo — e siccome
 *   l'ottimizzatore vuole sempre spendere tutto, tappare un reparto spinge i
 *   crediti dove la strategia li vuole. E' anche il modo in cui ragiona una
 *   persona: «dietro non ci metto piu' di un quinto».
 *
 * Regola per chi tocca questi numeri: se cambi un tetto, cambia anche la riga
 * di descrizione. L'etichetta deve dire quello che il codice fa davvero.
 */
export const STRATEGIE = {
  totale: {
    nome: 'Punti totali',
    riga: 'Nessun vincolo: sceglie da solo dove conviene spendere.',
    pesoMod: 1, peso: { P: 1, D: 1, C: 1, A: 1 },
    tetto: null,
  },
  modificatore: {
    nome: 'Modificatore di difesa',
    riga: 'Tetto del 30% a centrocampo e del 20% in attacco: il resto va dietro.',
    pesoMod: 2, peso: { P: 1.25, D: 1.3, C: 1, A: 0.9 },
    tetto: { C: 0.30, A: 0.20 },
  },
  attacco: {
    nome: 'Tutto sull\'attacco',
    riga: 'Porta e difesa al risparmio: massimo un quinto dei crediti dietro.',
    pesoMod: 0.35, peso: { P: 0.85, D: 0.85, C: 1, A: 1.4 },
    /* Niente tetto al centrocampo, di proposito: tappandolo anche quello i
       crediti finivano su attaccanti di PANCHINA, che in un 4-5-1 con un solo
       titolare davanti non scendono mai in campo. Meglio lasciarli andare
       dove producono punti veri. */
    tetto: { P: 0.06, D: 0.16 },
  },
  centrocampo: {
    nome: 'Centrocampo dominante',
    riga: 'Porta, difesa e attacco tappati: metà dei crediti va a centrocampo.',
    pesoMod: 1, peso: { P: 1, D: 1, C: 1.35, A: 0.9 },
    tetto: { P: 0.08, D: 0.20, A: 0.24 },
  },
};

/* Il metro di paragone onesto: nessun reparto vale piu' di un altro, e il
   modificatore conta per quello che rende davvero. Serve per i numeri che
   finiscono a schermo, uguali per tutte le strategie. */
const NEUTRA = { pesoMod: 1, peso: { P: 1, D: 1, C: 1, A: 1 } };

const prezzoDi = p => Math.max(1, Math.round(p.mkt));

/** Quanti titolari per reparto, leggendo il modulo. */
export function titolariDi(modulo) {
  const [d, c, a] = modulo.split('-').map(Number);
  return { P: 1, D: d, C: c, A: a };
}

/**
 * Punti attesi di una rosa, che e' la funzione che l'ottimizzatore cerca di
 * far salire. Contano soprattutto i titolari; la panchina vale meno ma non
 * zero, perche' copre gli assenti.
 */
function puntiRosa(sel, titolari, cfg, tab, strat) {
  let punti = 0;
  const mod = cfg.modificatoreDifesa;

  for (const r of RUOLI) {
    const ordinati = [...sel[r]].sort((x, y) => y.val - x.val);
    const n = Math.min(titolari[r], ordinati.length);
    for (let i = 0; i < ordinati.length; i++) {
      punti += ordinati[i].val * (strat.peso[r] ?? 1) * (i < n ? 1 : 0.18);
    }
  }

  /* modificatore: media dei migliori difensori schierati, piu' il portiere */
  if (mod?.attivo && titolari.D >= mod.minDifensori && sel.D.length >= mod.minDifensori && sel.P.length) {
    const dif = [...sel.D].sort((x, y) => y.val - x.val).slice(0, titolari.D).map(p => p.mvAtt);
    const por = Math.max(...sel.P.map(p => p.mvAtt));
    const pezzi = mod.includiPortiere ? dif.concat([por]) : dif;
    const media = pezzi.reduce((a, b) => a + b, 0) / pezzi.length;
    punti += tab.perGiornata(media, dif.length) * GIORNATE * strat.pesoMod;
  }
  return punti;
}

const costoRosa = sel => RUOLI.reduce((t, r) => t + sel[r].reduce((s, p) => s + prezzoDi(p), 0), 0);

/**
 * Compone la rosa.
 *
 * Il problema — massimizzare i punti spendendo al massimo N crediti, con un
 * numero fisso di slot per reparto — e' uno zaino a piu' dimensioni, e la
 * soluzione esatta costerebbe troppo. Facciamo cosi': si parte dalla rosa piu'
 * economica possibile, tutti da un credito, e si compra un miglioramento alla
 * volta, ogni volta quello che rende di piu' per ogni credito speso. E' lo
 * stesso ragionamento che faresti tu all'asta con la lista in mano.
 */
export function componiRosa({ players, cfg, modulo, strategia = 'totale', tab,
                              bloccati = [], esclusi = new Set(), maxCandidati = 45 }) {
  const strat = STRATEGIE[strategia] || STRATEGIE.totale;
  const titolari = titolariDi(modulo);
  const budget = cfg.crediti;

  const perRuolo = {};
  for (const r of RUOLI) {
    perRuolo[r] = players.filter(p => p.r === r && !esclusi.has(asta.id(p)))
      .sort((a, b) => b.val - a.val);
  }

  const bloccato = new Set(bloccati.map(p => asta.id(p)));

  /* Due punti di partenza diversi, perche' la ricerca a scambi migliora
     sempre e non torna mai indietro: da dove parte decide in che "valle"
     finisce. Uno parte dalla rosa piu' economica possibile, l'altro dai
     giocatori che rendono di piu' per credito. Tengo quella che finisce
     meglio. */
  const semi = [
    (a, b) => prezzoDi(a) - prezzoDi(b) || b.val - a.val,          // tutti da un credito
    (a, b) => b.val / prezzoDi(b) - a.val / prezzoDi(a),           // miglior resa per credito
  ];

  let sel, costo, punti, passi;

  for (const ordine of semi) {
    const start = {};
    for (const r of RUOLI) {
      const fissi = bloccati.filter(p => p.r === r).slice(0, cfg.slot[r]);
      const resto = perRuolo[r].filter(p => !fissi.includes(p)).slice().sort(ordine);
      start[r] = fissi.concat(resto.slice(0, cfg.slot[r] - fissi.length));
    }
    /* un seme puo' nascere gia' fuori budget: in quel caso lo riporto dentro
       sostituendo i piu' cari col piu' economico rimasto */
    while (costoRosa(start) > budget) {
      let peggio = null;
      for (const r of RUOLI) {
        for (let i = 0; i < start[r].length; i++) {
          if (bloccato.has(asta.id(start[r][i]))) continue;
          if (!peggio || prezzoDi(start[r][i]) > prezzoDi(start[peggio.r][peggio.i])) peggio = { r, i };
        }
      }
      if (!peggio) break;
      const dentro = new Set(start[peggio.r].map(p => asta.id(p)));
      const rimpiazzo = perRuolo[peggio.r]
        .filter(p => !dentro.has(asta.id(p)))
        .sort((a, b) => prezzoDi(a) - prezzoDi(b) || b.val - a.val)[0];
      if (!rimpiazzo || prezzoDi(rimpiazzo) >= prezzoDi(start[peggio.r][peggio.i])) break;
      start[peggio.r][peggio.i] = rimpiazzo;
    }

    const esito = migliora(start, perRuolo, bloccato, titolari, cfg, tab, strat, budget, maxCandidati);
    if (!sel || esito.punti > punti) ({ sel, costo, punti, passi } = esito);
  }

  return riepiloga(sel, costo, punti, passi, titolari, cfg, tab, strat, modulo, budget);
}

/** La ricerca vera e propria: uno scambio alla volta, sempre il piu' redditizio. */
function migliora(iniziale, perRuolo, bloccato, titolari, cfg, tab, strat, budget, maxCandidati) {
  const sel = {};
  for (const r of RUOLI) sel[r] = iniziale[r].slice();

  let costo = costoRosa(sel);
  let punti = puntiRosa(sel, titolari, cfg, tab, strat);
  const passi = [];

  /* Il tetto di reparto della strategia, tradotto in crediti. Un reparto che
     lo sfora non puo' piu' crescere: e' cosi' che i crediti finiscono dove la
     strategia li vuole invece che dove il modello li porterebbe da solo. */
  const tetto = {};
  for (const r of RUOLI) {
    tetto[r] = strat.tetto?.[r] != null ? strat.tetto[r] * budget : Infinity;
  }
  const spesaDi = r => sel[r].reduce((s, p) => s + prezzoDi(p), 0);

  /* Un seme puo' nascere gia' sopra il tetto di un reparto — quello "miglior
     resa per credito" ci finisce spesso. La ricerca accetta solo scambi che
     migliorano, quindi da sola non scenderebbe mai: qui il reparto si sgonfia
     sostituendo i piu' cari col piu' economico rimasto, finche' non rientra. */
  for (const r of RUOLI) {
    let giri = 0;
    while (spesaDi(r) > tetto[r] && giri++ < 60) {
      let peggio = -1;
      for (let i = 0; i < sel[r].length; i++) {
        if (bloccato.has(asta.id(sel[r][i]))) continue;
        if (peggio < 0 || prezzoDi(sel[r][i]) > prezzoDi(sel[r][peggio])) peggio = i;
      }
      if (peggio < 0) break;
      const dentro = new Set(sel[r].map(p => asta.id(p)));
      const rimpiazzo = perRuolo[r].filter(p => !dentro.has(asta.id(p)))
        .sort((a, b) => prezzoDi(a) - prezzoDi(b) || b.val - a.val)[0];
      if (!rimpiazzo || prezzoDi(rimpiazzo) >= prezzoDi(sel[r][peggio])) break;
      sel[r][peggio] = rimpiazzo;
    }
  }

  const speso = {};
  for (const r of RUOLI) speso[r] = spesaDi(r);
  costo = costoRosa(sel);
  punti = puntiRosa(sel, titolari, cfg, tab, strat);

  for (let giro = 0; giro < 400; giro++) {
    let migliore = null;

    for (const r of RUOLI) {
      const dentro = new Set(sel[r].map(p => asta.id(p)));
      const candidati = perRuolo[r].slice(0, maxCandidati).filter(p => !dentro.has(asta.id(p)));

      for (let i = 0; i < sel[r].length; i++) {
        const esce = sel[r][i];
        if (bloccato.has(asta.id(esce))) continue;

        for (const entra of candidati) {
          const dCosto = prezzoDi(entra) - prezzoDi(esce);
          if (costo + dCosto > budget) continue;
          if (speso[r] + dCosto > tetto[r]) continue;

          const prova = { ...sel, [r]: sel[r].map((p, k) => (k === i ? entra : p)) };
          const dPunti = puntiRosa(prova, titolari, cfg, tab, strat) - punti;
          if (dPunti <= 0.001) continue;

          // resa per credito: a parita' di punti guadagnati vince chi costa meno
          const resa = dPunti / Math.max(1, dCosto);
          if (!migliore || resa > migliore.resa) migliore = { r, i, entra, esce, dCosto, dPunti, resa };
        }
      }
    }

    if (!migliore) break;
    sel[migliore.r][migliore.i] = migliore.entra;
    costo += migliore.dCosto;
    speso[migliore.r] += migliore.dCosto;
    punti += migliore.dPunti;
    passi.push(migliore);
  }

  return { sel, costo, punti, passi };
}

/** Mette in bella copia il risultato: reparti, spese, punti mostrabili. */
function riepiloga(sel, costo, punti, passi, titolari, cfg, tab, strat, modulo, budget) {
  /* riepilogo per reparto, e conto separato del modificatore */
  const reparti = {};
  for (const r of RUOLI) {
    sel[r].sort((a, b) => b.val - a.val);
    reparti[r] = {
      spesa: sel[r].reduce((s, p) => s + prezzoDi(p), 0),
      titolari: titolari[r],
      punti: sel[r].slice(0, titolari[r]).reduce((s, p) => s + p.val, 0),
    };
  }

  /* I punti che mostro sono sempre pesati NEUTRI, mai con i pesi della
     strategia. Altrimenti "centrocampo" sembrerebbe la scelta migliore solo
     perche' conta i centrocampisti una volta e mezza: i pesi servono a
     orientare la ricerca, non a gonfiare il punteggio finale. */
  const senzaMod = puntiRosa(sel, titolari, cfg, { perGiornata: () => 0 }, NEUTRA);
  const conMod = puntiRosa(sel, titolari, cfg, tab, NEUTRA);

  return {
    rosa: sel, costo, avanzo: budget - costo, reparti, passi: passi.length,
    strategia: strat, modulo, titolari,
    puntiTitolari: senzaMod,
    puntiModificatore: Math.max(0, conMod - senzaMod),
    prezzo: prezzoDi,
  };
}
