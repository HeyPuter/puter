import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreludeClient } from './PreludeClient';
import type { IConfig } from '../../types';

const makeClient = (apiKey?: string) =>
    new PreludeClient({
        prelude: apiKey ? { apiKey } : undefined,
    } as unknown as IConfig);

const okJson = (body: unknown) =>
    ({
        ok: true,
        status: 200,
        json: async () => body,
    }) as unknown as Response;

describe('PreludeClient', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('isConfigured reflects whether an apiKey is set', () => {
        expect(makeClient('sk_test').isConfigured()).toBe(true);
        expect(makeClient().isConfigured()).toBe(false);
    });

    describe('isCountrySupported (€0.07 cap)', () => {
        const client = makeClient('sk_test');

        it('allows revenue markets up to the cap (incl. the priciest)', () => {
            expect(client.isCountrySupported('US')).toBe(true); // €0.0043
            expect(client.isCountrySupported('DE')).toBe(true); // €0.0598
            expect(client.isCountrySupported('SA')).toBe(true); // €0.0638
            expect(client.isCountrySupported('us')).toBe(true); // case-insensitive
        });

        it('rejects countries above the cap, with no SMS, or unknown', () => {
            expect(client.isCountrySupported('PK')).toBe(false); // €0.3548
            expect(client.isCountrySupported('ID')).toBe(false); // €0.2430
            expect(client.isCountrySupported('LI')).toBe(false); // null (no SMS)
            expect(client.isCountrySupported('ZZ')).toBe(false); // unknown
            expect(client.isCountrySupported(undefined)).toBe(false);
        });

        it('honors a configured maxSmsCostEur override', () => {
            const strict = new PreludeClient({
                prelude: { apiKey: 'sk', maxSmsCostEur: 0.01 },
            } as unknown as IConfig);
            expect(strict.isCountrySupported('US')).toBe(true); // €0.0043
            expect(strict.isCountrySupported('DE')).toBe(false); // €0.0598 > 0.01

            const loose = new PreludeClient({
                prelude: { apiKey: 'sk', maxSmsCostEur: 0.5 },
            } as unknown as IConfig);
            expect(loose.isCountrySupported('PK')).toBe(true); // €0.3548 <= 0.5
        });
    });

    it('createVerification POSTs the phone target + ip signal with bearer auth', async () => {
        fetchMock.mockResolvedValue(
            okJson({ id: 'vrf_1', status: 'success' }),
        );
        const client = makeClient('sk_test');

        const res = await client.createVerification('+14155550123', {
            ip: '203.0.113.7',
        });

        expect(res).toEqual({ id: 'vrf_1', status: 'success' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.prelude.dev/v2/verification');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer sk_test');
        expect(JSON.parse(init.body)).toEqual({
            target: { type: 'phone_number', value: '+14155550123' },
            // Defaults to RCS (cheaper); Prelude falls back to SMS. locale is
            // hardcoded to en-US so the message text is always English.
            options: { code_size: 6, preferred_channel: 'rcs', locale: 'en-US' },
            signals: { ip: '203.0.113.7' },
        });
    });

    it('forwards device_id and user_agent signals when supplied', async () => {
        fetchMock.mockResolvedValue(okJson({ id: 'v', status: 'success' }));
        const client = makeClient('sk_test');

        await client.createVerification('+14155550123', {
            ip: '203.0.113.7',
            device_id: 'thumb_abc123',
            user_agent: 'Mozilla/5.0',
        });

        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(init.body).signals).toEqual({
            ip: '203.0.113.7',
            device_id: 'thumb_abc123',
            user_agent: 'Mozilla/5.0',
        });
    });

    it('omits the signals object entirely when none are supplied', async () => {
        fetchMock.mockResolvedValue(okJson({ id: 'v', status: 'success' }));
        const client = makeClient('sk_test');

        await client.createVerification('+14155550123');

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
            'signals',
        );
    });

    it('forwards dispatch_id as a top-level field, not inside signals', async () => {
        fetchMock.mockResolvedValue(okJson({ id: 'v', status: 'success' }));
        const client = makeClient('sk_test');

        await client.createVerification('+14155550123', {
            ip: '203.0.113.7',
            dispatch_id: 'd1f5e9a0-0000-4000-8000-000000000000',
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.dispatch_id).toBe('d1f5e9a0-0000-4000-8000-000000000000');
        expect(body.signals).toEqual({ ip: '203.0.113.7' });
        expect(body.signals).not.toHaveProperty('dispatch_id');
    });

    it('omits dispatch_id when not supplied', async () => {
        fetchMock.mockResolvedValue(okJson({ id: 'v', status: 'success' }));
        const client = makeClient('sk_test');

        await client.createVerification('+14155550123', { ip: '203.0.113.7' });

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
            'dispatch_id',
        );
    });

    it('includes a configured template_id + sender_id + preferred channel', async () => {
        fetchMock.mockResolvedValue(okJson({ id: 'v', status: 'success' }));
        const client = new PreludeClient({
            prelude: {
                apiKey: 'sk_test',
                templateId: 'tmpl_puter',
                senderId: 'Puter',
                preferredChannel: 'sms',
            },
        } as unknown as IConfig);

        await client.createVerification('+14155550123');

        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(init.body).options).toEqual({
            code_size: 6,
            preferred_channel: 'sms', // config override beats the rcs default
            locale: 'en-US',
            template_id: 'tmpl_puter',
            sender_id: 'Puter',
        });
    });

    it('checkVerification POSTs target + code and returns the status', async () => {
        fetchMock.mockResolvedValue(okJson({ status: 'success' }));
        const client = makeClient('sk_test');

        const res = await client.checkVerification('+14155550123', '123456');

        expect(res).toEqual({ status: 'success' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.prelude.dev/v2/verification/check');
        expect(JSON.parse(init.body)).toEqual({
            target: { type: 'phone_number', value: '+14155550123' },
            code: '123456',
        });
    });

    it('throws (does not call fetch) when not configured', async () => {
        const client = makeClient();
        await expect(
            client.createVerification('+14155550123'),
        ).rejects.toThrow(/not configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws on a non-2xx Prelude response', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ message: 'bad target' }),
        } as unknown as Response);

        await expect(
            makeClient('sk_test').checkVerification('+1', 'x'),
        ).rejects.toThrow(/Prelude .* failed: 400/);
    });
});
