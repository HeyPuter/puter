/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { translateProviderError } from '../../controllers/drivers/DriverController.js';
import { klingImageInput, klingRequest } from './kling.js';

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as MockInstance<typeof fetch>;
});

afterEach(() => {
    vi.restoreAllMocks();
});

const respond = (body: unknown, status = 200) =>
    fetchSpy.mockResolvedValueOnce(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
        }),
    );

describe('klingRequest', () => {
    it('sends the key as a Bearer token and returns the envelope data', async () => {
        respond({ code: 0, message: 'SUCCEED', data: { id: 'x' } });
        const data = await klingRequest(
            'k-1',
            'POST',
            '/text-to-video/kling-3.0',
            {
                body: { prompt: 'hi' },
            },
        );
        expect(data).toEqual({ id: 'x' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe(
            'https://api-singapore.klingai.com/text-to-video/kling-3.0',
        );
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer k-1');
        expect(headers['Content-Type']).toBe('application/json');
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({
            prompt: 'hi',
        });
    });

    it('sends GETs without a body and honors a base URL override', async () => {
        respond({ code: 0, data: [] });
        await klingRequest('k', 'GET', '/tasks?task_ids=1', {
            baseUrl: 'https://kling.proxy',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe('https://kling.proxy/tasks?task_ids=1');
        expect((init as RequestInit).body).toBeUndefined();
    });

    it('throws on a non-zero code even with HTTP 200', async () => {
        respond({ code: 1201, message: 'bad param' });
        await expect(klingRequest('k', 'GET', '/x')).rejects.toMatchObject({
            status: 400,
            code: '1201',
            provider: 'kling',
            message: 'bad param',
        });
    });

    it.each([
        [1000, 401, 401],
        [1004, 401, 401],
        [1102, 429, 402],
        [1101, 429, 402],
        [1103, 403, 403],
        [1303, 429, 429],
        [1302, 429, 429],
        [1201, 400, 400],
        [5000, 500, 500],
        [5001, 503, 503],
    ])('maps code %i (HTTP %i) to status %i', async (code, http, status) => {
        respond({ code, message: 'failed' }, http);
        await expect(klingRequest('k', 'GET', '/x')).rejects.toMatchObject({
            status,
            code: String(code),
        });
    });

    it('reports exhausted resource packs as credit exhaustion at the driver boundary', async () => {
        respond({ code: 1102, message: 'Account balance not enough' }, 429);
        const err = await klingRequest('k', 'GET', '/x').catch((e) => e);
        expect(translateProviderError(err)).toMatchObject({
            statusCode: 503,
            legacyCode: 'upstream_credits_exhausted',
        });
    });

    it.each([1202, 1203])(
        'reports code %i as an alerted Puter-side failure, not a bad request',
        async (code) => {
            respond(
                { code, message: "model_name 'kling-nope' is not supported" },
                code === 1203 ? 404 : 400,
            );
            const err = await klingRequest('k', 'GET', '/x').catch((e) => e);
            expect(translateProviderError(err)).toMatchObject({
                statusCode: 502,
                legacyCode: 'upstream_failed',
                alarmSeverity: 'warning',
                fields: { provider: 'kling', upstreamCode: String(code) },
            });
        },
    );

    it('reports a 1201 about the model as an alerted Puter-side failure', async () => {
        respond({ code: 1201, message: 'model is not supported' }, 400);
        const err = await klingRequest('k', 'GET', '/x').catch((e) => e);
        expect(translateProviderError(err)).toMatchObject({
            statusCode: 502,
            legacyCode: 'upstream_failed',
            alarmSeverity: 'warning',
        });
    });

    it('keeps other 1201s as bad requests', async () => {
        respond({ code: 1201, message: 'Voice id not found' }, 400);
        const err = await klingRequest('k', 'GET', '/x').catch((e) => e);
        expect(translateProviderError(err)).toMatchObject({
            statusCode: 400,
            legacyCode: 'upstream_bad_request',
        });
    });

    it("doesn't pass Kling's auth wording through", async () => {
        respond(
            {
                code: 1002,
                message:
                    'Authentication error. The current API does not support AK/SK; please go to the console (https://kling.ai/dev/api-key) to create API key.',
            },
            401,
        );
        await expect(klingRequest('k', 'GET', '/x')).rejects.toMatchObject({
            status: 401,
            code: '1002',
            message: 'Kling rejected the API key',
        });
    });

    it('turns a content-safety block into moderation_flagged', async () => {
        respond({ code: 1301, message: 'risk' }, 400);
        await expect(klingRequest('k', 'GET', '/x')).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            code: 'moderation_flagged',
        });
    });

    it('falls back to the HTTP status for a non-JSON error body', async () => {
        respond('<html>bad gateway</html>', 502);
        await expect(klingRequest('k', 'GET', '/x')).rejects.toMatchObject({
            status: 502,
            code: undefined,
        });
    });

    it('rejects a successful reply that carries no data', async () => {
        respond({ code: 0, message: 'SUCCEED' });
        await expect(klingRequest('k', 'GET', '/x')).rejects.toMatchObject({
            status: 502,
        });
    });
});

describe('klingImageInput', () => {
    it('strips the data URI prefix to raw base64', () => {
        expect(klingImageInput('data:image/png;base64,iVBOR')).toBe('iVBOR');
    });

    it('passes URLs and raw base64 through', () => {
        expect(klingImageInput('https://example.com/a.png')).toBe(
            'https://example.com/a.png',
        );
        expect(klingImageInput('iVBOR')).toBe('iVBOR');
    });
});
