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
OVERRIDES = RADICE / "data" / "overrides.json"
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

    # i campi numerici: se in quella colonna c'e' del testo invece che numeri,
    # meglio niente che un valore sbagliato nel listone. Le celle VUOTE pero'
    # non contano: colonne come "rigori segnati" o "autogol" sono legittimamente
    # vuote per quasi tutti a inizio stagione, e scartarle per questo vorrebbe
    # dire perdersi il dato appena qualcuno segna il primo rigore.
    for campo in [c for c in mappa if c not in ("nome", "sq", "r")]:
        i = mappa[campo]
        piene = [r for r in corpo if cella(r, i).strip()]
        if not piene:
            continue
        if sum(numero(cella(r, i)) is not None for r in piene) < max(1, int(len(piene) * 0.7)):
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


# ------------------------------------------------- anagrafica: squadra e ruolo

RUOLI_VALIDI = {"P", "D", "C", "A"}

# sotto questa soglia la pagina non e' il listone e non ci si fida
MINIMO_RIGHE = 200


def correzioni_a_mano() -> dict[str, dict]:
    """Le squadre e i ruoli scritti a mano in data/overrides.json.

    PERCHE'. Il primo settembre Nkunku era andato via dal Milan da giorni e
    aveva gia' segnato con la maglia nuova, ma la pagina delle quotazioni di
    Fantacalcio.it lo dava ancora rossonero. Questo script copia quello che
    legge: se la fonte e' ferma, il sito resta fermo con lei, e all'asta ti
    ritrovi un attaccante con la squadra sbagliata — che vuol dire giudizio
    sbagliato, modificatore sbagliato, tutto sbagliato.

    Contro una fonte che sbaglia non c'e' automazione che tenga: serve poterlo
    scrivere a mano una volta sola, in un posto che nessuno sovrascriva. Quel
    posto e' data/overrides.json, lo stesso dove stanno gia' le note e i
    coefficienti:

        "Nkunku": { "sq": "Como", "mult": 1.35, "nota": "..." }

    E c'e' il caso piu' netto: chi la Serie A l'ha lasciata del tutto. Nkunku
    e' finito in Germania, e finche' Fantacalcio.it continua a quotarlo il
    sito te lo propone come acquisto — con tanto di «affare dell'asta». Per
    quello basta:

        "Nkunku": { "fuori": true, "nota": "Passato in Germania." }

    e sparisce da tutte le pagine: niente shortlist, niente rosa ideale,
    niente chiamata rapida. Resta nel file, cosi' se qualcuno al tavolo lo
    nomina lo si ritrova col pulsante «mostra chi non e' piu' in Serie A».

    Da li' in poi la correzione vince su tutto: sull'aggiornamento di ogni
    mattina e sul riexport dell'Excel. Quando anche Fantacalcio.it si mette in
    pari la riga si puo' togliere, e non cambia niente.
    """
    try:
        dati = json.loads(OVERRIDES.read_text(encoding="utf-8")).get("giocatori", {})
    except (json.JSONDecodeError, OSError):
        return {}
    fissati = {}
    for nome, d in dati.items():
        if not isinstance(d, dict):
            continue
        sq = squadra_nostra(d.get("sq") or "") if d.get("sq") else None
        r = (d.get("r") or "").strip().upper()[:1]
        voce = {
            **({"sq": sq} if sq else {}),
            **({"r": r} if r in RUOLI_VALIDI else {}),
            **({"fuori": bool(d["fuori"])} if "fuori" in d else {}),
            # nota e coefficiente li scriveva solo tools/build_prices.py, che
            # pero' vuole l'Excel esportato. Correggere una nota voleva dire
            # riesportare il listone — e riesportare un file vecchio riportava
            # indietro le squadre. Adesso li applica anche l'aggiornamento
            # quotidiano: si cambia la riga, e domattina il sito e' a posto.
            **({"nota": str(d["nota"])} if "nota" in d else {}),
            **({"mult": float(d["mult"])} if isinstance(d.get("mult"), (int, float)) else {}),
        }
        if voce:
            fissati[chiave_nome(nome)] = voce
    return fissati


def applica_correzioni(giocatori: list[dict], fissati: dict[str, dict]) -> list[str]:
    """Riscrive squadra e ruolo dove li abbiamo corretti a mano.

    Gira per ultima, dopo tutto il resto, cosi' e' l'ultima parola. Tiene da
    parte in `sqFonte` quello che dice Fantacalcio.it: serve al sito per
    spiegare la differenza a chi passa il mouse sulla squadra, e serve a noi
    per accorgerci del giorno in cui la fonte si mette in pari.
    """
    fatte = []
    for g in giocatori:
        d = fissati.get(chiave_nome(g["n"]))
        if not d:
            g.pop("sqFonte", None)
            continue
        if "sq" in d and d["sq"] != g["sq"]:
            g["sqFonte"] = g["sq"]
            fatte.append(f"{g['n']}: {g['sq']} -> {d['sq']} (a mano)")
            g["sq"] = d["sq"]
        elif "sq" in d:
            # la fonte si e' messa in pari: la riga in overrides.json non
            # serve piu', ed e' giusto dirlo invece di lasciarla li' per anni
            if g.pop("sqFonte", None):
                fatte.append(f"{g['n']}: Fantacalcio.it dice {g['sq']} come noi, "
                             "la correzione a mano si puo' togliere")
        if "r" in d and d["r"] != g["r"]:
            fatte.append(f"{g['n']}: ruolo {g['r']} -> {d['r']} (a mano)")
            g["r"] = d["r"]
        if "fuori" in d:
            if d["fuori"] and not g.get("fuori"):
                fatte.append(f"{g['n']}: fuori dal listone (a mano)")
                g["fuori"] = True
            elif not d["fuori"] and g.pop("fuori", None):
                fatte.append(f"{g['n']}: rimesso nel listone (a mano)")
        for campo in ("nota", "mult"):
            if campo in d and g.get(campo) != d[campo]:
                g[campo] = d[campo]
                fatte.append(f"{g['n']}: {campo} riscritt{'a' if campo == 'nota' else 'o'} a mano")
    return fatte


def squadre_viste(righe: list[dict]) -> dict[str, str]:
    """Chi gioca dove, secondo una pagina."""
    fuori = {}
    for r in righe:
        sq = squadra_nostra(r.get("sq") or "")
        if r.get("nome") and sq:
            fuori[chiave_nome(r["nome"])] = sq
    return fuori


def discordanze(giocatori: list[dict], viste: dict[str, dict[str, str]]) -> list[str]:
    """Le due pagine di Fantacalcio.it dicono la stessa squadra?

    PERCHE'. Le quotazioni e le statistiche non si aggiornano insieme: la
    pagina dei numeri sa gia' che uno ha segnato con la maglia nuova mentre il
    listone delle quotazioni lo da' ancora alla vecchia. E' esattamente il
    caso da cui e' nata questa funzione: Nkunku aveva gia' segnato altrove e
    le quotazioni lo davano al Milan.

    Non si sceglie quale delle due ha ragione — indovinare su una fonte che si
    contraddice e' il modo migliore per scrivere una squadra sbagliata su
    tutto il listone. Si dice e basta, con la riga gia' pronta da incollare in
    data/overrides.json.
    """
    q, s = viste.get("quotazioni") or {}, viste.get("statistiche") or {}
    if not q or not s:
        return []
    fuori = []
    for g in giocatori:
        k = chiave_nome(g["n"])
        a, b = q.get(k), s.get(k)
        if a and b and a != b:
            fuori.append(f'{g["n"]}: quotazioni dice {a}, statistiche dice {b} '
                         f'-> "{g["n"]}": {{ "sq": "{b}" }}')
    return fuori


def aggiorna_anagrafica(giocatori: list[dict], righe: list[dict],
                        fissati: dict[str, dict] | None = None) -> list[str]:
    """Squadra, ruolo, e chi dal listone e' sparito.

    PERCHE' ESISTE. Fino a oggi questo script aggiornava solo numeri —
    quotazioni, presenze, gol, cartellini — e la squadra la leggeva soltanto
    per distinguere gli omonimi. Risultato: chi cambiava maglia restava al
    club di agosto per sempre, e la nota scritta a mano invecchiava con lui
    («se e' lui il rigorista del Milan», quando il Milan l'aveva gia'
    lasciato). All'asta un giocatore con la squadra sbagliata non e' un
    dettaglio: sballa il modificatore, il giudizio, tutto.

    Stessa cosa per chi la Serie A la lascia del tutto: nessuno lo toglieva,
    e restava li' comprabile.

    LE PROTEZIONI, perche' qui si puo' fare molto danno. Scrivere una squadra
    sbagliata su 540 giocatori e' peggio che non scrivere niente:

      - la squadra si tocca solo se la sigla della pagina corrisponde a una
        delle venti che conosciamo; se non la riconosciamo, si lascia stare;
      - se la pagina non e' leggibile per almeno nove giocatori su dieci,
        non si tocca niente: vuol dire che e' cambiata e va guardata a mano;
      - gli omonimi si saltano: senza la squadra vecchia non c'e' modo di
        sapere quale dei due si e' trasferito, e indovinare e' peggio;
      - chi sparisce viene MARCATO, non cancellato. Se domani ricompare gli
        si toglie il marchio. Cancellare, con una pagina che oggi non va,
        vorrebbe dire perdere il listone.

    DUE MARCHI DIVERSI, e non vanno confusi. `fuori` e' la colonna «Fuori
    lista» dell'export della lega: lo dice LegheFantacalcio, ed e' la verita'
    per la nostra asta. `sparito` e' il nostro: vuol dire che oggi in quella
    pagina non l'abbiamo trovato. Il primo giorno li ho tenuti insieme e il
    risultato e' stato che l'aggiornamento delle 8 ha cancellato tutte e
    ventiquattro le marcature dell'export — perche' su Fantacalcio.it quei
    giocatori sono ancora quotati — e sono tornati comprabili senza che
    nessuno se ne accorgesse. Da qui in avanti ognuno tocca solo il suo.
    """
    fissati = fissati or {}
    per_nome = indicizza(giocatori)
    con_squadra = [r for r in righe if squadra_nostra(r.get("sq") or "")]

    # Una pagina con quattro righe non e' il listone: e' un frammento, o un
    # errore. Toccare l'anagrafica partendo da li' vorrebbe dire marcare come
    # spariti cinquecento giocatori che invece ci sono.
    if len(righe) < MINIMO_RIGHE:
        return [f"la pagina ha solo {len(righe)} righe, troppo poche per essere il "
                f"listone (ne servono almeno {MINIMO_RIGHE}): non tocco squadre e ruoli"]

    if len(con_squadra) < len(righe) * 0.9:
        return [f"squadre riconosciute solo in {len(con_squadra)} righe su {len(righe)}: "
                "non tocco squadre e ruoli"]

    cambi: list[str] = []
    da_rileggere: list[str] = []
    visti: set[int] = set()

    for riga in righe:
        chiave = chiave_nome(riga["nome"])
        candidati = per_nome.get(chiave)
        if not candidati or len(candidati) > 1:
            continue                      # sconosciuto, oppure omonimi: non si indovina
        g = candidati[0]
        visti.add(id(g))
        fisso = fissati.get(chiave, {})

        sq = squadra_nostra(riga.get("sq") or "")
        if sq and "sq" in fisso:
            pass                          # squadra corretta a mano: comanda quella
        elif sq and sq != g["sq"]:
            cambi.append(f"{g['n']}: {g['sq']} -> {sq}")
            # La nota e' un giudizio scritto a mano, e spesso nomina la squadra
            # («se e' lui il rigorista del Milan»). Quando uno si trasferisce
            # quella frase diventa falsa, e nessuno se ne accorge rileggendo il
            # listone. Qui lo sappiamo con certezza — il trasferimento e'
            # appena successo — quindi lo si dice, e la si riscrive a mano in
            # data/overrides.json.
            if g["sq"].lower() in (g.get("nota") or "").lower():
                da_rileggere.append(f"{g['n']} (la nota parla ancora del {g['sq']})")
            g["sq"] = sq

        r = (riga.get("r") or "").strip().upper()[:1]
        if r in RUOLI_VALIDI and "r" not in fisso and r != g["r"]:
            cambi.append(f"{g['n']}: ruolo {g['r']} -> {r}")
            g["r"] = r

        if g.pop("sparito", None):
            cambi.append(f"{g['n']}: torna nel listone")

    # chi non compare piu' nella pagina delle quotazioni. Attenzione: `fuori`
    # (la colonna dell'export) non si tocca ne' qui ne' sopra — e' roba della
    # lega, e questo script non ne sa niente.
    spariti = []
    for g in giocatori:
        if id(g) in visti or g.get("sparito"):
            continue
        if len(per_nome.get(chiave_nome(g["n"]), [])) > 1:
            continue                      # omonimi: uno dei due c'era, non so quale
        g["sparito"] = True
        spariti.append(g["n"])

    if cambi:
        print(f"    trasferimenti e correzioni ({len(cambi)}): " + "; ".join(cambi[:20])
              + (" …" if len(cambi) > 20 else ""))
    if spariti:
        print(f"    non sono piu' nella pagina delle quotazioni ({len(spariti)}): "
              + ", ".join(spariti[:20]) + (" …" if len(spariti) > 20 else ""))
    if da_rileggere:
        print("    NOTE DA RISCRIVERE a mano in data/overrides.json, nominano la squadra "
              f"vecchia ({len(da_rileggere)}): " + "; ".join(da_rileggere))
    fuori = sum(1 for g in giocatori if g.get("fuori"))
    persi = sum(1 for g in giocatori if g.get("sparito"))
    print(f"    fuori lista secondo l'export della lega: {fuori} su {len(giocatori)}")
    print(f"    spariti dalle quotazioni di Fantacalcio.it: {persi}")
    return []


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


def aggiorna_infortuni(diagnosi: bool = False) -> None:
    """Aggiorna anche l'infermeria, subito dopo il listone.

    Se questa parte non riesce NON facciamo fallire tutto: il listone appena
    letto e' buono e va salvato lo stesso. Segnaliamo pero' con un avviso che
    GitHub mostra fra le Annotations del run, cosi' non passa inosservato.
    """
    print("\n=== indisponibili")
    try:
        import infortuni
        codice = infortuni.main_da_aggiornamento(diagnosi)
    except SystemExit as e:
        # scarica() esce con un messaggio testuale quando la pagina risponde
        # male: senza ristamparlo qui, il motivo del guasto andrebbe perso
        if e.code and not isinstance(e.code, int):
            print(f"    {e.code}")
        codice = e.code if isinstance(e.code, int) else 1
    except Exception as e:                                    # noqa: BLE001
        print(f"    errore inatteso: {e}")
        codice = 1
    if codice:
        print("::warning::Infortuni non aggiornati: la pagina degli indisponibili "
              "non e' stata letta. Il listone e' stato salvato lo stesso; "
              "lancia 'python tools/infortuni.py --diagnosi' per capire perche'.")


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
    fissati = correzioni_a_mano()
    viste: dict[str, dict[str, str]] = {}
    if fissati:
        print(f"Correzioni a mano attive per {len(fissati)} giocatori "
              "(data/overrides.json): su di loro comanda quel file, non la pagina.")

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
        mancanti = [c for c in ATTESI[pagina] if c not in campi]
        if mancanti:
            print(f"    campi attesi che non ho trovato: {', '.join(mancanti)}")
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
            continue

        # La pagina delle quotazioni e' l'unica che dice in che squadra gioca
        # uno oggi, ed e' l'elenco di chi e' ancora nel listone.
        viste[pagina] = squadre_viste(righe)

        if pagina == "quotazioni":
            problemi.extend(aggiorna_anagrafica(giocatori, righe, fissati))

    # Le due pagine si contraddicono su qualcuno? Non si sceglie: si segnala.
    litigi = [x for x in discordanze(giocatori, viste)
              if chiave_nome(x.split(":")[0]) not in fissati]
    if litigi:
        print(f"\nSQUADRE DA GUARDARE ({len(litigi)}): le due pagine di Fantacalcio.it non")
        print("dicono la stessa cosa. Controlla e, se serve, incolla la riga in")
        print("data/overrides.json — da li' in poi comanda quella:")
        for x in litigi[:20]:
            print(f"  - {x}")

    # Ultima parola alle correzioni scritte a mano: qualunque cosa abbiano
    # detto le pagine, qui si rimette quello che sappiamo noi.
    for riga in applica_correzioni(giocatori, fissati):
        print(f"    {riga}")

    if problemi:
        print("\nNon aggiorno niente, questi punti non tornano:")
        for p in problemi:
            print(f"  - {p}")
        print("\nRilancia con --diagnosi e mandami l'output: la pagina e' cambiata.")
        return 1

    if args.diagnosi:
        # anche in diagnosi guardiamo l'infermeria: e' li' che serve capire
        aggiorna_infortuni(diagnosi=True)
        print("\n(diagnosi: non ho scritto niente)")
        return 0

    dopo = json.dumps(giocatori, ensure_ascii=False, sort_keys=True)
    if prima == dopo:
        print("\nStatistiche e quotazioni identiche a ieri: players.json resta com'era.")
    else:
        compatto = json.dumps(giocatori, ensure_ascii=False, separators=(",", ":"))
        PLAYERS.write_text(compatto, encoding="utf-8")
        marca_dati(compatto)
        con_stat = sum(1 for g in giocatori if g.get("gol") is not None)
        print(f"\nScritto {PLAYERS.relative_to(RADICE)} — {totale} giocatori, "
              f"{con_stat} con gol/assist/cartellini.")

    # L'infermeria si aggiorna SEMPRE, anche quando il listone non e' cambiato:
    # le statistiche restano ferme per giorni, gli infortuni no.
    aggiorna_infortuni()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
