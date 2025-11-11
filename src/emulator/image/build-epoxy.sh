#!/usr/bin/env bash
set -euo pipefail

cd ../../../submodules/epoxy-tls/server/ || exit 1
cargo build --release --target i686-unknown-linux-gnu --features twisp
cp ../target/i686-unknown-linux-gnu/release/epoxy-server ../../../src/emulator/image/assets/
