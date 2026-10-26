#!/usr/bin/env bash
# Compila o sidecar Bun num executável único com o nome que o Tauri espera
# (bull-monitor-sidecar-<target-triple>) e copia a interface do bull-board para os recursos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# O Tauri define TAURI_ENV_TARGET_TRIPLE nos before*Command; fora dele, usa o host do rustc.
TRIPLE="${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')}"
EXT=""

case "$TRIPLE" in
  x86_64-unknown-linux-gnu)  BUN_TARGET=bun-linux-x64 ;;
  aarch64-unknown-linux-gnu) BUN_TARGET=bun-linux-arm64 ;;
  x86_64-pc-windows-msvc)    BUN_TARGET=bun-windows-x64; EXT=".exe" ;;
  x86_64-apple-darwin)       BUN_TARGET=bun-darwin-x64 ;;
  aarch64-apple-darwin)      BUN_TARGET=bun-darwin-arm64 ;;
  *) echo "Alvo não suportado ou Rust não instalado: '$TRIPLE'" >&2; exit 1 ;;
esac

cd "$ROOT/sidecar"
bun install --frozen-lockfile
bun build --compile --minify --target="$BUN_TARGET" src/index.ts \
  --outfile "$ROOT/src-tauri/binaries/bull-monitor-sidecar-$TRIPLE$EXT"

UI_OUT="$ROOT/src-tauri/resources/bull-board-ui"
rm -rf "$UI_OUT"
mkdir -p "$UI_OUT"
cp -r node_modules/@bull-board/ui/dist "$UI_OUT/dist"

echo "Sidecar pronto para $TRIPLE"
