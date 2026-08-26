/* Pagina "La guida": grafici del modificatore, rosa target, shortlist per reparto. */
import { caricaDati, ricalcola, badgeRuolo, NOME_RUOLO, CLASSE_VERDETTO } from './app.js?v=22';

/* ---------- i due grafici ---------- */

function disegnaBarre(el, scenari, max = 3) {
  if (!el) return;
  el.innerHTML = scenari.map(s => `
    <div class="brow">
      <div class="blab">${s.l}<small>${s.s}</small></div>
      <div class="btrack">
        <div class="bfill" style="width:0;background:var(${s.c})" data-w="${(s.v / max * 100).toFixed(1)}"
             title="${s.l}: ${s.v.toFixed(2)} punti a giornata, ${Math.round(s.v * 38)} in stagione"></div>
        <div class="bval">${s.v.toFixed(2)} <span>pt/giornata · ${Math.round(s.v * 38)} in stagione</span></div>
      </div>
    </div>`).join('');
  requestAnimationFrame(() => el.querySelectorAll('.bfill').forEach(b => { b.style.width = b.dataset.w + '%'; }));
}

disegnaBarre(document.getElementById('bars'), [
  { l: 'Difesa costruita', s: '5 difensori da voto alto + portiere di difesa top', v: 2.68, c: '--bar1' },
  { l: 'Difesa buona', s: 'titolari solidi, portiere di media classifica', v: 2.00, c: '--bar2' },
  { l: 'Difesa media', s: 'il reparto riempito senza criterio', v: 1.44, c: '--bar3' },
  { l: 'Difesa raccattata', s: 'quello che avanza a 1 credito', v: 1.02, c: '--bar4' },
]);

disegnaBarre(document.getElementById('bars2'), [
  { l: '5-4-1 · 5 difensori buoni', s: 'il quinto difensore al posto del quinto centrocampista', v: 2.64, c: '--bar1' },
  { l: '4-5-1 · 4 difensori eccellenti', s: "budget concentrato su quattro nomi — l'assetto scelto", v: 2.54, c: '--bar2' },
  { l: '4-5-1 · 4 difensori buoni', s: 'budget spalmato invece che concentrato', v: 2.06, c: '--bar3' },
  { l: '4-5-1 · difesa presa a caso', s: 'quello che avanza a 1 credito', v: 1.22, c: '--bar4' },
]);

/* ---------- dati ---------- */

const { players, lega } = await caricaDati();
ricalcola(players, lega, lega.piano);
const perNome = Object.fromEntries(players.map(p => [p.r + '|' + p.n, p]));

/* ---------- rosa target ---------- */

const rosa = await fetch('assets/data/rosa.json?v=22').then(r => r.json());
const ETICHETTA = { t: ['Titolare', 'rt'], c: ['Primo cambio', 'rc'], r: ['Copertura', 'rr'] };
const corpoRosa = document.getElementById('rosaBody');

if (corpoRosa) {
  let html = '';
  for (const r of ['P', 'D', 'C', 'A']) {
    const righe = rosa.rosa[r];
    const totale = righe.reduce((a, x) => a + x[1], 0);
    html += `<tr class="grp" data-r="${r}"><td colspan="5">${badgeRuolo(r)}${NOME_RUOLO[r]} · ${righe.length} slot · <b>${totale} crediti</b></td></tr>`;
    for (const [nome, prezzo, tag] of righe) {
      const p = perNome[r + '|' + nome];
      if (!p) continue;
      const [testo, cls] = ETICHETTA[tag];
      html += `<tr>
        <td>${badgeRuolo(p.r)}<span class="nm">${p.n}</span> <span class="sq">${p.sq}</span></td>
        <td><span class="pill ${cls}">${testo}</span></td>
        <td class="num mktc">${Math.round(p.mkt)}</td>
        <td class="num maxc">${prezzo}</td>
        <td class="note">${p.nota || '—'}</td></tr>`;
    }
  }
  corpoRosa.innerHTML = html;
}

/* ---------- shortlist per reparto ---------- */

const SCELTE = {
  P: ['Butez', 'Svilar', 'Carnesecchi', 'Maignan', 'Vicario', 'Meret', 'Skorupski', 'De Gea', 'Martinez Jo.', 'Muric', 'Paleari'],
  D: ['Bremer', 'Pavlovic', 'Rrahmani', 'Mancini', 'Gila', 'Solet', "N'Dicka", 'Bastoni', 'Ramon', 'Ostigard', 'Kalulu',
      'Chalobah T.', 'Cambiaso', 'Kempf', 'Valeri', 'Miranda J.', 'Mina', 'Molina N.', 'Stones', 'Gabbia', 'Buongiorno', 'Parisi'],
  C: ['Orsolini', 'Calhanoglu', 'Da Cunha', 'Zaniolo', 'Baturina', 'Gudmundsson A.', 'Rodriguez Je.', 'Vlasic', 'Baldanzi',
      'Thorstvedt', 'Frattesi', 'Colpani', 'Berisha M.', 'Calò', 'Adzic', 'Pulisic', 'Modric', 'Konè I.'],
  A: ['Esposito F.P.', 'Krstovic', 'Simeone', 'Dybala', 'Raspadori', 'Nkunku', 'Colombo', 'Cutrone', 'Bowie', 'Piccoli',
      'Ghedjemis', 'Rrahmani Al.', 'Malen', 'Martinez L.', 'Dovbyk', 'Castro S.', 'Berardi', 'Leao'],
};

const contTab = document.getElementById('tabs');
const corpoShort = document.querySelector('#short tbody');

function disegnaShortlist(r) {
  corpoShort.innerHTML = SCELTE[r].map(nome => {
    const p = perNome[r + '|' + nome];
    if (!p) return '';
    return `<tr>
      <td>${badgeRuolo(p.r)}<span class="nm">${p.n}</span><br><span class="sq">${p.sq}</span></td>
      <td class="num mktc">${p.q}</td>
      <td class="num mktc">${Math.round(p.mkt)}</td>
      <td class="num maxc">${p.max}</td>
      <td><span class="pill ${CLASSE_VERDETTO[p.v] || 'p-g'}">${p.v}</span></td>
      <td class="note">${p.nota || '—'}</td></tr>`;
  }).join('');
}

if (contTab) {
  ['P', 'D', 'C', 'A'].forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === 0));
    b.textContent = `${NOME_RUOLO[r]} · ${lega.piano[r]} cr`;
    b.onclick = () => {
      [...contTab.children].forEach(x => x.setAttribute('aria-selected', String(x === b)));
      disegnaShortlist(r);
    };
    contTab.appendChild(b);
  });
  disegnaShortlist('P');
}
