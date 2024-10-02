#!/usr/bin/env bash
set -veu

if [ -w /var/run/docker.sock ]
then
    echo true
else 
    echo "You aren't in the docker group, please run usermod -a -G docker $USER && newgrp docker"
    exit 2
fi


IMAGES="$(dirname "$0")"/build
OUT_ROOTFS_TAR="$IMAGES"/rootfs.tar
OUT_ROOTFS_BIN="$IMAGES"/rootfs.bin
OUT_ROOTFS_MNT="$IMAGES"/rootfs.mntpoint
CONTAINER_NAME=alpine-full
IMAGE_NAME=i386/alpine-full

rm -rf $OUT_ROOTFS_BIN || :

mkdir -p "$IMAGES"
docker build . --platform linux/386 --rm --tag "$IMAGE_NAME"
docker rm "$CONTAINER_NAME" || true
docker create --platform linux/386 -t -i --name "$CONTAINER_NAME" "$IMAGE_NAME" bash

docker export "$CONTAINER_NAME" > "$OUT_ROOTFS_TAR"
dd if=/dev/zero "of=$OUT_ROOTFS_BIN" bs=512M count=3

loop=$(sudo losetup -f)
sudo losetup -P "$loop" "$OUT_ROOTFS_BIN"
sudo mkfs.ext4 "$loop"
mkdir -p "$OUT_ROOTFS_MNT"
sudo mount "$loop" "$OUT_ROOTFS_MNT"

sudo tar -xf "$OUT_ROOTFS_TAR" -C "$OUT_ROOTFS_MNT"
sudo cp -r "$OUT_ROOTFS_MNT/boot" "$IMAGES/boot"

sudo umount "$loop"
sudo losetup -d "$loop"
rm "$OUT_ROOTFS_TAR"
rm -rf "$OUT_ROOTFS_MNT"

cd "$IMAGES"
brotli -q 6 rootfs.bin
cd -

echo "done! created"
sudo chown -R $USER:$USER $IMAGES/boot
