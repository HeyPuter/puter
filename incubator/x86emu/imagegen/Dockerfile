FROM i386/debian:buster

ENV DEBIAN_FRONTEND noninteractive

# Update and install necessary packages
RUN apt update && \
    apt --yes --no-install-recommends install \
        linux-image-686 grub2 systemd \
        libterm-readline-perl-perl \
        gcc make libc6-dev \
        unzip bzip2 xz-utils \
        fluxbox \
        i3-wm \
		cmake \
		fuse \
        xorg xserver-xorg-input-kbd xserver-xorg-input-mouse xserver-xorg-input-evdev \
        xserver-xorg-video-fbdev xserver-xorg-video-vesa \
        xserver-xorg x11-xserver-utils xinit dbus-x11 \
        libgdk-pixbuf2.0 libpango-1.0 libpangocairo-1.0 libgtk2.0-bin \
        libc-l10n locales \
        fonts-noto fonts-droid-fallback \
        strace file xterm vim apt-file \
        dhcpcd5 \
		ca-certificates \
		git \
        wget curl \
        net-tools netcat \
        wmctrl xdotool \
		libssl-dev \
        mesa-utils libgl1-mesa-dri \
    && \
    touch /root/.Xdefaults && \
    echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen && \
    locale-gen && \
    echo 'LANG="en_US.UTF-8"' > /etc/default/locale && \
    chsh -s /bin/bash && \
    echo "root:root" | chpasswd && \
    mkdir -p /etc/systemd/system/serial-getty@ttyS0.service.d/ && \
    systemctl enable serial-getty@ttyS0.service && \
    rm /lib/systemd/system/getty.target.wants/getty-static.service && \
    rm /etc/motd /etc/issue && \
    systemctl disable systemd-timesyncd.service && \
    systemctl disable apt-daily.timer && \
    systemctl disable apt-daily-upgrade.timer && \
    systemctl disable dhcpcd.service && \
    echo "tmpfs /tmp tmpfs nodev,nosuid 0 0" >> /etc/fstab && \
    cd /root/ && \
    wget http://www.math.utah.edu/~mayer/linux/nbench-byte-2.2.3.tar.gz && \
    tar xfv nbench-byte-2.2.3.tar.gz && \
    rm nbench-byte-2.2.3.tar.gz && \
    mv nbench-byte-2.2.3 bench && \
    cd bench && \
    make

# Copy necessary configuration files
COPY getty-noclear.conf getty-override.conf /etc/systemd/system/getty@tty1.service.d/
COPY getty-autologin-serial.conf /etc/systemd/system/serial-getty@ttyS0.service.d/
COPY logind.conf /etc/systemd/logind.conf
# COPY xinitrc /root/.xinitrc
COPY xorg.conf /etc/X11/
COPY networking.sh /root/
COPY boot-9p /etc/initramfs-tools/scripts/boot-9p

# this needs to be commented out in order to boot from hdd
RUN printf '%s\n' 9p 9pnet 9pnet_virtio virtio virtio_ring virtio_pci | tee -a /etc/initramfs-tools/modules && \
    echo 'BOOT=boot-9p' | tee -a /etc/initramfs-tools/initramfs.conf && \
    update-initramfs -u

# Clean up unnecessary files
RUN apt-get --yes clean && \
    rm -r /var/lib/apt/lists/* && \
    rm -r /usr/share/doc/* && \
    rm -r /usr/share/man/* && \
    rm -r /usr/share/locale/?? && \
    rm /var/log/*.log /var/log/lastlog /var/log/wtmp /var/log/apt/*.log /var/log/apt/*.xz

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh
RUN chmod +x /root/networking.sh

# Install Go and puter-fuse
RUN wget https://go.dev/dl/go1.22.1.linux-386.tar.gz && \
    tar -C /usr/local -xzf go1.22.1.linux-386.tar.gz && \
    rm go1.22.1.linux-386.tar.gz && \
	export PATH=$PATH:/usr/local/go/bin && \
    go install github.com/HeyPuter/puter-fuse@v1.0.0 && \ 
	mv /root/go/bin/puter-fuse /usr/local/bin && \
	rm -rf /root/go && \
	rm -f /go1.22.1.linux-386.tar.gz

RUN echo "kernel.printk = 3 4 1 3" >>/etc/sysctl.conf
