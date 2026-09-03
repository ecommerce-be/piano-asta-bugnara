#!/usr/bin/env python3
"""Marca ogni file con l'impronta del suo contenuto, così il browser lo ricarica.

    python3 tools/versione.py            # ricalcola tutte le impronte
    python3 tools/versione.py --controlla  # non scrive: dice solo cosa è scaduto

IL PROBLEMA. Il browser tiene i file in cache e, dopo una modifica, continua a
servire la versione vecchia. La soluzione classica è appendere qualcosa
all'indirizzo — `listone.js?v=53` — perché un indirizzo diverso è un file
diverso e va riscaricato.

PERCHE' NON UN NUMERO SOLO PER TUTTI. Era così fino alla v53: un contatore
unico, marcato su ogni pagina e ogni modulo. Funzionava, ma cambiare una riga
in un file voleva dire rimarcarne trentadue — se no il controllo di coerenza
segnalava, giustamente, «versioni diverse fra i file». Risultato: ogni
modifica, anche minima, produceva trenta file modificati nel commit. Rumore
che nasconde il segnale: in quel diff non si vede più cosa è cambiato davvero.

COME FUNZIONA ADESSO. L'impronta di ogni file è l'hash del suo contenuto, e i
riferimenti la portano: `listone.js?v=a3f1c9`. Cambiando `listone.js` cambia la
sua impronta, e cambiano solo i file che lo nominano.

La parte che conta è che l'impronta si calcola DOPO aver riscritto i
riferimenti che il file contiene. Così una modifica si propaga a chi dipende:
se cambia `db.js`, cambia la riga di import dentro `astaLega.js`, quindi cambia
anche l'impronta di `astaLega.js`, e chi importa lui viene rimarcato a sua
volta. E' esattamente quello che serve — quei file il browser deve davvero
riscaricarli — e succede da solo, senza contatori da tenere allineati.

Per farlo bisogna visitare i moduli in ordine di dipendenza: prima quelli che
non importano nessuno, poi chi importa loro. Se ci fosse un ciclo di import
l'ordine non esisterebbe, e in quel caso lo script si ferma e lo dice.

Il numero di versione scritto a mano nelle pagine è sparito: il segnaposto
accanto al logo ora legge l'impronta dal proprio indirizzo (`import.meta.url`
in theme.js), che è letteralmente «la versione del file che il browser ti sta
servendo» — cioè quello che quel numero voleva dire.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

# Su Windows Python scrive sul terminale con la codifica locale (cp1252), e chi
# legge quel testo da un altro programma se lo aspetta in UTF-8: gli accenti
# arrivano rotti. Costa una riga evitarlo, e ha gia' fatto perdere un'ora.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

RADICE = Path(__file__).resolve().parent.parent
PAGINE = sorted(RADICE.glob("*.html"))
MODULI = sorted((RADICE / "assets").glob("*.js"))
ALTRI = sorted((RADICE / "assets").glob("*.css")) + sorted((RADICE / "assets" / "data").glob("*.json"))

# src="assets/x.js"  href="assets/style.css"   (con o senza ?v= già presente)
RIF_HTML = re.compile(r'((?:src|href)=")(assets/[\w./-]+\.(?:js|css))(?:\?v=[\w]+)?(")')
# data-modulo="fasce.js?v=…": il modulo di una scheda, caricato quando la si apre
RIF_SCHEDA = re.compile(r'(data-modulo=")([\w./-]+\.js)(?:\?v=[\w]+)?(")')
# import … from './x.js'
RIF_IMPORT = re.compile(r"((?:from|import)\s*\(?\s*')(\./[\w./-]+\.js)(?:\?v=[\w]+)?(')")
# fetch('assets/data/x.json')  — solo se l'indirizzo finisce lì: uno che ha già
# una query sua diventerebbe «?v=…?t=…», due punti interrogativi
RIF_DATI = re.compile(r"(fetch\(\s*')(assets/data/[\w./-]+\.json)(?:\?v=[\w]+)?(')")
# il vecchio numero unico, che non serve più
RIF_META = re.compile(r'\s*<meta name="versione" content="[^"]*">\n?')

LUNGHEZZA = 8


def impronta(testo: str) -> str:
    return hashlib.sha1(testo.encode("utf-8")).hexdigest()[:LUNGHEZZA]


def rel(p: Path) -> str:
    return p.relative_to(RADICE).as_posix()


def dipendenze(testo: str) -> list[str]:
    """Quali moduli importa questo modulo, come percorsi tipo 'assets/db.js'."""
    return ["assets/" + m.group(2)[2:] for m in RIF_IMPORT.finditer(testo)]


def in_ordine(grafo: dict[str, list[str]]) -> list[str]:
    """Prima chi non dipende da nessuno. Si ferma se trova un ciclo."""
    fatti: list[str] = []
    stato: dict[str, int] = {}      # 0 = in corso, 1 = finito

    def visita(n: str, catena: list[str]) -> None:
        if stato.get(n) == 1:
            return
        if stato.get(n) == 0:
            giro = " → ".join(catena[catena.index(n):] + [n])
            sys.exit(f"Ciclo di import fra i moduli: {giro}\n"
                     "Con un ciclo non esiste un ordine di dipendenza, e le impronte\n"
                     "non si possono calcolare. Va spezzato.")
        stato[n] = 0
        for d in grafo.get(n, []):
            if d in grafo:
                visita(d, catena + [n])
        stato[n] = 1
        fatti.append(n)

    for n in sorted(grafo):
        visita(n, [])
    return fatti


def main() -> int:
    controlla = "--controlla" in sys.argv
    stampe: dict[str, str] = {}
    scaduti: list[str] = []
    toccati = 0

    def scrivi(p: Path, prima: str, dopo: str) -> bool:
        nonlocal toccati
        if prima == dopo:
            return False
        if controlla:
            scaduti.append(rel(p))
        else:
            p.write_text(dopo, encoding="utf-8")
            toccati += 1
        return True

    # 1. i file che non nominano nessuno: fogli di stile e dati
    for f in ALTRI:
        stampe[rel(f)] = impronta(f.read_text(encoding="utf-8"))

    # 2. i moduli, in ordine di dipendenza
    grafo = {rel(m): dipendenze(m.read_text(encoding="utf-8")) for m in MODULI}
    for nome in in_ordine(grafo):
        f = RADICE / nome
        prima = f.read_text(encoding="utf-8")
        t = RIF_IMPORT.sub(
            lambda m: f"{m.group(1)}{m.group(2)}?v={stampe.get('assets/' + m.group(2)[2:], '?')}{m.group(3)}",
            prima)
        t = RIF_DATI.sub(
            lambda m: f"{m.group(1)}{m.group(2)}?v={stampe.get(m.group(2), '?')}{m.group(3)}", t)
        scrivi(f, prima, t)
        stampe[nome] = impronta(t)

    # 3. le pagine
    for f in PAGINE:
        prima = f.read_text(encoding="utf-8")
        t = RIF_HTML.sub(
            lambda m: f"{m.group(1)}{m.group(2)}?v={stampe.get(m.group(2), '?')}{m.group(3)}", prima)
        t = RIF_SCHEDA.sub(
            lambda m: f"{m.group(1)}{m.group(2)}?v={stampe.get('assets/' + m.group(2), '?')}{m.group(3)}", t)
        t = RIF_META.sub("\n", t)      # il numero unico non serve più
        scrivi(f, prima, t)

    if controlla:
        # La prima riga e' fatta per essere letta da un programma: sola ASCII,
        # sempre nella stessa forma. Il resto e' per gli umani. Prima coerenza
        # cercava la frase discorsiva, che conteneva un accento — e su Windows
        # l'accento arriva rotto, la frase non combacia, e il controllo si
        # arrendeva in silenzio dicendo «non trovo un python».
        if scaduti:
            print(f"IMPRONTE: {len(scaduti)} scadute")
            print("Questi file portano impronte non piu' valide:")
            for s in scaduti:
                print(f"  - {s}")
            print("\nLancia: python tools/versione.py")
            return 1
        print("IMPRONTE: ok")
        print(f"Tutte le impronte sono aggiornate ({len(stampe)} file).")
        return 0

    print(f"Impronte ricalcolate: {toccati} file modificati su {len(PAGINE) + len(MODULI)}.")
    if toccati:
        print("Ora fai commit e push: cambia l'indirizzo solo dei file cambiati davvero,")
        print("quindi il browser riscarica quelli e tiene in cache tutti gli altri.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
