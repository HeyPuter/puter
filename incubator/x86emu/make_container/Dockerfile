FROM library/node:lts-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y nodejs nasm gdb unzip p7zip-full openjdk-17-jre wget python3 qemu-system-x86 git git-core build-essential libc6-dev-i386-cross libc6-dev-i386 clang curl time

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
RUN /root/.cargo/bin/rustup toolchain install stable && \
    /root/.cargo/bin/rustup target add wasm32-unknown-unknown && \
    /root/.cargo/bin/rustup component add rustfmt-preview && \
    /root/.cargo/bin/rustup update && /root/.cargo/bin/rustup update nightly

RUN git clone https://github.com/copy/v86

WORKDIR /app/v86

ENV PATH="$PATH:/root/.cargo/bin"

RUN make all
