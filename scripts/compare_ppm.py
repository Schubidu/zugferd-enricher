#!/usr/bin/env python3
"""Report exact rendered-PDF pixel differences in a deterministic P6 PPM pair.

This diagnostic is not proof of visual fidelity at another DPI or in Safari.
A nonzero exit status means an exact mismatch. No tolerance or data upload.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def read_ppm(path: Path) -> tuple[int, int, bytes]:
    with path.open("rb") as source:
        if source.readline() != b"P6\n":
            raise ValueError("Expected Poppler P6 PPM output")
        dimensions = source.readline().split()
        if len(dimensions) != 2:
            raise ValueError("Invalid PPM dimensions")
        width, height = map(int, dimensions)
        if width < 1 or height < 1 or width * height > 25_000_000:
            raise ValueError("Unsafe PPM image size")
        if source.readline() != b"255\n":
            raise ValueError("Expected 8-bit RGB")
        pixels = source.read()
        if len(pixels) != width * height * 3:
            raise ValueError("Truncated or unexpected PPM data")
        return width, height, pixels


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("original", type=Path)
    parser.add_argument("derivative", type=Path)
    args = parser.parse_args()
    before = read_ppm(args.original)
    after = read_ppm(args.derivative)
    if before[:2] != after[:2]:
        print(f"MISMATCH: page dimensions {before[:2]} != {after[:2]}")
        return 2
    changed_channels = sum(left != right for left, right in zip(before[2], after[2]))
    changed_pixels = sum(
        before[2][i:i + 3] != after[2][i:i + 3]
        for i in range(0, len(before[2]), 3)
    )
    pixels = before[0] * before[1]
    percent = 100 * changed_pixels / pixels
    print(
        f"Rendered diff: {changed_pixels}/{pixels} pixels "
        f"({percent:.6f}%), {changed_channels} RGB channels"
    )
    return 0 if changed_pixels == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
