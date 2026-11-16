#!/usr/bin/env python3
"""Generate a fully synthetic one-page PDF for isolated PDF/A-3 CI experiments.

No user invoice, API call or third-party data is processed. PDF content is
deliberately kept as text (not rasterised) to allow independent fidelity tests.
This is a *test source*, not evidence of PDF/A-3 compliance.
"""
from __future__ import annotations

import argparse
from pathlib import Path


LINES = [
    "SYNTHETISCHE TESTRECHNUNG - KEINE ECHTE RECHNUNG",
    "Rechnungsnummer: XML-2026-001",
    "Rechnungsdatum: 15.11.2026",
    "Leistungsdatum: 15.11.2026",
    "Rechnungsaussteller: Haus & Söhne GmbH",
    "Aussteller: Uferweg & Ring 12, 12345 Berlin, DE",
    "Aussteller USt-ID: DE123456789",
    "Rechnungsempfänger: Kunde <Partner> UG",
    "Empfänger: Marktstraße 1, 54321 Bremen, DE",
    "Beratungsleistung & Audit 2 x 80,00 = 160,00 EUR netto",
    "Umsatzsteuer 19%: 30,40 EUR",
    "Nettosumme: 160,00 EUR",
    "Gesamtbetrag: 190,40 EUR",
    "Zahlbetrag: 190,40 EUR",
]

def pdf_text(value: str) -> bytes:
    encoded = value.encode("cp1252")
    return encoded.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def make_pdf() -> bytes:
    content = b"".join(
        b"BT /F1 12 Tf 42 " + str(750 - i * 24).encode("ascii") +
        b" Td (" + pdf_text(line) + b") Tj ET\n"
        for i, line in enumerate(LINES)
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(content)).encode("ascii") +
        b" >>\nstream\n" + content + b"endstream",
    ]
    data = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += str(index).encode("ascii") + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(data)
    data += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")
    for offset in offsets[1:]:
        data += f"{offset:010d} 00000 n \n".encode("ascii")
    data += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode("ascii")
    return bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    args.destination.write_bytes(make_pdf())


if __name__ == "__main__":
    main()
