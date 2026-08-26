/* Pagina "Serie A": si sceglie una squadra e si vede la rosa completa a listone,
   con le statistiche disponibili e lo stato di ciascun giocatore all'asta. */
import { caricaDati, ricalcola, asta, badgeRuolo, RUOLI, NOME_RUOLO, CLASSE_VERDETTO } from './app.js?v=7';
import { avvia, configurato, leggi, esc } from './db.js?v=7';

const { players, lega } = await caricaDati();

let cfg = lega;
try {
  const salvata = JSON.parse(localStorage.getItem('pianoAsta:cfg:v1') || 'null');
  if (salvata) cfg = { ...structuredClone(lega), ...salvata };
} catch { /* storage non disponibile */ }
ricalcola(players, cfg, cfg.piano);

const stato = asta.leggi();
const altrui = asta.leggiAltrui();

/* Chi ha preso chi, secondo le fantasquadre condivise. */
let proprietario = {};   // idGiocatore -> { squadra, prezzo }
await avvia();
if (configurato()) {
  try {
    const r = await leggi('fantasquadre', null);
    for (const s of (r.dati?.squadre || [])) {
      for (const g of (s.rosa || [])) proprietario[g.id] = { squadra: s.nome, prezzo: g.prezzo };
    }
  } catch { /* senza accesso restiamo con i soli dati locali */ }
}

const ORDINE = { P: 0, D: 1, C: 2, A: 3 };
const squadre = [...new Set(players.map(p => p.sq))].sort((a, b) => a.localeCompare(b, 'it'));

const selSquadra = document.getElementById('squadra');
selSquadra.innerHTML = '<option value="">Tutte le squadre</option>'
  + squadre.map(s => `<option>${esc(s)}</option>`).join('');
try {
  const ultima = localStorage.getItem('pianoAsta:squadra');
  if (ultima && squadre.includes(ultima)) selSquadra.value = ultima;
} catch { /* storage non disponibile */ }

let filtroRuolo = 'ALL', soloLiberi = false, cerca = '';

const num = v => (v ?? v === 0) ? v : '';

function statoDi(p) {
  const id = asta.id(p);
  if (stato[id] > 0) return { cls: 'taken', testo: `tua · ${stato[id]} cr`, pill: 'p-t' };
  const q = proprietario[id];
  if (q) return { cls: 'altrui', testo: `${q.squadra} · ${q.prezzo} cr`, pill: 'p-l' };
  if (altrui.has(id)) return { cls: 'altrui', testo: 'a un avversario', pill: 'p-l' };
  return { cls: '', testo: 'libero', pill: 'p-g' };
}

function disegna() {
  const sq = selSquadra.value;
  const s = cerca.trim().toLowerCase();

  const lista = players.filter(p =>
    (!sq || p.sq === sq) &&
    (filtroRuolo === 'ALL' || p.r === filtroRuolo) &&
    (!soloLiberi || (asta.disponibile(p, stato, altrui) && !proprietario[asta.id(p)])) &&
    (!s || p.n.toLowerCase().includes(s) || p.sq.toLowerCase().includes(s))
  ).sort((a, b) => ORDINE[a.r] - ORDINE[b.r] || b.q - a.q || a.n.localeCompare(b.n, 'it'));

  const corpo = document.querySelector('#rosa tbody');
  corpo.innerHTML = lista.map(p => {
    const st = statoDi(p);
    return `<tr class="${st.cls}">
      <td><span class="gioc">${badgeRuolo(p.r)}<span class="testo"><span class="nm">${esc(p.n)}</span>${sq ? '' : `
        <span class="sq">${esc(p.sq)}</span>`}</span></span></td>
      <td class="num mktc">${p.q}</td>
      <td class="num mktc">${Math.round(p.mkt)}</td>
      <td class="num maxc">${p.max}</td>
      <td class="num mktc">${num(p.pg)}</td>
      <td class="num">${p.mv != null ? p.mv.toFixed(2) : ''}</td>
      <td class="num">${p.fm != null ? p.fm.toFixed(2) : ''}</td>
      <td class="num">${num(p.gol)}</td>
      <td class="num">${num(p.assist)}</td>
      <td class="num">${num(p.amm)}</td>
      <td class="num">${num(p.esp)}</td>
      <td><span class="pill ${st.pill}">${esc(st.testo)}</span></td>
      <td class="note">${esc(p.nota || '')}</td></tr>`;
  }).join('') || '<tr><td colspan="13" class="note" style="color:var(--ink3)">Nessun giocatore con questi filtri.</td></tr>';

  /* riepilogo della squadra scelta */
  const box = document.getElementById('riepilogo');
  if (sq) {
    const tutti = players.filter(p => p.sq === sq);
    const perRuolo = RUOLI.map(r => {
      const n = tutti.filter(p => p.r === r).length;
      return `<div class="lcell" data-r="${r}"><div class="k">${NOME_RUOLO[r]}</div><div class="n">${n}</div></div>`;
    }).join('');
    const presi = tutti.filter(p => stato[asta.id(p)] > 0 || proprietario[asta.id(p)] || altrui.has(asta.id(p))).length;
    box.innerHTML = perRuolo
      + `<div class="lcell"><div class="k">In listone</div><div class="n">${tutti.length}</div></div>`
      + `<div class="lcell"><div class="k">Già presi</div><div class="n">${presi}<small> / ${tutti.length}</small></div></div>`;
  } else {
    box.innerHTML = `<div class="lcell"><div class="k">Giocatori mostrati</div><div class="n">${lista.length}</div></div>`
      + `<div class="lcell"><div class="k">Squadre</div><div class="n">${squadre.length}</div></div>`;
  }

  /* avviso sulle statistiche che mancano */
  const conVoto = players.filter(p => p.mv != null).length;
  const conGol = players.filter(p => p.gol != null).length;
  document.getElementById('avvisoStat').innerHTML = conGol
    ? `Statistiche complete per ${conGol} giocatori.`
    : `Presenze, media voto e fantamedia ci sono per ${conVoto} giocatori su ${players.length} — chi non ha ancora giocato è vuoto. Le colonne gol, assist e cartellini restano vuote finché non aggiungi <code>data/statistiche.json</code>.`;

  /* schede compatte, solo quando si guardano tutte le squadre */
  const griglia = document.getElementById('griglia');
  griglia.innerHTML = sq ? '' : squadre.map(nome => {
    const tutti = players.filter(p => p.sq === nome);
    const miei = tutti.filter(p => stato[asta.id(p)] > 0).length;
    const righe = RUOLI.map(r => {
      const n = tutti.filter(p => p.r === r).length;
      return `<span>${badgeRuolo(r)}<b>${n}</b></span>`;
    }).join('');
    return `<div class="sqcard"><h3>${esc(nome)}
      <span class="n"${miei ? ' style="color:var(--acc)"' : ''}>${miei ? miei + ' tuoi · ' : ''}${tutti.length} a listone</span></h3>
      <div class="fsmeta">${righe}<button class="chip" data-vai="${esc(nome)}" style="margin-left:auto">apri</button></div></div>`;
  }).join('');
}

/* ---------- interazioni ---------- */

selSquadra.addEventListener('change', () => {
  try { localStorage.setItem('pianoAsta:squadra', selSquadra.value); } catch { /* ignora */ }
  disegna();
});

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

document.getElementById('griglia').addEventListener('click', e => {
  const b = e.target.closest('button[data-vai]');
  if (!b) return;
  selSquadra.value = b.dataset.vai;
  selSquadra.dispatchEvent(new Event('change'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

disegna();
