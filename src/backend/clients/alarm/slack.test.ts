import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSlackMessage, createSlackAlertHandler } from './slack';
import type { AlertPayload } from './types';

const alert = (over: Partial<AlertPayload> = {}): AlertPayload => ({
    id: 'cronMonitor:high_aiLogEntries',
    dedupKey: 'cronMonitor:high_aiLogEntries#1.1',
    shortId: 'amber-delta-fox',
    message: 'High AI log entries: 1200 in the last 10 minutes',
    source: 'alarm',
    severity: 'warning',
    fields: { count: '1200', threshold: '1000' },
    repeatCount: 1,
    isRepeat: false,
    ...over,
});

describe('buildSlackMessage', () => {
    it('renders severity, message and fields', () => {
        const msg = buildSlackMessage(alert(), {
            channel: '#alerts',
            username: 'puter-alarms',
            serverId: 'oregon',
        });

        expect(msg.text).toContain('[WARNING]');
        expect(msg.text).toContain('High AI log entries');
        expect(msg.channel).toBe('#alerts');
        expect(msg.username).toBe('puter-alarms');
        expect(msg.attachments[0].fields).toEqual([
            { title: 'count', value: '1200', short: true },
            { title: 'threshold', value: '1000', short: true },
        ]);
        expect(msg.attachments[0].footer).toBe(
            'amber-delta-fox • cronMonitor:high_aiLogEntries • oregon',
        );
    });

    it('marks repeats with an occurrence count', () => {
        const msg = buildSlackMessage(
            alert({ repeatCount: 7, isRepeat: true }),
        );
        expect(msg.text).toContain('(x7)');
    });

    it('colours each severity differently', () => {
        const colors = (['critical', 'error', 'warning', 'info'] as const).map(
            (severity) =>
                buildSlackMessage(alert({ severity })).attachments[0].color,
        );
        expect(new Set(colors).size).toBe(4);
    });

    it('puts the stack in a code block and keeps it out of the fields', () => {
        const msg = buildSlackMessage(
            alert({
                fields: { error: 'Error: boom', path: '/api/x' },
                trace: 'Error: boom\n    at handler',
            }),
        );
        expect(msg.attachments[0].text).toBe(
            '```Error: boom\n    at handler```',
        );
        expect(msg.attachments[0].fields.map((f) => f.title)).toEqual(['path']);
    });

    it('truncates long values and caps the field count', () => {
        const fields: Record<string, string> = { long: 'x'.repeat(1000) };
        for (let i = 0; i < 30; i++) fields[`f${i}`] = String(i);

        const msg = buildSlackMessage(alert({ fields }));
        expect(msg.attachments[0].fields.length).toBe(12);
        expect(msg.attachments[0].fields[0].value).toHaveLength(400);
        expect(msg.attachments[0].fields[0].value.endsWith('…')).toBe(true);
    });

    it('omits channel and username when unset', () => {
        const msg = buildSlackMessage(alert());
        expect(msg.channel).toBeUndefined();
        expect(msg.username).toBeUndefined();
    });
});

describe('createSlackAlertHandler', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('posts the payload to the webhook', async () => {
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            channel: '#alerts',
        });
        await handler(alert());

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://hooks.example/abc');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body).channel).toBe('#alerts');
    });

    it('throttles repeats of the same alarm and lets other ids through', async () => {
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            repeatThrottleMs: 60_000,
        });

        await handler(alert());
        await handler(alert({ repeatCount: 2, isRepeat: true }));
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await handler(alert({ id: 'other:alarm' }));
        expect(fetchMock).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(60_000);
        await handler(alert({ repeatCount: 3, isRepeat: true }));
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('posts every occurrence when throttling is disabled', async () => {
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            repeatThrottleMs: 0,
        });

        await handler(alert());
        await handler(alert({ repeatCount: 2, isRepeat: true }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not let a failed post consume the throttle slot', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            repeatThrottleMs: 60_000,
        });

        await expect(handler(alert())).rejects.toThrow('500');
        await handler(alert());
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('releases the throttle slot when the post itself errors', async () => {
        fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            repeatThrottleMs: 60_000,
        });

        await expect(handler(alert())).rejects.toThrow('socket hang up');
        await handler(alert());
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('evicts throttle entries that have aged out once the map fills', async () => {
        const throttleMs = 60_000;
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            repeatThrottleMs: throttleMs,
        });

        // Fill to the high-water mark, then age every entry past the window.
        for (let i = 0; i < 5000; i++) {
            await handler(alert({ id: `aged:${i}` }));
        }
        vi.advanceTimersByTime(throttleMs);

        await handler(alert({ id: 'fresh' }));
        expect(fetchMock).toHaveBeenCalledTimes(5001);

        // The aged ids were pruned, so they post again immediately.
        await handler(alert({ id: 'aged:0' }));
        expect(fetchMock).toHaveBeenCalledTimes(5002);
    });

    it('drops the oldest entry when the map is full of live ones', async () => {
        const handler = createSlackAlertHandler({
            webhookUrl: 'https://hooks.example/abc',
            repeatThrottleMs: 60_000,
        });

        for (let i = 0; i < 5000; i++) {
            await handler(alert({ id: `live:${i}` }));
        }

        // Nothing has aged out, so the oldest id makes room for the new one.
        await handler(alert({ id: 'newcomer' }));
        expect(fetchMock).toHaveBeenCalledTimes(5001);

        await handler(alert({ id: 'live:0' }));
        expect(fetchMock).toHaveBeenCalledTimes(5002);
        // The newcomer is still throttled.
        await handler(alert({ id: 'newcomer' }));
        expect(fetchMock).toHaveBeenCalledTimes(5002);
    });
});
