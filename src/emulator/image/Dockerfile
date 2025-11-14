FROM i386/alpine:edge

RUN  apk add --update \
        alpine-base bash ncurses shadow curl \
        linux-virt linux-firmware-none linux-headers \
        gcc make gcompat musl-dev libx11-dev xinit \
        bind-tools \
        util-linux \
        htop vim nano jq \
    && \
    setup-xorg-base xhost xterm xcalc xdotool xkill || true && \
    setup-devd udev || true && \
    touch /root/.Xdefaults && \
    rm /etc/motd /etc/issue && \
    passwd -d root && \
    chsh -s /bin/bash

# programming language tools
RUN apk add --no-cache \
    nodejs npm \
    php \
    perl \
    go

# Fun packages
RUN apk add cowsay --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing/

# Shell
RUN apk add zsh sudo git libgit2

COPY rootfs/ /
    
COPY basic-boot /etc/init.d/
RUN chmod +x /etc/init.d/basic-boot

COPY assets/epoxy-server /bin/epoxy-server
RUN chmod u+x /bin/epoxy-server

RUN chmod +x /etc/init.d/puter-save-daemon

RUN rc-update add twisp-service default
RUN rc-update add puter-save-daemon default

RUN rc-update add debug-service default

RUN chmod +x /etc/init.d/network-service
RUN rc-update add network-service default

# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# ENV PATH="/root/.cargo/bin:${PATH}"
# RUN rustup default nightly

# setup init system
# COPY rc.conf /etc/rc.conf
RUN \
    rc-update add dmesg sysinit && \
    rc-update add basic-boot sysinit && \
    rc-update add root boot && \
    rc-update add localmount boot && \
    rc-update add modules boot && \
    rc-update add sysctl boot && \
    rc-update add bootmisc boot && \
    rc-update add syslog boot && \
    rc-update add mount-ro shutdown && \
    rc-update add killprocs shutdown && \
    rc-update add savecache shutdown

RUN mkdir /root/Downloads

# Setup user
RUN useradd -m -s /bin/zsh puter-user
RUN usermod -aG wheel puter-user
RUN echo "puter-user:changeme" | chpasswd
RUN echo '%wheel ALL=(ALL) ALL' > /etc/sudoers.d/wheel

# CLI Configuration
# -- install powerlevel10k
RUN mkdir /puter
RUN mkdir /repos
# RUN git clone --depth=1 https://github.com/romkatv/powerlevel10k.git /repos/powerlevel10k
# RUN echo "source /repos/powerlevel10k/powerlevel10k.zsh-theme" >> /root/.zshrc
RUN echo "export COLORTERM=truecolor" >> /root/.bashrc
RUN echo "export COLORTERM=truecolor" >> /root/.zshrc

RUN echo "export TERM=xterm-256color" >> /root/.bashrc
RUN echo "export TERM=xterm-256color" >> /root/.zshrc

RUN echo "export LC_ALL=en_US.UTF-8" >> /root/.bashrc
RUN echo "export LC_ALL=en_US.UTF-8" >> /root/.zshrc

# RUN echo "source /repos/powerlevel10k/powerlevel10k.zsh-theme" >> /home/puter-user/.zshrc
RUN echo "export PS1='(\$?) [\u@puter:\$(basename \$(tty)) \w] \\033[36;1m❯\\033[0m '" >> /root/.bashrc
RUN echo "setopt PROMPT_SUBST" >> /root/.zshrc
RUN echo "export PROMPT='(%?) [%n@puter:\$(basename \$(tty)) %~] ❯ '" >> /root/.zshrc

RUN echo "/etc/puter-motd" >> /root/.bashrc
RUN echo "/etc/puter-motd" >> /root/.zshrc

RUN cp /root/.zshrc /home/puter-user/.zshrc
RUN cp /root/.bashrc /home/puter-user/.bashrc

RUN chmod +x /bin/puter-save
RUN chmod +x /bin/puter-save-daemon
RUN chmod +x /bin/puter-restore
RUN chmod +x /etc/apk/commit_hooks.d/puter.sh

RUN bash
