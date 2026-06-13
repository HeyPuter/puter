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

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { OIDCService } from './OIDCService.js';

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

let server: PuterServer;
let privateKey: crypto.KeyObject;
let jwk: Record<string, unknown>;
const fetchedUrls: string[] = [];

beforeAll(async () => {
    server = await setupTestServer({
        origin: TEST_ORIGIN,
        oidc: {
            providers: {
                microsoft: {
                    client_id: MS_CLIENT_ID,
                    client_secret: 'ms-secret',
                },
            },
        },
    } as never);

    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    jwk = {
        ...(pair.publicKey.export({ format: 'jwk' }) as Record<
            string,
            unknown
        >),
        kid: KID,
    };

    // Serve Microsoft discovery + JWKS over a fake fetch. The Graph
    // userinfo endpoint is deliberately NOT handled — Microsoft claims
    // must come from the verified id_token, never from userinfo.
    vi.stubGlobal('fetch', (async (input: unknown) => {
        const url = String(input);
        fetchedUrls.push(url);
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
        throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch);
});

afterAll(async () => {
    vi.unstubAllGlobals();
    await server?.shutdown();
});

const oidc = (): OIDCService =>
    server.services.oidc as unknown as OIDCService;

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
});
