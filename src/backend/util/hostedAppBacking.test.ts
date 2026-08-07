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

import { describe, expect, it, vi } from 'vitest';
import {
    buildHostedBackingDenial,
    buildHostedSubdomainIndexUrlCandidates,
    extractPuterHostedSubdomain,
    getPuterHostedDomains,
    hostedIndexUrlBackingIsUnavailable,
} from './hostedAppBacking.js';

// Pure-unit companion to the integration coverage in
// `AppDriver.test.ts` / `SuggestedAppsService.test.ts`. Those prove the
// guard is wired into each launch-metadata producer; these pin the
// decision logic itself, including branches that are awkward to provoke
// against a live store (replica lag, malformed owner ids, lookup errors).

const CONFIG = {
    static_hosting_domain: 'site.puter.localhost',
    static_hosting_domain_alt: 'puter.site',
    private_app_hosting_domain: 'private.puter.localhost',
};

const fakeStore = (
    impl: (
        subdomain: string,
        opts?: { primary?: boolean },
    ) => Promise<Record<string, unknown> | null>,
) => ({ getBySubdomain: vi.fn(impl) }) as never;

describe('getPuterHostedDomains', () => {
    it('collects, normalizes, and dedupes the configured domains', () => {
        expect(
            getPuterHostedDomains({
                static_hosting_domain: '  .Puter.Site  ',
                static_hosting_domain_alt: 'puter.site',
                private_app_hosting_domain: 'private.puter.localhost:4100',
            }).sort(),
        ).toEqual(['private.puter.localhost', 'puter.site']);
    });

    it('ignores absent and non-string config values', () => {
        expect(getPuterHostedDomains(undefined)).toEqual([]);
        expect(getPuterHostedDomains(null)).toEqual([]);
        expect(
            getPuterHostedDomains({
                static_hosting_domain: '',
                static_hosting_domain_alt: 42 as unknown as string,
            }),
        ).toEqual([]);
    });
});

describe('buildHostedSubdomainIndexUrlCandidates', () => {
    it('covers every hosting domain, protocol and path variant', () => {
        const candidates = buildHostedSubdomainIndexUrlCandidates('myapp', {
            static_hosting_domain: 'puter.site',
            protocol: 'https:',
        });
        expect(candidates).toEqual(
            expect.arrayContaining([
                'https://myapp.puter.site',
                'https://myapp.puter.site/',
                'https://myapp.puter.site/index.html',
                'http://myapp.puter.site',
                'http://myapp.puter.site/',
                'http://myapp.puter.site/index.html',
            ]),
        );
        // Nothing beyond the three path shapes the app write path accepts.
        expect(candidates).toHaveLength(6);
    });

    it('keeps both the ported and bare host for dev configs', () => {
        const candidates = buildHostedSubdomainIndexUrlCandidates('dev', {
            static_hosting_domain: 'site.puter.localhost:4100',
            protocol: 'http',
        });
        expect(candidates).toContain('http://dev.site.puter.localhost:4100/');
        expect(candidates).toContain('http://dev.site.puter.localhost/');
    });

    it('spans the alt and private hosting domains', () => {
        const candidates = buildHostedSubdomainIndexUrlCandidates('x', CONFIG);
        expect(candidates).toContain('https://x.puter.site/');
        expect(candidates).toContain('https://x.site.puter.localhost/');
        expect(candidates).toContain('https://x.private.puter.localhost/');
    });

    it('normalizes the name and refuses unusable input', () => {
        expect(
            buildHostedSubdomainIndexUrlCandidates('  MyApp  ', {
                static_hosting_domain: 'puter.site',
            }),
        ).toContain('https://myapp.puter.site/');
        expect(buildHostedSubdomainIndexUrlCandidates('', CONFIG)).toEqual([]);
        expect(buildHostedSubdomainIndexUrlCandidates(null, CONFIG)).toEqual(
            [],
        );
        expect(buildHostedSubdomainIndexUrlCandidates(42, CONFIG)).toEqual([]);
        // No hosting domain configured — nothing can be hosted, so nothing
        // is reserved.
        expect(buildHostedSubdomainIndexUrlCandidates('x', {})).toEqual([]);
    });
});

describe('extractPuterHostedSubdomain', () => {
    it('extracts the label from a hosted url', () => {
        expect(
            extractPuterHostedSubdomain('https://myapp.puter.site/', CONFIG),
        ).toBe('myapp');
    });

    it('matches the alt and private hosting domains too', () => {
        expect(
            extractPuterHostedSubdomain(
                'https://a.site.puter.localhost/index.html',
                CONFIG,
            ),
        ).toBe('a');
        expect(
            extractPuterHostedSubdomain(
                'https://b.private.puter.localhost/',
                CONFIG,
            ),
        ).toBe('b');
    });

    it('lowercases the hostname and ignores port and path', () => {
        expect(
            extractPuterHostedSubdomain(
                'https://MyApp.Puter.Site:8080/a/b?c=d#e',
                CONFIG,
            ),
        ).toBe('myapp');
    });

    it('prefers the longest matching hosting domain', () => {
        // `x.site.puter.localhost` ends with both `site.puter.localhost`
        // and (hypothetically) a shorter configured suffix. Longest wins,
        // so the label is `x` — not `x.site`.
        expect(
            extractPuterHostedSubdomain('https://x.site.puter.localhost/', {
                ...CONFIG,
                private_app_hosting_domain_alt: 'puter.localhost',
            }),
        ).toBe('x');
    });

    it('returns null for non-hosted, bare, and malformed urls', () => {
        expect(
            extractPuterHostedSubdomain('https://example.com/', CONFIG),
        ).toBeNull();
        // The apex domain itself has no subdomain label.
        expect(
            extractPuterHostedSubdomain('https://puter.site/', CONFIG),
        ).toBeNull();
        expect(extractPuterHostedSubdomain('not a url', CONFIG)).toBeNull();
        expect(extractPuterHostedSubdomain('', CONFIG)).toBeNull();
        expect(extractPuterHostedSubdomain(null, CONFIG)).toBeNull();
        expect(extractPuterHostedSubdomain(undefined, CONFIG)).toBeNull();
        expect(extractPuterHostedSubdomain(123, CONFIG)).toBeNull();
    });

    it('returns null when no hosting domains are configured', () => {
        expect(
            extractPuterHostedSubdomain('https://myapp.puter.site/', {}),
        ).toBeNull();
    });
});

describe('hostedIndexUrlBackingIsUnavailable', () => {
    it('is false for a non-hosted index_url without touching the store', async () => {
        const store = fakeStore(async () => null);
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://example.com/',
                    owner_user_id: 1,
                },
                subdomainStore: store,
                config: CONFIG,
            }),
        ).toBe(false);
        expect(
            (store as unknown as { getBySubdomain: ReturnType<typeof vi.fn> })
                .getBySubdomain,
        ).not.toHaveBeenCalled();
    });

    it('is false when the subdomain is still owned by the app owner', async () => {
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://mine.puter.site/',
                    owner_user_id: 7,
                },
                subdomainStore: fakeStore(async () => ({ user_id: 7 })),
                config: CONFIG,
            }),
        ).toBe(false);
    });

    it('is true when the subdomain no longer exists', async () => {
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://gone.puter.site/',
                    owner_user_id: 7,
                },
                subdomainStore: fakeStore(async () => null),
                config: CONFIG,
            }),
        ).toBe(true);
    });

    it('is true when the subdomain was reclaimed by another user', async () => {
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://taken.puter.site/',
                    owner_user_id: 7,
                },
                subdomainStore: fakeStore(async () => ({ user_id: 99 })),
                config: CONFIG,
            }),
        ).toBe(true);
    });

    it('re-checks the primary before declaring a replica miss dangling', async () => {
        // Mirrors the create/update ownership check: a freshly-created
        // subdomain may not have reached the replica yet, so a miss must
        // be confirmed against the primary rather than treated as gone.
        const getBySubdomain = vi.fn(
            async (_sub: string, opts?: { primary?: boolean }) =>
                opts?.primary ? { user_id: 7 } : null,
        );
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://fresh.puter.site/',
                    owner_user_id: 7,
                },
                subdomainStore: { getBySubdomain } as never,
                config: CONFIG,
            }),
        ).toBe(false);
        expect(getBySubdomain).toHaveBeenCalledTimes(2);
        expect(getBySubdomain).toHaveBeenLastCalledWith('fresh', {
            primary: true,
        });
    });

    it('is true when either owner id is not a usable integer', async () => {
        // `undefined` and non-numeric strings coerce to NaN, so neither
        // side can be compared — withhold rather than guess.
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: { index_url: 'https://orphan.puter.site/' },
                subdomainStore: fakeStore(async () => ({ user_id: 7 })),
                config: CONFIG,
            }),
        ).toBe(true);

        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://orphan.puter.site/',
                    owner_user_id: 7,
                },
                subdomainStore: fakeStore(async () => ({ user_id: 'abc' })),
                config: CONFIG,
            }),
        ).toBe(true);
    });

    it('is true for an ownerless app even though null coerces to 0', async () => {
        // Origin-bootstrapped apps carry `owner_user_id: null`. That is NOT
        // caught by the integer check — `Number(null)` is 0, a valid
        // integer — it falls through to the id comparison, where 0 can
        // never equal a real subdomain owner id. Pinned because the
        // outcome is right for a non-obvious reason: if the comparison
        // were ever loosened, this case would silently start passing.
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://orphan.puter.site/',
                    owner_user_id: null,
                },
                subdomainStore: fakeStore(async () => ({ user_id: 7 })),
                config: CONFIG,
            }),
        ).toBe(true);
    });

    it('compares owner ids across string/number representations', async () => {
        // MySQL and sqlite disagree on whether ids come back as strings;
        // the guard must not read that as a reclaim.
        expect(
            await hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://mine.puter.site/',
                    owner_user_id: '7',
                },
                subdomainStore: fakeStore(async () => ({ user_id: 7 })),
                config: CONFIG,
            }),
        ).toBe(false);
    });

    it('propagates store errors so callers decide the fail-closed policy', async () => {
        await expect(
            hostedIndexUrlBackingIsUnavailable({
                app: {
                    index_url: 'https://boom.puter.site/',
                    owner_user_id: 7,
                },
                subdomainStore: fakeStore(async () => {
                    throw new Error('db down');
                }),
                config: CONFIG,
            }),
        ).rejects.toThrow('db down');
    });
});

describe('buildHostedBackingDenial', () => {
    it('denies launch without redirecting to app-center', () => {
        // Empty `fallbackAppName` matters: this isn't an entitlement
        // problem, so the launcher must not bounce the user to a purchase
        // flow for an app whose backing is simply gone.
        expect(buildHostedBackingDenial()).toEqual({
            hasAccess: false,
            fallbackAppName: '',
            reason: 'hosted_backing_unavailable',
            checkedBy: 'core/hosted-subdomain-guard',
        });
    });
});
