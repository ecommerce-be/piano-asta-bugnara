/* Interruttore del tema: chiaro / scuro / automatico.
   La scelta si stampa come data-theme sull'elemento <html>, che è quello che il CSS
   guarda. "Automatico" toglie l'attributo e lascia decidere al sistema operativo.

   Lo stamp iniziale lo fa uno script inline nel <head> di ogni pagina, prima del
   primo disegno, altrimenti si vedrebbe un lampo bianco prima del tema scuro. */

const CHIAVE = 'pianoAsta:tema';
const MODI = [['auto', 'Auto'], ['light', 'Chiaro'], ['dark', 'Scuro']];

export function applicaTema(modo) {
  if (modo === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = modo;
  try { localStorage.setItem(CHIAVE, modo); } catch { /* storage non disponibile */ }
}

export function temaCorrente() {
  try { return localStorage.getItem(CHIAVE) || 'auto'; } catch { return 'auto'; }
}

/** Costruisce i tre pulsantini e li appende al contenitore indicato. */
export function montaInterruttore(contenitore) {
  if (!contenitore) return;
  const attuale = temaCorrente();
  contenitore.className = 'theme';
  contenitore.setAttribute('role', 'group');
  contenitore.setAttribute('aria-label', 'Tema della pagina');

  for (const [modo, etichetta] of MODI) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = etichetta;
    b.dataset.modo = modo;
    b.setAttribute('aria-pressed', String(modo === attuale));
    b.onclick = () => {
      applicaTema(modo);
      [...contenitore.children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    };
    contenitore.appendChild(b);
  }
}

/* Monta l'interruttore ovunque ci sia il segnaposto. */
montaInterruttore(document.getElementById('tema'));

/* Mostra accanto al logo l'impronta del file che il browser sta servendo.
 *
 * Prima era un numero scritto in ogni pagina (`<meta name="versione">`), uguale
 * per tutto il sito: per cambiarlo bisognava rimarcare trentadue file a ogni
 * modifica. Adesso ogni file porta l'impronta del proprio contenuto, e questo
 * modulo la legge dal PROPRIO indirizzo — `theme.js?v=a3f1c9`. È letteralmente
 * «la versione del file che ti è arrivato», che è quello che quel numero
 * voleva dire; e non c'è più niente da tenere allineato a mano. */
const v = new URL(import.meta.url).searchParams.get('v');
const marchio = document.querySelector('.brand');
if (v && marchio && !marchio.querySelector('.ver')) {
  const s = document.createElement('span');
  s.className = 'ver';
  s.textContent = 'v' + v;
  s.title = 'Versione del sito caricata dal browser';
  marchio.appendChild(s);
}
