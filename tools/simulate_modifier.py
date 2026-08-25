#!/usr/bin/env python3
"""Quanto rende il modificatore di difesa, per qualita' del reparto e per assetto.

    python3 tools/simulate_modifier.py

La tabella del modificatore, la soglia minima di difensori e l'inclusione del
portiere vengono lette da assets/data/league.json: cambia quel file e la
simulazione segue le regole della tua lega.

Il modello: ogni difensore prende un voto estratto da una normale centrata sulla
sua media voto attesa (deviazione 0,60; il portiere 0,75), arrotondato al mezzo
punto come fanno i quotidiani sportivi. Con probabilita' pSalta un titolare resta
senza voto; la panchina lo sostituisce con probabilita' copertura. Se i voti
validi in difesa scendono sotto il minimo, il modificatore non si applica.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    sys.exit("Serve numpy:  pip install numpy")

RADICE = Path(__file__).resolve().parent.parent
LEGA = json.loads((RADICE / "assets" / "data" / "league.json").read_text(encoding="utf-8"))
MOD = LEGA["modificatoreDifesa"]
ESTRAZIONI = 400_000

rng = np.random.default_rng(20262027)


def punti(media: np.ndarray) -> np.ndarray:
    """Applica la tabella della lega a un array di medie voto."""
    out = np.zeros_like(media)
    for soglia, valore in MOD["tabella"]:
        out = np.where(media >= soglia, valore, out)
    return out


def simula(medie_difensori, media_portiere, p_salta=0.05, copertura=0.95):
    medie = np.array(medie_difensori, dtype=float)
    n = len(medie)

    voti = np.round(rng.normal(medie, 0.60, size=(ESTRAZIONI, n)) * 2) / 2
    salta = rng.random((ESTRAZIONI, n)) < p_salta
    coperto = rng.random((ESTRAZIONI, n)) < copertura
    riserva = np.round(rng.normal(6.05, 0.60, size=(ESTRAZIONI, n)) * 2) / 2

    voti = np.where(salta & coperto, riserva, voti)
    validi = ~(salta & ~coperto)
    quanti_validi = validi.sum(axis=1)

    utili = np.where(validi, voti, -99.0)
    migliori = np.sort(utili, axis=1)[:, -MOD["migliori"]:].sum(axis=1)

    portiere = np.round(rng.normal(media_portiere, 0.75, ESTRAZIONI) * 2) / 2
    if MOD["includiPortiere"]:
        media = (migliori + portiere) / (MOD["migliori"] + 1)
    else:
        media = migliori / MOD["migliori"]

    p = np.where(quanti_validi >= MOD["minDifensori"], punti(media), 0.0)
    return {
        "per_giornata": p.mean(),
        "stagione": p.mean() * 38,
        "almeno_tre": (p >= 3).mean(),
        "azzerato": (quanti_validi < MOD["minDifensori"]).mean(),
    }


SCENARI = {
    "5-4-1 · cinque difensori buoni":            ([6.45, 6.35, 6.25, 6.20, 6.15], 6.45),
    "4-5-1 · quattro difensori eccellenti":      ([6.50, 6.42, 6.35, 6.28], 6.45),
    "4-5-1 · quattro difensori buoni":           ([6.30, 6.25, 6.20, 6.15], 6.45),
    "4-5-1 · quattro eccellenti, portiere medio": ([6.50, 6.42, 6.35, 6.28], 6.00),
    "4-5-1 · difesa presa a caso":               ([6.05, 6.03, 6.02, 6.00], 6.05),
    "Rosa proposta (Bremer/Pavlovic/Rrahmani/Gila + Butez)": ([6.30, 6.29, 6.28, 6.26], 6.30),
}


def main() -> int:
    print(f"Lega: {LEGA['nome']} — {LEGA['crediti']} crediti, {LEGA['squadre']} squadre")
    print(f"Modificatore: migliori {MOD['migliori']} difensori"
          f"{' + portiere' if MOD['includiPortiere'] else ''}, "
          f"minimo {MOD['minDifensori']} difensori in campo\n")

    print(f"{'scenario':56s}{'pt/giornata':>13s}{'stagione':>10s}{'>=3 pt':>9s}{'azzerato':>10s}")
    print("-" * 98)
    for nome, (difensori, portiere) in SCENARI.items():
        r = simula(difensori, portiere)
        print(f"{nome:56s}{r['per_giornata']:13.2f}{r['stagione']:10.0f}"
              f"{r['almeno_tre'] * 100:8.0f}%{r['azzerato'] * 100:9.1f}%")

    print("\nQuanto conta la panchina (a parita' di titolari, assetto 4-5-1):")
    for copertura in (0.60, 0.85, 0.97):
        r = simula([6.50, 6.42, 6.35, 6.28], 6.45, copertura=copertura)
        print(f"  copertura {copertura * 100:3.0f}%  ->  {r['per_giornata']:.2f} pt/giornata, "
              f"modificatore azzerato nel {r['azzerato'] * 100:.1f}% delle giornate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
