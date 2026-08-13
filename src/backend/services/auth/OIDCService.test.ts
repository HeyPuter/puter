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

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import {
    OIDCService as OIDCServiceClass,
    type OIDCService,
} from './OIDCService.js';

const TEST_ORIGIN = 'http://test.local';
const MS_CLIENT_ID = 'ms-client';
// Home tenant of personal Microsoft accounts — mirrors the constant in
// OIDCService.
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const ENTRA_TENANT = '3a8757eb-bf01-4b5d-83b2-90e0eaf21d10';
const KID = 'ms-key-1';

const MS_DISCOVERY_URL =
    'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration';
const MS_JWKS_URI =
    'https://login.microsoftonline.com/common/discovery/v2.0/keys';
const MS_USERINFO = 'https://graph.microsoft.com/oidc/userinfo';

const GOOGLE_DISCOVERY_URL =
    'https://accounts.google.com/.well-known/openid-configuration';
const APPLE_DISCOVERY_URL =
    'https://appleid.apple.com/.well-known/openid-configuration';
const CUSTOM_USERINFO = 'https://idp.example/userinfo';
const CUSTOM_TOKEN = 'https://idp.example/token';

let server: PuterServer;
let privateKey: crypto.KeyObject;
let jwk: Record<string, unknown>;
const fetchedUrls: string[] = [];
/** Per-test fetch responses, consulted before the built-in discovery stubs. */
const stubbedResponses = new Map<string, () => Partial<Response>>();

beforeAll(async () => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    jwk = {
        ...(pair.publicKey.export({ format: 'jwk' }) as Record<
            string,
            unknown
        >),
        kid: KID,
    };
    const applePair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
    });
    const applePrivateKeyPem = applePair.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString();

    server = await setupTestServer({
        origin: TEST_ORIGIN,
        oidc: {
            providers: {
                microsoft: {
                    client_id: MS_CLIENT_ID,
                    client_secret: 'ms-secret',
                },
                google: {
                    client_id: 'google-client',
                    client_secret: 'google-secret',
                },
                apple: {
                    client_id: 'apple-client',
                    team_id: 'TEAM123',
                    key_id: 'KEY123',
                    private_key: applePrivateKeyPem,
                },
                custom: {
                    client_id: 'custom-client',
                    client_secret: 'custom-secret',
                    authorization_endpoint: 'https://idp.example/authorize',
                    token_endpoint: CUSTOM_TOKEN,
                    userinfo_endpoint: CUSTOM_USERINFO,
                },
                // Rejected: a static client_secret is required.
                secretless: { client_id: 'secretless-client' },
                // Rejected: no client_id at all.
                nameless: { client_secret: 'x' },
                // Rejected: Apple needs the signing-key trio.
                halfApple: { client_id: 'half', client_secret: 'x' },
            },
        },
    } as never);

    // Serve discovery + JWKS over a fake fetch. The Graph userinfo endpoint
    // is deliberately NOT handled — Microsoft claims must come from the
    // verified id_token, never from userinfo.
    vi.stubGlobal('fetch', (async (input: unknown) => {
        const url = String(input);
        fetchedUrls.push(url);
        const stubbed = stubbedResponses.get(url);
        if (stubbed) return stubbed() as Response;
        if (url === MS_DISCOVERY_URL) {
            return {
                ok: true,
                json: async () => ({
                    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
                    authorization_endpoint:
                        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
                    token_endpoint:
                        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                    userinfo_endpoint: MS_USERINFO,
                    jwks_uri: MS_JWKS_URI,
                }),
            } as Response;
        }
        if (url === MS_JWKS_URI) {
            return {
                ok: true,
                json: async () => ({ keys: [jwk] }),
            } as Response;
        }
        if (url === GOOGLE_DISCOVERY_URL) {
            return {
                ok: true,
                json: async () => ({
                    issuer: 'https://accounts.google.com',
                    authorization_endpoint:
                        'https://accounts.google.com/o/oauth2/v2/auth',
                    token_endpoint: 'https://oauth2.googleapis.com/token',
                    userinfo_endpoint:
                        'https://openidconnect.googleapis.com/v1/userinfo',
                    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
                }),
            } as Response;
        }
        if (url === APPLE_DISCOVERY_URL) {
            return {
                ok: true,
                json: async () => ({
                    issuer: 'https://appleid.apple.com',
                    authorization_endpoint:
                        'https://appleid.apple.com/auth/authorize',
                    token_endpoint: 'https://appleid.apple.com/auth/token',
                    jwks_uri: 'https://appleid.apple.com/auth/keys',
                }),
            } as Response;
        }
        throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch);
});

afterAll(async () => {
    vi.unstubAllGlobals();
    await server?.shutdown();
});

const oidc = (): OIDCService => server.services.oidc as unknown as OIDCService;

const signMsIdToken = (
    tid: string,
    payload: Record<string, unknown> = {},
    key: crypto.KeyObject = privateKey,
): string =>
    jwt.sign({ tid, ...payload }, key, {
        algorithm: 'RS256',
        keyid: KID,
        subject: 'ms-sub-1',
        audience: MS_CLIENT_ID,
        issuer: `https://login.microsoftonline.com/${tid}/v2.0`,
        expiresIn: '5m',
    });

describe('OIDCService.getUserInfo (microsoft)', () => {
    it('reads claims from the verified id_token, never Graph userinfo', async () => {
        const info = await oidc().getUserInfo(
            'microsoft',
            'access-token',
            signMsIdToken(MSA_TENANT, { email: 'someone@outlook.com' }),
        );
        expect(info).toEqual({
            sub: 'ms-sub-1',
            email: 'someone@outlook.com',
            email_verified: true,
        });
        expect(fetchedUrls).not.toContain(MS_USERINFO);
    });

    it('marks Entra emails verified only when xms_edov attests them', async () => {
        const withEdov = await oidc().getUserInfo(
            'microsoft',
            'access-token',
            signMsIdToken(ENTRA_TENANT, {
                email: 'user@corp.example',
                xms_edov: true,
            }),
        );
        expect(withEdov?.email_verified).toBe(true);

        const withoutEdov = await oidc().getUserInfo(
            'microsoft',
            'access-token',
            signMsIdToken(ENTRA_TENANT, { email: 'user@corp.example' }),
        );
        expect(withoutEdov?.email_verified).toBe(false);
    });

    it('omits email (rather than inventing one) when the token has none', async () => {
        const info = await oidc().getUserInfo(
            'microsoft',
            'access-token',
            signMsIdToken(ENTRA_TENANT),
        );
        expect(info?.sub).toBe('ms-sub-1');
        expect(info?.email).toBeUndefined();
    });

    it('returns null when no id_token is supplied', async () => {
        const info = await oidc().getUserInfo('microsoft', 'access-token');
        expect(info).toBeNull();
    });

    it('returns null for an id_token signed by an unknown key', async () => {
        const otherKey = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
        }).privateKey;
        const forged = signMsIdToken(
            MSA_TENANT,
            { email: 'victim@outlook.com' },
            otherKey,
        );
        const info = await oidc().getUserInfo(
            'microsoft',
            'access-token',
            forged,
        );
        expect(info).toBeNull();
    });
});

describe('OIDCService.createUserFromOIDC', () => {
    const req = { headers: {}, ip: '127.0.0.1', socket: {} } as never;

    it('refuses to create an account when the provider returned no email', async () => {
        const result = await runWithContext({ req }, () =>
            oidc().createUserFromOIDC('microsoft', {
                sub: 'no-email-sub',
                email_verified: true,
            }),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/email/i);
    });

    it('refuses when the provider explicitly reports the email unverified', async () => {
        const result = await runWithContext({ req }, () =>
            oidc().createUserFromOIDC('microsoft', {
                sub: 'unverified-sub',
                email: 'someone@corp.example',
                email_verified: false,
            }),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/verify/i);
    });

    it('refuses to create a fresh account when registration is disabled', async () => {
        const oidcConfig = server.services.oidc.config as {
            disable_user_signup?: boolean;
        };
        const prev = oidcConfig.disable_user_signup;
        oidcConfig.disable_user_signup = true;
        try {
            const result = await runWithContext({ req }, () =>
                oidc().createUserFromOIDC('microsoft', {
                    sub: 'disabled-sub',
                    email: 'disabled@example.com',
                    email_verified: true,
                }),
            );
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/disabled/i);
        } finally {
            oidcConfig.disable_user_signup = prev;
        }
    });

    // Two callbacks for the same brand-new identity — a second tab, a provider
    // retry — used to each create an account and each link the same sub, since
    // neither the address nor the sub was constrained. Later sign-ins then
    // resolved to whichever row came back first.
    it('creates exactly one account for two simultaneous callbacks', async () => {
        const email = `race-${crypto.randomBytes(4).toString('hex')}@corp.example`;
        const sub = `race-sub-${crypto.randomBytes(4).toString('hex')}`;

        const results = await Promise.all([
            runWithContext({ req }, () =>
                oidc().createUserFromOIDC('custom-idp', {
                    sub,
                    email,
                    email_verified: true,
                }),
            ),
            runWithContext({ req }, () =>
                oidc().createUserFromOIDC('custom-idp', {
                    sub,
                    email,
                    email_verified: true,
                }),
            ),
        ]);

        expect(results.filter((r) => r.success)).toHaveLength(1);
        // The loser reports a race, not an error — the caller re-resolves onto
        // the winner rather than showing the user a failure.
        const loser = results.find((r) => !r.success)!;
        expect(loser.raced).toBe(true);
        expect(loser.error).toBeUndefined();

        const owners = (await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `user` WHERE `email` = ?',
            [email],
        )) as Array<{ n: number }>;
        expect(Number(owners[0].n)).toBe(1);

        // And exactly one link, so getByProviderSub cannot flip between
        // accounts on subsequent sign-ins.
        const links = (await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `user_oidc_providers` WHERE `provider_sub` = ?',
            [sub],
        )) as Array<{ n: number }>;
        expect(Number(links[0].n)).toBe(1);
    });

    it('reports a race rather than a failure when the address is already taken', async () => {
        const email = `taken-${crypto.randomBytes(4).toString('hex')}@corp.example`;
        await server.stores.user.create({
            username: `taken-${crypto.randomBytes(4).toString('hex')}`,
            uuid: crypto.randomUUID(),
            password: 'hashed',
            email,
            clean_email: email,
        });

        const result = await runWithContext({ req }, () =>
            oidc().createUserFromOIDC('custom-idp', {
                sub: `taken-sub-${crypto.randomBytes(4).toString('hex')}`,
                email,
                email_verified: true,
            }),
        );

        expect(result.success).toBe(false);
        expect(result.raced).toBe(true);
    });

    it('leaves no orphan account behind when the identity was linked first', async () => {
        // The sub is already bound to another account, so `link()` throws after
        // this call has created its own user. That account can never be signed
        // in to, so it must not survive.
        const sub = `orphan-sub-${crypto.randomBytes(4).toString('hex')}`;
        const incumbent = await server.stores.user.create({
            username: `incumbent-${crypto.randomBytes(4).toString('hex')}`,
            uuid: crypto.randomUUID(),
            password: null,
            email: `incumbent-${crypto.randomBytes(4).toString('hex')}@corp.example`,
        });
        await server.stores.oidc.link(incumbent.id, 'custom-idp', sub, null);

        const email = `orphan-${crypto.randomBytes(4).toString('hex')}@corp.example`;
        const before = (await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `user`',
        )) as Array<{ n: number }>;

        const result = await runWithContext({ req }, () =>
            oidc().createUserFromOIDC('custom-idp', {
                sub,
                email,
                email_verified: true,
            }),
        );

        expect(result.success).toBe(false);
        expect(result.raced).toBe(true);
        const after = (await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM `user`',
        )) as Array<{ n: number }>;
        expect(Number(after[0].n)).toBe(Number(before[0].n));
        expect(await server.stores.user.getByEmail(email)).toBeNull();
    });
});

describe('OIDCService.linkProviderToUser', () => {
    const makeConfirmedUser = async (): Promise<number> => {
        const username = `oidc-link-${crypto.randomBytes(4).toString('hex')}`;
        const created = await server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email: `${username}@corp.example`,
            requires_email_confirmation: false,
        });
        await server.stores.user.update(created.id, { email_confirmed: 1 });
        return created.id;
    };

    it('refuses to link to an existing account when the provider omits email_verified', async () => {
        const userId = await makeConfirmedUser();
        const result = await oidc().linkProviderToUser(userId, 'custom-idp', {
            sub: `attacker-${crypto.randomBytes(4).toString('hex')}`,
            email: 'anything@corp.example',
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/verify/i);
    });

    it('links when the provider attests email_verified: true', async () => {
        const userId = await makeConfirmedUser();
        const result = await oidc().linkProviderToUser(userId, 'custom-idp', {
            sub: `legit-${crypto.randomBytes(4).toString('hex')}`,
            email: 'anything@corp.example',
            email_verified: true,
        });
        expect(result.success).toBe(true);
    });
});

// -- Provider configuration -------------------------------------------

describe('OIDCService.getProviderConfig', () => {
    it('resolves Google endpoints from discovery', async () => {
        const config = await oidc().getProviderConfig('google');
        expect(config).toMatchObject({
            client_id: 'google-client',
            client_secret: 'google-secret',
            authorization_endpoint:
                'https://accounts.google.com/o/oauth2/v2/auth',
            userinfo_endpoint:
                'https://openidconnect.googleapis.com/v1/userinfo',
            scopes: 'openid email profile',
        });
        expect(config?.response_mode).toBeUndefined();
    });

    it('signs a fresh Apple client secret and asks for form_post', async () => {
        const config = await oidc().getProviderConfig('apple');
        expect(config).toMatchObject({
            client_id: 'apple-client',
            userinfo_endpoint: '',
            scopes: 'openid email',
            response_mode: 'form_post',
        });
        // The "secret" is an ES256 JWT the service mints per call.
        const [headerB64, payloadB64] = config!.client_secret.split('.');
        expect(
            JSON.parse(Buffer.from(headerB64, 'base64url').toString()),
        ).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
        const payload = JSON.parse(
            Buffer.from(payloadB64, 'base64url').toString(),
        );
        expect(payload).toMatchObject({
            iss: 'TEAM123',
            sub: 'apple-client',
            aud: 'https://appleid.apple.com',
        });
        expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('accepts a custom provider that declares all three endpoints', async () => {
        expect(await oidc().getProviderConfig('custom')).toEqual({
            client_id: 'custom-client',
            client_secret: 'custom-secret',
            authorization_endpoint: 'https://idp.example/authorize',
            token_endpoint: CUSTOM_TOKEN,
            userinfo_endpoint: CUSTOM_USERINFO,
            scopes: 'openid email profile',
        });
    });

    it("rejects providers missing a client id, a secret, or Apple's key trio", async () => {
        expect(await oidc().getProviderConfig('nameless')).toBeNull();
        expect(await oidc().getProviderConfig('secretless')).toBeNull();
        expect(await oidc().getProviderConfig('halfApple')).toBeNull();
        expect(await oidc().getProviderConfig('not-configured')).toBeNull();
    });

    it('lists exactly the providers that resolve', async () => {
        expect((await oidc().getEnabledProviderIds()).sort()).toEqual([
            'apple',
            'custom',
            'google',
            'microsoft',
        ]);
    });

    it('caches a successful discovery instead of refetching it', async () => {
        // Google was resolved earlier in this suite, so the second read is
        // served from the in-process discovery cache.
        expect(await oidc().getProviderConfig('google')).not.toBeNull();
        const before = fetchedUrls.length;
        expect(await oidc().getProviderConfig('google')).not.toBeNull();
        expect(fetchedUrls).toHaveLength(before);
    });

    it('yields null when discovery is unreachable or rejects', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // A fresh instance so the discovery cache is genuinely cold.
        const fresh = () => {
            const args = [
                {
                    origin: TEST_ORIGIN,
                    oidc: {
                        providers: {
                            google: {
                                client_id: 'g',
                                client_secret: 's',
                            },
                        },
                    },
                },
                {},
                {},
                {},
            ] as unknown as ConstructorParameters<typeof OIDCServiceClass>;
            const svc = new OIDCServiceClass(...args);
            svc.onServerStart();
            return svc;
        };

        try {
            stubbedResponses.set(GOOGLE_DISCOVERY_URL, () => ({ ok: false }));
            expect(await fresh().getProviderConfig('google')).toBeNull();

            stubbedResponses.set(GOOGLE_DISCOVERY_URL, () => {
                throw new Error('network down');
            });
            expect(await fresh().getProviderConfig('google')).toBeNull();
            expect(warn).toHaveBeenCalledWith(
                '[oidc] Google discovery fetch failed',
                expect.anything(),
            );
            expect(await fresh().getEnabledProviderIds()).toEqual([]);
        } finally {
            stubbedResponses.delete(GOOGLE_DISCOVERY_URL);
            warn.mockRestore();
        }
    });
});

describe('OIDCService — authorization URLs', () => {
    it('builds the callback URL for each supported flow and rejects others', () => {
        for (const flow of ['login', 'signup', 'revalidate']) {
            expect(oidc().getCallbackUrl(flow)).toBe(
                `${TEST_ORIGIN}/auth/oidc/callback/${flow}`,
            );
        }
        expect(oidc().getCallbackUrl('delete-account')).toBeNull();
    });

    it('assembles the provider authorize URL with the signed state', async () => {
        const url = await oidc().getAuthorizationUrl(
            'google',
            'state-token',
            'login',
        );
        const parsed = new URL(url!);
        expect(parsed.origin + parsed.pathname).toBe(
            'https://accounts.google.com/o/oauth2/v2/auth',
        );
        expect(Object.fromEntries(parsed.searchParams)).toEqual({
            client_id: 'google-client',
            redirect_uri: `${TEST_ORIGIN}/auth/oidc/callback/login`,
            response_type: 'code',
            scope: 'openid email profile',
            state: 'state-token',
        });
    });

    it('adds response_mode for providers that require it', async () => {
        const url = await oidc().getAuthorizationUrl(
            'apple',
            'state-token',
            'signup',
        );
        expect(new URL(url!).searchParams.get('response_mode')).toBe(
            'form_post',
        );
    });

    it('falls back to the unsuffixed callback for an unknown flow', async () => {
        const url = await oidc().getAuthorizationUrl(
            'google',
            'state-token',
            'bogus-flow',
        );
        expect(new URL(url!).searchParams.get('redirect_uri')).toBe(
            '/auth/oidc/callback',
        );
    });

    it('returns null for a provider that is not configured', async () => {
        expect(
            await oidc().getAuthorizationUrl('nope', 'state', 'login'),
        ).toBeNull();
    });
});

describe('OIDCService — state tokens', () => {
    it('round-trips a signed state payload', () => {
        const token = oidc().signState({ flow: 'login', origin: 'x' });
        expect(oidc().verifyState(token)).toMatchObject({
            flow: 'login',
            origin: 'x',
        });
    });

    it('rejects a tampered or unsigned state', () => {
        expect(oidc().verifyState('not-a-jwt')).toBeNull();
        const token = oidc().signState({ flow: 'login' });
        expect(oidc().verifyState(`${token}x`)).toBeNull();
    });

    it('round-trips a popup-return proof through the same verifier', () => {
        const token = oidc().signPopupReturn({
            opener_origin: 'https://app.test',
            logged_in: true,
        });
        expect(oidc().verifyPopupReturn(token)).toMatchObject({
            opener_origin: 'https://app.test',
            logged_in: true,
        });
        expect(oidc().verifyPopupReturn('garbage')).toBeNull();
    });

    it('signs a revalidation token naming the user and purpose', () => {
        const token = oidc().signRevalidation('user-uuid-1');
        expect(oidc().verifyState(token)).toMatchObject({
            user_uuid: 'user-uuid-1',
            purpose: 'revalidate',
        });
    });
});

describe('OIDCService.exchangeCodeForTokens', () => {
    it('posts the authorization code and returns the token response', async () => {
        let sentBody = '';
        stubbedResponses.set(CUSTOM_TOKEN, () => ({
            ok: true,
            json: async () => ({ access_token: 'at-1', id_token: 'it-1' }),
        }));
        const original = globalThis.fetch;
        vi.stubGlobal('fetch', (async (url: unknown, init: RequestInit) => {
            if (String(url) === CUSTOM_TOKEN) sentBody = String(init.body);
            return original(url as string, init);
        }) as typeof fetch);

        try {
            const tokens = await oidc().exchangeCodeForTokens(
                'custom',
                'auth-code',
                'https://app.test/cb',
            );
            expect(tokens).toEqual({
                access_token: 'at-1',
                id_token: 'it-1',
            });
            const params = new URLSearchParams(sentBody);
            expect(Object.fromEntries(params)).toEqual({
                grant_type: 'authorization_code',
                code: 'auth-code',
                redirect_uri: 'https://app.test/cb',
                client_id: 'custom-client',
                client_secret: 'custom-secret',
            });
        } finally {
            vi.stubGlobal('fetch', original);
            stubbedResponses.delete(CUSTOM_TOKEN);
        }
    });

    it('returns null (and logs) when the provider rejects the exchange', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubbedResponses.set(CUSTOM_TOKEN, () => ({
            ok: false,
            status: 400,
            text: async () => 'invalid_grant',
        }));
        try {
            expect(
                await oidc().exchangeCodeForTokens(
                    'custom',
                    'bad-code',
                    'https://app.test/cb',
                ),
            ).toBeNull();
            expect(warn).toHaveBeenCalledWith(
                '[oidc] token exchange failed',
                expect.objectContaining({ status: 400 }),
            );
        } finally {
            stubbedResponses.delete(CUSTOM_TOKEN);
            warn.mockRestore();
        }
    });

    it('returns null for an unconfigured provider without calling out', async () => {
        expect(
            await oidc().exchangeCodeForTokens('nope', 'code', 'https://x/cb'),
        ).toBeNull();
    });
});

describe('OIDCService.getUserInfo — userinfo endpoint providers', () => {
    it('returns the claims the userinfo endpoint serves', async () => {
        stubbedResponses.set(CUSTOM_USERINFO, () => ({
            ok: true,
            json: async () => ({
                sub: 'custom-sub',
                email: 'u@idp.example',
                email_verified: true,
            }),
        }));
        try {
            expect(await oidc().getUserInfo('custom', 'access-token')).toEqual({
                sub: 'custom-sub',
                email: 'u@idp.example',
                email_verified: true,
            });
        } finally {
            stubbedResponses.delete(CUSTOM_USERINFO);
        }
    });

    it('returns null when the userinfo call is rejected', async () => {
        stubbedResponses.set(CUSTOM_USERINFO, () => ({ ok: false }));
        try {
            expect(await oidc().getUserInfo('custom', 'bad-token')).toBeNull();
        } finally {
            stubbedResponses.delete(CUSTOM_USERINFO);
        }
    });

    it('returns null for an unconfigured provider', async () => {
        expect(await oidc().getUserInfo('nope', 'token')).toBeNull();
    });

    it('returns null for a provider with neither userinfo nor an id_token', async () => {
        expect(await oidc().getUserInfo('apple', 'access-token')).toBeNull();
    });
});

// -- User lookup / creation -------------------------------------------

describe('OIDCService — user lookup', () => {
    const makeUser = async (email: string | null) => {
        const username = `oidc-l-${crypto.randomBytes(4).toString('hex')}`;
        return server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email,
            clean_email: email ? email.replace(/\+.*@/, '@') : null,
            requires_email_confirmation: false,
        });
    };

    it('finds nothing for an unlinked provider sub', async () => {
        expect(
            await oidc().findUserByProviderSub('google', 'no-such-sub'),
        ).toBeNull();
    });

    it('resolves a user through their provider link', async () => {
        const user = await makeUser('linked@example.com');
        await server.stores.oidc.link(user.id, 'google', 'linked-sub', null);
        expect(
            (await oidc().findUserByProviderSub('google', 'linked-sub'))?.id,
        ).toBe(user.id);
        expect(await oidc().getLinkedProviderForUser(user.id)).toBe('google');
    });

    it('reports no linked provider for an unlinked user', async () => {
        const user = await makeUser('unlinked@example.com');
        expect(await oidc().getLinkedProviderForUser(user.id)).toBeNull();
    });

    it('matches on the primary email, then on the canonical form', async () => {
        expect(await oidc().findUserByEmail('')).toBeNull();

        const direct = await makeUser('direct@example.com');
        expect((await oidc().findUserByEmail('direct@example.com'))?.id).toBe(
            direct.id,
        );

        // Signed up as `plain@gmail.com`; the IdP reports a +tagged address.
        const canonical = await makeUser('plain@gmail.com');
        expect((await oidc().findUserByEmail('plain+tag@gmail.com'))?.id).toBe(
            canonical.id,
        );

        expect(await oidc().findUserByEmail('nobody@example.com')).toBeNull();
    });
});

describe('OIDCService.linkProviderToUser — account safety', () => {
    it('refuses to link to a user that no longer exists', async () => {
        expect(
            await oidc().linkProviderToUser(999_999, 'google', {
                sub: 'ghost',
                email: 'ghost@example.com',
                email_verified: true,
            }),
        ).toEqual({ success: false, error: 'User not found.' });
    });

    it('refuses to link to an account whose own email was never confirmed', async () => {
        const username = `oidc-unc-${crypto.randomBytes(4).toString('hex')}`;
        const user = await server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email: `${username}@example.com`,
            requires_email_confirmation: true,
        });
        const result = await oidc().linkProviderToUser(user.id, 'google', {
            sub: `unconfirmed-${username}`,
            email: `${username}@example.com`,
            email_verified: true,
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not confirmed/i);
    });
});

describe('OIDCService.createUserFromOIDC', () => {
    const req = {
        headers: { 'user-agent': 'test-agent', origin: 'https://app.test' },
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
    } as never;

    it('provisions the account, group membership, home tree and provider link', async () => {
        const email = `new-${crypto.randomBytes(4).toString('hex')}@example.com`;
        const signups: unknown[] = [];
        const onSignup = (_k: string, data: unknown) => signups.push(data);
        server.clients.event.on('puter.signup.success', onSignup);

        const result = await runWithContext({ req }, () =>
            oidc().createUserFromOIDC(
                'google',
                { sub: `new-sub-${email}`, email, email_verified: true },
                'ref-code',
            ),
        );

        expect(result.success).toBe(true);
        const user = result.user!;
        expect(user.email).toBe(email);
        // Provider already verified the address, so no email step.
        expect(user.email_confirmed).toBeTruthy();
        expect(user.requires_email_confirmation).toBeFalsy();
        expect(user.password).toBeNull();

        // Linked, grouped, and provisioned.
        expect(
            (await oidc().findUserByProviderSub('google', `new-sub-${email}`))
                ?.id,
        ).toBe(user.id);
        expect(await oidc().getLinkedProviderForUser(user.id)).toBe('google');
        expect(
            await server.stores.fsEntry.getEntryByPath(`/${user.username}`),
        ).toBeTruthy();
        expect(signups).toHaveLength(1);

        server.clients.event.off('puter.signup.success', onSignup);
    });

    it('honours a veto from the signup-validate hook, surfacing its code and trail id', async () => {
        const veto = (_k: string, data: unknown) => {
            const e = data as Record<string, unknown>;
            e.allow = false;
            e.message = 'Signup unavailable';
            e.code = 'blocked_by_policy';
            e.trail_id = 'trail-42';
        };
        server.clients.event.on('puter.signup.validate', veto);
        try {
            const result = await runWithContext({ req }, () =>
                oidc().createUserFromOIDC('google', {
                    sub: 'vetoed-sub',
                    email: 'vetoed@example.com',
                    email_verified: true,
                }),
            );
            expect(result).toMatchObject({
                success: false,
                error: 'Signup unavailable',
                code: 'blocked_by_policy',
                requestCode: 'trail-42',
            });
        } finally {
            server.clients.event.off('puter.signup.validate', veto);
        }
    });

    it('carries phone and card verification requirements onto the new account', async () => {
        const flag = (_k: string, data: unknown) => {
            const e = data as Record<string, unknown>;
            e.requires_phone_verification = true;
            e.requires_card_verification = true;
            e.reputation = 42;
        };
        server.clients.event.on('puter.signup.validate', flag);
        try {
            const email = `flagged-${crypto.randomBytes(4).toString('hex')}@example.com`;
            const result = await runWithContext({ req }, () =>
                oidc().createUserFromOIDC('google', {
                    sub: `flagged-${email}`,
                    email,
                    email_verified: true,
                }),
            );
            expect(result.success).toBe(true);
            expect(result.user?.requires_phone_verification).toBeTruthy();
            expect(result.user?.requires_card_verification).toBeTruthy();
        } finally {
            server.clients.event.off('puter.signup.validate', flag);
        }
    });

    it('refuses an email the email-validate hook rejects', async () => {
        const deny = (_k: string, data: unknown) => {
            const e = data as Record<string, unknown>;
            e.allow = false;
            e.message = 'Disposable addresses are not accepted.';
        };
        server.clients.event.on('email.validate', deny);
        try {
            const result = await runWithContext({ req }, () =>
                oidc().createUserFromOIDC('google', {
                    sub: 'denied-email-sub',
                    email: 'throwaway@example.com',
                    email_verified: true,
                }),
            );
            expect(result).toEqual({
                success: false,
                error: 'Disposable addresses are not accepted.',
            });
        } finally {
            server.clients.event.off('email.validate', deny);
        }
    });

    it('refuses an email whose domain is blocked by config', async () => {
        const cfg = server.services.oidc.config as {
            blockedEmailDomains?: string[];
        };
        const prev = cfg.blockedEmailDomains;
        cfg.blockedEmailDomains = ['blocked.example'];
        try {
            const result = await runWithContext({ req }, () =>
                oidc().createUserFromOIDC('google', {
                    sub: 'blocked-domain-sub',
                    email: 'someone@blocked.example',
                    email_verified: true,
                }),
            );
            expect(result).toEqual({
                success: false,
                error: 'This email is not allowed.',
            });
        } finally {
            cfg.blockedEmailDomains = prev;
        }
    });
});
