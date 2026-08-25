# Piano d'Asta — Lega Bugnara 2026/27

Sito statico per preparare e condurre l'asta di fantacalcio: la strategia, la rosa
target e il listone completo con il tetto di prezzo per ogni giocatore.

Sei pagine, nessun backend, nessun build step. Tema chiaro e scuro con
interruttore, e i ruoli colorati come su LegheFantacalcio (P arancio, D verde,
C blu, A rosso).

| Pagina | Cosa fa |
|---|---|
| `index.html` | La guida: perché in questa lega si vince in difesa, il piano di spesa, la rosa target in 4-5-1, le regole per l'asta a chiamata random, le shortlist per reparto |
| `listone.html` | Lo strumento d'asta: 540 giocatori filtrabili e ordinabili, tracker dei crediti, scorte per fascia, parametri di lega modificabili |
| `rosa.html` | La rosa che stai costruendo, l'undici titolare per modulo e il simulatore del modificatore di difesa |
| `squadre.html` | Le venti squadre di Serie A giocatore per giocatore, con lo stato di ciascuno |
| `bozza.html` | La rosa ideale costruita in due, **condivisa** |
| `fantasquadre.html` | Le squadre della lega con proprietario, rosa e crediti residui, **condivise** |

### Durante l'asta

Ogni riga del listone ha due comandi: **preso a**, dove scrivi quanto hai pagato
tu, e **ad altri**, che segna il giocatore come finito a un avversario. Il secondo
è quello che si usa di più: senza, dopo mezz'ora non sai più chi sia ancora
libero. I giocatori venduti si sbiadiscono, e il pulsante *Nascondi chi è già
andato* li toglie del tutto.

Sotto il riepilogo crediti c'è il conteggio delle **scorte per fascia**: quanti
portieri di prima fascia restano, quanti difensori, e così via. Con la chiamata
random è l'informazione che decide se rilanciare — se restano due portieri buoni
e cinque squadre sono ancora senza, il prossimo estratto costerà caro.

`/` porta il cursore nella ricerca.

## Come funziona il modello di prezzo

Ogni giocatore ha due numeri, entrambi calcolati nel browser a partire dalla
quotazione ufficiale del listone.

**Mercato atteso** — quanto costerà davvero al tavolo.

```
monte crediti = squadre × crediti a squadra
slot per ruolo = squadre × slot del ruolo
budget del ruolo = monte crediti × quota di mercato del ruolo
prezzo = 1 + (budget del ruolo − slot) × Qᵢ^α / Σ Qⱼ^α
```

`Q` è la quotazione ufficiale e `α = 1,4` concentra la spesa in alto, come succede
alle aste vere: il primo attaccante estratto non costa il doppio del secondo, ne
costa il triplo.

La **quota di mercato** per reparto è il parametro che descrive il *carattere*
della lega — quanto del monte crediti finisce in ogni reparto. La Lega Bugnara è
sbilanciata sull'attacco (5 / 12 / 28,5 / 54,5 per cento); una lega equilibrata
starebbe intorno a 6 / 15 / 30 / 49. Si cambia direttamente sulla pagina
`listone.html` e tutti i prezzi si ricalcolano.

**Mio max** — il tetto oltre il quale non si rilancia: mercato atteso × un
coefficiente per giocatore, tagliato da un massimo di reparto derivato dal piano
di spesa. Il coefficiente sta in [`data/overrides.json`](data/overrides.json) e
incorpora valore da modificatore di difesa, rigoristi, titolarità, ballottaggi e
infortuni. **È un giudizio, non un dato**: va aggiornato quando cambia il campo.

Il verdetto discende dal rapporto fra i due: `≥ 1,22` → **target** (vale più di
quanto costerà), `< 0,85` → **lascia**, in mezzo → prezzo giusto.

## Struttura

```
index.html              la guida
listone.html            lo strumento d'asta
bozza.html              la bozza condivisa
rosa.html               la rosa, l'undici, il simulatore
fantasquadre.html       le squadre della lega
squadre.html            le venti di Serie A
assets/
  style.css             stili condivisi, tema chiaro e scuro, colori dei ruoli
  app.js                modello di prezzo, simulazione del modificatore, stato dell'asta
  theme.js              interruttore chiaro / scuro / automatico
  guida.js              grafici, rosa target, shortlist
  listone.js            parametri di lega, filtri, tracker crediti, scorte per fascia
  rosa-page.js          rosa per reparto, undici titolare, simulatore
  squadre.js            vista per squadra
  db.js                 accesso, lettura e scrittura dei documenti condivisi su Supabase
  bozza.js              bozza condivisa
  fantasquadre.js       squadre della lega, rose e crediti
  data/supabase.json    indirizzo del progetto e chiave anon (da compilare)
  data/
    players.json        540 giocatori: nome, squadra, ruolo, quotazione, coefficiente, nota
    league.json         configurazione della lega: crediti, slot, bonus/malus, modificatore
    rosa.json           la rosa target in 4-5-1
data/
  listone-classic-2026-27.xlsx   il listone esportato dalla lega (sorgente)
  overrides.json                 coefficienti e note, editabili a mano
tools/
  build_prices.py       rigenera assets/data/players.json da listone + overrides
  simulate_modifier.py  quanto rende il modificatore, per assetto e qualità del reparto
  supabase.sql          tabella e regole di sicurezza del database condiviso
```

## Modificare i dati

Per cambiare un giudizio su un giocatore, si tocca `data/overrides.json` e si
rigenera:

```bash
pip install -r tools/requirements.txt
python3 tools/build_prices.py
```

Lo script segnala gli override che non corrispondono più a nessun giocatore del
listone — di solito perché hanno cambiato squadra o campionato.

Per rimisurare quanto rende il modificatore con la tabella della lega:

```bash
python3 tools/simulate_modifier.py
```

Legge soglie, minimo di difensori e inclusione del portiere da
`assets/data/league.json`: cambiando quel file la simulazione segue le regole
della tua lega.

## Dove tenere la cartella

Il contenuto di questo repository **è** il sito: la cartella che contiene
`index.html` è la radice del repository, non va annidata dentro un'altra.

Su Windows la convenzione è `C:\Users\<utente>\source\repos\piano-asta-bugnara`.
Su macOS e Linux va bene `~/progetti/piano-asta-bugnara`. Qualsiasi posto va bene
purché sia una cartella dedicata e non stia dentro un altro repository git.

## Provarlo in locale

Le pagine usano moduli ES e `fetch`, quindi vanno servite via HTTP: aprendo
`index.html` con doppio clic il browser blocca il caricamento dei dati e vedi una
pagina mezza vuota.

```powershell
# Windows (PowerShell)
cd C:\Users\<utente>\source\repos\piano-asta-bugnara
python -m http.server 8000
```

```bash
# macOS / Linux
cd ~/progetti/piano-asta-bugnara
python3 -m http.server 8000
```

Poi apri <http://localhost:8000>. `Ctrl+C` per fermarlo.

## Pubblicare su GitHub Pages

**1.** Crea su GitHub un repository **vuoto** chiamato `piano-asta-bugnara` —
senza README, senza .gitignore, senza licenza: ci sono già qui dentro, e un
repository preinizializzato manda in conflitto il primo push.

**2.** Sostituisci il segnaposto `TUO-UTENTE` nei link "Codice":

```powershell
# Windows (PowerShell)
(Get-ChildItem index.html, listone.html) | ForEach-Object {
  (Get-Content $_ -Raw) -replace 'TUO-UTENTE', 'il-tuo-username' |
    Set-Content $_ -NoNewline -Encoding utf8
}
```

```bash
# macOS
sed -i '' 's/TUO-UTENTE/il-tuo-username/g' index.html listone.html
# Linux
sed -i 's/TUO-UTENTE/il-tuo-username/g' index.html listone.html
```

**3.** Primo push:

```bash
git init -b main
git add -A
git commit -m "Piano d'asta Lega Bugnara 2026/27"
git remote add origin https://github.com/il-tuo-username/piano-asta-bugnara.git
git push -u origin main
```

**4.** Sul repository: **Settings → Pages → Source: _Deploy from a branch_ →
Branch: `main`, cartella `/ (root)` → Save**.

Un paio di minuti e il sito è su
`https://il-tuo-username.github.io/piano-asta-bugnara/`.

**5.** Per lavorarci in due: **Settings → Collaborators → Add people**.

Il file `.nojekyll` impedisce a Jekyll di ignorare file e cartelle che iniziano
per underscore. Non toccarlo.

## Dati privati e dati condivisi

Il sito tiene due categorie di dati, e la differenza conta.

**Privati del browser** — i parametri di lega che hai modificato e il tema. Stanno
nel `localStorage`.

**Condivisi nel database** — la bozza, le fantasquadre e lo stato della tua asta.
Stanno su Supabase, in una tabella `documenti` che tiene blocchi di JSON con una
chiave: `bozza`, `fantasquadre`, `asta:<id utente>`.

Lo stato dell'asta è **locale-first**: ogni clic aggiorna subito lo schermo e il
salvataggio parte tre secondi dopo l'ultima modifica. Durante la chiamata random
non aspetti mai la rete, ma ritrovi tutto sul telefono. Ognuno ha il proprio
documento: quello non è condiviso, la bozza e le fantasquadre sì.

## Configurare il database

Serve una volta sola, poi non ci si pensa più. Il piano gratuito di Supabase
basta e avanza.

**1.** Su [supabase.com](https://supabase.com) crea un account e un progetto
(regione Europa, così è più vicino).

**2.** **SQL Editor → New query**: incolla tutto il contenuto di
[`tools/supabase.sql`](tools/supabase.sql) e premi **Run**. Crea la tabella e le
regole di sicurezza.

**3.** **Authentication → Sign In / Providers → Email**: togli **Confirm email**.
Senza, a ogni registrazione tocca aprire la posta e cliccare un link. Per uno
strumento fra due persone è attrito inutile.

**4.** **Project Settings → API Keys**: copia il *Project URL* e **una** chiave
pubblica dentro `assets/data/supabase.json`. Supabase ne offre due formati e
vanno bene entrambi:

- scheda **Legacy anon, service_role API keys** → la riga `anon` `public`, una
  stringa lunga che inizia per `eyJ`
- scheda **Publishable and secret API keys** → *Publishable key*, che inizia per
  `sb_publishable_`

**Mai** la `secret` o la `service_role`: quelle scavalcano le regole di sicurezza
e non devono uscire da un server.

```json
{
  "url": "https://xxxxxxxx.supabase.co",
  "anonKey": "eyJhbGciOi..."
}
```

**5.** Commit, push. Sul sito, in cima a *Bozza*, ognuno si registra con la
propria email e una password.

### Perché la chiave pubblica può stare in un repository pubblico

Perché non è un segreto: è un identificatore del progetto, ed è pensata per stare
nel codice del browser — Supabase la chiama *publishable* proprio per questo. A proteggere i dati sono le policy di Row Level Security
create dallo script SQL, che permettono di leggere e scrivere **solo a chi ha
fatto l'accesso**. Chi trova la chiave e non ha un account non può né leggere né
scrivere niente.

Il rovescio: chiunque può *registrarsi* al progetto. Per due persone non è un
problema pratico, ma se ti dà fastidio, in **Authentication → Sign In /
Providers** puoi disattivare le registrazioni dopo che vi siete iscritti
entrambi.

### Chi ha modificato cosa

Lo sa il database: ogni salvataggio registra il nome dell'account. Nella bozza
resta scritto accanto a ogni giocatore, nelle fantasquadre in fondo a ogni
scheda. Nessuno deve dichiarare chi è.

### Modifiche in contemporanea

Ogni documento ha un numero di versione. Se salvi partendo da una versione ormai
vecchia, il database non aggiorna niente; il sito se ne accorge, rilegge la
versione fresca, unisce le due tenendo per ogni voce la modifica più recente e
riprova. Nessuno dei due perde il proprio lavoro. Te lo dice con *"ho unito le
modifiche arrivate nel frattempo"*.

Le pagine condivise si riallineano da sole ogni dodici secondi quando la scheda è
in primo piano. Non è websocket ma per due persone la differenza non si vede, e
non si rompe mai.

## Un avvertimento

Un sito su GitHub Pages con repository pubblico **è leggibile da chiunque**, e
Google lo indicizza. Se nella tua lega gioca qualcuno che potrebbe trovarlo, la
strategia smette di essere un vantaggio: i tetti sui portieri e sui difensori da
modificatore funzionano finché gli altri non ci pensano.

La bozza invece **non** è nel repository: sta nel database, e la vede solo chi ha
un account. Su quella potete stare tranquilli.

Se ti serve tenerlo privato, l'alternativa gratuita è Cloudflare Pages con
Cloudflare Access, che limita l'accesso a un elenco di email.

## Crediti

Quotazioni e ruoli dal listone ufficiale Classic 2026/27 di
[Fantacalcio.it](https://www.fantacalcio.it), esportato dalla lega su
LegheFantacalcio e usato a fini personali. Media voto, gerarchie, rigoristi e
infortuni raccolti al 25 agosto 2026 da Fantacalcio.it, SOS Fanta, FantaMaster,
Goal.com e Sky Sport.

Le valutazioni, i coefficienti e la strategia sono farina del nostro sacco e
valgono quanto vale una previsione di fantacalcio: il codice è MIT, i giudizi no.
