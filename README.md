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
| `squadre.html` | Le venti squadre di Serie A: si sceglie un club dal menù e si vede la rosa completa con le statistiche |
| `bozza.html` | La rosa ideale costruita in due, **condivisa** |
| `fantasquadre.html` | Le squadre della lega con proprietario, rosa e crediti residui, **condivise** |

### Durante l'asta

Ogni riga del listone ha tre comandi: **preso a**, dove scrivi quanto hai pagato
tu; **a chi?**, che assegna il giocatore a una fantasquadra con il prezzo, e
scala i crediti a quella squadra; e **ad altri**, la scorciatoia per quando sai
che è uscito dal mercato ma non ti interessa registrare a chi è andato. Il secondo
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
  ui.js                 finestre di dialogo del sito e salvataggio automatico
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
  astaLega.js           l'asta della lega: un archivio solo, e come si uniscono due versioni
tools/
  build_prices.py       rigenera assets/data/players.json da listone + overrides
  aggiorna_dati.py      riscarica listone e infermeria, e rimarca l'impronta dei dati
  simulate_modifier.py  quanto rende il modificatore, per assetto e qualità del reparto
  supabase.sql          tabella e regole di sicurezza del database condiviso
  prova-permessi.sql    tredici prove di sicurezza, da incollare nell'SQL Editor
  coerenza.mjs          il controllo generale: lancia tutto quello che c'è qui sotto
  prova-asta.mjs        le regole dell'asta condivisa, senza browser
  prova-asta-browser.mjs il giro completo nel browser, con un finto Supabase
  versione.py           marca i file con ?v=N così il browser non serve la cache
```

## Controllare che sia tutto a posto

Un comando solo, che tira dentro tutti gli altri. Servono due finestre, perché
la prima resta occupata dal server:

```bash
python3 -m http.server 8123      # su Windows: python -m http.server 8123
```

```bash
node tools/coerenza.mjs
```

Controlla, in quest'ordine: che tutti i moduli si leggano davvero come moduli
(`node --check` non basta, tratta i file come CommonJS e lascia passare errori
che poi lasciano la pagina bianca); che nessun modulo si tenga una copia sua
dell'asta; le 23 prove sulle regole dell'asta condivisa; che tutti i file
portino la stessa `?v=`; che l'impronta dei dati in `app.js` corrisponda davvero
a `players.json`, e da quanto non si aggiorna; che ogni pagina si apra senza
errori; che i numeri di lega coincidano ovunque; che guida e rosa ideale
propongano la stessa rosa; che nessun nome di giocatore sia scritto a mano
nell'HTML; che la guida regga tutte e sedici le combinazioni di modulo e
strategia; e infine il giro completo dell'asta dentro un browser vero, con un
finto Supabase — segno un acquisto nel listone e lo ritrovo in «La mia rosa»,
«Fantasquadre» e «Serie A» senza fare altro.

Esce con codice 1 se qualcosa non torna, quindi si può incatenare a un commit.

### Le prove che aprono il browser

I controlli sulle pagine hanno bisogno di **Playwright**, che *non* è una
dipendenza del sito — il sito non ne ha nessuna, e non ne vogliamo. È solo
attrezzatura da banco di prova, quindi può non esserci: in quel caso
`coerenza.mjs` fa lo stesso tutti i controlli sui file, dice chiaramente cosa
ha saltato e non fallisce.

Per averle anche in locale, una volta sola (finisce in `node_modules/`, che è
già ignorato da git):

```bash
npm install --no-save playwright
npx playwright install chromium
```

Se Chromium ce l'hai già altrove, basta indicarglielo con la variabile
d'ambiente `CHROME_PATH`; `PLAYWRIGHT_PATH` fa lo stesso per il pacchetto.

### Le prove di sicurezza del database

Sono a parte, perché girano dentro Postgres: si incolla
`tools/prova-permessi.sql` nell'SQL Editor di Supabase e si preme Run. Tredici
prove, si crea e si cancella tutto da sola.

## Le statistiche dei giocatori

Presenze con voto, media voto e fantamedia stanno già nell'export del listone di
LegheFantacalcio, nelle colonne `PGv`, `MV` e `FM`. Per aggiornarle basta
riesportare quel file sopra `data/listone-classic-2026-27.xlsx` e rilanciare
`python3 tools/build_prices.py`: un'operazione da mezzo minuto a settimana.

Gol, assist e cartellini stanno invece in un export diverso. Se metti un file
`data/statistiche.json` fatto così, lo script lo aggancia da solo:

```json
{
  "orsolini": { "gol": 10, "assist": 6, "amm": 4, "esp": 0 },
  "calhanoglu": { "gol": 9, "assist": 4, "amm": 6, "esp": 0 }
}
```

La chiave è il cognome come appare nel listone, senza accenti e in minuscolo.
Finché il file non c'è, quelle colonne restano vuote e il resto funziona uguale.

## Dopo ogni modifica al codice: la versione

I browser tengono in cache i moduli JavaScript con parecchia insistenza, e dopo
una modifica continueresti a vedere la versione vecchia. Per questo ogni file è
marcato con `?v=N` e il numero compare accanto al logo, in alto a sinistra.

Dopo aver toccato un file in `assets/`, prima del commit:

```bash
python3 tools/versione.py
```

Incrementa il numero ovunque — script, foglio di stile, import fra moduli, file di
dati. Chi apre il sito scarica tutto di nuovo senza dover fare niente. Se il
numero accanto al logo non è quello che ti aspetti, il browser sta ancora
servendo roba vecchia.

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

Tre livelli, e la differenza conta.

**Della lega** — le regole (crediti, squadre, slot, carattere del mercato) e
**l'asta**: chi si è aggiudicato chi e a quanto. Le vedono tutti i membri, di
proposito: al tavolo lo sono comunque, e servono a farsi i conti su chi ha
ancora crediti in mano.

**Della squadra** — il piano di spesa, il modulo, la strategia e la bozza. Li
vede solo chi gestisce quella fantasquadra: due account sulla stessa squadra
vedono le stesse cose, nessun altro le vede. Sapere quanto un avversario è
disposto a spendere sarebbe un vantaggio.

**Del browser** — solo il tema e qualche preferenza di visualizzazione
(l'ultimo ruolo aperto nelle fasce, l'ultima squadra scelta). Roba che non vale
la pena sincronizzare.

### L'asta sta in un posto solo

Fino alla versione 34 lo stesso fatto — *«Bremer è andato a me per 22»* — era
scritto in tre posti: nel `localStorage` del browser, in un documento per utente
(`asta:<id>`) e nelle rose delle fantasquadre. Tre archivi della stessa cosa
vogliono dire, prima o poi, tre risposte diverse: il socio apriva il listone e
lo vedeva vergine, cambiavi computer e ripartivi da zero crediti spesi, e ogni
tanto compariva il badge «non registrato», che era la spia di due archivi
divergenti.

Adesso ce n'è uno: il documento di lega `fantasquadre`. Tutto il resto si
**deduce** da lì — i tuoi acquisti sono la rosa della squadra che gestisci,
«fuori mercato» sono le rose delle altre più i giocatori segnati presi senza
dire da chi. Non c'è più niente da tenere allineato, perché non esiste un
secondo posto che possa dire il contrario. Il codice sta in
`assets/astaLega.js`; le pagine (listone, fantasquadre, la mia rosa, serie A,
fasce, infortunati) sono sei modi di guardare lo stesso documento.

Quando l'asta è aperta, il listone ricontrolla ogni otto secondi: gli acquisti
degli altri compaiono da soli, senza ricaricare.

Se avevi acquisti segnati nel vecchio archivio, il listone se ne accorge e ti
chiede se portarli dentro invece di buttarli via in silenzio.

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
