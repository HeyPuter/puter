import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPagerDutyAlertHandler } from './pagerduty';
import type { AlertPayload } from './types';

const pdEvent = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@pagerduty/pdjs', () => ({ event: pdEvent }));

const alert = (over: Partial<AlertPayload> = {}): AlertPayload => ({
    id: 'billing:stuck',
    dedupKey: 'billing:stuck#1.1',
    shortId: 'amber-delta-fox',
    message: 'Top-up stuck',
    source: 'alarm',
    severity: 'warning',
    fields: {},
    repeatCount: 1,
    isRepeat: false,
    custom: { repeat_count: 1 },
    ...over,
});

const incidents = (htmlUrls: string[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ incidents: htmlUrls.map((u) => ({ html_url: u })) }),
});

describe('createPagerDutyAlertHandler', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        pdEvent.mockClear();
        fetchMock = vi.fn(async () =>
            incidents(['https://acme.pagerduty.com/incidents/Q1']),
        );
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('triggers an event keyed by the dedup key', async () => {
        const handler = createPagerDutyAlertHandler({
            routingKey: 'rk',
            serverId: 'node-1',
        });
        expect(await handler(alert())).toBeUndefined();

        expect(pdEvent).toHaveBeenCalledWith({
            data: {
                routing_key: 'rk',
                event_action: 'trigger',
                dedup_key: 'billing:stuck#1.1',
                payload: {
                    summary: 'Top-up stuck',
                    source: 'alarm',
                    severity: 'warning',
                    custom_details: { repeat_count: 1, server_id: 'node-1' },
                },
            },
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('links an alarm that calls to the incident it opened', async () => {
        const handler = createPagerDutyAlertHandler({
            routingKey: 'rk',
            apiToken: 'pd-token',
        });
        const delivery = handler(alert({ callGroup: 'billing' }));
        await vi.advanceTimersByTimeAsync(1000);

        expect(await delivery).toEqual({
            url: 'https://acme.pagerduty.com/incidents/Q1',
        });
        const [url, init] = fetchMock.mock.calls[0];
        const query = new URL(url).searchParams;
        expect(query.get('incident_key')).toBe('billing:stuck#1.1');
        expect(query.getAll('statuses[]')).toEqual([
            'triggered',
            'acknowledged',
        ]);
        expect(init.headers.Authorization).toBe('Token token=pd-token');
    });

    it('waits for PagerDuty to open the incident', async () => {
        fetchMock.mockResolvedValueOnce(incidents([]));
        const handler = createPagerDutyAlertHandler({
            routingKey: 'rk',
            apiToken: 'pd-token',
        });
        const delivery = handler(alert({ callGroup: 'billing' }));
        await vi.advanceTimersByTimeAsync(3000);

        expect(await delivery).toEqual({
            url: 'https://acme.pagerduty.com/incidents/Q1',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('looks nothing up without an API token', async () => {
        const handler = createPagerDutyAlertHandler({ routingKey: 'rk' });
        expect(await handler(alert({ callGroup: 'billing' }))).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the event when the lookup fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
        const handler = createPagerDutyAlertHandler({
            routingKey: 'rk',
            apiToken: 'bad-token',
        });
        const delivery = handler(alert({ callGroup: 'billing' }));
        await vi.advanceTimersByTimeAsync(1000);

        expect(await delivery).toBeUndefined();
        expect(pdEvent).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('401'));
    });

    it('gives up when no incident appears', async () => {
        fetchMock.mockResolvedValue(incidents([]));
        const handler = createPagerDutyAlertHandler({
            routingKey: 'rk',
            apiToken: 'pd-token',
        });
        const delivery = handler(alert({ callGroup: 'billing' }));
        await vi.advanceTimersByTimeAsync(7000);

        expect(await delivery).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
