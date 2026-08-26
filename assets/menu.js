/* La barra di navigazione, ripiegata in un menu a tendina.

   Nove voci in fila occupavano tutta la testata e su schermo stretto andavano
   a capo. Qui restano tutte, ma dietro un pulsante che mostra dove sei.

   I collegamenti NON sono scritti qui: li legge da quelli gia' presenti nella
   pagina. Cosi' se il JavaScript non parte la testata resta una lista di link
   che funziona lo stesso, e i motori di ricerca vedono comunque il sito. */

const nav = document.querySelector('nav.nav');

if (nav && !nav.dataset.tendina) {
  const voci = [...nav.querySelectorAll('a')];
  const corrente = voci.find(a => a.getAttribute('aria-current') === 'page');
  const etichetta = corrente ? corrente.textContent.trim() : 'Vai a…';

  nav.dataset.tendina = '1';
  nav.classList.add('menu');

  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = 'menubtn';
  bottone.setAttribute('aria-expanded', 'false');
  bottone.setAttribute('aria-haspopup', 'true');
  bottone.setAttribute('aria-label', `Menu di navigazione, sei su ${etichetta}`);
  bottone.innerHTML = `<span class="dove"></span><span class="chev" aria-hidden="true"></span>`;
  bottone.querySelector('.dove').textContent = etichetta;

  const pannello = document.createElement('div');
  pannello.className = 'menupanel';
  pannello.setAttribute('role', 'menu');
  pannello.hidden = true;
  for (const a of voci) pannello.appendChild(a);
  for (const a of pannello.querySelectorAll('a')) a.setAttribute('role', 'menuitem');

  nav.textContent = '';
  nav.append(bottone, pannello);

  const link = () => [...pannello.querySelectorAll('a')];

  function apri(quale = null) {
    pannello.hidden = false;
    bottone.setAttribute('aria-expanded', 'true');
    if (quale === 'primo') link()[0]?.focus();
    if (quale === 'ultimo') link().at(-1)?.focus();
  }

  function chiudi(tornaAlBottone = false) {
    pannello.hidden = true;
    bottone.setAttribute('aria-expanded', 'false');
    if (tornaAlBottone) bottone.focus();
  }

  const aperto = () => !pannello.hidden;

  bottone.addEventListener('click', () => (aperto() ? chiudi() : apri()));

  bottone.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); apri('primo'); }
    if (e.key === 'ArrowUp') { e.preventDefault(); apri('ultimo'); }
  });

  /* frecce per scorrere le voci, Esc per uscire, Tab per andarsene senza
     lasciare un pannello aperto alle spalle */
  pannello.addEventListener('keydown', e => {
    const voci = link();
    const i = voci.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); voci[(i + 1) % voci.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); voci[(i - 1 + voci.length) % voci.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); voci[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); voci.at(-1).focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); chiudi(true); }
    else if (e.key === 'Tab') chiudi();
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && aperto()) chiudi(true); });
  document.addEventListener('click', e => { if (aperto() && !nav.contains(e.target)) chiudi(); });
}
