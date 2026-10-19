#!/usr/bin/env node
// A stand-in for OpenAI's Realtime WebSocket, for load-testing the relay
// without spending money. Point `realtime.upstreamUrl` at it. It speaks the
// event shapes the relay and clients rely on and paces audio in real time.
//
//   node tools/realtime-stress/mockUpstream.mjs --port 9100 --audio-ms 3000
//
// Run `--help` for every flag.

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

const { values: opts } = parseArgs({
    options: {
        port: { type: 'string', default: '9100' },
        host: { type: 'string', default: '0.0.0.0' },
        // Simulated OpenAI handshake latency; ~800 ms was measured live.
        'connect-delay-ms': { type: 'string', default: '0' },
        // Spoken reply length per response.create in audio mode.
        'audio-ms': { type: 'string', default: '3000' },
        // Delay before the first delta of a response (model "thinking").
        'first-delta-ms': { type: 'string', default: '300' },
        // Fraction of sessions dropped mid-response (close 1011).
        'fail-rate': { type: 'string', default: '0' },
        // Fraction of handshakes refused with HTTP 429.
        'reject-rate': { type: 'string', default: '0' },
        help: { type: 'boolean', default: false },
    },
});

if (opts.help) {
    console.log(`Flags:
  --port 9100              listen port
  --host 0.0.0.0           listen address
  --connect-delay-ms 0     delay before accepting a handshake
  --audio-ms 3000          audio length per spoken response
  --first-delta-ms 300     delay before the first delta
  --fail-rate 0            fraction of responses that drop the socket (1011)
  --reject-rate 0          fraction of handshakes refused with HTTP 429`);
    process.exit(0);
}

const num = (k) => Number(opts[k]);
const SAMPLE_RATE = 24_000;
const CHUNK_MS = 50;
// 16-bit mono PCM of silence, base64 — same size as real audio deltas.
const AUDIO_CHUNK = Buffer.alloc((SAMPLE_RATE * 2 * CHUNK_MS) / 1000).toString(
    'base64',
);

let seq = 0;
const id = (p) => `${p}_mock${(++seq).toString(36)}`;
const stats = {
    active: 0,
    opened: 0,
    refused: 0,
    dropped: 0,
    responses: 0,
    framesIn: 0,
    bytesIn: 0,
};

const wss = new WebSocketServer({
    port: num('port'),
    host: opts.host,
    perMessageDeflate: false,
    verifyClient: (_info, done) => {
        setTimeout(() => {
            if (Math.random() < num('reject-rate')) {
                stats.refused++;
                done(false, 429, 'Too Many Requests');
            } else done(true);
        }, num('connect-delay-ms'));
    },
});

wss.on('connection', (ws, req) => {
    stats.active++;
    stats.opened++;
    const model =
        new URL(req.url ?? '/', 'http://x').searchParams.get('model') ??
        'gpt-realtime-mini';
    const session = {
        id: id('sess'),
        object: 'realtime.session',
        type: 'realtime',
        model,
        output_modalities: ['audio'],
        audio: { input: { turn_detection: { type: 'server_vad' } } },
    };
    /** @type {ReturnType<typeof setTimeout>[]} */
    let timers = [];
    let inputAudioBytes = 0;
    const send = (event) => {
        if (ws.readyState === 1)
            ws.send(JSON.stringify({ event_id: id('event'), ...event }));
    };

    send({ type: 'session.created', session });

    const respond = () => {
        const responseId = id('resp');
        const itemId = id('item');
        const audio = session.output_modalities.includes('audio');
        const drop = Math.random() < num('fail-rate');
        stats.responses++;
        send({
            type: 'response.created',
            response: { id: responseId, status: 'in_progress', output: [] },
        });
        const chunks = audio ? Math.ceil(num('audio-ms') / CHUNK_MS) : 5;
        for (let i = 0; i < chunks; i++) {
            timers.push(
                setTimeout(
                    () => {
                        if (drop && i === Math.floor(chunks / 2)) {
                            stats.dropped++;
                            ws.close(1011, 'mock: injected failure');
                            return;
                        }
                        if (audio) {
                            send({
                                type: 'response.output_audio.delta',
                                response_id: responseId,
                                item_id: itemId,
                                output_index: 0,
                                content_index: 0,
                                delta: AUDIO_CHUNK,
                            });
                        } else {
                            send({
                                type: 'response.output_text.delta',
                                response_id: responseId,
                                item_id: itemId,
                                output_index: 0,
                                content_index: 0,
                                delta: 'hi ',
                            });
                        }
                    },
                    num('first-delta-ms') + i * (audio ? CHUNK_MS : 20),
                ),
            );
        }
        const doneAt =
            num('first-delta-ms') + chunks * (audio ? CHUNK_MS : 20) + 10;
        timers.push(
            setTimeout(() => {
                // Token counts shaped like OpenAI's: audio ~ 10 tokens/s in, 20/s out.
                const audioIn = Math.round((inputAudioBytes / 48_000) * 10);
                inputAudioBytes = 0;
                send({
                    type: 'response.done',
                    response: {
                        id: responseId,
                        status: 'completed',
                        output: [],
                        usage: {
                            total_tokens: 0,
                            input_tokens: 120 + audioIn,
                            output_tokens: audio
                                ? Math.round(num('audio-ms') / 50)
                                : 5,
                            input_token_details: {
                                text_tokens: 120,
                                audio_tokens: audioIn,
                                image_tokens: 0,
                                cached_tokens: 0,
                                cached_tokens_details: {
                                    text_tokens: 0,
                                    audio_tokens: 0,
                                    image_tokens: 0,
                                },
                            },
                            output_token_details: audio
                                ? {
                                      text_tokens: 10,
                                      audio_tokens: Math.round(
                                          num('audio-ms') / 50,
                                      ),
                                  }
                                : { text_tokens: 5, audio_tokens: 0 },
                        },
                    },
                });
            }, doneAt),
        );
    };

    ws.on('message', (data, isBinary) => {
        stats.framesIn++;
        stats.bytesIn += data.length;
        if (isBinary) {
            send({
                type: 'error',
                error: {
                    type: 'invalid_request_error',
                    code: 'invalid_event',
                    message:
                        'Expected a text WebSocket message; binary frames are not supported.',
                },
            });
            return;
        }
        let event;
        try {
            event = JSON.parse(data.toString());
        } catch {
            send({
                type: 'error',
                error: { type: 'invalid_request_error', code: 'invalid_json' },
            });
            return;
        }
        switch (event.type) {
            case 'session.update':
                Object.assign(session, event.session ?? {});
                send({ type: 'session.updated', session });
                break;
            case 'conversation.item.create':
                send({
                    type: 'conversation.item.added',
                    item: { id: id('item'), ...event.item },
                });
                send({
                    type: 'conversation.item.done',
                    item: { id: id('item'), ...event.item },
                });
                break;
            case 'input_audio_buffer.append':
                inputAudioBytes += Math.floor(
                    ((event.audio?.length ?? 0) * 3) / 4,
                );
                break;
            case 'input_audio_buffer.commit':
                send({
                    type: 'input_audio_buffer.committed',
                    item_id: id('item'),
                });
                break;
            case 'response.create':
                respond();
                break;
            case 'response.cancel':
                timers.forEach(clearTimeout);
                timers = [];
                send({
                    type: 'response.done',
                    response: { status: 'cancelled', output: [] },
                });
                break;
            default:
                break;
        }
    });
    ws.on('close', () => {
        stats.active--;
        timers.forEach(clearTimeout);
    });
    ws.on('error', () => {});
});

wss.on('listening', () =>
    console.log(
        `[mock-upstream] listening on ws://${opts.host}:${opts.port} — set realtime.upstreamUrl to this`,
    ),
);
setInterval(
    () => console.log(`[mock-upstream] ${JSON.stringify(stats)}`),
    10_000,
).unref();
