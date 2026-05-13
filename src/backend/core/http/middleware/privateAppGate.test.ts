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

import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { AuthService } from '../../../services/auth/AuthService';
import { PuterServer } from '../../../server';
import { setupTestServer } from '../../../testUtil';
import type { IConfig } from '../../../types';
import {
    buildAppCenterFallback,
    buildHostingConfig,
    buildPrivateHostRedirect,
    buildPublicHostRedirect,
    getBootstrapToken,
    hostMatchesPrivateDomain,
    normalizeHost,
    normalizeHostRaw,
    renderLoginBootstrapHtml,
    resolvePrivateAppForHostedSite,
    resolvePrivateIdentity,
    resolvePublicHostedIdentity,
    subdomainFromHost,
} from './privateAppGate';

// ── Pure helpers ────────────────────────────────────────────────────
//
// These don't need a server, so they live above the harness.

describe('normalizeHost', () => {
    it('lowercases and strips port + leading dot', () => {
        expect(normalizeHost('Foo.Puter.Site:1234')).toBe('foo.puter.site');
        expect(normalizeHost('.foo.bar')).toBe('foo.bar');
        expect(normalizeHost('  foo.bar  ')).toBe('foo.bar');
    });

    it('returns null for non-strings, empty input, or bare port', () => {
        expect(normalizeHost(null)).toBeNull();
        expect(normalizeHost(undefined)).toBeNull();
        expect(normalizeHost(123 as unknown as string)).toBeNull();
        expect(normalizeHost('')).toBeNull();
        expect(normalizeHost('   ')).toBeNull();
        // `':1234'` → trimmed empty → bare-port case (head before `:` is '').
        expect(normalizeHost(':1234')).toBeNull();
    });
});

describe('normalizeHostRaw', () => {
    it('keeps the port (used for index_url candidate matching)', () => {
        expect(normalizeHostRaw('Foo.Puter.Site:1234')).toBe(
            'foo.puter.site:1234',
        );
    });

    it('still strips the leading dot and trims', () => {
        expect(normalizeHostRaw('.foo:80')).toBe('foo:80');
        expect(normalizeHostRaw('  foo.bar  ')).toBe('foo.bar');
    });

    it('returns null for missing / empty input', () => {
        expect(normalizeHostRaw(null)).toBeNull();
        expect(normalizeHostRaw(undefined)).toBeNull();
        expect(normalizeHostRaw('')).toBeNull();
        expect(normalizeHostRaw('   ')).toBeNull();
    });
});

describe('hostMatchesPrivateDomain', () => {
    it('matches exact host AND any subdomain of a private domain', () => {
        expect(hostMatchesPrivateDomain('app.puter.app', ['puter.app'])).toBe(
            true,
        );
        expect(
            hostMatchesPrivateDomain('foo.bar.puter.app', ['puter.app']),
        ).toBe(true);
        expect(hostMatchesPrivateDomain('puter.app', ['puter.app'])).toBe(true);
    });

    it('does not match unrelated or partial hosts', () => {
        expect(hostMatchesPrivateDomain('puter.site', ['puter.app'])).toBe(
            false,
        );
        // `notputer.app` must not pass — `.endsWith('puter.app')` is true
        // but the implementation requires a leading dot or exact match.
        expect(hostMatchesPrivateDomain('notputer.app', ['puter.app'])).toBe(
            false,
        );
        expect(hostMatchesPrivateDomain('a.puter.app', [])).toBe(false);
    });
});

describe('subdomainFromHost', () => {
    it('returns the left-most label for a multi-label subdomain', () => {
        expect(subdomainFromHost('app.puter.site', ['puter.site'])).toBe('app');
        expect(
            subdomainFromHost('one.two.three.puter.site', ['puter.site']),
        ).toBe('one');
    });

    it('prefers longest-matching hosting domain (avoids over-stripping)', () => {
        // `bar.puter.app` is configured as a hosting domain itself, so a
        // visit to `foo.bar.puter.app` should pull `foo`, not `foo.bar`.
        expect(
            subdomainFromHost('foo.bar.puter.app', [
                'puter.app',
                'bar.puter.app',
            ]),
        ).toBe('foo');
    });

    it('returns empty for the bare hosting domain', () => {
        expect(subdomainFromHost('puter.site', ['puter.site'])).toBe('');
    });

    it('falls back to first label when host matches no configured domain', () => {
        expect(subdomainFromHost('foo.example.com', ['puter.site'])).toBe(
            'foo',
        );
    });
});

describe('buildHostingConfig', () => {
    it('normalizes domains, fills raw counterparts, and resolves protocol', () => {
        const cfg = buildHostingConfig({
            domain: 'puter.localhost',
            static_hosting_domain: 'Site.Puter.Localhost:4100',
            static_hosting_domain_alt: 'host.puter.localhost',
            private_app_hosting_domain: 'App.Puter.Localhost:4100',
            private_app_hosting_domain_alt: 'dev.puter.localhost',
            protocol: 'http:',
        } as unknown as IConfig);
        expect(cfg.domain).toBe('puter.localhost');
        expect(cfg.staticDomains).toContain('site.puter.localhost');
        expect(cfg.staticDomainsRaw).toContain('site.puter.localhost:4100');
        expect(cfg.privateDomains).toContain('app.puter.localhost');
        expect(cfg.privateDomainsRaw).toContain('app.puter.localhost:4100');
        // Protocol trims a trailing colon and falls back to https.
        expect(cfg.protocol).toBe('http');
    });

    it('falls back to https when protocol is missing or non-string', () => {
        const cfg = buildHostingConfig({
            domain: 'p.localhost',
            static_hosting_domain: 's.localhost',
            static_hosting_domain_alt: null,
            private_app_hosting_domain: 'a.localhost',
            private_app_hosting_domain_alt: null,
            protocol: undefined,
        } as unknown as IConfig);
        expect(cfg.protocol).toBe('https');
        // null/undefined alts get filtered out.
        expect(cfg.staticDomains).toEqual(['s.localhost']);
        expect(cfg.privateDomains).toEqual(['a.localhost']);
    });
});

// ── Bootstrap token extraction ──────────────────────────────────────

describe('getBootstrapToken', () => {
    const reqOf = (init: Partial<Request>): Request =>
        ({
            headers: init.headers ?? {},
            query: init.query ?? {},
        }) as unknown as Request;

    it('prefers Bearer authorization over every other source', () => {
        const got = getBootstrapToken(
            reqOf({
                headers: {
                    authorization: 'Bearer header-token',
                    'x-puter-auth-token': 'x-token',
                    referer: 'https://x.test/?puter.auth.token=ref-token',
                },
                query: { 'puter.auth.token': 'query-token' },
            }),
        );
        expect(got).toEqual({ token: 'header-token', source: 'authorization' });
    });

    it('falls back through query → x-header → referer', () => {
        expect(
            getBootstrapToken(
                reqOf({ query: { 'puter.auth.token': 'q' } }),
            ),
        ).toEqual({ token: 'q', source: 'query' });
        expect(
            getBootstrapToken(
                reqOf({ headers: { 'x-puter-auth-token': 'x' } }),
            ),
        ).toEqual({ token: 'x', source: 'authorization' });
        expect(
            getBootstrapToken(
                reqOf({
                    headers: {
                        referer: 'https://x.test/?puter.auth.token=ref',
                    },
                }),
            ),
        ).toEqual({ token: 'ref', source: 'referrer' });
    });

    it('also accepts `auth_token` in query and `referrer` header spelling', () => {
        expect(
            getBootstrapToken(reqOf({ query: { auth_token: 'q' } })),
        ).toEqual({ token: 'q', source: 'query' });
        // Note: the alt spelling lives on `req.headers.referrer`.
        expect(
            getBootstrapToken(
                reqOf({
                    headers: {
                        referrer:
                            'https://x.test/?auth_token=ref',
                    } as Record<string, string>,
                }),
            ),
        ).toEqual({ token: 'ref', source: 'referrer' });
    });

    it('returns null when no source has a usable token', () => {
        expect(getBootstrapToken(reqOf({}))).toBeNull();
        // Empty/whitespace values must not count.
        expect(
            getBootstrapToken(
                reqOf({
                    headers: { authorization: 'Bearer   ', 'x-puter-auth-token': '   ' },
                    query: { 'puter.auth.token': '   ' },
                }),
            ),
        ).toBeNull();
    });

    it('returns null for a malformed referer header', () => {
        expect(
            getBootstrapToken(
                reqOf({ headers: { referer: 'not a url' } }),
            ),
        ).toBeNull();
    });
});

// ── Redirect helpers ────────────────────────────────────────────────

describe('buildAppCenterFallback', () => {
    const cfg = buildHostingConfig({
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_domain_alt: null,
        private_app_hosting_domain: 'app.puter.localhost',
        private_app_hosting_domain_alt: null,
        protocol: 'http',
    } as unknown as IConfig);

    it('encodes the app name into the app-center query string', () => {
        const url = buildAppCenterFallback({ name: 'cool app & co' }, cfg);
        expect(url).toBe(
            'https://puter.localhost/app/app-center/?item=cool%20app%20%26%20co',
        );
    });

    it('falls back to uid when name is missing/blank', () => {
        const url = buildAppCenterFallback(
            { name: '   ', uid: 'app-1234' },
            cfg,
        );
        expect(url).toBe(
            'https://puter.localhost/app/app-center/?item=app-1234',
        );
    });

    it("returns '/' when no main domain is configured", () => {
        const empty = { ...cfg, domain: null };
        expect(buildAppCenterFallback({ name: 'x' }, empty)).toBe('/');
    });
});

describe('buildPrivateHostRedirect', () => {
    const cfg = buildHostingConfig({
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_domain_alt: null,
        private_app_hosting_domain: 'app.puter.localhost:4100',
        private_app_hosting_domain_alt: null,
        protocol: 'http',
    } as unknown as IConfig);

    const reqOf = (init: Partial<Request>): Request =>
        ({
            hostname: init.hostname,
            originalUrl: init.originalUrl,
            protocol: init.protocol ?? 'http',
            headers: init.headers ?? {},
        }) as unknown as Request;

    it('swaps the public hosting domain for the private one (preserving port)', () => {
        const url = buildPrivateHostRedirect(
            reqOf({
                hostname: 'beans.site.puter.localhost',
                originalUrl: '/some/path?x=1',
            }),
            { name: 'beans', uid: 'app-1' },
            cfg,
        );
        expect(url).toBe(
            'http://beans.app.puter.localhost:4100/some/path?x=1',
        );
    });

    it("defaults the path to '/' when originalUrl is empty", () => {
        const url = buildPrivateHostRedirect(
            reqOf({ hostname: 'beans.site.puter.localhost' }),
            { name: 'beans' },
            cfg,
        );
        expect(url).toBe('http://beans.app.puter.localhost:4100/');
    });

    it('returns null when no private hosting domain is configured', () => {
        const noPrivate = {
            ...cfg,
            privateDomains: [],
            privateDomainsRaw: [],
        };
        expect(
            buildPrivateHostRedirect(
                reqOf({ hostname: 'beans.site.puter.localhost' }),
                { name: 'beans' },
                noPrivate,
            ),
        ).toBeNull();
    });

    it('returns null for the bare hosting domain (no subdomain to forward)', () => {
        expect(
            buildPrivateHostRedirect(
                reqOf({ hostname: 'site.puter.localhost' }),
                { name: 'beans' },
                cfg,
            ),
        ).toBeNull();
    });
});

describe('buildPublicHostRedirect', () => {
    // Mirror of buildPrivateHostRedirect — swaps the private hosting
    // domain for the public one. Used when a non-private app (or no app
    // at all) hits the private host, so a paid-→-free app's old
    // `puter.app` URL still resolves on `puter.site`.
    const cfg = buildHostingConfig({
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost:4100',
        static_hosting_domain_alt: null,
        private_app_hosting_domain: 'app.puter.localhost',
        private_app_hosting_domain_alt: null,
        protocol: 'http',
    } as unknown as IConfig);

    const reqOf = (init: Partial<Request>): Request =>
        ({
            hostname: init.hostname,
            originalUrl: init.originalUrl,
            protocol: init.protocol ?? 'http',
            headers: init.headers ?? {},
        }) as unknown as Request;

    it('swaps the private hosting domain for the public one (preserving port + path + query)', () => {
        const url = buildPublicHostRedirect(
            reqOf({
                hostname: 'beans.app.puter.localhost',
                originalUrl: '/some/path?x=1',
            }),
            cfg,
        );
        expect(url).toBe(
            'http://beans.site.puter.localhost:4100/some/path?x=1',
        );
    });

    it("defaults the path to '/' when originalUrl is empty", () => {
        const url = buildPublicHostRedirect(
            reqOf({ hostname: 'beans.app.puter.localhost' }),
            cfg,
        );
        expect(url).toBe('http://beans.site.puter.localhost:4100/');
    });

    it('returns null when no public hosting domain is configured', () => {
        const noPublic = {
            ...cfg,
            staticDomains: [],
            staticDomainsRaw: [],
        };
        expect(
            buildPublicHostRedirect(
                reqOf({ hostname: 'beans.app.puter.localhost' }),
                noPublic,
            ),
        ).toBeNull();
    });

    it('returns null for the bare private host (no subdomain to forward)', () => {
        expect(
            buildPublicHostRedirect(
                reqOf({ hostname: 'app.puter.localhost' }),
                cfg,
            ),
        ).toBeNull();
    });
});

// ── Login bootstrap HTML ────────────────────────────────────────────

describe('renderLoginBootstrapHtml', () => {
    it('embeds the app title/name and escapes HTML-dangerous characters', () => {
        const html = renderLoginBootstrapHtml({
            name: '<script>alert(1)</script>',
            // `title` is optional / not in AppLike — cast to keep the test
            // honest about what the renderer accepts.
            ...({ title: 'My "Cool" App' } as Record<string, unknown>),
        });
        expect(html).toContain('<title>Sign In Required | My &quot;Cool&quot; App</title>');
        // The <script> in the name must be encoded, not rendered.
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script>alert(1)</script>');
        // The page itself still has script tags (puter.js + bootstrap glue),
        // so just confirm the escaped content isn't accidentally unescaped.
        expect(html).toMatch(/<!doctype html>/i);
    });

    it("uses 'this app' fallback when no name/title is present", () => {
        const html = renderLoginBootstrapHtml({});
        expect(html).toContain('this app');
    });
});

// ── Server-backed helpers (AuthService + DB) ─────────────────────────
//
// `resolvePrivateAppForHostedSite` queries the apps table directly;
// `resolvePrivateIdentity` / `resolvePublicHostedIdentity` rely on the
// real AuthService for token verification + cookie naming.

let server: PuterServer;
let authService: AuthService;

beforeAll(async () => {
    server = await setupTestServer();
    authService = server.services.auth as unknown as AuthService;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<{
    id: number;
    uuid: string;
    username: string;
}> => {
    const username = `pag-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const refreshed = (await server.stores.user.getById(created.id))!;
    return {
        id: refreshed.id,
        uuid: refreshed.uuid,
        username: refreshed.username,
    };
};

const createPrivateApp = async (
    ownerId: number,
    indexUrl: string,
): Promise<{ id: number; uid: string }> => {
    const uid = `app-${uuidv4()}`;
    await server.clients.db.write(
        `INSERT INTO \`apps\` (\`uid\`, \`name\`, \`title\`, \`index_url\`, \`owner_user_id\`, \`is_private\`)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            uid,
            `private-${uid}`,
            `private-${uid}`,
            indexUrl,
            ownerId,
            1,
        ],
    );
    const row = (
        await server.clients.db.read('SELECT id, uid FROM apps WHERE uid = ?', [
            uid,
        ])
    )[0] as { id: number; uid: string };
    return row;
};

const baseConfig = () =>
    buildHostingConfig({
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_domain_alt: 'host.puter.localhost',
        private_app_hosting_domain: 'app.puter.localhost',
        private_app_hosting_domain_alt: 'dev.puter.localhost',
        protocol: 'http',
    } as unknown as IConfig);

describe('resolvePrivateAppForHostedSite', () => {
    const reqOf = (host: string): Request =>
        ({
            hostname: host,
            protocol: 'http',
            headers: { host },
        }) as unknown as Request;

    it('returns the associated app immediately when it is already private', async () => {
        const owner = await makeUser();
        const associatedApp = {
            id: 1,
            uid: 'app-direct',
            is_private: 1,
            owner_user_id: owner.id,
        };
        const out = await resolvePrivateAppForHostedSite({
            req: reqOf('beans.site.puter.localhost'),
            site: { user_id: owner.id, associated_app_id: 1 },
            associatedApp,
            db: server.clients.db,
            config: baseConfig(),
            matchedHostingDomain: 'site.puter.localhost',
        });
        expect(out?.uid).toBe('app-direct');
    });

    it('falls back to an index_url lookup when associated_app_id is unset', async () => {
        const owner = await makeUser();
        // Private app registered with a URL on the static hosting domain.
        // The visitor lands on the equivalent private host — the helper
        // should still find it.
        const app = await createPrivateApp(
            owner.id,
            'http://beans.site.puter.localhost/',
        );
        const out = await resolvePrivateAppForHostedSite({
            req: reqOf('beans.app.puter.localhost'),
            site: { user_id: owner.id, associated_app_id: null },
            associatedApp: null,
            db: server.clients.db,
            config: baseConfig(),
            matchedHostingDomain: 'app.puter.localhost',
        });
        expect(out?.uid).toBe(app.uid);
    });

    it('returns the original associated app when no index_url matches', async () => {
        const owner = await makeUser();
        const associatedApp = {
            id: 99,
            uid: 'app-public',
            is_private: 0,
            owner_user_id: owner.id,
        };
        const out = await resolvePrivateAppForHostedSite({
            req: reqOf('orphan.site.puter.localhost'),
            site: { user_id: owner.id, associated_app_id: 99 },
            associatedApp,
            db: server.clients.db,
            config: baseConfig(),
            matchedHostingDomain: 'site.puter.localhost',
        });
        expect(out?.uid).toBe('app-public');
    });

    it('returns null when the site has no owner', async () => {
        const out = await resolvePrivateAppForHostedSite({
            req: reqOf('beans.site.puter.localhost'),
            site: { user_id: null, associated_app_id: null },
            associatedApp: null,
            db: server.clients.db,
            config: baseConfig(),
            matchedHostingDomain: 'site.puter.localhost',
        });
        expect(out).toBeNull();
    });

    it("returns null on a request whose host can't be parsed", async () => {
        const out = await resolvePrivateAppForHostedSite({
            req: reqOf(''),
            site: { user_id: 1, associated_app_id: null },
            associatedApp: null,
            db: server.clients.db,
            config: baseConfig(),
            matchedHostingDomain: 'site.puter.localhost',
        });
        expect(out).toBeNull();
    });
});

describe('resolvePrivateIdentity', () => {
    const reqOf = (init: {
        cookies?: Record<string, string>;
        actor?: unknown;
        headers?: Record<string, string>;
        query?: Record<string, unknown>;
    }): Request =>
        ({
            cookies: init.cookies ?? {},
            actor: init.actor,
            headers: init.headers ?? {},
            query: init.query ?? {},
        }) as unknown as Request;

    it('returns the sticky private-cookie identity when the token matches the expected app/subdomain/host', async () => {
        const user = await makeUser();
        const appUid = `app-${uuidv4()}`;
        const token = authService.createPrivateAssetToken({
            appUid,
            userUid: user.uuid,
            subdomain: 'beans',
            privateHost: 'beans.app.puter.localhost',
        });
        const out = await resolvePrivateIdentity({
            req: reqOf({
                cookies: {
                    [authService.getPrivateAssetCookieName()]: token,
                },
            }),
            authService,
            sessionCookieName: 'puter_auth_token',
            expectedAppUid: appUid,
            expectedSubdomain: 'beans',
            expectedPrivateHost: 'beans.app.puter.localhost',
        });
        expect(out.source).toBe('private-cookie');
        expect(out.userUid).toBe(user.uuid);
        expect(out.hasValidPrivateCookie).toBe(true);
    });

    it('falls through to req.actor when the private cookie is for a different app', async () => {
        const user = await makeUser();
        const wrongToken = authService.createPrivateAssetToken({
            appUid: `app-${uuidv4()}`,
            userUid: user.uuid,
            subdomain: 'beans',
            privateHost: 'beans.app.puter.localhost',
        });
        const out = await resolvePrivateIdentity({
            req: reqOf({
                cookies: {
                    [authService.getPrivateAssetCookieName()]: wrongToken,
                },
                actor: {
                    user: { uuid: user.uuid },
                    session: { uid: 'sess-1' },
                },
            }),
            authService,
            sessionCookieName: 'puter_auth_token',
            expectedAppUid: `app-${uuidv4()}`,
        });
        expect(out.source).toBe('session-cookie');
        expect(out.userUid).toBe(user.uuid);
        expect(out.sessionUuid).toBe('sess-1');
        expect(out.hasValidPrivateCookie).toBeUndefined();
    });

    it("returns source='none' when nothing yields an identity", async () => {
        const out = await resolvePrivateIdentity({
            req: reqOf({
                cookies: {},
                headers: { authorization: 'Bearer not-a-real-token' },
            }),
            authService,
            sessionCookieName: 'puter_auth_token',
        });
        expect(out.source).toBe('none');
        expect(out.userUid).toBeUndefined();
    });
});

describe('resolvePublicHostedIdentity', () => {
    const reqOf = (init: {
        cookies?: Record<string, string>;
        actor?: unknown;
    }): Request =>
        ({
            cookies: init.cookies ?? {},
            actor: init.actor,
            headers: {},
            query: {},
        }) as unknown as Request;

    it('returns the cookie identity when present and valid', async () => {
        const user = await makeUser();
        const appUid = `app-${uuidv4()}`;
        const token = authService.createPublicHostedActorToken({
            appUid,
            userUid: user.uuid,
            subdomain: 'beans',
            host: 'beans.site.puter.localhost',
        });
        const out = await resolvePublicHostedIdentity({
            req: reqOf({
                cookies: {
                    [authService.getPublicHostedActorCookieName()]: token,
                },
            }),
            authService,
            sessionCookieName: 'puter_auth_token',
            expectedAppUid: appUid,
            expectedSubdomain: 'beans',
            expectedHost: 'beans.site.puter.localhost',
        });
        expect(out.source).toBe('private-cookie');
        expect(out.userUid).toBe(user.uuid);
        expect(
            (out as { hasValidPublicCookie?: boolean }).hasValidPublicCookie,
        ).toBe(true);
    });

    it('uses req.actor as a fallback for cross-host visitors', async () => {
        const user = await makeUser();
        const out = await resolvePublicHostedIdentity({
            req: reqOf({
                actor: {
                    user: { uuid: user.uuid },
                    session: { uid: 'sess-pub' },
                },
            }),
            authService,
            sessionCookieName: 'puter_auth_token',
        });
        expect(out.source).toBe('session-cookie');
        expect(out.userUid).toBe(user.uuid);
        expect(out.sessionUuid).toBe('sess-pub');
    });

    it("returns source='none' when nothing yields an identity", async () => {
        const out = await resolvePublicHostedIdentity({
            req: reqOf({}),
            authService,
            sessionCookieName: 'puter_auth_token',
        });
        expect(out.source).toBe('none');
    });
});
