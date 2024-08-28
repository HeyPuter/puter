# Wisp Utilities

This is still a work in progress. Thes utilities use my own stream interface
to avoid browser/node compatibility issues and because I found it more
convenient. These streams can by used as async iterator objects just like
other conventional implementations. Currently there is no logic for closing
streams or knowing if a stream has been closed, but this is planned.

## Classes and Factory Functions

### WispPacket (class)

Wraps a Uint8Array containing a Wisp packet. `data` should be a Uint8Array
containing only the Wisp frame, starting at the Packet Type and ending at
the last byte of the payload (inclusive).

```javascript
const packet = new WispPacket({
    data: new Uint8Array(...),
    direction: WispPacket.SEND, // or RECV

    // `extra` is optional, for debugging
    extra: { some: 'value', },
});

packet.type; // ex: WispPacket.CONTINUE
```

#### Methods

- `describe()` - outputs a summary string
  ```javascript
  packet.describe();
  // ex: "INFO v2.0 f000000000"
  ```
- `toVirtioFrame` - prepends the size of the Wisp frame (u32LE)
- `log()` - prints a collapsed console group
- `reflect()` - returns a reflected version of the packet (flips `SEND` and `RECV`)

### NewCallbackByteStream (function)

Returns a stream for values that get passed through a callback interface.
The stream object (an async iterator object) has a property called
`listener` which can be passed as a listener or called directly. This
listener expects only one argument which is the data to pass through the
stream (typically a value of type `Uint8Array`).

```javascript
const byteStream = NewCallbackByteStream();
emulator.add_listener('virtio-console0-output-bytes',
    byteStream.listener);
```

### NewVirtioFrameStream (function)

Takes in a byte stream (stream of `Uint8Array`) and assumes that this byte
stream contains integers (u32LE) describing the length (in bytes) of data,
followed by the data. Returns a stream which outputs a complete chunk of
data (as per the specified length) as each value, excluding the bytes that
describe the length.

```javascript
const virtioStream = NewVirtioFrameStream(byteStream);
```

### NewWispPacketStream (function)

Takes in a stream of `Uint8Array`s, each containing a complete Wisp packet,
and outputs a stream of instances of **WispPacket**

## Example Use with v86

```javascript
const emulator = new V86(...);

// Get a byte stream for /dev/hvc0
const byteStream = NewCallbackByteStream();
emulator.add_listener('virtio-console0-output-bytes',
    byteStream.listener);

// Get a stream of frames with prepended byte lengths
// (for example, `twisp` uses this format)
const virtioStream = NewVirtioFrameStream(byteStream);

// Get a stream of WispPacket objects
const wispStream = NewWispPacketStream(virtioStream);

// Async iterator
(async () => {
    for ( const packet of wispStream ) {
        console.log('Wisp packet!', packet.describe());
        
        // Let's send back a reflected packet for INFO!
        if ( packet.type === WispPacket.INFO ) {
            emulator.bus.send(
                'virtio-console0-input-bytes',
                packet.toVirtioFrame(),
            );
        }
    }
})();
```
