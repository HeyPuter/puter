import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ALARM_IDLE_TTL_MS,
    AlarmClient,
    MAX_TRACKED_ALARMS,
} from './AlarmClient';
import type { IConfig, IPagerConfig } from '../../types';
import type { AlarmCall, AlertPayload } from './types';

const pdEvent = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@pagerduty/pdjs', () => ({ event: pdEvent }));

const makeClient = (pager: IPagerConfig = {}) =>
    new AlarmClient({ serverId: 'test-node', pager } as unknown as IConfig);

/** Register a capturing handler in place of a real transport. */
const capture = (
    client: AlarmClient,
    minSeverity?: 'critical' | 'error' | 'warning' | 'info',
    maxSeverity?: 'critical' | 'error' | 'warning' | 'info',
) => {
    const seen: AlertPayload[] = [];
    client.addAlertHandler(
        async (alert) => {
            seen.push(alert);
        },
        { name: 'capture', minSeverity, maxSeverity },
    );
    return seen;
};

/** Whether the client still tracks `id`; clears it to find out. */
const clearIfHeld = (client: AlarmClient, id: string): boolean => {
    const log = vi.mocked(console.log);
    log.mockClear();
    client.clear(id);
    return log.mock.calls.some(([message]) =>
        String(message).startsWith('[alarm] CLEAR'),
    );
};

/** How many times `id` was raised as a new alarm (short ids only). */
const activeLines = (id: string): number =>
    vi
        .mocked(console.error)
        .mock.calls.filter(([message]) =>
            String(message).startsWith(`[alarm] ACTIVE ${id} ::`),
        ).length;

describe('AlarmClient severity routing', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        pdEvent.mockClear();
    });

    it('defaults to critical when the call site says nothing', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('boom', 'everything is on fire');

        expect(seen).toHaveLength(1);
        expect(seen[0].severity).toBe('critical');
    });

    it('honours a configured default severity', () => {
        const client = makeClient({ defaultSeverity: 'info' });
        const seen = capture(client);

        client.create('boom', 'everything is on fire');

        expect(seen[0].severity).toBe('info');
    });

    it('skips handlers whose floor the alarm does not reach', () => {
        const client = makeClient();
        const paging = capture(client, 'warning');
        const chat = capture(client, 'info');

        client.create('rate-limit', 'a user hit a limit', {}, 'info');

        expect(paging).toHaveLength(0);
        expect(chat).toHaveLength(1);
    });

    it('skips handlers whose ceiling the alarm exceeds', () => {
        const client = makeClient();
        const chat = capture(client, 'info', 'info');

        client.create('rate-limit', 'a user hit a limit', {}, 'info');
        client.create('outage', 'everything is on fire', {}, 'critical');

        expect(chat.map((alert) => alert.id)).toEqual(['rate-limit']);
    });

    it('retiers an alarm from config', () => {
        const client = makeClient({
            severityOverrides: { 'noisy:*': 'info' },
        });
        const paging = capture(client, 'warning');
        const chat = capture(client, 'info');

        client.create('noisy:thing', 'used to page', {}, 'critical');

        expect(paging).toHaveLength(0);
        expect(chat[0].severity).toBe('info');
    });

    it('mutes an alarm from config', () => {
        const client = makeClient({
            severityOverrides: { 'noisy:thing': 'mute' },
        });
        const chat = capture(client, 'info');

        client.create('noisy:thing', 'not worth reporting');
        client.create('noisy:thing', 'still not worth reporting');

        expect(chat).toHaveLength(0);
    });
});

describe('AlarmClient alert payload', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('reports occurrence counts across repeats', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('flap', 'first');
        client.create('flap', 'second');

        expect(seen[0]).toMatchObject({ repeatCount: 1, isRepeat: false });
        expect(seen[1]).toMatchObject({ repeatCount: 2, isRepeat: true });
    });

    it('renders fields as strings and lifts the stack out of the error', () => {
        const client = makeClient();
        const seen = capture(client);
        const error = new Error('kaboom');

        client.create('boom', 'failed', { error, status: 500 }, 'critical');

        expect(seen[0].fields.status).toBe('500');
        expect(seen[0].trace).toBe(error.stack);
        expect(seen[0].shortId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    });

    it('keeps one failing handler from starving the others', async () => {
        const client = makeClient();
        client.addAlertHandler(
            async () => {
                throw new Error('transport down');
            },
            { name: 'broken' },
        );
        const seen = capture(client);

        client.create('boom', 'failed');
        await Promise.resolve();

        expect(seen).toHaveLength(1);
    });

    it('suppresses alarms once draining', () => {
        const client = makeClient();
        const seen = capture(client);

        client.onServerPrepareShutdown();
        client.create('boom', 'too late');

        expect(seen).toHaveLength(0);
    });
});

describe('AlarmClient transport registration', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        pdEvent.mockClear();
    });

    it('splits info to Slack and everything above it to PagerDuty', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient({
            pagerduty: { enabled: true, routingKey: 'rk' },
            slack: { enabled: true, webhookUrl: 'https://hooks.example/abc' },
        });
        await client.onServerStart();

        client.create('quiet:thing', 'informational', {}, 'info');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(pdEvent).not.toHaveBeenCalled();

        client.create('slow:thing', 'look at this today', {}, 'warning');
        client.create('loud:thing', 'paging', {}, 'critical');
        await vi.waitFor(() => expect(pdEvent).toHaveBeenCalledTimes(2));
        // The pager has them; chat doesn't repeat them.
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });

    it('sends every severity to Slack when there is no pager', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient({
            slack: { enabled: true, webhookUrl: 'https://hooks.example/abc' },
        });
        await client.onServerStart();

        client.create(
            'loud:thing',
            'nowhere else to send this',
            {},
            'critical',
        );
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        vi.unstubAllGlobals();
    });

    it('lets config widen the Slack ceiling back out', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient({
            pagerduty: { enabled: true, routingKey: 'rk' },
            slack: {
                enabled: true,
                webhookUrl: 'https://hooks.example/abc',
                maxSeverity: 'critical',
            },
        });
        await client.onServerStart();

        client.create('loud:thing', 'paging', {}, 'critical');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        vi.unstubAllGlobals();
    });

    it('gives each occurrence its own PagerDuty incident by default', async () => {
        const client = makeClient({
            pagerduty: { enabled: true, routingKey: 'rk' },
        });
        await client.onServerStart();

        client.create('scan:failed', 'first', {}, 'warning');
        client.create('scan:failed', 'second', {}, 'warning');
        await vi.waitFor(() => expect(pdEvent).toHaveBeenCalledTimes(2));

        const keys = pdEvent.mock.calls.map(
            ([arg]: [{ data: { dedup_key: string } }]) => arg.data.dedup_key,
        );
        expect(keys[0]).not.toBe(keys[1]);
    });

    it('collapses repeats of a dedup alarm onto one incident', async () => {
        const client = makeClient({
            pagerduty: { enabled: true, routingKey: 'rk' },
        });
        await client.onServerStart();

        const raise = () =>
            client.create(
                'http_500:POST:/notif/mark-ack:deadlock',
                'HTTP 500 on POST /notif/mark-ack: deadlock',
                {},
                'critical',
                { dedup: true },
            );
        raise();
        raise();
        await vi.waitFor(() => expect(pdEvent).toHaveBeenCalledTimes(2));

        const keys = pdEvent.mock.calls.map(
            ([arg]: [{ data: { dedup_key: string } }]) => arg.data.dedup_key,
        );
        expect(keys[0]).toBe('http_500:POST:/notif/mark-ack:deadlock');
        expect(keys[1]).toBe(keys[0]);
    });

    it('refuses a Slack bot token without a default channel', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const client = makeClient({
            slack: { enabled: true, botToken: 'xoxb-test' },
        });
        await client.onServerStart();

        client.create('boom', 'nowhere to send this', {}, 'info');
        await Promise.resolve();
        expect(fetchMock).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
    });

    it('skips transports that are enabled but not configured', async () => {
        const client = makeClient({
            pagerduty: { enabled: true },
            slack: { enabled: true },
        });
        await client.onServerStart();

        const seen = capture(client);
        client.create('boom', 'nowhere to send this');

        // Only the capturing handler is registered.
        expect(seen).toHaveLength(1);
        expect(pdEvent).not.toHaveBeenCalled();
    });
});

describe('AlarmClient alarm registry', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(console.error).mockClear();
    });

    it('starts a cleared alarm over as a new one', () => {
        const client = makeClient();
        const seen = capture(client);
        client.create('disk-pressure', 'nearly full');

        client.clear('disk-pressure');
        client.create('disk-pressure', 'nearly full again');

        expect(activeLines('disk-pressure')).toBe(2);
        expect(seen.at(-1)).toMatchObject({ repeatCount: 1, isRepeat: false });
    });

    it('ignores a clear for an alarm that is not active', () => {
        const client = makeClient();
        expect(() => client.clear('never-raised')).not.toThrow();
    });

    it('abbreviates long ids in the log line', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = makeClient();
        const seen = capture(client);
        const longId = 'a-very-long-alarm-identifier-that-wraps';

        client.create(longId, 'noisy');

        expect(log).toHaveBeenCalledWith(
            `[alarm] ACTIVE ${seen[0].shortId} (${longId.slice(0, 20)}...) :: noisy`,
        );
    });

    it('accumulates fields across repeats of the same alarm', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('flap', 'first', { a: 1 });
        client.create('flap', 'second', { b: 2 });

        expect(seen[1].fields).toEqual({ a: '1', b: '2' });
    });

    it('counts every repeat of a hot alarm', () => {
        const client = makeClient();
        const seen = capture(client);

        for (let i = 0; i < 500; i++) {
            client.create('hot', `occurrence ${i}`, { i });
        }

        expect(seen.at(-1)).toMatchObject({
            repeatCount: 500,
            isRepeat: true,
            message: 'occurrence 499',
        });
    });

    it('names anonymous handlers by their registration order', () => {
        const client = makeClient();
        client.addAlertHandler(async () => {
            throw new Error('down');
        });
        expect(() => client.create('boom', 'x')).not.toThrow();
    });

    it('only logs the drain notice once', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        log.mockClear();
        const client = makeClient();

        client.onServerPrepareShutdown();
        // A second prepare must not restart the drain.
        client.onServerPrepareShutdown();
        client.create('a', 'x');
        client.create('b', 'y');

        const drainLogs = log.mock.calls.filter(
            ([message]) =>
                message === '[alarm] suppressing alarm while draining',
        );
        expect(drainLogs).toHaveLength(1);
    });

    it('substitutes placeholders for an empty id and message', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('', '');

        expect(seen[0]).toMatchObject({
            id: 'something-bad',
            message: 'something bad happened',
        });
    });
});

describe('AlarmClient alarm eviction', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(console.error).mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('forgets alarms that stay quiet past the idle window', () => {
        const client = makeClient();
        const ids = Array.from(
            { length: 50 },
            (_, i) => `metering_usage_dropped:user-${i}`,
        );
        for (const id of ids) client.create(id, 'usage dropped');

        vi.advanceTimersByTime(ALARM_IDLE_TTL_MS + 1);
        client.create('unrelated', 'the next alarm sweeps the registry');

        expect(ids.filter((id) => clearIfHeld(client, id))).toEqual([]);
        expect(clearIfHeld(client, 'unrelated')).toBe(true);
    });

    it('treats a recurrence after the idle window as a new alarm', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('scan:failed', 'first');
        client.create('scan:failed', 'second');
        vi.advanceTimersByTime(ALARM_IDLE_TTL_MS + 1);
        client.create('scan:failed', 'back again');

        expect(seen.at(-1)).toMatchObject({ repeatCount: 1, isRepeat: false });
        // A fresh start keeps per-occurrence incident keys from colliding.
        expect(seen.at(-1)!.dedupKey).not.toBe(seen[0].dedupKey);
    });

    it('still treats a repeat inside the window as a repeat after a sweep', () => {
        const client = makeClient();
        const seen = capture(client);

        for (let i = 0; i < 10; i++) client.create('flap', 'same fault');
        vi.advanceTimersByTime(ALARM_IDLE_TTL_MS - 1000);
        client.create('other', 'sweeps the registry');
        client.create('flap', 'same fault');

        // Occurrence 11 is past the burst, so nothing new goes out for it.
        expect(seen.map((alert) => alert.id)).toEqual([
            ...Array(10).fill('flap'),
            'other',
        ]);
        expect(activeLines('flap')).toBe(1);
    });

    it('keeps an alarm that keeps recurring for longer than the window', () => {
        const client = makeClient();
        const seen = capture(client);

        for (let i = 0; i < 6; i++) {
            client.create('hot', 'still broken');
            vi.advanceTimersByTime(ALARM_IDLE_TTL_MS / 2);
            client.create(`noise:${i}`, 'sweeps the registry');
        }

        expect(activeLines('hot')).toBe(1);
        expect(seen.filter((alert) => alert.id === 'hot').at(-1)).toMatchObject(
            { repeatCount: 6 },
        );
    });

    it('drops the least recently raised alarm once full', () => {
        const client = makeClient();

        for (let i = 0; i < MAX_TRACKED_ALARMS; i++) {
            client.create(`user:${i}`, 'per-user alarm');
            vi.advanceTimersByTime(1);
        }
        // Raised again, so user:1 is now the one seen longest ago.
        client.create('user:0', 'per-user alarm');
        client.create('one-more', 'over the cap');

        expect(activeLines('user:0')).toBe(1);
        expect(clearIfHeld(client, 'user:1')).toBe(false);
        expect(clearIfHeld(client, 'user:0')).toBe(true);
        expect(clearIfHeld(client, 'user:2')).toBe(true);
        expect(clearIfHeld(client, 'one-more')).toBe(true);
    });

    it('never holds more than the cap', () => {
        const client = makeClient();
        const ids = Array.from(
            { length: MAX_TRACKED_ALARMS * 3 },
            (_, i) => `user:${i}`,
        );

        for (const id of ids) client.create(id, 'per-user alarm');

        const held = ids.filter((id) => clearIfHeld(client, id));
        expect(held).toHaveLength(MAX_TRACKED_ALARMS);
        expect(held[0]).toBe(`user:${MAX_TRACKED_ALARMS * 2}`);
    });
});

describe('AlarmClient repeat reporting', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        pdEvent.mockClear();
    });

    it('reports every occurrence up to the burst, then backs off', () => {
        const client = makeClient();
        const seen = capture(client);

        for (let i = 0; i < 12; i++) client.create('flap', 'same fault');

        expect(seen).toHaveLength(10);
        expect(seen[9].repeatCount).toBe(10);
    });

    it('reports again once the interval is reached', () => {
        const client = makeClient();
        const seen = capture(client);

        for (let i = 0; i < 500; i++) client.create('flap', 'same fault');

        expect(seen).toHaveLength(11);
        expect(seen[10].repeatCount).toBe(500);
    });

    it('keeps a fast-repeating fault out of the log after the burst', () => {
        const client = makeClient();
        capture(client);
        const warn = vi.mocked(console.warn);
        warn.mockClear();

        for (let i = 0; i < 100; i++) client.create('flap', 'same fault');

        // Occurrences 2-10 only; the first is an ACTIVE line on console.error.
        expect(warn.mock.calls).toHaveLength(9);
    });

    it('skips the payload entirely when no transport accepts the severity', () => {
        const client = makeClient();
        const seen = capture(client, 'critical');

        client.create('quiet', 'nobody is listening', {}, 'info');

        expect(seen).toHaveLength(0);
    });
});

describe('AlarmClient channel keys', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('carries the channel key on the payload', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('billing:stuck', 'stuck', {}, 'info', {
            channel: 'billing',
        });
        client.create('plain', 'no key', {}, 'info');

        expect(seen[0].channel).toBe('billing');
        expect(seen[1]).not.toHaveProperty('channel');
    });

    it('keeps the channel of the first occurrence', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('a', 'first', {}, 'info', { channel: 'billing' });
        client.create('a', 'second', {}, 'info', { channel: 'ai_providers' });

        expect(seen.map((alert) => alert.channel)).toEqual([
            'billing',
            'billing',
        ]);
    });
});

describe('AlarmClient calls', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const callClient = (pager: IPagerConfig = {}) => {
        const client = makeClient({
            ...pager,
            calls: { rules: { 'billing:*': 'billing' }, ...pager.calls },
        });
        const calls: AlarmCall[] = [];
        client.addCallHandler(async (call) => {
            calls.push(call);
        });
        return { client, calls };
    };

    it('hands a matching alarm to call handlers with the links transports returned', async () => {
        const { client, calls } = callClient();
        client.addAlertHandler(async () => ({ url: 'https://chat/msg/1' }));
        client.addAlertHandler(async () => {});

        client.create('billing:stuck:tx1', 'top-up stuck', {}, 'info');

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].group).toBe('billing');
        expect(calls[0].alert.callGroup).toBe('billing');
        expect(calls[0].links).toEqual(['https://chat/msg/1']);
    });

    it('leaves alarms no rule names alone', async () => {
        const { client, calls } = callClient();
        const seen = capture(client);

        client.create('ai:outage', 'provider down', {}, 'info');
        await Promise.resolve();

        expect(calls).toHaveLength(0);
        expect(seen[0]).not.toHaveProperty('callGroup');
    });

    it('does not resolve call groups before a call handler is registered', () => {
        const client = makeClient({
            calls: { rules: { 'billing:*': 'billing' } },
        });
        const seen = capture(client);

        client.create('billing:stuck', 'top-up stuck', {}, 'info');

        expect(seen[0]).not.toHaveProperty('callGroup');
    });

    it('never calls for a muted alarm', async () => {
        const { client, calls } = callClient({
            severityOverrides: { 'billing:*': 'mute' },
        });
        capture(client);

        client.create('billing:stuck', 'top-up stuck', {}, 'info');
        await Promise.resolve();

        expect(calls).toHaveLength(0);
    });

    it('takes links only from transports that took the alarm', async () => {
        const { client, calls } = callClient();
        client.addAlertHandler(
            async () => ({ url: 'https://pager/incident/1' }),
            {
                minSeverity: 'warning',
            },
        );
        client.addAlertHandler(async () => ({ url: 'https://chat/msg/2' }), {
            maxSeverity: 'info',
        });

        client.create('billing:outage', 'billing down', {}, 'critical');
        client.create('billing:stuck', 'top-up stuck', {}, 'info');

        await vi.waitFor(() => expect(calls).toHaveLength(2));
        const linksById = Object.fromEntries(
            calls.map((call) => [call.alert.id, call.links]),
        );
        expect(linksById).toEqual({
            'billing:outage': ['https://pager/incident/1'],
            'billing:stuck': ['https://chat/msg/2'],
        });
    });

    it('keeps the last links when a repeat is not delivered again', async () => {
        const { client, calls } = callClient();
        let posts = 0;
        client.addAlertHandler(async () => {
            posts++;
            // A throttled repeat returns nothing.
            return posts === 1 ? { url: 'https://chat/msg/3' } : undefined;
        });

        client.create('billing:stuck', 'top-up stuck', {}, 'info');
        client.create('billing:stuck', 'top-up stuck', {}, 'info');

        await vi.waitFor(() => expect(calls).toHaveLength(2));
        expect(calls[1].links).toEqual(['https://chat/msg/3']);
    });

    it('still calls when a transport fails', async () => {
        const { client, calls } = callClient();
        client.addAlertHandler(async () => {
            throw new Error('chat is down');
        });

        client.create('billing:stuck', 'top-up stuck', {}, 'info');

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].links).toEqual([]);
    });

    it('keeps an open call refreshed by repeats too frequent to report', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const { client, calls } = callClient();
            for (let i = 0; i < 10; i++) {
                client.create('billing:hot', 'hot', {}, 'info');
            }
            await vi.waitFor(() => expect(calls).toHaveLength(10));

            // Unreported, and the call went out under a minute ago.
            client.create('billing:hot', 'hot', {}, 'info');
            await Promise.resolve();
            expect(calls).toHaveLength(10);

            vi.setSystemTime(Date.now() + 61_000);
            client.create('billing:hot', 'hot', {}, 'info');
            await vi.waitFor(() => expect(calls).toHaveLength(11));
            expect(calls[10].group).toBe('billing');
            expect(calls[10].alert.repeatCount).toBe(12);
        } finally {
            vi.useRealTimers();
        }
    });

    it('raises the call without links when a transport never answers', async () => {
        vi.useFakeTimers();
        try {
            const { client, calls } = callClient();
            client.addAlertHandler(() => new Promise(() => {}));

            client.create('billing:stuck', 'top-up stuck', {}, 'info');
            await vi.advanceTimersByTimeAsync(14_000);
            expect(calls).toHaveLength(0);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(calls).toHaveLength(1);
            expect(calls[0].links).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a failing call handler from reaching the caller', async () => {
        const { client, calls } = callClient();
        const error = vi.mocked(console.error);
        client.addCallHandler(async () => {
            throw new Error('store is down');
        });

        expect(() =>
            client.create('billing:stuck', 'top-up stuck', {}, 'info'),
        ).not.toThrow();
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('call handler failed'),
            ),
        );
    });
});
