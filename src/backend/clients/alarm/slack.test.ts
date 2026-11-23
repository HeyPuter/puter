import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildSlackMessage,
    createSlackAlertHandler,
    resolveSlackChannel,
} from './slack';
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
    it('shows a plain-language summary without the diagnostic field grid or full alarm id', () => {
        const msg = buildSlackMessage(
            alert({
                summary: 'New Replicate model: vendor/image',
                severity: 'info',
            }),
            { serverId: 'sydney' },
        );
        expect(msg.text).toBe(
            ':information_source: New Replicate model: vendor/image',
        );
        expect(msg.attachments[0].fields).toEqual([]);
        expect(msg.attachments[0].footer).toBe('amber-delta-fox • sydney');
    });

    it('escapes Slack mentions and links in upstream model summaries', () => {
        const msg = buildSlackMessage(
            alert({ summary: 'New model: <!channel> & <https://example.com>' }),
        );
        expect(msg.text).toContain(
            '&lt;!channel&gt; &amp; &lt;https://example.com&gt;',
        );
    });

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

    it('says when the alarm is calling someone', () => {
        const msg = buildSlackMessage(alert({ callGroup: 'billing' }));
        expect(msg.text).toContain('calling `billing`');
        expect(buildSlackMessage(alert()).text).not.toContain('calling');
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

describe('resolveSlackChannel', () => {
    const conf = {
        channel: '#alerts-oncall',
        channels: { billing: '#alerts-billing', empty: '' },
    };

    it('maps a listed key to its channel', () => {
        expect(resolveSlackChannel(conf, 'billing')).toBe('#alerts-billing');
    });

    it('falls back to the default channel', () => {
        expect(resolveSlackChannel(conf, undefined)).toBe('#alerts-oncall');
        expect(resolveSlackChannel(conf, 'unlisted')).toBe('#alerts-oncall');
        expect(resolveSlackChannel(conf, 'empty')).toBe('#alerts-oncall');
        expect(resolveSlackChannel(conf, 'constructor')).toBe('#alerts-oncall');
    });
});

describe('createSlackAlertHandler with a bot token', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const apiResponse = (body: Record<string, unknown>) => ({
        ok: true,
        status: 200,
        json: async () => body,
    });

    beforeEach(() => {
        fetchMock = vi.fn(async (url: string) =>
            url.includes('chat.getPermalink')
                ? apiResponse({
                      ok: true,
                      permalink: 'https://team.slack.com/archives/C1/p12',
                  })
                : apiResponse({ ok: true, channel: 'C1', ts: '1.2' }),
        );
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const conf = {
        botToken: 'xoxb-test',
        channel: '#alerts-oncall',
        channels: { billing: '#alerts-billing' },
    };

    it('posts to the channel the key maps to', async () => {
        const handler = createSlackAlertHandler(conf);
        const delivery = await handler(alert({ channel: 'billing' }));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://slack.com/api/chat.postMessage');
        expect(init.headers.Authorization).toBe('Bearer xoxb-test');
        expect(JSON.parse(init.body).channel).toBe('#alerts-billing');
        expect(delivery).toEqual({});
    });

    it('links the message of an alarm that calls', async () => {
        const handler = createSlackAlertHandler(conf);
        const delivery = await handler(alert({ callGroup: 'billing' }));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe(
            'https://slack.com/api/chat.getPermalink?channel=C1&message_ts=1.2',
        );
        expect(init.headers.Authorization).toBe('Bearer xoxb-test');
        expect(delivery).toEqual({
            url: 'https://team.slack.com/archives/C1/p12',
        });
    });

    it('keeps the post when only the permalink lookup fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock
            .mockResolvedValueOnce(
                apiResponse({ ok: true, channel: 'C1', ts: '1.2' }),
            )
            .mockResolvedValueOnce(
                apiResponse({ ok: false, error: 'ratelimited' }),
            );
        const handler = createSlackAlertHandler({
            ...conf,
            repeatThrottleMs: 60_000,
        });

        expect(await handler(alert({ callGroup: 'billing' }))).toEqual({});
        // Still throttled: the message went out, so a repeat doesn't repost.
        await handler(alert({ callGroup: 'billing' }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it('treats an ok:false answer as a failed post', async () => {
        fetchMock.mockResolvedValueOnce(
            apiResponse({ ok: false, error: 'channel_not_found' }),
        );
        const handler = createSlackAlertHandler({
            ...conf,
            repeatThrottleMs: 60_000,
        });

        await expect(handler(alert())).rejects.toThrow('channel_not_found');
        // The failure released the throttle slot.
        await handler(alert());
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
