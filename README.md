# Piano d'Asta — Lega Bugnara 2026/27

Sito statico per preparare e condurre l'asta di fantacalcio: la strategia, la rosa
target e il listone completo con il tetto di prezzo per ogni giocatore.

Due pagine, nessun backend, nessun build step.

| Pagina | Cosa fa |
|---|---|
| `index.html` | La guida: perché in questa lega si vince in difesa, il piano di spesa, la rosa target in 4-5-1, le regole per l'asta a chiamata random, le shortlist per reparto |
| `listone.html` | Lo strumento: 540 giocatori filtrabili e ordinabili, tracker dei crediti durante l'asta, parametri di lega modificabili |

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
listone.html            lo strumento
assets/
  style.css             stili condivisi, con tema chiaro e scuro
  app.js                modello di prezzo, simulazione del modificatore, stato dell'asta
  guida.js              grafici, rosa target, shortlist
  listone.js            parametri di lega, filtri, tracker crediti
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

**2.** Sostituisci il segnaposto `ecommerce-be` nei link "Codice":

```powershell
# Windows (PowerShell)
(Get-ChildItem index.html, listone.html) | ForEach-Object {
  (Get-Content $_ -Raw) -replace 'ecommerce-be', 'il-tuo-username' |
    Set-Content $_ -NoNewline -Encoding utf8
}
```

```bash
# macOS
sed -i '' 's/ecommerce-be/il-tuo-username/g' index.html listone.html
# Linux
sed -i 's/ecommerce-be/il-tuo-username/g' index.html listone.html
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

## Un avvertimento

Un sito su GitHub Pages con repository pubblico **è leggibile da chiunque**, e
Google lo indicizza. Se nella tua lega gioca qualcuno che potrebbe trovarlo, la
strategia smette di essere un vantaggio: i tetti sui portieri e sui difensori da
modificatore funzionano finché gli altri non ci pensano.

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
