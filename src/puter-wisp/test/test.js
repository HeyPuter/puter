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

(async () => {
    const stream_behaviors = [
        NewTestByteStream,
        NewTestFullByteStream,
    ];
    for ( const stream_behavior of stream_behaviors ) {
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
    }
})();