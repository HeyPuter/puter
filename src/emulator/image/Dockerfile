FROM i386/alpine:edge

RUN  apk add --update \
        alpine-base bash ncurses shadow curl \
        linux-lts linux-firmware-none linux-headers \
        gcc make gcompat musl-dev libx11-dev xinit \
        bind-tools \
        util-linux \
        htop vim nano \
    && \
    setup-xorg-base xhost xterm xcalc xdotool xkill || true && \
    setup-devd udev || true && \
    touch /root/.Xdefaults && \
    rm /etc/motd /etc/issue && \
    passwd -d root && \
    chsh -s /bin/bash

RUN apk add neofetch
    
COPY basic-boot /etc/init.d/
RUN chmod +x /etc/init.d/basic-boot

COPY assets/twisp /bin/twisp
RUN chmod u+x /bin/twisp
COPY twisp-service /etc/init.d/
RUN chmod +x /etc/init.d/twisp-service
RUN rc-update add twisp-service default

COPY debug-service /etc/init.d/
RUN chmod +x /etc/init.d/debug-service
RUN rc-update add debug-service default

COPY initd/network-service /etc/init.d/
RUN chmod +x /etc/init.d/network-service
RUN rc-update add network-service default

# setup init system
# COPY rc.conf /etc/rc.conf
RUN rc-update add dmesg sysinit
RUN rc-update add basic-boot sysinit

RUN rc-update add root boot
RUN rc-update add localmount boot
RUN rc-update add modules boot
RUN rc-update add sysctl boot
RUN rc-update add bootmisc boot
RUN rc-update add syslog boot

RUN rc-update add mount-ro shutdown
RUN rc-update add killprocs shutdown
RUN rc-update add savecache shutdown

COPY rootfs/ /

RUN bash