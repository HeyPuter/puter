#!/usr/bin/env node
// Misbehaving clients for the realtime relay. Each mode targets one way a
// client can make the relay's process do more work or hold more memory than a
// normal session. Run it next to a normal loadtest.mjs run and watch the
// server's `[realtime]` lines (loopMaxMs, elu, rssMb) and the latency of the
// well-behaved sessions.
//
//   PUTER_TOKENS=tok node tools/realtime-stress/abuse.mjs \
//       --url wss://api.<test-domain>/puterai/openai/v1/realtime \
//       --mode big-frames --sockets 20 --frame-mb 15 --duration-s 60
//
// Modes:
//   big-frames     send --frame-mb MiB text frames back to back; each one is
//                  unmasked, UTF-8 checked, re-masked and forwarded in one go
//   slow-reader    ask for spoken replies but stop reading the socket, so
//                  the relay has to queue (or drop) what upstream sends
//   preauth-flood  open sockets with a bad token and send --frame-mb MiB
//                  straight away, before the relay has rejected them
//
// Prints one JSON summary on stdout. Needs the repo's `ws` package.

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const { values: opts } = parseArgs({
    options: {
        url: { type: 'string' },
        mode: { type: 'string', default: 'big-frames' },
        model: { type: 'string', default: 'gpt-realtime-mini' },
        sockets: { type: 'string', default: '10' },
        'frame-mb': { type: 'string', default: '8' },
        'duration-s': { type: 'string', default: '30' },
        help: { type: 'boolean', default: false },
    },
});

if (opts.help || !opts.url) {
    console.error(
        'Usage: PUTER_TOKENS=<t> node abuse.mjs --url <wss://…/realtime> --mode big-frames|slow-reader|preauth-flood [--sockets 10] [--frame-mb 8] [--duration-s 30]',
    );
    process.exit(opts.help ? 0 : 2);
}

const tokens = (process.env.PUTER_TOKENS ?? process.env.PUTER_TOKEN ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
if (tokens.length === 0 && opts.mode !== 'preauth-flood') {
    console.error('Set PUTER_TOKENS (comma-separated) or PUTER_TOKEN.');
    process.exit(2);
}

const sockets = Number(opts.sockets);
const durationMs = Number(opts['duration-s']) * 1000;
const frameBytes = Math.floor(Number(opts['frame-mb']) * 1024 * 1024);
// A valid event of the requested size: base64 silence in an audio append.
const bigFrame = JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: 'A'.repeat(Math.max(0, frameBytes - 64)),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = {
    mode: opts.mode,
    sockets,
    opened: 0,
    framesSent: 0,
    mbSent: 0,
    bytesReceived: 0,
    errors: {},
    closeCodes: {},
};
const count = (bag, k) => (bag[k] = (bag[k] ?? 0) + 1);

const openSocket = (i, token) => {
    const url = new URL(opts.url);
    url.searchParams.set('model', opts.model);
    const ws = new WebSocket(url, ['realtime'], {
        headers: { Authorization: `Bearer ${token}` },
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
    });
    ws.on('message', (data) => {
        summary.bytesReceived += data.length;
        const s = data.toString('utf8', 0, 200);
        const m = s.match(/"code":"([^"]+)"/);
        if (s.includes('"type":"error"') && m) count(summary.errors, m[1]);
    });
    ws.on('error', (e) =>
        count(summary.errors, `socket:${e.code ?? e.message}`),
    );
    const closed = new Promise((r) =>
        ws.on('close', (code) => {
            count(summary.closeCodes, String(code));
            r();
        }),
    );
    return { ws, closed, i };
};

const opened = (ws) =>
    new Promise((resolve, reject) => {
        ws.once('open', () => {
            summary.opened++;
            resolve();
        });
        ws.once('error', reject);
    });

/** Send without ever having more than one frame queued locally. */
const sendDrained = (ws, data) =>
    new Promise((resolve) => ws.send(data, () => resolve()));

async function bigFrames({ ws, closed }) {
    await opened(ws);
    const end = Date.now() + durationMs;
    let done = false;
    closed.then(() => (done = true));
    while (!done && Date.now() < end && ws.readyState === WebSocket.OPEN) {
        await sendDrained(ws, bigFrame);
        summary.framesSent++;
        summary.mbSent += frameBytes / 1048576;
    }
    ws.close(1000);
    await closed;
}

async function slowReader({ ws, closed }) {
    await opened(ws);
    ws.send(
        JSON.stringify({
            type: 'session.update',
            session: { type: 'realtime', output_modalities: ['audio'] },
        }),
    );
    // Stop reading: the kernel buffers fill, then the relay's queue grows.
    ws._socket.pause();
    const end = Date.now() + durationMs;
    let done = false;
    closed.then(() => (done = true));
    while (!done && Date.now() < end) {
        ws.send(JSON.stringify({ type: 'response.create' }));
        summary.framesSent++;
        await sleep(500);
    }
    ws._socket.resume();
    ws.terminate();
    await closed;
}

async function preauthFlood({ ws, closed }) {
    await opened(ws);
    const end = Date.now() + durationMs;
    while (Date.now() < end && ws.readyState === WebSocket.OPEN) {
        await sendDrained(ws, bigFrame);
        summary.framesSent++;
        summary.mbSent += frameBytes / 1048576;
    }
    ws.terminate();
    await closed;
}

const run = {
    'big-frames': bigFrames,
    'slow-reader': slowReader,
    'preauth-flood': preauthFlood,
}[opts.mode];
if (!run) {
    console.error(`Unknown --mode ${opts.mode}`);
    process.exit(2);
}

const t0 = Date.now();
const progress = setInterval(
    () =>
        console.error(
            `[abuse] t=${Math.round((Date.now() - t0) / 1000)}s opened=${summary.opened} framesSent=${summary.framesSent} mbSent=${Math.round(summary.mbSent)} received=${Math.round(summary.bytesReceived / 1048576)}MB`,
        ),
    5_000,
);
await Promise.all(
    Array.from({ length: sockets }, async (_, i) => {
        const token =
            opts.mode === 'preauth-flood'
                ? `invalid-${i}`
                : tokens[i % tokens.length];
        try {
            await run(openSocket(i, token));
        } catch (e) {
            count(summary.errors, `run:${e?.code ?? e?.message ?? e}`);
        }
    }),
);
clearInterval(progress);
summary.mbSent = Math.round(summary.mbSent);
summary.durationS = Math.round((Date.now() - t0) / 1000);
console.log(JSON.stringify(summary, null, 2));
