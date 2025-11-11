#!/usr/bin/env bash
set -euo pipefail

if ! which cross >/dev/null 2>&1; then
	echo "install https://github.com/cross-rs/cross to build epoxy with the simple script"
	exit 1
fi

cd ../../../submodules/epoxy-tls/server/ || exit 1
# -lgcc is needed for __ffsdi2
RUSTFLAGS="-Clink-args=-lgcc" cross build --release --target i686-unknown-linux-musl --features twisp
cp ../target/i686-unknown-linux-musl/release/epoxy-server ../../../src/emulator/image/assets/
