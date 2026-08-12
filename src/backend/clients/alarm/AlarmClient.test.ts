import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlarmClient } from './AlarmClient';
import type { IConfig, IPagerConfig } from '../../types';
import type { AlertPayload } from './types';

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

    it('lets config override a known-error rule', () => {
        const client = makeClient({
            severityOverrides: { 'known:thing': 'critical' },
        });
        client.setKnownErrors([
            {
                match: { id: 'known:thing' },
                action: { type: 'severity', value: 'info' },
            },
        ]);
        const paging = capture(client, 'warning');

        client.create('known:thing', 'known but escalated');

        expect(paging[0].severity).toBe('critical');
    });

    it('still respects a no-alert known-error rule', () => {
        const client = makeClient();
        client.setKnownErrors([
            { match: { id: 'known:quiet' }, action: { type: 'no-alert' } },
        ]);
        const chat = capture(client, 'info');

        client.create('known:quiet', 'suppressed');

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

        client.create('loud:thing', 'paging', {}, 'critical');
        await vi.waitFor(() => expect(pdEvent).toHaveBeenCalledTimes(1));
        // The pager has it; chat doesn't repeat it.
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
    });

    it('finds an alarm by its full id or its short id', () => {
        const client = makeClient();
        client.create('disk-pressure', 'nearly full');

        const alarm = client.get('disk-pressure');
        expect(alarm?.message).toBe('nearly full');
        expect(client.get(alarm!.shortId)).toBe(alarm);
    });

    it('returns nothing for an id it has never seen', () => {
        expect(makeClient().get('never-raised')).toBeUndefined();
    });

    it('forgets an alarm once cleared, under both ids', () => {
        const client = makeClient();
        client.create('disk-pressure', 'nearly full');
        const shortId = client.get('disk-pressure')!.shortId;

        client.clear('disk-pressure');

        expect(client.get('disk-pressure')).toBeUndefined();
        expect(client.get(shortId)).toBeUndefined();
    });

    it('ignores a clear for an alarm that is not active', () => {
        const client = makeClient();
        expect(() => client.clear('never-raised')).not.toThrow();
    });

    it('abbreviates long ids in the log line but keeps the short id usable', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = makeClient();
        const longId = 'a-very-long-alarm-identifier-that-wraps';

        client.create(longId, 'noisy');

        const shortId = client.get(longId)!.shortId;
        expect(log).toHaveBeenCalledWith(
            `[alarm] ACTIVE ${shortId} (${longId.slice(0, 20)}...) :: noisy`,
        );
    });

    it('accumulates fields across repeats of the same alarm', () => {
        const client = makeClient();
        const seen = capture(client);

        client.create('flap', 'first', { a: 1 });
        client.create('flap', 'second', { b: 2 });

        expect(seen[1].fields).toEqual({ a: '1', b: '2' });
        expect(client.get('flap')?.occurrences).toHaveLength(2);
    });

    it('caps retained occurrences while still counting every repeat', () => {
        const client = makeClient();
        const seen = capture(client);

        for (let i = 0; i < 50; i++) {
            client.create('hot', `occurrence ${i}`, { i });
        }

        const alarm = client.get('hot')!;
        expect(alarm.count).toBe(50);
        expect(alarm.occurrences).toHaveLength(20);
        expect(alarm.timestamps).toHaveLength(20);
        // The window kept is the most recent one, not the oldest.
        expect(alarm.occurrences[19].message).toBe('occurrence 49');
        // Trimming history must not rewind what the transports are told.
        expect(seen[49]).toMatchObject({ repeatCount: 50, isRepeat: true });
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

describe('AlarmClient known-error rules', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('suppresses alerts for a matching rule', () => {
        const client = makeClient();
        const seen = capture(client);
        client.setKnownErrors([
            { match: { id: 'noisy' }, action: { type: 'no-alert' } },
        ]);

        client.create('noisy', 'ignore me');
        client.create('noisy', 'ignore me again');

        expect(seen).toHaveLength(0);
    });

    it('leaves alarms with a different id alone', () => {
        const client = makeClient();
        const seen = capture(client);
        client.setKnownErrors([
            { match: { id: 'noisy' }, action: { type: 'no-alert' } },
        ]);

        client.create('real', 'page me');

        expect(seen).toHaveLength(1);
    });

    it('only matches when the message matches too', () => {
        const rules = [
            {
                match: { id: 'timeout', message: 'upstream timed out' },
                action: { type: 'no-alert' as const },
            },
        ];

        // Separate clients: suppression is recorded on the alarm, so a
        // second occurrence of the same id would inherit it.
        const matching = makeClient();
        const matchingSeen = capture(matching);
        matching.setKnownErrors(rules);
        matching.create('timeout', 'upstream timed out');
        expect(matchingSeen).toHaveLength(0);

        const differing = makeClient();
        const differingSeen = capture(differing);
        differing.setKnownErrors(rules);
        differing.create('timeout', 'something else entirely');
        expect(differingSeen.map((alert) => alert.message)).toEqual([
            'something else entirely',
        ]);
    });

    it('only matches when every named field matches', () => {
        const client = makeClient();
        const seen = capture(client);
        client.setKnownErrors([
            {
                match: { id: 'http', fields: { status: 404 } },
                action: { type: 'no-alert' },
            },
        ]);

        client.create('http', 'not found', { status: 404 });
        client.create('http-2', 'server error', { status: 500 });

        expect(seen.map((alert) => alert.id)).toEqual(['http-2']);
    });

    it('retiers a matching alarm to a lower severity', () => {
        const client = makeClient();
        const paging = capture(client, 'error');
        const chat = capture(client, 'info');
        client.setKnownErrors([
            {
                match: { id: 'flaky' },
                action: { type: 'severity', value: 'info' },
            },
        ]);

        client.create('flaky', 'transient', {}, 'critical');

        expect(paging).toHaveLength(0);
        expect(chat).toHaveLength(1);
        expect(chat[0].severity).toBe('info');
    });
});
