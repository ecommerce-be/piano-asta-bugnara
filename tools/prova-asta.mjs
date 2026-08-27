/* Prova dell'asta condivisa, senza browser e senza Supabase.
 *
 * Quello che va davvero verificato non e' che il salvataggio funzioni — quello
 * si vede subito — ma cosa succede quando salvate in due nello stesso momento,
 * che all'asta e' la regola, non l'eccezione. Se l'unione fosse «vince
 * l'ultimo», il primo perderebbe l'acquisto appena segnato e se ne
 * accorgerebbe solo dopo, con i conti sbagliati.
 *
 *   node tools/prova-asta.mjs
 */
/* I moduli si importano per URL, non per percorso: su Windows un
   "C:\\...\\astaLega.js" passato a import() viene rifiutato. */
const modulo = nome => new URL('../assets/' + nome, import.meta.url).href;

/* ---------- finto browser: quel tanto che serve a caricare i moduli ---------- */

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const UTENTE = { id: 'u1', email: 'pierre@x.it', user_metadata: { nome: 'Pierre' } };
localStorage.setItem('pianoAsta:sessione', JSON.stringify({
  access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600e3, user: UTENTE,
}));

const LEGA = { id: 'l1', nome: 'Lega Bugnara', codice: 'bugnara' };
const SQUADRE = [
  { id: 's1', nome: 'Hertha Vernello', ordine: 1 },
  { id: 's2', nome: 'Real Bugnara', ordine: 2 },
];

/* il documento come se fosse nel database */
let remoto = { dati: null, versione: 0 };
let reteGiu = false;   // per provare cosa succede quando la rete cade a meta' asta

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (reteGiu && u.includes('/rest/v1/documenti')) throw new TypeError('Failed to fetch');
  const ok = d => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
  if (u.includes('supabase.json')) return ok({ url: 'https://finto.supabase.co', anonKey: 'eyJfinta' });
  if (u.includes('/rest/v1/membri?select=')) {
    return ok([{ ruolo: 'admin', squadra_id: 's1', lega_id: 'l1', leghe: LEGA }]);
  }
  if (u.includes('/rest/v1/squadre?')) return ok(SQUADRE);
  if (u.includes('/rest/v1/membri?lega_id=')) {
    return ok([{ utente_id: 'u1', squadra_id: 's1', ruolo: 'admin', nome: 'Pierre' }]);
  }
  if (u.includes('/rest/v1/documenti')) {
    if (!opt.method || opt.method === 'GET') {
      return ok(remoto.versione ? [{ dati: remoto.dati, versione: remoto.versione, da: 'Aurelio', aggiornato: '' }] : []);
    }
    const corpo = JSON.parse(opt.body);
    remoto = { dati: corpo.dati, versione: corpo.versione };
    return ok([{ dati: corpo.dati, versione: corpo.versione }]);
  }
  throw new Error('richiesta non prevista: ' + u);
};

const A = await import(modulo('astaLega.js'));
const { avvia } = await import(modulo('db.js'));
await avvia();

/* ---------- l'impalcatura delle prove ---------- */

let ko = 0, tot = 0;
function prova(nome, condizione, dettaglio = '') {
  tot++;
  const esito = condizione ? 'OK     ' : 'FALLITO';
  if (!condizione) ko++;
  console.log(`  ${esito} ${nome}${!condizione && dettaglio ? '  → ' + dettaglio : ''}`);
}

const G = (r, n, sq) => `${r}|${n}|${sq}`;
const BREMER = G('D', 'Bremer', 'Juventus');
const MALEN = G('A', 'Malen', 'Roma');
const ORSOLINI = G('C', 'Orsolini', 'Bologna');
const GILA = G('D', 'Gila', 'Lazio');

const vuoto = () => ({ squadre: SQUADRE.map(s => ({ id: s.id, nome: s.nome, rosa: [], tolti: {} })), fuori: {}, liberati: {} });
const conRosa = (d, id) => d.squadre.find(s => s.id === id).rosa.map(g => g.id).sort();

/* ---------- 1. quello che vedono le pagine ---------- */

console.log('— l\'asta si deduce dalle rose, non si archivia due volte —');

await A.caricaAsta();
A.allineaAllaLega(SQUADRE, [{ utente_id: 'u1', squadra_id: 's1', nome: 'Pierre' }]);

A.assegna(BREMER, 's1', 22, { n: 'Bremer', sq: 'Juventus', r: 'D' });
A.assegna(MALEN, 's2', 40, { n: 'Malen', sq: 'Roma', r: 'A' });
A.segnaFuori(ORSOLINI);

let st = A.statoAsta();
prova('quello che ho preso io risulta mio', st.mia[BREMER] === 22, JSON.stringify(st.mia));
prova('quello che ha preso un altro e\' fuori mercato', st.altrui.has(MALEN));
prova('e non finisce per sbaglio fra i miei', !(MALEN in st.mia));
prova('chi e\' segnato preso senza dire da chi e\' comunque fuori', st.altrui.has(ORSOLINI));
prova('il listone sa a chi e\' andato', A.possessore(MALEN)?.squadra.nome === 'Real Bugnara');
prova('e a che prezzo', A.possessore(MALEN)?.prezzo === 40);

A.libera(BREMER);
st = A.statoAsta();
prova('liberato, torna sul mercato per tutti', !(BREMER in st.mia) && !st.altrui.has(BREMER));

/* ---------- 2. si salva in due nello stesso momento ---------- */

console.log('\n— due che salvano insieme non si cancellano a vicenda —');

/* Pierre e Aurelio partono dalla stessa versione. Pierre segna un acquisto,
   Aurelio ne segna un altro nella STESSA squadra: e' il caso di questa lega,
   perche' i due gestiscono insieme l'Hertha Vernello. */
const base = vuoto();
const diPierre = structuredClone(base);
diPierre.squadre[0].rosa.push({ id: BREMER, n: 'Bremer', sq: 'Juventus', r: 'D', prezzo: 22, il: '2026-08-27T10:00:00Z' });
diPierre.squadre[0].quando = '2026-08-27T10:00:00Z';

const diAurelio = structuredClone(base);
diAurelio.squadre[0].rosa.push({ id: GILA, n: 'Gila', sq: 'Lazio', r: 'D', prezzo: 15, il: '2026-08-27T10:00:03Z' });
diAurelio.squadre[0].quando = '2026-08-27T10:00:03Z';

let fuso = A.fondi(diAurelio, diPierre);
prova('sopravvivono tutti e due gli acquisti nella stessa squadra',
  conRosa(fuso, 's1').join() === [BREMER, GILA].sort().join(), conRosa(fuso, 's1').join());

/* Ora due squadre diverse: caso facile, ma va verificato lo stesso. */
const dueSquadre = structuredClone(base);
dueSquadre.squadre[1].rosa.push({ id: MALEN, n: 'Malen', sq: 'Roma', r: 'A', prezzo: 40, il: '2026-08-27T10:00:05Z' });
fuso = A.fondi(dueSquadre, diPierre);
prova('e sopravvivono anche se sono in squadre diverse',
  conRosa(fuso, 's1').join() === BREMER && conRosa(fuso, 's2').join() === MALEN);

/* ---------- 3. una rimozione non deve tornare indietro ---------- */

console.log('\n— chi toglie un giocatore non se lo ritrova ricomparire —');

/* Il remoto ha ancora Bremer; io l'ho appena tolto. Senza lapide l'unione lo
   farebbe risorgere al primo salvataggio dell'altro. */
const ioTolgo = structuredClone(diPierre);
ioTolgo.squadre[0].rosa = [];
ioTolgo.squadre[0].tolti = { [BREMER]: '2026-08-27T10:05:00Z' };

fuso = A.fondi(diPierre, ioTolgo);
prova('tolto qui, resta tolto anche dopo l\'unione', conRosa(fuso, 's1').length === 0, JSON.stringify(conRosa(fuso, 's1')));

/* ...ma se nel frattempo l'altro l'ha ricomprato DOPO, vince l'ultimo gesto. */
const ricomprato = structuredClone(base);
ricomprato.squadre[0].rosa.push({ id: BREMER, n: 'Bremer', sq: 'Juventus', r: 'D', prezzo: 30, il: '2026-08-27T10:09:00Z' });
fuso = A.fondi(ricomprato, ioTolgo);
prova('se l\'altro l\'ha ripreso dopo, vale il suo acquisto',
  conRosa(fuso, 's1').join() === BREMER && fuso.squadre[0].rosa[0].prezzo === 30);

/* ---------- 4. fuori mercato e ritorno ---------- */

console.log('\n— «fuori mercato» segue le stesse regole —');

const ioFuori = structuredClone(base);
ioFuori.fuori = { [ORSOLINI]: '2026-08-27T11:00:00Z' };
const altroLibera = structuredClone(base);
altroLibera.liberati = { [ORSOLINI]: '2026-08-27T11:02:00Z' };

fuso = A.fondi(altroLibera, ioFuori);
const dopo = fuso.liberati[ORSOLINI] > fuso.fuori[ORSOLINI];
prova('liberato dopo essere stato segnato fuori, resta libero', dopo);

const assegnatoDopo = structuredClone(base);
assegnatoDopo.squadre[1].rosa.push({ id: ORSOLINI, n: 'Orsolini', sq: 'Bologna', r: 'C', prezzo: 25, il: '2026-08-27T11:05:00Z' });
fuso = A.fondi(assegnatoDopo, ioFuori);
prova('se poi si scopre a chi e\' andato, l\'assegnazione batte il "fuori mercato"',
  !fuso.fuori[ORSOLINI] && conRosa(fuso, 's2').join() === ORSOLINI);

/* ---------- 5. il giro completo contro il finto database ---------- */

console.log('\n— il giro completo: segno, salvo, rileggo —');

remoto = { dati: null, versione: 0 };
localStorage.removeItem('pianoAsta:asta-da-mandare');   // browser pulito
await A.caricaAsta();
A.allineaAllaLega(SQUADRE, [{ utente_id: 'u1', squadra_id: 's1', nome: 'Pierre' }]);
A.assegna(BREMER, 's1', 22, { n: 'Bremer', sq: 'Juventus', r: 'D' });
await A.salvaAsta();
prova('il salvataggio arriva al database', remoto.versione === 1);

await A.caricaAsta();
prova('e rileggendolo il giocatore e\' ancora li\'', A.statoAsta().mia[BREMER] === 22);
prova('la squadra che gestisco e\' quella scelta nella lega', A.miaSquadra()?.nome === 'Hertha Vernello');

/* ---------- 6. il recupero da quello che c'era prima ---------- */

console.log('\n— quello che era rimasto nel browser non si perde —');

localStorage.setItem('pianoAsta:v1', JSON.stringify({ [GILA]: 14 }));
localStorage.setItem('pianoAsta:altrui:v1', JSON.stringify([MALEN]));

const rec = await A.daRecuperare();
prova('trova quello che il database non sa gia\'',
  rec && rec.acquisti.length === 1 && rec.fuori.length === 1, JSON.stringify(rec));
prova('e non ripropone quello che c\'e\' gia\'', !rec?.acquisti.some(a => a.gid === BREMER));

A.recupera(rec, {});
const st2 = A.statoAsta();
prova('portati dentro, finiscono nella mia squadra', st2.mia[GILA] === 14);
prova('e i "presi da altri" restano fuori mercato', st2.altrui.has(MALEN));

A.scordaVecchi();
prova('e il vecchio archivio del browser sparisce',
  localStorage.getItem('pianoAsta:v1') === null && localStorage.getItem('pianoAsta:altrui:v1') === null);

/* ---------- 7. svuotare la propria rosa ---------- */

console.log('\n— svuotare la propria rosa non tocca quella degli altri —');

A.assegna(MALEN, 's2', 40, { n: 'Malen', sq: 'Roma', r: 'A' });
const quanti = A.svuota('s1');
const st3 = A.statoAsta();
prova('la mia rosa e\' vuota', Object.keys(st3.mia).length === 0 && quanti > 0);
prova('quella dell\'altro no', A.possessore(MALEN)?.squadra.id === 's2');

/* ---------- 8. la rete che cade a meta' asta ---------- */

console.log('\n— se la rete cade, quello che hai segnato non si perde —');

remoto = { dati: null, versione: 0 };
localStorage.removeItem('pianoAsta:asta-da-mandare');
await A.caricaAsta();
A.allineaAllaLega(SQUADRE, [{ utente_id: 'u1', squadra_id: 's1', nome: 'Pierre' }]);

reteGiu = true;
A.assegna(GILA, 's1', 18, { n: 'Gila', sq: 'Lazio', r: 'D' });
let esploso = false;
try { await A.salvaAsta(); } catch { esploso = true; }

prova('il salvataggio fallisce, e lo dice', esploso && A.inSospeso().quanti >= 1,
  JSON.stringify(A.inSospeso()));
prova('ma l\'acquisto resta sullo schermo', A.statoAsta().mia[GILA] === 18);
prova('e finisce in una copia di scorta nel browser',
  Boolean(localStorage.getItem('pianoAsta:asta-da-mandare')));
prova('con dentro il giocatore giusto',
  (localStorage.getItem('pianoAsta:asta-da-mandare') || '').includes('Gila'));

/* «ricarico la pagina»: il documento in memoria torna quello del database,
   che di quell'acquisto non sa niente. Deve ripescarlo dalla scorta. */
reteGiu = false;
await A.caricaAsta();
prova('ricaricando, l\'acquisto torna fuori dalla scorta', A.statoAsta().mia[GILA] === 18,
  JSON.stringify(A.statoAsta().mia));

await A.ritentaOra();
prova('e al primo tentativo riuscito arriva al database',
  JSON.stringify(remoto.dati).includes('Gila'));
prova('dopo di che non resta piu' + ' niente in sospeso', A.inSospeso().quanti === 0,
  JSON.stringify(A.inSospeso()));
prova('e la copia di scorta sparisce',
  localStorage.getItem('pianoAsta:asta-da-mandare') === null);

/* ---------- ---------- */

console.log('\n' + '='.repeat(52));
if (ko) {
  console.log(`ATTENZIONE: ${ko} prove fallite su ${tot}.`);
  process.exit(1);
}
console.log(`Tutto a posto: ${tot} prove su ${tot}.`);
process.exit(0);   // se e' rimasto in piedi un ritentativo, non aspettiamolo
