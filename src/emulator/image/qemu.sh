qemu-system-i386 \
    -kernel ./build/x86images/boot/vmlinuz-lts \
    -initrd ./build/x86images/boot/initramfs-lts \
    -append "rw root=/dev/sda console=ttyS0 init=/sbin/init rootfstype=ext4" \
    -hda ./build/x86images/rootfs.bin \
    -m 1024M \
    -nographic
