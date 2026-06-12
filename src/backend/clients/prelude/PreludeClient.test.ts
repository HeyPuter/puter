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
            signals: { ip: '203.0.113.7' },
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
