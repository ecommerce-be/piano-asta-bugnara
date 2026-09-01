/* Le impostazioni, divise in due perché appartengono a due proprietari diversi.
 *
 *   REGOLE DELLA LEGA — crediti, quante squadre, quanti slot per reparto,
 *   carattere del mercato, modificatore di difesa. Sono uguali per tutti
 *   quelli che giocano quell'asta: se io e te ragionassimo su budget diversi,
 *   ogni prezzo consigliato dal sito sarebbe sbagliato per uno dei due.
 *   Stanno nel documento di lega `impostazioni`.
 *
 *   IL TUO PIANO — come dividi TU quei crediti fra i reparti, con che modulo
 *   giochi e con che strategia. Non è affare di nessun altro: è esattamente
 *   quello che non vuoi far leggere agli avversari. Sta nel documento di
 *   squadra `piano`, che il database mostra solo a chi gestisce quella
 *   squadra.
 *
 * Prima stavano insieme in un documento solo, ed era giusto finché il sito lo
 * usavano in due sulla stessa rosa. Con più fantallenatori dentro la stessa
 * lega non lo è più: il piano di spesa di uno è un vantaggio per l'altro.
 *
 * Il database si legge solo da collegati, e le pagine devono funzionare anche
 * prima di entrare. Quindi teniamo una copia nel browser: si aggiorna a ogni
 * lettura riuscita e serve da riserva quando l'accesso non c'è. */
import { pronto, configurato, collegato, inLega, squadra, leggi, scrivi } from './db.js?v=46';

const CHIAVE_LEGA = 'impostazioni';
const CHIAVE_PIANO = 'piano';
const CACHE = 'pianoAsta:cfg:v2';

/** Campi che stanno nelle regole della lega. */
export const CAMPI_SEMPLICI = ['crediti', 'squadre', 'alpha'];
export const CAMPI_PER_RUOLO = ['slot', 'quotaMercato'];

/** Campi che stanno nel piano della squadra. */
export const CAMPI_PIANO = ['piano', 'tettoFrazione'];

export const MODULO_PREDEFINITO = '4-5-1';
export const STRATEGIA_PREDEFINITA = 'totale';

/** Sovrappone quello che è stato salvato ai valori di partenza della lega. */
export function unisci(lega, salvate, mioPiano) {
  const c = structuredClone(lega);
  c.modulo = MODULO_PREDEFINITO;
  c.strategia = STRATEGIA_PREDEFINITA;

  if (salvate) {
    for (const k of CAMPI_SEMPLICI) {
      if (typeof salvate[k] === 'number' && isFinite(salvate[k])) c[k] = salvate[k];
    }
    for (const k of CAMPI_PER_RUOLO) {
      if (salvate[k]) c[k] = { ...c[k], ...salvate[k] };
    }
    if (salvate.modificatoreDifesa) {
      c.modificatoreDifesa = { ...c.modificatoreDifesa, ...salvate.modificatoreDifesa };
    }
  }

  if (mioPiano) {
    for (const k of CAMPI_PIANO) {
      if (mioPiano[k]) c[k] = { ...c[k], ...mioPiano[k] };
    }
    /* accetto il modulo solo se la lega lo consente davvero, altrimenti mezzo
       sito ragionerebbe su una formazione che non si puo' schierare */
    if (mioPiano.modulo && (c.moduli || []).includes(mioPiano.modulo)) c.modulo = mioPiano.modulo;
    if (typeof mioPiano.strategia === 'string') c.strategia = mioPiano.strategia;
  }
  return c;
}

/** Solo le regole di lega, da mandare al documento condiviso. */
export function estraiLega(cfg) {
  const out = {};
  for (const k of CAMPI_SEMPLICI) out[k] = cfg[k];
  for (const k of CAMPI_PER_RUOLO) out[k] = { ...cfg[k] };
  out.modificatoreDifesa = { attivo: cfg.modificatoreDifesa?.attivo !== false };
  return out;
}

/** Solo il tuo piano, da mandare al documento della tua squadra. */
export function estraiPiano(cfg) {
  const out = {};
  for (const k of CAMPI_PIANO) out[k] = { ...cfg[k] };
  out.modulo = cfg.modulo || MODULO_PREDEFINITO;
  out.strategia = cfg.strategia || STRATEGIA_PREDEFINITA;
  return out;
}

/* La cache locale tiene le due metà separate come nel database, così quando
   torni collegato non c'è niente da districare. */
function daCache() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null') || {}; } catch { return {}; }
}
function inCache(parte, dati) {
  try {
    const c = daCache();
    c[parte] = dati;
    localStorage.setItem(CACHE, JSON.stringify(c));
  } catch { /* storage pieno o negato */ }
}

/**
 * Le impostazioni da usare in pagina.
 *
 * Restituisce { cfg, versione, versionePiano, origine, originePiano }, dove
 * le origini dicono da dove arrivano i numeri: 'lega' (i valori di partenza),
 * 'browser' (la copia locale) o 'database'. Serve a poterlo scrivere in
 * pagina: senza, non capisci se quello che vedi lo vedono anche gli altri.
 */
export async function leggiCfg(lega) {
  await pronto();
  const cache = daCache();
  let salvate = cache.lega || null;
  let mioPiano = cache.piano || null;
  let versione = 0, versionePiano = 0;
  let origine = salvate ? 'browser' : 'lega';
  let originePiano = mioPiano ? 'browser' : 'lega';
  let da, aggiornato;

  if (configurato() && collegato() && inLega()) {
    try {
      const r = await leggi(CHIAVE_LEGA, null);
      versione = r.versione;
      if (r.dati) {
        salvate = r.dati; inCache('lega', r.dati);
        origine = 'database'; da = r.da; aggiornato = r.aggiornato;
      }
    } catch { /* rete assente o permessi: si continua con la copia locale */ }

    if (squadra()) {
      try {
        const r = await leggi(CHIAVE_PIANO, null, true);
        versionePiano = r.versione;
        if (r.dati) { mioPiano = r.dati; inCache('piano', r.dati); originePiano = 'database'; }
      } catch { /* idem */ }
    } else {
      originePiano = 'senza-squadra';
    }
  }

  return {
    cfg: unisci(lega, salvate, mioPiano),
    versione, versionePiano, origine, originePiano, da, aggiornato,
  };
}

/** Salva le regole della lega. Le vedranno tutti quelli che ci giocano. */
export async function salvaCfg(cfg, versione) {
  const dati = estraiLega(cfg);
  inCache('lega', dati);
  if (!collegato()) throw new Error('Per salvare le impostazioni devi entrare col tuo account.');
  if (!inLega()) throw new Error('Prima devi entrare in una lega, dalla pagina «La mia lega».');
  const r = await scrivi(CHIAVE_LEGA, dati, versione, (remoto, locale) => locale);
  return r.versione;
}

/** Salva il tuo piano. Lo vede solo chi gestisce la tua squadra. */
export async function salvaPiano(cfg, versione) {
  const dati = estraiPiano(cfg);
  inCache('piano', dati);
  if (!collegato()) throw new Error('Per salvare il piano devi entrare col tuo account.');
  if (!inLega()) throw new Error('Prima devi entrare in una lega, dalla pagina «La mia lega».');
  if (!squadra()) throw new Error('Prima devi scegliere quale squadra gestisci, dalla pagina «La mia lega».');
  const r = await scrivi(CHIAVE_PIANO, dati, versione, (remoto, locale) => locale, true);
  return r.versione;
}
