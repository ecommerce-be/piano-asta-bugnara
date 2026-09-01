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
        # "Fuori lista" e' la colonna con cui Fantacalcio segna chi non fa piu'
        # parte del listone: ceduto all'estero, svincolato, fuori rosa. Erano
        # ventiquattro e finivano nel sito come giocatori normali, comprabili
        # all'asta. Adesso restano nel file — servono a riconoscerli se qualcuno
        # li nomina — ma sono marcati, e il sito non li propone piu' a nessuno.
        if str(d.get("Fuori lista") or "").strip():
            g["fuori"] = True
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


# Campi che nel listone Excel NON ci sono: li aggiunge l'aggiornamento
# quotidiano leggendo Fantacalcio.it. Ricostruendo dal file esportato
# andrebbero persi tutti, e il sito tornerebbe indietro di giorni.
SOLO_DAL_SITO = ("gol", "gs", "rp", "rseg", "rsba", "au", "assist",
                 "amm", "esp", "qi", "fvm")

# Questi invece stanno in tutti e due, e vince il piu' fresco: la quotazione
# si muove col mercato, presenze e medie crescono a ogni giornata.
IN_ENTRAMBI = ("q", "pg", "mv", "fm")


def conserva_statistiche(giocatori: list[dict]) -> None:
    """Non far tornare indietro i dati quando si ricostruisce dal listone.

    Il motivo per cui uno riesporta il listone e' quasi sempre uno solo: i
    trasferimenti. Il file Excel e' l'unica fonte che sa chi e' passato dove,
    chi e' arrivato e chi e' uscito dalla Serie A. Ma di suo contiene poco —
    nome, squadra, ruolo, quotazione, presenze e medie — mentre gol, assist,
    cartellini, rigori e FVM li mette ogni mattina tools/aggiorna_dati.py
    leggendo Fantacalcio.it.

    Ricostruire alla cieca vorrebbe dire perdere tutto il secondo gruppo, e
    riportare indietro il primo se l'export che hai sottomano e' di qualche
    giorno fa. Cioe' rovinare i dati proprio nel momento in cui li stai
    sistemando. Quindi:

      - le colonne che solo il sito conosce si riportano sempre dentro;
      - quotazione, presenze e medie si prendono dal listone SOLO se
        l'export e' piu' recente di quello che abbiamo gia'. Lo si capisce
        dal totale delle presenze: quelle non tornano mai indietro.

    Su chi c'e', in che squadra e in che ruolo decide comunque il listone
    esportato, sempre: e' l'unica cosa che sa dei trasferimenti.
    """
    if not USCITA.exists():
        return
    try:
        vecchi = json.loads(USCITA.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return

    per_nome: dict[str, dict] = {}
    for g in vecchi:
        per_nome.setdefault(normalizza(g["n"]), g)

    presenze = lambda lista: sum(float(g.get("pg") or 0) for g in lista)
    export_vecchio = presenze(giocatori) < presenze(vecchi)

    if export_vecchio:
        print("    ATTENZIONE: l'export del listone e' piu' vecchio dei dati che hai gia'.")
        print("    Tengo squadre, ruoli e chi e' fuori lista dall'export (e' lui che sa dei")
        print("    trasferimenti), ma quotazioni, presenze e medie le lascio come stanno:")
        print("    riesporta il listone da LegheFantacalcio per aggiornare anche quelle.")

    ripresi = 0
    for g in giocatori:
        vecchio = per_nome.get(normalizza(g["n"]))
        if not vecchio:
            continue
        preso = False
        for campo in SOLO_DAL_SITO:
            if campo in vecchio and campo not in g:
                g[campo] = vecchio[campo]
                preso = True
        if export_vecchio:
            for campo in IN_ENTRAMBI:
                if campo in vecchio:
                    g[campo] = vecchio[campo]
                    preso = True
        if preso:
            ripresi += 1

    if ripresi:
        print(f"    dati tenuti dal file precedente per {ripresi} giocatori")


def main() -> int:
    if not LISTONE.exists():
        sys.exit(f"Listone non trovato: {LISTONE}")

    giocatori = leggi_listone(LISTONE)
    conserva_statistiche(giocatori)
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
