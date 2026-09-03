/* Pagina "Infortunati": chi non gioca, perche', e per quanto ancora.
   I dati arrivano da assets/data/infortuni.json, che l'aggiornamento
   automatico rigenera ogni mattina leggendo la pagina degli indisponibili. */
import {
  caricaDati, caricaInfortuni, ricalcola, asta, badgeRuolo,
  giorniAlRientro, gravita, classeGravita, RUOLI,
} from './app.js?v=d304c59d';
import { esc } from './db.js?v=6824e6b7';
import { leggiCfg } from './cfg.js?v=7661d252';
import { caricaAsta, statoAsta } from './astaLega.js?v=c262ae13';

const { players, lega } = await caricaDati();

/* Le regole della lega arrivano dal database condiviso: vedi assets/cfg.js */
const { cfg } = await leggiCfg(lega);
ricalcola(players, cfg, cfg.piano);

const perId = Object.fromEntries(players.map(p => [asta.id(p), p]));

/* "Solo i miei" guarda la rosa che hai comprato all'asta della lega. */
let stato = {};
try { await caricaAsta(players); stato = statoAsta().mia; } catch { /* nessuna rosa */ }

const { aggiornato, voci } = await caricaInfortuni();

const ETICHETTA = { infortunio: 'infortunio', squalifica: 'squalifica', diffida: 'diffida' };
const ORDINE_R = { P: 0, D: 1, C: 2, A: 3 };

const squadre = [...new Set(players.map(p => p.sq))].sort((a, b) => a.localeCompare(b, 'it'));
const conFermi = new Set(voci.map(v => v.sq));

const selSquadra = document.getElementById('squadra');
selSquadra.innerHTML = '<option value="">Tutte le squadre</option>'
  + squadre.map(s => {
    const n = voci.filter(v => v.sq === s).length;
    return `<option value="${esc(s)}">${esc(s)}${n ? ` — ${n} ferm${n === 1 ? 'o' : 'i'}` : ''}</option>`;
  }).join('');

let filtro = 'ALL', soloMiei = false, cerca = '';

const mio = v => stato[v.id] > 0;

/** Da "inizio ottobre" + data a una frase leggibile. */
function frase(v) {
  const g = giorniAlRientro(v);
  if (v.tipo === 'squalifica') return v.rientro ? `salta la ${v.rientro}` : 'salta la prossima';
  if (v.tipo === 'diffida') return 'a rischio squalifica';
  if (!v.rientro) return 'tempi non indicati';
  if (g === null) return `rientro: ${v.rientro}`;
  const sett = Math.round(g / 7);
  return `rientro ${v.rientro} · fra ${sett <= 1 ? 'una settimana' : `~${sett} settimane`}`;
}

function filtrate() {
  const s = cerca.trim().toLowerCase();
  const sq = selSquadra.value;
  return voci.filter(v =>
    (!sq || v.sq === sq) &&
    (filtro === 'ALL' || v.tipo === filtro) &&
    (!soloMiei || mio(v)) &&
    (!s || v.n.toLowerCase().includes(s) || v.sq.toLowerCase().includes(s) || v.desc.toLowerCase().includes(s))
  );
}

function riga(v) {
  const p = perId[v.id];
  const cls = classeGravita(v);
  return `<div class="infrow${mio(v) ? ' mia' : ''}">
    <div class="capo">
      <span class="gioc">${badgeRuolo(v.r)}<span class="testo"><span class="nm">${esc(v.n)}</span></span></span>
      <span class="pill ${cls}">${ETICHETTA[v.tipo] || v.tipo}</span>
      <span class="quando ${cls}">${esc(frase(v))}</span>
      ${mio(v) ? '<span class="pill p-t">tuo</span>' : ''}
      ${p ? `<span class="firma" style="margin-left:auto">quot. ${p.q} · tuo max ${p.max}</span>` : ''}
    </div>
    <div class="perche">${esc(v.desc)}</div>
  </div>`;
}

function disegna() {
  const lista = filtrate();
  const box = document.getElementById('elenco-inf');

  if (!voci.length) {
    /* Due cause diverse, e il consiglio giusto e' l'opposto nei due casi.
       In locale il file quasi sempre esiste gia' su GitHub — lo scrive
       l'aggiornamento automatico — e manca solo perche' non hai ancora
       tirato giu' il commit. Mandarti a rilanciare il workflow, come faceva
       la versione precedente di questo messaggio, ti fa perdere tempo. */
    const inLocale = ['localhost', '127.0.0.1', ''].includes(location.hostname)
      || location.protocol === 'file:';
    box.innerHTML = inLocale
      ? `<div class="vuotafs">Qui non c'è il file degli infortuni, ma su GitHub quasi certamente sì:
         lo scrive da solo l'aggiornamento delle 8 del mattino. Stai guardando una copia locale che non l'ha
         ancora scaricato — fai <strong><code>git pull</code></strong> nella cartella del sito e ricarica.
         Se anche dopo il pull la cartella <code>assets/data/</code> non contiene
         <code>infortuni.json</code>, allora l'aggiornamento non è mai andato a buon fine: lancialo a mano
         da <strong>Actions → Aggiorna dati giocatori → Run workflow</strong>.</div>`
      : `<div class="vuotafs">Nessun dato sugli infortuni, ancora. Il file viene creato la prima volta
         che gira l'aggiornamento automatico: su GitHub, scheda <strong>Actions</strong> →
         <strong>Aggiorna dati giocatori</strong> → <strong>Run workflow</strong>.</div>`;
    return disegnaTotali(lista);
  }
  if (!lista.length) {
    box.innerHTML = '<div class="vuotafs">Nessuno con questi filtri. Buon segno.</div>';
    return disegnaTotali(lista);
  }

  const sq = selSquadra.value;
  const gruppi = sq ? [sq] : [...new Set(lista.map(v => v.sq))].sort((a, b) => a.localeCompare(b, 'it'));

  box.innerHTML = gruppi.map(nome => {
    const dentro = lista.filter(v => v.sq === nome).sort((a, b) => {
      const ga = giorniAlRientro(a) ?? -1, gb = giorniAlRientro(b) ?? -1;
      return gb - ga || ORDINE_R[a.r] - ORDINE_R[b.r] || a.n.localeCompare(b.n, 'it');
    });
    if (!dentro.length) return '';
    const inf = dentro.filter(v => v.tipo === 'infortunio').length;
    return `<div class="repbox"><div class="rephead">${esc(nome)}
      <span class="sp">${dentro.length} ferm${dentro.length === 1 ? 'o' : 'i'}${inf !== dentro.length ? ` · ${inf} per infortunio` : ''}</span></div>
      <div class="replist">${dentro.map(riga).join('')}</div></div>`;
  }).join('') || '<div class="vuotafs">Nessuno con questi filtri.</div>';

  disegnaTotali(lista);
}

function disegnaTotali(lista) {
  const inf = voci.filter(v => v.tipo === 'infortunio');
  const lunghi = inf.filter(v => gravita(v) === 'lunga');
  const miei = voci.filter(mio);
  document.getElementById('totali-inf').innerHTML = `
    <div class="lcell"><div class="k">Fermi in tutto</div><div class="n">${voci.length}<small> · ${lista.length} mostrati</small></div></div>
    <div class="lcell"><div class="k">Per infortunio</div><div class="n">${inf.length}</div></div>
    <div class="lcell${lunghi.length ? ' over' : ''}"><div class="k">Stop lunghi<small> oltre 6 settimane</small></div><div class="n">${lunghi.length}</div></div>
    <div class="lcell"><div class="k">Squadre coinvolte</div><div class="n">${conFermi.size}<small> / ${squadre.length}</small></div></div>
    <div class="lcell${miei.length ? ' over' : ''}"><div class="k">Dei tuoi</div><div class="n">${miei.length}</div></div>`;

  document.getElementById('avviso').textContent = aggiornato
    ? `Aggiornato il ${new Date(aggiornato).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}, da Fantacalcio.it.`
    : '';
}

/* ---------- interazioni ---------- */

selSquadra.addEventListener('change', () => {
  try { localStorage.setItem('pianoAsta:squadra', selSquadra.value); } catch { /* ignora */ }
  disegna();
});
document.getElementById('q-inf').addEventListener('input', e => { cerca = e.target.value; disegna(); });

document.querySelectorAll('.chip[data-t]').forEach(c => c.onclick = () => {
  filtro = c.dataset.t;
  document.querySelectorAll('.chip[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
  disegna();
});

document.getElementById('soloMiei').onclick = e => {
  soloMiei = !soloMiei;
  e.currentTarget.setAttribute('aria-pressed', String(soloMiei));
  disegna();
};

try {
  const ultima = localStorage.getItem('pianoAsta:squadra');
  if (ultima && squadre.includes(ultima)) selSquadra.value = ultima;
} catch { /* storage non disponibile */ }

disegna();
