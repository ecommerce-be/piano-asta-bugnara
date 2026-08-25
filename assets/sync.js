/* Sincronizzazione condivisa via GitHub.
 *
 * L'idea: i dati che tu e il tuo socio dovete vedere entrambi non possono stare
 * nel localStorage, perché quello è privato di ogni browser. Li teniamo in due
 * file JSON dentro il repository, e il sito li legge e li riscrive usando le API
 * di GitHub. Ogni salvataggio diventa un commit: la cronologia ve la regala git.
 *
 * Il token non finisce mai nel codice: ognuno crea il proprio e lo incolla una
 * volta sola nel proprio browser. Chi non ne ha uno vede tutto in sola lettura.
 */

const CHIAVE_TOKEN = 'pianoAsta:gh';
const CHIAVE_CHI = 'pianoAsta:chi';

/* Deduce proprietario e repository dall'indirizzo, così il codice resta
   riutilizzabile se il repo cambia nome o passa a un altro account. */
function deduciRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    const repo = location.pathname.split('/').filter(Boolean)[0];
    if (repo) return { owner, repo };
    return { owner, repo: `${owner}.github.io` };
  }
  return { owner: 'ecommerce-be', repo: 'piano-asta-bugnara' };  // sviluppo in locale
}

export const REPO = deduciRepo();
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/`;

/* ---------- chi sta usando il sito ---------- */

export function chiSono() {
  try { return localStorage.getItem(CHIAVE_CHI) || ''; } catch { return ''; }
}
export function impostaChi(nome) {
  try { localStorage.setItem(CHIAVE_CHI, nome); } catch { /* storage non disponibile */ }
}

/* ---------- token ---------- */

export function token() {
  try { return localStorage.getItem(CHIAVE_TOKEN) || ''; } catch { return ''; }
}
export function impostaToken(t) {
  try {
    if (t) localStorage.setItem(CHIAVE_TOKEN, t);
    else localStorage.removeItem(CHIAVE_TOKEN);
  } catch { /* storage non disponibile */ }
}
export const puoScrivere = () => Boolean(token());

function intestazioni() {
  const h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

/** Verifica il token e restituisce il login GitHub, o null se non valido. */
export async function verificaToken() {
  if (!token()) return null;
  try {
    const r = await fetch('https://api.github.com/user', { headers: intestazioni() });
    if (!r.ok) return null;
    return (await r.json()).login;
  } catch { return null; }
}

/* ---------- lettura e scrittura dei file condivisi ---------- */

const daBase64 = b64 => decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
const aBase64 = txt => btoa(unescape(encodeURIComponent(txt)));

/**
 * Legge un file del repo. Restituisce { dati, sha }.
 * Lo sha serve per riscriverlo: GitHub lo usa per accorgersi se qualcun altro
 * ha modificato il file nel frattempo.
 */
export async function leggi(percorso, vuoto) {
  try {
    const r = await fetch(API + percorso + '?ref=main&t=' + Date.now(), { headers: intestazioni() });
    if (r.status === 404) return { dati: vuoto, sha: null, mancante: true };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return { dati: JSON.parse(daBase64(j.content)), sha: j.sha };
  } catch (e) {
    // senza rete o oltre il limite di richieste: ripiego sulla copia pubblicata
    try {
      // il percorso e' gia' relativo alla radice del sito, che e' dove stanno le pagine
      const r = await fetch(percorso + '?t=' + Date.now());
      if (r.ok) return { dati: await r.json(), sha: null, soloLettura: true };
    } catch { /* niente da fare */ }
    return { dati: vuoto, sha: null, errore: e.message };
  }
}

/**
 * Riscrive un file del repo creando un commit.
 * Se nel frattempo l'ha toccato qualcun altro, GitHub rifiuta: in quel caso
 * rileggiamo, passiamo i dati aggiornati alla funzione di fusione e riproviamo.
 */
export async function scrivi(percorso, dati, messaggio, sha, fondi) {
  if (!puoScrivere()) throw new Error('Serve un token con permesso di scrittura.');

  const invia = async (corpo, shaCorrente) => {
    const r = await fetch(API + percorso, {
      method: 'PUT',
      headers: { ...intestazioni(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: messaggio,
        content: aBase64(JSON.stringify(corpo, null, 1)),
        branch: 'main',
        ...(shaCorrente ? { sha: shaCorrente } : {}),
      }),
    });
    return r;
  };

  let r = await invia(dati, sha);

  if (r.status === 409 || r.status === 422) {
    const fresco = await leggi(percorso, null);
    const fuso = fondi ? fondi(fresco.dati, dati) : dati;
    r = await invia(fuso, fresco.sha);
    if (r.ok) return { sha: (await r.json()).content.sha, dati: fuso, fuso: true };
  }

  if (!r.ok) {
    const t = await r.text();
    if (r.status === 401) throw new Error('Token non valido o scaduto.');
    if (r.status === 403) throw new Error('Il token non ha il permesso di scrivere su questo repository.');
    throw new Error(`GitHub ha risposto ${r.status}. ${t.slice(0, 120)}`);
  }
  return { sha: (await r.json()).content.sha, dati };
}

/* ---------- sicurezza ---------- */

/** Testo scritto da una persona non entra mai in pagina senza passare di qui. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- data leggibile ---------- */

export function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const oggi = new Date();
  const stessoGiorno = d.toDateString() === oggi.toDateString();
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (stessoGiorno) return 'oggi alle ' + ora;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ' alle ' + ora;
}

/* ---------- barra "chi sei" + token, comune alle pagine condivise ---------- */

export function montaIdentita(contenitore, alCambio) {
  if (!contenitore) return;

  const disegna = async () => {
    const nome = chiSono();
    const login = await verificaToken();
    const statoToken = !token()
      ? '<span class="pill p-g">sola lettura</span>'
      : login
        ? `<span class="pill p-t">può salvare · ${esc(login)}</span>`
        : '<span class="pill p-l">token non valido</span>';

    contenitore.innerHTML = `
      <div class="idbar">
        <span class="idlab">Stai usando il sito come</span>
        <strong class="idnome">${nome ? esc(nome) : 'nessuno'}</strong>
        <button class="chip" id="cambiaChi">cambia</button>
        ${statoToken}
        <button class="chip" id="cambiaTok">${token() ? 'cambia token' : 'collega un token'}</button>
      </div>`;

    contenitore.querySelector('#cambiaChi').onclick = () => {
      const n = window.prompt('Come ti chiami? (finisce accanto alle modifiche che fai)', nome || '');
      if (n === null) return;
      impostaChi(n.trim());
      disegna();
      alCambio?.();
    };

    contenitore.querySelector('#cambiaTok').onclick = () => {
      const t = window.prompt(
        'Incolla il tuo token GitHub (lascia vuoto per scollegarlo).\n\n'
        + 'Si crea su github.com → Settings → Developer settings → Personal access tokens →\n'
        + 'Fine-grained tokens. Dai accesso solo a questo repository e permesso\n'
        + 'Contents: Read and write. Il token resta in questo browser.',
        '');
      if (t === null) return;
      impostaToken(t.trim());
      disegna();
      alCambio?.();
    };
  };

  disegna();
}

/** Alla prima visita chiede chi sei, una volta sola. */
export function chiediChiSeAssente() {
  if (chiSono()) return;
  const n = window.prompt('Benvenuto. Come ti chiami?\n(serve a far vedere al tuo socio chi ha fatto cosa)', '');
  if (n && n.trim()) impostaChi(n.trim());
}
