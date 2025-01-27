/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

"use strict";

console.log(`emulator running in mode: ${MODE}`)

// Set this to true when testing progress messages
const GRACE_PERIOD_ENABLED = false;

const PATH_V86 = MODE === 'dev' ? '/vendor/v86' : './vendor/v86';

const { XDocumentPTT } = require("../../phoenix/src/pty/XDocumentPTT");
const {
    NewWispPacketStream,
    WispPacket,
    NewCallbackByteStream,
    NewVirtioFrameStream,
    DataBuilder,
} = require("../../puter-wisp/src/exports");

const brotliCJS = require('brotli-dec-wasm');

const state = {
    ready_listeners: [],
};

const UPDATE_ONLY = Symbol('update-only');

const status = {
    ready: false,
    // phase: 'setup',
    set phase (v) {
        const prev_phase = this._phase;
        this._phase = v;
        const time_since = Date.now() - this.ts_lastphase;
        this.ts_lastphase = Date.now();
        if ( this._phase_progress !== 0 ) {
            this._phase_progress = undefined;
        }
        console.log(`[status] ${prev_phase} -> ${v} (${time_since}ms)`);
        for ( const listener of state.ready_listeners ) {
            console.log('calling listener');
            listener();
        }
    },
    get phase () {
        return this._phase;
    },
    set phase_progress (v) {
        if ( v !== UPDATE_ONLY ) {
            this._phase_progress = v;
            console.log(`[status] progress: ${v}`);
        }
        for ( const listener of state.ready_listeners ) {
            listener();
        }
    },
    get phase_progress () {
        if ( this.ts_phase_end ) {
            const total = this.ts_phase_end - this.ts_lastphase;
            const progress = Date.now() - this.ts_lastphase;
            return Math.min(1, progress / total);
        }
        return this._phase_progress;
    },
    ts_start: Date.now(),
};

let ptyMgr;

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

const setup_pty = (ptt, pty) => {
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
            console.log('sending to pty', chunk);
            pty.send(chunk);
        }
    })()
}

let TUX_SIXEL; (async () => {
    const resp = await fetch('./static/tux.sixel');
    const text = await resp.text();
    TUX_SIXEL = text;
})();

puter.ui.on('connection', event => {
    const { conn, accept, reject } = event;
    if ( ! status.ready ) {
        console.log('status not ready, adding listener');
        state.ready_listeners.push(() => {
            console.log('a listener was called');
            conn.postMessage({
                $: 'status',
                ...status,
            });
        });
    }
    accept({
        version: '1.0.0',
        status,
        logo: TUX_SIXEL,
    });
    console.log('emulator got connection event', event);

    const pty_on_first_message = message => {
        conn.off('message', pty_on_first_message);
        console.log('[!!] message from connection', message);
        const pty = ptyMgr.getPTY({
            command: message.command,
        });
        pty.on_close = () => {
            conn.postMessage({
                $: 'pty.close',
            });
        }
        console.log('setting up ptt with...', conn);
        const ptt = new XDocumentPTT(conn, {
            disableReader: true,
        });
        ptt.termios.echo = false;
        setup_pty(ptt, pty);
    }
    conn.on('message', pty_on_first_message);
});

const bench = async ({ modules }) => {
    const { benchmark } = modules.bench;
    const ts_start = performance.now();
    benchmark();
    const ts_end = performance.now();
    // console.log('benchmark took', ts_end - ts_start);
    return ts_end - ts_start;
}

const bench_20ms = async (ctx) => {
    let ts = 0, count = 0;
    for (;;) {
        ts += await bench(ctx);
        count++;
        if ( ts > 20 ) {
            return count;
        }
    }
}

window.onload = async function()
{
    const modules = {};
    modules.bench = (await WebAssembly.instantiateStreaming(
        fetch('./static/bench.wasm'))).instance.exports;

    const bench_factor = await bench_20ms({ modules });
    console.log('result', bench_factor);
    let emu_config; try {
        emu_config = await puter.fs.read('config.json');
    } catch (e) {}

    if ( ! emu_config ) {
        await puter.fs.write('config.json', JSON.stringify({}));
        emu_config = {};
    }

    if ( emu_config instanceof Blob ) {
        emu_config = await emu_config.text();
    }

    if ( typeof emu_config === 'string' ) {
        emu_config = JSON.parse(emu_config);
    }

    if ( GRACE_PERIOD_ENABLED ) {
        status.ts_phase_end = Date.now() + 10 * 1000;
        status.phase = 'grace-period';
        const gradePeriodProgress = setInterval(() => {
            status.phase_progress = UPDATE_ONLY;
        }, 200);
        await new Promise(resolve => setTimeout(resolve, 10 * 1000));
        clearInterval(gradePeriodProgress);
    }

    status.ts_phase_end = undefined;
    status.phase_progress = 0;
    status.phase = 'rootfs-download';
    const resp = await fetch(
        './image/build/rootfs.bin.br',
        // 'https://puter-rootfs.b-cdn.net/rootfs.bin.br',
    );
    const contentLength = resp.headers.get('content-length');
    const total = parseInt(contentLength, 10);
    const reader = resp.body.getReader();
    let downloaded = 0;
    let downloadedForProgress = 0;

    const brotli = await brotliCJS.default;
    const decompStream = new brotli.DecompressStream();

    const uint8arrays = [];
    const CAP = 2 * 1024 * 1024;
    for (;;) {
        const { done, value } = await reader.read();
        if ( done ) break;

        let resultCode;
        let inputOffset = 0;

        do {
            const input = value.slice(inputOffset);
            const result = decompStream.decompress(input, CAP);
            uint8arrays.push(result.buf);
            downloaded += result.buf.byteLength;
            resultCode = result.code;
            inputOffset += result.input_offset;
        } while ( resultCode === brotli.BrotliStreamResultCode.NeedsMoreOutput );
        const failed =
            resultCode !== brotli.BrotliStreamResultCode.NeedsMoreInput &&
            resultCode !== brotli.BrotliStreamResultCode.ResultSuccess;
        if ( failed ) {
            throw new Error('decompression failed', resultCode);
        }
        downloadedForProgress += value.byteLength;
        // uint8arrays.push(value);
        // downloaded += value.byteLength;
        status.phase_progress = downloadedForProgress / total;
    }
    // const arrayBuffer = await resp.arrayBuffer();
    
    let sizeSoFar = 0;
    const arrayBuffer = uint8arrays.reduce((acc, value) => {
        acc.set(value, sizeSoFar);
        sizeSoFar += value.byteLength;
        return acc;
    }, new Uint8Array(downloaded));
    status.phase = 'rootfs-decompress';

    /*
    const utf8Array = new Uint8Array(arrayBuffer);
    console.log('whats in here??', brotli);
    const decompressed = brotli.decompress(utf8Array);
    const decompressedArrayBuffer = decompressed.buffer;
    */
    const decompressedArrayBuffer = arrayBuffer.buffer;
    console.log('what??', decompressedArrayBuffer);

    status.ts_emu_start = Date.now();
    status.ts_phase_end = status.ts_emu_start + bench_factor * 0.48;
    status.phase = 'boot';

    const boot_progress_tick = setInterval(() => {
        status.phase_progress = UPDATE_ONLY;
    }, 200);
        
    console.log("starting v86")
    var emulator = window.emulator = new V86({
        wasm_path: PATH_V86 + "/v86.wasm",
        memory_size: 512 * 1024 * 1024,
        filesystem: { fs: puter.fs },
        vga_memory_size: 2 * 1024 * 1024,
        screen_container: document.getElementById("screen_container"),
        bios: {
            url: PATH_V86 + "/bios/seabios.bin",
        },
        vga_bios: {
            url: PATH_V86 + "/bios/vgabios.bin",
        },
        
        initrd: {
            url: './image/build/boot/initramfs-virt',
        },
        bzimage: {
            url: './image/build/boot/vmlinuz-virt',
            async: false
        },
        cmdline: 'rw root=/dev/sda init=/sbin/init rootfstype=ext4 puterusername=' + (await puter.getUser()).username,
        // cmdline: 'rw root=/dev/sda init=/bin/bash rootfstype=ext4',
        // cmdline: "rw init=/sbin/init root=/dev/sda rootfstype=ext4",
        // cmdline: "rw init=/sbin/init root=/dev/sda rootfstype=ext4 random.trust_cpu=on 8250.nr_uarts=10 spectre_v2=off pti=off mitigations=off",
        
        // cdrom: {
        //     // url: "../images/al32-2024.07.10.iso",
        //     url: "./image/build/rootfs.bin",
        // },
        hda: {
            buffer: decompressedArrayBuffer,
            // url: './image/build/rootfs.bin',
            async: true,
            // size: 1073741824,
            // size: 805306368,
        },
        // bzimage_initrd_from_filesystem: true,
        autostart: true,
        net_device: {
            relay_url: emu_config.network_relay ?? "wisp://127.0.0.1:4000",
            type: "virtio"
        },
        virtio_console: true,
    });

    emulator.add_listener('download-error', function(e) {
        status.missing_files || (status.missing_files = []);
        status.missing_files.push(e.file_name);
    });
    
    const decoder = new TextDecoder();
    const byteStream = NewCallbackByteStream();
    emulator.add_listener('virtio-console0-output-bytes',
        byteStream.listener);
    const virtioStream = NewVirtioFrameStream(byteStream);
    const wispStream = NewWispPacketStream(virtioStream);

    /*
    const shell = puter.ui.parentApp();
    const ptt = new XDocumentPTT(shell, {
        disableReader: true,
    })

    ptt.termios.echo = false;
    */
    
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
                },
                [WispPacket.CLOSE.id]: function ({ packet }) {
                    const pty = this.stream_listeners_[packet.streamId];
                    pty.on_close();
                }
            },
            on: function () {
                console.log('ready.on called')
                clearInterval(boot_progress_tick);
                status.ts_end = Date.now();
                console.log(`Emulator boot time: ${status.ts_emu_start - status.ts_start}s`);
                console.log(`Emulator total time: ${status.ts_end - status.ts_start}s`);
                status.ready = true;
                status.phase = 'ready';
                return;
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

        getPTY ({ command }) {
            const streamId = ++this.streamId;
            const data = new DataBuilder({ leb: true })
                .uint8(0x01)
                .uint32(streamId)
                .uint8(0x03)
                .uint16(10)
                .utf8(command)
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
    
    ptyMgr = new PTYManager({
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
