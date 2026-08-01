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
) => {
    const seen: AlertPayload[] = [];
    client.addAlertHandler(
        async (alert) => {
            seen.push(alert);
        },
        { name: 'capture', minSeverity },
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

    it('keeps info alarms out of PagerDuty but sends them to Slack', async () => {
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
        expect(fetchMock).toHaveBeenCalledTimes(2);

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
