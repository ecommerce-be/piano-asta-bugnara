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
prova("e nessuno finisce fuori dal listone", not any(x.get("sparito") for x in g),
      str([x["n"] for x in g if x.get("sparito")][:5]))

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
      not any(x.get("sparito") for x in g if x["n"] == "Esposito"))

print("\n— chi sparisce dal listone viene marcato, non cancellato —")

g = listone()
quanti = len(g)
A.aggiorna_anagrafica(g, pagina(
    riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))                                      # Nkunku non c'e' piu'
prova("chi non c'e' piu' e' marcato sparito", chi(g, "Nkunku").get("sparito") is True)
prova("ma resta nel file, non sparisce", len(g) == quanti)
prova("e nessun altro viene marcato",
      [x["n"] for x in g if x.get("sparito")] == ["Nkunku"],
      str([x["n"] for x in g if x.get("sparito")][:5]))

print("\n— se ricompare, il marchio si toglie —")

A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "COM", "A"), riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))
prova("torna comprabile", not chi(g, "Nkunku").get("sparito"))
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
prova("senza marcare nessuno come sparito", not any(x.get("sparito") for x in g))

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
prova("e non viene scambiato per sparito", not chi(g, "Nkunku").get("sparito"))

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
prova("e non marca mezzo listone come sparito", not any(x.get("sparito") for x in g))

print("\n— il «Fuori lista» della lega non lo tocca nessuno —")

# Il primo settembre e' successo davvero: l'aggiornamento delle 8 ha cancellato
# tutte e ventiquattro le marcature dell'export, perche' su Fantacalcio.it quei
# giocatori erano ancora quotati, e sono tornati comprabili in silenzio.
g = listone()
chi(g, "Svilar")["fuori"] = True          # lo dice l'export della lega
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "A"), riga("Dimarco", "INT", "D"),
    riga("Svilar", "ROM", "P"),           # su Fantacalcio.it e' ancora quotato
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
))
prova("resta fuori lista anche se la pagina lo quota", chi(g, "Svilar").get("fuori") is True)
prova("e i due marchi restano distinti", not chi(g, "Svilar").get("sparito"))

print("\n— la correzione a mano vince sulla pagina —")

g = listone()
fissati = {"nkunku": {"sq": "Como"}}
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "A"),           # la fonte e' rimasta indietro
    riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
), fissati)
prova("la pagina non riporta indietro chi e' stato corretto",
      chi(g, "Nkunku")["sq"] == "Milan", chi(g, "Nkunku")["sq"])
fatte = A.applica_correzioni(g, fissati)
prova("e la correzione entra", chi(g, "Nkunku")["sq"] == "Como", chi(g, "Nkunku")["sq"])
prova("tenendo da parte cosa dice la fonte", chi(g, "Nkunku").get("sqFonte") == "Milan",
      str(chi(g, "Nkunku").get("sqFonte")))
prova("e dicendolo", any("a mano" in x for x in fatte), str(fatte))

print("\n— quando la fonte si mette in pari, lo dice —")

fatte = A.applica_correzioni(g, fissati)     # secondo giro: ormai e' gia' Como
prova("la correzione non si ripete", not any("-> Como" in x for x in fatte), str(fatte))
prova("e avvisa che la riga si puo' togliere",
      any("si puo' togliere" in x for x in fatte), str(fatte))

print("\n— anche il ruolo si puo' fissare a mano —")

g = listone()
fissati = {"nkunku": {"r": "C"}}
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "A"), riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
), fissati)
A.applica_correzioni(g, fissati)
prova("comanda il file, non la pagina", chi(g, "Nkunku")["r"] == "C", chi(g, "Nkunku")["r"])

print("\n— i rigori stanno in una colonna sola, «segnati / sbagliati» —")

# Copia fedele dell'intestazione vera di fantacalcio.it/statistiche-serie-a
# (diagnosi del 1 settembre): il nome sta nella quarta cella, e i rigori sono
# una colonna «Rig» col valore «5 / 1» dentro. Cercando "R+" e "R-" separate
# non le trovavamo mai, e nel listone quelle due colonne restavano vuote per
# tutti — sembravano zeri.
INTEST = ["Calciatore", "", "", "", "Sq", "PV", "MV", "FM", "Gol", "GS",
          "Rig", "RP", "Ass", "Amm", "Esp", "Au"]


def pagina_statistiche(*giocatori):
    def riga(celle):
        return "<tr>" + "".join(f"<td>{c}</td>" for c in celle) + "</tr>"
    corpo = [riga(["", "", "", g[0], *g[1:]]) for g in giocatori]
    # serve un minimo di righe perche' la tabella venga presa sul serio
    corpo += [riga(["", "", "", f"Tale{i}", "ATA", "1", "6", "6", "0", "0",
                    "0 / 0", "0", "0", "0", "0", "0"]) for i in range(30)]
    return "<table>" + riga(INTEST) + "".join(corpo) + "</table>"


html = pagina_statistiche(
    ("Malen", "ROM", "2", "8,25", "15,5", "5", "0", "3 / 1", "0", "0", "1", "0", "0"),
    ("Svilar", "ROM", "2", "6,5", "6,5", "0", "1", "0 / 0", "2", "0", "0", "0", "1"),
)
righe, diag = A.leggi_tabelle(html, A.ATTESI["statistiche"])
prima = righe[0]
prova("la colonna Rig viene riconosciuta", "rig" in diag["colonne_riconosciute"],
      str(diag.get("colonne_riconosciute")))
prova("i rigori segnati escono", prima.get("rseg") == 3, str(prima.get("rseg")))
prova("e anche quelli sbagliati", prima.get("rsba") == 1, str(prima.get("rsba")))
prova("«0 / 0» resta zero, non sparisce",
      righe[1].get("rseg") == 0 and righe[1].get("rsba") == 0, str(righe[1]))
prova("gli autogol si leggono", "au" in prima, str(sorted(prima)))
prova("e i rigori parati non si confondono con quelli segnati",
      prima.get("rp") == 0 and righe[1].get("rp") == 2, str([prima.get("rp"), righe[1].get("rp")]))
prova("il nome resta quello giusto anche con tre celle vuote davanti",
      prima["nome"] == "Malen", prima["nome"])
prova("e nessuno dei campi attesi manca piu'",
      not [c for c in A.ATTESI["statistiche"] if not any(c in r for r in righe)],
      str([c for c in A.ATTESI["statistiche"] if not any(c in r for r in righe)]))

print("\n— chi ha lasciato la Serie A si toglie a mano —")

# Nkunku e' andato in Germania e Fantacalcio.it continua a quotarlo: il sito
# lo proponeva come «affare dell'asta» con la nota che parlava del Milan.
g = listone()
fissati = {"nkunku": {"fuori": True, "nota": "Passato in Germania.", "mult": 1.0}}
A.aggiorna_anagrafica(g, pagina(
    riga("Nkunku", "MIL", "A"), riga("Dimarco", "INT", "D"), riga("Svilar", "ROM", "P"),
    riga("Esposito", "INT", "A"), riga("Esposito", "NAP", "C"),
), fissati)
fatte = A.applica_correzioni(g, fissati)
prova("esce dal listone", chi(g, "Nkunku").get("fuori") is True)
prova("e resta nel file, non viene cancellato", bool(chi(g, "Nkunku")))
prova("con la nota riscritta", chi(g, "Nkunku")["nota"] == "Passato in Germania.",
      str(chi(g, "Nkunku").get("nota")))
prova("e nessun altro ne risente", not any(x.get("fuori") for x in g if x["n"] != "Nkunku"))

# e si puo' anche rimettere dentro, se torna
fissati = {"nkunku": {"fuori": False}}
A.applica_correzioni(g, fissati)
prova("se torna, si rimette dentro", not chi(g, "Nkunku").get("fuori"))

print("\n— due pagine che si contraddicono si segnalano, non si indovinano —")

g = listone()
viste = {
    "quotazioni": {"nkunku": "Milan", "dimarco": "Inter"},
    "statistiche": {"nkunku": "Como", "dimarco": "Inter"},
}
detto = A.discordanze(g, viste)
prova("il disaccordo salta fuori", len(detto) == 1, str(detto))
prova("con la riga gia' pronta da incollare",
      '"sq": "Como"' in detto[0] and "Nkunku" in detto[0], str(detto))
prova("e chi e' d'accordo non compare", all("Dimarco" not in x for x in detto), str(detto))
prova("con una pagina sola non si dice niente",
      A.discordanze(g, {"quotazioni": viste["quotazioni"]}) == [])

print("\n" + "=" * 52)
if ko:
    print(f"ATTENZIONE: {ko} prove fallite su {tot}.")
    sys.exit(1)
print(f"Tutto a posto: {tot} prove su {tot}.")
