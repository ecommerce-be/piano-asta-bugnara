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
    const r = await fetch('assets/data/supabase.json?v=7?t=' + Date.now());
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

/** Legge un documento. Restituisce { dati, versione } — versione 0 se non esiste. */
export async function leggi(chiave, vuoto) {
  await rinnovaSeScaduta();
  const r = await fetch(
    `${cfg.url}/rest/v1/documenti?chiave=eq.${encodeURIComponent(chiave)}&select=dati,versione,aggiornato,da`,
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
  if (r.status === 404) return 'La tabella "documenti" non esiste ancora: manca lo script SQL su Supabase.';
  return `Il database ha risposto ${r.status}. ${t.slice(0, 140)}`;
}

/**
 * Scrive un documento controllando la versione.
 * Se nel frattempo l'ha cambiato qualcun altro, rilegge, chiama `fondi` per
 * mettere insieme le due versioni e riprova una volta.
 */
export async function scrivi(chiave, dati, versione, fondi) {
  await rinnovaSeScaduta();
  if (!collegato()) throw new Error('Per salvare devi entrare col tuo account.');
  const chi = utente()?.nome || 'anonimo';

  if (versione === 0) {
    const r = await fetch(`${cfg.url}/rest/v1/documenti`, {
      method: 'POST',
      headers: intestazioni({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify({ chiave, dati, versione: 1, da: chi, aggiornato: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(await messaggioErrore(r));
    const [riga] = await r.json();
    return { versione: riga.versione, dati: riga.dati };
  }

  const invia = async (corpo, v) => fetch(
    `${cfg.url}/rest/v1/documenti?chiave=eq.${encodeURIComponent(chiave)}&versione=eq.${v}`,
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
    const fresco = await leggi(chiave, null);
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
export function osserva(chiave, versioneCorrente, alCambio, intervallo = 12000) {
  let vivo = true;
  const giro = async () => {
    if (!vivo) return;
    if (document.visibilityState === 'visible' && configurato()) {
      try {
        const r = await leggi(chiave, null);
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

export function montaAccesso(contenitore, alCambio) {
  if (!contenitore) return;

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
      contenitore.innerHTML = `<div class="idbar">
        <span class="idlab">Collegato come</span>
        <strong class="idnome">${esc(u.nome)}</strong>
        <span class="pill p-t">può salvare</span>
        <span style="color:var(--ink3);font-size:.75rem">${esc(u.email)}</span>
        <button class="chip" id="esci" style="margin-left:auto">esci</button></div>`;
      contenitore.querySelector('#esci').onclick = () => { esci(); disegna(); alCambio?.(); };
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
        disegna();
        alCambio?.();
      } catch (err) {
        disegna(err.message, modo);
      }
    };
  };

  disegna();
}
