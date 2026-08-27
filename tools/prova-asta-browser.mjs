/* L'asta condivisa provata nel browser vero, con un finto Supabase.
 *
 * `prova-asta.mjs` controlla le regole; questo controlla i fili: che il clic
 * arrivi alla funzione giusta, che la pagina si ridisegni, che quello che
 * segni nel listone si ritrovi in «La mia rosa» e in «Fantasquadre» senza fare
 * nient'altro. Sono gli errori che le prove di logica non vedono mai — e sono
 * quelli che si notano per primi usando il sito.
 *
 * Non tocca il database vero: intercetta anche `assets/data/supabase.json`,
 * quindi gira senza credenziali e senza rete.
 *
 *     python3 -m http.server 8123 &
 *     node tools/prova-asta-browser.mjs
 */
import { playwright, chromium, spiegazione } from './playwright.mjs';

const BASE = process.argv[2] || 'http://localhost:8123/';

const pw = await playwright();
if (!pw) {
  /* Senza Playwright non c'e' niente da provare, ma non e' un guasto: usciamo
     con zero, dicendo cosa manca, cosi' chi ci lancia non lo prende per un
     errore del sito. */
  console.log(spiegazione('Prove col browser saltate'));
  process.exit(0);
}

/* ---------- il finto database ---------- */

const UTENTE = { id: 'u1', email: 'pierre@x.it', user_metadata: { nome: 'Pierre' } };
const LEGA = { id: 'l1', nome: 'Lega Bugnara', codice: 'bugnara' };
const SQUADRE = [
  { id: 's1', nome: 'Hertha Vernello', ordine: 1 },
  { id: 's2', nome: 'Real Bugnara', ordine: 2 },
];
const MEMBRI = [{ utente_id: 'u1', squadra_id: 's1', ruolo: 'admin', nome: 'Pierre' }];

/** documenti: chiave "<squadra|lega>:<chiave>" → { dati, versione } */
const documenti = new Map();
let scritture = 0;

/* PostgREST filtra con `squadra_id=is.null` oppure `squadra_id=eq.<id>`:
   qui li riportiamo alla stessa chiave con cui li scriviamo. */
const valore = v => (!v || v === 'is.null' ? '' : v.replace(/^eq\./, ''));
const chiaveDoc = u => {
  const q = new URL(u).searchParams;
  return `${valore(q.get('squadra_id'))}|${valore(q.get('chiave'))}`;
};

async function serviRest(rotta) {
  const u = rotta.request().url();
  const metodo = rotta.request().method();
  const json = d => rotta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });

  if (u.includes('/rest/v1/membri?select=')) {
    return json([{ ruolo: 'admin', squadra_id: 's1', lega_id: 'l1', leghe: LEGA }]);
  }
  if (u.includes('/rest/v1/squadre')) return json(SQUADRE);
  if (u.includes('/rest/v1/membri')) return json(MEMBRI);

  if (u.includes('/rest/v1/documenti')) {
    const k = chiaveDoc(u);
    if (metodo === 'GET') {
      const d = documenti.get(k);
      return json(d ? [{ dati: d.dati, versione: d.versione, da: 'Pierre', aggiornato: new Date().toISOString() }] : []);
    }
    const corpo = JSON.parse(rotta.request().postData() || '{}');
    if (metodo === 'POST') {
      const kk = `${corpo.squadra_id || ''}|${corpo.chiave}`;
      documenti.set(kk, { dati: corpo.dati, versione: 1 });
      scritture++;
      return json([{ dati: corpo.dati, versione: 1 }]);
    }
    if (metodo === 'PATCH') {
      documenti.set(k, { dati: corpo.dati, versione: corpo.versione });
      scritture++;
      return json([{ dati: corpo.dati, versione: corpo.versione }]);
    }
  }
  return json([]);
}

/* ---------- impalcatura ---------- */

let ko = 0, tot = 0;
function prova(nome, condizione, dettaglio = '') {
  tot++;
  if (!condizione) ko++;
  console.log(`  ${condizione ? 'OK     ' : 'FALLITO'} ${nome}${!condizione && dettaglio ? '  → ' + dettaglio : ''}`);
}

const browser = await pw.chromium.launch({ executablePath: chromium() });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });

/* la sessione dev'esserci prima che parta il modulo, non dopo */
await ctx.addInitScript(([u, l]) => {
  localStorage.setItem('pianoAsta:sessione', JSON.stringify({
    access_token: 'finto', refresh_token: 'finto', expires_at: Date.now() + 3600e3, user: u,
  }));
  localStorage.setItem('pianoAsta:lega', l);
}, [UTENTE, LEGA.id]);

await ctx.route('**/assets/data/supabase.json*', r => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ url: 'https://finto.supabase.co', anonKey: 'eyJprova' }),
}));
await ctx.route('https://finto.supabase.co/**', serviRest);

const errori = [];
async function apri(pagina, attesa = 2600) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errori.push(`[${pagina}] ${e.message}`));
  await p.goto(BASE + pagina, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(attesa);
  return p;
}

/* ---------- 1. il listone sa chi sei ---------- */

console.log('— entrato, il listone sa in che lega e in che squadra sei —');
let p = await apri('listone.html');

const barra = await p.locator('#accesso').innerText();
/* il foglio di stile scrive le pastiglie in maiuscolo, e innerText restituisce
   il testo come si vede: confrontiamo senza badare alle maiuscole */
const dice = (dove, che) => dove.toLowerCase().includes(che.toLowerCase());
prova('la barra nomina la lega', dice(barra, 'Lega Bugnara'), barra.replace(/\n/g, ' · '));
prova('e la squadra che gestisci', dice(barra, 'Hertha Vernello'), barra.replace(/\n/g, ' · '));

/* ---------- 2. segnare un acquisto lo salva nell'asta della lega ---------- */

console.log('\n— quello che segni finisce nell\'asta della lega —');

const primaRiga = p.locator('#big tbody tr').first();
const nome = (await primaRiga.locator('.nm').innerText()).trim();
await primaRiga.locator('input[data-id]').fill('22');
await primaRiga.locator('input[data-id]').dispatchEvent('change');
await p.waitForTimeout(1200);

const salvato = documenti.get('|fantasquadre');
const rosaMia = salvato?.dati?.squadre?.find(s => s.id === 's1')?.rosa || [];
prova('il salvataggio parte da solo', Boolean(salvato), 'nessun documento scritto');
prova(`«${nome}» entra nella mia squadra`, rosaMia.some(g => g.n === nome), JSON.stringify(rosaMia));
prova('col prezzo che ho scritto', rosaMia[0]?.prezzo === 22, String(rosaMia[0]?.prezzo));
prova('e non in un archivio del browser',
  await p.evaluate(() => localStorage.getItem('pianoAsta:v1') === null));

const ledger = await p.locator('#ledger').innerText();
prova('i crediti residui si aggiornano', /478/.test(ledger), ledger.replace(/\n/g, ' '));

await p.close();

/* ---------- 3. si ritrova ovunque, senza fare niente ---------- */

console.log('\n— e si ritrova su tutte le pagine, da solo —');

p = await apri('listone.html');
const dopoRicarica = await p.locator('#big tbody tr').first().locator('input[data-id]').inputValue();
prova('ricaricando il listone c\'è ancora', dopoRicarica === '22', `vale "${dopoRicarica}"`);
await p.close();

p = await apri('rosa.html');
const rosa = await p.locator('#reparti').innerText();
prova('«La mia rosa» lo mostra', rosa.includes(nome), rosa.slice(0, 160).replace(/\n/g, ' · '));
prova('e non dice più «non registrato»', !rosa.includes('non registrato'));
await p.close();

p = await apri('fantasquadre.html');
const fs = await p.locator('#griglia').innerText();
prova('la fantasquadra ce l\'ha in rosa', fs.includes(nome), fs.slice(0, 200).replace(/\n/g, ' · '));
prova('e la squadra ha il nome che le dà la lega', fs.includes('Hertha Vernello'));
await p.close();

p = await apri('squadre.html');
const serieA = await p.locator('#rosa tbody').innerText();
prova('anche «Serie A» lo dà per preso', /tua · 22 cr/i.test(serieA),
  (serieA.split('\n').find(r => r.includes(nome)) || '').slice(0, 120));
await p.close();

/* ---------- 4. quello che l'altro segna arriva qui ---------- */

console.log('\n— quello che segna l\'altro compare senza ricaricare —');

p = await apri('listone.html');
{
  /* Simuliamo Aurelio, che segna un acquisto della SUA squadra mentre noi
     stiamo guardando. Prendiamo un giocatore diverso dal nostro: assegnare
     lo stesso a due squadre non e' una cosa che il sito lascia fare, e
     proverebbe un caso che non esiste. */
  const altra = p.locator('#big tbody tr').nth(1);
  var idAltro = await altra.locator('input[data-id]').getAttribute('data-id');
  const [r, n, sq] = idAltro.split('|');
  const d = structuredClone(documenti.get('|fantasquadre').dati);
  const sua = d.squadre.find(s => s.id === 's2');
  sua.rosa.push({ id: idAltro, n, sq, r, prezzo: 40, il: new Date().toISOString() });
  sua.quando = new Date().toISOString();
  documenti.set('|fantasquadre', { dati: d, versione: documenti.get('|fantasquadre').versione + 1 });
  await p.waitForTimeout(11000);   // il controllo periodico gira ogni otto secondi
}
const rigaAltro = await p.locator(`#big tbody tr:has(input[data-id="${idAltro}"])`)
  .innerText().catch(() => '');
prova('l\'acquisto dell\'altra squadra compare da solo', /Real Bugnara/i.test(rigaAltro),
  rigaAltro.slice(0, 120) || 'riga non trovata');
await p.close();

/* ---------- 5. niente errori per strada ---------- */

console.log('\n— nessun errore JavaScript —');
prova('le pagine girano pulite', errori.length === 0, errori.join(' | '));
console.log(`  ${scritture} scritture sul finto database`);

await browser.close();

console.log('\n' + '='.repeat(52));
if (ko) { console.log(`ATTENZIONE: ${ko} prove fallite su ${tot}.`); process.exit(1); }
console.log(`Tutto a posto: ${tot} prove su ${tot}.`);
