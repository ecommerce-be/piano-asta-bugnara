/* L'asta della lega: un archivio solo, nel database.
 *
 * PERCHE' ESISTE QUESTO FILE
 *
 * Fino a ieri lo stesso fatto — «Bremer e' andato a me per 22» — era scritto
 * in tre posti diversi: nel `localStorage` di questo browser, in un documento
 * per utente (`asta:<id>`) e nelle rose delle fantasquadre. Tre archivi della
 * stessa cosa vuol dire, prima o poi, tre risposte diverse: Aurelio apriva il
 * listone e lo vedeva vergine, tu cambiavi computer e ripartivi da zero
 * crediti spesi, e ogni tanto compariva il badge «non registrato», che era
 * esattamente la spia di due archivi che avevano divergito.
 *
 * Adesso ce n'e' uno: il documento di lega `fantasquadre`, che gia' conteneva
 * chi ha preso chi e a quanto. Tutto il resto si DEDUCE da li':
 *
 *   i miei acquisti  = la rosa della squadra che gestisco
 *   fuori mercato    = le rose delle altre squadre, piu' i giocatori segnati
 *                      come presi senza dire da chi
 *
 * Cosi' non c'e' piu' niente da tenere allineato: non esiste un secondo posto
 * che possa dire il contrario.
 *
 * LE AGGIUDICAZIONI SONO DI TUTTA LA LEGA, di proposito: al tavolo lo sono
 * comunque, e servono a farsi i conti su chi ha ancora crediti in mano. Il
 * piano di spesa e la bozza restano invece documenti di squadra, e nessun
 * altro li legge.
 */
import {
  pronto, configurato, collegato, inLega, lega, squadra, utente,
  leggi, scrivi, osserva,
} from './db.js?v=38';

export const CHIAVE = 'fantasquadre';
const VUOTO = { squadre: [], fuori: {}, liberati: {} };

const adesso = () => new Date().toISOString();
const chi = () => utente()?.nome || 'anonimo';

let dati = structuredClone(VUOTO);
let versione = 0;
let meta = { nuovo: true, da: '', aggiornato: '' };

/* ---------- forma del documento ----------
 *
 * {
 *   squadre: [{ id, nome, proprietario,
 *               rosa: [{ id, n, sq, r, prezzo, il, chi }],
 *               tolti: { "<id giocatore>": "<quando>" },
 *               quando, chi }],
 *   fuori:    { "<id giocatore>": "<quando>" },   // preso, ma non si sa da chi
 *   liberati: { "<id giocatore>": "<quando>" }    // rimesso sul mercato
 * }
 *
 * `tolti` e `liberati` sono lapidi: servono a far sopravvivere una rimozione
 * all'unione con la versione di chi ha salvato nel frattempo. Senza, chi
 * toglie un giocatore se lo vede ricomparire appena l'altro salva. */

function normalizza(d) {
  const o = d && typeof d === 'object' ? d : {};
  return {
    ...o,
    squadre: (Array.isArray(o.squadre) ? o.squadre : []).map(s => ({
      ...s,
      rosa: Array.isArray(s.rosa) ? s.rosa : [],
      tolti: s.tolti && typeof s.tolti === 'object' ? s.tolti : {},
    })),
    fuori: o.fuori && typeof o.fuori === 'object' ? o.fuori : {},
    liberati: o.liberati && typeof o.liberati === 'object' ? o.liberati : {},
  };
}

/* ---------- lettura dello stato ---------- */

export const documento = () => dati;
export const versioneAsta = () => versione;
export const metaAsta = () => meta;
export const squadreAsta = () => dati.squadre;

/** La squadra che gestisco, dentro questo documento. Lo dice il database. */
export function miaSquadra() {
  const mia = squadra();
  return mia ? dati.squadre.find(s => s.id === mia.id) || null : null;
}

/** Un giocatore e' segnato preso senza dire da chi? */
const eFuori = gid =>
  Boolean(dati.fuori[gid]) && dati.fuori[gid] > (dati.liberati[gid] || '');

/**
 * Lo stato dell'asta come lo vogliono le pagine: quanto ho pagato io, e chi
 * non e' piu' sul mercato. Non e' salvato da nessuna parte — si ricava ogni
 * volta dalle rose, quindi non puo' divergere.
 */
export function statoAsta() {
  const mia = {};
  const altrui = new Set();
  const idMia = squadra()?.id || null;
  for (const s of dati.squadre) {
    for (const g of s.rosa) {
      if (idMia && s.id === idMia) mia[g.id] = Number(g.prezzo) || 0;
      else altrui.add(g.id);
    }
  }
  for (const gid of Object.keys(dati.fuori)) {
    if (eFuori(gid) && !(gid in mia)) altrui.add(gid);
  }
  return { mia, altrui };
}

/** Chi possiede questo giocatore: { squadra, prezzo } oppure null. */
export function possessore(gid) {
  for (const s of dati.squadre) {
    const g = s.rosa.find(x => x.id === gid);
    if (g) return { squadra: s, prezzo: Number(g.prezzo) || 0 };
  }
  return null;
}

/** Segnato preso ma senza proprietario. */
export const fuoriMercato = gid => !possessore(gid) && eFuori(gid);

/* ---------- quanto può ancora offrire ognuno ----------
 *
 * E' il conto che decide se rilanciare, e nessuno lo fa a mente al tavolo.
 * Una squadra con 40 crediti e 9 slot ancora da riempire non può offrirne 40:
 * deve tenere un credito per ognuno degli altri otto slot, quindi il suo tetto
 * vero è 32. Sapere che l'avversario si ferma per forza a 32 cambia
 * completamente come rilanci — e vale anche al contrario, perché è lo stesso
 * conto che dice quanto puoi permetterti tu.
 *
 * L'altra faccia della stessa cosa: chi ha esattamente un credito per slot è
 * «obbligato», non può più competere su niente. Da quel momento quei crediti
 * non sono più concorrenza.
 */
export function situazione(cfg) {
  const RUOLI = ['P', 'D', 'C', 'A'];
  const idMia = squadra()?.id || null;

  return dati.squadre.map(s => {
    const speso = s.rosa.reduce((a, g) => a + (Number(g.prezzo) || 0), 0);
    const residuo = cfg.crediti - speso;
    const presi = Object.fromEntries(RUOLI.map(r => [r, s.rosa.filter(g => g.r === r).length]));
    const liberi = Object.fromEntries(RUOLI.map(r => [r, Math.max(0, cfg.slot[r] - presi[r])]));
    const slotLiberi = RUOLI.reduce((a, r) => a + liberi[r], 0);

    /* il tetto vero: quello che resta, meno un credito per ogni altro slot */
    const max = slotLiberi > 0 ? Math.max(0, residuo - (slotLiberi - 1)) : 0;

    return {
      id: s.id, nome: s.nome, mia: s.id === idMia,
      speso, residuo, presi, liberi, slotLiberi, max,
      completa: slotLiberi === 0,
      obbligata: slotLiberi > 0 && max <= 1,
    };
  }).sort((a, b) => b.max - a.max);
}

/* ---------- unione di due versioni ----------
 *
 * Durante l'asta salvate in due, a pochi secondi di distanza. Se l'unione
 * fosse «vince l'ultimo che ha salvato», il primo perderebbe l'acquisto
 * appena segnato. Qui si unisce giocatore per giocatore, e per ognuno vince
 * il gesto piu' recente — che sia un acquisto o una rimozione. */

const piuRecente = (a, b) => ((a || '') >= (b || '') ? a || '' : b || '');

function unisciMappe(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = piuRecente(out[k], v);
  return out;
}

export function fondi(remoto, locale) {
  const r = normalizza(remoto);
  const l = normalizza(locale);

  const perId = new Map();
  for (const s of r.squadre) perId.set(s.id, s);

  const squadre = [];
  const visti = new Set();
  for (const s of [...l.squadre, ...r.squadre]) {
    if (visti.has(s.id)) continue;
    visti.add(s.id);
    squadre.push(unisciSquadra(perId.get(s.id), l.squadre.find(x => x.id === s.id)));
  }

  const fuori = unisciMappe(r.fuori, l.fuori);
  const liberati = unisciMappe(r.liberati, l.liberati);

  /* Un giocatore assegnato a una squadra non e' anche «fuori mercato»:
     l'assegnazione e' l'informazione piu' precisa delle due. */
  const assegnati = new Set(squadre.flatMap(s => s.rosa.map(g => g.id)));
  for (const gid of assegnati) delete fuori[gid];

  return { ...l, squadre, fuori, liberati };
}

function unisciSquadra(remota, locale) {
  const base = remota || locale;
  if (!remota || !locale) {
    return { ...base, rosa: base.rosa || [], tolti: base.tolti || {} };
  }
  const tolti = unisciMappe(remota.tolti, locale.tolti);

  const perGioc = new Map();
  for (const g of remota.rosa) perGioc.set(g.id, g);
  for (const g of locale.rosa) {
    const e = perGioc.get(g.id);
    if (!e || (g.il || '') >= (e.il || '')) perGioc.set(g.id, g);
  }

  const rosa = [...perGioc.values()].filter(g => !(tolti[g.id] > (g.il || '')));

  /* nome e gestori li riscrive comunque la tabella della lega */
  const recente = (locale.quando || '') >= (remota.quando || '') ? locale : remota;
  return { ...recente, rosa, tolti };
}

/* ---------- carica e salva ---------- */

/**
 * Legge l'asta dal database. Senza account o senza lega non e' un errore:
 * restituisce un'asta vuota, cosi' le pagine di sola consultazione
 * (fasce, infortunati) continuano a funzionare da sole.
 */
export async function caricaAsta() {
  await pronto();
  if (!configurato() || !collegato() || !inLega()) {
    dati = structuredClone(VUOTO);
    versione = 0;
    meta = { nuovo: true, da: '', aggiornato: '', assente: true };
    return { dati, versione, meta };
  }
  const r = await leggi(CHIAVE, structuredClone(VUOTO));
  dati = normalizza(r.dati);
  versione = r.versione;
  meta = { nuovo: Boolean(r.nuovo), da: r.da || '', aggiornato: r.aggiornato || '' };
  recuperaSospeso();
  return { dati, versione, meta };
}

/** Applica al documento in memoria quello che e' arrivato dal controllo periodico. */
export function accetta(r) {
  /* Se ho roba non ancora salvata, quello che arriva non la deve cancellare:
     si uniscono, come si farebbe salvando. */
  dati = daSalvare ? fondi(r.dati, dati) : normalizza(r.dati);
  versione = r.versione;
  meta = { nuovo: false, da: r.da || '', aggiornato: r.aggiornato || '' };
  return dati;
}

export const osservaAsta = (alCambio, intervallo = 8000) =>
  osserva(CHIAVE, () => versione, alCambio, intervallo);

/* ═══════════ il salvataggio, che al tavolo non deve tradire ═══════════
 *
 * All'asta la rete e' quella che e': il telefono in tethering, il wifi di casa
 * di qualcun altro, dieci persone collegate. Prima di questo blocco, un
 * salvataggio fallito restava fallito — lo schermo mostrava l'acquisto, il
 * database non ce l'aveva, e bastava ricaricare la pagina per perderlo.
 *
 * Adesso tre cose, in ordine di importanza:
 *
 *   1. ogni modifica finisce SUBITO in una copia di scorta in questo browser,
 *      prima ancora di provare a mandarla. Ricaricare non perde niente.
 *   2. se il salvataggio non riesce, si ritenta da solo, aspettando sempre un
 *      po' di piu' — senza martellare la rete che gia' non va.
 *   3. la pagina puo' chiedere quanti gesti non sono ancora arrivati, e dirlo
 *      in faccia invece di lasciar credere che sia tutto a posto.
 *
 * La copia di scorta non e' un secondo archivio: e' lo stesso documento in
 * attesa di partire, e appena parte sparisce. */

const SCORTA = 'pianoAsta:asta-da-mandare';

let daSalvare = 0;          // gesti fatti e non ancora arrivati al database
let ultimoErrore = '';
let inCorso = false;
let timerRitenta = null;
let attesa = 0;             // quanto aspetto prima del prossimo tentativo
let passo = 0;              // a che punto sono della scaletta qui sotto

/* Si aspetta sempre un po' di piu': se la rete e' giu' non ha senso
   martellarla, e se torna su il primo tentativo utile arriva comunque
   entro mezzo minuto. */
const RITENTI = [2000, 5000, 10000, 20000, 30000];

const ascoltatori = new Set();
export function alSalvataggio(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
const avvisa = () => { for (const f of ascoltatori) { try { f(inSospeso()); } catch { /* una barra rotta non ferma le altre */ } } };

/** Com'e' messo il salvataggio, per chi lo deve mostrare. */
export const inSospeso = () => ({
  quanti: daSalvare,
  errore: ultimoErrore,
  inCorso,
  ritentoFra: timerRitenta ? Math.round(attesa / 1000) : 0,
});

/** Segna che c'e' qualcosa da mandare, e mettilo al sicuro subito. */
function daMandare() {
  daSalvare++;
  scriviScorta();
  avvisa();
}

function scriviScorta() {
  try {
    localStorage.setItem(SCORTA, JSON.stringify({
      lega: lega()?.id || null, versione, dati, quanti: daSalvare, il: adesso(),
    }));
  } catch { /* storage pieno o non disponibile: pazienza, resta in memoria */ }
}

function buttaScorta() {
  try { localStorage.removeItem(SCORTA); } catch { /* niente da fare */ }
}

/**
 * Riprende quello che era rimasto in canna.
 *
 * Succede se hai chiuso la pagina — o ti si e' scaricato il telefono — mentre
 * un salvataggio non era ancora andato. Quello che c'era si unisce a quello
 * che nel frattempo ha scritto il database, senza sovrascriverlo, e riparte.
 */
function recuperaSospeso() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SCORTA) || 'null'); } catch { s = null; }
  if (!s?.dati || s.lega !== lega()?.id) return;
  dati = fondi(dati, normalizza(s.dati));
  daSalvare = Math.max(1, Number(s.quanti) || 1);
  avvisa();
  programmaRitento(true);
}

export async function salvaAsta() {
  if (!collegato()) throw new Error('Per segnare gli acquisti devi entrare col tuo account.');
  if (!inLega()) throw new Error('Prima devi entrare in una lega, dalla pagina «La mia lega».');

  clearTimeout(timerRitenta);
  timerRitenta = null;
  inCorso = true;
  avvisa();
  const quantiAllora = daSalvare;

  try {
    const r = await scrivi(CHIAVE, dati, versione, fondi);
    versione = r.versione;
    if (r.fuso) dati = normalizza(r.dati);
    /* se nel frattempo hai segnato altro, quello resta da mandare */
    daSalvare = Math.max(0, daSalvare - quantiAllora);
    ultimoErrore = '';
    attesa = 0;
    passo = 0;
    inCorso = false;
    if (daSalvare) scriviScorta(); else buttaScorta();
    avvisa();
    return r;
  } catch (e) {
    inCorso = false;
    ultimoErrore = e.message;
    if (!daSalvare) daSalvare = 1;     // c'era comunque qualcosa da mandare
    scriviScorta();
    programmaRitento();
    avvisa();
    throw e;
  }
}

/** Riprova da solo, aspettando ogni volta un po' di piu'. */
function programmaRitento(subito = false) {
  clearTimeout(timerRitenta);
  attesa = subito ? 500 : RITENTI[Math.min(passo++, RITENTI.length - 1)];
  timerRitenta = setTimeout(async () => {
    timerRitenta = null;
    if (!daSalvare) return;
    try { await salvaAsta(); } catch { /* riprovera' da solo */ }
  }, attesa);
  avvisa();
}

/** Riprova adesso, perche' l'ha chiesto qualcuno. */
export async function ritentaOra() {
  passo = 0;
  return salvaAsta();
}

/* ---------- le tre cose che si fanno durante l'asta ---------- */

function tocca(s) {
  s.quando = adesso();
  s.chi = chi();
}

/** Aggiudica un giocatore a una squadra. `p` e' la scheda dal listone. */
export function assegna(gid, idSquadra, prezzo, p) {
  const s = dati.squadre.find(x => x.id === idSquadra);
  if (!s) throw new Error('Quella squadra non esiste piu\': ricarica la pagina.');
  const il = adesso();
  scollega(gid, il);
  s.rosa.push({
    id: gid, n: p?.n || gid.split('|')[1] || gid, sq: p?.sq || gid.split('|')[2] || '',
    r: p?.r || gid.split('|')[0] || '', prezzo: Math.max(0, Number(prezzo) || 0),
    il, chi: chi(),
  });
  tocca(s);
  daMandare();
  return s;
}

/** Segna un giocatore come preso, senza registrare da chi. */
export function segnaFuori(gid) {
  const il = adesso();
  scollega(gid, il);
  dati.fuori[gid] = il;
  delete dati.liberati[gid];
  daMandare();
}

/** Rimette un giocatore sul mercato, da qualunque squadra venisse. */
export function libera(gid) {
  const il = adesso();
  const q = possessore(gid);
  scollega(gid, il);
  dati.liberati[gid] = il;
  delete dati.fuori[gid];
  daMandare();
  return q;
}

/** Toglie il giocatore da dove si trovava, lasciando la lapide. */
function scollega(gid, il) {
  for (const s of dati.squadre) {
    if (!s.rosa.some(g => g.id === gid)) continue;
    s.rosa = s.rosa.filter(g => g.id !== gid);
    s.tolti[gid] = il;
    tocca(s);
  }
  if (dati.fuori[gid]) { delete dati.fuori[gid]; dati.liberati[gid] = il; }
}

/** Svuota la rosa di una squadra: i suoi giocatori tornano tutti sul mercato. */
export function svuota(idSquadra) {
  const s = dati.squadre.find(x => x.id === idSquadra);
  if (!s) return 0;
  const quanti = s.rosa.length;
  const il = adesso();
  for (const g of s.rosa) { s.tolti[g.id] = il; dati.liberati[g.id] = il; }
  s.rosa = [];
  tocca(s);
  daMandare();
  return quanti;
}

/**
 * Allinea nomi e gestori alla tabella della lega.
 *
 * Qui dentro restano solo le rose: il nome della squadra e chi la gestisce
 * stanno in `squadre` e `membri`, dove decide il database chi vede cosa. Cosi'
 * due pagine non possono dire due nomi diversi per la stessa squadra.
 */
export function allineaAllaLega(tabella, membri) {
  if (!tabella?.length) return false;
  const gestori = id => membri.filter(m => m.squadra_id === id)
    .map(m => m.nome || 'senza nome').join(' e ');
  const esistenti = new Map(dati.squadre.map(s => [s.id, s]));
  dati.squadre = tabella.map(x => ({
    ...(esistenti.get(x.id) || { id: x.id, rosa: [], tolti: {} }),
    id: x.id, nome: x.nome, proprietario: gestori(x.id),
  }));
  return true;
}

/* ---------- recupero di quello che c'era prima ----------
 *
 * Chi ha usato il sito prima di oggi ha gli acquisti nel `localStorage` di un
 * browser, o nel vecchio documento per utente. Non li buttiamo via in
 * silenzio: la pagina li propone e li porta dentro solo se glielo dici tu. */

const VECCHIA_MIA = 'pianoAsta:v1';
const VECCHIA_ALTRUI = 'pianoAsta:altrui:v1';
const VECCHIA_VER = 'pianoAsta:astaVer';

function daBrowser() {
  const leggiJ = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  return { mia: leggiJ(VECCHIA_MIA) || {}, altrui: leggiJ(VECCHIA_ALTRUI) || [] };
}

/**
 * Cosa c'e' da recuperare, fra browser e vecchio documento per utente, che
 * l'asta condivisa non sa gia'. Restituisce null se non c'e' niente.
 */
export async function daRecuperare() {
  let { mia, altrui } = daBrowser();
  if (!Object.keys(mia).length && !altrui.length && collegato() && inLega()) {
    try {
      const r = await leggi('asta:' + utente().id, null);
      if (r.dati) { mia = r.dati.mia || {}; altrui = r.dati.altrui || []; }
    } catch { /* il vecchio documento non c'e': tanto meglio */ }
  }
  const noti = statoAsta();
  const acquisti = Object.entries(mia)
    .filter(([gid]) => !(gid in noti.mia) && !noti.altrui.has(gid))
    .map(([gid, prezzo]) => ({ gid, prezzo: Number(prezzo) || 0 }));
  const fuori = altrui.filter(gid => !(gid in noti.mia) && !noti.altrui.has(gid));
  if (!acquisti.length && !fuori.length) return null;
  return { acquisti, fuori };
}

/** Porta dentro il recupero, nella squadra che gestisco. */
export function recupera(recupero, perId = {}) {
  const mia = miaSquadra();
  if (!mia) throw new Error('Prima scegli quale squadra gestisci, dalla pagina «La mia lega».');
  for (const a of recupero.acquisti) assegna(a.gid, mia.id, a.prezzo, perId[a.gid]);
  for (const gid of recupero.fuori) segnaFuori(gid);
  return recupero.acquisti.length + recupero.fuori.length;
}

/** Dimentica gli archivi vecchi: da qui in poi comanda il database. */
export function scordaVecchi() {
  for (const k of [VECCHIA_MIA, VECCHIA_ALTRUI, VECCHIA_VER]) {
    try { localStorage.removeItem(k); } catch { /* storage non disponibile */ }
  }
}
