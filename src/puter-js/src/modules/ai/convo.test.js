import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation, convo } from './convo.js';

class FakeWebSocket extends EventTarget {
    static instances = [];
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    constructor(url, protocols) {
        super();
        this.url = url;
        this.protocols = protocols;
        FakeWebSocket.instances.push(this);
    }
    send(json) {
        this.sent.push(JSON.parse(json));
    }
    close(code = 1000) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.dispatchEvent(
            Object.assign(new Event('close'), { code, reason: '' }),
        );
    }
    deliver(event) {
        this.readyState = 1;
        this.dispatchEvent(
            new MessageEvent('message', { data: JSON.stringify(event) }),
        );
    }
}
const owner = () => ({
    authToken: 'test-token',
    APIOrigin: 'http://api.puter.localhost:4100',
    env: 'nodejs',
});
const conversations = new Set();
const make = (options = {}) => {
    const c = new Conversation(owner(), options);
    conversations.add(c);
    return c;
};
const socket = () => FakeWebSocket.instances.at(-1);
const connected = async (options = {}) => {
    const c = make(options);
    const ready = c.connect();
    socket().deliver({ type: 'session.created', session: {} });
    await Promise.resolve();
    socket().deliver({ type: 'session.updated', session: {} });
    await ready;
    return c;
};

beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
    for (const c of conversations) c.close();
    conversations.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('conversation preparation', () => {
    it.each([
        null,
        [],
        { model: 'unknown' },
        { voice: 3 },
        { instructions: 'x'.repeat(8193) },
        { output: [] },
        { output: ['wrong'] },
        { output: ['text', 'text'] },
        { turnDetection: 1 },
        { extra: true },
    ])(
        'rejects invalid options before opening a socket (%j)',
        async (options) => {
            await expect(
                convo.call({ puter: owner() }, options),
            ).rejects.toMatchObject({ code: expect.any(String) });
            expect(FakeWebSocket.instances).toHaveLength(0);
        },
    );
    it('requires authentication outside a browser', async () => {
        await expect(
            convo.call({ puter: { ...owner(), authToken: null } }),
        ).rejects.toMatchObject({ code: 'auth_required' });
    });
    it('reports canceled browser authentication', async () => {
        const puter = {
            ...owner(),
            env: 'web',
            authToken: null,
            ui: {
                authenticateWithPuter: async () => {
                    throw new Error('canceled');
                },
            },
        };
        await expect(convo.call({ puter })).rejects.toMatchObject({
            code: 'auth_canceled',
        });
    });
});

describe('Conversation lifecycle', () => {
    it('opens only on connect and resolves after session configuration', async () => {
        const c = make({ instructions: 'Be brief.', output: ['text'] });
        const created = vi.fn();
        c.on('session.created', created);
        expect(c.state).toBe('prepared');
        expect(FakeWebSocket.instances).toHaveLength(0);
        const ready = c.connect();
        expect(c.connect()).toBe(ready);
        expect(c.state).toBe('connecting');
        socket().deliver({ type: 'session.created', session: {} });
        await Promise.resolve();
        expect(created).toHaveBeenCalledOnce();
        expect(socket().sent[0]).toMatchObject({
            type: 'session.update',
            session: { instructions: 'Be brief.', output_modalities: ['text'] },
        });
        expect(c.state).toBe('connecting');
        socket().deliver({ type: 'session.updated', session: {} });
        await ready;
        expect(c.state).toBe('connected');
        await c.connect();
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
    it('rejects close during connection and emits close once', async () => {
        const c = make();
        const closed = vi.fn();
        c.on('close', closed);
        const ready = c.connect();
        c.close();
        c.close();
        await expect(ready).rejects.toMatchObject({ code: 'session_closed' });
        expect(closed).toHaveBeenCalledOnce();
        await expect(c.connect()).rejects.toMatchObject({
            code: 'session_closed',
        });
    });
    it('rejects provider errors during preparation of the live session', async () => {
        const c = make();
        const ready = c.connect();
        socket().deliver({
            type: 'error',
            error: { code: 'invalid_api_key', message: 'Rejected' },
        });
        await expect(ready).rejects.toMatchObject({ code: 'invalid_api_key' });
        expect(c.state).toBe('closed');
    });
    it('times out a provider that never creates its session', async () => {
        vi.useFakeTimers();
        const c = make();
        const result = expect(c.connect()).rejects.toMatchObject({
            code: 'operation_timeout',
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await result;
        expect(c.state).toBe('closed');
        expect(vi.getTimerCount()).toBe(0);
    });
    it('preserves remote close codes and rejects pending updates', async () => {
        const c = await connected();
        const closed = vi.fn();
        c.on('close', closed);
        const update = c.configure({ instructions: 'new' });
        socket().close(1012);
        await expect(update).rejects.toMatchObject({ code: 'session_closed' });
        expect(closed).toHaveBeenCalledExactlyOnceWith({
            type: 'close',
            code: 1012,
            reason: '',
        });
        expect(c.state).toBe('closed');
    });
});

describe('conversation helpers and limits', () => {
    it('requires readiness before sending', () => {
        const c = make();
        expect(() => c.sendText('hello')).toThrow(
            expect.objectContaining({ code: 'session_not_ready' }),
        );
    });
    it('maps text and manual audio turns to native events', async () => {
        const c = await connected({ turnDetection: false });
        socket().sent = [];
        c.sendText('hello');
        c.appendAudio(new Int16Array([1, -2]));
        c.commitAudio();
        expect(socket().sent).toEqual([
            {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: 'hello' }],
                },
            },
            { type: 'response.create' },
            { type: 'input_audio_buffer.append', audio: 'AQD+/w==' },
            { type: 'input_audio_buffer.commit' },
            { type: 'response.create' },
        ]);
    });
    it('bounds text, audio, native structure, encoded size and send queues', async () => {
        const c = await connected();
        expect(() => c.sendText('x'.repeat(8193))).toThrow(
            expect.objectContaining({ code: 'input_too_large' }),
        );
        expect(() => c.appendAudio(new Int16Array(12001))).toThrow(
            expect.objectContaining({ code: 'input_too_large' }),
        );
        expect(() => c.appendAudio(new Uint8Array(2))).toThrow(
            expect.objectContaining({ code: 'invalid_argument' }),
        );
        expect(() => c.commitAudio()).toThrow(
            expect.objectContaining({ code: 'invalid_argument' }),
        );
        expect(() => c.send({ type: 'x', pad: 'x'.repeat(65536) })).toThrow(
            expect.objectContaining({ code: 'input_too_large' }),
        );
        expect(() => c.send({ type: 'x', sparse: new Array(1000000) })).toThrow(
            expect.objectContaining({ code: 'input_too_large' }),
        );
        const cyclic = { type: 'x' };
        cyclic.self = cyclic;
        expect(() => c.send(cyclic)).toThrow(
            expect.objectContaining({ code: 'input_too_large' }),
        );
        socket().bufferedAmount = 128 * 1024;
        expect(() => c.send({ type: 'x' })).toThrow(
            expect.objectContaining({ code: 'queue_full' }),
        );
    });
    it('allows one configuration update at a time and correlates errors', async () => {
        const c = await connected();
        const update = c.configure({ instructions: 'changed' });
        await expect(
            c.configure({ instructions: 'another' }),
        ).rejects.toMatchObject({ code: 'operation_in_progress' });
        const eventId = socket().sent.at(-1).event_id;
        socket().deliver({
            type: 'error',
            error: {
                code: 'invalid_voice',
                message: 'Invalid voice',
                event_id: eventId,
            },
        });
        await expect(update).rejects.toMatchObject({ code: 'invalid_voice' });
        const next = c.configure({ output: ['text', 'audio'] });
        expect(socket().sent.at(-1).session.output_modalities).toEqual([
            'audio',
        ]);
        socket().deliver({ type: 'session.updated', session: {} });
        await next;
    });
    it('emits normalized text and PCM without losing native events', async () => {
        const c = await connected();
        const text = vi.fn();
        const audio = vi.fn();
        const native = vi.fn();
        c.on('text', text);
        c.on('audio', audio);
        c.on('response.output_audio.delta', native);
        socket().deliver({
            type: 'response.output_text.delta',
            delta: 'hello',
            response_id: 'r',
        });
        socket().deliver({
            type: 'response.output_audio.delta',
            delta: 'AQD+/w==',
            response_id: 'r',
            item_id: 'item',
            content_index: 0,
        });
        expect(text).toHaveBeenCalledWith({
            type: 'text',
            delta: 'hello',
            responseId: 'r',
        });
        expect(audio.mock.calls[0][0].pcm).toEqual(new Int16Array([1, -2]));
        expect(native).toHaveBeenCalledOnce();
    });
});

describe('asynchronous interruption', () => {
    it('shares interruption, targets a response, truncates playback and waits for both acknowledgments', async () => {
        const c = await connected();
        const interrupted = vi.fn();
        c.on('interrupted', interrupted);
        socket().deliver({ type: 'response.created', response: { id: 'r1' } });
        const pending = c.interrupt({
            itemId: 'item1',
            contentIndex: 0,
            playedMs: 123.8,
        });
        expect(c.interrupt()).toBe(pending);
        expect(socket().sent.slice(-2)).toMatchObject([
            { type: 'response.cancel', response_id: 'r1' },
            {
                type: 'conversation.item.truncate',
                item_id: 'item1',
                content_index: 0,
                audio_end_ms: 123,
            },
        ]);
        expect(interrupted).toHaveBeenCalledOnce();
        socket().deliver({
            type: 'response.done',
            response: { id: 'r1', status: 'cancelled' },
        });
        let finished = false;
        void pending.then(() => {
            finished = true;
        });
        await Promise.resolve();
        expect(finished).toBe(false);
        socket().deliver({
            type: 'conversation.item.truncated',
            item_id: 'item1',
            content_index: 0,
        });
        await pending;
    });
    it('ignores canceled audio for helpers while retaining native access and newer responses', async () => {
        const c = await connected();
        const audio = vi.fn();
        const native = vi.fn();
        c.on('audio', audio);
        c.on('response.output_audio.delta', native);
        socket().deliver({ type: 'response.created', response: { id: 'old' } });
        const pending = c.interrupt();
        socket().deliver({ type: 'response.created', response: { id: 'new' } });
        socket().deliver({ type: 'response.done', response: { id: 'old' } });
        await pending;
        socket().deliver({
            type: 'response.output_audio.delta',
            delta: 'AQD+/w==',
            response_id: 'old',
        });
        socket().deliver({
            type: 'response.output_audio.delta',
            delta: 'AQD+/w==',
            response_id: 'new',
        });
        expect(audio).toHaveBeenCalledOnce();
        expect(native).toHaveBeenCalledTimes(2);
        const next = c.interrupt();
        expect(socket().sent.at(-1).response_id).toBe('new');
        socket().deliver({ type: 'response.done', response: { id: 'new' } });
        await next;
    });
    it('is a no-op when idle and rejects invalid playback positions', async () => {
        const c = await connected();
        const count = socket().sent.length;
        await c.interrupt();
        expect(socket().sent).toHaveLength(count);
        await expect(
            c.interrupt({ itemId: 'x', contentIndex: 0, playedMs: -1 }),
        ).rejects.toMatchObject({ code: 'invalid_argument' });
    });
    it('rejects pending interruption on disconnect', async () => {
        const c = await connected();
        socket().deliver({ type: 'response.created', response: { id: 'r' } });
        const result = c.interrupt();
        c.close();
        await expect(result).rejects.toMatchObject({ code: 'session_closed' });
    });
    it('bounds a missing cancellation acknowledgment', async () => {
        const c = await connected();
        vi.useFakeTimers();
        socket().deliver({ type: 'response.created', response: { id: 'r' } });
        const result = expect(c.interrupt()).rejects.toMatchObject({
            code: 'operation_timeout',
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await result;
        expect(vi.getTimerCount()).toBe(0);
    });
});

it('keeps sharing interruption until truncation is acknowledged', async () => {
    const c = await connected();
    socket().deliver({ type: 'response.created', response: { id: 'r' } });
    const pending = c.interrupt({
        itemId: 'item',
        contentIndex: 0,
        playedMs: 0,
    });
    socket().deliver({ type: 'response.done', response: { id: 'r' } });
    expect(c.interrupt()).toBe(pending);
    socket().deliver({
        type: 'conversation.item.truncated',
        item_id: 'item',
        content_index: 0,
    });
    await pending;
});
it('preflights both events of a text turn before sending either', async () => {
    const c = await connected();
    const before = socket().sent.length;
    const text = 'hello';
    const item = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
        },
    };
    socket().bufferedAmount =
        128 * 1024 - new TextEncoder().encode(JSON.stringify(item)).byteLength;
    expect(() => c.sendText(text)).toThrow(
        expect.objectContaining({ code: 'queue_full' }),
    );
    expect(socket().sent).toHaveLength(before);
});
