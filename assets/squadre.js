/* Pagina "Squadre": le venti di Serie A con i loro giocatori, marcati per stato. */
import { caricaDati, ricalcola, asta, badgeRuolo, RUOLI } from './app.js';

const { players, lega } = await caricaDati();

let cfg = lega;
try {
  const salvata = JSON.parse(localStorage.getItem('pianoAsta:cfg:v1') || 'null');
  if (salvata) cfg = { ...structuredClone(lega), ...salvata };
} catch { /* storage non disponibile */ }

ricalcola(players, cfg, cfg.piano);

const stato = asta.leggi();
const altrui = asta.leggiAltrui();

let filtroRuolo = 'ALL', soloLiberi = false, soloUtili = true, cerca = '';
const griglia = document.getElementById('griglia');
const ORDINE = { P: 0, D: 1, C: 2, A: 3 };

function disegna() {
  const s = cerca.toLowerCase();
  const squadre = [...new Set(players.map(p => p.sq))].sort((a, b) => a.localeCompare(b, 'it'));

  griglia.innerHTML = squadre.map(sq => {
    const cercaSquadra = !s || sq.toLowerCase().includes(s);
    let lista = players.filter(p => p.sq === sq
      && (filtroRuolo === 'ALL' || p.r === filtroRuolo)
      && (!soloUtili || p.max > 1)
      && (!soloLiberi || asta.disponibile(p, stato, altrui))
      && (cercaSquadra || p.n.toLowerCase().includes(s)));

    if (!lista.length) return '';

    lista.sort((a, b) => ORDINE[a.r] - ORDINE[b.r] || b.max - a.max);

    const mieiQui = lista.filter(p => stato[asta.id(p)] > 0).length;
    const righe = lista.map(p => {
      const id = asta.id(p);
      const mio = stato[id] > 0;
      const via = altrui.has(id);
      const cls = mio ? ' presoMio' : via ? ' presoAltri' : '';
      const prezzo = mio ? stato[id] : p.max;
      return `<div class="sqrow${cls}">${badgeRuolo(p.r)}<span class="nome">${p.n}</span>
        <span class="pz">${prezzo}</span></div>`;
    }).join('');

    const etichetta = mieiQui
      ? `<span class="n" style="color:var(--acc)">${mieiQui} tuoi · ${lista.length} in lista</span>`
      : `<span class="n">${lista.length} in lista</span>`;

    return `<div class="sqcard"><h3>${sq}${etichetta}</h3>${righe}</div>`;
  }).join('') || '<p style="color:var(--ink3)">Nessun giocatore con questi filtri.</p>';
}

document.getElementById('q').addEventListener('input', e => { cerca = e.target.value; disegna(); });

document.querySelectorAll('.chip[data-r]').forEach(c => c.onclick = () => {
  filtroRuolo = c.dataset.r;
  document.querySelectorAll('.chip[data-r]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
  disegna();
});

document.getElementById('soloLiberi').onclick = e => {
  soloLiberi = !soloLiberi;
  e.currentTarget.setAttribute('aria-pressed', String(soloLiberi));
  disegna();
};

document.getElementById('soloUtili').onclick = e => {
  soloUtili = !soloUtili;
  e.currentTarget.setAttribute('aria-pressed', String(soloUtili));
  disegna();
};

disegna();
