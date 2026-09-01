#!/usr/bin/env python3
"""Prova di `aggiorna_anagrafica`, cioe' della parte che puo' rovinare il listone.

    python3 tools/prova-anagrafica.py

Tutto il resto di aggiorna_dati.py scrive numeri: se sbaglia si vede subito, e
comunque un gol in piu' o in meno non cambia un'asta. Squadra e ruolo no.
Scrivere «Milan» su un giocatore che gioca altrove sballa il modificatore di
difesa, il giudizio e la nota, e lo fa in silenzio — il sito continua a
funzionare benissimo mentre ti racconta una rosa che non esiste.

E il danno arriva su cinquecento giocatori insieme, non su uno: se la pagina
di Fantacalcio cambia impaginazione e le sigle delle squadre scivolano nella
colonna sbagliata, senza protezioni ci ritroveremmo il listone riscritto male
la mattina dell'asta. Le prove qui sotto verificano soprattutto questo: non
tanto «funziona», quanto «si ferma quando non capisce».

Nota sul banco di prova: le protezioni ragionano in PROPORZIONE (quante
squadre riconosciute su quante righe) e hanno una soglia minima di righe.
Su cinque righe finte scatterebbero sempre, quindi ogni caso lavora su un
listone della misura giusta — se no si misura il banco di prova, non il
codice. Ci ho sbattuto la testa scrivendole: le prime versioni passavano o
fallivano per la dimensione dell'elenco, non per la logica.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aggiorna_dati as A          # noqa: E402

ko = 0
tot = 0


def prova(nome, condizione, dettaglio=""):
    global ko, tot
    tot += 1
    if not condizione:
        ko += 1
    esito = "OK     " if condizione else "FALLITO"
    print(f"  {esito} {nome}" + (f"  -> {dettaglio}" if not condizione and dettaglio else ""))


NOTI = [
    {"n": "Nkunku", "sq": "Milan", "r": "A", "q": 13},
    {"n": "Dimarco", "sq": "Inter", "r": "D", "q": 31},
    {"n": "Svilar", "sq": "Roma", "r": "P", "q": 18},
    {"n": "Esposito", "sq": "Inter", "r": "A", "q": 17},
    {"n": "Esposito", "sq": "Napoli", "r": "C", "q": 6},
]

RIEMPITIVI = A.MINIMO_RIGHE + 20


def listone():
    """Un listone della misura giusta: i cinque che ci interessano, piu' folla."""
    g = [dict(x) for x in NOTI]
    g += [{"n": f"Tale{i}", "sq": "Atalanta", "r": "C", "q": 1} for i in range(RIEMPITIVI)]
    return g


def riga(nome, sq, r):
    return {"nome": nome, "sq": sq, "r": r}


def pagina(*righe, sigla_folla="ATA"):
    """Le righe che ci interessano, piu' la folla che tiene su le proporzioni."""
    return list(righe) + [riga(f"Tale{i}", sigla_folla, "C") for i in range(RIEMPITIVI)]


def chi(g, nome, sq=None):
    for x in g:
        if x["n"] == nome and (sq is None or x["sq"] == sq):
            return x
    return None


# ---------------------------------------------------------------- le prove

print("— il trasferimento si vede, il resto resta com'e' —")

g = listone()
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "COM", "A"),        # passato al Como
    riga("Dimarco", "INT", "D"),
    riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"),
    riga("Esposito", "NAP", "C"),
))
prova("chi ha cambiato squadra la cambia anche qui",
      chi(g, "Nkunku")["sq"] == "Como", chi(g, "Nkunku")["sq"])
prova("chi non si e' mosso resta dov'era",
      chi(g, "Dimarco")["sq"] == "Inter" and chi(g, "Svilar")["sq"] == "Roma")
prova("e nessuno finisce fuori lista", not any(x.get("fuori") for x in g),
      str([x["n"] for x in g if x.get("fuori")][:5]))

print("\n— gli omonimi non si toccano, perche' non si puo' sapere quale —")

g = listone()
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "A"), riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "JUV", "A"),      # uno dei due Esposito si e' mosso: ma quale?
    riga("Esposito", "NAP", "C"),
))
prova("i due omonimi restano dove stavano",
      bool(chi(g, "Esposito", "Inter")) and bool(chi(g, "Esposito", "Napoli")),
      str([x["sq"] for x in g if x["n"] == "Esposito"]))
prova("e non vengono nemmeno segnati come spariti",
      not any(x.get("fuori") for x in g if x["n"] == "Esposito"))

print("\n— chi sparisce dal listone viene marcato, non cancellato —")

g = listone()
quanti = len(g)
A.aggiorna_anagrafica(g, pagina(
    riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))                                      # Nkunku non c'e' piu'
prova("chi non c'e' piu' e' marcato fuori lista", chi(g, "Nkunku").get("fuori") is True)
prova("ma resta nel file, non sparisce", len(g) == quanti)
prova("e nessun altro viene marcato",
      [x["n"] for x in g if x.get("fuori")] == ["Nkunku"],
      str([x["n"] for x in g if x.get("fuori")][:5]))

print("\n— se ricompare, il marchio si toglie —")

A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "COM", "A"), riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))
prova("torna comprabile", not chi(g, "Nkunku").get("fuori"))
prova("con la squadra nuova", chi(g, "Nkunku")["sq"] == "Como", chi(g, "Nkunku")["sq"])

print("\n— se la pagina non si capisce, non si tocca NIENTE —")

g = listone()
problemi = A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "???", "A"),        # sigle che non riconosciamo:
    riga("Dimarco", "???", "D"),       # la pagina e' cambiata sotto di noi
    riga("Svilar", "???", "P"),
    sigla_folla="???",
))
prova("lo dice invece di indovinare", bool(problemi), str(problemi))
prova("e il listone resta intatto",
      chi(g, "Nkunku")["sq"] == "Milan" and chi(g, "Dimarco")["sq"] == "Inter")
prova("senza marcare nessuno come sparito", not any(x.get("fuori") for x in g))

print("\n— una squadra sola illeggibile non blocca le altre —")

g = listone()
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "???", "A"),        # questa no...
    riga("Dimarco", "COM", "D"),       # ...ma questa si'
    riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))
prova("quello leggibile si aggiorna", chi(g, "Dimarco")["sq"] == "Como", chi(g, "Dimarco")["sq"])
prova("quello illeggibile resta com'era", chi(g, "Nkunku")["sq"] == "Milan", chi(g, "Nkunku")["sq"])
prova("e non viene scambiato per sparito", not chi(g, "Nkunku").get("fuori"))

print("\n— anche il ruolo si corregge, se cambia —")

g = listone()
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "C"),        # da attaccante a centrocampista
    riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))
prova("il ruolo nuovo entra", chi(g, "Nkunku")["r"] == "C", chi(g, "Nkunku")["r"])

g = listone()
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "X"),        # ruolo che non esiste
    riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))
prova("un ruolo assurdo viene ignorato", chi(g, "Nkunku")["r"] == "A", chi(g, "Nkunku")["r"])

print("\n— una pagina troppo corta non e' il listone —")

g = listone()
problemi = A.aggiorna_anagrafica(g, [
    riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
])
prova("si rifiuta di lavorarci", bool(problemi), str(problemi))
prova("e non marca mezzo listone come sparito", not any(x.get("fuori") for x in g))

print("\n" + "=" * 52)
if ko:
    print(f"ATTENZIONE: {ko} prove fallite su {tot}.")
    sys.exit(1)
print(f"Tutto a posto: {tot} prove su {tot}.")
