/* Dove sta Playwright, senza inchiodarlo a un percorso.
 *
 * Le prove che aprono davvero il browser hanno bisogno di Playwright, che non
 * e' una dipendenza del sito: il sito non ha dipendenze, e non ne vogliamo per
 * far girare le pagine. E' solo attrezzatura da banco di prova, quindi puo'
 * esserci o non esserci, e i controlli devono comportarsi bene in tutti e due
 * i casi invece di piantarsi con un percorso che esiste solo su una macchina.
 *
 * Lo cerca, in quest'ordine:
 *   1. la variabile d'ambiente PLAYWRIGHT_PATH, se l'hai messa tu
 *   2. il pacchetto installato normalmente (node_modules qui o piu' in alto)
 *   3. una copia di servizio in /tmp, che esiste solo sulla macchina dove il
 *      sito e' stato sviluppato
 *
 * Se non lo trova non e' un errore: restituisce null e chi lo ha chiamato
 * salta le prove col browser dicendo chiaramente cosa manca.
 */
import { existsSync } from 'node:fs';

export const COME_INSTALLARLO = [
  'npm install --no-save playwright',
  'npx playwright install chromium',
];

export async function playwright() {
  const tentativi = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '/tmp/node_modules/playwright/index.js',
  ].filter(Boolean);

  for (const dove of tentativi) {
    try {
      const m = await import(dove);
      return m.default ?? m;
    } catch { /* proviamo il prossimo */ }
  }
  return null;
}

/**
 * Con che eseguibile aprire Chromium.
 *
 * Installato come si deve, Playwright il suo browser se lo trova da solo e
 * questa deve restare `undefined`: passargli un percorso sbagliato e' peggio
 * che non passargliene nessuno.
 */
export function chromium() {
  const scelto = process.env.CHROME_PATH;
  if (scelto) return scelto;
  const diServizio = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return existsSync(diServizio) ? diServizio : undefined;
}

/** Il messaggio da stampare quando Playwright non c'e'. */
export function spiegazione(cosa) {
  return [
    `  ${cosa} — servono le prove col browser, e Playwright non è installato.`,
    '  Non è un guasto: il sito non ne ha bisogno, serve solo per i controlli.',
    '  Per averle anche qui, una volta sola:',
    ...COME_INSTALLARLO.map(c => '      ' + c),
  ].join('\n');
}
