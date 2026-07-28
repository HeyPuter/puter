import { CLOSE, CONNECT, DATA, CONTINUE, INFO, TCP, UDP, createWispPacket, parseIncomingPacket, textde } from './parsers.js';

export class PWispHandler {
    _ws;
    _nextStreamID = 1;
    _bufferMax;
    // Set once the relay answers the handshake with CONTINUE on stream 0.
    // Decides whether a close is a dropped connection (reconnect) or a
    // handshake that never completed (report failure).
    _ready = false;
    onReady = undefined;
    onError = undefined;
    streamMap = new Map();
    constructor (wispURL, puterAuth) {
        const setup = () => {
            this._ws = new WebSocket(wispURL);
            this._ws.binaryType = 'arraybuffer';
            this._ws.onerror = () => {
                this._fail(new Error(`Wisp relay connection failed: ${wispURL}`));
            };
            this._ws.onclose = () => {
                if ( this._ready ) {
                    // Pass the function itself: `setTimeout(setup(), 1000)`
                    // would reconnect immediately and schedule nothing.
                    setTimeout(setup, 1000);
                    return;
                }
                this._fail(new Error('Wisp relay closed before the handshake completed'));
            };
            this._ws.onmessage = (event) => {
                const parsed = parseIncomingPacket(new Uint8Array(event.data));
                switch ( parsed.packetType ) {
                case DATA:
                    this.streamMap.get(parsed.streamID).dataCallBack(parsed.payload.slice(0)); // return a copy for the user to do as they please
                    break;
                case CONTINUE:
                    if ( parsed.streamID === 0 ) {
                        this._bufferMax = parsed.remainingBuffer;
                        this._ready = true;
                        if ( this.onReady ) {
                            this.onReady();
                        }
                        return;
                    }
                    this.streamMap.get(parsed.streamID).buffer = parsed.remainingBuffer;
                    this._continue(parsed.streamID);
                    break;
                case CLOSE:
                    if ( parsed.streamID !== 0 )
                    {
                        this.streamMap.get(parsed.streamID).closeCallBack(parsed.reason);
                    }
                    break;
                case INFO:
                    puterAuth && this._ws.send(createWispPacket({
                        packetType: INFO,
                        streamID: 0,
                        puterAuth,
                    }));
                    break;
                }
            };
        };
        setup();
    }
    // Reports a connection-level failure once, so a caller waiting on the
    // handshake is rejected rather than left hanging.
    _fail (error) {
        const onError = this.onError;
        this.onError = undefined;
        if ( onError ) onError(error);
    }
    _continue (streamID) {
        const queue = this.streamMap.get(streamID).queue;
        for ( let i = 0; i < queue.length; i++ ) {
            this.write(streamID, queue.shift());
        }
    }
    register (host, port, callbacks) {
        const streamID = this._nextStreamID++;
        this.streamMap.set(streamID, { queue: [], streamID, buffer: this._bufferMax, dataCallBack: callbacks.dataCallBack, closeCallBack: callbacks.closeCallBack });
        this._ws.send(createWispPacket({
            packetType: CONNECT,
            streamType: TCP,
            streamID: streamID,
            hostname: host,
            port: port,
        }));
        return streamID;
    }

    write (streamID, data) {
        const streamData = this.streamMap.get(streamID);
        if ( streamData.buffer > 0 ) {
            streamData.buffer--;

            this._ws.send(createWispPacket({
                packetType: DATA,
                streamID: streamID,
                payload: data,
            }));
        } else {
            streamData.queue.push(data);
        }
    }
    close (streamID) {
        this._ws.send(createWispPacket({
            packetType: CLOSE,
            streamID: streamID,
            reason: 0x02,
        }));
    }
}