
#!/bin/bash

start_dir=$(pwd)
cleanup() {
    cd "$start_dir"
}
trap cleanup ERR EXIT
set -e

echo -e "\x1B[36;1m<<< Building epoxy-tls >>>\x1B[0m"

cd submodules/epoxy-tls
rustup install nightly
rustup override set nightly
cargo b -r
cd -
