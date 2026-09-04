/* Pagina "La guida".

   Regola di questa pagina: NESSUN numero e nessun nome di giocatore scritto a
   mano. Prima c'erano — 500 crediti, 4-5-1, la ripartizione 60/135/145/160,
   undici nomi nel campetto — e bastava cambiare una impostazione perche' la
   guida raccontasse un'asta che non era piu' la tua. Adesso legge le
   impostazioni condivise e fa comporre la rosa allo stesso consigliere della
   pagina "Rosa ideale", quindi le due pagine non possono contraddirsi. */
import {
  caricaDati, caricaInfortuni, ricalcola, asta, badgeRuolo, simulaModificatore,
  RUOLI, NOME_RUOLO, CLASSE_VERDETTO, fuoriListone,
} from './app.js?v=5df970e3';
import { leggiCfg } from './cfg.js?v=7661d252';
import { valuta, tabellaModificatore, componiRosa, STRATEGIE, titolariDi } from './consiglio.js?v=6078dfa9';
import { esc } from './db.js?v=6824e6b7';

const { players, lega } = await caricaDati();
const { cfg } = await leggiCfg(lega);
ricalcola(players, cfg, cfg.piano);

const infortuni = await caricaInfortuni();
const info = valuta(players, infortuni.per);

const mod = cfg.modificatoreDifesa;
const modAttivo = mod?.attivo !== false;
const tab = tabellaModificatore(mod);
const titolari = titolariDi(cfg.modulo);
const strategia = STRATEGIE[cfg.strategia] || STRATEGIE.totale;
const consigliata = componiRosa({ players, cfg, modulo: cfg.modulo, strategia: cfg.strategia, tab });

const prezzo = p => Math.max(1, Math.round(p.mkt));
/* numeri all'italiana: la virgola, e il meno vero al posto del trattino */
const num = (x, dec = 2) => x.toFixed(dec).replace('.', ',').replace('-', '−');
const slotTot = RUOLI.reduce((a, r) => a + cfg.slot[r], 0);
const testo = (id, s) => { const e = document.getElementById(id); if (e) e.textContent = s; };
const html = (id, s) => { const e = document.getElementById(id); if (e) e.innerHTML = s; };

/* ---------- testata ---------- */

html('kicker', `<span>Serie A ${esc(lega.stagione)}</span><span>·</span><span>${esc(lega.nome)}</span>
  <span>·</span><b>${cfg.crediti} crediti · ${cfg.squadre} squadre · rosa ${slotTot}</b>`);

/**
 * Su cosa gira la tua asta, viste le TUE scelte.
 *
 * Non basta guardare se il modificatore e' acceso: se hai scelto la strategia
 * "tutto sull'attacco", o un modulo che il modificatore non attiva nemmeno,
 * una guida che apre con «la tua asta si vince in difesa» ti sta raccontando
 * l'asta di qualcun altro. Da qui esce il titolo, e da qui in poi tutta la
 * pagina si accorda.
 */
const modUsabile = modAttivo && titolari.D >= mod.minDifensori;
const asse = !modUsabile ? 'attacco'
  : cfg.strategia === 'attacco' ? 'attacco'
    : cfg.strategia === 'centrocampo' ? 'centrocampo'
      : 'difesa';

const puntiMax = modAttivo ? Math.max(...mod.tabella.map(x => x[1])) : 0;

html('titolo', {
  difesa: 'La tua asta si vince <em>in difesa</em>.',
  attacco: 'La tua asta si vince <em>sui bonus</em>.',
  centrocampo: 'La tua asta si vince <em>a centrocampo</em>.',
}[asse]);

html('occhiello', {
  difesa:
    `Gli altri ${cfg.squadre - 1} arrivano all'asta con i crediti stretti in mano per l'attacco. Ma nella
     tua lega il modificatore di difesa vale fino a <strong>+${puntiMax} punti a giornata, senza mai un
     malus</strong>, e la chiamata parte dai portieri — quando nessuno vuole ancora spendere. Questo è il
     piano per comprare quel vantaggio mentre gli altri guardano altrove.`,
  attacco: !modAttivo
    ? `Nelle impostazioni il modificatore di difesa risulta spento, quindi i punti arrivano tutti dai
       singoli: gol, assist e voti. Il piano qui sotto è tarato su questo — niente sovrapprezzo per la
       difesa, crediti dove si producono bonus.`
    : titolari.D < mod.minDifensori
      ? `Hai scelto il <strong>${esc(cfg.modulo)}</strong>, che schiera ${titolari.D} difensori: sotto i
         ${mod.minDifensori} che il modificatore richiede, quindi quel bonus per te non scatta mai. È una
         scelta legittima, ma cambia tutto il resto — i crediti vanno dove si producono gol e assist, e la
         difesa serve solo a non prendere malus. Il piano qui sotto è tarato su questo.`
      : `Hai scelto la strategia <strong>tutto sull'attacco</strong>: il modificatore resta attivo ma pesa
         poco nelle scelte, e i crediti vanno dove si producono bonus. Il piano qui sotto è tarato su
         questo — se vuoi vedere l'altra faccia, prova la strategia «modificatore di difesa» nelle
         <a href="altro.html#impostazioni">impostazioni</a>.`,
  centrocampo:
    `Hai scelto di puntare sul <strong>centrocampo</strong>: nel listone Classic decine di trequartisti ed
     esterni offensivi sono classificati come centrocampisti, quindi quegli slot comprano attaccanti veri a
     prezzo di mediani. Il piano qui sotto è tarato su questo.`,
}[asse]);

const liberi = players.length - slotTot * cfg.squadre;
html('stats', [
  [cfg.crediti, 'Crediti'],
  [slotTot, `Slot · ${RUOLI.map(r => cfg.slot[r]).join('-')}`],
  [Math.max(0, liberi), `Su ${players.length} restano liberi`],
  modAttivo ? [`+${Math.max(...mod.tabella.map(x => x[1]))}`, 'Modificatore max'] : ['—', 'Modificatore spento'],
].map(([v, l]) => `<div class="stat"><div class="v">${esc(String(v))}</div><div class="l">${esc(l)}</div></div>`).join(''));

/* ---------- la tesi, e il grafico della difesa ---------- */

function disegnaBarre(el, scenari, max) {
  if (!el) return;
  const tetto = max || Math.max(0.1, ...scenari.map(s => s.v)) * 1.12;
  el.innerHTML = scenari.map(s => `
    <div class="brow">
      <div class="blab">${esc(s.l)}<small>${esc(s.s)}</small></div>
      <div class="btrack">
        <div class="bfill" style="width:0;background:var(${s.c})" data-w="${(s.v / tetto * 100).toFixed(1)}"
             title="${esc(s.l)}: ${s.v.toFixed(2)} punti a giornata, ${Math.round(s.v * 38)} in stagione"></div>
        <div class="bval">${s.v.toFixed(2)} <span>pt/giornata · ${Math.round(s.v * 38)} in stagione</span></div>
      </div>
    </div>`).join('');
  requestAnimationFrame(() => el.querySelectorAll('.bfill').forEach(b => { b.style.width = b.dataset.w + '%'; }));
}

const sezDifesa = document.getElementById('figDifesa');

if (modAttivo) {
  const soglie = mod.tabella.filter(x => x[0] > 0);
  html('tesi1', `La tabella della tua lega parte da zero e sale:
    ${soglie.map(([m, p]) => `a ${m.toFixed(2).replace('.', ',')} prendi +${p}`)
      .filter((_, i, a) => i === 0 || a[i] !== a[i - 1]).join(', ')}.
    Sotto il minimo non perdi nulla: non esiste un solo scenario in cui la difesa ti toglie punti.
    Il calcolo si fa sulla media dei <strong>${mod.migliori} migliori difensori${mod.includiPortiere ? ' più il portiere' : ''}</strong>,
    sul voto puro, e richiede almeno ${mod.minDifensori} difensori in campo con voto valido.`);

  /* Le quattro righe non sono numeri scritti a mano: sono la stessa tabella
     che usa il consigliere, letta a quattro livelli di media voto. Se cambi
     le regole del modificatore, il grafico cambia con loro. */
  const nD = Math.max(mod.minDifensori, titolari.D);
  const livelli = [
    { l: 'Difesa costruita', s: 'i migliori del listone, portiere di una difesa top', mv: 6.55, c: '--bar1' },
    { l: 'Difesa buona', s: 'titolari solidi, portiere di media classifica', mv: 6.35, c: '--bar2' },
    { l: 'Difesa media', s: 'il reparto riempito senza criterio', mv: 6.15, c: '--bar3' },
    { l: 'Difesa raccattata', s: 'quello che avanza a 1 credito', mv: 5.95, c: '--bar4' },
  ].map(x => ({ ...x, v: tab.perGiornata(x.mv, nD) }));

  disegnaBarre(document.getElementById('bars'), livelli);
  testo('fsub1', `Media per giornata schierando ${nD} difensori, secondo la tabella della tua lega. Venti­mila giornate simulate per ogni livello.`);
  const divario = Math.round((livelli[0].v - livelli.at(-1).v) * 38);
  html('faxis1', `Il divario tra la prima e l'ultima riga vale <strong>${divario} punti in una stagione</strong>:
    più o meno quello che ti darebbe un attaccante da venti gol rispetto a uno da sei. Solo che l'attaccante
    da venti gol costa un terzo del tuo budget, e questa difesa no.`);

  /* I due "dettagli" erano numeri scritti a mano (+0,48 e +0,31) misurati su
     una configurazione che poteva non essere piu' la tua. Adesso li misuro qui,
     con la tabella e il modulo di adesso. */
  const perGiornata = (mvDif, mvPor, n) =>
    simulaModificatore(Array(n).fill(mvDif), mvPor, mod).perGiornata;

  const guadagnoPortiere = perGiornata(6.35, 6.55, nD) - perGiornata(6.35, 6.15, nD);
  html('dettaglio1', `Due dettagli che cambiano la spesa più di quanto sembri. Il primo:
    <strong>il portiere pesa per un quarto della media</strong>. Con la stessa difesa, passare da un
    portiere medio a uno da difesa solida vale <strong>+${num(guadagnoPortiere)} punti a
    giornata</strong> — ${Math.round(guadagnoPortiere * 38)} punti a stagione presi da un solo slot che i
    tuoi avversari considereranno un ripiego. E nella tua lega la porta inviolata vale
    ${num(lega.bonus?.portaInviolata ?? 0, 0)} mentre ogni gol subito vale
    ${num(lega.bonus?.golSubito ?? -1, 0)}: il portiere di una squadra che subisce molto è un disastro
    doppio.`);

  /* Il secondo dettaglio dice quanto vale un difensore in piu'. Va detto come
     un dato, non come un consiglio: se hai gia' scelto il modulo, «costruisci
     la rosa per giocarne cinque» ti sta dicendo di rifare la scelta, ed e'
     esattamente la frase che rendeva la vecchia guida piena di refusi. */
  const conUnoInPiu = perGiornata(6.35, 6.35, nD + 1) - perGiornata(6.35, 6.35, nD);
  const piuDifensivi = lega.moduli.filter(m => titolariDi(m).D > titolari.D);

  html('dettaglio2', !piuDifensivi.length
    ? `Il secondo: col <strong>${esc(cfg.modulo)}</strong> sei già al massimo di difensori che la tua lega
       consente. Il calcolo prende i ${mod.migliori} migliori, ogni domenica scarti i voti peggiori, e la
       clausola che azzera tutto sotto ${mod.minDifensori} voti validi non ti tocca quasi mai.`
    : asse === 'difesa'
      ? `Il secondo: <strong>un difensore in più in campo vale ${conUnoInPiu >= 0 ? '+' : ''}${num(conUnoInPiu)}
         punti a giornata</strong>, perché il calcolo prende i ${mod.migliori} migliori e con uno in più
         scarti il voto peggiore, e ti mette al riparo dalla clausola che azzera tutto sotto
         ${mod.minDifensori} voti validi. Col ${esc(cfg.modulo)} ne schieri ${nD}; se vuoi quel margine, la
         tua lega ammette anche ${esc(piuDifensivi.join(' e '))}.`
      : `Il secondo, per completezza: un difensore in più in campo varrebbe
         ${conUnoInPiu >= 0 ? '+' : ''}${num(conUnoInPiu)} punti a giornata, perché il calcolo prende i
         ${mod.migliori} migliori e scarti il voto peggiore. Col ${esc(cfg.modulo)} ne schieri ${nD} e hai
         deciso di spendere quel margine altrove: è una scelta, non una svista — ma è il numero da tenere
         in testa se un giorno cambi idea.`);
} else {
  html('tesiTit', 'Senza modificatore, contano solo i bonus');
  html('tesi1', `Nelle impostazioni il modificatore di difesa è spento. La difesa produce comunque voti, ma
    non c'è nessun premio per averla costruita bene: ogni credito speso dietro va giudicato solo per i gol
    e gli assist che quel difensore porta. Il resto della guida ne tiene conto.`);
  testo('tesi2', '');
  html('dettaglio1', `Questo cambia due abitudini. Il portiere torna a essere uno slot da riempire al
    minimo: nella tua lega la porta inviolata vale ${lega.bonus?.portaInviolata ?? 0}, quindi da lì non
    arriva niente. E i difensori valgono solo per i gol e gli assist che fanno, cioè pochissimi.`);
  html('dettaglio2', `Il posto dove trovare punti a buon mercato diventa il centrocampo: nel listone
    Classic decine di trequartisti ed esterni offensivi sono classificati come centrocampisti, e su quegli
    slot compri bonus da attaccante a prezzo di mediano.`);
  if (sezDifesa) sezDifesa.style.display = 'none';
}

html('tesiTit', !modAttivo
  ? 'Senza modificatore, contano solo i bonus'
  : asse === 'difesa'
    ? 'Un modificatore senza malus è denaro gratis'
    : 'Il modificatore c\'è, anche se non è la tua strada');

/* L'arbitraggio: nomi veri, presi dai dati di oggi invece che da una frase
   scritta ad agosto.
   Attenzione a come si scelgono i "nessuno li vuole": ordinare per punti al
   credito mette in cima i giocatori da 1 credito, che rendono pochissimo — e
   il paragone diventa ridicolo invece che convincente. Vanno presi fra quelli
   che rendono davvero: prima si tiene la meta' migliore per punti, e solo li'
   dentro si cerca chi costa poco. */
const conValore = r => players.filter(p => p.r === r && p.val > 0).sort((a, b) => b.val - a.val);

const contesi = ['A', 'C'].flatMap(r => conValore(r).slice(0, 6))
  .sort((a, b) => b.mkt - a.mkt).slice(0, 2);

const buoniDietro = ['D', 'P'].flatMap(r => conValore(r).slice(0, Math.ceil(cfg.slot[r] * cfg.squadre / 2)));
const ignorati = buoniDietro.sort((a, b) => b.val / prezzo(b) - a.val / prezzo(a)).slice(0, 3);

const puntiPerCredito = p => p.val / prezzo(p);
const rapporto = ignorati.length && contesi.length
  ? puntiPerCredito(ignorati[0]) / Math.max(0.01, puntiPerCredito(contesi[0]))
  : 0;

html('arbitraggio', `<strong>Il vero arbitraggio non è nella matematica, è nel prezzo.</strong>
  Su ${contesi.map(p => `<strong>${esc(p.n)}</strong>`).join(' e ')} si scatenano tutti e ${cfg.squadre},
  e il prezzo finisce sopra il valore: ${contesi.map(p => `${prezzo(p)} crediti per ${Math.round(p.val)} punti`).join(', ')}.
  Su ${ignorati.map(p => `<strong>${esc(p.n)}</strong>`).join(', ')} non litiga nessuno:
  ${ignorati.map(p => `${prezzo(p)} per ${Math.round(p.val)}`).join(', ')}.
  ${rapporto >= 1.5
    ? `A parità di credito speso il secondo gruppo ti dà <strong>${num(rapporto, 1)} volte</strong> i punti
       del primo. Compri la stessa quantità di punti pagandola una frazione.`
    : `I due gruppi rendono più o meno lo stesso per credito: in questa lega, con queste quote, l'occasione
       dietro non c'è — ed è un'informazione utile quanto il contrario.`}`);

/* ---------- il piano di spesa ---------- */

const pianoTot = RUOLI.reduce((a, r) => a + cfg.piano[r], 0);
const quota = r => Math.round(cfg.piano[r] / Math.max(1, pianoTot) * 100);

testo('pianoTit', `Come spendere i ${cfg.crediti}`);
html('pianoIntro', `La ripartizione qui sotto è quella salvata nelle
  <a href="altro.html#impostazioni">impostazioni</a>, tarata sul tuo formato: ${cfg.squadre} squadre,
  ${slotTot} slot, modificatore ${modAttivo ? 'attivo' : 'spento'}. Se la cambi lì, questa pagina la segue.`);

/* Il consiglio per reparto non e' un testo fisso: descrive cosa ha fatto
   davvero il consigliere con quei crediti, quindi non puo' contraddirlo. */
html('plan', RUOLI.map(r => {
  const lista = consigliata.rosa[r];
  const titolariR = titolari[r] || 0;
  const spesaTit = lista.slice(0, titolariR).reduce((a, p) => a + prezzo(p), 0);
  const caro = lista[0];
  const evidenza = modAttivo && (r === 'P' || r === 'D');
  return `<div class="pcard${evidenza ? ' hi' : ''}"><div class="rl">${NOME_RUOLO[r]} · ${cfg.slot[r]} slot</div>
    <div class="cr">${cfg.piano[r]}<small> cr · ${quota(r)}%</small></div>
    <div class="sh">${titolariR
      ? `${titolariR} ${titolariR === 1 ? 'titolare' : 'titolari'} da schierare ogni domenica, per
         ${spesaTit} crediti, e ${cfg.slot[r] - titolariR} di copertura con quel che resta.
         Il pezzo grosso del reparto è <strong>${esc(caro?.n || '—')}</strong> a ${caro ? prezzo(caro) : 0} crediti.`
      : `Nessun titolare in questo modulo: sono ${cfg.slot[r]} slot di sola copertura, da riempire al minimo.`}</div></div>`;
}).join(''));

html('pianoNota', pianoTot === cfg.crediti
  ? `Il piano somma esattamente a ${cfg.crediti}. Se un reparto chiude sotto, il residuo scivola su quello
     successivo — mai al contrario. E i crediti che avanzano non sono sprecati: restano disponibili per
     svincoli e riparazione, dove venti crediti a gennaio comprano un titolare vero.`
  : `<strong style="color:var(--warn)">Attenzione: il piano somma a ${pianoTot} invece di ${cfg.crediti}.</strong>
     Correggilo nelle <a href="altro.html#impostazioni">impostazioni</a>, altrimenti i tetti del listone sono tarati male.`);

/* ---------- la rosa consigliata ---------- */

testo('rosaTit', `Le ${slotTot} scelte, con il ${cfg.modulo} in testa`);

const nD = titolari.D;
const sottoMinimo = modAttivo && nD < mod.minDifensori;

html('rosaIntro1', !modAttivo
  ? `Il ${cfg.modulo} è la formazione salvata nelle impostazioni. Senza modificatore la difesa vale solo
     per i voti e i bonus dei singoli, quindi il budget si sposta dove i bonus sono più frequenti.`
  : sottoMinimo
    ? `Attenzione: il ${cfg.modulo} schiera ${nD} difensori e il modificatore ne vuole almeno
       ${mod.minDifensori}. Giocando così <strong>il bonus non scatta mai</strong> — rinunci in partenza a
       un'ottantina di punti a stagione, che nella tua lega è tanto. La rosa qui sotto ne tiene conto e
       sposta i crediti dove servono davvero, ma se puoi permetterti un difensore in più, permettitelo.`
    : nD === mod.minDifensori
      ? `Il ${cfg.modulo} e il modificatore tirano in direzioni opposte: ${nD} difensori sono il minimo
         consentito, e se uno resta senza voto e la panchina non lo copre il modificatore si azzera per
         intero. In cambio, i ${titolari.C} slot di centrocampo comprano attaccanti veri a prezzo di
         mediani, perché nel listone Classic decine di trequartisti sono classificati come centrocampisti.`
      : `Il ${cfg.modulo} schiera ${nD} difensori, ${nD - mod.minDifensori} sopra il minimo del
         modificatore: ogni domenica scarti i voti peggiori e il rischio di azzerare tutto per un voto
         mancante quasi sparisce. Costa uno slot offensivo, e la rosa qui sotto tiene conto dello scambio.`);

html('rosaIntro2', `La rosa qui sotto non è una lista scritta a mano: la compone il
  <a href="rosa.html#ideale">consigliere</a> con la strategia <strong>${esc(strategia.nome)}</strong>,
  provando migliaia di scambi finché non trova la combinazione che rende di più con
  ${cfg.crediti} crediti. Cambia modulo o strategia nelle <a href="altro.html#impostazioni">impostazioni</a>
  e questa pagina si riscrive.`);

/* grafico: il modulo scelto contro le alternative permesse dalla lega */
if (modAttivo) {
  const COLORI = ['--bar1', '--bar2', '--bar3', '--bar4'];
  const mediaDif = (() => {
    const d = consigliata.rosa.D.slice(0, Math.max(1, nD)).map(p => p.mvAtt);
    const por = consigliata.rosa.P[0]?.mvAtt ?? 6;
    return (d.reduce((a, b) => a + b, 0) + por) / (d.length + 1);
  })();

  /* Il grafico ne mostra al massimo quattro, ma il tuo modulo ci deve stare
     sempre: altrimenti la didascalia sotto direbbe che non attiva il
     modificatore solo perche' e' finito fuori dalla lista. */
  const ammessi = lega.moduli
    .map(m => ({ m, d: titolariDi(m).D }))
    .filter(x => x.d >= mod.minDifensori)
    .map(x => ({ ...x, v: tab.perGiornata(mediaDif, x.d) }))
    .sort((a, b) => b.v - a.v);

  const mio = ammessi.find(x => x.m === cfg.modulo);
  const assetti = ammessi.slice(0, 4);
  if (mio && !assetti.includes(mio)) assetti.splice(3, 1, mio);

  const sotto = lega.moduli.filter(m => titolariDi(m).D < mod.minDifensori);

  disegnaBarre(document.getElementById('bars2'), assetti.map((x, i) => ({
    l: `${x.m} · ${x.d} difensori`,
    s: x.m === cfg.modulo ? 'il tuo assetto' : 'alternativa consentita dalla lega',
    v: x.v, c: COLORI[i] || '--bar4',
  })));

  testo('fsub2', `Punti medi a giornata con la difesa che il consigliere ti compone, media voto attesa ${mediaDif.toFixed(2)}.`);
  const tuo = mio;
  const migliore = ammessi[0];
  /* mezzo punto a stagione non e' una differenza: sotto quella soglia i due
     assetti si equivalgono e dirlo e' piu' onesto che stampare "0 in piu'" */
  const divarioAssetti = Math.round(((migliore?.v ?? 0) - (tuo?.v ?? 0)) * 38);

  /* Tre casi diversi, e vanno detti diversamente: il tuo modulo non arriva al
     minimo di difensori e quindi non compare nemmeno nel grafico; il tuo
     modulo c'e' ma non e' il migliore; il tuo modulo e' il migliore. */
  html('faxis2', !tuo
    ? `Il tuo <strong>${esc(cfg.modulo)}</strong> non compare qui sopra: con ${nD} difensori resta sotto il
       minimo di ${mod.minDifensori} e il modificatore non scatta, quindi per te queste barre valgono
       <strong>zero</strong>. Il migliore fra gli assetti che lo attivano è il ${esc(migliore.m)}, che ne
       renderebbe ${Math.round(migliore.v * 38)} in stagione: è quanto ti costa la scelta.`
    : divarioAssetti > 2
      ? `Col <strong>${esc(cfg.modulo)}</strong> il modificatore rende ${Math.round(tuo.v * 38)} punti in
         stagione; col ${esc(migliore.m)} ne renderebbe ${Math.round(migliore.v * 38)}, cioè
         ${divarioAssetti} in più. È il prezzo che paghi per lo slot offensivo in più — sta a te dire se
         quello slot te li restituisce.`
      : `Col <strong>${esc(cfg.modulo)}</strong> il modificatore rende ${Math.round(tuo.v * 38)} punti in
         stagione: quanto il migliore degli assetti che la tua lega consente${divarioAssetti > 0 ? ' a meno di un paio di punti' : ''}.
         Da questo lato non stai lasciando niente sul tavolo${sotto.length ? `, e ${esc(sotto.join(', '))} ${sotto.length === 1 ? 'resta' : 'restano'} sotto il minimo di ${mod.minDifensori} difensori` : ''}.`);
}

/* ---------- l'undici ---------- */

html('undiciNota', `I ${Object.values(titolari).reduce((a, b) => a + b, 0)} che il consigliere schiererebbe
  col ${esc(cfg.modulo)}: in ogni reparto i giocatori che valgono di più fra quelli che ti fa comprare.`);

const riga = lista => `<div class="prow">${lista.map(p => `<div class="pp"><span>${esc(p.n)}</span></div>`).join('')
  || '<div class="pp" style="opacity:.45">—</div>'}</div>`;

html('campo', `<div class="pitch">${RUOLI.map(r =>
  riga(consigliata.rosa[r].slice(0, titolari[r] || 0))).join('')}</div>`);

/* ---------- la rosa completa ---------- */

html('rosaNota', `<strong>${consigliata.costo} crediti</strong> spesi,
  <strong>${consigliata.avanzo} di tesoretto</strong> per svincoli e riparazione. La colonna
  <em>mercato</em> è quanto quel giocatore costerà agli altri; <em>punti</em> è quanto rende in una stagione
  <em>in più</em> di un giocatore da un credito. Il totale fa
  ${Math.round(consigliata.puntiTitolari + consigliata.puntiModificatore)} punti.`);

const ETICHETTA = [['Titolare', 'rt'], ['Primo cambio', 'rc'], ['Copertura', 'rr']];

document.getElementById('rosaBody').innerHTML = RUOLI.map(r => {
  const lista = consigliata.rosa[r];
  const nTit = titolari[r] || 0;
  const spesa = lista.reduce((a, p) => a + prezzo(p), 0);
  return `<tr class="grp" data-r="${r}"><td colspan="5">${badgeRuolo(r)}${NOME_RUOLO[r]} ·
      ${lista.length} slot · <b>${spesa} crediti</b></td></tr>`
    + lista.map((p, i) => {
      const [nome, cls] = i < nTit ? ETICHETTA[0] : i < nTit + 2 ? ETICHETTA[1] : ETICHETTA[2];
      const ko = infortuni.per.get(asta.id(p));
      return `<tr>
        <td>${badgeRuolo(p.r)}<span class="nm">${esc(p.n)}</span> <span class="sq">${esc(p.sq)}</span></td>
        <td><span class="pill ${cls}">${nome}</span></td>
        <td class="num mktc">${prezzo(p)}</td>
        <td class="num maxc">${Math.round(p.val)}</td>
        <td class="note">${ko ? `<strong>Fermo:</strong> ${esc(ko.motivo || ko.tipo)}. ` : ''}${esc(p.nota || '—')}</td></tr>`;
    }).join('');
}).join('');

/* ---------- i bivi, dedotti dalla rosa vera ---------- */

const tutti = RUOLI.flatMap(r => consigliata.rosa[r]);
const piuCaro = tutti.slice().sort((a, b) => prezzo(b) - prezzo(a))[0];
const perClub = {};
for (const p of tutti) (perClub[p.sq] ||= []).push(p);
const concentrato = Object.entries(perClub).sort((a, b) => b[1].length - a[1].length)[0];
const fermi = tutti.filter(p => infortuni.per.has(asta.id(p)));

html('bivi', `<p><strong>Tre cose da tenere a mente, lette su questa rosa.</strong></p>
  <p style="margin-top:.6rem"><b>Il pezzo grosso.</b> ${esc(piuCaro.n)} a ${prezzo(piuCaro)} crediti è il
    ${Math.round(prezzo(piuCaro) / cfg.crediti * 100)}% del budget: se all'asta parte una guerra e supera
    quella cifra, esci. Il piano non regge se un solo nome se ne porta via di più.</p>
  <p style="margin-top:.6rem"><b>Concentrazione${concentrato[1].length >= 3 ? '' : ' sotto controllo'}.</b>
    ${concentrato[1].length} giocatori dal ${esc(concentrato[0])} (${concentrato[1].map(p => esc(p.n)).join(', ')}).
    ${concentrato[1].length >= 3
      ? 'Una brutta serie di quella squadra ti trascina giù su più reparti insieme: se i primi due li prendi a poco, il terzo prendilo altrove.'
      : 'Nessun club pesa troppo sulla rosa, il rischio è distribuito.'}</p>
  <p style="margin-top:.6rem"><b>Chi è fermo adesso.</b>
    ${fermi.length
      ? `${fermi.length} in rosa: ${fermi.map(p => esc(p.n)).join(', ')}. I prezzi qui sopra ne tengono già
         conto — vedi la pagina <a href="altro.html#infortunati">infortunati</a> per i tempi di rientro.`
      : 'Nessuno dei consigliati è infortunato o squalificato in questo momento.'}</p>`);

/* ---------- regole operative: i numeri che cambiano ---------- */

testo('difTit', modAttivo ? 'Difensori che giocano, non nomi' : 'Slot di copertura, non nomi');
html('difTesto', modAttivo
  ? `Il modificatore si azzera se in campo non hai ${mod.minDifensori} voti validi in difesa, e i cambi sono
     solo tra pari ruolo. Ti servono almeno ${Math.min(cfg.slot.D, titolari.D + 2)} difensori titolari veri;
     i restanti ${Math.max(0, cfg.slot.D - titolari.D - 2)} sono assicurazione da 1 credito.`
  : `Senza modificatore un difensore che non gioca ti costa solo lo slot. Riempi i ${cfg.slot.D} posti al
     minimo e sposta i crediti dove si producono bonus.`);

/* i checkpoint sono il piano di spesa letto al contrario */
let residuo = cfg.crediti;
const check = {};
for (const r of RUOLI) { residuo -= cfg.piano[r]; check['ck' + r] = residuo; }
for (const el of document.querySelectorAll('[data-cfg]')) {
  if (el.dataset.cfg in check) el.textContent = check[el.dataset.cfg];
}

const portiere = consigliata.rosa.P[0];
html('regolaPortieri', `Si parte da lì e tutti hanno il portafoglio pieno: o si strapaga il primo estratto
  o lo si regala. Tu hai un obiettivo solo — uscire con un portiere che il modello considera buono
  ${portiere ? `(il consigliere ti indica <strong>${esc(portiere.n)}</strong> a ${prezzo(portiere)})` : ''}
  e non più di <strong>${cfg.piano.P} crediti</strong> spesi in tutto il reparto.`);

const bigs = players.slice().sort((a, b) => b.mkt - a.mkt).slice(0, 2);
html('regolaGuerra', `Due fantallenatori che si sfidano su
  ${bigs.map(p => `<strong>${esc(p.n)}</strong>`).join(' o ')} stanno bruciando
  ${Math.round(bigs[0].mkt / cfg.crediti * 100)}% del loro budget su un giocatore solo. Il tuo compito non è
  vincere quel duello: è incassare il fatto che l'hanno vinto, e comprare a poco quello che lasciano.`);

testo('quantiGiocatori', `I ${players.length} giocatori`);

/* ---------- come è costruito ---------- */

html('comeCostruito', `<strong>Come è stato costruito.</strong> Quotazioni dal listone ufficiale della tua
  lega. Il <em>mercato atteso</em> ripartisce il monte crediti di lega (${cfg.crediti * cfg.squadre}) sui
  ${slotTot * cfg.squadre} giocatori che verranno acquistati, con una curva sulle quotazioni e uno split di
  reparto di ${RUOLI.map(r => (cfg.quotaMercato[r] * 100).toFixed(1).replace('.0', '').replace('.', ','))
    .join(' / ')} per cento, che è come descrivi la tua lega nelle
  <a href="altro.html#impostazioni">impostazioni</a>. I punti attesi tengono conto dei voti veri di questa
  stagione per il ${Math.round(info.peso * 100)}% — ${info.giornate} ${info.giornate === 1 ? 'giornata giocata' : 'giornate giocate'} — e per il resto della fascia del giocatore.`);

/* ---------- shortlist per reparto ---------- */

const contTab = document.getElementById('tabs');
const corpoShort = document.querySelector('#short tbody');

/* Prima erano quattro liste di nomi scritte a mano, che invecchiavano al primo
   aggiornamento del listone.
 *
 * Poi sono diventate «chi rende di piu' per credito speso», ed era peggio: a
 * costo uno il rapporto punti/prezzo esplode, quindi in cima finivano i
 * portieri di riserva da un credito che rendono nove punti, davanti a Svilar.
 * Matematicamente giusto, praticamente inutile — quella non e' una lista di
 * chi comprare, e' una lista di chi non serve a nessuno.
 *
 * Adesso la domanda e' un'altra, ed e' quella che si fa davvero al tavolo:
 * dove il MIO tetto batte il prezzo che pagheranno gli altri? Quel divario
 * sono crediti di vantaggio, e si ordina per quello. Chi non ha vantaggio non
 * compare: se in un ruolo ce ne sono sette e non diciotto, e' un'informazione,
 * non un buco da riempire.
 *
 * Si guarda solo fra quelli che verranno davvero comprati (dieci squadre per
 * tre portieri fanno trenta portieri): oltre quella soglia non li vuole
 * nessuno, e un «vantaggio» su un giocatore che resta invenduto non esiste.
 */
function disegnaShortlist(r) {
  const comprati = cfg.squadre * cfg.slot[r];
  const seRVono = players.filter(p => p.r === r && !fuoriListone(p))
    .sort((a, b) => b.val - a.val)
    .slice(0, comprati);

  const lista = seRVono
    .filter(p => p.max > prezzo(p))
    .sort((a, b) => (b.max - prezzo(b)) - (a.max - prezzo(a)) || b.val - a.val)
    .slice(0, 18);

  const nota = document.getElementById('shortNota');
  if (nota) {
    nota.innerHTML = lista.length
      ? `In questo reparto il tuo tetto batte il mercato su <strong>${lista.length}</strong>
         giocator${lista.length === 1 ? 'e' : 'i'} dei ${comprati} che verranno comprati.
         Il <em>vantaggio</em> è di quanti crediti: è lì che guadagni, ed è per quello che sono in
         quest'ordine.`
      : `In questo reparto non c'è nessun giocatore su cui il tuo tetto batta il mercato: il tuo
         piano destina pochi crediti qui, quindi li prenderai al minimo o li lascerai andare.
         È una conseguenza della strategia che hai scelto, non un errore.`;
  }

  corpoShort.innerHTML = lista.map(p => `<tr>
      <td>${badgeRuolo(p.r)}<span class="nm">${esc(p.n)}</span><br><span class="sq">${esc(p.sq)}</span></td>
      <td class="num mktc">${p.q}</td>
      <td class="num mktc">${prezzo(p)}</td>
      <td class="num maxc">${p.max}</td>
      <td class="num"><strong style="color:var(--acc)">+${p.max - prezzo(p)}</strong></td>
      <td><span class="pill ${CLASSE_VERDETTO[p.v] || 'p-g'}">${esc(p.v)}</span></td>
      <td class="note">${esc(p.nota || '—')}</td></tr>`).join('')
    || `<tr><td colspan="7" class="note" style="color:var(--ink3)">Nessuno su cui hai un vantaggio di prezzo.</td></tr>`;
}

if (contTab) {
  RUOLI.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === 0));
    b.textContent = `${NOME_RUOLO[r]} · ${cfg.piano[r]} cr`;
    b.onclick = () => {
      [...contTab.children].forEach(x => x.setAttribute('aria-selected', String(x === b)));
      disegnaShortlist(r);
    };
    contTab.appendChild(b);
  });
  disegnaShortlist('P');
}
