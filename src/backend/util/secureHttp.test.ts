/**
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

import { describe, expect, it, vi } from 'vitest';
import { configContainer } from '../exports.js';
import {
    isPublicResolvedAddress,
    secureFetch,
    validateUrlNoIP,
} from './secureHttp.js';

vi.mock('node:dns', async importOriginal => {
    const actual = await importOriginal<typeof import('node:dns')>();
    const PRIVATE_HOSTS: Record<string, string> = {
        'resolves-private.test': '10.0.0.1',
        'resolves-metadata.test': '169.254.169.254',
    };
    return {
        ...actual,
        lookup: ((hostname: string, options: unknown, callback: unknown) => {
            const cb = callback as (
                err: Error | null,
                addresses?: { address: string; family: number }[],
            ) => void;
            const addr = PRIVATE_HOSTS[hostname];
            if (addr) {
                cb(null, [{ address: addr, family: 4 }]);
                return;
            }
            (actual.lookup as (...args: unknown[]) => void)(
                hostname,
                options,
                callback,
            );
        }) as typeof actual.lookup,
    };
});

describe('secureHttp URL validation', () => {
    it('rejects raw IP and localhost URLs before fetching', () => {
        expect(() => validateUrlNoIP('http://127.0.0.1/')).toThrow();
        expect(() => validateUrlNoIP('http://[::1]/')).toThrow();
        expect(() => validateUrlNoIP('http://localhost/')).toThrow();
        expect(() =>
            validateUrlNoIP('https://example.com/image.png'),
        ).not.toThrow();
    });
});

describe('secureHttp resolved address validation', () => {
    it('allows public resolved addresses', () => {
        for (const address of [
            '1.1.1.1',
            '8.8.8.8',
            '2001:4860:4860::8888',
            '2606:4700:4700::1111',
        ]) {
            expect(isPublicResolvedAddress(address)).toBe(true);
        }
    });

    it('refuses to connect when a hostname resolves to a private or reserved address', async () => {
        // Regression test: the resolved-address check must run on the
        // connection itself, not just exist as a helper — see guardedLookup.
        for (const url of [
            'http://resolves-private.test/',
            'http://resolves-metadata.test/',
        ]) {
            await expect(secureFetch(url)).rejects.toSatisfy((e: unknown) => {
                const err = e as Error & { cause?: Error };
                return /private or reserved/.test(
                    err.cause?.message ?? err.message,
                );
            });
        }
    });

    it('does not apply the connect-time guard when routed through the CORS proxy', async () => {
        // The proxy is admin-trusted config and may legitimately sit on a
        // private address; the user-supplied host is resolved by the proxy
        // worker, not locally. Point the proxy at a host our DNS mock
        // resolves to a private address: if the guard were (incorrectly)
        // applied, we'd see the SSRF refusal — instead the connection must
        // fail with an ordinary DNS error from the real resolver.
        configContainer.secureCorsProxy = {
            url: 'http://resolves-private.test/?url=',
            secret: 'test-secret',
        };
        try {
            await expect(
                secureFetch('http://some-user-supplied-host.test/'),
            ).rejects.toSatisfy((e: unknown) => {
                const err = e as Error & { cause?: Error };
                return !/private or reserved/.test(
                    err.cause?.message ?? err.message,
                );
            });
        } finally {
            delete configContainer.secureCorsProxy;
        }
    });

    it('rejects private, link-local, loopback, mapped, and reserved addresses', () => {
        for (const address of [
            '0.0.0.0',
            '10.0.0.1',
            '100.64.0.1',
            '127.0.0.1',
            '169.254.169.254',
            '172.16.0.1',
            '192.168.0.1',
            '198.18.0.1',
            '224.0.0.1',
            '255.255.255.255',
            '::',
            '::1',
            '::ffff:8.8.8.8',
            '0:0:0:0:0:ffff:8.8.8.8',
            '::ffff:808:808',
            'fc00::1',
            'fe80::1',
            'ff02::1',
        ]) {
            expect(isPublicResolvedAddress(address)).toBe(false);
        }
    });
});
