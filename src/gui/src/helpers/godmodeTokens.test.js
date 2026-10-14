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

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
    forgetGodmodeTokens,
    mintGodmodeToken,
    renewGodmodeToken,
    reusableGodmodeToken,
    sameTokenRow,
    shouldRenew,
    trackGodmodeToken,
} from './godmodeTokens.js';

const HOUR_MS = 60 * 60 * 1000;
const jwtFor = (tokenUid) =>
    `h.${Buffer.from(JSON.stringify({ token_uid: tokenUid })).toString('base64url')}.s`;
// Lets a message cross to another channel instance.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const reply = (status, body) =>
    vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }));

const deps = (fetchImpl) => ({
    fetchImpl,
    apiOrigin: 'https://api.test',
    authToken: 'session',
});

describe('shouldRenew', () => {
    it('renews once less than six hours are left', () => {
        const now = Date.now();
        const expiresIn = (ms) => Math.floor((now + ms) / 1000);
        expect(shouldRenew(expiresIn(11 * HOUR_MS), now)).toBe(false);
        expect(shouldRenew(expiresIn(5 * HOUR_MS), now)).toBe(true);
        expect(shouldRenew(expiresIn(-HOUR_MS), now)).toBe(true);
    });

    it('renews a token with no known expiry', () => {
        expect(shouldRenew(NaN, Date.now())).toBe(true);
    });
});

describe('mintGodmodeToken', () => {
    it('returns the app token the server issued', async () => {
        const fetchImpl = reply(200, {
            token: 'jwt',
            app_uid: 'app-1',
            godmode: true,
            expires_at: 123,
        });
        expect(await mintGodmodeToken('app-1', deps(fetchImpl))).toEqual({
            ok: true,
            token: 'jwt',
            expiresAt: 123,
        });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.test/auth/get-user-app-token');
        expect(init.headers.Authorization).toBe('Bearer session');
        expect(JSON.parse(init.body)).toEqual({ app_uid: 'app-1' });
    });

    it('never adopts an ordinary app token for a godmode app', async () => {
        // A server that doesn't treat the app as godmode.
        const fetchImpl = reply(200, { token: 'app-under-user', app_uid: 'app-1' });
        expect(await mintGodmodeToken('app-1', deps(fetchImpl))).toEqual({
            ok: false,
            status: 200,
        });
    });

    it('reports a refusal and a network failure', async () => {
        expect(await mintGodmodeToken('app-1', deps(reply(403, {})))).toEqual({
            ok: false,
            status: 403,
        });
        const failing = vi.fn(async () => {
            throw new Error('offline');
        });
        const result = await mintGodmodeToken('app-1', deps(failing));
        expect(result.ok).toBe(false);
    });
});

describe('sameTokenRow', () => {
    const jwt = (payload) =>
        `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

    it('matches two signings of one token row', () => {
        expect(sameTokenRow(jwt({ token_uid: 't1', iat: 1 }), jwt({ token_uid: 't1', iat: 2 }))).toBe(true);
    });

    it('tells a replacement row apart, and never matches what it cannot read', () => {
        expect(sameTokenRow(jwt({ token_uid: 't1' }), jwt({ token_uid: 't2' }))).toBe(false);
        expect(sameTokenRow(jwt({}), jwt({}))).toBe(false);
        expect(sameTokenRow('garbage', 'garbage')).toBe(false);
    });
});

describe('reusableGodmodeToken', () => {
    const MINUTE_MS = 60 * 1000;
    const minted = (expiresInMs = 12 * HOUR_MS) => reply(200, {
        token: 'jwt',
        godmode: true,
        expires_at: Math.floor((Date.now() + expiresInMs) / 1000),
    });

    beforeEach(() => forgetGodmodeTokens());

    it('hands a launch the token minted moments ago under the same session', async () => {
        await mintGodmodeToken('app-1', deps(minted()));
        const reused = reusableGodmodeToken('app-1', { authToken: 'session' });
        expect(reused).toMatchObject({ ok: true, token: 'jwt' });
        expect(reused.mintedAt).toBeLessThanOrEqual(Date.now());
    });

    it('never hands a token to another session or another app', async () => {
        await mintGodmodeToken('app-1', deps(minted()));
        expect(reusableGodmodeToken('app-1', { authToken: 'other-session' })).toBeNull();
        expect(reusableGodmodeToken('app-2', { authToken: 'session' })).toBeNull();
    });

    it('asks again once the mint is ten minutes old or the token is due for renewal', async () => {
        await mintGodmodeToken('app-1', deps(minted()));
        const later = (ms) => ({ authToken: 'session', nowMs: Date.now() + ms });
        expect(reusableGodmodeToken('app-1', later(9 * MINUTE_MS))).not.toBeNull();
        expect(reusableGodmodeToken('app-1', later(10 * MINUTE_MS))).toBeNull();

        await mintGodmodeToken('app-2', deps(minted(5 * HOUR_MS)));
        expect(reusableGodmodeToken('app-2', { authToken: 'session' })).toBeNull();
    });

    it('remembers nothing from a mint that was in flight when tokens were forgotten', async () => {
        let answer;
        const fetchImpl = vi.fn(() => new Promise((resolve) => {
            answer = resolve;
        }));
        const pending = mintGodmodeToken('app-1', deps(fetchImpl));
        forgetGodmodeTokens('app-1');
        answer({
            ok: true,
            status: 200,
            json: async () => ({ token: 'jwt', godmode: true, expires_at: Math.floor(Date.now() / 1000) + 12 * 60 * 60 }),
        });

        expect((await pending).ok).toBe(true);
        expect(reusableGodmodeToken('app-1', { authToken: 'session' })).toBeNull();
    });

    it('remembers nothing from a failed mint', async () => {
        await mintGodmodeToken('app-1', deps(reply(403, {})));
        expect(reusableGodmodeToken('app-1', { authToken: 'session' })).toBeNull();
    });

    it('forgets one app, or every app, once sessions are revoked', async () => {
        await mintGodmodeToken('app-1', deps(minted()));
        await mintGodmodeToken('app-2', deps(minted()));
        forgetGodmodeTokens('app-1');
        expect(reusableGodmodeToken('app-1', { authToken: 'session' })).toBeNull();
        expect(reusableGodmodeToken('app-2', { authToken: 'session' })).not.toBeNull();
        forgetGodmodeTokens();
        expect(reusableGodmodeToken('app-2', { authToken: 'session' })).toBeNull();
    });
});

describe('renewGodmodeToken', () => {
    const jwt = (tokenUid) =>
        `h.${Buffer.from(JSON.stringify({ token_uid: tokenUid })).toString('base64url')}.s`;
    let postMessage;

    beforeEach(() => {
        forgetGodmodeTokens();
        postMessage = vi.fn();
        vi.stubGlobal('window', {
            api_origin: 'https://api.test',
            auth_token: 'session',
            iframe_for_app_instance: () => ({
                src: 'https://app.test/',
                contentWindow: { postMessage },
            }),
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('stops reusing a token once an app reports it dead', async () => {
        await mintGodmodeToken('app-1', deps(reply(200, {
            token: jwt('t1'),
            godmode: true,
            expires_at: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        })));
        const reused = reusableGodmodeToken('app-1');
        trackGodmodeToken('instance-dead', 'app-1', reused.token, reused.expiresAt, reused.mintedAt);

        // Inside the cooldown the app is sent the same token, but no launch
        // reuses it any more.
        await renewGodmodeToken('instance-dead', { origin: 'https://app.test' });
        expect(reusableGodmodeToken('app-1')).toBeNull();
    });

    it('mints afresh for a reused token whose mint is past the cooldown', async () => {
        const fetchImpl = reply(200, {
            token: jwt('t2'),
            godmode: true,
            expires_at: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        });
        vi.stubGlobal('fetch', fetchImpl);
        // Reused from a mint a minute ago, not minted for this launch.
        trackGodmodeToken('instance-reused', 'app-1', jwt('t1'), 0, Date.now() - 60 * 1000);

        expect(await renewGodmodeToken('instance-reused', { origin: 'https://app.test' })).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ msg: 'puter.token', token: jwt('t2') }, 'https://app.test');
    });
});

describe('other tabs', () => {
    const minted = (tokenUid) => reply(200, {
        token: jwtFor(tokenUid),
        godmode: true,
        expires_at: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    });
    let otherTab;

    beforeEach(() => {
        forgetGodmodeTokens();
        otherTab = new BroadcastChannel('puter-godmode-tokens');
    });

    afterEach(() => otherTab.close());

    it('hear which row each mint landed on, and every forget', async () => {
        const heard = [];
        otherTab.onmessage = (event) => heard.push(event.data);
        await mintGodmodeToken('app-1', deps(minted('t1')));
        forgetGodmodeTokens('app-1');
        forgetGodmodeTokens();
        await settle();

        expect(heard).toEqual([
            { appUid: 'app-1', tokenRow: 't1' },
            { appUid: 'app-1', tokenRow: null },
            { appUid: null, tokenRow: null },
        ]);
        // Tokens never cross between tabs.
        expect(JSON.stringify(heard)).not.toContain(jwtFor('t1'));
    });

    it('stop this tab reusing a row another tab moved off or revoked', async () => {
        const reusable = () => reusableGodmodeToken('app-1', { authToken: 'session' });
        await mintGodmodeToken('app-1', deps(minted('t1')));

        otherTab.postMessage({ appUid: 'app-1', tokenRow: 't1' });
        await settle();
        expect(reusable()).not.toBeNull();

        otherTab.postMessage({ appUid: 'app-1', tokenRow: 't2' });
        await settle();
        expect(reusable()).toBeNull();

        await mintGodmodeToken('app-1', deps(minted('t2')));
        otherTab.postMessage({ appUid: 'app-1', tokenRow: null });
        await settle();
        expect(reusable()).toBeNull();

        await mintGodmodeToken('app-1', deps(minted('t2')));
        otherTab.postMessage({ appUid: null, tokenRow: null });
        await settle();
        expect(reusable()).toBeNull();
    });
});
