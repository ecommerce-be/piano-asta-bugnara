#!/usr/bin/env python3
"""Rigenera assets/data/players.json dal listone Excel e dai coefficienti in data/overrides.json.

    python3 tools/build_prices.py

Il file prodotto contiene solo dati grezzi (nome, squadra, ruolo, quotazione,
coefficiente, nota). Prezzo di mercato, tetto, fascia e verdetto li calcola il
browser in assets/app.js, cosi' cambiando i parametri di lega sulla pagina i
prezzi si aggiornano senza rilanciare niente.
"""
from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Serve openpyxl:  pip install openpyxl")

RADICE = Path(__file__).resolve().parent.parent
LISTONE = RADICE / "data" / "listone-classic-2026-27.xlsx"
OVERRIDES = RADICE / "data" / "overrides.json"
USCITA = RADICE / "assets" / "data" / "players.json"


def normalizza(s: str) -> str:
    """Confronta i nomi ignorando accenti e maiuscole (Calò == Calo)."""
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower().strip()


def leggi_listone(path: Path) -> list[dict]:
    ws = openpyxl.load_workbook(path, data_only=True).active
    righe = list(ws.iter_rows(values_only=True))
    intestazione = list(righe[0])
    giocatori = []
    for riga in righe[1:]:
        d = dict(zip(intestazione, riga))
        if not d.get("Nome"):
            continue
        g = {
            "n": d["Nome"],
            "sq": d["Sq."],
            "r": d["R."],
            "q": int(d["QUOT."] or 1),
        }
        # Statistiche gia' presenti nell'export del listone: presenze con voto,
        # media voto, fantamedia. Si aggiornano riesportando lo stesso file.
        for chiave, colonna in (("pg", "PGv"), ("mv", "MV"), ("fm", "FM")):
            v = d.get(colonna)
            if v not in (None, "", 0):
                try:
                    g[chiave] = round(float(v), 2)
                except (TypeError, ValueError):
                    pass
        giocatori.append(g)
    return giocatori


def main() -> int:
    if not LISTONE.exists():
        sys.exit(f"Listone non trovato: {LISTONE}")

    giocatori = leggi_listone(LISTONE)
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))["giocatori"]

    indice: dict[str, list[dict]] = {}
    for g in giocatori:
        indice.setdefault(normalizza(g["n"]), []).append(g)

    non_trovati = []
    for nome, dati in overrides.items():
        chiave = normalizza(nome)
        if chiave not in indice:
            non_trovati.append(nome)
            continue
        for g in indice[chiave]:
            g["mult"] = dati.get("mult", 1.0)
            g["nota"] = dati.get("nota", "")

    for g in giocatori:
        g.setdefault("mult", 1.0)
        g.setdefault("nota", "")

    # gol, assist e cartellini arrivano da un secondo file, se c'e'
    extra = RADICE / "data" / "statistiche.json"
    if extra.exists():
        stats = json.loads(extra.read_text(encoding="utf-8"))
        agganciati = 0
        for g in giocatori:
            s = stats.get(normalizza(g["n"]))
            if s:
                g.update(s)
                agganciati += 1
        print(f"{agganciati} giocatori arricchiti da data/statistiche.json")

    ordine = {"P": 0, "D": 1, "C": 2, "A": 3}
    giocatori.sort(key=lambda g: (ordine.get(g["r"], 9), -g["q"] * g["mult"], g["n"]))

    USCITA.parent.mkdir(parents=True, exist_ok=True)
    compatto = json.dumps(giocatori, ensure_ascii=False, separators=(",", ":"))
    USCITA.write_text(compatto, encoding="utf-8")

    # stessa impronta usata dall'aggiornamento automatico: senza, il browser
    # continua a servire il listone vecchio dalla cache
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from aggiorna_dati import marca_dati
    marca_dati(compatto)

    print(f"{len(giocatori)} giocatori scritti in {USCITA.relative_to(RADICE)}")
    print(f"{sum(1 for g in giocatori if g['nota'])} con nota, "
          f"{sum(1 for g in giocatori if g['mult'] != 1.0)} con coefficiente")
    if non_trovati:
        print("\nQuesti override non corrispondono a nessun giocatore del listone")
        print("(probabilmente hanno cambiato squadra o campionato):")
        for nome in non_trovati:
            print(f"  - {nome}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
