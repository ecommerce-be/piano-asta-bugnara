#!/usr/bin/env python3
"""Aggiorna assets/data/players.json leggendo le pagine pubbliche di Fantacalcio.it.

    python3 tools/aggiorna_dati.py            # aggiorna quotazioni e statistiche
    python3 tools/aggiorna_dati.py --diagnosi # non scrive niente, racconta cosa trova

Lo gira da solo la GitHub Action .github/workflows/aggiorna-dati.yml una volta
al giorno. Serve per non dover riesportare a mano il listone dal sito della lega.

Come funziona, in breve:

  * scarica due pagine HTML, quelle che vedi anche tu nel browser;
  * cerca la tabella dei giocatori *senza dare per scontata la struttura*:
    guarda le intestazioni e capisce quale colonna e' quale. Se domani
    Fantacalcio.it sposta o rinomina una colonna, continua a funzionare;
  * aggancia i giocatori a quelli gia' presenti in players.json per nome e
    squadra, e sovrascrive solo i campi che ha letto davvero;
  * se aggancia meno del minimo previsto NON scrive niente ed esce con errore,
    cosi' la Action fallisce rumorosamente e il sito resta con i dati buoni
    di ieri invece di ritrovarsi mezzo vuoto.

Il caricamento manuale dell'Excel (tools/build_prices.py) resta valido: questo
script tocca solo i campi q / pg / mv / fm / gol / assist / amm / esp, e lascia
stare mult e nota, che sono farina del nostro sacco.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Serve beautifulsoup4:  pip install beautifulsoup4 lxml")

RADICE = Path(__file__).resolve().parent.parent
PLAYERS = RADICE / "assets" / "data" / "players.json"
APP = RADICE / "assets" / "app.js"

PAGINE = {
    "statistiche": "https://www.fantacalcio.it/statistiche-serie-a",
    "quotazioni": "https://www.fantacalcio.it/quotazioni-fantacalcio",
}

INTESTAZIONI = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "it-IT,it;q=0.9",
}

# Quanti giocatori dobbiamo riconoscere perche' l'aggiornamento sia credibile.
SOGLIA = 0.55

# Le venti di Serie A come le scrive Fantacalcio.it (sigla o nome esteso)
# ricondotte al nome che usiamo noi in players.json.
SQUADRE = {
    "ata": "Atalanta", "atalanta": "Atalanta",
    "bol": "Bologna", "bologna": "Bologna",
    "cag": "Cagliari", "cagliari": "Cagliari",
    "com": "Como", "como": "Como",
    "fio": "Fiorentina", "fiorentina": "Fiorentina",
    "fro": "Frosinone", "frosinone": "Frosinone",
    "gen": "Genoa", "genoa": "Genoa",
    "int": "Inter", "inter": "Inter",
    "juv": "Juventus", "juventus": "Juventus",
    "laz": "Lazio", "lazio": "Lazio",
    "lec": "Lecce", "lecce": "Lecce",
    "mil": "Milan", "milan": "Milan",
    "mon": "Monza", "monza": "Monza",
    "nap": "Napoli", "napoli": "Napoli",
    "par": "Parma", "parma": "Parma",
    "rom": "Roma", "roma": "Roma",
    "sas": "Sassuolo", "sassuolo": "Sassuolo",
    "tor": "Torino", "torino": "Torino",
    "udi": "Udinese", "udinese": "Udinese",
    "ven": "Venezia", "venezia": "Venezia",
    # ripescaggi e neopromosse che potrebbero comparire
    "cre": "Cremonese", "cremonese": "Cremonese",
    "emp": "Empoli", "empoli": "Empoli",
    "hel": "Verona", "ver": "Verona", "verona": "Verona", "hellas verona": "Verona",
    "pis": "Pisa", "pisa": "Pisa",
    "sal": "Salernitana", "salernitana": "Salernitana",
    "spe": "Spezia", "spezia": "Spezia",
    "tri": "Triestina", "sam": "Sampdoria", "sampdoria": "Sampdoria",
}

# Sinonimi delle intestazioni: chiave = come la chiamiamo noi in players.json,
# valore = tutti i modi in cui quella colonna puo' chiamarsi sulla pagina.
# Il confronto e' su testo normalizzato (niente accenti, punti, spazi).
COLONNE = {
    "nome": ["nome", "giocatore", "calciatore"],
    "sq": ["squadra", "sq", "sq.", "team"],
    "r": ["r", "ruolo"],
    "q": ["qa", "qta", "quotazione", "quotazioneattuale", "qtattuale", "quot"],
    "qi": ["qi", "qti", "quotazioneiniziale", "qtiniziale"],
    "fvm": ["fvm", "fvm1000", "fvmm", "fantavaloredimercato", "fantavaloremercato"],
    "pg": ["pv", "presenze", "pg", "presenzeconvoto", "partitegiocate"],
    "mv": ["mv", "mediavoto", "media"],
    "fm": ["fm", "fantamedia", "fmedia"],
    "gol": ["gf", "gol", "goal", "golfatti", "reti"],
    "gs": ["gs", "golsubiti", "subiti"],
    "rp": ["rp", "rigoriparati", "parati"],
    "rseg": ["r+", "rigorisegnati", "rigoriseg"],
    "rsba": ["r-", "rigorisbagliati", "rigorisbag"],
    "au": ["au", "autogol", "autoreti"],
    "assist": ["ass", "assist", "asst"],
    "amm": ["amm", "ammonizioni", "gialli", "cartellinigialli"],
    "esp": ["esp", "espulsioni", "rossi", "cartellinirossi"],
}

# quali campi ci aspettiamo da quale pagina: prendiamo tutto quello che c'e'
ATTESI = {
    "statistiche": ["pg", "mv", "fm", "gol", "gs", "rp", "rseg", "rsba", "au",
                    "assist", "amm", "esp"],
    "quotazioni": ["q", "qi", "fvm"],
}

INTERI = {"q", "qi", "fvm", "gol", "gs", "rp", "rseg", "rsba", "au",
          "assist", "amm", "esp"}


# ---------------------------------------------------------------- utilita'

def senza_accenti(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()


def chiave_nome(s: str) -> str:
    """Svilar, SVILAR, Švilar -> svilar. Toglie anche i suffissi tipo (1)."""
    s = senza_accenti(s).lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9. ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def chiave_intestazione(s: str) -> str:
    # + e - restano: servono a distinguere "R+" (rigori segnati) da "R" (ruolo)
    return re.sub(r"[^a-z0-9+-]+", "", senza_accenti(s).lower())


def sembra_nome(s: str) -> bool:
    """Questa cella contiene il nome di un giocatore, o e' un numero / una sigla?"""
    s = str(s).strip()
    if len(s) < 3:
        return False
    if re.fullmatch(r"[\d.,+\-%/ ]+", s):
        return False
    if re.fullmatch(r"[A-Z]{3}", s):       # ROM, INT, JUV: e' la squadra
        return False
    return True


def squadra_nostra(s: str) -> str | None:
    return SQUADRE.get(chiave_intestazione(s))


def numero(s: str) -> float | None:
    s = str(s).replace(",", ".").strip()
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def scarica(url: str) -> str:
    req = urllib.request.Request(url, headers=INTESTAZIONI)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            grezzo = r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{url} ha risposto {e.code} {e.reason}") from e
    except Exception as e:
        raise SystemExit(f"Non riesco a scaricare {url}: {e}") from e
    for codifica in ("utf-8", "latin-1"):
        try:
            return grezzo.decode(codifica)
        except UnicodeDecodeError:
            continue
    return grezzo.decode("utf-8", "replace")


# ------------------------------------------------------- lettura tabelle

def mappa_colonne(celle: list[str]) -> dict[str, int]:
    """Dalle intestazioni ricava {campo: indice di colonna}."""
    mappa: dict[str, int] = {}
    for i, testo in enumerate(celle):
        k = chiave_intestazione(testo)
        if not k:
            continue
        for campo, sinonimi in COLONNE.items():
            if campo in mappa:
                continue
            if k in sinonimi:
                mappa[campo] = i
                break
    return mappa


def allarga_colspan(riga) -> list[str]:
    """Le intestazioni usano spesso colspan: 'Calciatore' che copre quattro
    colonne. Le ripetiamo, cosi' gli indici tornano a corrispondere alle celle
    delle righe sotto."""
    out = []
    for c in riga.find_all(["td", "th"]):
        testo = " ".join(c.get_text(" ", strip=True).split())
        try:
            n = max(1, int(c.get("colspan", 1)))
        except (TypeError, ValueError):
            n = 1
        out.extend([testo] * n)
    return out


def verifica_mappa(mappa: dict[str, int], corpo: list[list[str]]) -> dict[str, int]:
    """Controlla la mappa sulle righe vere e la corregge.

    Il caso che capita davvero: l'intestazione dice 'Calciatore' in prima
    colonna ma il nome, nelle righe, sta tre celle piu' in la'. Fidarsi solo
    dell'intestazione vuol dire leggere celle vuote e buttare via tutto.
    Qui guardiamo cosa c'e' scritto davvero e, se una colonna non regge, la
    cerchiamo altrove o la lasciamo perdere.
    """
    if not corpo:
        return mappa
    quorum = max(1, int(len(corpo) * 0.7))
    cella = lambda r, i: r[i] if i < len(r) else ""

    # il nome: deve sembrare un nome nella maggioranza delle righe
    i = mappa.get("nome")
    buono = i is not None and sum(sembra_nome(cella(r, i)) for r in corpo) >= quorum
    if not buono:
        occupate = {v for k, v in mappa.items() if k != "nome"}
        larghezza = max(len(r) for r in corpo)
        migliore, punti = None, 0
        for j in range(larghezza):
            if j in occupate:
                continue
            p = sum(sembra_nome(cella(r, j)) for r in corpo)
            if p > punti:
                migliore, punti = j, p
        if migliore is not None and punti >= quorum:
            mappa = {**mappa, "nome": migliore}

    # i campi numerici: se in quella colonna non ci sono numeri, meglio niente
    # che un valore sbagliato messo nel listone
    for campo in [c for c in mappa if c not in ("nome", "sq", "r")]:
        i = mappa[campo]
        if sum(numero(cella(r, i)) is not None for r in corpo) < quorum:
            mappa = {k: v for k, v in mappa.items() if k != campo}

    return mappa


def testo_celle(riga) -> list[str]:
    out = []
    for c in riga.find_all(["td", "th"]):
        # il nome del giocatore spesso sta in un <a> o in uno <span> dedicato,
        # con accanto la sigla della squadra: prendiamo il testo pulito
        out.append(" ".join(c.get_text(" ", strip=True).split()))
    return out


def leggi_tabelle(html: str, campi_attesi: list[str]) -> tuple[list[dict], dict]:
    """Restituisce (righe, diagnostica). Sceglie la tabella piu' promettente."""
    zuppa = BeautifulSoup(html, "html.parser")
    candidate = []

    for tab in zuppa.find_all("table"):
        righe = tab.find_all("tr")
        if len(righe) < 10:
            continue

        # l'intestazione e' la prima riga che riconosce almeno il nome
        mappa, inizio = {}, 0
        for i, r in enumerate(righe[:5]):
            celle = testo_celle(r)
            larga = allarga_colspan(r)
            # se il colspan riallinea l'intestazione alla larghezza delle righe
            # sotto, usiamo quella versione
            sotto = [len(testo_celle(x)) for x in righe[i + 1:i + 6]]
            tipica = max(set(sotto), key=sotto.count) if sotto else len(celle)
            if len(celle) != tipica and len(larga) == tipica:
                celle = larga
            m = mappa_colonne(celle)
            if "nome" in m and len(m) > len(mappa):
                mappa, inizio = m, i + 1
        if "nome" not in mappa:
            continue

        corpo = [testo_celle(r) for r in righe[inizio:inizio + 40]]
        mappa = verifica_mappa(mappa, corpo)
        if "nome" not in mappa:
            continue

        utili = [c for c in campi_attesi if c in mappa]
        candidate.append((len(utili), len(righe), tab, mappa, inizio))

    if not candidate:
        return [], {"tabelle": len(zuppa.find_all("table")), "motivo": "nessuna tabella con una colonna nome riconoscibile"}

    # dalla piu' promettente in giu': se una non produce righe si prova la prossima
    candidate.sort(key=lambda c: (c[0], c[1]), reverse=True)
    scartate = []

    for _, _, tab, mappa, inizio in candidate:
        righe: list[dict] = []
        for r in tab.find_all("tr")[inizio:]:
            celle = testo_celle(r)
            if len(celle) <= mappa["nome"]:
                continue
            nome = celle[mappa["nome"]]
            if not nome or chiave_intestazione(nome) in ("nome", "giocatore"):
                continue
            d: dict = {"nome": nome}
            for campo, i in mappa.items():
                if campo == "nome" or i >= len(celle):
                    continue
                grezzo = celle[i]
                if campo in ("sq", "r"):
                    d[campo] = grezzo
                else:
                    v = numero(grezzo)
                    if v is not None:
                        d[campo] = int(round(v)) if campo in INTERI else round(v, 2)
            righe.append(d)

        if righe:
            return righe, {
                "tabelle_nella_pagina": len(zuppa.find_all("table")),
                "tabelle_scartate_perche_vuote": scartate,
                "colonne_riconosciute": sorted(mappa),
                "righe_lette": len(righe),
                "esempio": righe[0],
            }
        scartate.append(sorted(mappa))

    return [], {
        "tabelle_nella_pagina": len(zuppa.find_all("table")),
        "tabelle_con_intestazione_ma_senza_righe": scartate,
        "motivo": "intestazioni trovate ma nessuna riga di giocatori: "
                  "probabilmente la tabella la riempie JavaScript",
    }


def anatomia(html: str, campione: str = "Malen") -> None:
    """Racconta com'e' fatta la pagina. Serve quando la lettura non riesce:
    dice dove stanno davvero i dati, tabella per tabella, e se il nome di un
    giocatore compare nell'HTML o solo dopo che il browser ha eseguito lo script."""
    zuppa = BeautifulSoup(html, "html.parser")
    tabelle = zuppa.find_all("table")
    print(f"    --- anatomia della pagina: {len(tabelle)} tabelle ---")

    for i, tab in enumerate(tabelle[:12]):
        righe = tab.find_all("tr")
        segni = " ".join(filter(None, [
            "id=" + tab.get("id") if tab.get("id") else "",
            "class=" + ".".join(tab.get("class", [])) if tab.get("class") else "",
        ])) or "(senza id o class)"
        corpo = tab.find("tbody")
        n_corpo = len(corpo.find_all("tr")) if corpo else 0
        print(f"    [{i}] {segni} — {len(righe)} righe totali, {n_corpo} nel tbody")
        for j, r in enumerate(righe[:3]):
            celle = testo_celle(r)
            testo = " | ".join(c[:18] for c in celle[:14])
            print(f"        riga {j}: {len(celle)} celle · {testo[:150]}")

    # dove sta davvero il nome di un giocatore?
    pos = [m.start() for m in re.finditer(re.escape(campione), html)]
    print(f"    --- \"{campione}\" compare {len(pos)} volte nell'HTML ---")
    for p in pos[:3]:
        pezzo = re.sub(r"\s+", " ", html[max(0, p - 130):p + 90])
        print(f"        …{pezzo}…")
    if not pos:
        print("        MAI: i dati non sono nell'HTML, li mette JavaScript.")

    # c'e' un blocco JSON con i giocatori dentro uno <script>?
    for s in zuppa.find_all("script"):
        t = s.string or ""
        if len(t) > 2000 and campione in t:
            print(f"    --- trovato uno <script> di {len(t):,} caratteri che contiene "
                  f"\"{campione}\": i dati arrivano da li' ---")
            k = t.find(campione)
            print(f"        …{t[max(0, k - 200):k + 200]}…")
            break
    else:
        grossi = [len(s.string or "") for s in zuppa.find_all("script") if len(s.string or "") > 5000]
        print(f"    script grossi nella pagina: {grossi[:6] or 'nessuno'}")


# ------------------------------------------------------------ aggancio

def indicizza(giocatori: list[dict]) -> dict:
    per_nome: dict[str, list[dict]] = {}
    for g in giocatori:
        per_nome.setdefault(chiave_nome(g["n"]), []).append(g)
    return per_nome


def applica(giocatori: list[dict], righe: list[dict], campi: list[str]) -> tuple[int, list[str]]:
    per_nome = indicizza(giocatori)
    agganciati, ignorati = 0, []

    for riga in righe:
        candidati = per_nome.get(chiave_nome(riga["nome"]))
        if not candidati:
            ignorati.append(riga["nome"])
            continue
        if len(candidati) > 1 and riga.get("sq"):
            sq = squadra_nostra(riga["sq"])
            stessa = [g for g in candidati if g["sq"] == sq]
            if stessa:
                candidati = stessa
        if len(candidati) > 1:
            # omonimi senza squadra utile: meglio non indovinare
            ignorati.append(f"{riga['nome']} (omonimi)")
            continue
        g = candidati[0]
        toccato = False
        for campo in campi:
            if campo in riga:
                g[campo] = riga[campo]
                toccato = True
        if toccato:
            agganciati += 1

    return agganciati, ignorati


# ------------------------------------------------- impronta per la cache

def marca_dati(testo_json: str) -> None:
    """Scrive in assets/app.js l'impronta dei dati e la data di aggiornamento.

    Senza questo, chi ha gia' aperto il sito continua a vedere il listone
    vecchio: il browser tiene players.json in cache e non va a ricontrollare.
    L'impronta e' l'hash del contenuto, quindi cambia solo quando cambiano i
    dati per davvero — nessun ricaricamento inutile.
    """
    impronta = hashlib.sha1(testo_json.encode("utf-8")).hexdigest()[:10]
    oggi = datetime.date.today().isoformat()
    t = APP.read_text(encoding="utf-8")
    t, n1 = re.subn(r"(export const VERSIONE_DATI = ')[^']*(';)",
                    rf"\g<1>{impronta}\g<2>", t, count=1)
    t, n2 = re.subn(r"(export const AGGIORNATO_IL = ')[^']*(';)",
                    rf"\g<1>{oggi}\g<2>", t, count=1)
    if not (n1 and n2):
        print("    ATTENZIONE: non ho trovato VERSIONE_DATI/AGGIORNATO_IL in app.js,")
        print("    il browser potrebbe continuare a mostrare i dati vecchi.")
        return
    APP.write_text(t, encoding="utf-8")
    print(f"    impronta dati {impronta}, aggiornato il {oggi}")


# ------------------------------------------------------------------ main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--diagnosi", action="store_true",
                    help="non scrive niente: racconta cosa trova nelle pagine")
    ap.add_argument("--solo", choices=sorted(PAGINE), action="append",
                    help="aggiorna solo questa pagina (ripetibile)")
    args = ap.parse_args()

    if not PLAYERS.exists():
        sys.exit(f"Non trovo {PLAYERS}: lancia prima tools/build_prices.py")

    giocatori = json.loads(PLAYERS.read_text(encoding="utf-8"))
    prima = json.dumps(giocatori, ensure_ascii=False, sort_keys=True)
    totale = len(giocatori)
    quali = args.solo or list(PAGINE)
    problemi = []

    for pagina in quali:
        url = PAGINE[pagina]
        print(f"\n=== {pagina} — {url}")
        html = scarica(url)
        print(f"    scaricati {len(html):,} caratteri")

        righe, diagnosi = leggi_tabelle(html, ATTESI[pagina])
        for k, v in diagnosi.items():
            print(f"    {k}: {v}")

        if not righe:
            anatomia(html)
            problemi.append(f"{pagina}: nessuna riga letta")
            continue

        if args.diagnosi:
            anatomia(html)

        campi = [c for c in ATTESI[pagina] if any(c in r for r in righe)]
        if not campi:
            problemi.append(f"{pagina}: tabella trovata ma nessuna colonna utile "
                            f"(riconosciute: {diagnosi.get('colonne_riconosciute')})")
            continue

        agganciati, ignorati = applica(giocatori, righe, campi)
        quota = agganciati / totale if totale else 0
        print(f"    campi aggiornati: {', '.join(campi)}")
        print(f"    agganciati {agganciati}/{totale} giocatori ({quota:.0%})")
        if ignorati:
            print(f"    non riconosciuti ({len(ignorati)}): {', '.join(ignorati[:12])}"
                  + (" …" if len(ignorati) > 12 else ""))
        if quota < SOGLIA:
            problemi.append(f"{pagina}: agganciato solo il {quota:.0%}, sotto la soglia del {SOGLIA:.0%}")

    if problemi:
        print("\nNon aggiorno niente, questi punti non tornano:")
        for p in problemi:
            print(f"  - {p}")
        print("\nRilancia con --diagnosi e mandami l'output: la pagina e' cambiata.")
        return 1

    if args.diagnosi:
        print("\n(diagnosi: non ho scritto niente)")
        return 0

    dopo = json.dumps(giocatori, ensure_ascii=False, sort_keys=True)
    if prima == dopo:
        print("\nNiente di nuovo: players.json resta com'era.")
        return 0

    compatto = json.dumps(giocatori, ensure_ascii=False, separators=(",", ":"))
    PLAYERS.write_text(compatto, encoding="utf-8")
    marca_dati(compatto)
    con_stat = sum(1 for g in giocatori if g.get("gol") is not None)
    print(f"\nScritto {PLAYERS.relative_to(RADICE)} — {totale} giocatori, "
          f"{con_stat} con gol/assist/cartellini.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
