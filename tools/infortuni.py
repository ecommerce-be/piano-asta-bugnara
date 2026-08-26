#!/usr/bin/env python3
"""Legge chi e' fermo — infortunati e squalificati — e scrive assets/data/infortuni.json.

    python3 tools/infortuni.py             # aggiorna
    python3 tools/infortuni.py --diagnosi  # guarda e riferisce, senza scrivere

Perche' un lettore diverso da tools/aggiorna_dati.py: la pagina degli
indisponibili non e' una tabella. E' un elenco discorsivo, raggruppato per
squadra, dove ogni voce e' una frase ("lesione del collaterale mediale di
secondo grado del ginocchio sinistro, recuperabile da inizio ottobre").

Quindi qui non cerchiamo righe e colonne: ci ancoriamo a due cose che restano
stabili anche se cambia la grafica.

  1. I NOMI. Il listone che abbiamo gia' contiene tutti i 540 giocatori: un
     link il cui testo corrisponde a uno di quei nomi e' quasi certamente una
     voce di infortunio, qualunque markup ci sia intorno.
  2. GLI INDIRIZZI. I link dei giocatori hanno la forma
     /serie-a/squadre/<squadra>/<giocatore>/<id>, quindi la squadra si legge
     dall'indirizzo invece che indovinarla dalle intestazioni.

Il resto — descrizione e tempi di rientro — si ricava dal testo del blocco che
contiene il link.
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Serve beautifulsoup4:  pip install beautifulsoup4")

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from aggiorna_dati import SQUADRE, chiave_nome, chiave_intestazione, scarica  # noqa: E402

PLAYERS = RADICE / "assets" / "data" / "players.json"
USCITA = RADICE / "assets" / "data" / "infortuni.json"
URL = "https://www.fantacalcio.it/indisponibili-serie-a"

# quante voci ci aspettiamo come minimo perche' la lettura sia credibile:
# in Serie A c'e' sempre qualche decina di indisponibili
SOGLIA = 12

MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}

# "da fine agosto", "dall'inizio di ottobre", "dalla seconda meta' di settembre"
QUANDO = re.compile(
    r"\b(?:da|dal|dalla|dall')\s*(?:l')?\s*"
    r"(fine|inizio|met[àa]|prima met[àa]|seconda met[àa])?\s*(?:di\s+|del\s+)?"
    r"(" + "|".join(MESI) + r")\b", re.I)
SETTIMANE = re.compile(r"\b(?:almeno\s+)?(\d+|due|tre|quattro|sei)\s*(giorni|settiman\w+|mes\w+)\b", re.I)
GIORNATA = re.compile(r"\b(\d+)\s*[aª°]?\s*giornata\b", re.I)
DA_VALUTARE = re.compile(r"da valutare|quotidianamente|in dubbio", re.I)

PAROLE = {"due": 2, "tre": 3, "quattro": 4, "sei": 6}


def oggi() -> datetime.date:
    return datetime.date.today()


def quando_rientra(testo: str) -> tuple[str, str | None]:
    """Dal testo ricava una frase breve sul rientro e, se possibile, una data.

    Restituisce ("fine agosto", "2026-08-28") oppure ("da valutare", None).
    La data serve solo a ordinare e a colorare: non e' una promessa.
    """
    m = QUANDO.search(testo)
    if m:
        parte, mese = (m.group(1) or "").lower(), m.group(2).lower()
        n = MESI[mese]
        anno = oggi().year + (1 if n < oggi().month - 6 else 0)
        giorno = {"fine": 26, "seconda metà": 20, "seconda meta": 20,
                  "metà": 15, "meta": 15, "prima metà": 8, "prima meta": 8}.get(parte, 3)
        try:
            data = datetime.date(anno, n, giorno)
        except ValueError:
            data = None
        etichetta = f"{parte} {mese}".strip() if parte else mese
        return etichetta, data.isoformat() if data else None

    m = SETTIMANE.search(testo)
    if m:
        n = PAROLE.get(m.group(1).lower(), None)
        if n is None:
            try:
                n = int(m.group(1))
            except ValueError:
                n = None
        unita = m.group(2).lower()
        if n:
            giorni = n * (1 if unita.startswith("giorn") else 7 if unita.startswith("settiman") else 30)
            return f"{n} {unita}", (oggi() + datetime.timedelta(days=giorni)).isoformat()

    m = GIORNATA.search(testo)
    if m:
        return f"{m.group(1)}ª giornata", None

    if DA_VALUTARE.search(testo):
        return "da valutare", None
    return "", None


def squadra_da_indirizzo(href: str) -> str | None:
    """/serie-a/squadre/hellas-verona/serdar/1234 -> Verona"""
    m = re.search(r"/squadre/([a-z0-9-]+)/", href or "", re.I)
    if not m:
        return None
    slug = m.group(1).lower()
    return SQUADRE.get(chiave_intestazione(slug)) or SQUADRE.get(chiave_intestazione(slug.split("-")[-1]))


def categoria_precedente(nodo) -> str:
    """Risale il documento cercando l'ultimo titolo tipo "Infortunati"."""
    for prec in nodo.find_all_previous(string=True, limit=400):
        t = chiave_intestazione(prec)
        if not t or len(t) > 24:
            continue
        if t.startswith("infortunat") or t.startswith("indisponibil"):
            return "infortunio"
        if t.startswith("squalificat"):
            return "squalifica"
        if t.startswith("diffidat"):
            return "diffida"
    return "infortunio"


def blocco_di(link, nome: str) -> str:
    """Il pezzo di testo che descrive questo infortunio.

    Saliamo di padre in padre finche' il testo non e' abbastanza lungo da
    contenere una descrizione, ma non cosi' lungo da aver inghiottito mezza
    pagina o il giocatore successivo.
    """
    minimo = len(nome) + 8      # nome + qualcosa che somigli a una descrizione
    massimo = 320               # oltre, ci siamo mangiati la sezione intera
    candidati = []
    nodo = link
    for _ in range(6):
        nodo = nodo.parent
        if nodo is None:
            break
        t = " ".join(nodo.get_text(" ", strip=True).split())
        if len(t) > massimo:
            break               # da qui in su si allarga soltanto
        candidati.append(t)

    # il PIU' PICCOLO che sia abbastanza lungo: prendere il piu' grande
    # significherebbe inghiottire i giocatori vicini e l'intestazione di sezione
    buoni = [t for t in candidati if len(t) >= minimo]
    t = min(buoni, key=len) if buoni else (max(candidati, key=len) if candidati else "")
    if t.lower().startswith(nome.lower()):
        t = t[len(nome):]
    return t.strip(" ,;:–—-·|").strip()


def leggi(html: str, noti: dict[str, list[dict]]) -> tuple[list[dict], dict]:
    zuppa = BeautifulSoup(html, "html.parser")
    voci: dict[str, dict] = {}
    link_totali = 0
    senza_squadra = 0

    for a in zuppa.find_all("a", href=True):
        testo = " ".join(a.get_text(" ", strip=True).split())
        if not testo or len(testo) > 40:
            continue
        candidati = noti.get(chiave_nome(testo))
        if not candidati:
            continue
        link_totali += 1

        sq = squadra_da_indirizzo(a["href"])
        if sq:
            g = next((x for x in candidati if x["sq"] == sq), None)
        else:
            senza_squadra += 1
            g = candidati[0] if len(candidati) == 1 else None
        if not g:
            continue

        desc = blocco_di(a, testo)
        if len(desc) < 4:
            continue
        etichetta, data = quando_rientra(desc)
        chiave = f"{g['r']}|{g['n']}|{g['sq']}"
        if chiave in voci and len(voci[chiave]["desc"]) >= len(desc):
            continue
        voci[chiave] = {
            "id": chiave, "n": g["n"], "sq": g["sq"], "r": g["r"],
            "tipo": categoria_precedente(a),
            "desc": desc[:300],
            "rientro": etichetta,
            "quando": data,
        }

    diagnosi = {
        "link_di_giocatori_riconosciuti": link_totali,
        "senza_squadra_nell_indirizzo": senza_squadra,
        "voci_tenute": len(voci),
    }
    return list(voci.values()), diagnosi


def anatomia(html: str, noti: dict) -> None:
    """Se non troviamo niente, raccontiamo com'e' fatta la pagina."""
    zuppa = BeautifulSoup(html, "html.parser")
    link = zuppa.find_all("a", href=True)
    print(f"    --- anatomia: {len(link)} link in pagina ---")
    con_squadre = [a for a in link if "/squadre/" in a["href"]]
    print(f"    link che sembrano di giocatori (/squadre/): {len(con_squadre)}")
    for a in con_squadre[:6]:
        t = " ".join(a.get_text(" ", strip=True).split())
        print(f"        \"{t}\" -> {a['href'][:80]}")
        print(f"           riconosciuto nel listone: {bool(noti.get(chiave_nome(t)))}")
        print(f"           blocco: {blocco_di(a, t)[:150]}")
    if not con_squadre:
        print("    Nessun link /squadre/: la pagina e' cambiata o la riempie JavaScript.")
        for h in zuppa.find_all(["h1", "h2", "h3", "h4"])[:10]:
            print(f"        titolo: {h.get_text(' ', strip=True)[:70]}")


def main_da_aggiornamento() -> int:
    """Punto d'ingresso per tools/aggiorna_dati.py, senza argomenti da riga di comando."""
    return main(argparse.Namespace(diagnosi=False, url=URL))


def main(args=None) -> int:
    if args is None:
        ap = argparse.ArgumentParser(description=__doc__)
        ap.add_argument("--diagnosi", action="store_true")
        ap.add_argument("--url", default=URL)
        args = ap.parse_args()

    if not PLAYERS.exists():
        sys.exit(f"Non trovo {PLAYERS}")
    listone = json.loads(PLAYERS.read_text(encoding="utf-8"))
    noti: dict[str, list[dict]] = {}
    for g in listone:
        noti.setdefault(chiave_nome(g["n"]), []).append(g)

    print(f"=== indisponibili — {args.url}")
    html = scarica(args.url)
    print(f"    scaricati {len(html):,} caratteri")

    voci, diagnosi = leggi(html, noti)
    for k, v in diagnosi.items():
        print(f"    {k}: {v}")

    if len(voci) < SOGLIA:
        anatomia(html, noti)
        print(f"\nSolo {len(voci)} voci, sotto il minimo di {SOGLIA}: non scrivo niente.")
        print("Rilancia con --diagnosi e mandami l'output.")
        return 1

    per_tipo: dict[str, int] = {}
    for v in voci:
        per_tipo[v["tipo"]] = per_tipo.get(v["tipo"], 0) + 1
    print(f"    per tipo: {per_tipo}")
    print(f"    con tempi di rientro: {sum(1 for v in voci if v['rientro'])}/{len(voci)}")
    squadre = sorted({v["sq"] for v in voci})
    print(f"    squadre coinvolte: {len(squadre)}")
    for v in sorted(voci, key=lambda x: (x["sq"], x["n"]))[:5]:
        print(f"      {v['sq']:<12} {v['n']:<16} {v['tipo']:<10} "
              f"rientro: {v['rientro'] or '—':<18} {v['desc'][:60]}")

    if args.diagnosi:
        anatomia(html, noti)
        print("\n(diagnosi: non ho scritto niente)")
        return 0

    voci.sort(key=lambda v: (v["sq"], {"infortunio": 0, "squalifica": 1, "diffida": 2}[v["tipo"]], v["n"]))
    USCITA.write_text(json.dumps(
        {"aggiornato": oggi().isoformat(), "voci": voci},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nScritte {len(voci)} voci in {USCITA.relative_to(RADICE)}.")
    # rinfresca la data nell'impronta, cosi' il browser riscarica l'infermeria
    # anche nei giorni in cui il listone non e' cambiato
    from aggiorna_dati import marca_dati
    marca_dati(PLAYERS.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
