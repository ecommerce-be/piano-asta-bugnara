/* Pagina "Rosa ideale": scegli modulo e strategia, il sito compone i 28. */
import {
  caricaDati, caricaInfortuni, ricalcola, asta, badgeRuolo, classeGravita,
  RUOLI, NOME_RUOLO,
} from './app.js?v=30';
import { valuta, tabellaModificatore, componiRosa, STRATEGIE, titolariDi } from './consiglio.js?v=30';
import { leggiCfg, salvaCfg } from './cfg.js?v=30';
import { esc } from './db.js?v=30';
import { toast } from './ui.js?v=30';
import { avvia, collegato, leggi as leggiDb, scrivi as scriviDb, utente } from './db.js?v=30';

const { players, lega } = await caricaDati();
const { cfg, versione } = await leggiCfg(lega);
ricalcola(players, cfg, cfg.piano);

const infortuni = await caricaInfortuni();
const info = valuta(players, infortuni.per);
const tab = tabellaModificatore(cfg.modificatoreDifesa);

/* Modulo e strategia arrivano dalle impostazioni condivise, non da un angolo
   di questo browser: sono le stesse su cui la guida scrive il suo testo.
   Cambiarli qui li cambia anche li'. Il filtro infortunati invece resta una
   preferenza locale, perche' non cambia il ragionamento, solo cosa guardi. */
let modulo = cfg.modulo, strategia = cfg.strategia, rischio = 'tutti', risultato = null;

try {
  const s = JSON.parse(localStorage.getItem('pianoAsta:consigliere') || 'null');
  if (s && ['tutti', 'lunghi', 'nessuno'].includes(s.rischio)) rischio = s.rischio;
} catch { /* storage non disponibile */ }

/* ---------- controlli ---------- */

const selModulo = document.getElementById('modulo');
selModulo.innerHTML = lega.moduli.map(m => `<option${m === modulo ? ' selected' : ''}>${m}</option>`).join('');
document.getElementById('rischio').value = rischio;

document.getElementById('strategie').innerHTML = Object.entries(STRATEGIE).map(([k, s]) =>
  `<button type="button" data-s="${k}" aria-pressed="${k === strategia}">
     <b>${esc(s.nome)}</b><span>${esc(s.riga)}</span></button>`).join('');

function ricorda() {
  try { localStorage.setItem('pianoAsta:consigliere', JSON.stringify({ rischio })); }
  catch { /* ignora */ }

  if (modulo === cfg.modulo && strategia === cfg.strategia) return;
  cfg.modulo = modulo;
  cfg.strategia = strategia;
  /* salvaCfg aggiorna comunque la copia nel browser e poi, se sei entrato,
     scrive nel database. Senza accesso solleva: e' atteso, non un guasto. */
  salvaCfg(cfg, versione)
    .then(() => segnala('Modulo e strategia salvati per tutti: la guida li segue.'))
    .catch(() => segnala('Scelta valida in questo browser. Entra col tuo account nelle impostazioni per condividerla con Aurelio.'));
}

function segnala(t) {
  const el = document.getElementById('statoScelta');
  if (el) el.textContent = t;
}

/* ---------- calcolo ---------- */

function esclusi() {
  const fuori = new Set();
  if (rischio === 'tutti') return fuori;
  for (const [id, v] of infortuni.per) {
    if (v.tipo === 'diffida') continue;
    if (rischio === 'nessuno') { fuori.add(id); continue; }
    const g = v.quando ? (new Date(v.quando) - new Date()) / 86400000 : 0;
    if (g > 42) fuori.add(id);
  }
  return fuori;
}

function calcola() {
  const t = Date.now();
  risultato = componiRosa({ players, cfg, modulo, strategia, tab, esclusi: esclusi() });
  risultato.ms = Date.now() - t;
  disegna();
  ricorda();
}

/* ---------- disegno ---------- */

const prezzo = p => Math.max(1, Math.round(p.mkt));

function disegna() {
  const r = risultato;
  const mod = cfg.modificatoreDifesa;
  const titolari = titolariDi(modulo);

  /* avviso quando il modulo scelto spegne il modificatore */
  const box = document.getElementById('avvisoModulo');
  if (mod?.attivo && titolari.D < mod.minDifensori) {
    box.style.display = '';
    box.className = 'savebar sporca';
    box.innerHTML = `<span class="dot"></span><span class="msg">Con il ${esc(modulo)} schieri ${titolari.D} difensori,
      ma il modificatore ne vuole almeno ${mod.minDifensori}: giocando così rinunci a un bonus che con una difesa
      discreta vale un'ottantina di punti a stagione. La rosa qui sotto ne tiene conto.</span>`;
  } else box.style.display = 'none';

  const punti = r.puntiTitolari + r.puntiModificatore;
  document.getElementById('totali').innerHTML = `
    <div class="lcell"><div class="k">Spesi</div><div class="n">${r.costo}<small> / ${cfg.crediti} cr</small></div></div>
    <div class="lcell"><div class="k">Punti sopra una rosa da un credito</div><div class="n">${Math.round(punti)}</div></div>
    <div class="lcell${r.puntiModificatore > 0 ? '' : ' over'}"><div class="k">Di cui dal modificatore</div>
      <div class="n">${Math.round(r.puntiModificatore)}<small> · ${punti ? Math.round(r.puntiModificatore / punti * 100) : 0}%</small></div></div>
    ${RUOLI.map(x => `<div class="lcell" data-r="${x}"><div class="k">${NOME_RUOLO[x]}</div>
      <div class="n">${r.reparti[x].spesa}<small> cr · ${Math.round(r.reparti[x].spesa / r.costo * 100)}%</small></div></div>`).join('')}`;

  document.getElementById('reparti').innerHTML = RUOLI.map(x => {
    const lista = r.rosa[x];
    const nTit = titolari[x];
    const righe = lista.map((p, i) => {
      const v = infortuni.per.get(asta.id(p));
      const ko = v ? `<span class="ko ${classeGravita(v)}" title="${esc(v.desc)}">${v.tipo === 'infortunio' ? 'KO' : 'SQ'}</span>` : '';
      const sep = i === nTit ? `<div class="idsep">panchina — ${lista.length - nTit} giocatori, ${lista.slice(nTit).reduce((a, q) => a + prezzo(q), 0)} cr</div>` : '';
      return sep + `<div class="idrow${i >= nTit ? ' panca' : ''}">
        ${badgeRuolo(p.r)}<span class="nm">${esc(p.n)}${ko}</span>
        <span class="sq">${esc(p.sq)}</span>
        <span class="pt">${Math.round(p.val)} pt</span>
        <span class="pz">${prezzo(p)}</span></div>`;
    }).join('');
    return `<div class="repbox"><div class="rephead" data-r="${x}">${badgeRuolo(x)}${NOME_RUOLO[x]}
      <span class="sp">${nTit} titolari · ${r.reparti[x].spesa} cr</span></div>
      <div class="replist">${righe}</div></div>`;
  }).join('');

  disegnaSpiegazione();
}

function disegnaSpiegazione() {
  const r = risultato;
  const titolari = titolariDi(modulo);
  const dif = r.rosa.D.slice(0, titolari.D);
  const mediaDif = dif.length ? (dif.reduce((a, p) => a + p.mvAtt, 0) + r.rosa.P[0].mvAtt) / (dif.length + 1) : 0;
  const piuCaro = RUOLI.flatMap(x => r.rosa[x]).sort((a, b) => prezzo(b) - prezzo(a))[0];
  const fermi = RUOLI.flatMap(x => r.rosa[x]).filter(p => infortuni.per.has(asta.id(p)));

  document.getElementById('spiegazione').innerHTML = `
    <div class="rules">
      <div class="rule"><div><h3>Quanto vale un giocatore</h3>
        <p>Non i punti che fa, ma quelli che fa <em>in più</em> di uno da un credito: se schierassi ventotto sconosciuti
        qualche punto lo faresti comunque, e quello non lo stai comprando. Il rincalzo tipo vale
        ${Object.entries(info.rincalzo).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')} di fantamedia.</p></div></div>

      <div class="rule"><div><h3>Da dove esce la fantamedia attesa</h3>
        <p>Si sono giocate <strong>${info.giornate} giornate</strong>, quindi i numeri veri pesano il
        <strong>${Math.round(info.peso * 100)}%</strong> e il resto è stima. È di proposito: chi ha segnato una tripletta
        alla prima non è un giocatore da tripletta a partita. Più il campionato va avanti, più il modello guarda i fatti
        e meno le previsioni.</p></div></div>

      <div class="rule"><div><h3>${r.puntiModificatore > 0 ? 'Il modificatore, quantificato' : 'Il modificatore, rinunciato'}</h3>
        <p>${r.puntiModificatore > 0
          ? `Con questi ${dif.length} difensori e questo portiere la media voto è <strong>${mediaDif.toFixed(2)}</strong>,
             che vale <strong>${Math.round(r.puntiModificatore)} punti</strong> in stagione — il
             ${Math.round(r.puntiModificatore / (r.puntiTitolari + r.puntiModificatore) * 100)}% di tutto quello che
             questa rosa ti dà. La stima esce da ventimila giornate simulate.`
          : `Il modulo scelto non arriva al minimo di difensori, quindi il bonus non scatta: questa rosa vale solo
             per quello che fanno i singoli.`}</p></div></div>

      <div class="rule"><div><h3>Dove finiscono i crediti</h3>
        <p>Il pezzo più caro è <strong>${esc(piuCaro.n)}</strong> a ${prezzo(piuCaro)} crediti, il
        ${Math.round(prezzo(piuCaro) / cfg.crediti * 100)}% del budget. La panchina — ${28 - Object.values(titolari).reduce((a, b) => a + b, 0)} giocatori —
        costa ${RUOLI.reduce((a, x) => a + r.rosa[x].slice(titolari[x]).reduce((s, p) => s + prezzo(p), 0), 0)} crediti in tutto:
        serve a coprire gli assenti, non a vincere le giornate.</p></div></div>

      <div class="rule"><div><h3>Infortunati</h3>
        <p>${fermi.length
          ? `In rosa ce ne sono ${fermi.length}: ${fermi.map(p => esc(p.n)).join(', ')}. ${rischio === 'tutti'
            ? 'Li ho tenuti perché, scontati per le giornate che salteranno, valgono ancora il loro prezzo.'
            : 'Sono i casi brevi: quelli lunghi li ho esclusi come hai chiesto.'}`
          : 'Nessuno fermo in questa rosa.'}
        ${infortuni.voci.length ? `In tutta la Serie A ce ne sono ${infortuni.voci.length}.` : ''}</p></div></div>

      <div class="rule"><div><h3>Come li ha scelti</h3>
        <p>Si parte da ventotto giocatori da un credito e si compra un miglioramento alla volta, ogni volta quello che
        rende di più per credito speso — ${r.passi} scambi in ${r.ms} millisecondi. È lo stesso ragionamento che faresti
        tu, applicato a tutti i ${players.length} giocatori invece che ai venti che hai in testa.</p></div></div>
    </div>`;
}

/* ---------- interazioni ---------- */

selModulo.addEventListener('change', () => { modulo = selModulo.value; calcola(); });
document.getElementById('rischio').addEventListener('change', e => { rischio = e.target.value; calcola(); });
document.getElementById('ricalcola').onclick = calcola;

document.getElementById('strategie').addEventListener('click', e => {
  const b = e.target.closest('button[data-s]');
  if (!b) return;
  strategia = b.dataset.s;
  document.querySelectorAll('#strategie button').forEach(x =>
    x.setAttribute('aria-pressed', String(x === b)));
  calcola();
});

/* ---------- porta nella bozza condivisa ---------- */

document.getElementById('inBozza').onclick = async () => {
  const stato = document.getElementById('statoBozza');
  await avvia();
  if (!collegato()) {
    stato.textContent = 'Per scrivere nella bozza devi entrare col tuo account, dalla pagina Bozza.';
    return;
  }
  stato.textContent = 'Scrivo…';
  try {
    const r = await leggiDb('bozza', { giocatori: [] });
    const ora = new Date().toISOString();
    const chi = utente()?.nome || 'il consigliere';
    const giocatori = RUOLI.flatMap(x => risultato.rosa[x]).map(p => ({
      id: asta.id(p), n: p.n, sq: p.sq, r: p.r, prezzo: prezzo(p), chi, quando: ora,
    }));
    await scriviDb('bozza', { giocatori }, r.versione, (remoto, locale) => locale);
    stato.textContent = `Fatti: ${giocatori.length} giocatori nella bozza condivisa.`;
    toast('Rosa portata nella Bozza');
  } catch (e) {
    stato.textContent = 'Non ci sono riuscito: ' + e.message;
  }
};

calcola();
