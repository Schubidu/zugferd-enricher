#!/usr/bin/env python3
"""Reproducible synthetic corpus and small quantized fastText model for local inference.

Requires fasttext==0.9.3. No personal or third-party invoice data are used.
The benchmark is a synthetic smoke test, NOT evidence of real-world accuracy.
"""
from __future__ import annotations
from pathlib import Path
import json
import tempfile
import fasttext

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "public/models/invoice-categories-v1.ftz"
CATEGORIES = {
    "accommodation": [
        "Übernachtung", "Übernachtung Einzelzimmer", "Logis", "Zimmernacht",
        "Hotelzimmer", "Doppelzimmer Übernachtung", "Zimmerpreis", "Room night",
        "Accommodation", "Room rate", "Lodging", "Overnight stay",
        "Nächtigung Zimmer", "Room charge", "Übernachtungsleistung",
    ],
    "food": [
        "Frühstück Speisen", "Frühstücksbuffet Essen", "Breakfast food",
        "Breakfast meal", "Frühstücksbrötchen", "Lunch menu", "Mittagessen",
        "Abendessen", "Dinner", "Restaurant Speisen", "Catering Food",
        "Lunch buffet", "Speisen Restaurant", "Salat", "Hotel Frühstück",
    ],
    "beverage": [
        "Frühstück Getränke", "Frühstücksgetränke", "Coffee", "Kaffee",
        "Cappuccino", "Mineralwasser", "Softdrinks", "Getränkeflatrate",
        "Drinks", "Beverages", "Tea", "Cola", "Bier", "Wasserflasche",
        "Breakfast beverages",
    ],
    "parking": [
        "Parken", "Parkgebühr", "Garage Parking", "Parkhaus",
        "Parking fee", "Hotel parking", "Tiefgarage", "Garage fee",
        "Car park", "Parkticket", "Car parking", "Stellplatz",
        "Parkplatz", "Parkautomat", "Valet parking",
    ],
    "city_tax": [
        "Kurtaxe", "Ortstaxe", "Bettensteuer", "Beherbergungssteuer",
        "City tax", "Tourism levy", "Tourismusabgabe", "Kommunalabgabe",
        "Touristensteuer", "Übernachtungssteuer", "Gemeindetaxe",
        "Municipal tourism tax", "Kurbeitrag", "Ortstaxen", "City levy",
    ],
    "bundle": [
        "Business Paket", "Arrangement", "Kombipaket", "Service package",
        "Hotelpauschale", "Frühstück Paket", "Full board package",
        "Mischleistung", "Business arrangement", "Bundle services",
        "Sonderpauschale", "Meeting package", "Package rate",
        "Halbpension Paket", "Gesamtpaket",
    ],
    "other": [
        "Büromaterial", "Softwarelizenz", "Computer Zubehör", "USB Kabel",
        "Papier Kopierbedarf", "Druckerpatrone", "Postgebühr",
        "Wartungsleistung", "Werkzeugset", "Batterie",
        "IT Dienstleistung", "Repair service", "Printer paper",
        "Shipping service", "Consulting hours",
    ],
}
# Synthetic contexts; no tax-rate words are used as labels/features.
CONTEXTS = [
    "{}", "{} Tag 1", "{} Tag 2", "{} 12.11.2026", "{} 15.11.2026",
    "{} 1 Stück", "{} 2 Einheiten", "{} 1 Nacht", "{} pro Tag",
    "{} Option A", "{} Option B", "{} Rechnung", "{} Buchung",
    "{} Booking", "{} Position", "{} Service",
]
HELD_OUT = {
    "accommodation": ["Lodging one night", "Einzelzimmer Übernachtungsleistung"],
    "food": ["Restaurant Mittagessen", "Speisen Abendmenü"],
    "beverage": ["Cappuccino Bar", "Frühstücksgetränke Hotel"],
    "parking": ["Parkticket Tiefgarage", "Garage parking day"],
    "city_tax": ["Ortstaxe Gemeinde", "Kurtaxe je Nacht"],
    "bundle": ["Business arrangement", "Kombipaket Hotel"],
    "other": ["Büromaterial Papier", "USB Kabel Adapter"],
}

def main() -> None:
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        train = Path(temp) / "training.txt"
        lines = [
            "__label__" + category + " " + variant.format(base)
            for category, entries in CATEGORIES.items()
            for base in entries
            for variant in CONTEXTS
        ]
        # Fixed order and single-thread training; no private invoice training data.
        train.write_text("\n".join(lines) + "\n", encoding="utf8")
        model = fasttext.train_supervised(
            input=str(train), lr=0.05, epoch=25, dim=16, bucket=2000,
            minn=0, maxn=0, wordNgrams=2, minCount=1,
            loss="softmax", thread=1, verbose=0,
        )
        model.quantize(input=str(train), retrain=True, qnorm=True, dsub=2, verbose=0)
        model.save_model(str(MODEL))

        correct = 0
        withheld = 0
        tested = 0
        for category, entries in HELD_OUT.items():
            for entry in entries:
                prediction, confidence = model.predict(entry.lower(), k=1)
                tested += 1
                if prediction[0] == "__label__" + category:
                    correct += 1
                if float(confidence[0]) < 0.83:
                    withheld += 1
        # This is diagnostic, not a guarantee that a score transfers to real invoices.
        print(json.dumps({
            "model": str(MODEL.relative_to(ROOT)),
            "format": "fastText quantized ftz",
            "bytes": MODEL.stat().st_size,
            "training_examples": len(lines),
            "synthetic_held_out": tested,
            "top1_correct": correct,
            "below_abstention_threshold": withheld,
        }, sort_keys=True))
        if MODEL.stat().st_size > 1024 * 1024:
            raise SystemExit("Model exceeds 1 MiB budget")
        if correct < 7:
            raise SystemExit("Synthetic classifier check unexpectedly weak")

if __name__ == "__main__":
    main()
