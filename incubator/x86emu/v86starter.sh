#!/usr/bin/env bash

ROOT_DIR="$(pwd)"

# This has to be something, that isn't wrapped by a repo with a package.json
VM_DIR="/tmp/vm"

# Goes from 1 to 22
ZSTD_LEVEL=22

build()
{
	mkdir -p "$VM_DIR"
	rm -rf "$VM_DIR/v86"
	cd "$ROOT_DIR/make_container" || exit
	docker build . -t v86builder
	docker run --name v86build v86builder
	docker cp v86build:/app/v86 "$VM_DIR"
	docker rm v86build

	# Overwrite v86'd debian Dockerfile with our own
	cat "$ROOT_DIR/imagegen/Dockerfile" > "$VM_DIR/v86/tools/docker/debian/Dockerfile"

	# Navigate to the Dockerfile directory
	cd "$VM_DIR/v86/tools/docker/debian" || exit

	# Build the container which will be used to serve v86
	chmod +x build-container.sh
	./build-container.sh

	# Build the state of the VM
	chmod +x build-state.js
	./build-state.js

	# Compress the generated state image
	zstd --ultra -$ZSTD_LEVEL < "$VM_DIR/v86/images/debian-state-base.bin" > "$VM_DIR/v86/images/image.bin"

	# Make project directories
	mkdir -p "$ROOT_DIR/www/third-party"
	mkdir -p "$ROOT_DIR/www/static"

	# Copy/move necessary files to deployment directory
	mv "$VM_DIR/v86/images/image.bin" "$ROOT_DIR/www/static/image.bin"
	cp "$VM_DIR/v86/build/libv86.js" "$ROOT_DIR/www/third-party/libv86.js"
	cp "$VM_DIR/v86/build/v86.wasm" "$ROOT_DIR/www/third-party/v86.wasm"
	cp -r "$VM_DIR/v86/images/debian-9p-rootfs-flat/" "$ROOT_DIR/www/static/9p-rootfs/"
}

if [ ! -d "$VM_DIR/v86" ]
then
	build
else
	echo "V86 appears to be built"
	read -p "Do you want to rebuild V86? (yes/no): " rebuild_choice
	if [ "$rebuild_choice" = "yes" ]; then
		echo "Rebuilding v86..."
		build
	fi
fi

# Start a HTTP server
cd "$ROOT_DIR/www/" || exit
echo "Opening a server on localhost with port 8080"
python3 -m http.server -b 127.0.0.1 8080
