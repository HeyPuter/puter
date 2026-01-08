#!/bin/bash

start_dir=$(pwd)
cleanup() {
    cd "$start_dir"
}
trap cleanup ERR EXIT
set -e

echo -e "\x1B[36;1m<<< Adding Targets >>>\x1B[0m"

rustup target add wasm32-unknown-unknown
rustup target add i686-unknown-linux-gnu

# Emulator assets were removed from this fork; exit early to avoid failing.
if [ ! -d "src/emulator" ]; then
    echo -e "\x1B[33;1mEmulator directory missing; skipping v86 image build.\x1B[0m"
    exit 0
fi

echo -e "\x1B[36;1m<<< Building v86 >>>\x1B[0m"

cd submodules/v86
make all
cd -

echo -e "\x1B[36;1m<<< Building Twisp >>>\x1B[0m"

pwd
cd submodules/epoxy-tls/server

RUSTFLAGS="-C target-feature=+crt-static" cargo +nightly b -F twisp -r --target i686-unknown-linux-gnu; 

echo -e "\x1B[36;1m<<< Preparing to Build Imag >>>\x1B[0m"

cd -
cp submodules/epoxy-tls/target/i686-unknown-linux-gnu/release/epoxy-server \
    src/emulator/image/assets/

echo -e "\x1B[36;1m<<< Building Image >>>\x1B[0m"

cd src/emulator/image
./clean.sh
./build.sh
cd -
