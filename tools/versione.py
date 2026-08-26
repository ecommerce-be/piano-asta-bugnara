#!/usr/bin/env python3
"""Marca i file del sito con un numero di versione, così il browser li ricarica.

    python3 tools/versione.py            # incrementa di uno
    python3 tools/versione.py 42         # imposta una versione precisa

Il problema che risolve: i browser tengono in cache i moduli JavaScript in modo
piuttosto testardo, e dopo una modifica continui a vedere la versione vecchia
finché non fai un ricaricamento forzato. Aggiungendo `?v=N` all'indirizzo di ogni
file, cambiare N basta a far scaricare tutto di nuovo.

Vengono marcati: gli script e il foglio di stile nelle pagine HTML, gli import fra
i moduli in assets/, e i file di dati caricati a runtime.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
PAGINE = sorted(RADICE.glob("*.html"))
MODULI = sorted((RADICE / "assets").glob("*.js"))

# src="assets/x.js"  href="assets/style.css"  (con o senza ?v= già presente)
RIF_HTML = re.compile(r'((?:src|href)=")(assets/[\w./-]+\.(?:js|css))(?:\?v=\d+)?(")')
# import ... from './x.js'   e   fetch('assets/data/x.json')
RIF_IMPORT = re.compile(r"((?:from|import)\s*\(?\s*')(\./[\w./-]+\.js)(?:\?v=\d+)?(')")
RIF_DATI = re.compile(r"(fetch\(\s*')(assets/data/[\w./-]+\.json)(?:\?v=\d+)?((?:'|\?))")
RIF_META = re.compile(r'<meta name="versione" content="\d+">\n?')


def versione_attuale() -> int:
    massimo = 0
    for f in PAGINE + MODULI:
        for n in re.findall(r"\?v=(\d+)", f.read_text(encoding="utf-8")):
            massimo = max(massimo, int(n))
    return massimo


def main() -> int:
    nuova = int(sys.argv[1]) if len(sys.argv) > 1 else versione_attuale() + 1
    toccati = 0

    for f in PAGINE:
        t = f.read_text(encoding="utf-8")
        originale = t
        t = RIF_HTML.sub(rf"\g<1>\g<2>?v={nuova}\g<3>", t)
        t = RIF_META.sub("", t)
        t = t.replace("</head>", f'<meta name="versione" content="{nuova}">\n</head>', 1)
        if t != originale:
            f.write_text(t, encoding="utf-8")
            toccati += 1

    for f in MODULI:
        t = f.read_text(encoding="utf-8")
        originale = t
        t = RIF_IMPORT.sub(rf"\g<1>\g<2>?v={nuova}\g<3>", t)
        t = RIF_DATI.sub(rf"\g<1>\g<2>?v={nuova}\g<3>", t)
        if t != originale:
            f.write_text(t, encoding="utf-8")
            toccati += 1

    print(f"Versione {nuova} marcata su {toccati} file.")
    print("Ora fai commit e push: chi apre il sito scarica tutto di nuovo,")
    print("senza bisogno di ricaricamenti forzati.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
