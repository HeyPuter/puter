// @vitest-environment jsdom
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    customDomainErrorText,
    customDomainsRequest,
    customDomainStatus,
    formatCustomDomainPrice,
    mergeCustomDomainRefresh,
} from './customDomains.js';

beforeEach(() => {
    globalThis.i18n = (key) => key;
    globalThis.puter = { authToken: 'session-token' };
    window.api_origin = 'https://api.puter.test';
});

describe('customDomainStatus', () => {
    it('keeps a known status and reads anything else as pending', () => {
        expect(customDomainStatus({ status: 'active' })).toBe('active');
        expect(customDomainStatus({ status: 'failed' })).toBe('failed');
        expect(customDomainStatus({ status: 'verifying' })).toBe('pending');
        expect(customDomainStatus(null)).toBe('pending');
    });
});

describe('formatCustomDomainPrice', () => {
    it('formats the amount in its currency', () => {
        expect(formatCustomDomainPrice({ amount: 0.5, currency: 'USD' })).toMatch(/0[.,]50/);
    });

    it('gives null without an amount or for a currency it cannot format', () => {
        expect(formatCustomDomainPrice(null)).toBeNull();
        expect(formatCustomDomainPrice({ currency: 'USD' })).toBeNull();
        expect(formatCustomDomainPrice({ amount: 1, currency: 'not-a-currency' })).toBeNull();
    });
});

describe('customDomainsRequest', () => {
    it('sends the session token and a JSON body, and parses the reply', async () => {
        globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ uuid: 'd1' }), { status: 201 }));
        const res = await customDomainsRequest('POST', '', { site: 'my-site', hostname: 'www.example.com' });
        expect(fetch).toHaveBeenCalledWith('https://api.puter.test/custom-domains', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer session-token', 'Content-Type': 'application/json' },
            body: '{"site":"my-site","hostname":"www.example.com"}',
        });
        expect(res).toEqual({ status: 201, ok: true, data: { uuid: 'd1' } });
    });

    it('resolves an error status with a null body when it is not JSON', async () => {
        globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 }));
        expect(await customDomainsRequest('GET', '/d1')).toEqual({ status: 404, ok: false, data: null });
        expect(fetch.mock.calls[0][0]).toBe('https://api.puter.test/custom-domains/d1');
        expect(fetch.mock.calls[0][1].headers).toEqual({ 'Authorization': 'Bearer session-token' });
    });
});

describe('customDomainErrorText', () => {
    it('words plan, rate limit and known codes itself', () => {
        expect(customDomainErrorText({ status: 402, data: { code: 'subscription_required' } })).toBe('custom_domain_error_plan');
        expect(customDomainErrorText({ status: 429, data: null })).toBe('custom_domain_error_rate_limited');
        expect(customDomainErrorText({ status: 409, data: { code: 'custom_domain_taken', message: 'x' } })).toBe('custom_domain_error_taken');
    });

    it("falls back to the server's message, then to the status", () => {
        expect(customDomainErrorText({ status: 502, data: { message: 'Provider down' } })).toBe('Provider down');
        expect(customDomainErrorText({ status: 500, data: null })).toBe('custom_domain_error_generic (HTTP 500)');
    });
});

describe('mergeCustomDomainRefresh', () => {
    const routing = { type: 'CNAME', name: 'www', value: 'my-site.puter.site', purpose: 'routing' };
    const redirect = { type: 'A', name: '@', value: '192.0.2.1', purpose: 'redirect' };
    const ownership = { type: 'TXT', name: '_cf', value: 'abc', purpose: 'ownership' };
    const known = {
        uuid: 'd1',
        status: 'pending',
        dnsProvider: 'example-dns',
        redirectFrom: 'example.com',
        records: [routing, redirect, ownership],
    };

    it('keeps the records shown before when the check returns only routing', () => {
        const merged = mergeCustomDomainRefresh(known, { uuid: 'd1', status: 'active', records: [routing] });
        expect(merged.status).toBe('active');
        expect(merged.records).toEqual([routing, redirect, ownership]);
        expect(merged.dnsProvider).toBe('example-dns');
        expect(merged.redirectFrom).toBe('example.com');
    });

    it('takes fresh records, with the redirect after the routing one', () => {
        const fresh_ownership = { ...ownership, value: 'def' };
        const merged = mergeCustomDomainRefresh(known, { uuid: 'd1', status: 'pending', records: [routing, fresh_ownership] });
        expect(merged.records).toEqual([routing, redirect, fresh_ownership]);
    });
});
