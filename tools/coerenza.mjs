/* Controllo di coerenza fra le pagine del sito.
 *
 * Serve a una cosa sola: accorgersi dei refusi prima che li veda Pierre.
 * Un refuso qui non e' un errore di JavaScript — il sito funziona benissimo
 * mentre la guida dice "500 crediti" e le impostazioni ne dicono 700. Il solo
 * modo di trovarli e' aprire davvero le pagine e confrontare i numeri.
 *
 * Uso:
 *     python3 -m http.server 8123 &
 *     node tools/coerenza.mjs [indirizzo]
 *
 * Esce con codice 1 se qualcosa non torna, cosi' si puo' incatenare a un
 * commit o a una GitHub Action.
 */
import { fileURLToPath } from 'node:url';
import { playwright, chromium, spiegazione } from './playwright.mjs';

const BASE = process.argv[2] || 'http://localhost:8123/';

/* Le quattro pagine vere. Le altre otto (fasce.html, lega.html, index.html…)
   restano come rimandi, perche' quegli indirizzi possono essere nei segnalibri
   di qualcuno della lega: si controllano a parte, piu' sotto. */
const PAGINE = ['listone.html', 'rosa.html', 'squadre.html', 'altro.html'];
const VOCI_MENU = PAGINE.length;

/* Ogni scheda dentro le pagine a linguette: si aprono una per una, perche' il
   loro modulo si carica solo quando la si guarda. */
const SCHEDE = [
  ['rosa.html', ['rosa', 'bozza', 'ideale']],
  ['altro.html', ['guida', 'fasce', 'infortunati', 'fantasquadre', 'lega', 'impostazioni']],
];

/* Gli indirizzi vecchi e dove devono portare. */
const RIMANDI = {
  'index.html': 'altro.html#guida',
  'fasce.html': 'altro.html#fasce',
  'infortunati.html': 'altro.html#infortunati',
  'fantasquadre.html': 'altro.html#fantasquadre',
  'lega.html': 'altro.html#lega',
  'impostazioni.html': 'altro.html#impostazioni',
  'bozza.html': 'rosa.html#bozza',
  'rosaideale.html': 'rosa.html#ideale',
};

/* rumore di fondo del banco di prova, non difetti del sito: in locale non c'e'
   ne' rete verso i font ne' il database */
const RUMORE = /fonts\.(googleapis|gstatic)|:8766|ERR_TUNNEL|ERR_CONNECTION_REFUSED|Failed to load resource|infortuni\.json/;

const problemi = [];
const nota = t => problemi.push(t);

/* ---------- 0. i moduli si leggono davvero ----------
   `node --check nomefile.js` NON basta: tratta il file come CommonJS e lascia
   passare errori che poi il browser trova. Vanno controllati come moduli, che
   e' il modo in cui il sito li carica davvero. Una parentesi di troppo in un
   file e la pagina resta bianca. */
{
  const { readdir, readFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const dir = new URL('../assets/', import.meta.url);
  const files = (await readdir(dir)).filter(n => n.endsWith('.js'));
  console.log('— i moduli si leggono —');
  for (const n of files) {
    const testo = await readFile(new URL(n, dir), 'utf8');
    const esito = await new Promise(ok => {
      const p = execFile(process.execPath, ['--input-type=module', '--check'], (err, _o, stderr) =>
        ok(err ? String(stderr).split('\n').find(r => r.includes('Error')) || 'errore' : null));
      p.stdin.end(testo);
    });
    if (esito) nota(`[assets/${n}] non si legge come modulo: ${esito}`);
  }
  console.log(`  ${files.length} moduli controllati`);
}

/* ---------- 0-bis. e' tutto aggiornato e allineato? ----------
   Tre cose che non si vedono aprendo il sito, ma che si pagano care:
   l'asta scritta in due archivi diversi, i file marcati con versioni diverse
   (mezzo sito vecchio in cache) e i dati del listone piu' vecchi
   dell'impronta che dovrebbe farli riscaricare. */
{
  const { readdir, readFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const radice = new URL('../', import.meta.url);

  console.log('\n— un archivio solo per l\'asta —');
  const VECCHIE = ['pianoAsta:v1', 'pianoAsta:altrui:v1', 'pianoAsta:astaVer', 'asta.leggi(', 'asta.scrivi('];
  const moduli = (await readdir(new URL('assets/', radice))).filter(n => n.endsWith('.js'));
  let sospetti = 0;
  for (const n of moduli) {
    if (n === 'astaLega.js') continue;   // e' lui che recupera il vecchio archivio, di proposito
    const t = await readFile(new URL('assets/' + n, radice), 'utf8');
    for (const v of VECCHIE) {
      if (t.includes(v)) { nota(`[assets/${n}] legge ancora l'asta da «${v}»: due archivi tornano a divergere`); sospetti++; }
    }
  }
  if (!sospetti) console.log('  nessun modulo tiene una copia sua dell\'asta');

  /* Le regole dell'unione non si controllano a occhio: c'e' un banco di prova
     apposta, e qui lo lanciamo insieme al resto. */
  const provaAsta = await new Promise(ok => {
    execFile(process.execPath, [fileURLToPath(new URL('prova-asta.mjs', import.meta.url))],
      (err, out) => ok({ ko: Boolean(err), out: String(out) }));
  });
  const conta = provaAsta.out.match(/(\d+) prove su (\d+)/);
  if (provaAsta.ko) nota(`le prove dell'asta condivisa non passano — lancia: node tools/prova-asta.mjs`);
  else console.log(`  prove dell'asta condivisa: ${conta ? conta[1] + '/' + conta[2] : 'passate'}`);

  /* ---------- moduli che non usa piu' nessuno ----------
     Un file sostituito da un altro non fa rumore: resta lì, nessuno lo
     importa, e la prossima persona che apre la cartella (o tu fra sei mesi)
     non sa se è vivo o morto. È così che è sopravvissuto `sync.js`, la
     sincronizzazione via token GitHub di prima di Supabase — con dentro
     istruzioni su come farsi un token, in un repository pubblico. */
  console.log('\n— niente moduli abbandonati —');
  {
    const pagine = await Promise.all(PAGINE.map(n => readFile(new URL(n, radice), 'utf8')));
    const sorgenti = await Promise.all(moduli.map(n => readFile(new URL('assets/' + n, radice), 'utf8')));
    const tutto = [...pagine, ...sorgenti].join('\n');
    const orfani = moduli.filter(n => {
      /* citato da una pagina come <script src>, o importato da un altro modulo */
      const e = n.replace('.', '\\.');
      /* citato come <script src>, importato da un altro modulo, oppure
         dichiarato come modulo di una scheda (data-modulo="fasce.js?v=N") */
      const usato = new RegExp(`(src="assets/${e}|from\\s*'\\./${e}|data-modulo="${e})`);
      return !usato.test(tutto);
    });
    if (orfani.length) {
      nota(`moduli che non importa nessuno: ${orfani.map(n => 'assets/' + n).join(', ')} — `
         + 'se sono davvero morti vanno tolti (git rm), se no manca un import');
    } else {
      console.log(`  tutti e ${moduli.length} i moduli sono raggiunti da qualcuno`);
    }
  }

  /* La parte di aggiorna_dati.py che riscrive squadra e ruolo e' l'unica che
     puo' rovinare il listone in silenzio: ha il suo banco di prova, e gira
     insieme al resto. */
  {
    /* Trovare python non e' banale come sembra, e non trovarlo costa caro:
       queste prove venivano SALTATE in silenzio proprio sul computer da cui si
       fa il push, e coerenza diceva «tutto a posto» avendone controllata meta'.

       Su Windows `python3` di solito ESISTE ma e' il segnaposto del Microsoft
       Store: parte, non stampa niente ed esce con errore. Cercare l'eseguibile
       per nome quindi non basta — bisogna guardare se ha davvero risposto. */
    const script = fileURLToPath(new URL('prova-anagrafica.py', import.meta.url));
    const CANDIDATI = [['python3'], ['python'], ['py', '-3'], ['py']];
    const lancia = ([cmd, ...prima]) => new Promise(ok => {
      execFile(cmd, [...prima, script], (err, out, errOut) => ok({
        cmd: [cmd, ...prima].join(' '),
        ko: Boolean(err),
        out: String(out || '') + String(errOut || ''),
      }));
    });

    let esito = null;
    for (const c of CANDIDATI) {
      const r = await lancia(c);
      if (/prove su \d+|ATTENZIONE|FALLITO|Traceback/.test(r.out)) { esito = r; break; }
      if (!esito) esito = r;      // teniamo il primo, per poterlo raccontare
    }

    const conta = esito.out.match(/(\d+) prove su (\d+)/);
    if (/ATTENZIONE|FALLITO|Traceback/.test(esito.out)) {
      const coda = esito.out.trim().split('\n').slice(-3).join(' / ');
      nota(`le prove su squadre e ruoli non passano (${esito.cmd}): ${coda}`);
    } else if (conta && !esito.ko) {
      console.log(`  prove su squadre e ruoli: ${conta[1]}/${conta[2]}`);
    } else {
      console.log('  (prove su squadre e ruoli saltate: non trovo un python che risponda —');
      console.log('   provati ' + CANDIDATI.map(c => c.join(' ')).join(', ')
        + '. Su Windows «python3» spesso e\' solo il segnaposto del Microsoft Store.)');
    }
  }

  console.log('\n— tutti i file alla stessa versione —');
  const pagine = PAGINE;
  const versioni = new Map();
  for (const n of [...pagine, ...moduli.map(m => 'assets/' + m)]) {
    const t = await readFile(new URL(n, radice), 'utf8');
    for (const m of t.matchAll(/\?v=(\d+)/g)) {
      if (!versioni.has(m[1])) versioni.set(m[1], []);
      if (!versioni.get(m[1]).includes(n)) versioni.get(m[1]).push(n);
    }
    const meta = t.match(/<meta name="versione" content="(\d+)">/);
    if (meta && !t.includes(`?v=${meta[1]}`)) {
      nota(`[${n}] dichiara versione ${meta[1]} ma carica file di un'altra versione`);
    }
  }
  if (versioni.size === 1) {
    console.log(`  tutti a v=${[...versioni.keys()][0]}`);
  } else {
    const dettaglio = [...versioni.entries()]
      .map(([v, dove]) => `v=${v} (${dove.length} file: ${dove.slice(0, 3).join(', ')}${dove.length > 3 ? '…' : ''})`);
    nota(`versioni diverse fra i file: ${dettaglio.join(' · ')} — lancia python3 tools/versione.py`);
  }

  console.log('\n— i dati del listone —');
  const app = await readFile(new URL('assets/app.js', radice), 'utf8');
  const testoPlayers = await readFile(new URL('assets/data/players.json', radice), 'utf8');
  const impronta = createHash('sha1').update(testoPlayers, 'utf8').digest('hex').slice(0, 10);
  const dichiarata = app.match(/VERSIONE_DATI = '([^']*)'/)?.[1];
  const quando = app.match(/AGGIORNATO_IL = '([^']*)'/)?.[1];
  if (dichiarata !== impronta) {
    nota(`l'impronta dei dati in app.js è ${dichiarata} ma players.json vale ${impronta}: `
       + 'chi ha già aperto il sito continuerebbe a vedere il listone vecchio — lancia python3 tools/aggiorna_dati.py');
  }
  const giorni = Math.floor((Date.now() - new Date(quando)) / 86400000);
  const inf = JSON.parse(await readFile(new URL('assets/data/infortuni.json', radice), 'utf8'));
  const eta = giorni === 0 ? 'oggi' : giorni === 1 ? 'ieri' : `${giorni} giorni fa`;
  console.log(`  listone: ${JSON.parse(testoPlayers).length} giocatori, aggiornato il ${quando} (${eta})`);
  console.log(`  infermeria: ${inf.voci?.length ?? 0} fermi, aggiornata il ${inf.aggiornato || '—'}`);
  const fuori = JSON.parse(testoPlayers).filter(p => p.fuori);
  console.log(`  fuori lista: ${fuori.length} (ceduti, svincolati, fuori rosa)`
    + (fuori.length ? ` — ${fuori.slice(0, 4).map(p => p.n).join(', ')}…` : ''));
  if (giorni > 7) nota(`il listone non si aggiorna da ${giorni} giorni: lancia python3 tools/aggiorna_dati.py`);
  if (!inf.voci?.length) nota('l\'infermeria è vuota: la pagina Infortunati non mostrerà niente');

  /* Una colonna vuota per TUTTI non si nota guardando il sito: la tabella c'è,
     l'intestazione c'è, e le celle bianche sembrano «nessun rigore segnato».
     Invece vuol dire che quella colonna Fantacalcio.it non ce la sta dando —
     o l'ha rinominata, e i sinonimi in COLONNE non la riconoscono più. Va
     detto, perché è esattamente il tipo di buco che resta lì per mesi. */
  const NOMI = {
    q: 'quotazione', qi: 'quot. iniziale', fvm: 'FVM', pg: 'presenze', mv: 'media voto',
    fm: 'fantamedia', gol: 'gol', gs: 'gol subiti', rp: 'rigori parati',
    rseg: 'rigori segnati', rsba: 'rigori sbagliati', au: 'autogol',
    assist: 'assist', amm: 'ammonizioni', esp: 'espulsioni',
  };
  /* L'autogol Fantacalcio.it non lo pubblica: sulla pagina delle statistiche
     quella colonna non c'è proprio (verificato con --diagnosi il 1 settembre).
     Non è un guasto da segnalare ogni volta — se un giorno ricompare, il dato
     entra da solo, perché il sinonimo resta in COLONNE. */
  const NON_PUBBLICATE = ['au'];
  const players = JSON.parse(testoPlayers);
  const pieno = c => players.filter(p => p[c] != null).length;
  const vuote = Object.keys(NOMI).filter(c => pieno(c) === 0 && !NON_PUBBLICATE.includes(c));
  const assenti = NON_PUBBLICATE.filter(c => pieno(c) === 0);
  const parziali = Object.keys(NOMI).filter(c => pieno(c) > 0 && pieno(c) < players.length);
  console.log('  colonne piene su tutti: '
    + Object.keys(NOMI).filter(c => pieno(c) === players.length).map(c => NOMI[c]).join(', '));
  if (parziali.length) {
    console.log('  colonne parziali: ' + parziali.map(c => `${NOMI[c]} ${pieno(c)}/${players.length}`).join(', '));
  }
  if (assenti.length) {
    console.log('  non pubblicate da Fantacalcio.it (e quindi nascoste): '
      + assenti.map(c => NOMI[c]).join(', '));
  }
  if (vuote.length) {
    console.log(`  ATTENZIONE — colonne vuote per tutti e ${players.length}: `
      + vuote.map(c => NOMI[c]).join(', '));
    console.log('    nel listone quelle celle restano bianche e sembrano uno zero. Per capire se');
    console.log('    Fantacalcio.it le ha rinominate:  python tools/aggiorna_dati.py --diagnosi');
    console.log('    e guarda la riga «campi aggiornati» della pagina statistiche.');
  }
}

/* ═══════════ da qui in poi serve un browser vero ═══════════
   Le pagine non si controllano leggendo i file: un refuso non e' un errore di
   JavaScript, il sito funziona benissimo mentre la guida dice una cosa e le
   impostazioni un'altra. L'unico modo di trovarli e' aprirle davvero. */

const pw = await playwright();

if (!pw) {
  console.log('\n— i controlli sulle pagine —');
  console.log(spiegazione('Saltati'));
} else {

const browser = await pw.chromium.launch({ executablePath: chromium() });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });

async function apri(pagina) {
  const p = await ctx.newPage();
  p.on('pageerror', e => nota(`[${pagina}] errore JavaScript: ${e.message}`));
  p.on('console', m => {
    if (m.type() === 'error' && !RUMORE.test(m.text())) nota(`[${pagina}] console: ${m.text()}`);
  });
  p.on('requestfailed', r => { if (!RUMORE.test(r.url())) nota(`[${pagina}] richiesta fallita: ${r.url()}`); });
  try {
    await p.goto(BASE + pagina, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    /* Quasi sempre e' una cosa sola: il server non e' acceso. Dirlo, invece di
       vomitare lo stack di Playwright, che sembra un guasto del sito. */
    await browser.close();
    console.log(`\n  Non riesco ad aprire ${BASE}${pagina}.`);
    console.log('  Quasi certamente manca il server: aprine un\'altra finestra e lancia');
    console.log('      python3 -m http.server 8123        (su Windows: python -m http.server 8123)');
    console.log('  poi rilancia questo controllo. Se il sito sta altrove, passalo come argomento:');
    console.log('      node tools/coerenza.mjs http://localhost:5500/');
    console.log(`\n  (dettaglio: ${String(e.message).split('\n')[0]})`);
    process.exit(2);
  }
  await p.waitForTimeout(2600);
  return p;
}

/* ---------- 1. ogni pagina si apre e si disegna ---------- */

console.log('— le pagine si aprono —');
const testi = {};
for (const pagina of PAGINE) {
  const p = await apri(pagina);
  const t = await p.locator('body').innerText();
  testi[pagina] = t;
  const voci = await p.locator('nav.nav a').count();
  if (t.trim().length < 400) nota(`[${pagina}] la pagina è praticamente vuota`);
  if (voci !== VOCI_MENU) nota(`[${pagina}] il menu ha ${voci} voci invece di ${VOCI_MENU}`);
  console.log(`  ${pagina.padEnd(14)} ${t.length} caratteri · ${voci} voci di menu`);
  await p.close();
}

/* ---------- 1-bis. ogni scheda si apre e ha dentro qualcosa ----------
 *
 * Il modulo di una scheda si carica solo quando la si apre: un errore dentro
 * non si vede finche' qualcuno non ci clicca. Qui ci si clicca. */

console.log('\n— le schede si aprono —');
for (const [pagina, nomi] of SCHEDE) {
  for (const nome of nomi) {
    const p = await apri(`${pagina}#${nome}`);
    const sez = p.locator(`#s-${nome}`);
    const visibile = await sez.isVisible().catch(() => false);
    const testo = visibile ? (await sez.innerText()).trim() : '';
    const linguetta = await p.locator(`.schede [data-scheda="${nome}"]`).getAttribute('aria-selected');
    if (!visibile) nota(`[${pagina}#${nome}] la scheda non si apre`);
    else if (testo.length < 200) nota(`[${pagina}#${nome}] la scheda è vuota (${testo.length} caratteri)`);
    else if (linguetta !== 'true') nota(`[${pagina}#${nome}] la linguetta non risulta selezionata`);
    else console.log(`  ${(pagina + '#' + nome).padEnd(26)} ${testo.length} caratteri`);
    testi[`${pagina}#${nome}`] = testo;
    await p.close();
  }
}

/* ---------- 1-ter. gli indirizzi vecchi portano ancora da qualche parte ---------- */

console.log('\n— i vecchi indirizzi non sono morti —');
for (const [vecchio, dove] of Object.entries(RIMANDI)) {
  const p = await ctx.newPage();
  await p.goto(BASE + vecchio, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const finito = p.url().replace(BASE, '');
  if (finito !== dove) nota(`[${vecchio}] doveva portare a ${dove}, invece è finito su ${finito}`);
  await p.close();
}
if (!problemi.length) console.log(`  tutti e ${Object.keys(RIMANDI).length} portano dove devono`);

/* ---------- 1-bis. tutto entra nello schermo del telefono ----------
 *
 * All'asta il portatile ce l'ha uno solo: gli altri hanno il telefono in mano.
 * E una pagina che non entra non si vede "un po' stretta" — il browser
 * rimpicciolisce l'intera pagina finché ci sta, quindi il testo diventa
 * illeggibile tutto insieme. E' successo alla guida, che ereditava un
 * `min-width:1150px` scritto per la tabella della Serie A.
 *
 * Le tabelle larghe sono legittime, purche' scorrano dentro il loro
 * contenitore: quello che non deve succedere e' che sia la PAGINA a sforare. */

console.log('\n— tutto entra nello schermo del telefono —');
{
  const TELEFONO = { width: 390, height: 844 };
  const mob = await browser.newContext({
    viewport: TELEFONO, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  for (const pagina of PAGINE) {
    const p = await mob.newPage();
    await p.goto(BASE + pagina, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    const r = await p.evaluate(() => {
      const largo = document.documentElement.clientWidth;
      /* chi sfora davvero: si ignora quello che sta dentro un contenitore che
         scorre di suo, perche' li' e' voluto */
      const colpevoli = [...document.querySelectorAll('body *')]
        .filter(e => e.getBoundingClientRect().right > largo + 2)
        .filter(e => !e.closest('.scroller,.tblwrap,[style*="overflow"]'))
        .map(e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`
          + `${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''}`
          + ` (${Math.round(e.getBoundingClientRect().width)}px)`);
      return { finestra: window.innerWidth, colpevoli: [...new Set(colpevoli)].slice(0, 3) };
    });
    await p.close();
    /* se il browser ha dovuto allargare la finestra oltre i 390 dello schermo,
       vuol dire che ha rimpicciolito la pagina per farcela stare */
    if (r.finestra > TELEFONO.width) {
      nota(`[${pagina}] non entra in un telefono: la pagina è larga ${r.finestra}px invece di ${TELEFONO.width}`
         + (r.colpevoli.length ? ` — colpa di ${r.colpevoli.join(', ')}` : ''));
      console.log(`  ${pagina.padEnd(20)} ✗ ${r.finestra}px  ${r.colpevoli.join(', ')}`);
    } else {
      console.log(`  ${pagina.padEnd(20)} ✓`);
    }
  }
  await mob.close();
}

/* ---------- 2. i numeri di lega coincidono ovunque ---------- */

console.log('\n— gli stessi numeri su tutte le pagine —');
const imp = await apri('altro.html#impostazioni');
const atteso = {
  crediti: Number(await imp.locator('#crediti').inputValue()),
  squadre: Number(await imp.locator('#squadre').inputValue()),
  modulo: await imp.locator('#moduloPref').inputValue(),
  strategia: await imp.locator('#strategiaPref').inputValue(),
  slot: Object.fromEntries(await Promise.all(['P', 'D', 'C', 'A'].map(async r =>
    [r, Number(await imp.locator('#s' + r).inputValue())]))),
  piano: Object.fromEntries(await Promise.all(['P', 'D', 'C', 'A'].map(async r =>
    [r, Number(await imp.locator('#p' + r).inputValue())]))),
};
await imp.close();
const slotTot = Object.values(atteso.slot).reduce((a, b) => a + b, 0);
console.log(`  impostazioni: ${atteso.crediti} crediti · ${atteso.squadre} squadre · rosa ${slotTot} · ${atteso.modulo} · ${atteso.strategia}`);

const pianoTot = Object.values(atteso.piano).reduce((a, b) => a + b, 0);
if (pianoTot !== atteso.crediti) nota(`il piano di spesa somma a ${pianoTot} invece di ${atteso.crediti}`);

/* La guida e' quella che prima mentiva di piu': deve nominare il modulo giusto,
   i crediti giusti e il numero di slot giusto. */
const guida = testi['altro.html#guida'];
for (const [che, valore] of [['crediti', atteso.crediti], ['modulo', atteso.modulo], ['slot', slotTot]]) {
  if (!guida.includes(String(valore))) nota(`la guida non nomina mai ${che} = ${valore}`);
}

const MODULI = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];

/* Un altro modulo puo' comparire, ma solo come confronto esplicito ("col
   5-3-2 ne renderebbe..."). Se lo nomina come se fosse il tuo, o lo consiglia,
   e' un refuso: sono le formule con cui la vecchia guida parlava del 4-5-1. */
for (const m of MODULI) {
  if (m === atteso.modulo) continue;
  for (const modo of ['il ' + m + ' e', 'in ' + m, 'col ' + m + ' in testa',
    'costruisci la rosa per giocarli', m + ' sono ammessi', m + ' è ammesso']) {
    if (guida.includes(modo)) {
      nota(`la guida dice «${modo}» ma il tuo modulo è ${atteso.modulo}`);
    }
  }
}

/* Il titolo deve seguire la STRATEGIA, non solo il modificatore: con "tutto
   sull'attacco" una guida che apre con «si vince in difesa» racconta l'asta di
   qualcun altro. */
const titolo = guida.split('\n').find(r => r.includes('La tua asta si vince')) || '';
const asseAtteso = { attacco: 'sui bonus', centrocampo: 'a centrocampo' }[atteso.strategia] || 'in difesa';
const difensivo = titolari => Number(atteso.modulo.split('-')[0]) >= 4;
if (!titolo.includes(asseAtteso)) {
  nota(`col modulo ${atteso.modulo} e la strategia "${atteso.strategia}" il titolo dovrebbe parlare di `
     + `«${asseAtteso}», invece dice «${titolo.trim()}»`);
}
if (!difensivo() && titolo.includes('in difesa')) {
  nota(`il titolo dice «in difesa» ma col ${atteso.modulo} il modificatore non scatta`);
}

/* ---------- 3. la guida e la rosa ideale propongono la stessa rosa ---------- */

console.log('\n— guida e consigliere dicono la stessa cosa —');
const gp = await apri('altro.html#guida');
const rosaGuida = await gp.locator('#rosaBody .nm').evaluateAll(e => e.map(x => x.textContent.trim()));
const spesaGuida = (await gp.locator('#rosaNota').innerText()).match(/(\d+)\s*crediti/)?.[1];
await gp.close();

const rp = await apri('rosa.html#ideale');
const rosaCons = await rp.locator('.idrow .nm').evaluateAll(e => e.map(x => x.textContent.replace(/(KO|SQ)$/, '').trim()));
const spesaCons = (await rp.locator('#totali-ideale').innerText()).match(/(\d+)\s*\/\s*\d+\s*cr/)?.[1];
await rp.close();

console.log(`  guida: ${rosaGuida.length} giocatori, ${spesaGuida} crediti`);
console.log(`  rosa ideale: ${rosaCons.length} giocatori, ${spesaCons} crediti`);
if (rosaGuida.length !== slotTot) nota(`la guida mostra ${rosaGuida.length} giocatori invece di ${slotTot}`);
if (rosaCons.length !== slotTot) nota(`la rosa ideale mostra ${rosaCons.length} giocatori invece di ${slotTot}`);

const soloGuida = rosaGuida.filter(n => !rosaCons.includes(n));
const soloCons = rosaCons.filter(n => !rosaGuida.includes(n));
if (soloGuida.length || soloCons.length) {
  nota(`le due pagine consigliano rose diverse — solo nella guida: ${soloGuida.join(', ') || '—'}; `
     + `solo nel consigliere: ${soloCons.join(', ') || '—'}`);
} else {
  console.log('  le due rose coincidono giocatore per giocatore');
}
if (spesaGuida && spesaCons && spesaGuida !== spesaCons) {
  nota(`spesa diversa fra guida (${spesaGuida}) e rosa ideale (${spesaCons})`);
}

/* ---------- 3-bis. «Chi comprare» propone gente che vale la pena comprare ----------
 *
 * Sembra ovvio e non lo era. La lista ordinava per punti-per-credito, e a
 * costo uno quel rapporto esplode: in cima ai portieri finivano otto riserve
 * da un credito, davanti a Svilar. Matematicamente giusto, praticamente
 * inutile. Adesso ordina per vantaggio (il tuo tetto meno il prezzo di
 * mercato) e chi non ne ha non compare — ma un criterio del genere si può
 * rompere di nuovo in silenzio, quindi si controlla. */

console.log('\n— «chi comprare» non si riempie di giocatori da un credito —');
{
  const g = await apri('altro.html#guida');
  const schede = await g.locator('#tabs button').count();
  for (let i = 0; i < schede; i++) {
    const nome = (await g.locator('#tabs button').nth(i).textContent()).split('·')[0].trim();
    await g.locator('#tabs button').nth(i).click();
    await g.waitForTimeout(400);
    const righe = await g.locator('#short tbody tr').evaluateAll(rs => rs
      .filter(r => r.children.length >= 6)
      .map(r => ({
        n: r.children[0].innerText.split('\n')[0].trim(),
        max: Number(r.children[3].innerText.trim()),
        vant: Number(r.children[4].innerText.replace('+', '').trim()),
        v: r.children[5].innerText.trim(),
      })));
    if (!righe.length) { console.log(`  ${nome.padEnd(15)} — nessun vantaggio in questo reparto`); continue; }

    const senzaVantaggio = righe.filter(x => !(x.vant > 0));
    const daUnCredito = righe.filter(x => x.max <= 1);
    const buoni = righe.filter(x => /TARGET|PREZZO GIUSTO/.test(x.v)).length;

    if (senzaVantaggio.length) {
      nota(`[chi comprare · ${nome}] ${senzaVantaggio.length} righe senza vantaggio: `
         + senzaVantaggio.slice(0, 3).map(x => x.n).join(', '));
    }
    if (daUnCredito.length) {
      nota(`[chi comprare · ${nome}] ci sono ${daUnCredito.length} giocatori col tetto a 1 credito `
         + `(${daUnCredito.slice(0, 3).map(x => x.n).join(', ')}): è il sintomo dell'ordinamento `
         + 'per punti-per-credito, che a costo 1 premia le riserve');
    }
    if (buoni < righe.length / 2) {
      nota(`[chi comprare · ${nome}] solo ${buoni} righe su ${righe.length} sono TARGET o PREZZO GIUSTO`);
    }
    console.log(`  ${nome.padEnd(15)} ${String(righe.length).padStart(2)} righe · vantaggio da `
      + `+${righe.at(-1).vant} a +${righe[0].vant} · ${buoni} consigliabili · primo: ${righe[0].n}`);
  }
  await g.close();
}

/* ---------- 4. nessun nome di giocatore inchiodato nell'HTML ---------- */

/* Anche i CONTEGGI invecchiano: «tutti i 540 giocatori» e' rimasto scritto a
   mano finche' il listone non e' passato a 568, e nessuno se n'era accorto. */
{
  const { readFile } = await import('node:fs/promises');
  const radice = new URL('../', import.meta.url);
  const quanti = JSON.parse(await readFile(new URL('assets/data/players.json', radice), 'utf8')).length;
  const vecchi = [500, 520, 540, 560, 580, 600].filter(n => n !== quanti);
  for (const [pagina, testo] of Object.entries(testi)) {
    for (const n of vecchi) {
      if (new RegExp(`\\b${n}\\s+giocatori`).test(testo)) {
        nota(`[${pagina}] dice «${n} giocatori» ma nel listone sono ${quanti}: e' un numero scritto a mano`);
      }
    }
  }
}

console.log('\n— niente nomi scritti a mano nelle pagine —');
const fs = await import('node:fs/promises');
const listone = JSON.parse(await fs.readFile(new URL('../assets/data/players.json', import.meta.url), 'utf8'));
/* Aurelio e' sia un giocatore del listone sia il compagno di lega di Pierre:
   quando compare nelle pagine parla di lui, non del calciatore. */
const ECCEZIONI = new Set(['Aurelio']);

/* La prima versione di questo controllo chiedeva nomi di almeno sei lettere e
   li cercava solo fra spazi: si e' lasciata sfuggire "Malen", "Gila" e
   "Lautaro" dentro una frase, che erano esattamente i refusi da trovare.
   Adesso cerca il nome per intero con un confine di parola, e accetta anche i
   nomi corti — 4 lettere bastano. Le maiuscole aiutano a non pescare parole
   comuni: nel listone i cognomi cominciano sempre in maiuscola. */
const nomi = [...new Set(listone.map(p => p.n))]
  .filter(n => n.length >= 4 && !ECCEZIONI.has(n) && /^[A-ZÀ-Þ]/.test(n));

const fuga = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Le date scritte a mano invecchiano come i nomi, e in modo piu' subdolo:
   nessuno rilegge il footer. Nel listone c'era «infortuni aggiornati al 25
   agosto 2026», battuto a macchina, e cinque giorni dopo diceva il falso su
   quanto fossero freschi i dati — che all'asta e' esattamente il genere di
   bugia che ti fa fidare di una statistica vecchia di una giornata. */
const MESI = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
const DATE_A_MANO = new RegExp(`\\b\\d{1,2}\\s+(${MESI})\\s+\\d{4}|\\b20\\d\\d-\\d{2}-\\d{2}\\b`, 'gi');

for (const pagina of PAGINE) {
  const sorgente = await fs.readFile(new URL('../' + pagina, import.meta.url), 'utf8');
  /* solo il testo visibile: fuori i tag, gli attributi e i commenti */
  const corpo = sorgente.slice(sorgente.indexOf('<body>'))
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  const trovati = nomi.filter(n => new RegExp(`(^|[\\s"'«(])${fuga(n)}([\\s.,;:!?"'»)]|$)`).test(corpo));
  if (trovati.length) {
    nota(`[${pagina}] nomi di giocatori scritti nell'HTML: ${trovati.join(', ')} — invecchieranno`);
  }
  const date = [...new Set(corpo.match(DATE_A_MANO) || [])];
  if (date.length) {
    nota(`[${pagina}] date scritte a mano nell'HTML: ${date.join(', ')} — `
       + 'invecchiano da sole, vanno generate da AGGIORNATO_IL');
  }
}

/* ---------- 5. la guida regge ogni modulo e ogni strategia ---------- */

/* I refusi non stavano nella configurazione di partenza: stavano nelle altre.
   Con il 4-3-3 e la strategia "attacco" la guida apriva ancora con «la tua
   asta si vince in difesa» e consigliava di passare al 5-4-1. Quindi si
   provano tutte le combinazioni, non solo quella salvata. */

console.log('\n— la guida regge ogni modulo e ogni strategia —');

const MODULI_DA_PROVARE = ['3-4-3', '4-3-3', '4-5-1', '5-3-2'];
const STRATEGIE_DA_PROVARE = ['totale', 'modificatore', 'attacco', 'centrocampo'];

/* frasi che hanno senso solo se stai davvero puntando sulla difesa */
const DIFENSIVE = ['si vince in difesa', 'denaro gratis'];

for (const m of MODULI_DA_PROVARE) {
  for (const s of STRATEGIE_DA_PROVARE) {
    const scelta = await ctx.newPage();
    await scelta.goto(BASE + 'rosa.html#ideale', { waitUntil: 'domcontentloaded' });
    await scelta.waitForTimeout(2400);
    await scelta.selectOption('#modulo-ideale', m);
    await scelta.locator(`#strategie button[data-s="${s}"]`).click();
    await scelta.waitForTimeout(1600);
    await scelta.close();

    const g = await apri('altro.html#guida');
    const t = await g.locator('body').innerText();
    const titolo = t.split('\n').find(r => r.includes('La tua asta si vince')) || '';

    const dif = Number(m.split('-')[0]);
    const puntaDifesa = dif >= 4 && (s === 'totale' || s === 'modificatore');
    const guai = [];

    if (!puntaDifesa) {
      for (const frase of DIFENSIVE) {
        if (t.includes(frase)) guai.push(`dice «${frase}»`);
      }
    }
    for (const altro of MODULI) {
      if (altro === m) continue;
      for (const modo of [`il ${altro} e`, `in ${altro}`, `col ${altro} in testa`,
        `${altro} sono ammessi`, `${altro} è ammesso`, 'costruisci la rosa per giocarli']) {
        if (t.includes(modo)) guai.push(`dice «${modo}»`);
      }
    }
    if (!t.includes(`con il ${m} in testa`)) guai.push(`non nomina il ${m} come tuo modulo`);

    const esito = guai.length ? '✗ ' + guai.join(' · ') : '✓';
    console.log(`  ${m} · ${s.padEnd(13)} ${titolo.trim().padEnd(38)} ${esito}`);
    guai.forEach(x => nota(`[guida ${m}/${s}] ${x}`));
    await g.close();
  }
}

/* ---------- 6. l'asta condivisa, provata da dentro il browser ---------- */

/* Le prove qui sopra girano da sconnessi: vedono le pagine, non l'asta. Questa
   entra con un finto account su un finto Supabase e verifica il giro completo —
   segno un acquisto nel listone, lo ritrovo in «La mia rosa», in
   «Fantasquadre» e in «Serie A» senza fare altro. */

console.log('\n— l\'asta condivisa, da dentro il browser —');
{
  const { execFile } = await import('node:child_process');
  const esito = await new Promise(ok => {
    execFile(process.execPath, [fileURLToPath(new URL('prova-asta-browser.mjs', import.meta.url)), BASE],
      { timeout: 240000 }, (err, out) => ok({ ko: Boolean(err), out: String(out) }));
  });
  const conta = esito.out.match(/(\d+) prove su (\d+)/);
  if (esito.ko) {
    nota('il giro completo dell\'asta non passa — lancia: node tools/prova-asta-browser.mjs');
    for (const r of esito.out.split('\n').filter(r => r.includes('FALLITO'))) console.log('  ' + r.trim());
  } else {
    console.log(`  giro completo: ${conta ? conta[1] + '/' + conta[2] : 'passato'}`);
  }
}

await browser.close();

}   /* fine dei controlli che aprono il browser */

/* ---------- esito ---------- */


console.log(`\n${'='.repeat(52)}`);
if (!problemi.length) {
  console.log('Tutto coerente.');
  process.exit(0);
}
console.log(`${problemi.length} ${problemi.length === 1 ? 'problema' : 'problemi'}:`);
for (const p of problemi) console.log('  · ' + p);
process.exit(1);
