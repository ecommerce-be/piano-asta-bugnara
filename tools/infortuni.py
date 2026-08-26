#!/usr/bin/env python3
"""Legge chi e' fermo — infortunati e squalificati — e scrive assets/data/infortuni.json.

    python3 tools/infortuni.py             # aggiorna
    python3 tools/infortuni.py --diagnosi  # guarda e riferisce, senza scrivere

Perche' un lettore diverso da tools/aggiorna_dati.py: qui non ci sono tabelle.
Sono elenchi discorsivi, raggruppati per squadra, dove ogni voce e' una frase
("lesione del collaterale mediale di secondo grado del ginocchio sinistro,
recuperabile da inizio ottobre").

Leggiamo DUE pagine: /infortunati-serie-a e /squalificati-e-diffidati. La terza,
/indisponibili-serie-a, sembrerebbe la piu' completa ma arriva vuota: la riempie
JavaScript, e chi scarica l'HTML vede solo la cornice.

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
import urllib.parse
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
# Due pagine, non una. La sonda ha stabilito che /indisponibili-serie-a arriva
# vuota — la riempie JavaScript — mentre queste due hanno i dati gia' scritti
# nell'HTML. Ognuna porta un tipo di assenza diverso.
FONTI = [
    ("infortunio", "https://www.fantacalcio.it/infortunati-serie-a"),
    ("squalifica", "https://www.fantacalcio.it/squalificati-e-diffidati-campionato-serie-a"),
]
URL = FONTI[0][1]

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


def categoria_precedente(nodo, predefinito: str = "infortunio") -> str:
    """Risale il documento cercando l'ultimo titolo tipo "Infortunati".

    Se non ne trova, vale il tipo della pagina da cui stiamo leggendo: la
    pagina degli infortunati porta infortuni, quella delle squalifiche no."""
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
    return predefinito


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


def leggi_scorrendo(zuppa, noti: dict, tipo_default: str) -> dict[str, dict]:
    """Legge la pagina scorrendola dall'inizio alla fine, come la leggeresti tu.

    Serve quando i nomi non sono link e quindi non c'e' un indirizzo da cui
    ricavare la squadra. Attraversiamo il documento tenendo a mente due cose:
    l'ultima squadra nominata e l'ultimo titolo di sezione visto. Quando
    incontriamo un nome del listone, sappiamo gia' di chi e' e perche' e' fermo.
    """
    voci: dict[str, dict] = {}
    squadra, tipo = None, tipo_default

    for pezzo in zuppa.find_all(string=True):
        testo = " ".join(str(pezzo).split())
        if not testo or len(testo) > 40:
            continue

        sq = SQUADRE.get(chiave_intestazione(testo))
        if sq:
            squadra = sq
            continue

        k = chiave_intestazione(testo)
        if k.startswith("infortunat"):
            tipo = "infortunio"; continue
        if k.startswith("squalificat"):
            tipo = "squalifica"; continue
        if k.startswith("diffidat"):
            tipo = "diffida"; continue

        candidati = noti.get(chiave_nome(testo))
        if not candidati:
            continue
        g = next((x for x in candidati if x["sq"] == squadra), None) if squadra else None
        if not g and len(candidati) == 1:
            g = candidati[0]
        if not g:
            continue

        desc = blocco_di(pezzo.parent, testo)
        if len(desc) < 4:
            continue
        etichetta, data = quando_rientra(desc)
        chiave = f"{g['r']}|{g['n']}|{g['sq']}"
        if chiave in voci and len(voci[chiave]["desc"]) >= len(desc):
            continue
        voci[chiave] = {"id": chiave, "n": g["n"], "sq": g["sq"], "r": g["r"],
                        "tipo": tipo, "desc": desc[:300],
                        "rientro": etichetta, "quando": data}
    return voci


def leggi(html: str, noti: dict[str, list[dict]], tipo_default: str = "infortunio") -> tuple[list[dict], dict]:
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
            "tipo": categoria_precedente(a, tipo_default),
            "desc": desc[:300],
            "rientro": etichetta,
            "quando": data,
        }

    da_link = len(voci)
    # Se i nomi non sono link, il passo sopra non trova niente: allora leggiamo
    # la pagina scorrendola, che funziona anche col testo semplice.
    if da_link < 5:
        voci.update(leggi_scorrendo(zuppa, noti, tipo_default))

    diagnosi = {
        "voci_dai_link": da_link,
        "voci_scorrendo_il_testo": len(voci) - da_link,
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


FONTI_ALTERNATIVE = [
    ("fantacalcio.it /infortunati", "https://www.fantacalcio.it/infortunati-serie-a"),
    ("fantacalcio-online", "https://www.fantacalcio-online.com/it/infortunati-serie-a"),
    ("pianetafanta", "https://www.pianetafanta.it/giocatori-infortunati.asp"),
    ("fantacalciopedia", "https://www.fantacalciopedia.com/lista-infortunati-serie-a/"),
]

# indirizzi che somigliano a un'interfaccia dati citata dentro gli script
INDIRIZZI = re.compile(r"""['"](/?(?:https?://[^'"]+)?[a-zA-Z0-9/_.-]*"""
                       r"""(?:api|json|indisponibil|infortun)[a-zA-Z0-9/_.-]*)['"]""", re.I)


def quanti_nomi(testo: str, noti: dict) -> tuple[int, list[str]]:
    """Quanti giocatori del nostro listone compaiono in questo testo?

    E' il modo piu' diretto per sapere se i dati veri sono dentro la pagina o
    se stiamo guardando solo la cornice. Consideriamo i nomi lunghi almeno
    cinque lettere, per non contare coincidenze come 'Mout' dentro altre parole.
    """
    visti = []
    for lista in noti.values():
        n = lista[0]["n"]
        if len(n) >= 5 and n in testo:
            visti.append(n)
    return len(visti), visti[:8]


def sonda(html: str, noti: dict, url_base: str) -> None:
    """Cerca dove stiano davvero i dati, provando tre strade in un colpo solo.

    1. un'interfaccia dati citata negli script della pagina;
    2. altre pagine dello stesso sito;
    3. altri siti che pubblicano la stessa informazione.
    """
    print("\n    ═════ sonda: dove stanno davvero i dati ═════")

    zuppa = BeautifulSoup(html, "html.parser")
    print(f"    [1] indirizzi che somigliano a un'interfaccia dati, dentro gli script")
    trovati, visti = [], set()
    for s in zuppa.find_all("script"):
        for pezzo in (s.string or "", s.get("src") or ""):
            for m in INDIRIZZI.findall(pezzo or ""):
                if m in visti or len(m) < 8:
                    continue
                visti.add(m)
                trovati.append(m)
    for t in trovati[:14]:
        print(f"        {t[:110]}")
    if not trovati:
        print("        nessuno")

    da_provare = []
    for t in trovati[:8]:
        u = t if t.startswith("http") else urllib.parse.urljoin(url_base, t)
        if u.startswith("http"):
            da_provare.append(u)

    for u in da_provare:
        try:
            testo = scarica(u)
        except SystemExit as e:
            print(f"        {u[:80]} -> {e.code}")
            continue
        n, esempi = quanti_nomi(testo, noti)
        print(f"        {u[:80]} -> {len(testo):,} caratteri, {n} nomi del listone {esempi[:3]}")

    print(f"\n    [2-3] altre pagine e altri siti")
    for nome, u in FONTI_ALTERNATIVE:
        try:
            testo = scarica(u)
        except SystemExit as e:
            print(f"        {nome:<26} {e.code}")
            continue
        n, esempi = quanti_nomi(testo, noti)
        verdetto = "DATI PRESENTI" if n >= 15 else "solo cornice" if n < 5 else "pochi nomi"
        print(f"        {nome:<26} {len(testo):>9,} car · {n:>3} nomi · {verdetto} {esempi[:3]}")

    print("\n    ═════ fine sonda ═════")


def main_da_aggiornamento(diagnosi: bool = False) -> int:
    """Punto d'ingresso per tools/aggiorna_dati.py, senza argomenti da riga di comando."""
    return main(argparse.Namespace(diagnosi=diagnosi, url=URL))


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

    fonti = [("infortunio", args.url)] if args.url != URL else FONTI
    voci: list[dict] = []
    ultimo_html, ultima_url = "", args.url

    for tipo, url in fonti:
        print(f"=== {tipo} — {url}")
        try:
            html = scarica(url)
        except SystemExit as e:
            print(f"    {e.code}")
            continue
        print(f"    scaricati {len(html):,} caratteri")
        ultimo_html, ultima_url = html, url

        parziali, diagnosi = leggi(html, noti, tipo)
        for k, v in diagnosi.items():
            print(f"    {k}: {v}")
        # la prima fonte vince sui doppioni: un infortunato squalificato resta
        # prima di tutto un infortunato, che e' l'informazione che pesa
        gia = {v["id"] for v in voci}
        voci.extend(v for v in parziali if v["id"] not in gia)

    if len(voci) < SOGLIA:
        if ultimo_html:
            anatomia(ultimo_html, noti)
            sonda(ultimo_html, noti, ultima_url)
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
