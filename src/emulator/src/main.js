"use strict";

const { XDocumentPTT } = require("../../phoenix/src/pty/XDocumentPTT");
const {
    NewWispPacketStream,
    WispPacket,
    NewCallbackByteStream,
    NewVirtioFrameStream,
    DataBuilder,
} = require("../../puter-wisp/src/exports");

class WispClient {
    constructor ({
        packetStream,
        sendFn,
    }) {
        this.packetStream = packetStream;
        this.sendFn = sendFn;
    }
    send (packet) {
        packet.log();
        this.sendFn(packet);
    }
}

window.onload = async function()
{
    const resp = await fetch(
        './image/build/rootfs.bin'
    );
    const arrayBuffer = await resp.arrayBuffer();
    var emulator = window.emulator = new V86({
        wasm_path: "/vendor/v86/v86.wasm",
        memory_size: 512 * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        screen_container: document.getElementById("screen_container"),
        bios: {
            url: "/vendor/v86/bios/seabios.bin",
        },
        vga_bios: {
            url: "/vendor/v86/bios/vgabios.bin",
        },
        
        initrd: {
            url: './image/build/boot/initramfs-lts',
        },
        bzimage: {
            url: './image/build/boot/vmlinuz-lts',
            async: false
        },
        cmdline: 'rw root=/dev/sda init=/sbin/init rootfstype=ext4',
        // cmdline: 'rw root=/dev/sda init=/bin/bash rootfstype=ext4',
        // cmdline: "rw init=/sbin/init root=/dev/sda rootfstype=ext4",
        // cmdline: "rw init=/sbin/init root=/dev/sda rootfstype=ext4 random.trust_cpu=on 8250.nr_uarts=10 spectre_v2=off pti=off mitigations=off",
        
        // cdrom: {
        //     // url: "../images/al32-2024.07.10.iso",
        //     url: "./image/build/rootfs.bin",
        // },
        hda: {
            buffer: arrayBuffer,
            // url: './image/build/rootfs.bin',
            async: true,
            // size: 1073741824,
            // size: 805306368,
        },
        // bzimage_initrd_from_filesystem: true,
        autostart: true,

        network_relay_url: "wisp://127.0.0.1:3000",
        virtio_console: true,
    });

    
    const decoder = new TextDecoder();
    const byteStream = NewCallbackByteStream();
    emulator.add_listener('virtio-console0-output-bytes',
        byteStream.listener);
    const virtioStream = NewVirtioFrameStream(byteStream);
    const wispStream = NewWispPacketStream(virtioStream);

    const shell = puter.ui.parentApp();
    const ptt = new XDocumentPTT(shell, {
        disableReader: true,
    })

    ptt.termios.echo = false;
    
    class PTYManager {
        static STATE_INIT = {
            name: 'init',
            handlers: {
                [WispPacket.INFO.id]: function ({ packet }) {
                    this.client.send(packet.reflect());
                    this.state = this.constructor.STATE_READY;
                }
            }
        };
        static STATE_READY = {
            name: 'ready',
            handlers: {
                [WispPacket.DATA.id]: function ({ packet }) {
                    console.log('stream id?', packet.streamId);
                    const pty = this.stream_listeners_[packet.streamId];
                    pty.on_payload(packet.payload);
                }
            },
            on: function () {
                const pty = this.getPTY();
                console.log('PTY created', pty);

                // resize
                ptt.on('ioctl.set', evt => {
                    console.log('event?', evt);
                    pty.resize(evt.windowSize);
                });
                ptt.TIOCGWINSZ();

                // data from PTY
                pty.on_payload = data => {
                    ptt.out.write(data);
                }

                // data to PTY
                (async () => {
                    // for (;;) {
                    //     const buff = await ptt.in.read();
                    //     if ( buff === undefined ) continue;
                    //     console.log('this is what ptt in gave', buff);
                    //     pty.send(buff);
                    // }
                    const stream = ptt.readableStream;
                    for await ( const chunk of stream ) {
                        if ( chunk === undefined ) {
                            console.error('huh, missing chunk', chunk);
                            continue;
                        }
                        pty.send(chunk);
                    }
                })()
            },
        }

        set state (value) {
            console.log('[PTYManager] State updated: ', value.name);
            this.state_ = value;
            if ( this.state_.on ) {
                this.state_.on.call(this)
            }
        }
        get state () { return this.state_ }

        constructor ({ client }) {
            this.streamId = 0;
            this.state_ = null;
            this.client = client;
            this.state = this.constructor.STATE_INIT;
            this.stream_listeners_ = {};
        }
        init () {
            this.run_();
        }
        async run_ () {
            for await ( const packet of this.client.packetStream ) {
                const handlers_ = this.state_.handlers;
                if ( ! handlers_[packet.type.id] ) {
                    console.error(`No handler for packet type ${packet.type.id}`);
                    console.log(handlers_, this);
                    continue;
                }
                handlers_[packet.type.id].call(this, { packet });
            }
        }

        getPTY () {
            const streamId = ++this.streamId;
            const data = new DataBuilder({ leb: true })
                .uint8(0x01)
                .uint32(streamId)
                .uint8(0x03)
                .uint16(10)
                .utf8('/bin/bash')
                // .utf8('/usr/bin/htop')
                .build();
            const packet = new WispPacket(
                { data, direction: WispPacket.SEND });
            this.client.send(packet);
            const pty = new PTY({ client: this.client, streamId });
            console.log('setting to stream id', streamId);
            this.stream_listeners_[streamId] = pty;
            return pty;
        }
    }

    class PTY {
        constructor ({ client, streamId }) {
            this.client = client;
            this.streamId = streamId;
        }

        on_payload (data) {

        }

        send (data) {
            // convert text into buffers
            if ( typeof data === 'string' ) {
                data = (new TextEncoder()).encode(data, 'utf-8')
            }
            data = new DataBuilder({ leb: true })
                .uint8(0x02)
                .uint32(this.streamId)
                .cat(data)
                .build();
            const packet = new WispPacket(
                { data, direction: WispPacket.SEND });
            this.client.send(packet);
        }

        resize ({ rows, cols }) {
            console.log('resize called!');
            const data = new DataBuilder({ leb: true })
                .uint8(0xf0)
                .uint32(this.streamId)
                .uint16(rows)
                .uint16(cols)
                .build();
            const packet = new WispPacket(
                { data, direction: WispPacket.SEND });
            this.client.send(packet);
        }
    }
    
    const ptyMgr = new PTYManager({
        client: new WispClient({
            packetStream: wispStream,
            sendFn: packet => {
                const virtioframe = packet.toVirtioFrame();
                console.log('virtio frame', virtioframe);
                emulator.bus.send(
                    "virtio-console0-input-bytes",
                    virtioframe,
                );
            }
        })
    });
    ptyMgr.init();
}
