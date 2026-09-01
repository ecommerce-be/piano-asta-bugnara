/* Database condiviso su Supabase, via REST. Nessuna libreria esterna.
 *
 * Tre cose:
 *  - accesso con email e password, sessione tenuta viva da sola
 *  - lettura e scrittura di "documenti", cioè blocchi di JSON con una chiave
 *    ('bozza', 'fantasquadre', 'asta:<utente>')
 *  - un controllo di versione: se due persone salvano insieme, il secondo non
 *    sovrascrive il primo alla cieca, ma unisce e riprova
 *
 * La chiave pubblica che sta in assets/data/supabase.json NON è un segreto: è
 * un identificatore, va bene che stia in un repository pubblico. A proteggere i
 * dati sono le regole del database, che permettono di leggere e scrivere solo a
 * chi ha fatto l'accesso. Vanno bene sia la chiave "anon" legacy (eyJ...) sia
 * la nuova "publishable" (sb_publishable_...). Mai la secret o la service_role:
 * quelle scavalcano le regole di sicurezza.
 */

const CHIAVE_SESSIONE = 'pianoAsta:sessione';

let cfg = null;
let sessione = null;

/* ---------- configurazione ---------- */

export async function avvia() {
  if (cfg) return cfg;
  try {
    const r = await fetch('assets/data/supabase.json?v=51?t=' + Date.now());
    cfg = await r.json();
  } catch {
    cfg = {};
  }
  if (!cfg.url || !cfg.anonKey) {
    cfg.mancante = 'assente';
    return cfg;
  }
  if (cfg.url.includes('DA-COMPILARE') || cfg.anonKey.includes('DA-COMPILARE')) {
    cfg.mancante = 'da-compilare';
    return cfg;
  }
  cfg.url = cfg.url.replace(/\/+$/, '');
  try { sessione = JSON.parse(localStorage.getItem(CHIAVE_SESSIONE) || 'null'); } catch { sessione = null; }
  await rinnovaSeScaduta();
  return cfg;
}

export const configurato = () => Boolean(cfg && !cfg.mancante);

/* ---------- sessione ---------- */

function salvaSessione(s) {
  sessione = s;
  try {
    if (s) localStorage.setItem(CHIAVE_SESSIONE, JSON.stringify(s));
    else localStorage.removeItem(CHIAVE_SESSIONE);
  } catch { /* storage non disponibile */ }
}

export function utente() {
  if (!sessione?.user) return null;
  const m = sessione.user.user_metadata || {};
  return {
    email: sessione.user.email,
    nome: m.nome || sessione.user.email.split('@')[0],
    id: sessione.user.id,
  };
}

export const collegato = () => Boolean(sessione?.access_token);

async function rinnovaSeScaduta() {
  if (!sessione?.refresh_token) return;
  const margine = 60_000;
  if (sessione.expires_at && Date.now() + margine < sessione.expires_at) return;
  try {
    const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sessione.refresh_token }),
    });
    if (!r.ok) return salvaSessione(null);
    salvaSessione(conScadenza(await r.json()));
  } catch { /* niente rete: teniamo la sessione com'è e riproveremo */ }
}

const conScadenza = s => ({ ...s, expires_at: Date.now() + (s.expires_in || 3600) * 1000 });

function tradimessaggio(t) {
  const m = (t || '').toLowerCase();
  if (m.includes('invalid login')) return 'Email o password sbagliate.';
  if (m.includes('already registered')) return 'Questa email è già registrata: usa "Entra" invece di "Registrati".';
  if (m.includes('password should be')) return 'La password deve avere almeno 6 caratteri.';
  if (m.includes('email not confirmed')) return 'Devi confermare l\'email: controlla la posta, oppure disattiva la conferma nelle impostazioni di Supabase.';
  if (m.includes('signups not allowed')) return 'Le registrazioni sono chiuse in Supabase: attivale in Authentication → Sign In / Providers.';
  return t || 'Qualcosa è andato storto.';
}

export async function registrati(email, password, nome) {
  const r = await fetch(`${cfg.url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { nome } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(tradimessaggio(j.msg || j.error_description || j.message));
  if (j.access_token) { salvaSessione(conScadenza(j)); return { entrato: true }; }
  return { entrato: false, messaggio: 'Registrazione fatta. Conferma l\'email e poi entra.' };
}

export async function entra(email, password) {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(tradimessaggio(j.msg || j.error_description || j.message));
  salvaSessione(conScadenza(j));
}

export function esci() { salvaSessione(null); }

/* ═══════════ contesto: in quale lega sei, e quale squadra gestisci ═══════════
 *
 * Il proprietario dei dati non e' l'utente: e' la SQUADRA. Due account che
 * gestiscono la stessa fantasquadra devono vedere le stesse cose, e nessun
 * altro deve vederle. Quindi ogni lettura e scrittura passa da qui.
 *
 * La lega scelta resta nel browser: se sei in piu' leghe, il sito riapre
 * l'ultima che stavi guardando invece di chiedertelo ogni volta.
 */

const CHIAVE_LEGA = 'pianoAsta:lega';

let contesto = null;   // { lega, squadra, membri, squadre } oppure null

/* Chi vuole essere avvisato quando il contesto cambia.
 *
 * Serve perche' la barra in cima ("collegato come… Lega Bugnara… Hertha
 * Vernello") viene montata subito, mentre la lega si sa solo dopo un giro di
 * rete. Senza questo, la barra resterebbe ferma su "non sei in nessuna lega"
 * anche a pagina caricata, contraddicendo il resto della pagina. */
const ascoltatori = new Set();
export function alContesto(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
function contestoCambiato() {
  for (const fn of ascoltatori) { try { fn(contesto); } catch { /* una barra rotta non ferma le altre */ } }
}

export const inLega = () => Boolean(contesto?.lega);
export const lega = () => contesto?.lega || null;
export const squadra = () => contesto?.squadra || null;
export const squadreDellaLega = () => contesto?.squadre || [];
export const membriDellaLega = () => contesto?.membri || [];
export const sonoAdmin = () => contesto?.lega?.ruolo === 'admin';

function legaPreferita() {
  try { return localStorage.getItem(CHIAVE_LEGA) || null; } catch { return null; }
}
function ricordaLega(id) {
  try {
    if (id) localStorage.setItem(CHIAVE_LEGA, id);
    else localStorage.removeItem(CHIAVE_LEGA);
  } catch { /* storage non disponibile */ }
}

async function chiedi(percorso) {
  const r = await fetch(`${cfg.url}/rest/v1/${percorso}`, { headers: intestazioni() });
  if (!r.ok) throw new Error(await messaggioErrore(r));
  return r.json();
}

/** Chiama una funzione SQL. Le usiamo per entrare, creare e scegliere. */
async function funzione(nome, argomenti) {
  await rinnovaSeScaduta();
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${nome}`, {
    method: 'POST', headers: intestazioni(), body: JSON.stringify(argomenti),
  });
  if (!r.ok) throw new Error(await messaggioErrore(r));
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

/** Tutte le leghe di cui faccio parte, con il mio ruolo e la mia squadra. */
export async function mieLeghe() {
  if (!collegato()) return [];
  const righe = await chiedi('membri?select=ruolo,squadra_id,lega_id,leghe(id,nome,codice)');
  return righe.filter(m => m.leghe).map(m => ({
    id: m.leghe.id, nome: m.leghe.nome, codice: m.leghe.codice,
    ruolo: m.ruolo, squadraId: m.squadra_id,
  }));
}

/**
 * Carica il contesto: quale lega, quale squadra, chi altro c'e'.
 * Da chiamare dopo `avvia()` in ogni pagina che tocca il database.
 */
export async function caricaContesto(idLega = null) {
  contesto = null;
  if (!configurato() || !collegato()) { contestoCambiato(); return null; }

  const leghe = await mieLeghe();
  if (!leghe.length) { contestoCambiato(); return null; }

  const scelto = idLega || legaPreferita();
  const mia = leghe.find(l => l.id === scelto) || leghe[0];
  ricordaLega(mia.id);

  const [squadre, membri] = await Promise.all([
    chiedi(`squadre?lega_id=eq.${mia.id}&select=id,nome,ordine&order=ordine,creata`),
    chiedi(`membri?lega_id=eq.${mia.id}&select=utente_id,squadra_id,ruolo,nome`),
  ]);

  await firmaLaMiaRiga(mia.id, membri);

  contesto = {
    lega: mia,
    squadra: squadre.find(s => s.id === mia.squadraId) || null,
    squadre,
    membri,
    leghe,
  };
  contestoCambiato();
  return contesto;
}

/**
 * Se la mia riga fra i membri non ha un nome, ce lo mette.
 *
 * Succede a chi e' arrivato dalla migrazione della vecchia lega: quella riga
 * e' stata scritta dal database, che il nome dell'account non ce l'aveva, e
 * nella tabella "chi c'e'" comparivo come «senza nome». Chi entra dal sito il
 * nome lo passa gia' lui, quindi qui non entra mai.
 */
async function firmaLaMiaRiga(idLega, membri) {
  const io = utente();
  if (!io) return;
  const mia = membri.find(m => m.utente_id === io.id);
  if (!mia || (mia.nome || '').trim()) return;
  try {
    const r = await fetch(
      `${cfg.url}/rest/v1/membri?lega_id=eq.${idLega}&utente_id=eq.${io.id}`,
      { method: 'PATCH', headers: intestazioni(), body: JSON.stringify({ nome: io.nome }) });
    if (r.ok) mia.nome = io.nome;      // cosi' la pagina lo vede subito
  } catch { /* pazienza: resta «senza nome» fino al prossimo giro */ }
}

export const leggiLeghe = () => contesto?.leghe || [];

/**
 * Quello che ogni pagina deve fare prima di leggere qualsiasi cosa: accendere
 * la connessione e capire in che lega e in che squadra sei. Tenerlo in una
 * funzione sola evita che una pagina se lo dimentichi e finisca a leggere
 * documenti senza sapere di chi sono.
 */
let contestoCaricato = false;
export async function pronto() {
  await avvia();
  if (!contestoCaricato && configurato() && collegato()) {
    contestoCaricato = true;
    try { await caricaContesto(); } catch { /* lo dira' la pagina */ }
  }
  return contesto;
}

export async function creaLega(nome, codice) {
  const id = await funzione('crea_lega', {
    nome_lega: nome, codice_lega: codice, nome_membro: utente()?.nome || null,
  });
  ricordaLega(id);
  return caricaContesto(id);
}

export async function entraInLega(codice) {
  const id = await funzione('entra_in_lega', {
    codice_lega: codice, nome_membro: utente()?.nome || null,
  });
  ricordaLega(id);
  return caricaContesto(id);
}

export async function scegliSquadra(idSquadra) {
  if (!contesto?.lega) throw new Error('Prima devi entrare in una lega.');
  await funzione('scegli_squadra', { l: contesto.lega.id, s: idSquadra });
  return caricaContesto(contesto.lega.id);
}

export async function cambiaLega(id) { ricordaLega(id); return caricaContesto(id); }

/** Aggiunge una squadra alla lega. Solo l'admin ci riesce: lo dice il database. */
export async function creaSquadra(nome) {
  if (!contesto?.lega) throw new Error('Prima devi entrare in una lega.');
  const r = await fetch(`${cfg.url}/rest/v1/squadre`, {
    method: 'POST',
    headers: intestazioni({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      lega_id: contesto.lega.id, nome,
      ordine: (contesto.squadre.at(-1)?.ordine ?? contesto.squadre.length) + 1,
    }),
  });
  if (!r.ok) throw new Error(await messaggioErrore(r));
  await caricaContesto(contesto.lega.id);
  return (await r.json())[0];
}

export async function rinominaSquadra(id, nome) {
  const r = await fetch(`${cfg.url}/rest/v1/squadre?id=eq.${id}`, {
    method: 'PATCH', headers: intestazioni(), body: JSON.stringify({ nome }),
  });
  if (!r.ok) throw new Error(await messaggioErrore(r));
  return caricaContesto(contesto.lega.id);
}

/* ---------- documenti ---------- */

/* Supabase ha due formati di chiave pubblica:
   - quella "legacy anon", che e' un JWT e inizia per eyJ
   - quella nuova "publishable", che inizia per sb_publishable_ e NON e' un JWT
   Vanno entrambe bene, ma la seconda non si puo' mettere in Authorization:
   la si passa solo come apikey, e Authorization si riempie unicamente quando
   c'e' davvero un utente collegato. */
function intestazioni(extra = {}) {
  const h = { apikey: cfg.anonKey, 'Content-Type': 'application/json', ...extra };
  if (sessione?.access_token) h.Authorization = `Bearer ${sessione.access_token}`;
  else if (cfg.anonKey.startsWith('eyJ')) h.Authorization = `Bearer ${cfg.anonKey}`;
  return h;
}

/**
 * Dove sta un documento.
 *
 *   privato: false  → documento DI LEGA. Lo vedono tutti i membri. Sono le
 *                     regole della lega e le aggiudicazioni dell'asta, che al
 *                     tavolo sono comunque cosa pubblica.
 *   privato: true   → documento DI SQUADRA. Lo vede solo chi gestisce quella
 *                     squadra. Sono il piano di spesa e la bozza.
 *
 * Non e' solo una convenzione del client: le regole del database controllano
 * la stessa cosa, quindi anche chi provasse a chiedere il documento di un
 * altro riceverebbe zero righe.
 */
function ambito(privato) {
  if (!contesto?.lega) throw new Error('Prima devi entrare in una lega.');
  if (!privato) return { filtro: 'squadra_id=is.null', colonne: { squadra_id: null } };
  if (!contesto.squadra) {
    throw new Error('Prima devi scegliere quale squadra gestisci, dalla pagina «La mia lega».');
  }
  return {
    filtro: `squadra_id=eq.${contesto.squadra.id}`,
    colonne: { squadra_id: contesto.squadra.id },
  };
}

const dove = (chiave, privato) =>
  `lega_id=eq.${contesto.lega.id}&${ambito(privato).filtro}&chiave=eq.${encodeURIComponent(chiave)}`;

/** Legge un documento. Restituisce { dati, versione } — versione 0 se non esiste. */
export async function leggi(chiave, vuoto, privato = false) {
  await rinnovaSeScaduta();
  const r = await fetch(
    `${cfg.url}/rest/v1/documenti?${dove(chiave, privato)}&select=dati,versione,aggiornato,da`,
    { headers: intestazioni() });
  if (!r.ok) throw new Error(await messaggioErrore(r));
  const righe = await r.json();
  if (!righe.length) return { dati: vuoto, versione: 0, nuovo: true };
  return { dati: righe[0].dati, versione: righe[0].versione, aggiornato: righe[0].aggiornato, da: righe[0].da };
}

async function messaggioErrore(r) {
  const t = await r.text();
  if (r.status === 401) return 'Sessione scaduta: rientra.';
  if (r.status === 403) return 'Non hai il permesso di scrivere. Hai fatto l\'accesso?';
  if (r.status === 404) return 'Le tabelle non ci sono ancora: incolla tools/supabase.sql nell\'SQL Editor di Supabase.';
  if (r.status === 409) return 'Quel documento esiste gia\': ricarica la pagina.';
  return `Il database ha risposto ${r.status}. ${t.slice(0, 140)}`;
}

/**
 * Scrive un documento controllando la versione.
 * Se nel frattempo l'ha cambiato qualcun altro, rilegge, chiama `fondi` per
 * mettere insieme le due versioni e riprova una volta.
 */
export async function scrivi(chiave, dati, versione, fondi, privato = false) {
  await rinnovaSeScaduta();
  if (!collegato()) throw new Error('Per salvare devi entrare col tuo account.');
  const chi = utente()?.nome || 'anonimo';
  const { colonne } = ambito(privato);

  if (versione === 0) {
    const r = await fetch(`${cfg.url}/rest/v1/documenti`, {
      method: 'POST',
      headers: intestazioni({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        lega_id: contesto.lega.id, ...colonne, chiave, dati,
        versione: 1, da: chi, aggiornato: new Date().toISOString(),
      }),
    });
    /* Se nel frattempo l'ha creato l'altro membro della squadra, il vincolo di
       unicita' scatta: rileggiamo e riproviamo come aggiornamento. */
    if (r.status === 409) {
      const fresco = await leggi(chiave, null, privato);
      return scrivi(chiave, fondi ? fondi(fresco.dati, dati) : dati, fresco.versione, fondi, privato);
    }
    if (!r.ok) throw new Error(await messaggioErrore(r));
    const [riga] = await r.json();
    return { versione: riga.versione, dati: riga.dati };
  }

  const invia = async (corpo, v) => fetch(
    `${cfg.url}/rest/v1/documenti?${dove(chiave, privato)}&versione=eq.${v}`,
    {
      method: 'PATCH',
      headers: intestazioni({ Prefer: 'return=representation' }),
      body: JSON.stringify({ dati: corpo, versione: v + 1, da: chi, aggiornato: new Date().toISOString() }),
    });

  let r = await invia(dati, versione);
  if (!r.ok) throw new Error(await messaggioErrore(r));
  let righe = await r.json();

  if (!righe.length) {
    // nessuna riga aggiornata: qualcun altro ha salvato prima di noi
    const fresco = await leggi(chiave, null, privato);
    const fuso = fondi ? fondi(fresco.dati, dati) : dati;
    r = await invia(fuso, fresco.versione);
    if (!r.ok) throw new Error(await messaggioErrore(r));
    righe = await r.json();
    if (!righe.length) throw new Error('Il documento continua a cambiare sotto le mani. Ricarica e riprova.');
    return { versione: righe[0].versione, dati: righe[0].dati, fuso: true };
  }

  return { versione: righe[0].versione, dati: righe[0].dati };
}

/**
 * Controlla ogni tanto se il documento è cambiato e avvisa.
 * Niente websocket: per due persone un giro ogni dodici secondi è indistinguibile
 * dal tempo reale, e non si rompe mai.
 */
export function osserva(chiave, versioneCorrente, alCambio, intervallo = 12000, privato = false) {
  let vivo = true;
  const giro = async () => {
    if (!vivo) return;
    if (document.visibilityState === 'visible' && configurato() && inLega()) {
      try {
        const r = await leggi(chiave, null, privato);
        if (r.versione > versioneCorrente()) alCambio(r);
      } catch { /* riproviamo al prossimo giro */ }
    }
    if (vivo) setTimeout(giro, intervallo);
  };
  setTimeout(giro, intervallo);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') giro();
  });
  return () => { vivo = false; };
}

/* ---------- pannello di accesso, comune alle pagine condivise ---------- */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? 'oggi alle ' + ora
    : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ' alle ' + ora;
}

/* Chi ha gia' una barra montata, e chi vuole essere avvisato.
 *
 * Serve da quando piu' sezioni stanno nella stessa pagina sotto forma di
 * schede: fantasquadre, la lega e le impostazioni la montavano ognuna per
 * conto suo, e tre barre nella stessa pagina vuol dire tre campi con lo
 * stesso identificativo — il browser ne trova uno solo, e l'accesso smette
 * di funzionare. Adesso la prima chiamata monta, le altre si limitano ad
 * aggiungere il loro richiamo. */
const barreMontate = new WeakMap();

export function montaAccesso(contenitore, alCambio) {
  if (!contenitore) return;
  const gia = barreMontate.get(contenitore);
  if (gia) { if (alCambio) gia.add(alCambio); return; }
  const richiami = new Set(alCambio ? [alCambio] : []);
  barreMontate.set(contenitore, richiami);
  const avvisaTutti = () => { for (const f of richiami) { try { f(); } catch { /* uno rotto non ferma gli altri */ } } };

  const disegna = (errore = '', modo = 'entra') => {
    if (!configurato()) {
      const daCompilare = cfg?.mancante === 'da-compilare';
      contenitore.innerHTML = `<div class="idbar" style="border-color:var(--warn);align-items:flex-start">
        <span class="idlab" style="color:var(--warn)">Database non collegato</span>
        <span style="flex:1 1 320px">${daCompilare
          ? 'Il file <code>assets/data/supabase.json</code> c\'è ma contiene ancora i segnaposto: servono l\'indirizzo del progetto Supabase e la chiave <em>anon public</em>.'
          : 'Manca il file <code>assets/data/supabase.json</code>.'}
          <br>Finché non è collegato, questa pagina resta in sola lettura — i quattro passaggi sono nel README, sezione <em>Configurare il database</em>.</span></div>`;
      return;
    }

    const u = utente();
    if (u) {
      /* Dire sempre per conto di CHI stai lavorando. Con piu' persone e piu'
         leghe, "collegato come Pierre" non basta: quello che vedi dipende
         dalla squadra, non dall'account. */
      const l = lega(), s = squadra();
      contenitore.innerHTML = `<div class="idbar">
        <span class="idlab">Collegato come</span>
        <strong class="idnome">${esc(u.nome)}</strong>
        ${l ? `<span class="pill p-g">${esc(l.nome)}</span>` : ''}
        ${s ? `<span class="pill p-t">${esc(s.nome)}</span>`
    : l ? '<span class="pill p-l">nessuna squadra</span>' : ''}
        ${!l ? '<span style="color:var(--warn);font-size:.8rem">non sei in nessuna lega</span>' : ''}
        <a class="chip" href="altro.html#lega" style="text-decoration:none">la mia lega</a>
        <button class="chip" id="esci" style="margin-left:auto">esci</button></div>`;
      contenitore.querySelector('#esci').onclick = () => {
        esci(); contesto = null; contestoCaricato = false; disegna(); contestoCambiato(); avvisaTutti();
      };
      return;
    }

    contenitore.innerHTML = `<form class="idbar" id="accesso" style="align-items:flex-end">
      <div class="fld" style="flex:1 1 180px"><label for="mail">Email</label>
        <input id="mail" type="email" autocomplete="username" required></div>
      <div class="fld" style="flex:1 1 150px"><label for="pw">Password</label>
        <input id="pw" type="password" autocomplete="current-password" minlength="6" required></div>
      ${modo === 'registra' ? `<div class="fld" style="flex:1 1 130px"><label for="nome">Come ti chiami</label>
        <input id="nome" type="text" required></div>` : ''}
      <button class="btn" type="submit">${modo === 'registra' ? 'Registrati' : 'Entra'}</button>
      <button class="chip" type="button" id="alterna">${modo === 'registra' ? 'ho già un account' : 'prima volta? registrati'}</button>
      ${errore ? `<span style="color:var(--warn);font-size:.82rem;flex:1 1 100%">${esc(errore)}</span>` : ''}
    </form>`;

    contenitore.querySelector('#alterna').onclick = () =>
      disegna('', modo === 'registra' ? 'entra' : 'registra');

    contenitore.querySelector('#accesso').onsubmit = async e => {
      e.preventDefault();
      const email = contenitore.querySelector('#mail').value.trim();
      const pw = contenitore.querySelector('#pw').value;
      const nome = contenitore.querySelector('#nome')?.value.trim();
      try {
        if (modo === 'registra') {
          const r = await registrati(email, pw, nome || email.split('@')[0]);
          if (!r.entrato) return disegna(r.messaggio, 'entra');
        } else {
          await entra(email, pw);
        }
        /* appena entrato, il sito deve sapere in che lega e in che squadra
           sei: senza, la pagina proverebbe a leggere documenti senza sapere
           di chi sono */
        try { await caricaContesto(); } catch { /* lo dira' la pagina */ }
        disegna();
        avvisaTutti();
      } catch (err) {
        disegna(err.message, modo);
      }
    };
  };

  disegna();

  /* Da qui in poi la barra si ridisegna da sola: appena il sito scopre in che
     lega e in che squadra sei, le pill compaiono senza che la pagina debba
     ricordarsi di chiederlo. */
  alContesto(() => disegna());
}
