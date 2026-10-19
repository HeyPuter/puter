#!/usr/bin/env node
// Load generator for the realtime relay (`/puterai/openai/v1/realtime`).
// Opens many sessions the way puter.js does, drives scripted turns through
// them, and prints one JSON report on stdout. Progress goes to stderr.
// Exits 1 when the session success rate is below --min-success.
//
//   PUTER_TOKENS=tok1,tok2 node tools/realtime-stress/loadtest.mjs \
//       --url wss://api.example.com/puterai/openai/v1/realtime \
//       --sessions 200 --ramp 20 --turns 3 --mode audio --mic-ms 2000
//
// Needs Node 22+ (global WebSocket). Run `--help` for every flag.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
    options: {
        url: { type: 'string' },
        model: { type: 'string', default: 'gpt-realtime-mini' },
        sessions: { type: 'string', default: '10' },
        ramp: { type: 'string', default: '5' },
        turns: { type: 'string', default: '2' },
        mode: { type: 'string', default: 'text' },
        'mic-ms': { type: 'string', default: '0' },
        'think-ms': { type: 'string', default: '500' },
        'hold-ms': { type: 'string', default: '0' },
        'turn-timeout-ms': { type: 'string', default: '60000' },
        'connect-timeout-ms': { type: 'string', default: '20000' },
        'min-success': { type: 'string', default: '0.99' },
        label: { type: 'string', default: '' },
        out: { type: 'string' },
        help: { type: 'boolean', default: false },
    },
});

if (opts.help || !opts.url) {
    console.error(`Usage: PUTER_TOKENS=<t1,t2,...> node loadtest.mjs --url <wss://api.<domain>/puterai/openai/v1/realtime> [flags]

  --sessions 10            total sessions to open
  --ramp 5                 new sessions per second
  --turns 2                responses requested per session
  --mode text|audio        output modality
  --mic-ms 0               input audio streamed per turn at real-time pace (0 = send a text message)
  --think-ms 500           pause between turns
  --hold-ms 0              keep the session open (idle) after the last turn
  --model gpt-realtime-mini
  --turn-timeout-ms 60000  a turn with no response.done by then fails
  --connect-timeout-ms 20000
  --min-success 0.99       exit 1 below this session success rate
  --label ""               copied into the report
  --out <file>             also write the report here

Tokens are Puter tokens, assigned round-robin; use several accounts to stay
under the per-account session cap (realtime.maxConnectionsPerUser).`);
    process.exit(opts.help ? 0 : 2);
}

const tokens = (process.env.PUTER_TOKENS ?? process.env.PUTER_TOKEN ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
if (tokens.length === 0) {
    console.error('Set PUTER_TOKENS (comma-separated) or PUTER_TOKEN.');
    process.exit(2);
}
if (typeof WebSocket !== 'function') {
    console.error('Global WebSocket missing: use Node 22 or later.');
    process.exit(2);
}

const n = (k) => Number(opts[k]);
const MIC_CHUNK_MS = 100;
// 24 kHz 16-bit mono silence, the Realtime API's default input format.
const MIC_CHUNK = Buffer.alloc((24_000 * 2 * MIC_CHUNK_MS) / 1000).toString(
    'base64',
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const live = { open: 0, peakOpen: 0, started: 0, finished: 0, failed: 0 };
const results = [];

/**
 * Resolve with the next event matching `pred`, or reject on
 * error/close/timeout.
 */
const nextEvent = (ctx, pred, timeoutMs, label) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ctx.waiters.delete(waiter);
            reject({ reason: `timeout:${label}` });
        }, timeoutMs);
        const waiter = {
            pred,
            resolve: (e) => {
                clearTimeout(timer);
                resolve(e);
            },
            reject: (e) => {
                clearTimeout(timer);
                reject(e);
            },
        };
        ctx.waiters.add(waiter);
    });

async function runSession(index) {
    const token = tokens[index % tokens.length];
    const r = {
        index,
        ok: false,
        reason: null,
        connectMs: null,
        sessionCreatedMs: null,
        turns: [],
        closeCode: null,
        bytesDown: 0,
    };
    const t0 = performance.now();
    const url = new URL(opts.url);
    url.searchParams.set('model', opts.model);
    const ctx = { waiters: new Set() };
    let ws;
    let opened = false;
    // Set once we start closing; any close before that is the server's doing.
    let closing = false;
    let serverClosed = null;
    let onServerClose = () => {};

    try {
        ws = new WebSocket(url, [
            'realtime',
            `openai-insecure-api-key.${token}`,
        ]);
        ws.addEventListener('message', (msg) => {
            const raw = typeof msg.data === 'string' ? msg.data : '';
            r.bytesDown += raw.length;
            let event;
            try {
                event = JSON.parse(raw);
            } catch {
                return;
            }
            for (const w of ctx.waiters) {
                if (event.type === 'error') {
                    ctx.waiters.delete(w);
                    w.reject({
                        reason: `error:${event.error?.code ?? 'unknown'}`,
                    });
                } else if (w.pred(event)) {
                    ctx.waiters.delete(w);
                    w.resolve(event);
                }
            }
            if (event.type === 'error' && !r.reason) {
                r.reason = `error:${event.error?.code ?? 'unknown'}`;
            }
        });
        ws.addEventListener('close', (e) => {
            r.closeCode = e.code;
            if (!closing) {
                serverClosed = e.code;
                onServerClose();
            }
            if (opened) {
                live.open--;
                opened = false;
            }
            for (const w of ctx.waiters) {
                ctx.waiters.delete(w);
                w.reject({ reason: `closed:${e.code}` });
            }
        });

        const created = nextEvent(
            ctx,
            (e) => e.type === 'session.created',
            n('connect-timeout-ms'),
            'session.created',
        );
        created.catch(() => {});
        await new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject({ reason: 'timeout:open' }),
                n('connect-timeout-ms'),
            );
            ws.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            });
            ws.addEventListener('error', () => {
                clearTimeout(timer);
                reject({ reason: 'connect_error' });
            });
        });
        opened = true;
        live.open++;
        live.peakOpen = Math.max(live.peakOpen, live.open);
        r.connectMs = performance.now() - t0;

        await created;
        r.sessionCreatedMs = performance.now() - t0;

        const send = (event) => ws.send(JSON.stringify(event));
        send({
            type: 'session.update',
            session: {
                type: 'realtime',
                output_modalities: [opts.mode === 'audio' ? 'audio' : 'text'],
                audio: { input: { turn_detection: null } },
            },
        });

        for (let turn = 0; turn < n('turns'); turn++) {
            const t = { ok: false, ttfbMs: null, totalMs: null, status: null };
            r.turns.push(t);
            if (n('mic-ms') > 0) {
                for (let ms = 0; ms < n('mic-ms'); ms += MIC_CHUNK_MS) {
                    send({
                        type: 'input_audio_buffer.append',
                        audio: MIC_CHUNK,
                    });
                    await sleep(MIC_CHUNK_MS);
                }
                send({ type: 'input_audio_buffer.commit' });
            } else {
                send({
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'Say hi in 3 words.' },
                        ],
                    },
                });
            }
            const ts = performance.now();
            const firstDelta = nextEvent(
                ctx,
                (e) => typeof e.type === 'string' && e.type.endsWith('.delta'),
                n('turn-timeout-ms'),
                'first_delta',
            );
            const done = nextEvent(
                ctx,
                (e) => e.type === 'response.done',
                n('turn-timeout-ms'),
                'response.done',
            );
            // Either may reject while the other is awaited; mark both handled.
            firstDelta.catch(() => {});
            done.catch(() => {});
            send({ type: 'response.create' });
            await firstDelta;
            t.ttfbMs = performance.now() - ts;
            const doneEvent = await done;
            t.totalMs = performance.now() - ts;
            t.status = doneEvent.response?.status ?? null;
            t.ok = t.status === 'completed';
            if (!t.ok) throw { reason: `response_status:${t.status}` };
            if (turn < n('turns') - 1) await sleep(n('think-ms'));
        }

        if (n('hold-ms') > 0 && serverClosed === null) {
            await Promise.race([
                sleep(n('hold-ms')),
                new Promise((res) => (onServerClose = res)),
            ]);
        }
        if (serverClosed !== null) throw { reason: `closed:${serverClosed}` };
        r.ok = true;
    } catch (e) {
        r.reason = r.reason ?? e?.reason ?? String(e?.message ?? e);
    } finally {
        r.totalMs = performance.now() - t0;
        closing = true;
        if (ws && ws.readyState <= 1) {
            const closed = new Promise((res) =>
                ws.addEventListener('close', res, { once: true }),
            );
            ws.close(1000);
            await Promise.race([closed, sleep(5_000)]);
        }
        live.finished++;
        if (!r.ok) live.failed++;
        results.push(r);
    }
}

const pct = (values, p) => {
    const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    if (v.length === 0) return null;
    return Math.round(
        v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))],
    );
};
const dist = (values) => ({
    p50: pct(values, 50),
    p90: pct(values, 90),
    p99: pct(values, 99),
    max: pct(values, 100),
});
const histogram = (keys) =>
    keys.reduce((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});

const startedAt = new Date();
const tStart = performance.now();
const progress = setInterval(() => {
    console.error(
        `[loadtest] t=${Math.round((performance.now() - tStart) / 1000)}s started=${live.started} open=${live.open} peakOpen=${live.peakOpen} finished=${live.finished} failed=${live.failed}`,
    );
}, 5_000);

const total = n('sessions');
const gap = 1000 / Math.max(n('ramp'), 0.001);
const running = [];
for (let i = 0; i < total; i++) {
    live.started++;
    running.push(runSession(i));
    if (i < total - 1) await sleep(gap);
}
await Promise.all(running);
clearInterval(progress);

const okSessions = results.filter((r) => r.ok).length;
const allTurns = results.flatMap((r) => r.turns);
const report = {
    label: opts.label,
    startedAt: startedAt.toISOString(),
    durationS: Math.round((performance.now() - tStart) / 100) / 10,
    config: {
        url: opts.url,
        model: opts.model,
        sessions: total,
        ramp: n('ramp'),
        turns: n('turns'),
        mode: opts.mode,
        micMs: n('mic-ms'),
        holdMs: n('hold-ms'),
        accounts: tokens.length,
    },
    sessions: {
        ok: okSessions,
        failed: total - okSessions,
        successRate: Math.round((okSessions / total) * 10_000) / 10_000,
        peakOpen: live.peakOpen,
    },
    turns: {
        ok: allTurns.filter((t) => t.ok).length,
        failed: allTurns.filter((t) => !t.ok).length,
    },
    latencyMs: {
        connect: dist(results.map((r) => r.connectMs)),
        sessionCreated: dist(results.map((r) => r.sessionCreatedMs)),
        firstDelta: dist(allTurns.map((t) => t.ttfbMs)),
        responseDone: dist(allTurns.map((t) => t.totalMs)),
    },
    failures: histogram(results.filter((r) => !r.ok).map((r) => r.reason)),
    closeCodes: histogram(results.map((r) => String(r.closeCode))),
    bytesDown: results.reduce((a, r) => a + r.bytesDown, 0),
};

const json = JSON.stringify(report, null, 2);
console.log(json);
if (opts.out) writeFileSync(opts.out, json);
process.exit(report.sessions.successRate >= n('min-success') ? 0 : 1);
