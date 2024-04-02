#!/usr/bin/env bash

ROOT_DIR="$(pwd)"

mkdir -p "$ROOT_DIR/vm"
cd "$ROOT_DIR/vm" || exit
docker build . -t v86builder
docker run --name v86build v86builder
mkdir -p "$ROOT_DIR/vm/v86"
docker cp v86build:/app/v86 "$ROOT_DIR/vm/"
docker rm v86build

# Overwrite v86'd debian Dockerfile with our own
cat "$ROOT_DIR/imagegen/Dockerfile" > "$ROOT_DIR/vm/v86/tools/docker/debian/Dockerfile"

# Navigate to the Dockerfile directory
cd "$ROOT_DIR/vm/v86/tools/docker/debian" || exit

# Build the container which will be used to serve v86
chmod +x build-container.sh
./build-container.sh

# Build the state of the VM
chmod +x build-state.js
./build-state.js

# Make project directories
mkdir -p "$ROOT_DIR/www/third-party"
mkdir -p "$ROOT_DIR/www/static"

# Copy necessary files to deployment directory
cp "$ROOT_DIR/vm/v86/build/libv86.js" "$ROOT_DIR/www/third-party/libv86.js"
cp "$ROOT_DIR/vm/v86/build/v86.wasm" "$ROOT_DIR/www/third-party/v86.wasm"
cp "$ROOT_DIR/vm/v86/static/debian-state-base.bin" "$ROOT_DIR/www/images/image.bin"
cp -r "$ROOT_DIR/vm/v86/static/debian-9p-rootfs-flat/" "$ROOT_DIR/www/images/9p-rootfs/"

# Start a HTTP server
cd "$ROOT_DIR/www/" || exit
echo "Opening a server on port 8080"
python3 -m http.server 8080
