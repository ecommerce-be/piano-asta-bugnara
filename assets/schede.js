/* Le schede: più pagine sotto una voce sola di menu.
 *
 * PERCHE' ESISTE. Il sito era arrivato a undici voci di menu, e undici voci
 * non sono una navigazione: sono un elenco in cui cercare. Guida, fasce,
 * infortunati, fantasquadre, lega e impostazioni sono tutte cose che si
 * guardano una volta ogni tanto, non durante l'asta, e stare ognuna dietro
 * una voce sua le rendeva tutte ugualmente lontane. Adesso il menu ha quattro
 * voci — l'asta, la mia squadra, la Serie A, il resto — e dentro «il resto»
 * si passa da una scheda all'altra senza riaprire niente.
 *
 * COME FUNZIONA, e perché così:
 *
 *   - il contenuto di ogni scheda è GIA' nella pagina, scritto a mano come
 *     prima. Non si genera niente: se il JavaScript non parte si vedono tutte
 *     le sezioni una sotto l'altra, e il sito resta leggibile;
 *   - il modulo di una scheda si carica la PRIMA volta che la si apre, non al
 *     caricamento della pagina. Sei moduli che partono insieme vorrebbero dire
 *     sei letture dell'asta e sei ricalcoli del listone per vedere una cosa
 *     sola;
 *   - la scheda aperta finisce nell'indirizzo (`altro.html#fasce`), così un
 *     collegamento porta dove deve, il tasto «indietro» funziona, e chi
 *     ricarica resta dov'era.
 *
 * L'HTML che si aspetta:
 *
 *   <div class="schede" role="tablist">
 *     <button role="tab" data-scheda="fasce">Fasce</button> …
 *   </div>
 *   <section class="scheda" id="s-fasce" data-modulo="fasce.js?v=N"> … </section>
 */

const barra = document.querySelector('.schede');
const sezioni = [...document.querySelectorAll('.scheda')];

if (barra && sezioni.length) {
  const bottoni = [...barra.querySelectorAll('[data-scheda]')];
  const nomi = bottoni.map(b => b.dataset.scheda);
  const caricati = new Set();

  const sezioneDi = nome => document.getElementById('s-' + nome);

  async function carica(nome) {
    if (caricati.has(nome)) return;
    caricati.add(nome);
    const sez = sezioneDi(nome);
    const mod = sez?.dataset.modulo;
    if (!mod) return;
    try {
      await import(new URL('./' + mod, import.meta.url).href);
    } catch (e) {
      /* Un modulo che non parte non deve lasciare una scheda muta: chi guarda
         deve capire che è rotto, non pensare che sia vuota. */
      caricati.delete(nome);
      if (sez) {
        const avviso = document.createElement('div');
        avviso.className = 'vuotafs';
        avviso.textContent = 'Questa scheda non si è caricata: ' + (e?.message || e);
        sez.prepend(avviso);
      }
    }
  }

  function mostra(nome, scrivendoNellIndirizzo = true) {
    if (!nomi.includes(nome)) nome = nomi[0];
    for (const b of bottoni) {
      const suo = b.dataset.scheda === nome;
      b.setAttribute('aria-selected', String(suo));
      b.tabIndex = suo ? 0 : -1;
    }
    for (const s of sezioni) s.hidden = s.id !== 's-' + nome;
    if (scrivendoNellIndirizzo && location.hash.slice(1) !== nome) {
      history.replaceState(null, '', '#' + nome);
    }
    /* prima si mostra, poi si carica: il modulo trova la sua sezione visibile
       e può misurare quello che gli serve */
    carica(nome);
  }

  for (const b of bottoni) {
    b.addEventListener('click', () => mostra(b.dataset.scheda));
  }

  /* frecce fra le linguette, come vuole una barra di schede */
  barra.addEventListener('keydown', e => {
    const i = bottoni.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % bottoni.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + bottoni.length) % bottoni.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = bottoni.length - 1;
    if (j === null) return;
    e.preventDefault();
    bottoni[j].focus();
    mostra(bottoni[j].dataset.scheda);
  });

  window.addEventListener('hashchange', () => mostra(location.hash.slice(1), false));

  mostra(location.hash.slice(1) || nomi[0]);
}
