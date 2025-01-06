/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

const assert = require('assert');
const {
    NewVirtioFrameStream,
    NewWispPacketStream,
    WispPacket,
} = require('../src/exports');

const NewTestByteStream = uint8array => {
    return (async function * () {
        for ( const item of uint8array ) {
            yield Uint8Array.from([item]);
        }
    })();
};

const NewTestFullByteStream = uint8array => {
    return (async function * () {
        yield uint8array;
    })();
};

/**
 * This will send 'sz'-sized chunks of the uint8array
 * until the uint8array is exhausted. The last chunk
 * may be smaller than 'sz'.
 * @curry
 * @param {*} sz 
 * @param {*} uint8array 
 */
const NewTestWindowByteStream = sz => {
    const fn = uint8array => {
        return (async function * () {
            let offset = 0;
            while ( offset < uint8array.length ) {
                const end = Math.min(offset + sz, uint8array.length);
                const chunk = uint8array.slice(offset, end);
                offset += sz;
                yield chunk;
            }
        })();
    };
    fn.name_ = `NewTestWindowByteStream(${sz})`;
    return fn;
};

const NewTestChunkedByteStream = chunks => {
    return (async function * () {
        for ( const chunk of chunks ) {
            yield chunk;
        }
    })();
}

const test = async (name, fn) => {
    console.log(`\x1B[36;1m=== [ Running test: ${name} ] ===\x1B[0m`);
    await fn();
};

const BASH_TEST_BYTES = [
    22, 0, 0, 0, 2, 1, 0, 0, 0, 27, 91, 63, 50, 48, 48, 52, 108, 13, 27, 91, 63, 50, 48, 48, 52, 104,
    10, 0, 0, 0, 2, 1, 0, 0, 0, 40, 110, 111, 110, 101,
    10, 0, 0, 0, 2, 1, 0, 0, 0, 41, 58, 47, 35, 32,
    7,  0, 0, 0, 2, 1, 0, 0, 0, 13, 10,
    14, 0, 0, 0, 2, 1, 0, 0, 0, 27, 91, 63, 50, 48, 48, 52, 108, 13,
    17, 0, 0, 0, 2, 1, 0, 0, 0, 27, 91, 63, 50, 48, 48, 52, 104, 40, 110, 111, 110,
    11, 0, 0, 0, 2, 1, 0, 0, 0, 101, 41, 58, 47, 35, 32
]

const runit = async () => {
    const stream_behaviors = [
        NewTestByteStream,
        NewTestFullByteStream,
        NewTestWindowByteStream(2),
        NewTestWindowByteStream(3),
    ];

    for ( const stream_behavior of stream_behaviors ) {
        await test(`Wisp CONTINUE ${stream_behavior.name_ ?? stream_behavior.name}`, async () => {
            const byteStream = stream_behavior(
                Uint8Array.from([
                    9, 0, 0, 0, // size of frame: 9 bytes (u32-L)
                    3, // CONTINUE (u8)
                    0, 0, 0, 0, // stream id: 0 (u32-L)
                    0x0F, 0x0F, 0, 0, // buffer size (u32-L)
                ])
            );
            const virtioStream = NewVirtioFrameStream(byteStream);
            const wispStream = NewWispPacketStream(virtioStream);

            const packets = [];
            for await ( const packet of wispStream ) {
                packets.push(packet);
            }

            assert.strictEqual(packets.length, 1);
            const packet = packets[0];
            assert.strictEqual(packet.type.id, 3);
            assert.strictEqual(packet.type.label, 'CONTINUE');
            assert.strictEqual(packet.type, WispPacket.CONTINUE);
        });
    }

    await test('bash prompt chunking', async () => {
        const byteStream = NewTestChunkedByteStream([
            // These are data frames from virtio->twisp->bash
            // "(none"
            Uint8Array.from([
                10, 0, 0, 0, 2, 1, 0, 0, 0,
                    40, 110, 111, 110, 101
            ]),
            // "):/# "
            Uint8Array.from([
                10, 0, 0, 0, 2, 1, 0, 0, 0,
                    41, 58, 47, 35, 32,
            ]),
        ]);
        const virtioStream = NewVirtioFrameStream(byteStream);
        const wispStream = NewWispPacketStream(virtioStream);

        const data = [];
        for await ( const packet of wispStream ) {
            for ( const item of packet.payload ) {
                data.push(item);
            }
        }

        const expected = [
            40, 110, 111, 110, 101,
            41, 58, 47, 35, 32,
        ];

        assert.strictEqual(data.length, expected.length);
        for ( let i = 0; i < data.length; i++ ) {
            assert.strictEqual(data[i], expected[i]);
        }
    });
};

(async () => {
    try {
        await runit();
    } catch (e) {
        console.error(e);
        console.log(`\x1B[31;1mTest Failed\x1B[0m`);
        process.exit(1);
    }
    console.log(`\x1B[32;1mAll tests passed\x1B[0m`);
})();