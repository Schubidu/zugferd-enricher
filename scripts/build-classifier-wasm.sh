#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Rust 1.89 and the checked-in Cargo.lock ensure the same dependencies.
cargo +1.89.0 build --release --locked --target wasm32-unknown-unknown \
  --manifest-path rust/invoice-classifier/Cargo.toml
cp rust/invoice-classifier/target/wasm32-unknown-unknown/release/invoice_classifier.wasm \
  public/models/fasttext-rust-v1.wasm
