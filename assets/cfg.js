/* Le impostazioni d'asta: crediti, squadre, slot, carattere del mercato.
   Sono le REGOLE DELLA LEGA, non una preferenza personale, quindi stanno nel
   database e valgono per tutti e due. Se io e te lavorassimo su budget diversi,
   ogni prezzo consigliato dal sito sarebbe sbagliato per uno dei due.

   Il database però si legge solo da collegati, e le pagine devono funzionare
   anche prima di entrare. Quindi teniamo una copia nel browser: si aggiorna a
   ogni lettura riuscita e serve da riserva quando l'accesso non c'è. */
import { avvia, configurato, collegato, leggi, scrivi } from './db.js?v=31';

const CHIAVE = 'impostazioni';
const CACHE = 'pianoAsta:cfg:v1';

/** I campi che si possono cambiare. Il resto di league.json resta com'è. */
export const CAMPI_SEMPLICI = ['crediti', 'squadre', 'alpha'];
export const CAMPI_PER_RUOLO = ['slot', 'quotaMercato', 'piano', 'tettoFrazione'];

/* Il modulo e la strategia stanno qui e non in un angolo del browser perche'
   decidono cosa scrive la guida, quale rosa consiglia il consigliere e come si
   divide il piano di spesa. Se stessero in tre posti diversi, tre pagine
   direbbero tre cose diverse — che e' esattamente il refuso da evitare. */
export const MODULO_PREDEFINITO = '4-5-1';
export const STRATEGIA_PREDEFINITA = 'totale';

/** Sovrappone le impostazioni salvate ai valori di partenza della lega. */
export function unisci(lega, salvate) {
  const c = structuredClone(lega);
  c.modulo = MODULO_PREDEFINITO;
  c.strategia = STRATEGIA_PREDEFINITA;
  if (!salvate) return c;
  for (const k of CAMPI_SEMPLICI) {
    if (typeof salvate[k] === 'number' && isFinite(salvate[k])) c[k] = salvate[k];
  }
  for (const k of CAMPI_PER_RUOLO) {
    if (salvate[k]) c[k] = { ...c[k], ...salvate[k] };
  }
  if (salvate.modificatoreDifesa) {
    c.modificatoreDifesa = { ...c.modificatoreDifesa, ...salvate.modificatoreDifesa };
  }
  /* accetto il modulo solo se la lega lo consente davvero, altrimenti mezzo
     sito ragionerebbe su una formazione che non si puo' schierare */
  if (salvate.modulo && (c.moduli || []).includes(salvate.modulo)) c.modulo = salvate.modulo;
  if (typeof salvate.strategia === 'string') c.strategia = salvate.strategia;
  return c;
}

/** Solo i campi modificabili, da mandare al database. */
export function estrai(cfg) {
  const out = {};
  for (const k of CAMPI_SEMPLICI) out[k] = cfg[k];
  for (const k of CAMPI_PER_RUOLO) out[k] = { ...cfg[k] };
  out.modificatoreDifesa = { attivo: cfg.modificatoreDifesa?.attivo !== false };
  out.modulo = cfg.modulo || MODULO_PREDEFINITO;
  out.strategia = cfg.strategia || STRATEGIA_PREDEFINITA;
  return out;
}

function daCache() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
}
function inCache(salvate) {
  try { localStorage.setItem(CACHE, JSON.stringify(salvate)); } catch { /* storage pieno o negato */ }
}

/**
 * Le impostazioni da usare in pagina.
 * Restituisce { cfg, versione, origine } dove origine dice da dove arrivano:
 * 'lega' (i valori di partenza), 'browser' (la copia locale) o 'database'.
 */
export async function leggiCfg(lega) {
  await avvia();
  if (configurato() && collegato()) {
    try {
      const r = await leggi(CHIAVE, null);
      if (r.dati) {
        inCache(r.dati);
        return { cfg: unisci(lega, r.dati), versione: r.versione, origine: 'database', da: r.da, aggiornato: r.aggiornato };
      }
      return { cfg: unisci(lega, daCache()), versione: r.versione, origine: daCache() ? 'browser' : 'lega' };
    } catch { /* rete assente o permessi: si continua con la copia locale */ }
  }
  const locali = daCache();
  return { cfg: unisci(lega, locali), versione: 0, origine: locali ? 'browser' : 'lega' };
}

/** Salva nel database, e aggiorna la copia locale. */
export async function salvaCfg(cfg, versione) {
  const salvate = estrai(cfg);
  inCache(salvate);
  if (!collegato()) throw new Error('Per salvare le impostazioni devi entrare col tuo account.');
  const r = await scrivi(CHIAVE, salvate, versione, (remoto, locale) => locale);
  return r.versione;
}
